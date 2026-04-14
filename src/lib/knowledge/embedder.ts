import { getEmbeddingClient, hasLLMConfig, LLMKeyMissingError, getCurrentConfigSync } from "../llm";
import { getJSON, setJSON, storage } from "../storage";
import { CHUNKS } from "./chunks";

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
  // Includi il provider nell'identità del cache: embeddings di provider diversi
  // hanno dimensione/semantica differenti e non sono compatibili.
  const cfg = getCurrentConfigSync();
  const prov = cfg?.provider ?? "none";
  return String(h >>> 0) + "-" + prov;
}

function getEmbedder() {
  if (!hasLLMConfig()) throw new LLMKeyMissingError();
  const client = getEmbeddingClient();
  if (!client || !client.embedContent) {
    const cfg = getCurrentConfigSync();
    const err = new LLMKeyMissingError(cfg?.provider);
    err.message = "Il provider corrente non supporta embeddings. Embeddings disabilitati.";
    throw err;
  }
  return client;
}

export async function ensureEmbeddings(onProgress?: (done: number, total: number) => void): Promise<EmbeddingCache> {
  const client = getEmbedder();
  const expected = computeVersion();
  let cache = await getJSON<EmbeddingCache | null>(CACHE_KEY, null);
  if (!cache || cache.version !== expected) {
    cache = { version: expected, vectors: {}, createdAt: new Date().toISOString() };
  }
  const missing = CHUNKS.filter(c => !cache!.vectors[c.id]);
  for (let i = 0; i < missing.length; i++) {
    const chunk = missing[i];
    try {
      const vec = await client.embedContent!(chunk.content);
      cache.vectors[chunk.id] = vec;
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
  const client = getEmbedder();
  return client.embedContent!(text);
}

export async function clearEmbeddings(): Promise<void> {
  await storage.delete(CACHE_KEY);
}

export type CacheStatus = "ready" | "stale" | "missing" | "no-key" | "unsupported";

export async function getCacheStatus(): Promise<CacheStatus> {
  if (!hasLLMConfig()) return "no-key";
  const cfg = getCurrentConfigSync();
  if (cfg) {
    // Se il provider corrente non supporta embeddings, segnaliamo "unsupported".
    const client = getEmbeddingClient();
    if (!client || !client.embedContent) return "unsupported";
  }
  const cache = await getJSON<EmbeddingCache | null>(CACHE_KEY, null);
  if (!cache) return "missing";
  if (cache.version !== computeVersion()) return "stale";
  const present = CHUNKS.every(c => cache.vectors[c.id]);
  return present ? "ready" : "stale";
}
