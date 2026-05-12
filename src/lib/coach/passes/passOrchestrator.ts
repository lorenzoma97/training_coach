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
import {
  retrieveRelevantChunks,
  chunksAsPromptBlock,
  contextsForPass,
} from "../../knowledge";

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag — backward compat (default true).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toggle multi-pass. DISATTIVATO temporaneamente dopo regressione live
 * (commit 752c9d0+): Pass-1 skeleton schema Zod stretto vs Gemini Flash output
 * variabile → "JSON malformato" su rigenerazione piano. Single-pass legacy
 * funziona bene da Wave 2.x. Riabilitare quando lo schema Pass-1 è più
 * tollerante a campi extra/case (es. passthrough .partial() o .passthrough()).
 */
export const MULTI_PASS_ENABLED = false;

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
  /**
   * Token stimati (heuristic: ceil((prompt.length + response.length) / 4)).
   * NON è una misura precisa del provider — è una stima coarse-grained
   * utile per telemetria/budget tracking. Wave 4.1 OQ4.1.2.
   */
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
  /**
   * Wave 4.1 OQ4.1.4 (FACOLTATIVO).
   * Se true E ci sono issue di severity="error" non-fixate da correctedPlan,
   * Pass-3 emette UN'ulteriore chiamata LLM per "riparare" il piano.
   * Default false: nessun costo aggiuntivo. Attivare solo per generazioni
   * "critiche" (es. piano iniziale) dove vogliamo ridurre warning residui.
   */
  enablePass3Repair?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers locali — token estimation + bounded-concurrency Promise.allSettled.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stima coarse-grained dei token consumati da una call LLM.
 * Heuristic: ~4 caratteri per token (media inglese/italiano).
 * NON è precisa: serve solo per telemetria + budget tracking, non per billing.
 * Wave 4.1 OQ4.1.2.
 */
function estimateTokens(prompt: string, response: string): number {
  return Math.ceil((prompt.length + response.length) / 4);
}

/**
 * Promise.allSettled con concurrency cap (no nuova dipendenza).
 * Usata per Pass-2: parallelizza le call LLM con tetto 3 (Gemini free tier
 * 15 req/min — 3 concurrent + ~5s per call = ~36 req/min nel worst-case da
 * orchestrator + chat + embedding altrove → resta sotto soglia).
 * Wave 4.1 OQ4.1.3.
 */
