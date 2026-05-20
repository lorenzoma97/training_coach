// Session Detail on-demand generator (2026-05-19).
//
// Owner: feature richiesta da Lorenzo — la tab "Oggi" del CoachV2 mostrava solo
// un riassunto qualitativo della sessione planned. Questa funzione genera il
// DETTAGLIO completo per UNA singola sessione: esercizi (PlannedExercise[]) o
// intervalli cardio (CardioInterval[]) con tutti i parametri prescrittivi.
//
// Scope (Opzione 3 "Full coach grade", 2026-05-19):
//   - Detail forza: catalog allowlist + 1RM history + Brzycki progression
//   - Detail cardio: ripetute precise con bpm/passo/recupero
//   - Readiness-aware: low → -10% intensità
//   - Pain-aware: swap esercizi che caricano aree dolorose
//   - Substitution chain: degradazione automatica equipment
//   - Math check post-parse: somma tempi ≤ duration_min × 1.1
//   - Warmup auto-link a MobilityRoutine quando pertinente
//   - Cue tecnico per esercizio (hardcoded da catalog, NON delegato a Gemini)
//
// VINCOLI:
//   - 1 chiamata Gemini per generazione (cost-controlled)
//   - Output persistito in PlannedSession.exercises / .intervals
//     (UI ricontrolla "se popolato, salta rigenerazione")
//   - Safety hardcoded: cue da catalog, allowlist esercizi, math check.
//     L'LLM sceglie solo set/reps/peso/recupero entro vincoli.
//
// BASI SCIENTIFICHE:
//   - Brzycki 1RM formula (1993): weight × (36/(37-reps))
//   - Schoenfeld 2017: 8-12 reps @ 67-75% 1RM per ipertrofia
//   - Ratamess 2009 (ACSM): rest 2-5min strength, 30-90s hypertrophy
//   - Zourdos 2016: RIR 0-3 efficace, RPE soggettivo affidabile per intermediate+

import { z } from "zod";
import { generateJSON } from "../gemini";
import { sanitizePII } from "../promptSanitizer";
import type {
  UserProfile, UserGoal, PlannedSession, PlannedExercise,
  CardioInterval, OneRepMax,
} from "../types";
import type { Exercise, EquipmentTag, ExercisePattern } from "../types/exercise";
import { EXERCISES, EXERCISES_BY_ID } from "../catalog/exercises";
import { MOBILITY_ROUTINES } from "../catalog/mobilityRoutines";
import { resolveSubstitution } from "./equipmentSubstitutor";
import { getCurrentReadiness } from "./readinessScoring";
import { getLastNDays, type Workout } from "../diaryContext";

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface GenerateSessionDetailInput {
  session: PlannedSession;
  profile: UserProfile;
  goals: UserGoal[];
  /** Opz: se già caricati dal caller, evita re-fetch. */
  recentDays?: Awaited<ReturnType<typeof getLastNDays>>;
}

export interface SessionDetailResult {
  /** Sessione con `exercises[]` o `intervals[]` popolati. */
  session: PlannedSession;
  /** Diagnostica per UI: cosa è stato applicato. */
  meta: {
    kind: "strength" | "cardio" | "mobility" | "sport" | "unknown";
    readinessBand?: "low" | "moderate" | "high";
    intensityModifier?: number; // 1.0 default, 0.9 se readiness low
    activePainAreas: string[];
    substitutions: Array<{ originalId: string; resolvedId: string; reason?: string }>;
    warmupRoutineId?: string;
    mathCheck: { ok: boolean; estimatedMin: number; targetMin: number; note?: string };
  };
}

/** Inferisce il "kind" della sessione dal `session.type` (campo del piano). */
function inferKind(sessionType: string): SessionDetailResult["meta"]["kind"] {
  const t = sessionType.toLowerCase();
  if (t.startsWith("forza")) return "strength";
  if (t === "corsa") return "cardio";
  if (t === "mobilita" || t === "mobility") return "mobility";
  if (t === "sport") return "sport";
  return "unknown";
}

