// Multi-pass orchestrator — Wave 4.1.
//
// Owner: llm-prompt-specialist + planGenerator-implementer (Wave 4.1).
//
// CONTRATTO (vedi ARCHITECTURE.md §3.1, §5.2):
// - Pass-1: LLM produce SOLO scheletro settimanale (metadata sessioni).
// - Pass-2: per ogni sessione che lo richiede, chiama un prompt builder
//   dedicato (strength: buildStrengthPassPrompt; cardio Z4-Z5:
//   buildCardioIntervalPrompt) e arricchisce la sessione con exercises[]
//   o intervals[] strutturati. Sessioni mobility/sport/cardio Z1-Z3 NON
//   passano per Pass-2 (skeleton sufficiente).
// - Pass-3: deterministico, mai LLM. Esegue validatePlan + applica
//   correctedPlan (equipment substitution, readiness downgrade). Logga
//   issue residue come warning nel rationale.
//
// VINCOLI:
// - Backward compat: l'orchestrator e' chiamato da planGenerator (delega
//   trasparente). Le firme esterne di generateInitialPlan/regenerateNextWeek/
//   adaptPlan restano invariate.
// - Token budget: Pass-1 ~1500 token output, Pass-2 ~800 token/sessione
//   (3-4 forza + 0-2 cardio Z4+) = ~3500 token totali. Pass-3 = 0.
// - Resilienza: errore Pass-1 → fallback emergency plan (riusa builder
//   esistente). Errore Pass-2 su singola sessione → conserva skeleton
//   (no exercises/intervals), logga warning, NON blocca le altre sessioni.

import { z } from "zod";
import { generateJSON } from "../../gemini";
import { PROMPTS } from "../systemPrompts";
import {
  buildConditionalPrompt,
  extractConditionsFromProfile,
  RUNNING_GOAL_RE,
  type BuildContext,
  type BuildContextMacroCtx,
} from "../promptBuilder";
import {
  validatePlan,
  planStateHash,
  computePlanStartDate,
  type PlanValidationResult,
} from "../planValidator";
import type { ZonesResult } from "../zones";
import type {
  TrainingPlan,
  PlanWeek,
  PlannedSession,
  PlannedExercise,
  CardioInterval,
  UserProfile,
  UserGoal,
  ReadinessSnapshot,
  OneRepMax,
} from "../../types";
import type { Workout } from "../../diaryContext";

import { buildPass1SkeletonPrompt, type SkeletonContext } from "./skeletonPrompt";
import { buildStrengthPassPrompt } from "./strengthSessionPrompt";
import { buildCardioIntervalPrompt } from "./cardioIntervalPrompt";

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag — backward compat (default true).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toggle multi-pass. Lasciato come const per Wave 4.1 (no UI flag in profile).
 * Se serve disabilitare a runtime → settare a false e il caller cadra'
 * sul comportamento legacy (single-pass) via planGenerator.
 */
export const MULTI_PASS_ENABLED = true;

// ─────────────────────────────────────────────────────────────────────────────
// Schemi Zod Pass-1 e Pass-2.
// ─────────────────────────────────────────────────────────────────────────────

/** Pass-1: skeleton sessione (no exercises, no intervals, no details/rationale). */
const skeletonSessionSchema = z.object({
  day: z.enum(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]),
  type: z.enum(["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"]),
  subtype: z.string().optional(),
  duration_min: z.number().int().min(5).max(240),
  focus: z.string().optional(),
  zone: z.number().int().min(1).max(5).optional(),
});

const skeletonWeekSchema = z.object({
  weekNumber: z.number().int().min(1),
  focus: z.string(),
  sessions: z.array(skeletonSessionSchema),
});

const skeletonPlanSchema = z.object({
  weeks: z.array(skeletonWeekSchema).min(1).max(4),
  rationale: z.string(),
});

/** Pass-2 strength: shape PlannedExercise + meta. */
const plannedExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  plannedSets: z.number().int().min(1).max(20),
  repsTarget: z.object({
    min: z.number().int().min(1).max(100),
    max: z.number().int().min(1).max(100),
  }),
  weight_kg: z.number().min(0).max(500).optional(),
  pct1RM: z.number().min(0).max(100).optional(),
  rpe_target: z.number().min(1).max(10).optional(),
  rir_target: z.number().min(0).max(10).optional(),
  rest_sec: z.number().int().min(0).max(600),
  cue: z.string().optional(),
});

