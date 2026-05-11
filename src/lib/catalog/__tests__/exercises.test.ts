import { describe, it, expect } from "vitest";
import { EXERCISES, EXERCISES_BY_ID, EXERCISE_IDS } from "../exercises";
import type { ExercisePattern } from "../../types/exercise";
import { walkAlternativeChain } from "../../coach/equipmentSubstitutor";

describe("Exercise catalog", () => {
  it("contains at least 80 exercises (G2 acceptance)", () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(80);
  });

  it("has all unique IDs", () => {
    const ids = EXERCISES.map(e => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("EXERCISES_BY_ID lookup is consistent", () => {
    expect(Object.keys(EXERCISES_BY_ID).length).toBe(EXERCISES.length);
    for (const ex of EXERCISES) {
      expect(EXERCISES_BY_ID[ex.id]).toBe(ex);
    }
  });

  it("EXERCISE_IDS set matches EXERCISES", () => {
    expect(EXERCISE_IDS.size).toBe(EXERCISES.length);
    for (const ex of EXERCISES) {
      expect(EXERCISE_IDS.has(ex.id)).toBe(true);
    }
  });

  it("all alternatives reference existing exercise IDs (consistency check)", () => {
    const allIds = new Set(EXERCISES.map(e => e.id));
    const broken: Array<{ exerciseId: string; missingAlt: string }> = [];
    for (const ex of EXERCISES) {
      for (const altId of ex.alternatives) {
        if (!allIds.has(altId)) {
          broken.push({ exerciseId: ex.id, missingAlt: altId });
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("each exercise has at least 1 primary muscle", () => {
    const broken = EXERCISES.filter(e => e.primaryMuscles.length === 0);
    expect(broken).toEqual([]);
  });

  it("each exercise has at least 1 equipment tag", () => {
    const broken = EXERCISES.filter(e => e.equipment.length === 0);
    expect(broken).toEqual([]);
  });

  it("each exercise has a non-empty technique cue", () => {
    const broken = EXERCISES.filter(e => !e.technique || e.technique.trim().length < 20);
    expect(broken).toEqual([]);
  });

  it("each exercise has at least 1 alternative", () => {
    const broken = EXERCISES.filter(e => e.alternatives.length === 0);
    expect(broken).toEqual([]);
  });

  // Coverage per pattern (G2 + ARCHITECTURE.md spec):
  // squat ≥10 · hinge ≥10 · lunge ≥6 · horizontal_push ≥10 · vertical_push ≥8
  // horizontal_pull ≥8 · vertical_pull ≥6 · carry ≥3 · core_antiext ≥4
  // core_antirot ≥4 · plyometric ≥4 · isometric ≥3 (calf, balance, etc.)
  const PATTERN_MINIMUMS: Record<ExercisePattern, number> = {
    squat: 10,
    hinge: 10,
    lunge: 6,
    horizontal_push: 10,
    vertical_push: 8,
    horizontal_pull: 8,
    vertical_pull: 6,
    carry: 3,
    core_antiext: 4,
    core_antirot: 4,
    plyometric: 4,
    isometric: 3,
    mobility: 0, // mobility tracked separately in mobilityRoutines.ts
  };

  for (const [pattern, minimum] of Object.entries(PATTERN_MINIMUMS)) {
    if (minimum === 0) continue;
    it(`has at least ${minimum} ${pattern} exercises`, () => {
      const count = EXERCISES.filter(e => e.pattern === pattern).length;
      expect(count).toBeGreaterThanOrEqual(minimum);
    });
  }

  it("has at least 3 sport-specific calcio exercises (Nordic, Copenhagen, balance, lateral bound)", () => {
    const calcioIds = ["nordic-hamstring-curl", "copenhagen-plank", "single-leg-balance-bodyweight", "lateral-bound-bodyweight"];
    const present = calcioIds.filter(id => EXERCISES_BY_ID[id]);
    expect(present.length).toBeGreaterThanOrEqual(3);
  });

  it("FIFA 11+ key exercises are in catalog (Nordic Hamstring is must-have)", () => {
    expect(EXERCISES_BY_ID["nordic-hamstring-curl"]).toBeDefined();
  });

  it("all IDs are kebab-case (no spaces, no underscores, lowercase)", () => {
    const broken = EXERCISES.filter(e => !/^[a-z0-9-]+$/.test(e.id));
    expect(broken.map(e => e.id)).toEqual([]);
  });

  // ============================================================================
  // G8 — Equipment Substitution chain validation (Wave 3.5)
  // ============================================================================

  it("G8: alternatives chain has no orphan IDs (every alt resolves in catalog)", () => {
    const orphans: Array<{ exerciseId: string; missingAlt: string }> = [];
    for (const ex of EXERCISES) {
      for (const altId of ex.alternatives) {
        if (!EXERCISES_BY_ID[altId]) {
          orphans.push({ exerciseId: ex.id, missingAlt: altId });
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("G8: alternatives chain has no 2-cycles A→B→A unless paired with a 3rd-party fallback (regression-friendly)", () => {
    // Bidirectional refs (es. push-up-standard <-> push-up-knees) sono OK e attesi
    // come progressione/regression. Questo test verifica solo che NON esistano
    // catene chiuse di 2 esercizi senza nessun altro fallback (deadlock).
    const deadlockPairs: Array<[string, string]> = [];
    for (const ex of EXERCISES) {
      if (ex.alternatives.length === 1) {
        const onlyAlt = ex.alternatives[0];
        const altEx = EXERCISES_BY_ID[onlyAlt];
        if (altEx && altEx.alternatives.length === 1 && altEx.alternatives[0] === ex.id) {
          deadlockPairs.push([ex.id, onlyAlt]);
        }
      }
    }
    expect(deadlockPairs).toEqual([]);
  });

  it("G8: alternatives chain length max 3 (per ARCHITECTURE max 3 hop contract)", () => {
    const tooLong = EXERCISES.filter(e => e.alternatives.length > 3);
    expect(tooLong.map(e => `${e.id}: ${e.alternatives.length} alts`)).toEqual([]);
  });

  it("G8: every non-bodyweight exercise reaches a bodyweight alternative within 3 hops (excl. carry)", () => {
    // Carry pattern è loadable per definizione (trasporto peso esterno) → exempt.
    // Pull-up/chin-up richiedono pullup_bar IN AGGIUNTA a bodyweight → escluse
    // (un utente "casa no attrezzi" non le può eseguire neanche).
    // Test SEMANTICAMENTE allineato al runtime: usa walkAlternativeChain reale
    // con availableEquipment=[] → verifica che il prod algorithm raggiunga un
    // esercizio eseguibile (solo bodyweight, no pullup_bar) entro 3 hop.
    const unreachable: string[] = [];
    for (const ex of EXERCISES) {
      // Esercizi eseguibili a corpo libero PURO (solo "bodyweight", nessun
      // altro tag richiesto come pullup_bar/box). Sono già un endpoint valido.
      if (ex.equipment.length === 1 && ex.equipment[0] === "bodyweight") continue;
      if (ex.pattern === "carry") continue;
      const result = walkAlternativeChain(ex.id, [], EXERCISES, 3);
      if (result === null) unreachable.push(ex.id);
    }
    expect(unreachable).toEqual([]);
  });

  it("G8: every non-bodyweight exercise (excl. carry) has at least 2 alternatives for graceful degrade", () => {
    const tooShort = EXERCISES.filter(
      e => !e.equipment.includes("bodyweight") && e.pattern !== "carry" && e.alternatives.length < 2,
    );
    expect(tooShort.map(e => `${e.id}: ${e.alternatives.length} alts`)).toEqual([]);
  });
});