async function pAllSettled<T>(
  tasks: Array<() => Promise<T>>,
  opts: { concurrency: number },
): Promise<PromiseSettledResult<T>[]> {
  const { concurrency } = opts;
  if (concurrency <= 0) throw new Error("pAllSettled: concurrency must be > 0");

  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= tasks.length) return;
      try {
        const value = await tasks[idx]();
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
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
  const pass1Result = await runPass1(ctx, opts);
  const skeletonPlan = pass1Result.plan;
  passLogs.push({
    pass: 1,
    ts: new Date().toISOString(),
    durationMs: Date.now() - t1Start,
    tokens: pass1Result.tokens,
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
      tokens: pass2Result.tokens,
      issues: pass2Result.warnings,
      note: `${pass2Result.detailedCount}/${pass2Result.eligibleCount} sessioni dettagliate`,
    });
  }

  // ───────────────────────────── Pass-3 ─────────────────────────────
  const t3Start = Date.now();
  const validation = runPass3(detailedPlan, ctx, opts);
  // Marker generationMode="multi" su nuovo oggetto (no mutation del validator output).
  let finalPlan: TrainingPlan = { ...validation.correctedPlan, generationMode: "multi" };
  let pass3Tokens: number | undefined;
  let repairNote = "";

  // Issue residue di severity="error" (non risolte dal correctedPlan deterministico).
  const errorIssues = validation.ok
    ? []
    : validation.issues.filter(i => i.severity === "error");

  // Wave 4.1 OQ4.1.4 — branch FACOLTATIVO di LLM-repair.
  // Default: append warning al rationale (no extra LLM call).
  // Se enablePass3Repair=true E ci sono errorIssues → 1 chiamata LLM di repair.
  if (errorIssues.length > 0) {
    if (opts.enablePass3Repair) {
      try {
        const repairOut = await repairPlanLLM(
          finalPlan,
          errorIssues.map(i => i.message),
        );
        finalPlan = { ...repairOut.plan, generationMode: "multi" };
        pass3Tokens = repairOut.tokens;
        repairNote = " (repair LLM: applied)";
      } catch (e) {
        // Repair fallisce → fallback al comportamento di default (warning).
        finalPlan = {
          ...finalPlan,
          rationale: finalPlan.rationale +
            "\n\n[Validator] Avvertenze residue: " + errorIssues.map(i => i.message).join(" | "),
        };
        repairNote = ` (repair LLM fallito: ${(e as Error).message})`;
      }
    } else {
      finalPlan = {
        ...finalPlan,
        rationale: finalPlan.rationale +
          "\n\n[Validator] Avvertenze residue: " + errorIssues.map(i => i.message).join(" | "),
      };
    }
  }

  passLogs.push({
    pass: 3,
    ts: new Date().toISOString(),
    durationMs: Date.now() - t3Start,
    tokens: pass3Tokens,
    issues: validation.issues.map(i => `${i.type}:${i.severity}`),
    // Il count "warning" esclude di proposito le issue "info" (Wave 3.5+:
    // equipment_substituted è info-level, segnalazione neutra → non rumore di log).
    note: (validation.ok ? "ok" : `${validation.issues.filter(i => i.severity === "error").length} errori, ${validation.issues.filter(i => i.severity === "warn").length} warning`) + repairNote,
  });

  return { plan: finalPlan, passLogs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass-1 implementation.
// ─────────────────────────────────────────────────────────────────────────────

/** Risultato Pass-1: plan + tokens stimati (OQ4.1.2). */
interface Pass1Result {
  plan: TrainingPlan;
  tokens: number;
}

async function runPass1(
  ctx: OrchestratorContext,
  opts: OrchestratorOptions,
): Promise<Pass1Result> {
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

  // Stima tokens: prompt completo (system + user) + JSON response serializzato.
  const fullPrompt = systemInstruction + "\n" + userPrompt;
  const responseStr = JSON.stringify(raw);
  const tokens = estimateTokens(fullPrompt, responseStr);

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
    plan: {
      generatedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
      startDate,
      profileHash: planStateHash(ctx.profile, ctx.goals),
      weeks,
      rationale: parsed.data.rationale,
    },
    tokens,
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
  /** Somma tokens stimati per tutte le call Pass-2. */
  tokens: number;
}

/** Risultato di una singola call Pass-2 (strength o cardio). */
interface SessionEnrichmentResult {
  enriched: PlannedSession;
  tokens: number;
}

/**
 * Wave 4.1 OQ4.1.3 — concurrency cap per le call LLM Pass-2.
 * Gemini free tier = 15 req/min. Cap 3 lascia spazio a chat/embeddings paralleli.
 */
const PASS2_CONCURRENCY = 3;

/**
 * Itera le sessioni del Pass-1 e arricchisce quelle che lo richiedono.
 * - forza_gambe / forza_upper → Pass-2 strength.
 * - corsa con zone >= 4 → Pass-2 cardio (intervalli strutturati).
 * - corsa con zone <= 3 → no Pass-2 (skeleton + details testuale sufficiente).
 * - sport / mobilita → no Pass-2 (skeleton sufficiente).
 *
 * Wave 4.1 OQ4.1.3 — call eligibili eseguite in parallelo con cap PASS2_CONCURRENCY.
 * L'ordine delle sessioni nella plan finale resta deterministico (per-week, per-day).
 */
async function runPass2(
  skeletonPlan: TrainingPlan,
  ctx: OrchestratorContext,
): Promise<Pass2Result> {
  const warnings: string[] = [];
  let detailedCount = 0;
  let eligibleCount = 0;
  let totalTokens = 0;

  // Carichiamo lo storico forza una volta sola: workouts forza ultimi 30gg.
  const recentStrengthHistory = extractStrengthHistory(ctx.recentDays);
  const oneRepMaxes = ctx.profile.oneRepMaxes ?? [];
  const equipment = ctx.profile.equipment ?? ["bodyweight"];

  // Step 1: enumera i task LLM (uno per sessione eligibile) con coordinate (w,s)
  // → poi flat-parallel con pAllSettled, infine ricostruisci la plan preservando l'ordine.
  type Task = {
    weekIdx: number;
    sessionIdx: number;
    kind: "strength" | "cardio";
    sessionLabel: string;
    run: () => Promise<SessionEnrichmentResult>;
  };
  const tasks: Task[] = [];

  skeletonPlan.weeks.forEach((week, wi) => {
    week.sessions.forEach((session, si) => {
      const label = `${session.day}/${session.subtype ?? session.type}`;
      if (isStrengthSession(session)) {
        eligibleCount++;
        tasks.push({
          weekIdx: wi,
          sessionIdx: si,
          kind: "strength",
          sessionLabel: label,
          run: () => detailStrengthSession(session, ctx, recentStrengthHistory, oneRepMaxes, equipment),
        });
      } else if (isHighIntensityCardioSession(session)) {
        eligibleCount++;
        tasks.push({
          weekIdx: wi,
          sessionIdx: si,
          kind: "cardio",
          sessionLabel: label,
          run: () => detailCardioSession(session, ctx),
        });
      }
    });
  });

  // Step 2: parallel execution con concurrency cap.
  const settled = await pAllSettled(
    tasks.map(t => t.run),
    { concurrency: PASS2_CONCURRENCY },
  );

  // Step 3: indicizza i risultati per coordinate (w,s) per ricostruzione O(1).
  const enrichmentByCoord = new Map<string, SessionEnrichmentResult>();
  settled.forEach((res, i) => {
    const task = tasks[i];
    if (res.status === "fulfilled") {
      enrichmentByCoord.set(`${task.weekIdx}:${task.sessionIdx}`, res.value);
      totalTokens += res.value.tokens;
      detailedCount++;
    } else {
      const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
      warnings.push(`Pass-2 ${task.kind} fallito per ${task.sessionLabel}: ${reason}`);
    }
  });

  // Step 4: ricostruzione plan con sessioni arricchite/originali (ordine preservato).
  const newWeeks: PlanWeek[] = skeletonPlan.weeks.map((week, wi) => ({
    ...week,
    sessions: week.sessions.map((session, si) => {
      const hit = enrichmentByCoord.get(`${wi}:${si}`);
      return hit ? hit.enriched : session;
    }),
  }));

  return {
    plan: { ...skeletonPlan, weeks: newWeeks },
    warnings,
    detailedCount,
    eligibleCount,
    tokens: totalTokens,
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
): Promise<SessionEnrichmentResult> {
  // Wave 4.1 OQ4.1.1 — RAG wiring per Pass-2 strength.
  // Query: combine subtype + macroPhase per orientare il retrieval su
  // chunks `strength_db` + `macro_periodization`.
  const ragQuery = [session.subtype, ctx.macroContext?.phase].filter(Boolean).join(" ").trim();
  let ragContextStrength = "";
  if (ragQuery) {
    try {
      const chunks = await retrieveRelevantChunks({
        query: ragQuery,
        contexts: contextsForPass("pass2_strength"),
        topK: 3,
      });
      ragContextStrength = chunksAsPromptBlock(chunks);
    } catch (e) {
      // Retrieval failure is non-fatal: il prompt funziona senza RAG, accetta il fallback.
      console.warn(`[passOrchestrator] RAG retrieval (strength) failed: ${(e as Error).message}`);
    }
  }

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
    ragContextStrength,
    oneRepMaxes,
    equipment,
    // Wave 4.1 OQ4.1.5 — focus handover Pass-1 → Pass-2.
    // Pass-1 ha popolato session.details con il `focus` dello skeleton LLM.
    sessionFocus: session.details,
  });

  // System instruction minimo per Pass-2: il prompt user e' gia' self-contained
  // con regole + few-shot. Iniettiamo solo la persona PT pro.
  const systemInstruction = "Sei un Personal Trainer professionista. Output: SOLO JSON conforme allo SCHEMA OUTPUT, niente altro testo.";

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    maxTokens: 1000,
  });

  const responseStr = JSON.stringify(raw);
  const tokens = estimateTokens(systemInstruction + "\n" + userPrompt, responseStr);

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

  const enriched: PlannedSession = {
    ...session,
    exercises,
    details: parsed.data.details ?? session.details,
    rationale: parsed.data.rationale ?? session.rationale,
    warmupRoutineId: parsed.data.warmupRoutineId ?? session.warmupRoutineId,
    cooldownRoutineId: parsed.data.cooldownRoutineId ?? session.cooldownRoutineId,
    progressionRule: parsed.data.progressionRule ?? session.progressionRule,
    macroPhase: ctx.macroContext?.phase,
  };

  return { enriched, tokens };
}

