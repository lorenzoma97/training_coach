// Adattatore vincolato macro→settimana (Sprint F/G, 2026-06-09).
//
// IL FIX ARCHITETTURALE: prima c'erano due motori che non si parlavano —
// la PROIEZIONE deterministica (fedele ma rigida) e l'LLM adaptPlan (flessibile
// ma DIVERGENTE dal macro). Questo modulo li unisce.
//
// Principio: separare COSA puo' cambiare da QUANTO puo' cambiare.
//  - Il macro resta lo scheletro invariante (quali sessioni, quali giorni, fase).
//  - Gemini produce un DIFF VINCOLATO (non un piano nuovo): solo move/scale/swap/drop
//    di sessioni ESISTENTI. Non puo' aggiungere sessioni ne' cambiarne il tipo →
//    la fase/focus del macro e' preservata PER COSTRUZIONE.
//  - L'app APPLICA il diff alla proiezione fedele e VALIDA la magnitudine
//    (cap intensita', max drop, no double-book, esercizio esistente).
//    Le op fuori vincolo vengono RIFIUTATE e loggate, si tiene la proiezione.
//
// Questo modulo (applier + validator) e' PURO: nessun LLM, nessun storage.
// La chiamata Gemini (generateAdaptationDiff) e' separata in fondo, opzionale.

import { z } from "zod";
import type { PlannedSession, PlannedExercise, CardioInterval, UserProfile } from "../types";
import type { MacroProgram } from "../types/macroprogram";
import { lookupExerciseHybrid } from "../macroprogram/customCatalog";
import { generateJSON } from "../gemini";

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;
export type DayLabel = typeof DAY_ORDER[number];

// ─────────────────────────────────────────────────────────────────────────────
// Eventi della settimana (input per l'adattatore)
// ─────────────────────────────────────────────────────────────────────────────

export type WeekEventKind =
  | "skipped"        // sessione pianificata non eseguita (passato)
  | "variation"      // eseguita ma diversa dal piano (tipo/subtype)
  | "extra"          // workout autonomo non pianificato
  | "pain"           // dolore segnalato nel diario
  | "readiness_low"  // readiness bassa oggi
  | "readiness_high" // readiness alta oggi ("sto benissimo")
  | "user_request";  // richiesta testuale esplicita

