// Strength engine validators (Wave 3.1 — ARCHITECTURE.md §3.3, §4 Wave 3.1).
// Pure functions, no side effects, performance target <100ms su piano realistic.
//
// Riferimenti scientifici (citati nei message):
//   - Schoenfeld B. et al. (2017) "Dose-response relationship between weekly
//     resistance training volume and increases in muscle mass". J Sports Sci.
//     → soglia progressione settimanale conservativa: incremento carico ≤+10%
//       settimana-su-settimana per intermedi/avanzati. Salti >+10% sono
//       associati a stallo neuromuscolare e rischio infortunio.
//   - Ratamess N. et al. (ACSM 2009) "Progression Models in Resistance Training".
//     Med Sci Sports Exerc. → tabella canonica %1RM ↔ rep range:
//         >90% 1RM → 1-3 reps (forza max)
//         85-90%   → 3-5 reps (forza)
//         70-85%   → 6-12 reps (ipertrofia)
//         60-70%   → 8-15 reps (resistenza muscolare/ipertrofia bassa intensità)
//         <60%     → 12-25 reps (resistenza)
//
// Severity discipline: WARN (mai error). I validator forza non bloccano il
// piano — segnalano deviazioni da raccomandazioni standard. L'utente decide.

import type {
  TrainingPlan,
  PlannedExercise,
  PlannedSession,
  EquipmentTag,
} from "../../types";
import type {
  PlanValidator,
  PlanValidationIssue,
  RecentWorkoutForValidator,
} from "../planValidator";
import { EXERCISES, EXERCISES_BY_ID } from "../../catalog/exercises";
import { normalizeEquipmentTags } from "../../equipment/equipmentNormalizer";
import { resolveSubstitution } from "../equipmentSubstitutor";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/** Soglia massima incremento settimanale carico (Schoenfeld 2017). */
const PROGRESSION_CAP = 1.10;
/** Finestra di lookback storica per il confronto carichi (giorni). */
const RECENT_WINDOW_DAYS = 30;

/**
 * Estrae il MAX `weight_kg` registrato per un dato `exerciseId` negli ultimi
 * 30gg. Ritorna null se non c'è storia (cold start) — il validator skippa
 * silently per evitare warn spuri ai nuovi utenti.
 *
 * Filtri:
 *   - workout senza `exercises[]` → skip (legacy v1 in `fields.note`,
 *     parser regex out-of-scope per Wave 3.1).
 *   - data assente o > RECENT_WINDOW_DAYS giorni fa → skip.
 *   - set senza `weight_kg` → skip (bodyweight: non comparabile a kg loaded).
 */
function maxRecentLoad(
  recentWorkouts: RecentWorkoutForValidator[],
  exerciseId: string,
  todayISO: string,
): number | null {
  const cutoff = new Date(todayISO);
  cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  let max: number | null = null;
  for (const w of recentWorkouts) {
    if (!w.exercises || w.exercises.length === 0) continue;
    if (w.date && w.date < cutoffISO) continue;
    for (const perf of w.exercises) {
      if (perf.exerciseId !== exerciseId) continue;
      for (const set of perf.sets) {
        if (typeof set.weight_kg !== "number" || !Number.isFinite(set.weight_kg)) continue;
        if (set.weight_kg <= 0) continue;
        if (max === null || set.weight_kg > max) max = set.weight_kg;
      }
    }
  }
  return max;
}

/** Itera tutti i `(weekNumber, session, exercise)` di un piano. */
function* iterPlannedExercises(
  plan: TrainingPlan,
): Generator<{ weekNumber: number; session: PlannedSession; ex: PlannedExercise }> {
  for (const week of plan.weeks) {
    for (const session of week.sessions) {
      const exs = session.exercises;
      if (!exs || exs.length === 0) continue;
      for (const ex of exs) {
        yield { weekNumber: week.weekNumber, session, ex };
      }
    }
  }
}

/**
 * Range reps standard atteso per un dato pct1RM (Ratamess ACSM 2009).
 * Ritorna l'intervallo `[minReps, maxReps]` ammesso. La funzione è inclusiva
 * sui boundary ufficiali (es. 85% → bucket "forza" 3-5 reps, NON ipertrofia).
 */
function expectedRepRangeForPct1RM(pct: number): { min: number; max: number; label: string } {
  if (pct > 90) return { min: 1, max: 3, label: "1-3 reps (forza max)" };
  if (pct >= 85) return { min: 3, max: 5, label: "3-5 reps (forza)" };
  if (pct >= 70) return { min: 6, max: 12, label: "6-12 reps (ipertrofia)" };
  if (pct >= 60) return { min: 8, max: 15, label: "8-15 reps (ipertrofia/resistenza)" };
  return { min: 12, max: 25, label: "12-25 reps (resistenza muscolare)" };
}

