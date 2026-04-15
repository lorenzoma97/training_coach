// Gestione storico piani. Ogni volta che un piano viene sostituito (rigenerazione
// manuale, adapt con desiderata, scheduler lunedì), quello precedente viene
// archiviato qui. L'utente può consultarlo nella sezione "Settimane precedenti"
// del tab Coach per vedere cosa aveva pianificato e confrontarlo col diario.

import { getJSON, setJSON } from "../storage";
import type { TrainingPlan } from "../types";

export const PLAN_HISTORY_KEY = "plan-history";
const HISTORY_CAP = 12; // ~3 mesi di piani settimanali

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
