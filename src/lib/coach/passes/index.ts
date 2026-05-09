// Barrel re-exports per i moduli "passes" del multi-pass orchestrator.
// Wave 3.1: solo strengthSessionPrompt. Wave 3.2/3.3 aggiungeranno
// cardioSessionPrompt, sportSessionPrompt, validatePassPrompt, etc.
//
// L'orchestrator (Wave 4.1, planOrchestrator.ts) importerà da qui.
export * from "./strengthSessionPrompt";
