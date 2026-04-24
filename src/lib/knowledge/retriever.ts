import { CHUNKS, type KnowledgeChunk } from "./chunks";
import { embedQuery, getCacheStatus } from "./embedder";
import { getRagCache } from "../ragStorage";
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
  // minScore alzato da 0.55 → 0.60 con la KB v3 (37 chunks): più chunks
  // significa maggior rischio di false-positive match tangenziali. Soglia
  // più selettiva mantiene precisione a scapito di recall (preferibile: se
  // nessun chunk passa, il coach risponde da conoscenza interna — spesso ok).
  const { query, topK = 3, minScore = 0.60 } = params;
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
    const cache = await getRagCache<EmbeddingCache>();
    if (!cache) return [];
    const qVec = await embedQuery(query);
    const scored: RetrievalResult[] = [];
    // Teniamo traccia di TUTTI i punteggi per stale-cache detection (fix #8),
    // prima del filtro minScore — così possiamo capire se la cache è degradata
    // (es. provider cambiato, embeddings vecchi) anche quando tutto viene filtrato via.
    const allScores: number[] = [];
    for (const chunk of CHUNKS) {
      const v = cache.vectors[chunk.id];
      if (!v) continue;
      const s = cosine(qVec, v);
      allScores.push(s);
      if (s >= minScore) scored.push({ chunk, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK);

    // Near-miss soft alert: top score in banda 0.50-0.60 (sotto minScore ma
    // sopra soglia "random"). Significa che c'è un chunk plausibile ma non
    // abbastanza pertinente da superare la soglia — il coach risponderà da
    // conoscenza interna. Utile per capire quando RAG fallisce silenziosamente.
    if (results.length === 0) {
      const topAllScore = allScores.length > 0 ? Math.max(...allScores) : 0;
      if (topAllScore >= 0.50 && topAllScore < 0.60) {
        console.warn(`[RAG] Near-miss: top score ${topAllScore.toFixed(2)} su KB — coach userà conoscenza interna`);
      }
    }

    // Fix #8 — stale cache detection. Se i top-N candidati (o, se insufficienti,
    // tutti gli scores calcolati) hanno similarity < 0.2 (soglia molto bassa),
    // probabilmente la cache embeddings è stale / incompatibile. Graceful
    // degradation: loggiamo un warning e ritorniamo comunque i risultati filtrati.
    const STALE_THRESHOLD = 0.2;
    const topForCheck = allScores
      .slice()
      .sort((a, b) => b - a)
      .slice(0, Math.max(topK, 1));
    const hasEnoughSamples = topForCheck.length > 0;
    const allBelowThreshold = hasEnoughSamples && topForCheck.every(s => s < STALE_THRESHOLD);
    if (allBelowThreshold) {
      console.warn("[RAG] Embeddings may be stale — all similarities near zero. Try regenerating knowledge base.");
    }

    return results;
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
