import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { getJSON } from "./storage";

const MODEL_ID = "gemini-2.0-flash-exp";

export function getApiKey(): string {
  return (localStorage.getItem("gemini-api-key") || "").trim();
}

export function setApiKey(key: string): void {
  localStorage.setItem("gemini-api-key", key.trim());
}

export function hasApiKey(): boolean {
  // Gemini keys start with "AIza" and are ~39 chars — accettiamo qualsiasi stringa plausibile
  const k = getApiKey();
  return k.length >= 20 && !k.includes(" ");
}

export class GeminiKeyMissingError extends Error {
  constructor() { super("Chiave API Gemini non configurata. Vai in Impostazioni."); }
}

function client() {
  const key = getApiKey();
  if (!hasApiKey()) throw new GeminiKeyMissingError();
  return new GoogleGenerativeAI(key);
}

/** One-shot: genera JSON strutturato (response_mime_type). */
export async function generateJSON<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  schemaHint?: string;
  maxTokens?: number;
}): Promise<T> {
  const genAI = client();
  const config: GenerationConfig = {
    temperature: 0.6,
    maxOutputTokens: params.maxTokens ?? 2048,
    responseMimeType: "application/json",
  };
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction: params.systemInstruction,
    generationConfig: config,
  });
  const fullPrompt = params.schemaHint
    ? `${params.userPrompt}\n\nRispondi SOLO con JSON valido secondo questo schema:\n${params.schemaHint}`
    : params.userPrompt;
  const result = await model.generateContent(fullPrompt);
  const text = result.response.text();
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // Gemini a volte avvolge il JSON in ```json ... ``` nonostante response_mime_type
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* fallthrough */ }
    }
    throw new Error(`Risposta JSON non valida dal coach. Riprova.\n(raw: ${text.slice(0, 120)}...)`);
  }
}

/** One-shot: genera testo semplice (non streaming). */
export async function generateText(params: {
  systemInstruction: string;
  userPrompt: string;
  maxTokens?: number;
}): Promise<string> {
  const genAI = client();
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction: params.systemInstruction,
    generationConfig: { temperature: 0.7, maxOutputTokens: params.maxTokens ?? 800 },
  });
  const result = await model.generateContent(params.userPrompt);
  return result.response.text();
}

/** Streaming per chat libera. Restituisce async iterable di chunk testuali. */
export async function* streamChat(params: {
  systemInstruction: string;
  history: Array<{ role: "user" | "model"; parts: string }>;
  userMessage: string;
}): AsyncGenerator<string> {
  const genAI = client();
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
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
}

/** Test rapido chiave API. */
export async function pingApiKey(): Promise<{ ok: boolean; error?: string }> {
  try {
    const genAI = client();
    const model = genAI.getGenerativeModel({ model: MODEL_ID });
    const r = await model.generateContent("ping");
    return { ok: !!r.response.text() };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
