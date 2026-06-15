// Wave 3.1 — One Rep Max Estimator (data-integration-specialist)
//
// Stima e aggiorna i 1RM nel profilo utente a partire dai workout strutturati
// (`Workout.exercises[]`). Pure-functions per le formule e il calcolo;
// side-effects ISOLATI in `applyOneRepMaxUpdates` (l'unico che tocca storage).
//
// Riferimenti:
//  - Brzycki M. JOPERD 1993 — "Strength testing—predicting a one-rep max"
//  - Epley B. 1985 — "Poundage chart" Boyd Epley Workout
//  - ARCHITECTURE.md §2.1 OneRepMax, §6 I4 (oneRepMaxes update policy)
//
// Policy update (I4): "tested" non viene MAI sovrascritto automaticamente.
// "estimated" viene sovrascritto SOLO se nuovo > vecchio + threshold (2kg)
// per evitare jitter da stime variabili sessione-su-sessione.

import { events } from "../events";
import { getJSON, setJSON } from "../storage";
import { todayISO } from "../time";
import type {
  ExercisePerformance,
  OneRepMax,
  UserProfile,
} from "../types";
import type { Workout } from "../diaryContext";

/**
 * Threshold (kg) sopra il quale un nuovo 1RM "estimated" sovrascrive il vecchio
 * "estimated". Sotto questa soglia consideriamo la differenza jitter (la stima
 * Brzycki/Epley ha errore intrinseco di ±2-3kg per reps in range 3-6).
 */
const ESTIMATED_PR_THRESHOLD_KG = 2;

/**
 * Reps massime accettate dalle formule. Sopra le 10 ripetizioni, sia Brzycki
 * sia Epley diventano poco affidabili (errore >10% sul valore reale).
 */
const MAX_REPS_FOR_ESTIMATE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Pure functions: formule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formula Brzycki: 1RM = peso × 36 / (37 - reps).
 * Validità: reps ∈ [1, 10]. Throws fuori range (l'estimator chiama
 * solo dopo aver pre-validato il range).
 */
export function brzycki(weight_kg: number, reps: number): number {
  if (reps < 1 || reps > MAX_REPS_FOR_ESTIMATE || weight_kg <= 0) {
    throw new Error("Brzycki valido per reps 1-10 e weight_kg > 0");
  }
  return (weight_kg * 36) / (37 - reps);
}

/**
 * Formula Epley: 1RM = peso × (1 + reps/30).
 * Più conservativa di Brzycki per reps alte. Throws se reps < 1 o weight <= 0.
 */
export function epley(weight_kg: number, reps: number): number {
  if (reps < 1 || weight_kg <= 0) {
    throw new Error("Epley valido per reps >= 1 e weight_kg > 0");
  }
  return weight_kg * (1 + reps / 30);
}

/**
 * Stima 1RM "consensus" come media aritmetica di Brzycki ed Epley.
 * Ritorna `null` se i parametri sono fuori range (reps > 10, peso ≤ 0,
 * reps < 1) — il caller usa null per skippare il set/esercizio.
 *
 * Edge case reps === 1: ritorna direttamente il peso (è già un 1RM diretto).
 * Arrotonda a 0.5 kg (granularità tipica dei dischi olimpici).
 */
