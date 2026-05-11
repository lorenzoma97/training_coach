// Ollama local provider: zero-cloud option.
// Endpoint nativo Ollama: http://localhost:11434/api/{generate,chat,tags}
//
// Limiti noti (by design):
//   - NO embeddings via questo adapter (Ollama li espone su /api/embeddings con
//     modelli separati, es. nomic-embed-text; non sono compatibili dimensionalmente
//     con gemini-embedding-001 → RAG resta DISABILITATO in modalità Ollama).
//   - Health-check al boot: se Ollama non è in ascolto su localhost (caso tipico
//     su mobile o desktop senza demone), index.ts decide se attivare fallback Gemini.
//   - Browser CORS: Ollama serve di default con CORS aperto solo da localhost.
//     Se l'utente cambia baseUrl in qualcosa di esterno potrebbe avere problemi.

import type {
  LLMClient, LLMConfig, LLMModel, ProviderAdapter,
  GenerateJSONParams, GenerateTextParams, StreamChatParams, ChatTurn,
} from "./types";
import { parseRobustJSON } from "./_jsonParser";

const DEFAULT_CHAT_MODEL = "qwen2.5:7b-instruct";
const DEFAULT_BASE_URL = "http://localhost:11434";
const HEALTH_CHECK_TIMEOUT_MS = 2000;

// LocalStorage key dedicata per il baseUrl Ollama (non in LLMConfig per non
// rompere il tipo condiviso). Letto sync da createClient/health-check.
export const OLLAMA_BASE_URL_KEY = "ollama-base-url";

export function getOllamaBaseUrl(): string {
  try {
    const raw = (localStorage.getItem(OLLAMA_BASE_URL_KEY) || "").trim();
    if (raw) return raw.replace(/\/+$/, "");
  } catch { /* ignore (SSR/tests) */ }
  return DEFAULT_BASE_URL;
}

export function setOllamaBaseUrl(url: string): void {
  const clean = (url || "").trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem(OLLAMA_BASE_URL_KEY, clean);
  else localStorage.removeItem(OLLAMA_BASE_URL_KEY);
}

// ---------- Request-key dedupe (anti double-charge: qui niente costo, ma evita
// doppia computazione locale a fronte di doppio click rapido) ----------
const inflightJSON = new Map<string, Promise<unknown>>();

function jsonRequestKey(modelId: string, params: GenerateJSONParams): string {
  const raw = `${modelId}\0${params.systemInstruction}\0${params.userPrompt}\0${params.schemaHint || ""}\0${params.maxTokens || ""}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `ollama:${modelId}:${(h >>> 0).toString(36)}:${raw.length}`;
}

async function dedupedJSON<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflightJSON.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => {
    try { return await run(); }
    finally { inflightJSON.delete(key); }
  })();
  inflightJSON.set(key, p as Promise<unknown>);
  return p;
}

// ---------- Health check ----------
// Usato all'avvio + dal fallback automatico in index.ts. Timeout 2s perché
// localhost: se non risponde subito, non risponderà mai.
export async function ollamaHealthCheck(
  baseUrl: string = getOllamaBaseUrl(),
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/tags`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json() as { models?: Array<{ name: string }> };
    const models = (json.models || []).map(m => m.name).filter(Boolean);
    return { ok: true, models };
  } catch (e: any) {
    const isAbort = e?.name === "AbortError";
    return {
      ok: false,
      error: isAbort
        ? `Timeout ${HEALTH_CHECK_TIMEOUT_MS}ms: Ollama non raggiungibile su ${baseUrl}`
        : (e?.message || String(e)),
    };
  } finally {
    clearTimeout(t);
  }
}

async function throwIfNotOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = `${context} ${res.status}`;
    try {
      const j = JSON.parse(body);
      if (j?.error) msg = typeof j.error === "string" ? j.error : JSON.stringify(j.error);
    } catch { /* ignore */ }
    throw new Error(msg || body.slice(0, 200));
  }
}

// Mappatura history → formato Ollama `/api/chat`: ruoli "user" e "assistant".
type OllamaRole = "system" | "user" | "assistant";
interface OllamaChatMessage { role: OllamaRole; content: string }

function mapHistory(history: ChatTurn[]): OllamaChatMessage[] {
  return history.map(h => ({
    role: h.role === "model" ? "assistant" : "user",
    content: h.parts,
  }));
}

