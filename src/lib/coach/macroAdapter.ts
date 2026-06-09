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

import type { PlannedSession, PlannedExercise, CardioInterval } from "../types";
import type { MacroProgram } from "../types/macroprogram";
import { lookupExerciseHybrid } from "../macroprogram/customCatalog";

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

export type AdaptationOp =
  /** Sposta la sessione di `day` su `toDay` (riprogrammazione per impegno). */
  | { op: "move"; day: DayLabel; toDay: DayLabel; reason: string }
  /** Scala il volume della sessione (durata/set). factor 0.5–1.1. */
  | { op: "scaleVolume"; day: DayLabel; factor: number; reason: string }
  /** Scala l'intensita' (zone cardio / rpe forza). deltaZone -2..+1. */
  | { op: "scaleIntensity"; day: DayLabel; deltaZone: number; reason: string }
  /** Sostituisce un esercizio (es. dolore). toExerciseId deve esistere. */
  | { op: "swapExercise"; day: DayLabel; exerciseId: string; toExerciseId: string; reason: string }
  /** Rimuove la sessione (riposo forzato). */
  | { op: "dropSession"; day: DayLabel; reason: string };

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
    dropSession: 0, move: 1, scaleVolume: 2, scaleIntensity: 3, swapExercise: 4,
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
        const f = clamp(op.factor, 0.5, 1.1);
        if (Math.abs(f - 1) < 0.01) { rejected.push({ op, reason: "factor ~1 (no-op)" }); break; }
        byDay.set(op.day, scaleSessionVolume(target!, f));
        const pct = Math.round((f - 1) * 100);
        applied.push(`${op.day}: volume ${pct > 0 ? "+" : ""}${pct}% (${op.reason}).`);
        break;
      }
      case "scaleIntensity": {
        let d = clamp(Math.round(op.deltaZone), -2, 1);
        if (d === 0) { rejected.push({ op, reason: "deltaZone 0 (no-op)" }); break; }
        if (d > 0 && ctx.readinessBand === "low") {
          rejected.push({ op, reason: "upgrade intensita' bloccato: readiness bassa" });
          break;
        }
        byDay.set(op.day, scaleSessionIntensity(target!, d, rpeMax));
        applied.push(`${op.day}: intensita' ${d > 0 ? "+" : ""}${d} (${op.reason}).`);
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
