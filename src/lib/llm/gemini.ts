import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import type {
  LLMClient, LLMConfig, LLMModel, ProviderAdapter,
  GenerateJSONParams, GenerateTextParams, StreamChatParams,
} from "./types";
import { LLMKeyMissingError } from "./types";

const DEFAULT_CHAT_MODEL = "gemini-2.0-flash-exp";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

function parseJSONResponse<T>(text: string): T {
  try { return JSON.parse(text) as T; } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* fallthrough */ }
    }
    throw new Error(`Risposta JSON non valida dal coach. Riprova.\n(raw: ${text.slice(0, 120)}...)`);
  }
}

function createGeminiClient(config: LLMConfig): LLMClient {
  if (!config.apiKey) throw new LLMKeyMissingError("gemini");
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const modelId = config.modelId || DEFAULT_CHAT_MODEL;

  return {
    provider: "gemini",
    modelId,

    async generateJSON<T>(params: GenerateJSONParams): Promise<T> {
      const generationConfig: GenerationConfig = {
        temperature: 0.6,
        maxOutputTokens: params.maxTokens ?? 2048,
        responseMimeType: "application/json",
      };
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: params.systemInstruction,
        generationConfig,
      });
      const fullPrompt = params.schemaHint
        ? `${params.userPrompt}\n\nRispondi SOLO con JSON valido secondo questo schema:\n${params.schemaHint}`
        : params.userPrompt;
      const result = await model.generateContent(fullPrompt);
      return parseJSONResponse<T>(result.response.text());
    },

    async generateText(params: GenerateTextParams): Promise<string> {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: params.systemInstruction,
        generationConfig: { temperature: 0.7, maxOutputTokens: params.maxTokens ?? 800 },
      });
      const result = await model.generateContent(params.userPrompt);
      return result.response.text();
    },

    async *streamChat(params: StreamChatParams): AsyncGenerator<string> {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: params.systemInstruction,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      });
      const chat = model.startChat({
        history: params.history.map(h => ({ role: h.role, parts: [{ text: h.parts }] })),
      });
      const result = await chat.sendMessageStream(params.userMessage);
      for await (const chunk of result.stream) {
        const t = chunk.text();
        if (t) yield t;
      }
    },

    async embedContent(text: string): Promise<number[]> {
      const model = genAI.getGenerativeModel({ model: DEFAULT_EMBEDDING_MODEL });
      const r = await model.embedContent(text);
      return r.embedding.values;
    },
  };
}

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  displayName: "Google Gemini",
  defaultChatModel: DEFAULT_CHAT_MODEL,
  defaultEmbeddingModel: DEFAULT_EMBEDDING_MODEL,
  supportsEmbeddings: true,

  createClient: createGeminiClient,

  async listModels(apiKey: string): Promise<LLMModel[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini listModels ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json() as { models?: Array<{ name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }> };
    const models = (json.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .filter(m => !/embedding/i.test(m.name))
      .map<LLMModel>(m => ({
        id: m.name.replace(/^models\//, ""),
        displayName: m.displayName,
        contextWindow: m.inputTokenLimit,
        supportsJSON: true,
      }));
    // Ordine preferito: 2.0-flash > 1.5-*
    const rank = (id: string) => {
      if (/gemini-2\.0-flash/.test(id)) return 0;
      if (/gemini-2\./.test(id)) return 1;
      if (/gemini-1\.5/.test(id)) return 2;
      return 5;
    };
    models.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
    return models;
  },

  async ping(apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelId || DEFAULT_CHAT_MODEL });
      const r = await model.generateContent("ping");
      return { ok: !!r.response.text() };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
};