function createOllamaClient(config: LLMConfig): LLMClient {
  // NB: apiKey non è obbligatoria per Ollama (locale). Manteniamo il campo
  // nell'LLMConfig (può contenere una stringa placeholder tipo "local") per
  // compat con la firma dell'interfaccia LLMConfig.
  const modelId = config.modelId || DEFAULT_CHAT_MODEL;
  const baseUrl = getOllamaBaseUrl();

  async function callGenerate(opts: {
    system: string;
    prompt: string;
    temperature: number;
    maxTokens?: number;
    jsonMode?: boolean;
    signal?: AbortSignal;
  }): Promise<string> {
    const body: Record<string, unknown> = {
      model: modelId,
      system: opts.system,
      prompt: opts.prompt,
      stream: false,
      options: {
        temperature: opts.temperature,
        ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
      },
    };
    if (opts.jsonMode) body.format = "json";
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    await throwIfNotOk(res, "Ollama generate");
    const json = await res.json();
    return typeof json?.response === "string" ? json.response : "";
  }

  return {
    provider: "ollama",
    modelId,

    async generateJSON<T>(params: GenerateJSONParams): Promise<T> {
      const key = jsonRequestKey(modelId, params);
      return dedupedJSON<T>(key, async () => {
        const sys = `${params.systemInstruction}\n\nRispondi SOLO con un oggetto JSON valido, senza testo aggiuntivo.`;
        const prompt = params.schemaHint
          ? `${params.userPrompt}\n\nSchema JSON atteso:\n${params.schemaHint}`
          : params.userPrompt;
        const text = await callGenerate({
          system: sys,
          prompt,
          temperature: 0.6,
          maxTokens: params.maxTokens ?? 2048,
          jsonMode: true,
        });
        return parseRobustJSON<T>(text);
      });
    },

    async generateText(params: GenerateTextParams): Promise<string> {
      return callGenerate({
        system: params.systemInstruction,
        prompt: params.userPrompt,
        temperature: 0.7,
        maxTokens: params.maxTokens ?? 800,
      });
    },

    async *streamChat(params: StreamChatParams): AsyncGenerator<string> {
      const messages: OllamaChatMessage[] = [
        { role: "system", content: params.systemInstruction },
        ...mapHistory(params.history),
        { role: "user", content: params.userMessage },
      ];
      if (params.signal?.aborted) return;
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages,
          stream: true,
          options: { temperature: 0.7, num_predict: 1024 },
        }),
        signal: params.signal,
      });
      await throwIfNotOk(res, "Ollama chat stream");
      if (!res.body) throw new Error("Ollama: stream body mancante");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Ollama emette NDJSON: una linea = un JSON {message:{content},done}.
      const processLine = function* (line: string): Generator<string> {
        const s = line.trim();
        if (!s) return;
        try {
          const json = JSON.parse(s);
          const delta = json?.message?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch { /* skip malformed line */ }
      };
      while (true) {
        if (params.signal?.aborted) return;
        const { value, done } = await reader.read();
        if (done) {
          const finalDecode = decoder.decode();
          if (finalDecode) buffer += finalDecode;
          if (buffer.trim()) yield* processLine(buffer);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          yield* processLine(line);
        }
      }
    },

    // Volutamente NO embedContent: Ollama richiede modelli embedding separati
    // su /api/embeddings con dimensioni non compatibili con la cache RAG di
    // Gemini. RAG resta disabilitato in modalità Ollama (vedi banner Settings).
  };
}

// listModels usa /api/tags (= same endpoint del health check). Restituisce
// la lista di modelli effettivamente installati sull'host Ollama.
async function listOllamaModels(_apiKey: string, baseUrl?: string): Promise<LLMModel[]> {
  const url = `${(baseUrl || getOllamaBaseUrl()).replace(/\/+$/, "")}/api/tags`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ollama listModels ${res.status}`);
  const json = await res.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
  return (json.models || []).map<LLMModel>(m => ({
    id: m.name,
    displayName: m.details?.parameter_size ? `${m.name} (${m.details.parameter_size})` : m.name,
    supportsJSON: true,
    supportsEmbeddings: false,
  }));
}

export const ollamaAdapter: ProviderAdapter = {
  id: "ollama",
  displayName: "Ollama (locale)",
  defaultChatModel: DEFAULT_CHAT_MODEL,
  supportsEmbeddings: false,

  createClient: (config: LLMConfig): LLMClient => {
    // apiKey non richiesta. Usiamo un placeholder se vuota per non far scattare
    // LLMKeyMissingError nel layer chiamante (index.ts.hasLLMConfig controlla apiKey).
    if (!config.apiKey) {
      const cloned: LLMConfig = { ...config, apiKey: "local" };
      return createOllamaClient(cloned);
    }
    return createOllamaClient(config);
  },

  async listModels(apiKey: string): Promise<LLMModel[]> {
    return listOllamaModels(apiKey);
  },

  async ping(_apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
    const health = await ollamaHealthCheck();
    if (!health.ok) return { ok: false, error: health.error };
    // Se è stato specificato un modelId, verifica che sia tra quelli installati.
    if (modelId && health.models && health.models.length > 0) {
      const installed = health.models.some(m => m === modelId || m.startsWith(`${modelId}:`));
      if (!installed) {
        return {
          ok: false,
          error: `Modello '${modelId}' non installato. Esegui: ollama pull ${modelId}`,
        };
      }
    }
    return { ok: true };
  },
};

