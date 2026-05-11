import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RagContext } from "../chunks";

// --- Mock delle dipendenze runtime del retriever ---------------------------
// Tutto il behavior side-effect (api key, embedding client, IndexedDB, navigator)
// è stub-bato per eseguire la logica di context routing in isolamento.
vi.mock("../../gemini", () => ({
  hasApiKey: () => true,
}));
vi.mock("../../llm", () => ({
  getEmbeddingClient: () => ({}), // placeholder truthy
}));
vi.mock("../../ragStorage", () => ({
  getRagCache: vi.fn(),
}));
vi.mock("../embedder", () => ({
  embedQuery: vi.fn(),
  getCacheStatus: vi.fn(async () => "ready"),
}));

// `navigator.onLine` true di default in jsdom; se mancasse: vitest config
// usa happy-dom/jsdom a seconda del progetto. Per safety:
if (typeof navigator !== "undefined" && !("onLine" in navigator)) {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
}

// Import DOPO i mock per garantire che vengano applicati.
import { CHUNKS } from "../chunks";
import { retrieveRelevantChunks } from "../retriever";
import { contextsForPass, type PassKind } from "../index";
import * as ragStorage from "../../ragStorage";
import * as embedder from "../embedder";

// Helper: costruisce una "fake cache" che restituisce uno score deterministico
// pari a (score per chunk indicato nel map) o uno score di default piccolo.
// La similarity è cosine: usiamo vettori 1D pre-normalizzati == valore desiderato.
// Trick: vettori unitari su asse + (1, 0) vs (cos, sin) → cos = sim. Manteniamo
// semplice: vettori 2D normalizzati su angolo. qVec=[1,0], chunkVec=[s, sqrt(1-s^2)].
function makeUnitVecForScore(s: number): number[] {
  const clamped = Math.max(-1, Math.min(1, s));
  const orth = Math.sqrt(Math.max(0, 1 - clamped * clamped));
  return [clamped, orth];
}