const strengthPass2Schema = z.object({
  exercises: z.array(plannedExerciseSchema).min(1).max(12),
  details: z.string().optional(),
  rationale: z.string().optional(),
  warmupRoutineId: z.string().optional(),
  cooldownRoutineId: z.string().optional(),
  progressionRule: z.object({
    triggerCondition: z.string(),
    action: z.string(),
  }).optional(),
});

/** Pass-2 cardio: shape CardioInterval + meta. */
const cardioIntervalSchema = z.object({
  kind: z.enum(["warmup", "main", "cooldown", "repetition", "recovery"]),
  duration_min: z.number().min(0.5).max(180).optional(),
  distance_km: z.number().min(0.05).max(50).optional(),
  zone: z.number().int().min(1).max(5).optional(),
  reps: z.number().int().min(1).max(30).optional(),
  recovery_sec: z.number().int().min(0).max(600).optional(),
  cue: z.string().optional(),
});

const cardioPass2Schema = z.object({
  intervals: z.array(cardioIntervalSchema).min(1).max(20),
  details: z.string().optional(),
  rationale: z.string().optional(),
  warmupRoutineId: z.string().optional(),
  cooldownRoutineId: z.string().optional(),
  progressionRule: z.object({
    triggerCondition: z.string(),
    action: z.string(),
  }).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// API pubblica.
// ─────────────────────────────────────────────────────────────────────────────

/** Log strutturato per ogni pass (telemetria + debug). */
export interface PassLog {
  pass: 1 | 2 | 3;
  ts: string;
  durationMs: number;
  /** Token usati (se il provider li riporta — Wave 4.1: undefined). */
  tokens?: number;
  /** Issue/warning rilevati nel pass (es. validator residui). */
  issues?: string[];
  /** Note diagnostiche aggiuntive (es. "skipped: skipPass2=true"). */
  note?: string;
}

/** Risultato finale dell'orchestrator. */
export interface PassResult {
  plan: TrainingPlan;
  passLogs: PassLog[];
}

/** Contesto di input per runMultiPass. */
export interface OrchestratorContext {
  profile: UserProfile;
  goals: UserGoal[];
  /** Ultimi N giorni dal diario (gia' caricati dal caller). */
  recentDays: Array<{ date: string; daily: unknown; workouts: Workout[] }>;
  /** Macro context (gia' caricato dal caller). Null se utente non ha race "A". */
  macroContext: BuildContextMacroCtx | null;
  /** Readiness snapshot (gia' caricato dal caller). Null se non disponibile. */
  readiness: ReadinessSnapshot | null;
  /** Zone FC personalizzate (gia' calcolate dal caller). */
  zones: ZonesResult | null;
  /** Modalita' di generazione (impatta wording prompt + startDate). */
  mode: "initial" | "regen" | "adapt";
  /** Solo per mode=regen: piano corrente (per planAsPrompt). */
  currentPlan?: TrainingPlan | null;
  /** Solo per mode=regen/adapt: testo riassuntivo ultimi 14 giorni. */
  recentDaysText?: string;
  /** Vincolo HARD su giorni allenabili. */
  availableDays?: ReadonlyArray<string>;
  /** Solo per mode=regen "rest-of-week": giorni rimanenti. */
  remainingThisWeek?: ReadonlyArray<string>;
}

/** Opzioni runtime opzionali. */
export interface OrchestratorOptions {
  /**
   * Se true, salta Pass-2 e ritorna lo skeleton come piano finale.
   * Comportamento legacy / debug. Le sessioni non saranno arricchite.
   */
  skipPass2?: boolean;
  /** Solo per mode=adapt: testo richiesta utente sanitizzato. */
  userRequest?: string;
  /** expectedDayLabels da passare al validator (per finestre parziali). */
  expectedDayLabels?: string[];
}

/**
 * Esegue il multi-pass orchestrator.
 *
 * Flusso:
 *  1. Pass-1: LLM → skeleton settimana.
 *  2. Pass-2: per ogni sessione che lo richiede, LLM → exercises[]/intervals[].
 *     Sessioni mobility/sport/cardio Z1-Z3 saltano Pass-2 (skeleton sufficiente).
 *  3. Pass-3: validatePlan + applyCorrectedPlan (deterministico).
 *
 * Errori:
 *  - Pass-1 fallisce → throw error (il caller decidera' fallback).
 *  - Pass-2 fallisce su singola sessione → log warning, sessione resta skeleton.
 *  - Pass-3 → MAI fallisce (validator e' tollerante; ritorna issues + correctedPlan).
 */
export async function runMultiPass(
  ctx: OrchestratorContext,
  opts: OrchestratorOptions = {},
): Promise<PassResult> {
  const passLogs: PassLog[] = [];

  // ───────────────────────────── Pass-1 ─────────────────────────────
  const t1Start = Date.now();
  const skeletonPlan = await runPass1(ctx, opts);
  passLogs.push({
    pass: 1,
    ts: new Date().toISOString(),
    durationMs: Date.now() - t1Start,
    note: `${skeletonPlan.weeks[0]?.sessions.length ?? 0} sessioni skeleton`,
  });

  // ───────────────────────────── Pass-2 ─────────────────────────────
  let detailedPlan: TrainingPlan = skeletonPlan;
  if (opts.skipPass2) {
    passLogs.push({
      pass: 2,
      ts: new Date().toISOString(),
      durationMs: 0,
      note: "skipped: skipPass2=true (legacy mode)",
    });
  } else {
    const t2Start = Date.now();
    const pass2Result = await runPass2(skeletonPlan, ctx);
    detailedPlan = pass2Result.plan;
    passLogs.push({
      pass: 2,
      ts: new Date().toISOString(),
      durationMs: Date.now() - t2Start,
      issues: pass2Result.warnings,
      note: `${pass2Result.detailedCount}/${pass2Result.eligibleCount} sessioni dettagliate`,
    });
  }

  // ───────────────────────────── Pass-3 ─────────────────────────────
  const t3Start = Date.now();
  const validation = runPass3(detailedPlan, ctx, opts);
  // Marker generationMode="multi" su nuovo oggetto (no mutation del validator output).
  let finalPlan: TrainingPlan = { ...validation.correctedPlan, generationMode: "multi" };

  // Se ci sono issue residue di tipo error (non-fixable da correctedPlan),
  // appendiamo warning al rationale ma NON ri-chiamiamo l'LLM (token-cost).
  if (!validation.ok) {
    const errorIssues = validation.issues.filter(i => i.severity === "error").map(i => i.message);
    finalPlan = {
      ...finalPlan,
      rationale: finalPlan.rationale +
        "\n\n[Validator] Avvertenze residue: " + errorIssues.join(" | "),
    };
  }

  passLogs.push({
    pass: 3,
    ts: new Date().toISOString(),
    durationMs: Date.now() - t3Start,
    issues: validation.issues.map(i => `${i.type}:${i.severity}`),
    note: validation.ok ? "ok" : `${validation.issues.filter(i => i.severity === "error").length} errori, ${validation.issues.filter(i => i.severity === "warn").length} warning`,
  });

  return { plan: finalPlan, passLogs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass-1 implementation.
// ─────────────────────────────────────────────────────────────────────────────

async function runPass1(
  ctx: OrchestratorContext,
  opts: OrchestratorOptions,
): Promise<TrainingPlan> {
  const skeletonCtx: SkeletonContext = {
    profile: ctx.profile,
    goals: ctx.goals,
    availableDays: ctx.availableDays,
    macroContext: ctx.macroContext ?? undefined,
    zones: ctx.zones,
    readinessBand: ctx.readiness?.band ?? null,
    mode: ctx.mode,
    userRequest: opts.userRequest,
    remainingThisWeek: ctx.remainingThisWeek,
    recentDaysText: ctx.recentDaysText,
  };

  const userPrompt = buildPass1SkeletonPrompt(skeletonCtx);

  // System instruction: stesso contratto del legacy (PROMPTS.planGeneration +
  // buildConditionalPrompt). Il modello vede comunque le safety rules.
  const bCtx: BuildContext = {
    profile: ctx.profile,
    hasRunningGoal: ctx.goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(ctx.profile),
    zones: ctx.zones ?? undefined,
    macroContext: ctx.macroContext ?? undefined,
  };
  const systemInstruction = PROMPTS.planGeneration({ age: ctx.profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint: "(vedi PASS1_SCHEMA_HINT nel userPrompt)",
    maxTokens: 1500,
  });

  const parsed = skeletonPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`[passOrchestrator] Pass-1 Zod parse failed: ${parsed.error.message}`);
  }

  const weeks: PlanWeek[] = parsed.data.weeks.map(w => ({
    weekNumber: w.weekNumber,
    focus: w.focus,
    sessions: w.sessions.map(s => ({
      day: s.day,
      type: s.type,
      subtype: s.subtype,
      duration_min: s.duration_min,
      // details/rationale verranno popolati da Pass-2 o riempiti con focus.
      details: s.focus ?? "",
      rationale: s.focus ?? "",
      zone: s.zone as PlannedSession["zone"],
    })),
  }));

  const startDate = computeStartDateForMode(ctx.mode, ctx.currentPlan);
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    startDate,
    profileHash: planStateHash(ctx.profile, ctx.goals),
    weeks,
    rationale: parsed.data.rationale,
  };
}

function computeStartDateForMode(mode: OrchestratorContext["mode"], currentPlan?: TrainingPlan | null): string {
  const now = new Date();
  if (mode === "adapt" && currentPlan?.startDate) return currentPlan.startDate;
  if (mode === "regen") {
    // Per regen "next-week" → lunedi' prossimo. Per regen "rest-of-week" →
    // lunedi' corrente. Il caller (planGenerator) puo' override startDate
    // dopo la chiamata se necessario; default qui = lunedi' della week corrente.
    return computePlanStartDate(now);
  }
  return computePlanStartDate(now);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass-2 implementation.
// ─────────────────────────────────────────────────────────────────────────────

interface Pass2Result {
  plan: TrainingPlan;
  warnings: string[];
  detailedCount: number;
  eligibleCount: number;
}

/**
 * Itera le sessioni del Pass-1 e arricchisce quelle che lo richiedono.
 * - forza_gambe / forza_upper → Pass-2 strength.
 * - corsa con zone >= 4 → Pass-2 cardio (intervalli strutturati).
 * - corsa con zone <= 3 → no Pass-2 (skeleton + details testuale sufficiente).
 * - sport / mobilita → no Pass-2 (skeleton sufficiente).
 */
async function runPass2(
  skeletonPlan: TrainingPlan,
  ctx: OrchestratorContext,
): Promise<Pass2Result> {
  const warnings: string[] = [];
  let detailedCount = 0;
  let eligibleCount = 0;

  // Carichiamo lo storico forza una volta sola: workouts forza ultimi 30gg.
  const recentStrengthHistory = extractStrengthHistory(ctx.recentDays);
  const oneRepMaxes = ctx.profile.oneRepMaxes ?? [];
  const equipment = ctx.profile.equipment ?? ["bodyweight"];

  const newWeeks: PlanWeek[] = [];
  for (const week of skeletonPlan.weeks) {
    const newSessions: PlannedSession[] = [];
    for (const session of week.sessions) {
      const needsStrengthPass2 = isStrengthSession(session);
      const needsCardioPass2 = isHighIntensityCardioSession(session);

      if (needsStrengthPass2) {
        eligibleCount++;
        try {
          const enriched = await detailStrengthSession(session, ctx, recentStrengthHistory, oneRepMaxes, equipment);
          newSessions.push(enriched);
          detailedCount++;
        } catch (e) {
          warnings.push(`Pass-2 strength fallito per ${session.day}/${session.subtype ?? session.type}: ${(e as Error).message}`);
          newSessions.push(session);
        }
      } else if (needsCardioPass2) {
        eligibleCount++;
        try {
          const enriched = await detailCardioSession(session, ctx);
          newSessions.push(enriched);
          detailedCount++;
        } catch (e) {
          warnings.push(`Pass-2 cardio fallito per ${session.day}/${session.subtype ?? session.type}: ${(e as Error).message}`);
          newSessions.push(session);
        }
      } else {
        newSessions.push(session);
      }
    }
    newWeeks.push({ ...week, sessions: newSessions });
  }

  return {
    plan: { ...skeletonPlan, weeks: newWeeks },
    warnings,
    detailedCount,
    eligibleCount,
  };
}

function isStrengthSession(s: PlannedSession): boolean {
  return s.type === "forza_gambe" || s.type === "forza_upper";
}

function isHighIntensityCardioSession(s: PlannedSession): boolean {
  return (s.type === "corsa" || s.type === "sport") && (s.zone === 4 || s.zone === 5);
}

/**
 * Estrae i workout forza dagli ultimi N giorni (filtrando per type).
 * Riformatta nella shape attesa da StrengthSessionContext.recentStrengthHistory.
 */
function extractStrengthHistory(
  recentDays: OrchestratorContext["recentDays"],
): Workout[] {
  const out: Workout[] = [];
  for (const d of recentDays) {
    for (const w of d.workouts || []) {
      const ww = w as Workout;
      if (ww.type === "forza_gambe" || ww.type === "forza_upper") {
        out.push(ww);
      }
    }
  }
  return out;
}

async function detailStrengthSession(
  session: PlannedSession,
  ctx: OrchestratorContext,
  recentStrengthHistory: Workout[],
  oneRepMaxes: OneRepMax[],
  equipment: string[],
): Promise<PlannedSession> {
  const userPrompt = buildStrengthPassPrompt({
    profile: ctx.profile,
    session: {
      type: session.type,
      day: session.day,
      duration_min: session.duration_min,
      subtype: session.subtype,
      macroPhase: ctx.macroContext?.phase,
    },
    recentStrengthHistory,
    ragContextStrength: "", // RAG retrieval cablato in Wave 4.2.
    oneRepMaxes,
    equipment,
  });

  // System instruction minimo per Pass-2: il prompt user e' gia' self-contained
  // con regole + few-shot. Iniettiamo solo la persona PT pro.
  const systemInstruction = "Sei un Personal Trainer professionista. Output: SOLO JSON conforme allo SCHEMA OUTPUT, niente altro testo.";

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    maxTokens: 1000,
  });

  const parsed = strengthPass2Schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Pass-2 strength Zod parse: ${parsed.error.message}`);
  }

  const exercises: PlannedExercise[] = parsed.data.exercises.map(e => ({
    exerciseId: e.exerciseId,
    plannedSets: e.plannedSets,
    repsTarget: e.repsTarget,
    weight_kg: e.weight_kg,
    pct1RM: e.pct1RM,
    rpe_target: e.rpe_target,
    rir_target: e.rir_target,
    rest_sec: e.rest_sec,
    cue: e.cue,
  }));

  return {
    ...session,
    exercises,
    details: parsed.data.details ?? session.details,
    rationale: parsed.data.rationale ?? session.rationale,
    warmupRoutineId: parsed.data.warmupRoutineId ?? session.warmupRoutineId,
    cooldownRoutineId: parsed.data.cooldownRoutineId ?? session.cooldownRoutineId,
    progressionRule: parsed.data.progressionRule ?? session.progressionRule,
    macroPhase: ctx.macroContext?.phase,
  };
}

async function detailCardioSession(
  session: PlannedSession,
  ctx: OrchestratorContext,
): Promise<PlannedSession> {
  const userPrompt = buildCardioIntervalPrompt({
    profile: ctx.profile,
    session: {
      type: session.type,
      day: session.day,
      duration_min: session.duration_min,
      subtype: session.subtype,
      zone: session.zone,
    },
    zones: ctx.zones,
    sessionFocus: session.details, // dal Pass-1 abbiamo messo focus in details.
  });

  const systemInstruction = "Sei un coach di endurance running. Output: SOLO JSON conforme allo SCHEMA OUTPUT, niente altro testo.";

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    maxTokens: 800,
  });

  const parsed = cardioPass2Schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Pass-2 cardio Zod parse: ${parsed.error.message}`);
  }

  const intervals: CardioInterval[] = parsed.data.intervals.map(i => ({
    kind: i.kind,
    duration_min: i.duration_min,
    distance_km: i.distance_km,
    zone: i.zone as CardioInterval["zone"],
    reps: i.reps,
    recovery_sec: i.recovery_sec,
    cue: i.cue,
  }));

  return {
    ...session,
    intervals,
    details: parsed.data.details ?? session.details,
    rationale: parsed.data.rationale ?? session.rationale,
    warmupRoutineId: parsed.data.warmupRoutineId ?? session.warmupRoutineId,
    cooldownRoutineId: parsed.data.cooldownRoutineId ?? session.cooldownRoutineId,
    progressionRule: parsed.data.progressionRule ?? session.progressionRule,
    macroPhase: ctx.macroContext?.phase,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass-3 implementation (deterministic).
// ─────────────────────────────────────────────────────────────────────────────

function runPass3(
  plan: TrainingPlan,
  ctx: OrchestratorContext,
  opts: OrchestratorOptions,
): PlanValidationResult {
  // Riformatta recentDays nella shape attesa dal validator (mirror del
  // flattenWorkoutsForValidator del planGenerator legacy).
  const flattened = ctx.recentDays.flatMap(d =>
    (d.workouts || []).map(w => ({
      type: (w as Workout).type,
      fields: (w as Workout).fields as { tipo?: string; durata_totale?: number | string; durata?: number | string } | undefined,
      date: d.date,
    })),
  );

  return validatePlan(plan, ctx.profile, flattened, {
    expectedDayLabels: opts.expectedDayLabels,
    readiness: ctx.readiness,
  });
}