async function detailCardioSession(
  session: PlannedSession,
  ctx: OrchestratorContext,
): Promise<SessionEnrichmentResult> {
  // Wave 4.1 OQ4.1.1 — RAG wiring per Pass-2 cardio.
  // Query: combine subtype + macroPhase per orientare il retrieval su
  // chunks `cardio_intervals` + `macro_periodization`.
  const ragQuery = [session.subtype, ctx.macroContext?.phase].filter(Boolean).join(" ").trim();
  let ragContextCardio = "";
  if (ragQuery) {
    try {
      const chunks = await retrieveRelevantChunks({
        query: ragQuery,
        contexts: contextsForPass("pass2_cardio"),
        topK: 3,
      });
      ragContextCardio = chunksAsPromptBlock(chunks);
    } catch (e) {
      console.warn(`[passOrchestrator] RAG retrieval (cardio) failed: ${(e as Error).message}`);
    }
  }

  // sessionFocus (Pass-1 → Pass-2) include sia il focus testuale che, se RAG ha
  // prodotto chunks, una guida scientifica appendata. Il prompt builder cardio
  // attualmente NON espone un campo separato per RAG → lo iniettiamo dentro
  // sessionFocus separato da newline. Backward-compat: se ragContextCardio è
  // vuoto, sessionFocus resta solo session.details.
  const sessionFocusWithRag = ragContextCardio
    ? `${session.details ?? ""}\n\n${ragContextCardio}`.trim()
    : session.details;

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
    sessionFocus: sessionFocusWithRag,
  });

  const systemInstruction = "Sei un coach di endurance running. Output: SOLO JSON conforme allo SCHEMA OUTPUT, niente altro testo.";

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    maxTokens: 800,
  });

  const responseStr = JSON.stringify(raw);
  const tokens = estimateTokens(systemInstruction + "\n" + userPrompt, responseStr);

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

  const enriched: PlannedSession = {
    ...session,
    intervals,
    details: parsed.data.details ?? session.details,
    rationale: parsed.data.rationale ?? session.rationale,
    warmupRoutineId: parsed.data.warmupRoutineId ?? session.warmupRoutineId,
    cooldownRoutineId: parsed.data.cooldownRoutineId ?? session.cooldownRoutineId,
    progressionRule: parsed.data.progressionRule ?? session.progressionRule,
    macroPhase: ctx.macroContext?.phase,
  };

  return { enriched, tokens };
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

