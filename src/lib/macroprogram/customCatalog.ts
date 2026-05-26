// User-custom catalog (Sprint 3 Tier 3, 2026-05-26).
//
// Storage estensione di EXERCISES_BY_ID hardcoded. Quando un macroprogramma
// importato contiene un esercizio NUOVO (non matchabile dal fuzzy matcher),
// il parser lo aggiunge qui automaticamente usando i metadata che Claude ha
// scritto nel JSON (id, name, pattern, equipment, technique, guidance).
//
// Lookup hybrid: il sessionDetail/Player chiama lookupExerciseHybrid(id) che
// cerca prima nel catalog hardcoded, poi nel custom. Trasparente al consumer.
//
// Storage key: "user-custom-exercises"
// Persistenza: localStorage (consistente col resto dell'app).

import type { Exercise } from "../types/exercise";
import { EXERCISES_BY_ID } from "../catalog/exercises";
import { getJSON, setJSON } from "../storage";

const CUSTOM_KEY = "user-custom-exercises";

/**
 * Carica tutti gli esercizi custom dal storage.
 * Ritorna [] se storage vuoto o corrotto.
 */
export async function loadCustomExercises(): Promise<Exercise[]> {
  return getJSON<Exercise[]>(CUSTOM_KEY, []);
}

/**
 * Salva (aggiunge o sostituisce per id) un esercizio nel custom catalog.
 * Se id già esiste: update. Altrimenti: append.
 */
export async function saveCustomExercise(ex: Exercise): Promise<void> {
  const current = await loadCustomExercises();
  const filtered = current.filter(c => c.id !== ex.id);
  filtered.push(ex);
  await setJSON(CUSTOM_KEY, filtered);
}

/**
 * Salva multiple esercizi in un colpo solo (batch import).
 * Usato dal parser quando un macroprogramma include N esercizi nuovi.
 */
export async function saveCustomExercisesBatch(exs: Exercise[]): Promise<void> {
  const current = await loadCustomExercises();
  const idsToAdd = new Set(exs.map(e => e.id));
  const filtered = current.filter(c => !idsToAdd.has(c.id));
  await setJSON(CUSTOM_KEY, [...filtered, ...exs]);
}

/**
 * Rimuove un esercizio custom per id. No-op se non esiste.
 */
export async function deleteCustomExercise(id: string): Promise<void> {
  const current = await loadCustomExercises();
  await setJSON(CUSTOM_KEY, current.filter(c => c.id !== id));
}

/**
 * Cancella TUTTI gli esercizi custom (reset).
 */
export async function clearCustomExercises(): Promise<void> {
  await setJSON(CUSTOM_KEY, []);
}

/**
 * Lookup hybrid: prima catalog hardcoded, poi custom.
 * Ritorna undefined se non trovato in nessuno dei due.
 *
 * NOTA SINCRONA: usa una cache in-memory per evitare async lookup ad ogni
 * chiamata (sessionDetail/Player chiamano questo function dentro render).
 * La cache viene refreshata da refreshCustomCache() che il caller deve
 * invocare dopo import macroprogramma o all'avvio app.
 */
let customCache: Map<string, Exercise> = new Map();

export function lookupExerciseHybrid(id: string): Exercise | undefined {
  if (EXERCISES_BY_ID[id]) return EXERCISES_BY_ID[id];
  return customCache.get(id);
}

/**
 * Refresha la cache in-memory leggendo dal storage.
 * Chiamato dopo import macroprogramma o al mount dell'app.
 * Idempotente.
 */
export async function refreshCustomCache(): Promise<void> {
  const items = await loadCustomExercises();
  customCache = new Map(items.map(e => [e.id, e]));
}

/**
 * Costruisce un Exercise dal payload macroprogramma (campi parsed) per
 * Tier 3 auto-add. Richiede technique + guidance presenti nel payload
 * (altrimenti l'esercizio non sarà utilizzabile correttamente dal Player).
 *
 * Validation minimale: name + pattern + equipment obbligatori.
 * Defaults: level="intermediate", unilateral=false, alternatives=[],
 * cautions=[], loadable=true (assumendo esercizio carico-capable).
 */
export function buildExerciseFromMacroPayload(payload: {
  id: string;
  name?: string;
  pattern?: Exercise["pattern"];
  equipment?: Exercise["equipment"];
  technique?: string;
  guidance?: string[];
}): Exercise | null {
  if (!payload.name || !payload.pattern || !payload.equipment) return null;
  return {
    id: payload.id,
    name: payload.name,
    pattern: payload.pattern,
    primaryMuscles: [],          // non specificato in macroprogram → vuoto
    secondaryMuscles: [],
    equipment: payload.equipment,
    level: "intermediate",
    unilateral: false,
    technique: payload.technique ?? payload.name,
    guidance: payload.guidance && payload.guidance.length > 0 ? payload.guidance : undefined,
    alternatives: [],
    loadable: true,
  };
}
