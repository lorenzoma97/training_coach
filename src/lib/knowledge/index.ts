import type { RagContext } from "./chunks";

export { CHUNKS, type KnowledgeChunk, type RagContext } from "./chunks";
export { ensureEmbeddings, embedQuery, clearEmbeddings, getCacheStatus, CACHE_KEY, type EmbeddingCache, type CacheStatus } from "./embedder";
export { retrieveRelevantChunks, chunksAsPromptBlock, type RetrievalResult, type RetrievalOptions } from "./retriever";

/**
 * Wave 4.2 — pass identifier per il context routing dell'orchestrator.
 * Ogni pass ha un set deterministico di RagContext pertinenti (vedi `contextsForPass`).
 */
export type PassKind =
  | "pass1_skeleton"
  | "pass2_strength"
  | "pass2_cardio"
  | "chat"
  | "session_feedback"
  | "weekly_report";

/**
 * Workout type opzionale per `session_feedback`. Quando presente, il mapping
 * arricchisce i contexts con tag pertinenti (es. "sport" → sport_specific).
 */
export type WorkoutTypeHint = "strength" | "cardio" | "sport" | "mobility" | "mixed";

/**
 * Determina quali RagContext sono pertinenti per un dato pass dell'orchestrator.
 *
 * Mapping deterministico (allineato all'enum `RagContext` corrente: macro_periodization
 * | strength_db | cardio_intervals | sport_specific | mobility | none):
 * - pass1_skeleton  → macro_periodization, cardio_intervals, strength_db
 * - pass2_strength  → strength_db, macro_periodization
 * - pass2_cardio    → cardio_intervals, macro_periodization
 * - chat            → [] (no filter — tutti i context disponibili al coach)
 * - session_feedback → macro_periodization, mobility (+ workoutType-specific)
 * - weekly_report   → macro_periodization, mobility
 *
 * Nota: il brief originale citava `strength_general`, `strength_technique`,
 * `readiness`, `overtraining` — questi non esistono nell'enum corrente.
 * Mapping pragmatico: forza → `strength_db`; readiness/overtraining → coperti
 * da chunks `macro_periodization` (ACWR, overtraining) e `mobility` (recovery).
 */
export function contextsForPass(pass: PassKind, workoutType?: WorkoutTypeHint): RagContext[] {
  switch (pass) {
    case "pass1_skeleton":
      return ["macro_periodization", "cardio_intervals", "strength_db"];
    case "pass2_strength":
      return ["strength_db", "macro_periodization"];
    case "pass2_cardio":
      return ["cardio_intervals", "macro_periodization"];
    case "chat":
      // No filter: il coach in chat può attingere a qualsiasi area.
      return [];
    case "session_feedback": {
      const base: RagContext[] = ["macro_periodization", "mobility"];
      switch (workoutType) {
        case "strength":
          return [...base, "strength_db"];
        case "cardio":
          return [...base, "cardio_intervals"];
        case "sport":
          return [...base, "sport_specific"];
        case "mobility":
          return ["mobility", "macro_periodization"];
        case "mixed":
          return [...base, "strength_db", "cardio_intervals"];
        default:
          return base;
      }
    }
    case "weekly_report":
      return ["macro_periodization", "mobility"];
  }
}