// ─────────────────────────────────────────────────────────────────────────────
// Pass-3 LLM-repair (Wave 4.1 OQ4.1.4 — FACOLTATIVO, opt-in via
// OrchestratorOptions.enablePass3Repair=true).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema Zod minimo per l'output del repair: ci aspettiamo lo stesso TrainingPlan
 * di input, ma con `weeks` aggiornate. Validazione lasciata leggera — l'LLM riceve
 * il plan attuale come anchor e deve modificare SOLO i punti necessari.
 *
 * Nota: NON ri-validiamo deeply lo shape PlannedSession qui (il caller fa
 * comunque trust ridotto sul repair). Se il parse fallisce, il caller cade in
 * fallback warning come se enablePass3Repair=false.
 */
const repairResponseSchema = z.object({
  weeks: z.array(z.object({
    weekNumber: z.number().int().min(1),
    focus: z.string(),
    sessions: z.array(z.any()),
  })).min(1),
  rationale: z.string().optional(),
});

/** Risultato repair: plan corretto + tokens stimati. */
interface RepairResult {
  plan: TrainingPlan;
  tokens: number;
}

/**
 * Pass-3 repair: chiama UNA volta l'LLM con il piano corrente + lista issue
 * `error` non-fixate. Output atteso: stesso shape TrainingPlan ma con le
 * sessioni problematiche riparate.
 *
 * Token budget: ~1500-2500 token (prompt + response). Costo accettabile solo
 * per generazioni "critiche" (initial). Attivare via opts.enablePass3Repair.
 *
 * Se il repair fallisce (LLM error / Zod parse / safety rejection), il caller
 * deve fare fallback al comportamento di default (append warning al rationale).
 */
