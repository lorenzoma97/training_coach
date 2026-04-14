import { GoogleGenerativeAI } from "@google/generative-ai";
import { getApiKey, hasApiKey, GeminiKeyMissingError } from "../gemini";
import { getJSON, setJSON, storage } from "../storage";
import { CHUNKS } from "./chunks";

const EMBED_MODEL = "text-embedding-004";
export const CACHE_KEY = "rag-embeddings-v1";

export interface EmbeddingCache {
  version: string;
  vectors: Record<string, number[]>;
  createdAt: string;
}

function computeVersion(): string {
  const sig = CHUNKS.map(c => c.id).join(",") + "|n=" + CHUNKS.length;
  // djb2 hash
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h) + sig.charCodeAt(i);
  return String(h >>> 0);
}

function client() {
  if (!hasApiKey()) throw new GeminiKeyMissingError();
  return new GoogleGenerativeAI(getApiKey()).getGenerativeModel({ model: EMBED_MODEL });
}

export async function ensureEmbeddings(onProgress?: (done: number, total: number) => void): Promise<EmbeddingCache> {
  if (!hasApiKey()) throw new GeminiKeyMissingError();
  const expected = computeVersion();
  let cache = await getJSON<EmbeddingCache | null>(CACHE_KEY, null);
  if (!cache || cache.version !== expected) {
    cache = { version: expected, vectors: {}, createdAt: new Date().toISOString() };
  }
  const model = client();
  const missing = CHUNKS.filter(c => !cache!.vectors[c.id]);
  for (let i = 0; i < missing.length; i++) {
    const chunk = missing[i];
    try {
      const r = await model.embedContent(chunk.content);
      cache.vectors[chunk.id] = r.embedding.values;
      if ((i + 1) % 5 === 0 || i === missing.length - 1) {
        await setJSON(CACHE_KEY, cache);
      }
      if (onProgress) onProgress(CHUNKS.length - missing.length + i + 1, CHUNKS.length);
    } catch (e) {
      console.error("[embedder] chunk failed:", chunk.id, e);
      // continue con gli altri, non fallire tutto
    }
  }
  await setJSON(CACHE_KEY, cache);
  return cache;
}

export async function embedQuery(text: string): Promise<number[]> {
  const model = client();
  const r = await model.embedContent(text);
  return r.embedding.values;
}

export async function clearEmbeddings(): Promise<void> {
  await storage.delete(CACHE_KEY);
}

export type CacheStatus = "ready" | "stale" | "missing" | "no-key";

export async function getCacheStatus(): Promise<CacheStatus> {
  if (!hasApiKey()) return "no-key";
  const cache = await getJSON<EmbeddingCache | null>(CACHE_KEY, null);
  if (!cache) return "missing";
  if (cache.version !== computeVersion()) return "stale";
  const present = CHUNKS.every(c => cache.vectors[c.id]);
  return present ? "ready" : "stale";
}
