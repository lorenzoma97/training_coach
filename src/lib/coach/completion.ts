// FASE 2 — Completion engine: matching piano↔diario come funzione PURA.
//
// PERCHÉ ESISTE (audit 2026-06-12, finding C3): lo stato "sessione completata"
// non è mai persistito ed era ri-derivato in TRE punti con logiche divergenti
// (TrainingPlanView: giorno+tipo+subtype+family; DiaryApp: solo typeFamily;
// TodayTab: weeks[0] per label giorno). Risultato: "Fatta ✓" nel Diario e
// "VARIATA" nel Piano per lo stesso workout. Questa è l'estrazione 1:1 della
// logica di TrainingPlanView (la più completa) in un punto unico e testabile.
// I consumer (TrainingPlanView ora, DiaryApp/TodayTab nello step successivo)
// devono usare SOLO questa funzione.
//
// Regole (invariate rispetto a TrainingPlanView pre-estrazione):
//  - match SOLO stesso giorno (nessun cross-day): un workout in un giorno
//    diverso dal pianificato = sessione SALTATA + workout AUTONOMO.
//  - 3 tentativi same-day: (1) tipo+subtype → strict; (2) solo tipo → strict
//    se la sessione non aveva subtype; (3) stessa family forza_gambe↔upper.
//  - la DURATA non entra mai nel match (un workout da 5' marca FATTA una
//    sessione da 60' — comportamento storico, da rivedere come decisione).
//  - dedup per id workout (un workout matcha al più una sessione).
//  - SALTATA solo nel passato; oggi senza match resta "oggi"; futuro ignorato.

import type { TrainingPlan } from "../types";
import { toISO, parseISO, DAY_LABELS_MON } from "../time";

export interface CompletionInfo {
  /** Data (YYYY-MM-DD) del workout che ha soddisfatto la sessione. */
  date: string;
  /** True se il workout è dello stesso giorno pianificato (sempre true: no cross-day). */
  sameDay: boolean;
  /** True = tipo+subtype combaciano; false = variazione (tipo ok, subtype/family diverso). */
  strictMatch: boolean;
  /** Subtype effettivo registrato (fields.tipo || fields.sport). */
  actualSubtype?: string;
  /** Tipo effettivo se diverso dal pianificato (family match forza_gambe↔upper). */
  actualType?: string;
}

/** Workout/diario in forma lasca (la shape reale del diario è eterogenea). */
type DiaryWorkout = {
  id: string;
  type: string;
  fields?: { tipo?: string; sport?: string;[k: string]: unknown };
  [k: string]: unknown;
};
export type RecentDay = { date: string; workouts?: DiaryWorkout[]; daily?: unknown };

export interface CompletionResult {
  /** key `${weekNumber}-${day}-${plannedDate.getTime()}` → info completamento. */
  completed: Map<string, CompletionInfo>;
  /** Workout non riconducibili a nessuna sessione, dentro la finestra del piano. */
  extras: Array<{ date: string; workout: DiaryWorkout }>;
  /** key delle sessioni passate senza workout corrispondente. */
  skipped: Set<string>;
}

/** key di una sessione pianificata, identica a quella ricostruita dal render. */
export function sessionCompletionKey(weekNumber: number, day: string, plannedDate: Date): string {
  return `${weekNumber}-${day}-${plannedDate.getTime()}`;
}

const typeFamily = (type: string): string =>
  (type === "forza_gambe" || type === "forza_upper") ? "forza" : type;

/**
 * Calcola lo stato di completamento di ogni sessione del piano rispetto al
 * diario recente. PURA: stesso (plan, recentDays, now) → stesso output.
 * `now` iniettabile per test deterministici (default: ora corrente).
 */
