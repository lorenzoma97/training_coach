// Wave 2.2 — Smoke + unit test per la logica di Step1RM (NO React DOM perché
// in questo progetto vitest gira in Node senza jsdom). Testiamo:
//  - import del componente non lancia errori (smoke)
//  - EMPTY_1RM_DRAFT contiene i 3 default lift attesi
//  - buildOneRepMaxesFromDraft filtra correttamente entry vuote / fuori range
//  - buildOneRepMaxesFromDraft produce shape OneRepMax conforme

import { describe, it, expect } from "vitest";
import StepStrength1RM, {
  EMPTY_1RM_DRAFT,
  buildOneRepMaxesFromDraft,
  type Step1RMDraft,
} from "../StepStrength1RM";
import { EXERCISES_BY_ID } from "../../../lib/catalog/exercises";

describe("StepStrength1RM (smoke)", () => {
  it("imports without throwing", () => {
    expect(StepStrength1RM).toBeDefined();
    expect(typeof StepStrength1RM).toBe("function");
  });

  it("EMPTY_1RM_DRAFT esposto con 3 default lift validi", () => {
    expect(EMPTY_1RM_DRAFT.entries).toHaveLength(3);
    const ids = EMPTY_1RM_DRAFT.entries.map(e => e.exerciseId);
    expect(ids).toContain("back-squat-barbell");
    expect(ids).toContain("bench-press-flat-barbell");
    expect(ids).toContain("deadlift-conventional-barbell");
    // Tutti i default ID esistono nel catalog
    for (const id of ids) {
      expect(EXERCISES_BY_ID[id]).toBeDefined();
      expect(EXERCISES_BY_ID[id].loadable).toBe(true);
    }
    // Default source = "tested", date = oggi
    for (const e of EMPTY_1RM_DRAFT.entries) {
      expect(e.valueKg).toBe("");
      expect(e.source).toBe("tested");
      expect(e.acquiredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("buildOneRepMaxesFromDraft", () => {
  it("returns [] per draft completamente vuoto", () => {
    const out = buildOneRepMaxesFromDraft(EMPTY_1RM_DRAFT);
    expect(out).toEqual([]);
  });

  it("estrae OneRepMax solo dalle entry compilate", () => {
    const draft: Step1RMDraft = {
      entries: [
        { exerciseId: "back-squat-barbell", valueKg: "120", source: "tested", acquiredAt: "2026-05-09" },
        { exerciseId: "bench-press-flat-barbell", valueKg: "", source: "tested", acquiredAt: "2026-05-09" },
        { exerciseId: "deadlift-conventional-barbell", valueKg: "150", source: "estimated", acquiredAt: "2026-05-01" },
      ],
    };
    const out = buildOneRepMaxesFromDraft(draft);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      exerciseId: "back-squat-barbell",
      value_kg: 120,
      source: "tested",
      acquiredAt: "2026-05-09",
    });
    expect(out[1].exerciseId).toBe("deadlift-conventional-barbell");
    expect(out[1].source).toBe("estimated");
  });

  it("scarta valori fuori range (< 5 o > 500)", () => {
    const draft: Step1RMDraft = {
      entries: [
        { exerciseId: "back-squat-barbell", valueKg: "2", source: "tested", acquiredAt: "2026-05-09" },
        { exerciseId: "bench-press-flat-barbell", valueKg: "999", source: "tested", acquiredAt: "2026-05-09" },
        { exerciseId: "deadlift-conventional-barbell", valueKg: "200", source: "tested", acquiredAt: "2026-05-09" },
      ],
    };
    const out = buildOneRepMaxesFromDraft(draft);
    expect(out).toHaveLength(1);
    expect(out[0].exerciseId).toBe("deadlift-conventional-barbell");
  });

  it("scarta exerciseId non in catalog (defensive)", () => {
    const draft: Step1RMDraft = {
      entries: [
        { exerciseId: "totally-fake-exercise-id", valueKg: "100", source: "tested", acquiredAt: "2026-05-09" },
      ],
    };
    expect(buildOneRepMaxesFromDraft(draft)).toEqual([]);
  });

  it("accetta virgola decimale (locale italiano)", () => {
    const draft: Step1RMDraft = {
      entries: [
        { exerciseId: "back-squat-barbell", valueKg: "100,5", source: "tested", acquiredAt: "2026-05-09" },
      ],
    };
    const out = buildOneRepMaxesFromDraft(draft);
    expect(out).toHaveLength(1);
    expect(out[0].value_kg).toBe(100.5);
  });

  it("arrotonda a 1 decimale", () => {
    const draft: Step1RMDraft = {
      entries: [
        { exerciseId: "back-squat-barbell", valueKg: "100.456", source: "tested", acquiredAt: "2026-05-09" },
      ],
    };
    const out = buildOneRepMaxesFromDraft(draft);
    expect(out[0].value_kg).toBe(100.5);
  });

  it("riempie acquiredAt con oggi se vuoto", () => {
    const draft: Step1RMDraft = {
      entries: [
        { exerciseId: "back-squat-barbell", valueKg: "100", source: "tested", acquiredAt: "" },
      ],
    };
    const out = buildOneRepMaxesFromDraft(draft);
    expect(out[0].acquiredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
