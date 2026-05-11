// Equipment Substitution (G8) — pure functions, no side effects.
// Wave 3.5 — substitutor-specialist.
//
// CONTRATTO (vedi ARCHITECTURE.md §2.1, Exercise.alternatives JSDoc):
// - Ogni Exercise ha `equipment: EquipmentTag[]` con tutti i tag REQUIRED (AND, non OR).
// - `alternatives: string[]` è una chain ID ordinata per preferenza (max 3 hop),
//   degradante verso bodyweight (es. barbell → dumbbell → kettlebell → bodyweight).
// - "bodyweight" è SEMPRE considerato disponibile, anche se non in availableEquipment
//   (l'utente può sempre fare esercizi a corpo libero).
//
// ALGORITMO walkAlternativeChain:
// 1. Hop 0: check originalId. Se eseguibile → ritorna {hop: 0}.
// 2. Hop 1..maxHop: scorri alternatives[] in ordine, ritorna primo match.
// 3. Cycle detection via Set<visited>: se incontri id già visto → null.
// 4. Catalog miss (id non in catalog) → null (no crash).
// 5. Esauriti i hop senza match → null (esercizio non eseguibile).
//
// USAGE PATTERN:
// - Validator (planValidator) chiama resolveSubstitution per ogni planned exercise →
//   se hop > 0 emette issue "equipment_substituted" (warn);
//   se null emette "equipment_mismatch" (warn).
// - Render-time / Pass-2 prompt usa il resolvedId per mostrare l'effettivo esercizio
//   eseguito. NON muta il piano persistito (effectiveExerciseId resta render-time).

import type { Exercise, EquipmentTag } from "../types/exercise";

/** Default massimo hop nella chain di alternative (Exercise.alternatives JSDoc). */
const DEFAULT_MAX_HOP = 3;

export interface SubstitutionResult {
  /** Esercizio originale richiesto. */
  originalId: string;
  /** Esercizio sostituito (può coincidere con originalId se l'utente ha l'equipment). */
  resolvedId: string;
  /** Hop count nella chain (0 = no substitution, 1-3 = downgrade). */
  hop: number;
  /** Reason user-facing (es. "no barbell, used dumbbell"). */
  reason?: string;
}

/**
 * True se l'esercizio è eseguibile con l'equipment dell'utente.
 *
 * Regole:
 * - TUTTI i tag in `ex.equipment` devono essere in `available` (AND, non OR).
 * - "bodyweight" è SEMPRE considerato available (anche se non in available).
 *
 * @internal Esposto solo per testing della logica AND/bodyweight.
 */
function isExerciseAvailable(ex: Exercise, available: Set<EquipmentTag>): boolean {
  for (const tag of ex.equipment) {
    if (tag === "bodyweight") continue; // sempre disponibile
    if (!available.has(tag)) return false;
  }
  return true;
}

/**
 * Costruisce un Set per lookup O(1). Aggiunge sempre "bodyweight" come safe-default
 * (idempotente con isExerciseAvailable, ma serve per consistenza).
 */
function toEquipmentSet(available: EquipmentTag[]): Set<EquipmentTag> {
  const set = new Set<EquipmentTag>(available);
  set.add("bodyweight");
  return set;
}

/**
 * Computa la "reason" user-facing leggibile: tag mancante per cui è stato fatto il swap.
 * Best-effort: cerca i tag dell'originale che NON sono nell'available e li elenca.
 */
function buildReason(
  originalEx: Exercise | undefined,
  resolvedEx: Exercise,
  available: Set<EquipmentTag>,
): string | undefined {
  if (!originalEx) return undefined;
  const missing = originalEx.equipment.filter(
    t => t !== "bodyweight" && !available.has(t),
  );
  if (missing.length === 0) {
    // Sostituzione "preferenziale" senza missing reale (caso teorico).
    return `sostituito → ${resolvedEx.id}`;
  }
  return `no ${missing.join("+")}, usato ${resolvedEx.id}`;
}