export interface WeekEvent {
  kind: WeekEventKind;
  /** Giorno coinvolto, se applicabile. */
  day?: DayLabel;
  /** Descrizione leggibile (mostrata all'utente + passata all'LLM). */
  detail: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff vincolato (output dell'adattatore)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sostituto LEGGERO di una sessione intera: l'attività cambia (tipo/durata/zona)
 * ma il giorno resta. Usato quando una sessione non è fattibile (es. partita di
 * calcio impossibile → corsa a intervalli equivalente). Contenuto descritto in
 * `details` (no esercizi/intervalli strutturati: l'utente la esegue ad hoc).
 */
export interface SubSession {
  type: string;
  subtype?: string;
  duration_min: number;
  zone?: 1 | 2 | 3 | 4 | 5;
  details?: string;
}

export type AdaptationOp =
  /** Sposta la sessione di `day` su `toDay` (riprogrammazione per impegno). */
  | { op: "move"; day: DayLabel; toDay: DayLabel; reason: string }
  /** Scala il volume della sessione (durata/set). factor 0.5–1.1. */
  | { op: "scaleVolume"; day: DayLabel; factor: number; reason: string }
  /** Scala l'intensita' (zone cardio / rpe forza). deltaZone -2..+1. */
  | { op: "scaleIntensity"; day: DayLabel; deltaZone: number; reason: string }
  /** Sostituisce un esercizio (es. dolore). toExerciseId deve esistere. */
  | { op: "swapExercise"; day: DayLabel; exerciseId: string; toExerciseId: string; reason: string }
  /** Sostituisce l'INTERA sessione con un'attività equivalente (cambia tipo). */
  | { op: "substituteSession"; day: DayLabel; replacement: SubSession; reason: string }
  /** Rimuove la sessione (riposo forzato). */
  | { op: "dropSession"; day: DayLabel; reason: string };

const VALID_SESSION_TYPES = ["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"] as const;

export interface AdaptationDiff {
  ops: AdaptationOp[];
  /** Sintesi 1 frase di cosa cambia (per UI). */
  summary: string;
}

export interface AdaptContext {
  program: MacroProgram | null;
  weekNumber: number;
  readinessBand?: "low" | "moderate" | "high";
  /**
   * Check esistenza esercizio nel catalog (iniettabile per test).
   * Default: lookupExerciseHybrid (catalog hardcoded + custom).
   */
  exerciseExists?: (id: string) => boolean;
  /** Numero massimo di drop consentiti (default: 40% delle sessioni, min 1). */
  maxDrops?: number;
}

export interface ApplyResult {
  sessions: PlannedSession[];
  /** Sentenze IT degli scostamenti applicati (per sourceMacro.adaptations). */
  applied: string[];
  /** Op rifiutate dal validator + motivo (per log/diagnostica). */
  rejected: Array<{ op: AdaptationOp; reason: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isDay = (d: unknown): d is DayLabel => typeof d === "string" && (DAY_ORDER as readonly string[]).includes(d);

function defaultExerciseExists(id: string): boolean {
  try {
    return !!lookupExerciseHybrid(id);
  } catch {
    return false;
  }
}

/** Cap RPE forza per la fase corrente (se definita), altrimenti 9. */
function phaseRpeMax(ctx: AdaptContext): number {
  const phases = ctx.program?.phases ?? [];
  for (const p of phases) {
    const isRange = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1];
    const inPhase = isRange
      ? (ctx.weekNumber >= p.weeks[0] && ctx.weekNumber <= p.weeks[1])
      : p.weeks.includes(ctx.weekNumber);
    if (inPhase && typeof p.rpe_target_max === "number") return p.rpe_target_max;
  }
  return 9;
}

// ─── Trasformazioni immutabili per-op ────────────────────────────────────────

function scaleSessionVolume(s: PlannedSession, factor: number): PlannedSession {
  const next: PlannedSession = { ...s, readinessAdjusted: true };
  next.duration_min = Math.max(5, Math.round(s.duration_min * factor));
  if (s.exercises && s.exercises.length > 0) {
    next.exercises = s.exercises.map((ex): PlannedExercise => ({
      ...ex,
      plannedSets: Math.max(2, Math.round(ex.plannedSets * factor)),
    }));
  }
  if (s.intervals && s.intervals.length > 0) {
    next.intervals = s.intervals.map((iv): CardioInterval =>
      typeof iv.duration_min === "number"
        ? { ...iv, duration_min: Math.max(1, Math.round(iv.duration_min * factor)) }
        : iv,
    );
  }
  return next;
}

function scaleSessionIntensity(s: PlannedSession, deltaZone: number, rpeMax: number): PlannedSession {
  const next: PlannedSession = { ...s, readinessAdjusted: true };
  // Cardio: shift zone della sessione + intervalli.
  if (typeof s.zone === "number") {
    next.zone = clamp(s.zone + deltaZone, 1, 5) as 1 | 2 | 3 | 4 | 5;
  }
  if (s.intervals && s.intervals.length > 0) {
    next.intervals = s.intervals.map((iv): CardioInterval =>
      typeof iv.zone === "number"
        ? { ...iv, zone: clamp(iv.zone + deltaZone, 1, 5) as 1 | 2 | 3 | 4 | 5 }
        : iv,
    );
  }
  // Forza: shift rpe_target (cap alla fase per l'upgrade).
  if (s.exercises && s.exercises.length > 0) {
    next.exercises = s.exercises.map((ex): PlannedExercise => {
      if (typeof ex.rpe_target !== "number") return ex;
      const shifted = ex.rpe_target + deltaZone;
      return { ...ex, rpe_target: clamp(shifted, 5, rpeMax) };
    });
  }
  return next;
}

function swapExerciseInSession(s: PlannedSession, fromId: string, toId: string): PlannedSession {
  if (!s.exercises) return s;
  return {
    ...s,
    readinessAdjusted: true,
    exercises: s.exercises.map((ex): PlannedExercise => {
      if (ex.exerciseId !== fromId) return ex;
      // Preserva il cue tecnico esistente (tempo/pausa dal macro), aggiungendo
      // la nota di sostituzione invece di sovrascriverlo.
      const note = `sostituisce ${fromId}`;
      const cue = ex.cue ? `${ex.cue} · ${note}` : note;
      return { ...ex, exerciseId: toId, cue };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLIER + VALIDATOR (puro)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applica un diff vincolato alla settimana proiettata, validando ogni op
 * contro lo scheletro del macro. Le op valide vengono applicate (in ordine
 * deterministico: drop → move → scaleVolume → scaleIntensity → swap, così le
 * trasformazioni non si calpestano), le invalide rifiutate e loggate.
 *
 * Invarianti garantiti:
 *  - Nessuna op aggiunge sessioni o cambia il TIPO → fase/focus macro intatti.
 *  - Drop ≤ maxDrops (default 40% sessioni).
 *  - move: toDay valido e LIBERO (no double-book).
 *  - scaleVolume factor ∈ [0.5, 1.1]; scaleIntensity deltaZone ∈ [-2, +1],
 *    upgrade (+) bloccato se readiness=low.
 *  - swapExercise: toExerciseId deve esistere nel catalog.
 */
export function applyAdaptationDiff(
  sessions: PlannedSession[],
  diff: AdaptationDiff,
  ctx: AdaptContext,
): ApplyResult {
  const exists = ctx.exerciseExists ?? defaultExerciseExists;
  const rpeMax = phaseRpeMax(ctx);
  const maxDrops = ctx.maxDrops ?? Math.max(1, Math.floor(sessions.length * 0.4));
  const applied: string[] = [];
  const rejected: Array<{ op: AdaptationOp; reason: string }> = [];

  // Mappa giorno→sessione (lavoriamo su copie). Una sessione per giorno (modello macro).
  let byDay = new Map<DayLabel, PlannedSession>();
  for (const s of sessions) {
    if (isDay(s.day)) byDay.set(s.day, { ...s });
  }

  // Ordina le op per priorita' deterministica.
  const ORDER: Record<AdaptationOp["op"], number> = {
    dropSession: 0, substituteSession: 1, move: 2, scaleVolume: 3, scaleIntensity: 4, swapExercise: 5,
  };
  const ops = [...(diff.ops ?? [])].sort((a, b) => ORDER[a.op] - ORDER[b.op]);

  let dropsUsed = 0;

  for (const op of ops) {
    if (!isDay(op.day)) { rejected.push({ op, reason: `giorno non valido: ${op.day}` }); continue; }
    const target = byDay.get(op.day);
    if (!target && op.op !== "move") {
      rejected.push({ op, reason: `nessuna sessione il ${op.day}` });
      continue;
    }

    switch (op.op) {
      case "dropSession": {
        if (dropsUsed >= maxDrops) {
          rejected.push({ op, reason: `limite drop raggiunto (${maxDrops})` });
          break;
        }
        byDay.delete(op.day);
        dropsUsed++;
        applied.push(`${op.day}: sessione rimossa (${op.reason}).`);
        break;
      }
      case "move": {
        const src = byDay.get(op.day);
        if (!src) { rejected.push({ op, reason: `nessuna sessione il ${op.day}` }); break; }
        if (!isDay(op.toDay)) { rejected.push({ op, reason: `toDay non valido: ${op.toDay}` }); break; }
        if (op.toDay === op.day) { rejected.push({ op, reason: "toDay = day (no-op)" }); break; }
        if (byDay.has(op.toDay)) { rejected.push({ op, reason: `${op.toDay} gia' occupato (no double-book)` }); break; }
        byDay.delete(op.day);
        byDay.set(op.toDay, { ...src, day: op.toDay, readinessAdjusted: true });
        applied.push(`${op.day} → ${op.toDay}: sessione spostata (${op.reason}).`);
        break;
      }
      case "scaleVolume": {
        if (!Number.isFinite(op.factor)) { rejected.push({ op, reason: "factor non valido" }); break; }
        const f = clamp(op.factor, 0.5, 1.1);
        if (Math.abs(f - 1) < 0.01) { rejected.push({ op, reason: "factor ~1 (no-op)" }); break; }
        byDay.set(op.day, scaleSessionVolume(target!, f));
        const pct = Math.round((f - 1) * 100);
        applied.push(`${op.day}: volume ${pct > 0 ? "+" : ""}${pct}% (${op.reason}).`);
        break;
      }
      case "scaleIntensity": {
        if (!Number.isFinite(op.deltaZone)) { rejected.push({ op, reason: "deltaZone non valido" }); break; }
        const d = clamp(Math.round(op.deltaZone), -2, 1);
        if (d === 0) { rejected.push({ op, reason: "deltaZone 0 (no-op)" }); break; }
        if (d > 0 && ctx.readinessBand === "low") {
          rejected.push({ op, reason: "upgrade intensita' bloccato: readiness bassa" });
          break;
        }
        byDay.set(op.day, scaleSessionIntensity(target!, d, rpeMax));
        applied.push(`${op.day}: intensita' ${d > 0 ? "+" : ""}${d} (${op.reason}).`);
        break;
      }
      case "substituteSession": {
        const r = op.replacement;
        if (!r || typeof r !== "object") { rejected.push({ op, reason: "replacement mancante" }); break; }
        if (!(VALID_SESSION_TYPES as readonly string[]).includes(r.type)) {
          rejected.push({ op, reason: `tipo sessione non valido: ${r.type}` });
          break;
        }
        if (!Number.isFinite(r.duration_min)) { rejected.push({ op, reason: "durata sostituto non valida" }); break; }
        // Guardrail: durata entro [0.5, 1.3]× l'originale (non stravolge il carico).
        const origDur = target!.duration_min || r.duration_min;
        const dur = Math.round(clamp(r.duration_min, origDur * 0.5, origDur * 1.3));
        let zone = r.zone;
        if (typeof zone === "number") {
          if (ctx.readinessBand === "low" && zone > 3) zone = 3;
          zone = clamp(zone, 1, 5) as 1 | 2 | 3 | 4 | 5;
        }
        const newSession: PlannedSession = {
          day: op.day,
          type: r.type,
          subtype: r.subtype,
          duration_min: dur,
          details: r.details ?? "",
          rationale: `Sostituzione sessione: ${op.reason}`,
          readinessAdjusted: true,
        };
        if (typeof zone === "number") newSession.zone = zone;
        byDay.set(op.day, newSession);
        applied.push(`${op.day}: ${target!.type} → ${r.type} ${dur}min (${op.reason}).`);
        break;
      }
      case "swapExercise": {
        if (!target!.exercises?.some(e => e.exerciseId === op.exerciseId)) {
          rejected.push({ op, reason: `esercizio ${op.exerciseId} non presente il ${op.day}` });
          break;
        }
        if (!exists(op.toExerciseId)) {
          rejected.push({ op, reason: `esercizio sostituto ${op.toExerciseId} non nel catalog` });
          break;
        }
        byDay.set(op.day, swapExerciseInSession(target!, op.exerciseId, op.toExerciseId));
        applied.push(`${op.day}: ${op.exerciseId} → ${op.toExerciseId} (${op.reason}).`);
        break;
      }
      default: {
        rejected.push({ op, reason: "op sconosciuta" });
      }
    }
  }

  // Ricostruisci la lista ordinata per giorno.
  const out: PlannedSession[] = [...byDay.values()].sort(
    (a, b) => DAY_ORDER.indexOf(a.day as DayLabel) - DAY_ORDER.indexOf(b.day as DayLabel),
  );

  return { sessions: out, applied, rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVAMENTO EVENTI (puro)
// ─────────────────────────────────────────────────────────────────────────────

type RecentDay = { date: string; daily?: unknown; workouts: unknown[] };

/**
 * Scansiona il diario per dolori segnalati (campo `w.pain`). Supporta sia il
 * formato legacy {pre,during,post} (polpaccio implicito) sia il nuovo
 * {[area]:{pre,during,post}}. Emette un evento "pain" per area con intensità
 * during/post ≥ soglia (default 3 su scala 0-10). Una sola entry per area.
 */
export function detectPainEvents(recentDays: RecentDay[], threshold = 3): WeekEvent[] {
  const out: WeekEvent[] = [];
  const seen = new Set<string>();
  for (const d of recentDays) {
    for (const w of d.workouts || []) {
      const pain = (w as { pain?: unknown })?.pain;
      if (!pain || typeof pain !== "object") continue;
      const p = pain as Record<string, unknown>;
      const isLegacy = "pre" in p || "during" in p || "post" in p;
      const entries: Array<[string, unknown]> = isLegacy ? [["polpaccio", p]] : Object.entries(p);
      for (const [area, v] of entries) {
        if (!v || typeof v !== "object") continue;
        const vv = v as Record<string, unknown>;
        const nums = [vv.during, vv.post].filter((x): x is number => typeof x === "number");
        const maxVal = nums.length ? Math.max(...nums) : 0;
        if (maxVal >= threshold && !seen.has(area.toLowerCase())) {
          seen.add(area.toLowerCase());
          out.push({ kind: "pain", detail: `Dolore ${area} intensità ${maxVal}/10 (${d.date})` });
        }
      }
    }
  }
  return out;
}

/**
 * Raccoglie TUTTI gli eventi della settimana (puro, no LLM). Usato sia dalla UI
 * (per il banner "N eventi rilevati") sia dall'orchestratore. Le deviazioni
 * piano↔diario (saltate/variazioni/autonomi) sono calcolate dal chiamante
 * (TrainingPlanView ha già il matching) e passate come `deviationEvents`.
 */
export function gatherWeekEvents(input: {
  recentDays: RecentDay[];
  readinessBand?: "low" | "moderate" | "high";
  deviationEvents?: WeekEvent[];
  userRequest?: string;
}): WeekEvent[] {
  const events: WeekEvent[] = [];
  events.push(...detectPainEvents(input.recentDays));
  if (input.readinessBand === "low") {
    events.push({ kind: "readiness_low", detail: "Readiness bassa oggi: meglio ridurre intensità." });
  } else if (input.readinessBand === "high") {
    events.push({ kind: "readiness_high", detail: "Readiness alta oggi: c'è margine per spingere un po'." });
  }
  if (input.deviationEvents) events.push(...input.deviationEvents);
  const req = input.userRequest?.trim();
  if (req) events.push({ kind: "user_request", detail: req });
  return events;
}

/**
 * Alternative CURATE (deterministiche, no LLM) per sostituire una sessione che
 * non si può fare. Per tipo di sessione: stesso stimolo, durata simile. Il menu
 * UI mostra queste + "Riposo" (dropSession) + "Altro" (LLM con guardrail).
 *
 * Ritorna [] per tipi senza alternative curate (resta solo Altro/Riposo).
 */
export function sessionAlternatives(s: PlannedSession): Array<{ label: string; op: AdaptationOp }> {
  const day = s.day as DayLabel;
  const dur = s.duration_min || 45;
  const mk = (label: string, r: SubSession): { label: string; op: AdaptationOp } => ({
    label,
    op: { op: "substituteSession", day, replacement: r, reason: `alternativa: ${label}` },
  });

  if (s.type === "sport") {
    return [
      mk("Partitella 5v5 / small-sided", { type: "sport", subtype: "Partitella", duration_min: dur, details: "Small-sided game (5v5 o meno): stesso stimolo tecnico e di condizionamento della partita." }),
      mk("Corsa a intervalli equivalente", { type: "corsa", duration_min: Math.min(dur, 50), zone: 4, details: "Riscaldamento 10' + 6×3' in Z4 (rec 2' Z1) + defaticamento: simula gli scatti ripetuti della partita." }),
      mk("Circuito condizionamento", { type: "forza_gambe", subtype: "Circuito Misto", duration_min: Math.min(dur, 45), details: "Circuito metabolico full-body 3-4 giri (squat, affondi, burpee, plank): condizionamento generale." }),
    ];
  }
  if (s.type === "corsa") {
    return [
      mk("Corsa facile Z2", { type: "corsa", subtype: "Fondo Lento", duration_min: dur, zone: 2, details: "Fondo lento conversazionale in Z2, passo libero." }),
      mk("Cardio basso impatto", { type: "sport", subtype: "Cardio", duration_min: dur, zone: 2, details: "Cyclette / ellittica / nuoto stesso tempo in Z2-3: cardio senza impatto." }),
      mk("Camminata veloce + mobilità", { type: "mobilita", duration_min: Math.min(dur, 35), details: "Camminata veloce + 10' mobilità articolare: recupero attivo." }),
    ];
  }
  if (s.type === "forza_gambe" || s.type === "forza_upper") {
    return [
      mk("Versione a corpo libero", { type: s.type, duration_min: dur, details: "Stessa sessione a corpo libero (squat, affondi, push-up, plank, hip thrust): se non hai i pesi." }),
      mk("Mobilità + core", { type: "mobilita", duration_min: Math.min(dur, 30), details: "Mobilità articolare + core (plank, dead bug, bird dog)." }),
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAZIONE DIFF VIA GEMINI (modalità adattatore)
// ─────────────────────────────────────────────────────────────────────────────

// Schema TOLLERANTE: Gemini puo' variare i campi. Validiamo qui solo la shape
// grossolana; la VALIDAZIONE SEMANTICA (magnitudine, double-book, catalog) la
// fa applyAdaptationDiff per-op. Op malformate → rifiutate a valle, non crash.
const opLooseSchema = z.object({
  op: z.enum(["move", "scaleVolume", "scaleIntensity", "swapExercise", "substituteSession", "dropSession"]),
  day: z.string(),
  toDay: z.string().optional(),
  factor: z.coerce.number().optional(),
  deltaZone: z.coerce.number().optional(),
  exerciseId: z.string().optional(),
  toExerciseId: z.string().optional(),
  replacement: z.object({
    type: z.string(),
    subtype: z.string().optional(),
    duration_min: z.coerce.number(),
    zone: z.coerce.number().optional(),
    details: z.string().optional(),
  }).optional(),
  reason: z.string().optional().default(""),
});
const diffLooseSchema = z.object({
  ops: z.array(opLooseSchema).default([]),
  summary: z.string().optional().default(""),
});

const DIFF_SCHEMA_HINT = `
{
  "ops": [
    { "op": "move", "day": "gio", "toDay": "sab", "reason": "breve" },
    { "op": "scaleVolume", "day": "lun", "factor": 0.8, "reason": "breve" },
    { "op": "scaleIntensity", "day": "mer", "deltaZone": -1, "reason": "breve" },
    { "op": "swapExercise", "day": "lun", "exerciseId": "id-attuale", "toExerciseId": "id-catalog", "reason": "breve" },
    { "op": "substituteSession", "day": "dom", "replacement": { "type": "corsa", "duration_min": 45, "zone": 4, "details": "6x3' Z4 rec 2', simula gli scatti ripetuti della partita" }, "reason": "breve" },
    { "op": "dropSession", "day": "ven", "reason": "breve" }
  ],
  "summary": "1 frase sintetica delle modifiche"
}
IMPORTANTE: restituisci SOLO questo JSON. Se nessuna modifica serve, "ops": [].
`.trim();

function phaseInfoFor(program: MacroProgram, weekNumber: number): string {
  for (const p of program.phases) {
    const isRange = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1];
    const inPhase = isRange ? (weekNumber >= p.weeks[0] && weekNumber <= p.weeks[1]) : p.weeks.includes(weekNumber);
    if (inPhase) {
      const rpe = (p.rpe_target_min && p.rpe_target_max) ? ` RPE ${p.rpe_target_min}-${p.rpe_target_max}.` : "";
      return `Fase "${p.name}" — focus: ${p.focus}.${rpe}`;
    }
  }
  return "";
}

/** Render compatto di una sessione per il prompt (no token sprecati). */
function sessionLine(s: PlannedSession): string {
  let bits = `${s.day} ${s.type} ${s.duration_min}min`;
  if (typeof s.zone === "number") bits += ` Z${s.zone}`;
  if (s.exercises && s.exercises.length > 0) {
    const ex = s.exercises.map(e => {
      const reps = e.repsTarget.min === e.repsTarget.max ? `${e.repsTarget.min}` : `${e.repsTarget.min}-${e.repsTarget.max}`;
      return `${e.exerciseId} ${e.plannedSets}x${reps}`;
    }).join(", ");
    bits += ` [${ex}]`;
  }
  return bits;
}

/**
 * Chiede a Gemini un DIFF VINCOLATO sulla settimana proiettata, dati gli eventi.
 * NON rigenera il piano: produce solo modifiche fra le op permesse. L'output
 * va poi passato ad applyAdaptationDiff (che valida + applica).
 *
 * Ritorna { ops: [], summary: "" } se l'LLM fallisce o non propone nulla:
 * il chiamante terra' la proiezione fedele (fail-safe verso la fedeltà).
 */
export async function generateAdaptationDiff(input: {
  sessions: PlannedSession[];
  events: WeekEvent[];
  program: MacroProgram;
  weekNumber: number;
  profile: UserProfile | null;
  readinessBand?: "low" | "moderate" | "high";
}): Promise<AdaptationDiff> {
  const { sessions, events, program, weekNumber, profile, readinessBand } = input;
  if (events.length === 0) return { ops: [], summary: "" };

  const phaseInfo = phaseInfoFor(program, weekNumber);
  const equipment = (profile?.equipment ?? []).join(", ") || "solo corpo libero";

  const systemInstruction = [
    "Sei un ADATTATORE di allenamenti VINCOLATO. NON generi un piano nuovo.",
    "Ricevi la settimana GIÀ pianificata (fedele a un macroprogramma multi-settimana) e una lista di EVENTI accaduti durante la settimana.",
    "Il tuo compito: proporre il DIFF MINIMO per gestire gli eventi, mantenendo lo scheletro del programma.",
    "",
    "OPERAZIONI PERMESSE (nessun'altra):",
    "- move {day,toDay}: sposta una sessione su un altro giorno LIBERO (impegno/indisponibilità).",
    "- scaleVolume {day,factor 0.5-1.1}: riduci/aumenta leggermente volume (durata+set) per fatica, aderenza bassa, recupero.",
    "- scaleIntensity {day,deltaZone -2..+1}: abbassa (o alza max +1) l'intensità (zone cardio / RPE forza). L'upgrade è VIETATO se readiness bassa.",
    "- swapExercise {day,exerciseId,toExerciseId}: sostituisci un esercizio per DOLORE. toExerciseId DEVE essere un id realmente esistente nel catalog; se non sei certo, usa scaleVolume o dropSession.",
    "- substituteSession {day,replacement}: sostituisci l'INTERA sessione con un'attività equivalente quando quella pianificata non è fattibile (es. partita di calcio impossibile). replacement = {type, duration_min, zone?, details}. REGOLA: stesso STIMOLO della fase (se la partita allena il condizionamento, proponi intervalli/circuito che allenano il condizionamento), durata simile (±25%), descrivi il contenuto in details.",
    "- dropSession {day}: rimuovi una sessione (riposo forzato). Massimo 1.",
    "",
    "VINCOLI NON VIOLABILI:",
    "- NON aggiungere sessioni. NON cambiare il TIPO di una sessione. NON inventare giorni o esercizi.",
    "- Cambia SOLO ciò che un evento richiede davvero. Se gli eventi non richiedono modifiche, restituisci ops vuoto.",
    "- Preferisci la modifica più piccola che risolve l'evento.",
  ].join("\n");

  const userPrompt = [
    phaseInfo ? `CONTESTO PROGRAMMA: settimana ${weekNumber}. ${phaseInfo}` : `Settimana ${weekNumber}.`,
    readinessBand ? `READINESS OGGI: ${readinessBand}.` : "",
    `EQUIPMENT UTENTE: ${equipment}.`,
    "",
    "SETTIMANA PIANIFICATA (fedele al macro):",
    ...sessions.map(s => `  - ${sessionLine(s)}`),
    "",
    "EVENTI DA GESTIRE:",
    ...events.map(e => `  - [${e.kind}]${e.day ? ` ${e.day}:` : ""} ${e.detail}`),
    "",
    "Produci il DIFF vincolato secondo lo schema.",
  ].filter(Boolean).join("\n");

  try {
    const raw = await generateJSON<unknown>({
      systemInstruction,
      userPrompt,
      schemaHint: DIFF_SCHEMA_HINT,
      maxTokens: 1200,
    });
    const parsed = diffLooseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[macroAdapter] diff parse fallito:", parsed.error.message);
      return { ops: [], summary: "" };
    }
    // Le op loose sono compatibili con AdaptationOp per shape; la validazione
    // semantica + i campi mancanti sono gestiti da applyAdaptationDiff.
    return { ops: parsed.data.ops as unknown as AdaptationOp[], summary: parsed.data.summary };
  } catch (e) {
    console.warn("[macroAdapter] generateAdaptationDiff errore:", e);
    return { ops: [], summary: "" };
  }
}