export function estimateOneRepMax(weight_kg: number, reps: number): number | null {
  if (weight_kg <= 0 || reps < 1 || reps > MAX_REPS_FOR_ESTIMATE) return null;
  if (reps === 1) return weight_kg;
  const avg = (brzycki(weight_kg, reps) + epley(weight_kg, reps)) / 2;
  return Math.round(avg * 2) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure functions: estrazione dai workout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trova il "best set" (max 1RM stimato) dentro la performance di un esercizio.
 * Skippa set con `weight_kg` undefined (bodyweight) o reps fuori range.
 *
 * Esempio: 3 set di [80×8, 85×5, 87.5×3]
 *   - 80×8  → est ~99.2
 *   - 85×5  → est ~97.4
 *   - 87.5×3 → est ~94.5
 *   → ritorna 80×8 (estimated1RM più alto, anche se il peso è minore).
 *
 * Ritorna `null` se nessun set è valutabile (tutti bodyweight, o reps>10).
 */
export function bestSetForOneRepMax(
  perf: ExercisePerformance,
): { weight_kg: number; reps: number; estimated1RM: number } | null {
  if (!perf || !Array.isArray(perf.sets) || perf.sets.length === 0) return null;

  let best: { weight_kg: number; reps: number; estimated1RM: number } | null = null;
  for (const s of perf.sets) {
    if (typeof s.weight_kg !== "number" || s.weight_kg <= 0) continue;
    if (typeof s.reps !== "number" || s.reps < 1) continue;
    const est = estimateOneRepMax(s.weight_kg, s.reps);
    if (est === null) continue;
    if (best === null || est > best.estimated1RM) {
      best = { weight_kg: s.weight_kg, reps: s.reps, estimated1RM: est };
    }
  }
  return best;
}

/**
 * Per ogni esercizio nel workout, calcola il 1RM stimato dal best set.
 * Ritorna mappa exerciseId → estimated1RM. Esercizi senza set valutabili
 * (tutti bodyweight, reps>10, ecc.) vengono omessi dalla mappa.
 *
 * Backward-compat: workout senza `exercises[]` → mappa vuota.
 */
export function inferOneRepMaxesFromWorkout(workout: Workout): Map<string, number> {
  const out = new Map<string, number>();
  if (!workout || !Array.isArray(workout.exercises)) return out;
  for (const perf of workout.exercises) {
    if (!perf || typeof perf.exerciseId !== "string" || !perf.exerciseId) continue;
    const best = bestSetForOneRepMax(perf);
    if (best) out.set(perf.exerciseId, best.estimated1RM);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure function: update logic (immutable)
// ─────────────────────────────────────────────────────────────────────────────

export interface OneRepMaxChange {
  exerciseId: string;
  /** Valore precedente (undefined se nuovo entry). */
  from?: number;
  /** Valore nuovo persistito. */
  to: number;
  /** Source del valore nuovo (sempre "estimated" da questo path). */
  source: "tested" | "estimated";
}

/**
 * Aggiorna `current` con i 1RM stimati dal `workout`. Pure-function: ritorna
 * un nuovo array (no mutate) + lista delle modifiche per UI feedback.
 *
 * Policy (I4 ARCHITECTURE.md):
 *  - Esercizio senza 1RM esistente → ADD nuovo "estimated"
 *  - Esercizio con 1RM "tested"    → SKIP (test sul campo è fonte di verità)
 *  - Esercizio con 1RM "estimated" → UPDATE solo se est nuovo > vecchio + 2kg
 *
 * Workout id (`fromWorkoutId`) viene tracciato per audit trail.
 */
export function updateOneRepMaxesFromWorkout(
  current: OneRepMax[],
  workout: Workout,
): { updated: OneRepMax[]; changed: OneRepMaxChange[] } {
  const safeCurrent = Array.isArray(current) ? current : [];
  const inferred = inferOneRepMaxesFromWorkout(workout);
  if (inferred.size === 0) {
    return { updated: safeCurrent, changed: [] };
  }

  // Lavoriamo su una copia mutabile, poi ritorniamo un nuovo array.
  const next = safeCurrent.map(o => ({ ...o }));
  const changed: OneRepMaxChange[] = [];
  const today = todayISO(); // YYYY-MM-DD locale (era UTC slice → off-by-one notturno)
  const workoutId = workout?.id;

  for (const [exerciseId, est1RM] of inferred) {
    const idx = next.findIndex(o => o.exerciseId === exerciseId);
    if (idx < 0) {
      // Nuovo entry: ADD
      next.push({
        exerciseId,
        value_kg: est1RM,
        source: "estimated",
        acquiredAt: today,
        ...(workoutId ? { fromWorkoutId: workoutId } : {}),
      });
      changed.push({ exerciseId, to: est1RM, source: "estimated" });
      continue;
    }

    const existing = next[idx];
    if (existing.source === "tested") {
      // I4: tested mai sovrascritto da estimated. SKIP silente.
      continue;
    }
    // existing.source === "estimated": update solo se è un PR significativo.
    if (est1RM > existing.value_kg + ESTIMATED_PR_THRESHOLD_KG) {
      const from = existing.value_kg;
      next[idx] = {
        ...existing,
        value_kg: est1RM,
        source: "estimated",
        acquiredAt: today,
        ...(workoutId ? { fromWorkoutId: workoutId } : {}),
      };
      changed.push({ exerciseId, from, to: est1RM, source: "estimated" });
    }
    // Altrimenti SKIP (jitter o regressione).
  }

  return { updated: next, changed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-effect: profile storage update + event emission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook da chiamare dopo `events.emit("workout:saved", ...)` (es. in DiaryApp
 * `handleSaveWorkout`). Carica il profilo, calcola i nuovi 1RM stimati,
 * aggiorna il profilo se ci sono PR significativi, emette `profile:updated`.
 *
 * Backward-compat: workout senza `exercises[]` strutturati → no-op (ritorna []).
 *
 * Ritorna la lista delle modifiche per UI feedback ("PR! squat 95kg (era 92)").
 */
export async function applyOneRepMaxUpdates(
  workout: Workout,
): Promise<OneRepMaxChange[]> {
  if (!workout || !Array.isArray(workout.exercises) || workout.exercises.length === 0) {
    return [];
  }

  const profile = await getJSON<UserProfile | null>("user-profile", null);
  if (!profile) return [];

  const currentOneRMs = profile.oneRepMaxes ?? [];
  const { updated, changed } = updateOneRepMaxesFromWorkout(currentOneRMs, workout);
  if (changed.length === 0) return [];

  const nextProfile: UserProfile = {
    ...profile,
    oneRepMaxes: updated,
    updatedAt: new Date().toISOString(),
  };

  try {
    await setJSON("user-profile", nextProfile);
    events.emit("profile:updated", { at: new Date().toISOString() });
  } catch (e) {
    // Storage failure (quota, payload too large): non propagare per non
    // bloccare il save flow del workout (già persistito a monte). Log per dev.
    console.warn("[applyOneRepMaxUpdates] persist fallito:", e);
    return [];
  }

  return changed;
}
