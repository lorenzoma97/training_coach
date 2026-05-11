// Barrel re-exports per i moduli "passes" del multi-pass orchestrator.
// Wave 3.1: strengthSessionPrompt.
// Wave 4.1: skeletonPrompt + cardioIntervalPrompt + passOrchestrator.
//
// L'orchestrator (passOrchestrator.runMultiPass) e' il punto di ingresso
// chiamato da planGenerator (Wave 4.1+). I prompt builder restano esportati
// per testabilita' isolata.
export * from "./strengthSessionPrompt";
export * from "./skeletonPrompt";
export * from "./cardioIntervalPrompt";
export {
  runMultiPass,
  MULTI_PASS_ENABLED,
  type PassResult,
  type PassLog,
  type OrchestratorContext,
  type OrchestratorOptions,
} from "./passOrchestrator";
