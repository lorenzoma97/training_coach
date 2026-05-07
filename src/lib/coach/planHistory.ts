// Gestione storico piani. Ogni volta che un piano viene sostituito (rigenerazione
// manuale, adapt con desiderata, scheduler lunedì), quello precedente viene
// archiviato qui. L'utente può consultarlo nella sezione "Settimane precedenti"
// del tab Coach per vedere cosa aveva pianificato e confrontarlo col diario.

import { getJSON, setJSON } from "../storage";
import { events } from "../events";
import type { TrainingPlan } from "../types";

export const PLAN_HISTORY_KEY = "plan-history";
const HISTORY_CAP = 12; // ~3 mesi di piani settimanali
/** Storage key per il piano "preview" della settimana prossima.
 *  Mantenuto distinto da training-plan per evitare di confondere l'utente:
 *  finché la settimana corrente è attiva, NON sostituiamo training-plan.
 *  Auto-promote al lunedì successivo (vedi maybePromoteNextPlan). */
export const NEXT_PLAN_KEY = "training-plan-next";

export async function getPlanHistory(): Promise<TrainingPlan[]> {
  return getJSON<TrainingPlan[]>(PLAN_HISTORY_KEY, []);
}

/** Archivia `previous` se non è null. Ritorna la history aggiornata. */
export async function archivePlan(previous: TrainingPlan | null): Promise<TrainingPlan[]> {
  if (!previous) return await getPlanHistory();
  const history = await getPlanHistory();
  // Evita duplicati: se la history inizia già con lo stesso generatedAt, skippa.
  if (history[0]?.generatedAt === previous.generatedAt) return history;
  const updated = [previous, ...history].slice(0, HISTORY_CAP);
  await setJSON(PLAN_HISTORY_KEY, updated);
  return updated;
}

/**
 * Salva il nuovo piano archiviando il precedente (se esiste e diverso).
 * Use case: ovunque prima si faceva `setJSON("training-plan", next)`.
 */
export async function savePlanWithHistory(newPlan: TrainingPlan): Promise<void> {
  const prev = await getJSON<TrainingPlan | null>("training-plan", null);
  if (prev && prev.generatedAt !== newPlan.generatedAt) {
    await archivePlan(prev);
  }
  await setJSON("training-plan", newPlan);
}

/** Legge il piano "preview" della settimana prossima (può essere null). */
export async function getNextPlan(): Promise<TrainingPlan | null> {
  return getJSON<TrainingPlan | null>(NEXT_PLAN_KEY, null);
}

/** Salva un piano come "preview" della settimana prossima. NON tocca training-plan. */
export async function saveNextPlan(plan: TrainingPlan): Promise<void> {
  await setJSON(NEXT_PLAN_KEY, plan);
}

/** Cancella il piano "preview". Es. quando l'utente lo scarta. */
export async function clearNextPlan(): Promise<void> {
  await setJSON(NEXT_PLAN_KEY, null);
}

/**
 * Auto-promote: se il piano "preview" ha startDate <= oggi, promuovilo a
 * training-plan corrente (archiviando quello vecchio in history) e cancella
 * il preview slot. Idempotente: ritorna `false` se nulla è stato promosso.
 *
 * Da chiamare a:
 *  - App mount (App.tsx useEffect)
 *  - Apertura tab Coach (CoachPage useEffect)
 *  - Apertura vista Piano (TrainingPlanView load)
 * Più chiamate dello stesso giorno = no-op (idempotente).
 */
export async function maybePromoteNextPlan(): Promise<boolean> {
  const next = await getNextPlan();
  // Runtime validation: lo storage può essere corrotto (manomissione, vecchio
  // backup, bug pregresso). Se startDate manca/è invalido NON promuoviamo
  // (evita crash split() su undefined) e logghiamo per diagnostica.
  if (!next) return false;
  if (!next.startDate || typeof next.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(next.startDate)) {
    console.warn("[planHistory] next plan ha startDate mancante/invalido — skipping promote", next.startDate);
    return false;
  }
  if (!next.weeks || !Array.isArray(next.weeks) || next.weeks.length === 0) {
    console.warn("[planHistory] next plan senza settimane — skipping promote");
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = next.startDate.split("-").map(Number);
  const startD = new Date(y, m - 1, d);
  if (startD > today) return false; // not yet, settimana preview ancora futura
  // Promote: archivia il corrente + sostituisci con next + svuota lo slot preview.
  await savePlanWithHistory(next);
  await clearNextPlan();
  events.emit("plan:updated", { at: new Date().toISOString() });
  return true;
}
