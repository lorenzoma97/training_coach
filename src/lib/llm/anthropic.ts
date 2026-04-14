import type {
  LLMClient, LLMConfig, LLMModel, ProviderAdapter,
  GenerateJSONParams, GenerateTextParams, StreamChatParams, ChatTurn,
} from "./types";
import { LLMKeyMissingError } from "./types";

const DEFAULT_CHAT_MODEL = "claude-haiku-4-5-20251001";
const BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicRole = "user" | "assistant";
interface AnthropicMessage { role: AnthropicRole; content: string }

function mapHistory(history: ChatTurn[]): AnthropicMessage[] {
  return history.map(h => ({
    role: h.role === "model" ? "assistant" : "user",
    content: h.parts,
  }));
}

function parseJSONResponse<T>(text: string): T {
  try { return JSON.parse(text) as T; } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* fallthrough */ }
    }
    throw new Error(`Risposta JSON non valida dal coach. Riprova.\n(raw: ${text.slice(0, 120)}...)`);
  }
}

function headers(apiKey: string): HeadersInit {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
    "content-type": "application/json",
  };
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

function createAnthropicClient(config: LLMConfig): LLMClient {
  if (!config.apiKey) throw new LLMKeyMissingError("anthropic");
  const apiKey = config.apiKey;
  const modelId = config.modelId || DEFAULT_CHAT_MODEL;

  async function callMessages(system: string, messages: AnthropicMessage[], maxTokens: number, temperature: number): Promise<string> {
    const res = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        model: modelId,
        system,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    await throwIfNotOk(res, "Anthropic messages");
    const json = await res.json();
    const content = json?.content;
    if (Array.isArray(content)) {
      const texts = content.filter((c: any) => c?.type === "text").map((c: any) => c.text || "");
      return texts.join("");
    }
    return "";
  }

  return {
    provider: "anthropic",
    modelId,

    async generateJSON<T>(params: GenerateJSONParams): Promise<T> {
      const system = `${params.systemInstruction}\n\nRispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza markdown code fences.`;
      const user = params.schemaHint
        ? `${params.userPrompt}\n\nSchema JSON atteso:\n${params.schemaHint}`
        : params.userPrompt;
      const text = await callMessages(system, [{ role: "user", content: user }], params.maxTokens ?? 2048, 0.6);
      return parseJSONResponse<T>(text);
    },

    async generateText(params: GenerateTextParams): Promise<string> {
      return callMessages(
        params.systemInstruction,
        [{ role: "user", content: params.userPrompt }],
        params.maxTokens ?? 800,
        0.7,
      );
    },

    async *streamChat(params: StreamChatParams): AsyncGenerator<string> {
      const messages: AnthropicMessage[] = [
        ...mapHistory(params.history),
        { role: "user", content: params.userMessage },
      ];
      const res = await fetch(`${BASE}/messages`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          model: modelId,
          system: params.systemInstruction,
          messages,
          max_tokens: 1024,
          temperature: 0.7,
          stream: true,
        }),
      });
      await throwIfNotOk(res, "Anthropic stream");
      if (!res.body) throw new Error("Anthropic: stream body mancante");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const json = JSON.parse(data);
            if (json?.type === "content_block_delta" && json?.delta?.type === "text_delta") {
              const t = json.delta.text;
              if (typeof t === "string" && t) yield t;
            }
          } catch { /* skip */ }
        }
      }
    },
    // Nessun embedContent: Anthropic non fornisce endpoint embeddings nativo.
  };
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  displayName: "Anthropic Claude",
  defaultChatModel: DEFAULT_CHAT_MODEL,
  supportsEmbeddings: false,

  createClient: createAnthropicClient,

  async listModels(apiKey: string): Promise<LLMModel[]> {
    const res = await fetch(`${BASE}/models`, { headers: headers(apiKey) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic listModels ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json() as { data?: Array<{ id: string; display_name?: string }> };
    const models = (json.data || []).map<LLMModel>(m => ({
      id: m.id,
      displayName: m.display_name || m.id,
      supportsJSON: true,
      supportsEmbeddings: false,
    }));
    return models;
  },

  async ping(apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${BASE}/messages`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          model: modelId || DEFAULT_CHAT_MODEL,
          max_tokens: 5,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let msg = `HTTP ${res.status}`;
        try { const j = JSON.parse(body); if (j?.error?.message) msg = j.error.message; } catch { /* ignore */ }
        return { ok: false, error: msg };
      }
      const j = await res.json();
      return { ok: Array.isArray(j?.content) };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
};