// ────────────────────────────────────────────────────────────────────────────
// B.1 validateStrengthLoadProgression
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifica che ogni `PlannedExercise.weight_kg` non superi del +10% il MAX
 * carico registrato negli ultimi 30gg per lo stesso `exerciseId`. Se sì →
 * issue severity WARN.
 *
 * Skip silently (no warn) quando:
 *   - `recentWorkouts` non contiene `exercises[]` strutturati per l'esercizio
 *     (cold start o utente legacy con solo `fields.note`).
 *   - `planned.weight_kg` è undefined (sessione su rpe_target/pct1RM, gestita
 *     da validatePct1rmRepsCoherence).
 *   - storia >30gg vecchia (assume detraining → l'utente può dover ripartire
 *     da zero, +10% non è più la metrica giusta).
 *
 * Razionale (Schoenfeld 2017): incrementi >+10% settimanali su lift principali
 * non sono sostenibili oltre i primi mesi (newbie gains finiti). Per
 * intermedi/avanzati, la progressione realistica è 2.5-5% per microciclo.
 */
export const validateStrengthLoadProgression: PlanValidator = (
  plan,
  ctx,
): PlanValidationIssue[] => {
  const issues: PlanValidationIssue[] = [];
  const todayISO = new Date().toISOString().slice(0, 10);

  for (const { weekNumber, ex } of iterPlannedExercises(plan)) {
    if (typeof ex.weight_kg !== "number" || !Number.isFinite(ex.weight_kg)) continue;
    if (ex.weight_kg <= 0) continue;

    const max = maxRecentLoad(ctx.recentWorkouts, ex.exerciseId, todayISO);
    if (max === null) continue; // cold start: no warn

    const cap = max * PROGRESSION_CAP;
    if (ex.weight_kg > cap) {
      const pct = Math.round(((ex.weight_kg - max) / max) * 100);
      issues.push({
        weekNumber,
        type: "strength_load_progression",
        category: "strength_load_progression",
        message: `Settimana ${weekNumber}: aumento carico ${ex.exerciseId} ${ex.weight_kg}kg vs max recent ${max}kg (+${pct}%, oltre la progressione raccomandata Schoenfeld 2017 +10%/settimana).`,
        severity: "warn",
      });
    }
  }
  return issues;
};

// ────────────────────────────────────────────────────────────────────────────
// B.2 validatePct1rmRepsCoherence
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifica che `repsTarget` matchi il rep range standard del `pct1RM` dato
 * (Ratamess ACSM 2009). Logica: se l'intervallo richiesto
 * `[repsTarget.min, repsTarget.max]` non interseca il bucket atteso per
 * `pct1RM`, → issue severity WARN.
 *
 * Esempi (matrice Ratamess):
 *   pct1RM=90, reps 5-5 → OK (bucket forza 3-5)
 *   pct1RM=90, reps 8-8 → ISSUE (bucket forza max 5 reps)
 *   pct1RM=75, reps 8-10 → OK (bucket ipertrofia 6-12)
 *   pct1RM=50, reps 5-5 → ISSUE (bucket resistenza 12-25 reps)
 *
 * Skip silently quando:
 *   - `pct1RM` undefined (sessione su rpe_target/weight_kg only).
 *   - `repsTarget` malformato (validato altrove dallo Zod schema Pass-2).
 */
export const validatePct1rmRepsCoherence: PlanValidator = (
  plan,
  _ctx,
): PlanValidationIssue[] => {
  const issues: PlanValidationIssue[] = [];

  for (const { weekNumber, ex } of iterPlannedExercises(plan)) {
    if (typeof ex.pct1RM !== "number" || !Number.isFinite(ex.pct1RM)) continue;
    if (ex.pct1RM <= 0 || ex.pct1RM > 100) continue;
    if (!ex.repsTarget) continue;
    const { min, max } = ex.repsTarget;
    if (typeof min !== "number" || typeof max !== "number") continue;
    if (min <= 0 || max <= 0 || min > max) continue;

    const expected = expectedRepRangeForPct1RM(ex.pct1RM);
    // OK se il range richiesto interseca il bucket atteso.
    const overlaps = !(max < expected.min || min > expected.max);
    if (!overlaps) {
      issues.push({
        weekNumber,
        type: "pct1rm_reps_mismatch",
        category: "pct1rm_reps_mismatch",
        message: `Settimana ${weekNumber}: ${ex.exerciseId} ${ex.pct1RM}% 1RM con ${min}-${max} reps è fuori range standard (atteso ${expected.label}, Ratamess ACSM 2009).`,
        severity: "warn",
      });
    }
  }
  return issues;
};

