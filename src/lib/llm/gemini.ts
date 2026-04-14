import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import type {
  LLMClient, LLMConfig, LLMModel, ProviderAdapter,
  GenerateJSONParams, GenerateTextParams, StreamChatParams,
} from "./types";
import { LLMKeyMissingError } from "./types";
import { withRetry, isTransientError } from "./retry";

// Default: Gemini 2.5 Flash (GA stabile). Modelli 3.x sono più recenti ma attualmente
// solo in preview → endpoint soggetto a 503 "high demand" frequenti. L'utente può
// selezionarli via "Scopri modelli" se li vuole usare consapevolmente.
const DEFAULT_CHAT_MODEL = "gemini-2.5-flash";
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
      const result = await withRetry(() => model.generateContent(fullPrompt), { maxRetries: 2 });
      return parseJSONResponse<T>(result.response.text());
    },

    async generateText(params: GenerateTextParams): Promise<string> {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: params.systemInstruction,
        generationConfig: { temperature: 0.7, maxOutputTokens: params.maxTokens ?? 800 },
      });
      const result = await withRetry(() => model.generateContent(params.userPrompt), { maxRetries: 2 });
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
      // Retry solo l'INIZIO dello stream (se fallisce con 503 al primo contatto).
      // Una volta che lo stream parte, non possiamo riprovarlo senza perdere i token già ricevuti.
      const result = await withRetry(() => chat.sendMessageStream(params.userMessage), { maxRetries: 2 });
      for await (const chunk of result.stream) {
        const t = chunk.text();
        if (t) yield t;
      }
    },

    async embedContent(text: string): Promise<number[]> {
      const model = genAI.getGenerativeModel({ model: DEFAULT_EMBEDDING_MODEL });
      const r = await withRetry(() => model.embedContent(text), { maxRetries: 2 });
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
    const res = await withRetry(async () => {
      const r = await fetch(url);
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`Gemini listModels ${r.status}: ${body.slice(0, 200)}`);
      }
      return r;
    }, { maxRetries: 2 });
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
    // Ordine preferito: 2.5-flash (GA stabile) > 3.1 > 3.0 > 2.0 > 1.5.
    // I preview (-preview, -exp) in fondo perché più instabili (503 frequenti).
    const rank = (id: string) => {
      const isPreview = /preview|exp/.test(id);
      const base = (() => {
        if (/gemini-2\.5-flash/.test(id) && !/lite/.test(id)) return 0;
        if (/gemini-2\.5/.test(id)) return 1;
        if (/gemini-3\.1-flash-lite/.test(id)) return 2;
        if (/gemini-3\./.test(id)) return 3;
        if (/gemini-2\.0/.test(id)) return 4;
        if (/gemini-1\.5/.test(id)) return 5;
        return 6;
      })();
      return base + (isPreview ? 10 : 0); // preview sempre dopo le GA
    };
    models.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
    return models;
  },

  async ping(apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelId || DEFAULT_CHAT_MODEL });
    try {
      const r = await withRetry(() => model.generateContent("ping"), { maxRetries: 2 });
      return { ok: !!r.response.text() };
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Errore transitorio dopo retry: la chiave è probabilmente OK ma il modello è sovraccarico
      if (isTransientError(e)) {
        return { ok: false, error: `Modello momentaneamente occupato (${modelId || DEFAULT_CHAT_MODEL}). Riprova tra qualche minuto o seleziona un altro modello.` };
      }
      return { ok: false, error: msg };
    }
  },
};