export function computeCompletion(
  plan: TrainingPlan | null | undefined,
  recentDays: RecentDay[],
  now: Date = new Date(),
): CompletionResult {
  const empty: CompletionResult = { completed: new Map(), extras: [], skipped: new Set() };
  if (!plan || !plan.startDate || !recentDays.length) return empty;

  const start = parseISO(plan.startDate);
  if (!start) return empty;

  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

  const usedWorkoutIds = new Set<string>();
  const completed = new Map<string, CompletionInfo>();
  const skipped = new Set<string>();

  for (let w = 0; w < plan.weeks.length; w++) {
    const week = plan.weeks[w];
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekStartKey = toISO(weekStart);
    const weekEndKey = toISO(weekEnd);

    const weekDays = recentDays.filter((rd) => rd.date >= weekStartKey && rd.date <= weekEndKey);

    for (const s of week.sessions) {
      const dayIdx = DAY_LABELS_MON.indexOf(s.day as typeof DAY_LABELS_MON[number]);
      if (dayIdx < 0) continue;
      const plannedDate = new Date(start);
      plannedDate.setDate(start.getDate() + w * 7 + dayIdx);
      const plannedKey = toISO(plannedDate);
      const key = sessionCompletionKey(week.weekNumber, s.day, plannedDate);

      // Sessione futura: non matchare, non contare saltata.
      if (plannedDate > todayEnd) continue;

      const plannedSub = (s.subtype || "").toLowerCase().trim();
      const workoutSub = (wk: DiaryWorkout) =>
        (wk.fields?.tipo || wk.fields?.sport || "").toLowerCase().trim();
      const plannedDayEntry = weekDays.find((d) => d.date === plannedKey);
      let match: { dateKey: string; workout: DiaryWorkout; strictMatch: boolean } | null = null;

      if (plannedDayEntry) {
        // 1° same-day: tipo + subtype identici → strict.
        if (plannedSub) {
          for (const wk of (plannedDayEntry.workouts || [])) {
            if (usedWorkoutIds.has(wk.id)) continue;
            if (wk.type === s.type && workoutSub(wk) === plannedSub) {
              match = { dateKey: plannedDayEntry.date, workout: wk, strictMatch: true };
              break;
            }
          }
        }
        // 2° same-day: solo tipo (subtype diverso) → strict solo se nessun subtype pianificato.
        if (!match) {
          for (const wk of (plannedDayEntry.workouts || [])) {
            if (usedWorkoutIds.has(wk.id)) continue;
            if (wk.type === s.type) {
              match = { dateKey: plannedDayEntry.date, workout: wk, strictMatch: !plannedSub };
              break;
            }
          }
        }
        // 3° same-day: stessa family (forza_gambe ↔ forza_upper) → variazione.
        if (!match) {
          const plannedFam = typeFamily(s.type);
          for (const wk of (plannedDayEntry.workouts || [])) {
            if (usedWorkoutIds.has(wk.id)) continue;
            if (typeFamily(wk.type) === plannedFam && wk.type !== s.type) {
              match = { dateKey: plannedDayEntry.date, workout: wk, strictMatch: false };
              break;
            }
          }
        }
      }

      if (match) {
        usedWorkoutIds.add(match.workout.id);
        completed.set(key, {
          date: match.dateKey,
          sameDay: match.dateKey === plannedKey,
          strictMatch: match.strictMatch,
          actualSubtype: match.workout.fields?.tipo || match.workout.fields?.sport || undefined,
          actualType: match.workout.type !== s.type ? match.workout.type : undefined,
        });
      } else if (plannedDate < todayStart) {
        skipped.add(key);
      }
    }
  }

  // EXTRA: workout non matchati, ristretti alla finestra del piano.
  const extras: Array<{ date: string; workout: DiaryWorkout }> = [];
  for (const rd of recentDays) {
    for (const wk of (rd.workouts || [])) {
      if (!usedWorkoutIds.has(wk.id)) extras.push({ date: rd.date, workout: wk });
    }
  }
  const planStartKey = toISO(start);
  const planEnd = new Date(start);
  planEnd.setDate(start.getDate() + plan.weeks.length * 7 - 1);
  const planEndKey = toISO(planEnd);
  const extrasInPlanWindow = extras.filter((e) => e.date >= planStartKey && e.date <= planEndKey);

  return { completed, extras: extrasInPlanWindow, skipped };
}
