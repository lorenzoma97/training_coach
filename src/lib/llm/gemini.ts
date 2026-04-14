import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import type {
  LLMClient, LLMConfig, LLMModel, ProviderAdapter,
  GenerateJSONParams, GenerateTextParams, StreamChatParams,
} from "./types";
import { LLMKeyMissingError } from "./types";
import { withRetry, isTransientError } from "./retry";

// Default: gemini-3.1-flash-lite-preview (stesso modello usato in nutribot v3).
// Il fallback automatico (usato quando il primario dà 503 persistente dopo retry)
// è gemini-2.5-flash-lite, stabile e disponibile.
const DEFAULT_CHAT_MODEL = "gemini-3.1-flash-lite-preview";
const FALLBACK_CHAT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

function parseJSONResponse<T>(text: string): T {
  // 1) Parse diretto
  try { return JSON.parse(text) as T; } catch { /* fallthrough */ }

  // 2) Rimuovi wrapper markdown ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()) as T; } catch { /* fallthrough */ }
  }

  // 3) Trova il PRIMO oggetto JSON bilanciando le graffe (non il regex greedy che
  //    fallisce se il modello ritorna due JSON separati — es. quando l'utente
  //    inserisce più obiettivi in un solo campo).
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try { return JSON.parse(candidate) as T; } catch { /* fallthrough */ }
          break;
        }
      }
    }
  }

  throw new Error(`Risposta JSON non valida dal coach. Riprova.\n(raw: ${text.slice(0, 200)}...)`);
}

function createGeminiClient(config: LLMConfig): LLMClient {
  if (!config.apiKey) throw new LLMKeyMissingError("gemini");
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const modelId = config.modelId || DEFAULT_CHAT_MODEL;

  // Fallback automatico: se il primario fallisce con errore transitorio (503/429)
  // anche dopo retry, prova con FALLBACK_CHAT_MODEL (solo se è un modello diverso).
  async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(primary, { maxRetries: 2 });
    } catch (e) {
      if (modelId !== FALLBACK_CHAT_MODEL && isTransientError(e)) {
        console.warn(`[Gemini] Primario '${modelId}' sovraccarico. Fallback a '${FALLBACK_CHAT_MODEL}'.`);
        return await withRetry(fallback, { maxRetries: 1 });
      }
      throw e;
    }
  }

  return {
    provider: "gemini",
    modelId,

    async generateJSON<T>(params: GenerateJSONParams): Promise<T> {
      const generationConfig: GenerationConfig = {
        temperature: 0.6,
        maxOutputTokens: params.maxTokens ?? 2048,
        responseMimeType: "application/json",
      };
      const fullPrompt = params.schemaHint
        ? `${params.userPrompt}\n\nRispondi SOLO con JSON valido secondo questo schema:\n${params.schemaHint}`
        : params.userPrompt;
      const gen = (id: string) => genAI
        .getGenerativeModel({ model: id, systemInstruction: params.systemInstruction, generationConfig })
        .generateContent(fullPrompt);
      const result = await withFallback(() => gen(modelId), () => gen(FALLBACK_CHAT_MODEL));
      return parseJSONResponse<T>(result.response.text());
    },

    async generateText(params: GenerateTextParams): Promise<string> {
      const gen = (id: string) => genAI
        .getGenerativeModel({
          model: id,
          systemInstruction: params.systemInstruction,
          generationConfig: { temperature: 0.7, maxOutputTokens: params.maxTokens ?? 800 },
        })
        .generateContent(params.userPrompt);
      const result = await withFallback(() => gen(modelId), () => gen(FALLBACK_CHAT_MODEL));
      return result.response.text();
    },

    async *streamChat(params: StreamChatParams): AsyncGenerator<string> {
      const startStream = (id: string) => {
        const model = genAI.getGenerativeModel({
          model: id,
          systemInstruction: params.systemInstruction,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        });
        const chat = model.startChat({
          history: params.history.map(h => ({ role: h.role, parts: [{ text: h.parts }] })),
        });
        return chat.sendMessageStream(params.userMessage);
      };
      // Fallback ok solo prima che parta lo stream (altrimenti perderemmo token già ricevuti)
      const result = await withFallback(() => startStream(modelId), () => startStream(FALLBACK_CHAT_MODEL));
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
    // Ordine preferito: primari stabili/usati > alternative. Default+fallback in cima.
    const rank = (id: string) => {
      const isExp = /-exp(\b|$|-)/.test(id);
      const base = (() => {
        if (id === DEFAULT_CHAT_MODEL) return 0;                       // default
        if (id === FALLBACK_CHAT_MODEL) return 1;                      // fallback
        if (/gemini-3\.1-flash-lite/.test(id)) return 2;               // varianti 3.1-lite
        if (/gemini-3-flash/.test(id)) return 3;
        if (/gemini-3/.test(id)) return 4;
        if (/gemini-2\.5-flash-lite/.test(id)) return 5;
        if (/gemini-2\.5-flash/.test(id)) return 6;
        if (/gemini-2\.5/.test(id)) return 7;
        if (/gemini-2\.0/.test(id)) return 8;
        if (/gemini-1\.5/.test(id)) return 9;
        return 10;
      })();
      return base + (isExp ? 20 : 0);
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