async function repairPlanLLM(
  plan: TrainingPlan,
  errorIssues: string[],
): Promise<RepairResult> {
  const issuesBlock = errorIssues.map((msg, i) => `${i + 1}. ${msg}`).join("\n");
  const planJson = JSON.stringify({ weeks: plan.weeks, rationale: plan.rationale }, null, 2);

  const userPrompt = [
    "TASK: ripara il TrainingPlan seguente in modo che soddisfi i vincoli elencati.",
    "Modifica SOLO i campi strettamente necessari per chiudere ogni issue.",
    "NON cambiare giorni, durata, type/subtype delle sessioni — agisci su exercises/intervals/zone/rest_sec.",
    "",
    "ISSUE DA RISOLVERE (severity=error, non risolte dal validator deterministico):",
    issuesBlock,
    "",
    "PLAN ATTUALE (JSON):",
    planJson,
    "",
    "OUTPUT: un singolo JSON con shape { weeks, rationale } — niente markdown, niente commenti.",
    "Aggiungi 1-2 frasi nel rationale per spiegare cosa hai modificato.",
  ].join("\n");

  const systemInstruction =
    "Sei un Personal Trainer professionista che ripara piani di allenamento. " +
    "Output: SOLO JSON conforme allo shape richiesto, niente altro testo.";

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    maxTokens: 2000,
  });

  const responseStr = JSON.stringify(raw);
  const tokens = estimateTokens(systemInstruction + "\n" + userPrompt, responseStr);

  const parsed = repairResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Pass-3 repair Zod parse: ${parsed.error.message}`);
  }

  // Trust ridotto sul payload `sessions` (z.any): non rivalidiamo shape granulare
  // qui — l'orchestrator si fida che l'LLM rispetti la shape. Eventuali shape
  // residui verranno catturati alla successiva persistenza del plan (zod schema
  // alto-livello già esistente nel plan validator).
  const repairedPlan: TrainingPlan = {
    ...plan,
    weeks: parsed.data.weeks as PlanWeek[],
    rationale: parsed.data.rationale ?? plan.rationale,
  };

  return { plan: repairedPlan, tokens };
}

