import { getEmbeddingClient, hasLLMConfig, LLMKeyMissingError, getCurrentConfigSync } from "../llm";
import { getRagCache, setRagCache, deleteRagCache } from "../ragStorage";
import { CHUNKS } from "./chunks";

// Mantenuto per retrocompatibilità con consumer che lo importano (es. SettingsPage).
// La chiave fisica ora è in IndexedDB sotto "embeddings-v1" — questo è
// l'identificatore "logico" usato dai consumer e dagli eventi cross-tab legacy.
export const CACHE_KEY = "rag-embeddings-v1";

export interface EmbeddingCache {
  version: string;
  vectors: Record<string, number[]>;
  createdAt: string;
  /** N chunk che hanno fallito l'ultima generazione (per UI diagnostica). */
  lastFailures?: number;
  /** Messaggio di errore dell'ultimo fallimento (per UI diagnostica). */
  lastFailureMessage?: string;
}

/** Soglia minima di chunks presenti per considerare la cache "ready". */
const READY_THRESHOLD = 0.8;

// Bump quando cambia il modello embedding O cambia l'insieme di chunks:
// invalida tutte le cache esistenti.
// v2 = migrazione da text-embedding-004 (dismesso 2026-01) a gemini-embedding-001.
// v3 = espansione KB da 26 → 37 chunks (forza pratica, calcio, tennis/padel,
//      weight loss, nutrizione pratica, DOMS, allergie, core/unilateral,
//      stretching, readiness, return-to-run).
// v4 = polpaccio topic split + multi-sport chunk sec-36 + citation updates.
// v5 = enriched embedding text (title + topics + content), prima solo content.
//      Invalida tutte le cache v4 → re-embedding richiesto al primo open.
const EMBEDDER_SCHEMA_VERSION = "v5";

function computeVersion(): string {
  const sig = CHUNKS.map(c => c.id).join(",") + "|n=" + CHUNKS.length;
  // djb2 hash
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h) + sig.charCodeAt(i);
  // Includi provider + schema version: embeddings di provider/modelli diversi
  // hanno dimensione/semantica differenti e non sono compatibili.
  const cfg = getCurrentConfigSync();
  const prov = cfg?.provider ?? "none";
  return `${EMBEDDER_SCHEMA_VERSION}-${h >>> 0}-${prov}`;
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
  let cache = await getRagCache<EmbeddingCache>();
  if (!cache || cache.version !== expected) {
    cache = { version: expected, vectors: {}, createdAt: new Date().toISOString() };
  }
  const missing = CHUNKS.filter(c => !cache!.vectors[c.id]);
  let failures = 0;
  let lastError: string | undefined;
  for (let i = 0; i < missing.length; i++) {
    const chunk = missing[i];
    try {
      // Embed: title + topics + content per arricchire il segnale semantico
      // (prima era solo content; query "RED-S donne" non recuperava chunk con
      // "ciclo mestruale" buried in 3° paragrafo). Nota: questo invalida
      // implicitamente le cache pre-fix → versioning include questo cambio.
      const enrichedText = [
        chunk.title || "",
        Array.isArray(chunk.topics) ? chunk.topics.join(" ") : "",
        chunk.content,
      ].filter(Boolean).join("\n");
      const vec = await client.embedContent!(enrichedText);
      if (!vec || vec.length === 0) throw new Error("vector vuoto dal provider");
      cache.vectors[chunk.id] = vec;
      if ((i + 1) % 5 === 0 || i === missing.length - 1) {
        await setRagCache(cache);
      }
    } catch (e) {
      failures++;
      lastError = (e as Error)?.message || String(e);
      console.error("[embedder] chunk failed:", chunk.id, e);
    }
    if (onProgress) onProgress(CHUNKS.length - missing.length + i + 1, CHUNKS.length);
  }
  cache.lastFailures = failures;
  cache.lastFailureMessage = lastError;
  await setRagCache(cache);

  // Se tutti hanno fallito → errore leggibile per la UI.
  if (missing.length > 0 && failures === missing.length) {
    throw new Error(
      `Tutti i ${failures} embedding sono falliti. ` +
      (lastError ? `Errore: ${lastError}. ` : "") +
      `Verifica la chiave API e che il provider supporti il modello embedding.`
    );
  }
  return cache;
}

export async function embedQuery(text: string): Promise<number[]> {
  const client = getEmbedder();
  return client.embedContent!(text);
}

export async function clearEmbeddings(): Promise<void> {
  await deleteRagCache();
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
  const cache = await getRagCache<EmbeddingCache>();
  if (!cache) return "missing";
  if (cache.version !== computeVersion()) return "stale";
  // Tolleriamo fino al 20% di chunk mancanti: considera "ready" se ≥80% presenti.
  const presentCount = CHUNKS.reduce((n, c) => n + (cache.vectors[c.id] ? 1 : 0), 0);
  if (presentCount / CHUNKS.length >= READY_THRESHOLD) return "ready";
  return "stale";
}
