import { describe, it, expect } from "vitest";
import { CHUNKS, type RagContext } from "../chunks";

const VALID_CONTEXTS: ReadonlySet<RagContext> = new Set<RagContext>([
  "macro_periodization",
  "strength_db",
  "cardio_intervals",
  "sport_specific",
  "mobility",
  "none",
]);

describe("Knowledge chunks — contexts tagging (Wave 2.1)", () => {
  it("each chunk has a contexts field defined (even if empty array)", () => {
    const broken = CHUNKS.filter(c => !Array.isArray(c.contexts));
    expect(broken.map(c => c.id)).toEqual([]);
  });

  it("each chunk's contexts contains at least 1 valid tag", () => {
    const broken = CHUNKS.filter(c => c.contexts.length === 0);
    expect(broken.map(c => c.id)).toEqual([]);
  });

  it("all context tags are valid RagContext values", () => {
    const broken: Array<{ chunkId: string; invalidContext: string }> = [];
    for (const c of CHUNKS) {
      for (const ctx of c.contexts) {
        if (!VALID_CONTEXTS.has(ctx)) {
          broken.push({ chunkId: c.id, invalidContext: ctx });
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("at least 1 chunk per non-'none' RagContext (coverage)", () => {
    const nonNoneContexts: RagContext[] = [
      "macro_periodization",
      "strength_db",
      "cardio_intervals",
      "sport_specific",
      "mobility",
    ];
    for (const ctx of nonNoneContexts) {
      const matching = CHUNKS.filter(c => c.contexts.includes(ctx));
      expect(matching.length, `Expected ≥1 chunk tagged with "${ctx}"`).toBeGreaterThanOrEqual(1);
    }
  });

  it("strength chunks (sec-11, sec-25, sec-26) are tagged strength_db", () => {
    const strengthIds = ["sec-11-resistance-training", "sec-25-strength-programming-practical", "sec-26-core-unilateral-training"];
    for (const id of strengthIds) {
      const chunk = CHUNKS.find(c => c.id === id);
      expect(chunk, `Missing chunk ${id}`).toBeDefined();
      expect(chunk!.contexts).toContain("strength_db");
    }
  });

  it("sport-specific chunks (sec-28 calcio, sec-29 tennis/padel) are tagged sport_specific", () => {
    const sportIds = ["sec-28-football-amateur", "sec-29-tennis-padel"];
    for (const id of sportIds) {
      const chunk = CHUNKS.find(c => c.id === id);
      expect(chunk, `Missing chunk ${id}`).toBeDefined();
      expect(chunk!.contexts).toContain("sport_specific");
    }
  });

  it("cardio zones chunks (sec-3, sec-4, sec-4b, sec-4c) are tagged cardio_intervals", () => {
    const cardioIds = ["sec-3-tanaka-hrmax", "sec-4-polarized-z2", "sec-4b-zones-5tier-karvonen-empirical", "sec-4c-polarization-check-practical"];
    for (const id of cardioIds) {
      const chunk = CHUNKS.find(c => c.id === id);
      expect(chunk, `Missing chunk ${id}`).toBeDefined();
      expect(chunk!.contexts).toContain("cardio_intervals");
    }
  });

  it("mobility/recovery chunks (sec-20, sec-32, sec-34) are tagged mobility", () => {
    const mobilityIds = ["sec-20-recovery-modalities", "sec-32-doms-management", "sec-34-stretching-mobility"];
    for (const id of mobilityIds) {
      const chunk = CHUNKS.find(c => c.id === id);
      expect(chunk, `Missing chunk ${id}`).toBeDefined();
      expect(chunk!.contexts).toContain("mobility");
    }
  });

  it("total chunk count >= 38 (Wave 2.1 baseline)", () => {
    expect(CHUNKS.length).toBeGreaterThanOrEqual(38);
  });

  it("all chunk IDs are unique", () => {
    const ids = CHUNKS.map(c => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