export async function generateSessionDetail(
  input: GenerateSessionDetailInput,
): Promise<SessionDetailResult> {
  const { session, profile, goals } = input;
  const kind = inferKind(session.type);

  // Context loading (shared)
  const recentDays = input.recentDays ?? (await getLastNDays(60).catch(() => []));
  const readiness = await getCurrentReadiness();
  const readinessBand = readiness?.band;
  const intensityModifier = readinessBand === "low" ? 0.9 : 1.0;
  const activePainAreas = computeActivePainAreas(recentDays, profile.painTrackingAreas ?? []);

  if (kind === "strength") {
    return generateStrengthDetail({
      session, profile, goals, recentDays,
      readinessBand, intensityModifier, activePainAreas,
    });
  }
  if (kind === "cardio") {
    return generateCardioDetail({
      session, profile, goals, recentDays,
      readinessBand, intensityModifier, activePainAreas,
    });
  }
  // mobility/sport/unknown: niente detail strutturato per ora (V1 scope).
  // Ritorniamo la sessione invariata con meta esplicativa.
  return {
    session,
    meta: {
      kind,
      readinessBand, intensityModifier, activePainAreas,
      substitutions: [],
      mathCheck: { ok: true, estimatedMin: session.duration_min, targetMin: session.duration_min },
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers context: pain, history, 1RM
// ────────────────────────────────────────────────────────────────────────────

/**
 * Aree dolore "attive": tracking areas con valore >0 negli ultimi 7gg del diario.
 * Read pattern: daily[areaName] con shape `{pre, during, post}`. Una qualunque > 0
 * → area considerata attiva per swap esercizi.
 */
function computeActivePainAreas(
  recentDays: Awaited<ReturnType<typeof getLastNDays>>,
  trackedAreas: string[],
): string[] {
  if (trackedAreas.length === 0) return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff7 = today.getTime() - 7 * 86400000;
  const active = new Set<string>();
  for (const d of recentDays) {
    const dt = new Date(d.date).getTime();
    if (Number.isNaN(dt) || dt < cutoff7) continue;
    const daily = d.daily as Record<string, unknown> | null;
    if (!daily) continue;
    for (const area of trackedAreas) {
      const v = daily[area] as { pre?: number; during?: number; post?: number } | undefined;
      if (!v) continue;
      const maxVal = Math.max(0, v.pre ?? 0, v.during ?? 0, v.post ?? 0);
      if (maxVal > 0) active.add(area);
    }
  }
  return [...active];
}

/**
 * Estrae ExercisePerformance dagli ultimi N giorni del diario filtrati per
 * exerciseIds di interesse (es. solo i lift squat per una sessione gambe).
 * Output ordinato dal più recente al meno recente.
 */
function extractRecentPerformances(
  recentDays: Awaited<ReturnType<typeof getLastNDays>>,
  filterIds: Set<string>,
  daysBack = 14,
): Array<{ date: string; exerciseId: string; sets: Array<{ reps: number; weight_kg?: number; rpe?: number; rir?: number }> }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = today.getTime() - daysBack * 86400000;
  const out: Array<{ date: string; exerciseId: string; sets: Array<{ reps: number; weight_kg?: number; rpe?: number; rir?: number }> }> = [];
  for (const d of recentDays) {
    const dt = new Date(d.date).getTime();
    if (Number.isNaN(dt) || dt < cutoff) continue;
    for (const w of d.workouts ?? []) {
      const ww = w as Workout;
      const exercises = ww.exercises ?? [];
      for (const ex of exercises) {
        if (!filterIds.has(ex.exerciseId)) continue;
        out.push({
          date: d.date,
          exerciseId: ex.exerciseId,
          sets: (ex.sets ?? []).map(s => ({
            reps: s.reps,
            weight_kg: s.weight_kg,
            rpe: s.rpe,
            rir: s.rir,
          })),
        });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Brzycki 1RM stimato da reps+peso. weight × (36/(37-reps)). Reps >12 inaffidabili
 * → ritorna undefined. Se RPE noto, pesi diversamente (RPE 8+ più predittivi).
 */
function estimate1RM(weight: number, reps: number, rpe?: number): number | undefined {
  if (!Number.isFinite(weight) || weight <= 0) return undefined;
  if (!Number.isFinite(reps) || reps < 1 || reps > 12) return undefined;
  const base = weight * (36 / (37 - reps));
  // RPE confidence: se RPE >= 8 trust al 100%, RPE 7 → trust 95%, < 7 → trust 90%.
  if (typeof rpe === "number" && rpe < 8) {
    return base * (rpe <= 6 ? 0.90 : 0.95);
  }
  return base;
}

// ────────────────────────────────────────────────────────────────────────────
// STRENGTH DETAIL
// ────────────────────────────────────────────────────────────────────────────

interface StrengthDetailCtx {
  session: PlannedSession;
  profile: UserProfile;
  goals: UserGoal[];
  recentDays: Awaited<ReturnType<typeof getLastNDays>>;
  readinessBand?: "low" | "moderate" | "high";
  intensityModifier: number;
  activePainAreas: string[];
}

/** Mappa session.type / subtype → pattern target rilevanti per il filtering catalog. */
function inferStrengthPatterns(session: PlannedSession): ExercisePattern[] {
  const t = (session.type || "").toLowerCase();
  const st = (session.subtype || "").toLowerCase();
  if (t === "forza_gambe") {
    return ["squat", "hinge", "lunge", "core_antiext", "core_antirot"];
  }
  if (t === "forza_upper") {
    return ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "carry", "core_antirot"];
  }
  // Circuito misto / full-body → tutti i pattern principali
  if (st.includes("circuito") || st.includes("full")) {
    return ["squat", "hinge", "horizontal_push", "horizontal_pull", "core_antiext"];
  }
  return ["squat", "hinge", "horizontal_push", "horizontal_pull"];
}

/** Cautions pattern: mappa area dolore → pattern da evitare. */
const PAIN_TO_AVOID_PATTERNS: Record<string, ExercisePattern[]> = {
  polpaccio: ["plyometric", "lunge"],
  ginocchio: ["squat", "lunge", "plyometric"],
  schiena: ["hinge", "carry"],
  lombare: ["hinge", "carry"],
  spalla: ["vertical_push", "horizontal_push"],
};

function patternsToAvoidForPain(activePainAreas: string[]): Set<ExercisePattern> {
  const toAvoid = new Set<ExercisePattern>();
  for (const area of activePainAreas) {
    const key = area.toLowerCase();
    for (const [painKey, patterns] of Object.entries(PAIN_TO_AVOID_PATTERNS)) {
      if (key.includes(painKey)) {
        for (const p of patterns) toAvoid.add(p);
      }
    }
  }
  return toAvoid;
}

/**
 * Filtra il catalog esercizi per la sessione: pattern target + equipment +
 * level (≤ experience forza) + cautions (no esercizi con area dolore).
 */
function filterCatalogForStrength(ctx: StrengthDetailCtx): Exercise[] {
  const equipmentSet = new Set<EquipmentTag>([
    ...((ctx.profile.equipment ?? []) as EquipmentTag[]),
    "bodyweight",
  ]);
  const patterns = new Set(inferStrengthPatterns(ctx.session));
  const avoidPatterns = patternsToAvoidForPain(ctx.activePainAreas);
  // Mapping Experience (profile) → ExerciseLevel (catalog).
  // sedentary/occasional → beginner; regular → intermediate; competitive → advanced.
  const profileLevel = ctx.profile.experienceByDiscipline?.forza ?? ctx.profile.experience;
  const profileToCatalog: Record<string, number> = {
    sedentary: 0, occasional: 0,           // → beginner
    regular: 1,                            // → intermediate
    competitive: 2,                        // → advanced
    beginner: 0, intermediate: 1, advanced: 2,  // backward-compat se Experience type cambia
  };
  const maxLevelIdx = profileToCatalog[profileLevel as string] ?? 1;
  return EXERCISES.filter(ex => {
    if (!patterns.has(ex.pattern)) return false;
    if (avoidPatterns.has(ex.pattern)) return false;
    // Equipment AND check (bodyweight gratis)
    for (const tag of ex.equipment) {
      if (tag === "bodyweight") continue;
      if (!equipmentSet.has(tag)) return false;
    }
    // Level cap
    const exLevelIdx = ({ beginner: 0, intermediate: 1, advanced: 2 } as Record<string, number>)[ex.level] ?? 1;
    if (exLevelIdx > maxLevelIdx) return false;
    return true;
  });
}

/**
 * Formula recovery deterministica: 120s base + 30s × (RPE - 7).
 * RPE 7 → 120s; RPE 8 → 150s; RPE 9 → 180s.
 * Range hardcoded: [60, 240] sec. Safety hardcoded (Ratamess 2009).
 */
function recommendedRestSec(rpeTarget: number): number {
  const calc = 120 + 30 * (rpeTarget - 7);
  return Math.max(60, Math.min(240, Math.round(calc)));
}

const plannedExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  plannedSets: z.coerce.number().int().min(1).max(10),
  repsTarget: z.object({
    min: z.coerce.number().int().min(1).max(50),
    max: z.coerce.number().int().min(1).max(50),
  }),
  weight_kg: z.coerce.number().nonnegative().max(500).optional(),
  pct1RM: z.coerce.number().min(20).max(100).optional(),
  rpe_target: z.coerce.number().min(5).max(10).optional(),
  rir_target: z.coerce.number().int().min(0).max(5).optional(),
  rest_sec: z.coerce.number().int().min(30).max(600),
  cue: z.string().optional().transform(c => c?.trim() || undefined),
});

const strengthDetailSchema = z.object({
  exercises: z.array(plannedExerciseSchema).min(2).max(8),
});

async function generateStrengthDetail(ctx: StrengthDetailCtx): Promise<SessionDetailResult> {
  // 1. Build catalog allowlist filtrato
  const allowedExercises = filterCatalogForStrength(ctx);
  if (allowedExercises.length === 0) {
    // Edge case: nessun esercizio compatibile. Ritorna sessione invariata + meta esplicativa.
    return {
      session: ctx.session,
      meta: {
        kind: "strength",
        readinessBand: ctx.readinessBand, intensityModifier: ctx.intensityModifier,
        activePainAreas: ctx.activePainAreas, substitutions: [],
        mathCheck: { ok: false, estimatedMin: 0, targetMin: ctx.session.duration_min, note: "Nessun esercizio compatibile con equipment + pain + level. Detail non generabile." },
      },
    };
  }

  // 2. 1RM noti per gli esercizi nella allowlist
  const allowedIds = new Set(allowedExercises.map(e => e.id));
  const relevantOneRMs = (ctx.profile.oneRepMaxes ?? []).filter(o => allowedIds.has(o.exerciseId));

  // 3. Performance recenti per progression
  const recentPerf = extractRecentPerformances(ctx.recentDays, allowedIds, 14);

  // 4. Build prompt
  const systemInstruction = buildStrengthSystemInstruction(ctx);
  const userPrompt = buildStrengthUserPrompt(ctx, allowedExercises, relevantOneRMs, recentPerf);

  // 5. Call LLM
  let raw: unknown;
  try {
    raw = await generateJSON<unknown>({
      systemInstruction, userPrompt,
      schemaHint: STRENGTH_SCHEMA_HINT,
      maxTokens: 1800,
    });
  } catch (e) {
    console.error("[sessionDetail strength] LLM failed:", e);
    throw new Error("Generazione dettaglio non riuscita. Riprova tra qualche secondo.");
  }

  // 6. Parse + validate
  const parsed = strengthDetailSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[sessionDetail strength] Zod parse failed:", parsed.error.message);
    throw new Error("Coach non è riuscito a generare un dettaglio strutturato. Riprova.");
  }
  let exercises = parsed.data.exercises as PlannedExercise[];

  // 7. Apply substitution chain per esercizi con equipment incompleto (failsafe)
  const substitutions: SessionDetailResult["meta"]["substitutions"] = [];
  const userEquipment = (ctx.profile.equipment ?? []) as EquipmentTag[];
  exercises = exercises.map(ex => {
    if (!EXERCISES_BY_ID[ex.exerciseId]) {
      // Esercizio inventato dall'LLM o errato → drop (sicurezza)
      return null;
    }
    const sub = resolveSubstitution(ex.exerciseId, userEquipment, EXERCISES);
    if (!sub) return null; // unresolvable
    if (sub.hop > 0) {
      substitutions.push({ originalId: ex.exerciseId, resolvedId: sub.resolvedId, reason: sub.reason });
      return { ...ex, exerciseId: sub.resolvedId, effectiveExerciseId: sub.resolvedId };
    }
    return ex;
  }).filter((x): x is PlannedExercise => x !== null);

  // 8. Force cue da catalog (NO LLM-generated cue → consistency)
  exercises = exercises.map(ex => {
    const catEx = EXERCISES_BY_ID[ex.exerciseId];
    return { ...ex, cue: catEx?.technique?.split(/[.!?]/)[0]?.trim() || ex.cue };
  });

  // 9. Math check: stima tempo totale ≤ duration_min × 1.1
  const mathCheck = checkSessionTiming(exercises, ctx.session.duration_min);

  // 10. Warmup auto-link
  const warmupRoutineId = pickWarmupRoutine(ctx.session);

  // 11. Build final session
  const finalSession: PlannedSession = {
    ...ctx.session,
    exercises,
    ...(warmupRoutineId ? { warmupRoutineId } : {}),
  };

  return {
    session: finalSession,
    meta: {
      kind: "strength",
      readinessBand: ctx.readinessBand,
      intensityModifier: ctx.intensityModifier,
      activePainAreas: ctx.activePainAreas,
      substitutions,
      warmupRoutineId,
      mathCheck,
    },
  };
}

const STRENGTH_SCHEMA_HINT = `
{
  "exercises": [
    {
      "exerciseId": "DEVE essere un id ESATTO dell'allowlist sotto",
      "plannedSets": number (2-6 tipico),
      "repsTarget": { "min": number, "max": number },
      "weight_kg": number (carico assoluto SOLO se 1RM noto e prescritto via pct1RM),
      "pct1RM": number 50-90 (preferito se 1RM disponibile per quell'esercizio),
      "rpe_target": number 6-9 (fallback se pct1RM non applicabile),
      "rir_target": number 0-4 (alternativa a rpe_target — UNO solo dei due),
      "rest_sec": number (180s squat heavy / 120s accessori — vincolo: usa formula 120+30*(rpe-7))
    }
  ]
}
IMPORTANTE:
- Esattamente UNO tra (weight_kg con pct1RM | rpe_target | rir_target) — non tutti e tre.
- exerciseId DEVE esistere nell'allowlist iniettata nel userPrompt.
- 2-6 esercizi per sessione (compound first, accessori dopo).
- NO esercizi extra rispetto all'allowlist.
- NO cue: il sistema lo carica dal catalog (consistency).
`.trim();

function buildStrengthSystemInstruction(ctx: StrengthDetailCtx): string {
  const lines: string[] = [
    "Sei un coach di forza esperto. Genera il dettaglio prescrittivo per UNA sessione di forza.",
    "",
    "REGOLE NON NEGOZIABILI:",
    "- Scegli esercizi SOLO dall'allowlist iniettata (sono compatibili con equipment + livello + pain dell'utente).",
    "- Compound first (squat/deadlift/bench/row), accessori dopo (lavori isolati/core).",
    `- Recovery: usa formula 120s + 30s × (rpe_target - 7). Es. RPE 8 → 150s, RPE 9 → 180s.`,
    "- Se 1RM noto per un esercizio, prescrivi via pct1RM (es. 75% 1RM × 5 reps). Altrimenti rpe_target.",
    "- Progressione: se performance recente mostra RPE ≤7 stabile sullo stesso esercizio → +2.5kg o +1 rep. Se RPE ≥9 → mantieni o riduci.",
  ];
  if (ctx.readinessBand === "low") {
    lines.push("- READINESS BAND OGGI = LOW: riduci intensità del 10% (pesi -10%, o rpe -1, o sets -1). Spiega nei rationale che è readiness-driven.");
  }
  if (ctx.activePainAreas.length > 0) {
    lines.push(`- PAIN ATTIVO (${ctx.activePainAreas.join(", ")}): l'allowlist già esclude pattern problematici. NON aggiungere esercizi non in allowlist.`);
  }
  lines.push("- Vincolo tempo: somma stimata sets × ~30s + rest_sec deve stare entro durata sessione.");
  lines.push("- Output JSON strict (no markdown, no commenti).");
  return lines.join("\n");
}

function buildStrengthUserPrompt(
  ctx: StrengthDetailCtx,
  allowed: Exercise[],
  oneRMs: OneRepMax[],
  recentPerf: ReturnType<typeof extractRecentPerformances>,
): string {
  const allowlistBlock = allowed
    .slice(0, 30) // cap per prompt size
    .map(e => `- ${e.id} (${e.name}, ${e.pattern}, level=${e.level})`)
    .join("\n");
  const oneRMBlock = oneRMs.length > 0
    ? oneRMs.map(o => `- ${o.exerciseId}: ${o.value_kg}kg (${o.source}, ${o.acquiredAt})`).join("\n")
    : "(nessun 1RM noto — usa rpe_target invece di pct1RM)";
  const perfBlock = recentPerf.length > 0
    ? recentPerf.slice(0, 20).map(p => {
      const setsStr = p.sets.map(s => {
        const parts = [`${s.reps}r`];
        if (s.weight_kg) parts.push(`${s.weight_kg}kg`);
        if (s.rpe) parts.push(`RPE${s.rpe}`);
        if (s.rir !== undefined) parts.push(`RIR${s.rir}`);
        return parts.join("@");
      }).join(" | ");
      return `- ${p.date} ${p.exerciseId}: ${setsStr}`;
    }).join("\n")
    : "(nessuno storico — utente nuovo o sessione tipo nuovo)";
  return [
    `SESSIONE OGGI: ${ctx.session.type}${ctx.session.subtype ? ` (${ctx.session.subtype})` : ""}, durata ${ctx.session.duration_min}min.`,
    ctx.session.details ? `Note pianificate: ${sanitizePII(ctx.session.details)}` : "",
    "",
    "ALLOWLIST ESERCIZI (usa SOLO questi id):",
    allowlistBlock,
    "",
    "1RM NOTI:",
    oneRMBlock,
    "",
    "PERFORMANCE RECENTI (14gg, ordinate dal più recente):",
    perfBlock,
    "",
    `READINESS BAND OGGI: ${ctx.readinessBand ?? "unknown"}`,
    ctx.activePainAreas.length > 0 ? `PAIN ATTIVO: ${ctx.activePainAreas.join(", ")}` : "",
    "",
    "Genera 4-6 esercizi (compound first, accessori dopo). Output JSON valido secondo schema.",
  ].filter(Boolean).join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// CARDIO DETAIL
// ────────────────────────────────────────────────────────────────────────────

interface CardioDetailCtx extends StrengthDetailCtx {}

const cardioIntervalSchema = z.object({
  kind: z.enum(["warmup", "main", "cooldown", "repetition", "recovery"]),
  duration_min: z.coerce.number().min(1).max(180).optional(),
  distance_km: z.coerce.number().min(0.05).max(100).optional(),
  zone: z.coerce.number().int().min(1).max(5).optional(),
  reps: z.coerce.number().int().min(1).max(50).optional(),
  recovery_sec: z.coerce.number().int().min(15).max(900).optional(),
  cue: z.string().optional().transform(c => c?.trim() || undefined),
});

const cardioDetailSchema = z.object({
  intervals: z.array(cardioIntervalSchema).min(2).max(10),
});

async function generateCardioDetail(ctx: CardioDetailCtx): Promise<SessionDetailResult> {
  const systemInstruction = buildCardioSystemInstruction(ctx);
  const userPrompt = buildCardioUserPrompt(ctx);

  let raw: unknown;
  try {
    raw = await generateJSON<unknown>({
      systemInstruction, userPrompt,
      schemaHint: CARDIO_SCHEMA_HINT,
      maxTokens: 1400,
    });
  } catch (e) {
    console.error("[sessionDetail cardio] LLM failed:", e);
    throw new Error("Generazione dettaglio cardio non riuscita. Riprova.");
  }
  const parsed = cardioDetailSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[sessionDetail cardio] Zod parse failed:", parsed.error.message);
    throw new Error("Coach non è riuscito a generare un dettaglio cardio strutturato.");
  }
  const intervals = parsed.data.intervals as CardioInterval[];

  // Math check cardio: somma duration_min ≤ session.duration_min × 1.1
  const sum = intervals.reduce((a, i) => a + (i.duration_min ?? 0), 0);
  const target = ctx.session.duration_min;
  const mathCheck = {
    ok: sum <= target * 1.1 && sum >= target * 0.8,
    estimatedMin: Math.round(sum),
    targetMin: target,
    note: sum > target * 1.1 ? "Intervalli sommano più della durata pianificata." :
          sum < target * 0.8 ? "Intervalli sommano molto meno della durata pianificata." : undefined,
  };

  const warmupRoutineId = pickWarmupRoutine(ctx.session);
  const finalSession: PlannedSession = {
    ...ctx.session,
    intervals,
    ...(warmupRoutineId ? { warmupRoutineId } : {}),
  };
  return {
    session: finalSession,
    meta: {
      kind: "cardio",
      readinessBand: ctx.readinessBand,
      intensityModifier: ctx.intensityModifier,
      activePainAreas: ctx.activePainAreas,
      substitutions: [],
      warmupRoutineId,
      mathCheck,
    },
  };
}

const CARDIO_SCHEMA_HINT = `
{
  "intervals": [
    {
      "kind": "warmup"|"main"|"cooldown"|"repetition"|"recovery",
      "duration_min": number (mutually exclusive con distance_km),
      "distance_km": number (es. 1.0 per "1km @ Z4"),
      "zone": 1|2|3|4|5,
      "reps": number (solo se kind=repetition, es. 6×400m → reps=6),
      "recovery_sec": number (recovery tra reps; solo per kind=repetition o recovery),
      "cue": "breve descrizione passo/sensazione, NO bpm precisi"
    }
  ]
}
TYPICAL STRUCTURE:
- 1 warmup (5-15min Z1-Z2, anche con drill skip/skipping)
- 1 main o ripetute (kind=main per fondo continuo, kind=repetition per intervalli)
- 1 cooldown (5-10min Z1-Z2)
Per fondo lento Z2: [warmup, main, cooldown] = 3 intervalli
Per ripetute: [warmup, repetition (con reps + recovery_sec), cooldown] = 3 intervalli
Per fartlek: [warmup, multiple main/repetition alternating, cooldown]
`.trim();

function buildCardioSystemInstruction(ctx: CardioDetailCtx): string {
  const lines: string[] = [
    "Sei un coach endurance esperto. Genera il dettaglio prescrittivo per UNA sessione di corsa.",
    "",
    "REGOLE NON NEGOZIABILI:",
    "- Struttura: warmup (5-15min Z1-Z2) + main/repetition + cooldown (5-10min Z1-Z2).",
    "- Zone target dal subtype: Fondo Lento → Z2, Tempo/Soglia → Z3-Z4, Ripetute → Z4-Z5, Fartlek → Z2 base + accelerazioni Z3-Z4.",
    "- Ripetute: kind=repetition con reps (es. 6×400m) + recovery_sec (60-180s tipico).",
    "- Somma durata intervalli deve essere vicina (entro ±10%) alla durata totale sessione.",
    "- Cue qualitativi (passo libero, conversazionale, sostenuto, all-out). NO bpm precisi (UI li calcola).",
  ];
  if (ctx.readinessBand === "low") {
    lines.push("- READINESS LOW: downgrade Z4-Z5 → Z2-Z3, ripetute → fondo continuo. Sicurezza prima.");
  }
  if (ctx.activePainAreas.length > 0) {
    lines.push(`- PAIN ATTIVO (${ctx.activePainAreas.join(", ")}): valuta se downgrade intensità o sostituzione con cross-training. Se polpaccio: NO Z4-5, NO ripetute.`);
  }
  lines.push("- Output JSON strict (no markdown).");
  return lines.join("\n");
}

function buildCardioUserPrompt(ctx: CardioDetailCtx): string {
  const recentCardio = ctx.recentDays
    .flatMap(d => (d.workouts ?? []).map(w => ({ date: d.date, w: w as Workout })))
    .filter(({ w }) => w.type === "corsa")
    .slice(-7)
    .map(({ date, w }) => {
      const f = (w.fields ?? {}) as Record<string, unknown>;
      const dur = f.durata_totale ?? f.durata ?? "?";
      const subt = f.tipo ?? "?";
      const fcm = f.fc_media ?? "?";
      return `- ${date} corsa ${subt}: ${dur}min, FC media ${fcm}`;
    }).join("\n") || "(nessuna sessione cardio recente)";

  return [
    `SESSIONE OGGI: corsa${ctx.session.subtype ? ` (${ctx.session.subtype})` : ""}, durata ${ctx.session.duration_min}min, zona ${ctx.session.zone ?? "?"}.`,
    ctx.session.details ? `Note pianificate: ${sanitizePII(ctx.session.details)}` : "",
    "",
    "ULTIME SESSIONI CARDIO (7gg):",
    recentCardio,
    "",
    `READINESS BAND OGGI: ${ctx.readinessBand ?? "unknown"}`,
    ctx.activePainAreas.length > 0 ? `PAIN ATTIVO: ${ctx.activePainAreas.join(", ")}` : "",
    "",
    "Genera 3-6 intervalli (warmup + main/repetition + cooldown). Output JSON valido secondo schema.",
  ].filter(Boolean).join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// MATH CHECK
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stima tempo totale sessione forza: per ogni esercizio
 *   tempo_set ≈ 30s (compound) o 20s (accessori) — semplificato
 *   tempo_total = plannedSets × (tempo_set + rest_sec)
 * Tollera fino a 10% sopra il target.
 */
function checkSessionTiming(
  exercises: PlannedExercise[],
  targetMin: number,
): SessionDetailResult["meta"]["mathCheck"] {
  let totalSec = 0;
  for (const ex of exercises) {
    const isCompound = ["squat", "hinge"].includes(
      EXERCISES_BY_ID[ex.exerciseId]?.pattern ?? "",
    );
    const timePerSet = isCompound ? 40 : 25;
    totalSec += ex.plannedSets * (timePerSet + (ex.rest_sec ?? 90));
  }
  const estimatedMin = Math.round(totalSec / 60);
  const targetSec = targetMin * 60;
  const ok = totalSec <= targetSec * 1.1;
  return {
    ok,
    estimatedMin,
    targetMin,
    note: !ok ? `Stima ${estimatedMin}min eccede target ${targetMin}min di oltre 10%. Considera ridurre sets o esercizi.` : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// WARMUP AUTO-LINK
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sceglie una MobilityRoutine warmup adatta alla sessione.
 * Match euristico: purpose="warmup" + (sport==type se popolato | generale).
 */
function pickWarmupRoutine(session: PlannedSession): string | undefined {
  const t = session.type.toLowerCase();
  const candidates = MOBILITY_ROUTINES.filter(r => r.purpose === "warmup");
  if (candidates.length === 0) return undefined;
  // Match sport-specific specifico per type sessione.
  if (t === "corsa") {
    const runner = candidates.find(r => (r as { sport?: string }).sport === "corsa");
    if (runner) return runner.id;
  }
  if (t === "sport") {
    const subtypeLc = (session.subtype || "").toLowerCase();
    const sportMatch = candidates.find(r => {
      const s = (r as { sport?: string }).sport?.toLowerCase();
      return s && subtypeLc.includes(s);
    });
    if (sportMatch) return sportMatch.id;
  }
  // Generica (movement-prep o equivalent) → match per nome o fallback prima senza sport
  const generic = candidates.find(r => !(r as { sport?: string }).sport);
  return generic?.id ?? candidates[0]?.id;
}
