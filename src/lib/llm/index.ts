import type {
  ProviderAdapter, LLMClient, LLMConfig, ProviderId,
  GenerateJSONParams, GenerateTextParams, StreamChatParams,
} from "./types";
import { LLMKeyMissingError } from "./types";
import { geminiAdapter } from "./gemini";
import { openaiAdapter } from "./openai";
import { anthropicAdapter } from "./anthropic";
import { getJSON, setJSON, storage } from "../storage";

export * from "./types";
export { geminiAdapter, openaiAdapter, anthropicAdapter };

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
};

export const CONFIG_KEY = "llm-config";
const LEGACY_GEMINI_KEY = "gemini-api-key";

// ---------- Config storage ----------

function readConfigSync(): LLMConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LLMConfig;
      if (parsed && parsed.provider && parsed.apiKey && parsed.modelId) return parsed;
    }
  } catch { /* ignore */ }
  // Migrazione: se esiste chiave Gemini legacy, costruisci config al volo
  const legacy = (localStorage.getItem(LEGACY_GEMINI_KEY) || "").trim();
  if (legacy) {
    return {
      provider: "gemini",
      apiKey: legacy,
      modelId: geminiAdapter.defaultChatModel,
    };
  }
  return null;
}

// Modelli notoriamente instabili (preview/exp) che soffrono di 503 frequenti.
// Se un utente esistente ha questi nella config, auto-migrazione al default GA stabile.
const UNSTABLE_MODEL_PATTERNS = [
  /preview/i,
  /-exp(\b|$|-)/i,
  /^gemini-3\.1-flash-lite$/i, // risolve server-side a -preview
];

function isUnstableModel(modelId: string): boolean {
  return UNSTABLE_MODEL_PATTERNS.some(re => re.test(modelId));
}

export async function getLLMConfig(): Promise<LLMConfig | null> {
  const parsed = await getJSON<LLMConfig | null>(CONFIG_KEY, null);
  if (parsed && parsed.provider && parsed.apiKey && parsed.modelId) {
    // Auto-migrazione: se l'utente ha un modello preview/exp Gemini (causa 503),
    // switch automatico al default stabile. L'utente può sempre ri-sceglierlo manualmente.
    if (parsed.provider === "gemini" && isUnstableModel(parsed.modelId)) {
      const migrated: LLMConfig = { ...parsed, modelId: geminiAdapter.defaultChatModel };
      await setJSON(CONFIG_KEY, migrated);
      console.info(`[LLM migration] Modello '${parsed.modelId}' instabile → migrato a '${migrated.modelId}'`);
      return migrated;
    }
    return parsed;
  }
  const legacy = (localStorage.getItem(LEGACY_GEMINI_KEY) || "").trim();
  if (legacy) {
    const cfg: LLMConfig = {
      provider: "gemini",
      apiKey: legacy,
      modelId: geminiAdapter.defaultChatModel,
    };
    return cfg;
  }
  return null;
}

export async function setLLMConfig(config: LLMConfig): Promise<void> {
  await setJSON(CONFIG_KEY, config);
  // Se è Gemini, mantieni sincronizzata la chiave legacy per retro-compatibilità.
  if (config.provider === "gemini") {
    localStorage.setItem(LEGACY_GEMINI_KEY, config.apiKey);
  }
}

export async function clearLLMConfig(): Promise<void> {
  await storage.delete(CONFIG_KEY);
}

export function hasLLMConfig(): boolean {
  const c = readConfigSync();
  if (!c) return false;
  return !!c.apiKey && c.apiKey.trim().length >= 10 && !!c.provider && !!c.modelId;
}

export function getCurrentConfigSync(): LLMConfig | null {
  return readConfigSync();
}

// ---------- Client factories ----------

export function getCurrentClient(): LLMClient {
  const cfg = readConfigSync();
  if (!cfg) throw new LLMKeyMissingError();
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) throw new LLMKeyMissingError();
  return adapter.createClient(cfg);
}

export function getEmbeddingClient(): LLMClient | null {
  const cfg = readConfigSync();
  if (!cfg) return null;
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter || !adapter.supportsEmbeddings) return null;
  const client = adapter.createClient(cfg);
  if (typeof client.embedContent !== "function") return null;
  return client;
}

// ---------- Façade API (retro-compatibile con src/lib/gemini.ts) ----------

export async function generateJSON<T>(params: GenerateJSONParams): Promise<T> {
  return getCurrentClient().generateJSON<T>(params);
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  return getCurrentClient().generateText(params);
}

export async function* streamChat(params: StreamChatParams): AsyncGenerator<string> {
  const client = getCurrentClient();
  for await (const chunk of client.streamChat(params)) yield chunk;
}

export async function embedContent(text: string): Promise<number[]> {
  const client = getEmbeddingClient();
  if (!client || !client.embedContent) {
    const cfg = readConfigSync();
    throw new LLMKeyMissingError(cfg?.provider);
  }
  return client.embedContent(text);
}

export async function pingCurrent(): Promise<{ ok: boolean; error?: string }> {
  const cfg = readConfigSync();
  if (!cfg) return { ok: false, error: "Nessun provider configurato." };
  return ADAPTERS[cfg.provider].ping(cfg.apiKey, cfg.modelId);
}
