import type {
  LLMClient, LLMConfig, LLMModel, ProviderAdapter,
  GenerateJSONParams, GenerateTextParams, StreamChatParams, ChatTurn,
} from "./types";
import { LLMKeyMissingError } from "./types";
import { withRetry, isTransientError } from "./retry";
import { parseRobustJSON } from "./_jsonParser";

const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

const BASE = "https://api.openai.com/v1";

type OAIRole = "system" | "user" | "assistant";
interface OAIMessage { role: OAIRole; content: string }

function mapHistory(history: ChatTurn[]): OAIMessage[] {
  return history.map(h => ({
    role: h.role === "model" ? "assistant" : "user",
    content: h.parts,
  }));
}

// Usa il parser robusto condiviso (direct JSON → markdown fence → balanced brace
// extraction → truncation detection). Vedi `./_jsonParser.ts`.
function parseJSONResponse<T>(text: string): T {
  return parseRobustJSON<T>(text);
}

// ---------- Request-key dedupe (anti double-charge) ----------
// Stessa logica dell'adapter Gemini: coalesce chiamate identiche in-flight per
// evitare token-waste su doppio-click rapido dell'utente.
const inflightJSON = new Map<string, Promise<unknown>>();

function jsonRequestKey(modelId: string, params: GenerateJSONParams): string {
  const raw = `${modelId}\0${params.systemInstruction}\0${params.userPrompt}\0${params.schemaHint || ""}\0${params.maxTokens || ""}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `openai:${modelId}:${(h >>> 0).toString(36)}:${raw.length}`;
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

async function oaiFetch(apiKey: string, path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function throwIfNotOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = `${context} ${res.status}`;
    try {
      const j = JSON.parse(body);
      if (j?.error?.message) msg = j.error.message;
    } catch { /* ignore */ }
    throw new Error(msg || body.slice(0, 200));
  }
}

function createOpenAIClient(config: LLMConfig): LLMClient {
  if (!config.apiKey) throw new LLMKeyMissingError("openai");
  const apiKey = config.apiKey;
  const modelId = config.modelId || DEFAULT_CHAT_MODEL;

  async function chatCompletion(messages: OAIMessage[], opts: { maxTokens?: number; temperature?: number; jsonMode?: boolean }): Promise<string> {
    const body: any = {
      model: modelId,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    const res = await oaiFetch(apiKey, "/chat/completions", body);
    await throwIfNotOk(res, "OpenAI chat");
    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? "";
  }

  return {
    provider: "openai",
    modelId,

    async generateJSON<T>(params: GenerateJSONParams): Promise<T> {
      // Dedupe request-key (anti double-charge su doppio-click utente).
      const key = jsonRequestKey(modelId, params);
      return dedupedJSON<T>(key, async () => {
        const sys = `${params.systemInstruction}\n\nRispondi SOLO con un oggetto JSON valido, senza testo aggiuntivo.`;
        const user = params.schemaHint
          ? `${params.userPrompt}\n\nSchema JSON atteso:\n${params.schemaHint}`
          : params.userPrompt;
        // Retry di rete NON applicato qui: OpenAI chatCompletion gestisce già
        // timeout/errori a livello di fetch. Se parseJSONResponse fallisce NON
        // ritentiamo (errore di validazione != errore di rete, evitiamo token-waste).
        const text = await chatCompletion(
          [{ role: "system", content: sys }, { role: "user", content: user }],
          { maxTokens: params.maxTokens ?? 2048, temperature: 0.6, jsonMode: true },
        );
        return parseJSONResponse<T>(text);
      });
    },

    async generateText(params: GenerateTextParams): Promise<string> {
      return chatCompletion(
        [{ role: "system", content: params.systemInstruction }, { role: "user", content: params.userPrompt }],
        { maxTokens: params.maxTokens ?? 800, temperature: 0.7 },
      );
    },

    async *streamChat(params: StreamChatParams): AsyncGenerator<string> {
      const messages: OAIMessage[] = [
        { role: "system", content: params.systemInstruction },
        ...mapHistory(params.history),
        { role: "user", content: params.userMessage },
      ];
      const res = await oaiFetch(apiKey, "/chat/completions", {
        model: modelId,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
        stream: true,
      });
      await throwIfNotOk(res, "OpenAI stream");
      if (!res.body) throw new Error("OpenAI: stream body mancante");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const processLine = function* (line: string): Generator<string> {
        const s = line.trim();
        if (!s.startsWith("data:")) return;
        const data = s.slice(5).trim();
        if (!data || data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch { /* skip malformed */ }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // Flush del buffer residuo (ultimo chunk senza newline terminale)
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

    async embedContent(text: string): Promise<number[]> {
      const res = await oaiFetch(apiKey, "/embeddings", {
        model: DEFAULT_EMBEDDING_MODEL,
        input: text,
      });
      await throwIfNotOk(res, "OpenAI embeddings");
      const json = await res.json();
      const vec = json?.data?.[0]?.embedding;
      if (!Array.isArray(vec)) throw new Error("OpenAI embeddings: risposta invalida");
      return vec as number[];
    },
  };
}

const MODEL_INCLUDE_RE = /^(gpt-|o1|o3|o4)/i;
const MODEL_EXCLUDE_RE = /(embedding|whisper|tts|audio|image|dall-e|realtime|moderation|transcribe|search)/i;

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  displayName: "OpenAI",
  defaultChatModel: DEFAULT_CHAT_MODEL,
  defaultEmbeddingModel: DEFAULT_EMBEDDING_MODEL,
  supportsEmbeddings: true,

  createClient: createOpenAIClient,

  async listModels(apiKey: string): Promise<LLMModel[]> {
    const res = await withRetry(async () => {
      const r = await fetch(`${BASE}/models`, { headers: { "Authorization": `Bearer ${apiKey}` } });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`OpenAI listModels ${r.status}: ${body.slice(0, 200)}`);
      }
      return r;
    }, { maxRetries: 2 });
    const json = await res.json() as { data?: Array<{ id: string }> };
    const models = (json.data || [])
      .filter(m => MODEL_INCLUDE_RE.test(m.id) && !MODEL_EXCLUDE_RE.test(m.id))
      .map<LLMModel>(m => ({ id: m.id, displayName: m.id, supportsJSON: true }));
    // preferenza: gpt-4o-mini > gpt-4o > gpt-4 > o-series
    const rank = (id: string) => {
      if (id === "gpt-4o-mini") return 0;
      if (id.startsWith("gpt-4o")) return 1;
      if (id.startsWith("gpt-4")) return 2;
      if (/^o[0-9]/.test(id)) return 3;
      if (id.startsWith("gpt-")) return 4;
      return 9;
    };
    models.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
    return models;
  },

  async ping(apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const j = await withRetry(async () => {
        const res = await oaiFetch(apiKey, "/chat/completions", {
          model: modelId || DEFAULT_CHAT_MODEL,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          let msg = `HTTP ${res.status}`;
          try { const parsed = JSON.parse(body); if (parsed?.error?.message) msg = parsed.error.message; } catch { /* ignore */ }
          throw new Error(msg);
        }
        return res.json();
      }, { maxRetries: 2 });
      return { ok: !!j?.choices?.[0]?.message };
    } catch (e: any) {
      if (isTransientError(e)) {
        return { ok: false, error: `Modello momentaneamente occupato (${modelId || DEFAULT_CHAT_MODEL}). Riprova tra qualche minuto o seleziona un altro modello.` };
      }
      return { ok: false, error: e?.message || String(e) };
    }
  },
};
