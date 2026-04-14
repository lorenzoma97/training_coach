import { CHUNKS, type KnowledgeChunk } from "./chunks";
import { embedQuery, getCacheStatus, CACHE_KEY } from "./embedder";
import { getJSON } from "../storage";
import { hasApiKey } from "../gemini";
import { getEmbeddingClient } from "../llm";
import type { EmbeddingCache } from "./embedder";

export interface RetrievalResult {
  chunk: KnowledgeChunk;
  score: number;
}

function cosine(a: number[], b: number[]): number {
  // Guard: vettori di dimensione diversa (es. provider switch senza rigenerare KB)
  // NON usare similarity nonsensical. Ritorna 0 → retriever filtra via.
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function retrieveRelevantChunks(params: {
  query: string;
  topK?: number;
  minScore?: number;
}): Promise<RetrievalResult[]> {
  const { query, topK = 3, minScore = 0.55 } = params;
  if (!query.trim()) return [];
  if (!hasApiKey()) return [];
  // Se il provider corrente non supporta embeddings, salta RAG silenziosamente.
  if (!getEmbeddingClient()) return [];
  if (typeof navigator !== "undefined" && !navigator.onLine) return [];

  // NON generiamo embeddings in runtime chat: se la cache non è pronta, esci.
  // L'utente rigenera la cache dal pulsante in Impostazioni.
  const status = await getCacheStatus();
  if (status !== "ready") return [];

  try {
    const cache = await getJSON<EmbeddingCache | null>(CACHE_KEY, null);
    if (!cache) return [];
    const qVec = await embedQuery(query);
    const scored: RetrievalResult[] = [];
    for (const chunk of CHUNKS) {
      const v = cache.vectors[chunk.id];
      if (!v) continue;
      const s = cosine(qVec, v);
      if (s >= minScore) scored.push({ chunk, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (e) {
    console.error("[retriever] failed:", e);
    return [];
  }
}

export function chunksAsPromptBlock(results: RetrievalResult[]): string {
  if (!results.length) return "";
  const parts = results.map(r => {
    const link = r.chunk.links[0] || "";
    return `### ${r.chunk.title} (similarità ${r.score.toFixed(2)}) — ref: ${r.chunk.primaryCitation}
${r.chunk.content}
${link ? "Link: " + link : ""}`.trim();
  });
  return `## Evidenza scientifica pertinente (recuperata dal knowledge base del coach):\n\n${parts.join("\n\n")}`;
}
