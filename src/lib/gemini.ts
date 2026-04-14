// Retro-compatibilità: queste funzioni ora delegano all'astrazione LLM multi-provider.
// File legacy — mantenuto per non rompere i chiamanti esistenti. I nuovi moduli
// dovrebbero importare direttamente da "./llm".

import {
  generateJSON as llmGenerateJSON,
  generateText as llmGenerateText,
  streamChat as llmStreamChat,
  pingCurrent,
  hasLLMConfig,
  getCurrentConfigSync,
  setLLMConfig,
  ADAPTERS,
  LLMKeyMissingError,
} from "./llm";
import type {
  GenerateJSONParams, GenerateTextParams, StreamChatParams,
} from "./llm";

const LEGACY_KEY = "gemini-api-key";

/** @deprecated usa l'LLMConfig via Settings. Restituisce la chiave del provider corrente. */
export function getApiKey(): string {
  const cfg = getCurrentConfigSync();
  if (cfg) return cfg.apiKey;
  return (localStorage.getItem(LEGACY_KEY) || "").trim();
}

/** @deprecated Setta una chiave Gemini (fast-path setup iniziale). */
export function setApiKey(key: string): void {
  const trimmed = key.trim();
  localStorage.setItem(LEGACY_KEY, trimmed);
  if (!trimmed) return;
  // Mantiene una LLMConfig Gemini con modello di default se non ne esiste già una.
  const cfg = getCurrentConfigSync();
  if (!cfg || cfg.provider !== "gemini") {
    void setLLMConfig({
      provider: "gemini",
      apiKey: trimmed,
      modelId: ADAPTERS.gemini.defaultChatModel,
    });
  } else {
    // Aggiorna la chiave mantenendo modello scelto
    void setLLMConfig({ ...cfg, apiKey: trimmed });
  }
}

/** True se esiste un provider LLM configurato (qualunque sia). */
export function hasApiKey(): boolean {
  if (hasLLMConfig()) return true;
  const k = (localStorage.getItem(LEGACY_KEY) || "").trim();
  return k.length >= 20 && !k.includes(" ");
}

/** Errore legacy: mantenuto per i chiamanti che lo catchano esplicitamente. */
export class GeminiKeyMissingError extends LLMKeyMissingError {
  constructor() { super(); this.name = "GeminiKeyMissingError"; }
}

export async function generateJSON<T>(params: GenerateJSONParams): Promise<T> {
  return llmGenerateJSON<T>(params);
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  return llmGenerateText(params);
}

export async function* streamChat(params: StreamChatParams): AsyncGenerator<string> {
  for await (const chunk of llmStreamChat(params)) yield chunk;
}

export async function pingApiKey(): Promise<{ ok: boolean; error?: string }> {
  return pingCurrent();
}
