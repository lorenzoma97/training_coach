// Golden tests user-custom catalog + Tier 3 auto-add integration (Sprint 3).

import { describe, it, expect, beforeEach } from "vitest";
import type { Exercise } from "../../types/exercise";
import {
  loadCustomExercises,
  saveCustomExercise,
  saveCustomExercisesBatch,
  deleteCustomExercise,
  clearCustomExercises,
  lookupExerciseHybrid,
  refreshCustomCache,
  buildExerciseFromMacroPayload,
} from "../customCatalog";

const FAKE_EX_1: Exercise = {
  id: "custom-compass-drill",
  name: "Compass Drill",
  pattern: "reactive",
  primaryMuscles: [],
  secondaryMuscles: [],
  equipment: ["bodyweight"],
  level: "intermediate",
  unilateral: false,
  technique: "Cono al centro + 4 coni a 3m N/S/E/O. Stimolo random direzione",
  guidance: [
    "Setup: 5 coni come bussola, partenza centro",
    "Esecuzione: stimolo direzione → sprint tocco → ritorno centro",
    "Respirazione: corta, focus visivo distribuito",
    "Errori comuni: anticipare, rotazione tronco, atterraggio rigido",
    "Sicurezza: 4-5 serie max, recupero 30s",
  ],
  alternatives: [],
  loadable: false,
};

const FAKE_EX_2: Exercise = {
  ...FAKE_EX_1,
  id: "custom-mirror-extended",
  name: "Mirror Drill Extended",
};

describe("customCatalog — storage CRUD", () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearCustomExercises();
    await refreshCustomCache();
  });

  it("loadCustomExercises ritorna [] su storage vuoto", async () => {
    const exs = await loadCustomExercises();
    expect(exs).toEqual([]);
  });

  it("saveCustomExercise + load round-trip", async () => {
    await saveCustomExercise(FAKE_EX_1);
    const exs = await loadCustomExercises();
    expect(exs).toHaveLength(1);
    expect(exs[0].id).toBe("custom-compass-drill");
    expect(exs[0].guidance).toHaveLength(5);
  });

  it("saveCustomExercise sostituisce esercizio con stesso id", async () => {
    await saveCustomExercise(FAKE_EX_1);
    const updated = { ...FAKE_EX_1, name: "Compass Drill v2" };
    await saveCustomExercise(updated);
    const exs = await loadCustomExercises();
    expect(exs).toHaveLength(1);
    expect(exs[0].name).toBe("Compass Drill v2");
  });

  it("saveCustomExercisesBatch aggiunge multipli", async () => {
    await saveCustomExercisesBatch([FAKE_EX_1, FAKE_EX_2]);
    const exs = await loadCustomExercises();
    expect(exs).toHaveLength(2);
  });

  it("deleteCustomExercise rimuove per id", async () => {
    await saveCustomExercisesBatch([FAKE_EX_1, FAKE_EX_2]);
    await deleteCustomExercise("custom-compass-drill");
    const exs = await loadCustomExercises();
    expect(exs).toHaveLength(1);
    expect(exs[0].id).toBe("custom-mirror-extended");
  });
});

describe("customCatalog — lookupExerciseHybrid", () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearCustomExercises();
    await refreshCustomCache();
  });

  it("trova esercizio dal catalog hardcoded (Tier 1)", () => {
    const ex = lookupExerciseHybrid("back-squat-barbell");
    expect(ex).toBeDefined();
    expect(ex!.name).toContain("Back Squat");
  });

  it("trova esercizio dal custom catalog (dopo refreshCustomCache)", async () => {
    await saveCustomExercise(FAKE_EX_1);
    await refreshCustomCache();
    const ex = lookupExerciseHybrid("custom-compass-drill");
    expect(ex).toBeDefined();
    expect(ex!.name).toBe("Compass Drill");
  });

  it("ritorna undefined se id sconosciuto", () => {
    const ex = lookupExerciseHybrid("non-existing-id-zzz");
    expect(ex).toBeUndefined();
  });

  it("hardcoded ha precedenza su custom in caso di collisione", async () => {
    const colliding: Exercise = { ...FAKE_EX_1, id: "back-squat-barbell", name: "Custom Squat Override" };
    await saveCustomExercise(colliding);
    await refreshCustomCache();
    const ex = lookupExerciseHybrid("back-squat-barbell");
    // Catalog hardcoded vince → non è "Custom Squat Override"
    expect(ex!.name).not.toBe("Custom Squat Override");
  });
});

describe("customCatalog — buildExerciseFromMacroPayload", () => {
  it("payload completo → Exercise valido", () => {
    const ex = buildExerciseFromMacroPayload({
      id: "new-drill-x",
      name: "New Drill X",
      pattern: "agility",
      equipment: ["bodyweight"],
      technique: "Spiegazione tecnica",
      guidance: ["Setup", "Esecuzione", "Respirazione", "Errori", "Sicurezza"],
    });
    expect(ex).not.toBeNull();
    expect(ex!.id).toBe("new-drill-x");
    expect(ex!.guidance).toHaveLength(5);
    expect(ex!.level).toBe("intermediate"); // default
  });

  it("payload senza name → null", () => {
    const ex = buildExerciseFromMacroPayload({
      id: "x",
      pattern: "agility",
      equipment: ["bodyweight"],
    });
    expect(ex).toBeNull();
  });

  it("payload senza pattern → null", () => {
    const ex = buildExerciseFromMacroPayload({
      id: "x",
      name: "X",
      equipment: ["bodyweight"],
    });
    expect(ex).toBeNull();
  });

  it("payload senza equipment → null", () => {
    const ex = buildExerciseFromMacroPayload({
      id: "x",
      name: "X",
      pattern: "agility",
    });
    expect(ex).toBeNull();
  });

  it("payload senza technique → usa name come fallback technique", () => {
    const ex = buildExerciseFromMacroPayload({
      id: "x",
      name: "X Drill",
      pattern: "agility",
      equipment: ["bodyweight"],
    });
    expect(ex!.technique).toBe("X Drill");
  });
});