// Esportazione opzionale per testing isolato dell'helper di range.
export { expectedRepRangeForPct1RM };

// ────────────────────────────────────────────────────────────────────────────
// B.3 validateEquipmentMismatch (Wave 3.5, G8)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per ogni sessione strength* della week 1, verifica che ogni
 * `PlannedExercise.exerciseId` sia eseguibile con `profile.equipment`.
 *
 * Logica:
 * - Normalizza profile.equipment via normalizeEquipmentTags (free-text IT → canonical).
 * - Per ogni esercizio chiama resolveSubstitution.
 * - Se null (unresolved) → issue "equipment_mismatch" (warn): nessuna alternativa.
 * - Se hop > 0 → issue "equipment_substituted" (info): alt trovata, render-time
 *   mostrerà SubstitutionBadge. NON è un problema, solo una segnalazione neutra.
 * - hop === 0 → no issue (utente ha l'equipment richiesto).
 *
 * NON muta il plan — solo issues. La sostituzione effettiva avviene render-time
 * (PlannedExercise.effectiveExerciseId) o in Pass-2 prompt che istruisce l'LLM
 * a scegliere il primo alternative disponibile.
 *
 * Scope: solo week 1 (settimana corrente). Le settimane successive 2-N hanno
 * sessioni "preview" — l'utente potrebbe acquistare equipment nel frattempo,
 * quindi non ha senso flaggare ora.
 *
 * Scope type: solo type.startsWith("forza") — cardio/mobility non usano
 * exercises[] strutturati di catalog (intervals/blocks invece).
 */
export const validateEquipmentMismatch: PlanValidator = (
  plan,
  ctx,
): PlanValidationIssue[] => {
  const issues: PlanValidationIssue[] = [];
  const week1 = plan.weeks.find(w => w.weekNumber === 1);
  if (!week1) return issues;

  // Normalizzazione free-text IT → canonical EquipmentTag[].
  // bodyweight è sempre incluso da normalizeEquipmentTags.
  const availableEquipment = normalizeEquipmentTags(ctx.profile.equipment) as EquipmentTag[];
  const availableLabel = availableEquipment.length > 0
    ? availableEquipment.join(", ")
    : "(nessuno)";

  for (const session of week1.sessions) {
    const type = (session.type || "").toLowerCase();
    if (!type.startsWith("forza")) continue;
    const exs = session.exercises;
    if (!exs || exs.length === 0) continue;

    for (const ex of exs) {
      const result = resolveSubstitution(ex.exerciseId, availableEquipment, EXERCISES);

      if (result === null) {
        // Unresolved: né l'originale né nessuna alternativa eseguibile.
        const catalogEx = EXERCISES_BY_ID[ex.exerciseId];
        const required = catalogEx
          ? catalogEx.equipment.join(", ")
          : "(esercizio non in catalog)";
        issues.push({
          weekNumber: week1.weekNumber,
          type: "equipment_mismatch",
          category: "equipment_mismatch",
          message: `Settimana ${week1.weekNumber} / ${session.day} ${session.type}: esercizio "${ex.exerciseId}" richiede [${required}] ma l'utente ha [${availableLabel}]; nessuna alternativa eseguibile entro la chain (G8).`,
          severity: "warn",
        });
        continue;
      }

      if (result.hop > 0) {
        // Substitution segnalata (severity "info"): il render-time userà il resolved.
        // Info-level perché l'alt è eseguibile → nessun problema da risolvere, solo
        // trasparenza sul swap (Wave 3.5 Reviewer-deferred minor #1).
        const catalogOriginal = EXERCISES_BY_ID[result.originalId];
        const missingTags = catalogOriginal
          ? catalogOriginal.equipment.filter(
              t => t !== "bodyweight" && !availableEquipment.includes(t),
            )
          : [];
        const missingLabel = missingTags.length > 0
          ? missingTags.join("+")
          : "equipment richiesto";
        issues.push({
          weekNumber: week1.weekNumber,
          type: "equipment_substituted",
          category: "equipment_substituted",
          message: `Settimana ${week1.weekNumber} / ${session.day} ${session.type}: sostituito "${result.originalId}" → "${result.resolvedId}" (no ${missingLabel}, hop ${result.hop}).`,
          severity: "info",
        });
      }
    }
  }

  return issues;
};