/**
 * Helper: BFS sul grafo di alternatives a livelli, max `maxHop` hop dal start.
 * Pure function. Esposto per testing isolato.
 *
 * Algoritmo BFS:
 *   visited = Set per cycle detection (un nodo viene esplorato 1 sola volta)
 *   queue = [(startId, 0)]
 *   while queue non vuota:
 *     (id, hop) = queue.shift()
 *     ex = catalog[id]; if miss → skip
 *     se eseguibile (isExerciseAvailable) → return {hop, ...}
 *     se hop >= maxHop → no expansion (limite contract)
 *     enqueue tutti gli ex.alternatives[] non ancora visited
 *   esauriti i nodi → return null
 *
 * NOTA: il fix Wave 3.5-post-review (BFS-on-array invece di head-only) è
 * necessario perché il catalog reale ha bidirezionalità intenzionale
 * (back-squat-bb ↔ goblet-squat-kb): un walker head-only cadeva in cycle
 * al hop 2 invece di scendere all'alt[2] verso bodyweight. Il contract
 * Exercise.alternatives JSDoc dice "primo DISPONIBILE viene usato" → BFS
 * ordinato per posizione array (bfs.shift() preserva ordine inserimento) e
 * per livello hop fa esattamente questo, garantendo anche la preferenza
 * (alt[0] esplorato prima di alt[1] allo stesso hop).
 */
export function walkAlternativeChain(
  startId: string,
  availableEquipment: EquipmentTag[],
  catalog: Exercise[],
  maxHop: number = DEFAULT_MAX_HOP,
): SubstitutionResult | null {
  const available = toEquipmentSet(availableEquipment);
  // Lookup map O(1) — ricostruita per ogni call (catalog è props, no caching trap).
  const byId = new Map<string, Exercise>();
  for (const ex of catalog) byId.set(ex.id, ex);

  const startEx = byId.get(startId);
  // Catalog miss su startId → null (no crash).
  if (!startEx) return null;

  const visited = new Set<string>([startId]);
  const queue: Array<{ id: string; hop: number }> = [{ id: startId, hop: 0 }];

  while (queue.length > 0) {
    const { id, hop } = queue.shift()!;
    const currentEx = byId.get(id);
    if (!currentEx) continue; // alt orfano nel catalog → skip, prova fratelli

    if (isExerciseAvailable(currentEx, available)) {
      return {
        originalId: startId,
        resolvedId: id,
        hop,
        reason: hop === 0 ? undefined : buildReason(startEx, currentEx, available),
      };
    }

    if (hop >= maxHop) continue; // contract: no espansione oltre maxHop

    // Espandi alternatives in ordine (alt[0] preferito, poi alt[1], alt[2]).
    for (const altId of currentEx.alternatives ?? []) {
      if (visited.has(altId)) continue; // già esplorato (cycle-safe)
      visited.add(altId);
      queue.push({ id: altId, hop: hop + 1 });
    }
  }

  // Esauriti i nodi raggiungibili entro maxHop senza match.
  return null;
}

/**
 * Risolve substitution per un esercizio dato l'equipment dell'utente.
 * Wrapper user-facing di walkAlternativeChain con maxHop=DEFAULT_MAX_HOP.
 *
 * Ritorna null se neanche dopo 3 hop si trova match (esercizio non eseguibile).
 */
export function resolveSubstitution(
  originalId: string,
  availableEquipment: EquipmentTag[],
  catalog: Exercise[],
): SubstitutionResult | null {
  return walkAlternativeChain(originalId, availableEquipment, catalog, DEFAULT_MAX_HOP);
}

/**
 * Variante batch per intera sessione: mappa exercises[] → SubstitutionResult[]
 * filtrando i null in `unresolved` per facile reporting al validator.
 */
export function resolveSubstitutionsForSession(
  exerciseIds: string[],
  availableEquipment: EquipmentTag[],
  catalog: Exercise[],
): { resolved: SubstitutionResult[]; unresolved: string[] } {
  const resolved: SubstitutionResult[] = [];
  const unresolved: string[] = [];
  for (const id of exerciseIds) {
    const r = resolveSubstitution(id, availableEquipment, catalog);
    if (r === null) unresolved.push(id);
    else resolved.push(r);
  }
  return { resolved, unresolved };
}
