// Wave 3.3 — Macrocycle Lifecycle orchestrator (schema-specialist).
//
// Side-effect coordinator tra `user-races` ↔ `macro-cycle:<id>` ↔
// `user-profile.activeMacroCycleId` ↔ `training-plan.staleReason`.
//
// Pure logic (computePhaseForWeek, buildMacroCycle, ecc.) sta in
// `macroPlanner.ts`. Qui isoliamo TUTTI i side-effect (storage I/O + event
// emission) così il planner rimane testabile sync senza mock.
//
// Pattern di chiamata tipico (futuro RacesPage):
//   await setRaces(newRaces);          // FE persiste user-races
//   await recomputeActiveMacro();      // ricomputa macro + emit "macro:updated"
//   await markPlanStaleIfMacroChanged(prevHash);  // marca piano stale (I3)
//
// I3 (ARCHITECTURE.md §6): NON rigeneriamo MAI il piano corrente
// automaticamente. UI mostra prompt "ricalcola piano".

import { events } from "../events";
import { getJSON, setJSON, storage } from "../storage";
import type { MacroCycle, RaceEvent, TrainingPlan, UserProfile } from "../types";
import { buildMacroCycle, selectActiveRace } from "./macroPlanner";

/** Prefisso storage chiavi macrociclo individuali. */
const MACRO_CYCLE_PREFIX = "macro-cycle:";

/**
 * Quando l'utente aggiunge/modifica/rimuove una race priority="A":
 *  1. Carica races da storage (`user-races`).
 *  2. Seleziona la race A più vicina nel futuro (selectActiveRace).
 *  3. Computa MacroCycle deterministico (buildMacroCycle).
 *  4. Salva in storage `macro-cycle:<id>` (rimuove i precedenti orfani).
 *  5. Aggiorna `profile.activeMacroCycleId` se cambiato.
 *  6. Emette `macro:updated` con il nuovo id (o null se nessuna race A).
 *
 * Idempotente: chiamate multiple consecutive con lo stesso stato producono
 * lo stesso risultato (l'id del macro è deterministico via inputHash).
 *
 * Ritorna il MacroCycle attivo, o null se non ci sono race A future.
 */
export async function recomputeActiveMacro(): Promise<MacroCycle | null> {
  const races = await getJSON<RaceEvent[]>("user-races", []);
  const activeRace = selectActiveRace(races);

  // Cleanup macrocicli orfani: ogni recompute scriviamo SOLO il macro attivo
  // (al massimo 1 alla volta) e cancelliamo i precedenti. Limitiamo a 1
  // macrociclo attivo: history multi-macro non è richiesta in Wave 3.3.
  await pruneOrphanMacroCycles(null);

  if (!activeRace) {
    // Nessuna race A: clear activeMacroCycleId e notify.
    await updateProfileActiveMacro(null);
    events.emit("macro:updated", { activeMacroCycleId: null, at: new Date().toISOString() });
    return null;
  }

  const macro = buildMacroCycle(activeRace);
  if (!macro) {
    // Race A esiste ma è troppo vicina (<14gg) o nel passato: clear active.
    await updateProfileActiveMacro(null);
    events.emit("macro:updated", { activeMacroCycleId: null, at: new Date().toISOString() });
    return null;
  }

  // Persisti il nuovo macro. Cleanup degli altri (manteniamo solo l'attivo).
  await pruneOrphanMacroCycles(macro.id);
  try {
    await setJSON(`${MACRO_CYCLE_PREFIX}${macro.id}`, macro);
  } catch (e) {
    console.warn("[recomputeActiveMacro] persist macro fallito:", e);
    return null;
  }

  await updateProfileActiveMacro(macro.id);
  events.emit("macro:updated", { activeMacroCycleId: macro.id, at: new Date().toISOString() });
  return macro;
}

/**
 * Marca il piano corrente come "stale" se il macro è cambiato dal momento
 * in cui il piano è stato generato. NON rigenera il piano (I3).
 *
 * @param prevMacroHash hash del macro PRIMA del recompute (può essere null
 *   se non c'era un macro attivo). Confronta con il macro attuale per decidere
 *   se marcare stale.
 *
 * Ritorna true se il piano è stato marcato stale, false altrimenti
 * (nessun piano, oppure macro invariato).
 */
export async function markPlanStaleIfMacroChanged(
  prevMacroHash: string | null,
): Promise<boolean> {
  const plan = await getJSON<TrainingPlan | null>("training-plan", null);
  if (!plan) return false;

  // Compara con il macro attualmente attivo (post-recompute).
  const profile = await getJSON<UserProfile | null>("user-profile", null);
  const activeId = profile?.activeMacroCycleId;
  const currentHash = activeId
    ? (await getJSON<MacroCycle | null>(`${MACRO_CYCLE_PREFIX}${activeId}`, null))?.inputHash ?? null
    : null;

  // Se gli hash coincidono, niente da fare.
  if (prevMacroHash === currentHash) return false;

  // Hash diversi: marca il piano stale (se non già marcato per stesso motivo).
  if (plan.staleReason === "macro_changed") return false;

  const next: TrainingPlan = {
    ...plan,
    staleReason: "macro_changed",
    staleAt: new Date().toISOString(),
  };

  try {
    await setJSON("training-plan", next);
    events.emit("plan:updated", { at: new Date().toISOString() });
    return true;
  } catch (e) {
    console.warn("[markPlanStaleIfMacroChanged] persist plan fallito:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper privati
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggiorna `profile.activeMacroCycleId`. No-op se il profilo non esiste o
 * se il valore è già quello richiesto.
 */
async function updateProfileActiveMacro(newId: string | null): Promise<void> {
  const profile = await getJSON<UserProfile | null>("user-profile", null);
  if (!profile) return;
  // No-change short-circuit: evita scritture inutili.
  if ((profile.activeMacroCycleId ?? null) === newId) return;
  const next: UserProfile = {
    ...profile,
    // Imposta a undefined invece di null per backward-compat con consumer
    // che fanno `profile.activeMacroCycleId ?? defaultBehavior`.
    activeMacroCycleId: newId ?? undefined,
    updatedAt: new Date().toISOString(),
  };
  try {
    await setJSON("user-profile", next);
    events.emit("profile:updated", { at: new Date().toISOString() });
  } catch (e) {
    console.warn("[updateProfileActiveMacro] persist profile fallito:", e);
  }
}

/**
 * Cancella tutti i macrocicli salvati tranne `keepId` (se fornito).
 * Manteniamo SOLO il macro attivo: in Wave 3.3 non serve history.
 */
async function pruneOrphanMacroCycles(keepId: string | null): Promise<void> {
  try {
    const keys = await storage.keys(MACRO_CYCLE_PREFIX);
    for (const k of keys) {
      const id = k.slice(MACRO_CYCLE_PREFIX.length);
      if (keepId && id === keepId) continue;
      await storage.delete(k);
    }
  } catch (e) {
    // Non fatale: se cleanup fallisce, nuovo macro sovrascrive comunque
    // il vecchio (stesso id se inputHash invariato; id diverso → orfano
    // residuo che pruning successivo rimuoverà).
    console.warn("[pruneOrphanMacroCycles] cleanup fallito:", e);
  }
}