function setupCache(scoresById: Record<string, number>, defaultScore = 0.0) {
  const vectors: Record<string, number[]> = {};
  for (const c of CHUNKS) {
    const s = scoresById[c.id] ?? defaultScore;
    vectors[c.id] = makeUnitVecForScore(s);
  }
  (ragStorage.getRagCache as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    version: "test",
    vectors,
    createdAt: new Date().toISOString(),
  });
  // Query vec è [1, 0] → cosine(qVec, chunkVec) == chunkVec[0] == s.
  (embedder.embedQuery as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([1, 0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  (embedder.getCacheStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("ready");
});

// ---------------------------------------------------------------------------
// retrieveRelevantChunks — context routing
// ---------------------------------------------------------------------------
describe("retrieveRelevantChunks — Wave 4.2 context routing", () => {
  it("opts.contexts omesso → backward compat (no filter, search su tutti i CHUNKS)", async () => {
    // Score alto su un chunk di un context "raro" (sport_specific) e su uno di
    // un altro context. Senza filter, deve poter pescare entrambi.
    setupCache({
      "sec-28-football-amateur": 0.95,        // sport_specific
      "sec-1-progression-rule": 0.90,         // macro_periodization
    });
    const r = await retrieveRelevantChunks({ query: "anything", topK: 2, minScore: 0.6 });
    expect(r.length).toBe(2);
    const ids = r.map(x => x.chunk.id).sort();
    expect(ids).toEqual(["sec-1-progression-rule", "sec-28-football-amateur"].sort());
  });

  it("opts.contexts = [] → trattato come no filter (backward compat)", async () => {
    setupCache({
      "sec-28-football-amateur": 0.95,
      "sec-1-progression-rule": 0.90,
    });
    const r = await retrieveRelevantChunks({ query: "x", topK: 2, minScore: 0.6, contexts: [] });
    expect(r.length).toBe(2);
  });

  it('opts.contexts = ["macro_periodization"] → solo chunks con quel tag', async () => {
    // Diamo punteggio top a un chunk SOLO sport_specific (non taggato macro)
    // e a un chunk macro_periodization. Con filter "macro_periodization", lo
    // sport_specific NON deve apparire.
    const sportOnlyChunk = CHUNKS.find(c =>
      c.contexts.includes("sport_specific") && !c.contexts.includes("macro_periodization")
    );
    expect(sportOnlyChunk, "fixture: serve almeno 1 chunk sport_specific senza macro_periodization").toBeDefined();

    setupCache({
      [sportOnlyChunk!.id]: 0.99,             // sport_specific only — deve essere ESCLUSO
      "sec-1-progression-rule": 0.85,         // macro_periodization
      "sec-2-acwr": 0.80,                     // macro_periodization
    });
    const r = await retrieveRelevantChunks({
      query: "x",
      topK: 5,
      minScore: 0.6,
      contexts: ["macro_periodization"],
    });
    const ids = r.map(x => x.chunk.id);
    expect(ids).not.toContain(sportOnlyChunk!.id);
    expect(ids).toContain("sec-1-progression-rule");
    for (const res of r) {
      expect(res.chunk.contexts).toContain("macro_periodization");
    }
  });

  it("intersezione vuota (no chunks matching) → fallback su pool completo + warn console", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // "none" non è usato da nessun chunk → intersezione vuota.
    const noneCount = CHUNKS.filter(c => c.contexts.includes("none")).length;
    expect(noneCount).toBe(0);

    setupCache({ "sec-1-progression-rule": 0.90 });
    const r = await retrieveRelevantChunks({
      query: "x",
      topK: 3,
      minScore: 0.6,
      contexts: ["none"],
    });
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.map(x => x.chunk.id)).toContain("sec-1-progression-rule");
    expect(warnSpy).toHaveBeenCalled();
    const msgs = warnSpy.mock.calls.map(c => String(c[0]));
    expect(msgs.some(m => m.includes("Context filter") && m.includes("falling back"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("subset filtrato < topK → fallback al pool completo + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // strength_db ha solo ~4 chunks (sec-11, sec-25, sec-26, sec-15-loaded-carries).
    // Chiediamo topK=20: sotto-soglia → fallback.
    const strengthCount = CHUNKS.filter(c => c.contexts.includes("strength_db")).length;
    expect(strengthCount).toBeLessThan(20);

    setupCache({
      "sec-25-strength-programming-practical": 0.95, // strength_db
      "sec-1-progression-rule": 0.90,                // macro_periodization (NOT strength)
    });
    const r = await retrieveRelevantChunks({
      query: "x",
      topK: 20,
      minScore: 0.6,
      contexts: ["strength_db"],
    });
    // Con fallback, anche i chunk non-strength devono comparire.
    expect(r.map(x => x.chunk.id)).toContain("sec-1-progression-rule");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("topK rispettato POST-filter (non clamp pre-fallback)", async () => {
    // strength_db è abbastanza popolato per topK=2 → niente fallback.
    setupCache({
      "sec-25-strength-programming-practical": 0.95,
      "sec-26-core-unilateral-training": 0.90,
      "sec-11-resistance-training": 0.85,
      "sec-1-progression-rule": 0.99, // alto ma fuori filter → escluso
    });
    const r = await retrieveRelevantChunks({
      query: "x",
      topK: 2,
      minScore: 0.6,
      contexts: ["strength_db"],
    });
    expect(r.length).toBe(2);
    expect(r.map(x => x.chunk.id)).not.toContain("sec-1-progression-rule");
    for (const res of r) {
      expect(res.chunk.contexts).toContain("strength_db");
    }
  });

  it("cosine similarity ordering preservato (post-filter)", async () => {
    setupCache({
      "sec-25-strength-programming-practical": 0.70, // strength_db, score basso
      "sec-26-core-unilateral-training": 0.95,       // strength_db, score alto
      "sec-11-resistance-training": 0.85,            // strength_db, medio
    });
    const r = await retrieveRelevantChunks({
      query: "x",
      topK: 3,
      minScore: 0.6,
      contexts: ["strength_db"],
    });
    expect(r.length).toBe(3);
    // Ordinato discending.
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    }
    expect(r[0].chunk.id).toBe("sec-26-core-unilateral-training");
  });

  it("intersezione multi-context (OR): chunk taggato con almeno 1 dei contexts richiesti passa", async () => {
    // sec-7-pain-monitoring è ["mobility", "macro_periodization"].
    // Filter contexts=["sport_specific","mobility"] → match per "mobility".
    setupCache({
      "sec-7-pain-monitoring": 0.90,
    });
    const r = await retrieveRelevantChunks({
      query: "x",
      topK: 2,
      minScore: 0.6,
      contexts: ["sport_specific", "mobility"],
    });
    expect(r.map(x => x.chunk.id)).toContain("sec-7-pain-monitoring");
  });
});

// ---------------------------------------------------------------------------
// contextsForPass — mapping deterministico
// ---------------------------------------------------------------------------
describe("contextsForPass — mapping snapshot", () => {
  it("snapshot per tutti i PassKind (no workoutType)", () => {
    const passes: PassKind[] = [
      "pass1_skeleton",
      "pass2_strength",
      "pass2_cardio",
      "chat",
      "session_feedback",
      "weekly_report",
    ];
    const snap: Record<string, RagContext[]> = {};
    for (const p of passes) snap[p] = contextsForPass(p);
    expect(snap).toEqual({
      pass1_skeleton: ["macro_periodization", "cardio_intervals", "strength_db"],
      pass2_strength: ["strength_db", "macro_periodization"],
      pass2_cardio: ["cardio_intervals", "macro_periodization"],
      chat: [],
      session_feedback: ["macro_periodization", "mobility"],
      weekly_report: ["macro_periodization", "mobility"],
    });
  });

  it("session_feedback con workoutType arricchisce i contexts", () => {
    expect(contextsForPass("session_feedback", "strength")).toEqual([
      "macro_periodization", "mobility", "strength_db",
    ]);
    expect(contextsForPass("session_feedback", "cardio")).toEqual([
      "macro_periodization", "mobility", "cardio_intervals",
    ]);
    expect(contextsForPass("session_feedback", "sport")).toEqual([
      "macro_periodization", "mobility", "sport_specific",
    ]);
    expect(contextsForPass("session_feedback", "mobility")).toEqual([
      "mobility", "macro_periodization",
    ]);
    expect(contextsForPass("session_feedback", "mixed")).toEqual([
      "macro_periodization", "mobility", "strength_db", "cardio_intervals",
    ]);
  });

  it("chat ritorna [] (no filter — coach può attingere a tutto)", () => {
    expect(contextsForPass("chat")).toEqual([]);
  });

  it("ogni mapping contiene solo valori RagContext validi", () => {
    const VALID: ReadonlySet<RagContext> = new Set([
      "macro_periodization", "strength_db", "cardio_intervals",
      "sport_specific", "mobility", "none",
    ]);
    const passes: PassKind[] = [
      "pass1_skeleton", "pass2_strength", "pass2_cardio",
      "chat", "session_feedback", "weekly_report",
    ];
    for (const p of passes) {
      for (const ctx of contextsForPass(p)) {
        expect(VALID.has(ctx), `${p} → ${ctx} non valido`).toBe(true);
      }
    }
  });
});
