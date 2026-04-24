import type {
  ProviderAdapter, LLMClient, LLMConfig, ProviderId,
  GenerateJSONParams, GenerateTextParams, StreamChatParams,
} from "./types";
import { LLMKeyMissingError } from "./types";
import { geminiAdapter } from "./gemini";
import { openaiAdapter } from "./openai";
import { anthropicAdapter } from "./anthropic";
import { getJSON, setJSON, storage } from "../storage";
import { events } from "../events";

export * from "./types";
export { geminiAdapter, openaiAdapter, anthropicAdapter };

/**
 * Registry degli adapter LLM.
 *
 * NOTE — Lazy loading / bundle optimization (fix #1, versione MINIMA):
 * Inizialmente avevamo tentato il lazy-load con `() => import()` per abilitare
 * Vite code-splitting e ridurre il bundle di ~50KB (escludendo gli SDK dei
 * provider non usati). Il refactor è stato ROLLED BACK perché:
 *   - `ADAPTERS[provider]` è usato sync in 3 callsite React (OnboardingWizard,
 *     SettingsPage, lib/gemini.ts legacy shim) — tutti leggono metadata tipo
 *     `.defaultChatModel` durante il render iniziale.
 *   - `getEmbeddingClient()` è chiamato sync da `knowledge/retriever.ts` e
 *     `knowledge/embedder.ts` — il vincolo di retrocompat richiede firma sync.
 *   - Passare tutti questi callsite ad async avrebbe richiesto ~8-10 file touched
 *     fuori dai file autorizzati per questo patch.
 *
 * Strategia migliore per il futuro (fuori scope di questo patch):
 *   - Split di ogni adapter in due file: `gemini-meta.ts` (solo metadata, no SDK)
 *     + `gemini-client.ts` (factory pesante con SDK). ADAPTERS importa solo
 *     il meta. `createClient` fa `import()` dinamico del file client.
 *   - Oppure: eliminare completamente gli accessi sync a `ADAPTERS[p].defaultChatModel`
 *     esponendo le costanti di default come export top-level (stringhe piatte).
 *
 * Model selection hint (pura doc, zero behavior change — fix #4):
 * - gemini:    DEFAULT del progetto. `gemini-3.1-flash-lite-preview` per tutti
 *              i task standard (plan, feedback, chat). "Lite" = più economico
 *              per feedback brevi/weekly report senza perdita di qualità percepita.
 *              Fallback automatico a `gemini-2.5-flash-lite` se 503.
 * - openai:    `gpt-4o-mini` per la maggior parte dei task; `gpt-4o` solo su
 *              planGeneration complessi (pianificazione multi-settimana).
 * - anthropic: `claude-haiku-4-5` come default (veloce/economico). Sonnet solo
 *              se serve reasoning esteso su weekly report con molto contesto.
 */
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

// Modelli deprecati da migrare automaticamente al default attuale.
// NOTA: 'gemini-3.1-flash-lite-preview' (attuale default) NON è nell'elenco:
// se viene 503 il fallback automatico a 'gemini-2.5-flash-lite' gestisce già.
const UNSTABLE_MODEL_PATTERNS = [
  /gemini-2\.0-flash-exp/i,        // vecchio default deprecato
  /gemini-2\.5-flash$/i,           // upgradiamo al 3.1-lite-preview (più economico, stesse performance tipiche)
  /gemini-3-flash-preview/i,       // non più default
  /^gemini-3\.1-flash-lite$/i,     // senza -preview: alias che risolve comunque a preview, meglio esplicito
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
      events.emit("llm:migrated", {
        fromModelId: parsed.modelId,
        toModelId: migrated.modelId,
        reason: "Modello obsoleto/instabile: migrato al default stabile",
      });
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
