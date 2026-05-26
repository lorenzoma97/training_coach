// Golden tests fuzzy matcher (Sprint 3, 2026-05-26).

import { describe, it, expect } from "vitest";
import { matchExerciseId, normalizeKey, levenshtein } from "../exerciseMatcher";

describe("normalizeKey", () => {
  it("lowercase + trim + spazi/underscore → trattini", () => {
    expect(normalizeKey("Back Squat")).toBe("back-squat");
    expect(normalizeKey("back_squat")).toBe("back-squat");
    expect(normalizeKey("  Back  Squat  ")).toBe("back-squat");
    expect(normalizeKey("back-squat-barbell")).toBe("back-squat-barbell");
  });

  it("collapse trattini multipli + strip caratteri speciali", () => {
    expect(normalizeKey("back--squat")).toBe("back-squat");
    expect(normalizeKey("back@squat!")).toBe("backsquat");
    expect(normalizeKey("--back-squat--")).toBe("back-squat");
  });
});

describe("levenshtein", () => {
  it("stringhe identiche → 0", () => {
    expect(levenshtein("back", "back")).toBe(0);
  });

  it("stringhe vuote → length opposite", () => {
    expect(levenshtein("", "back")).toBe(4);
    expect(levenshtein("back", "")).toBe(4);
  });

  it("substitution count", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3); // classic example
  });

  it("insertion/deletion", () => {
    expect(levenshtein("back", "backs")).toBe(1);
  });
});

describe("matchExerciseId — Tier 1 exact match", () => {
  it("id catalog esatto → confidence 1.0", () => {
    const r = matchExerciseId("back-squat-barbell");
    expect(r).not.toBeNull();
    expect(r!.matchedId).toBe("back-squat-barbell");
    expect(r!.confidence).toBe(1.0);
    expect(r!.source).toBe("exact");
  });

  it("id normalizzabile → match con confidence ~0.98", () => {
    const r = matchExerciseId("Back_Squat_Barbell");
    expect(r).not.toBeNull();
    expect(r!.matchedId).toBe("back-squat-barbell");
    expect(r!.source).toBe("exact");
  });
});

describe("matchExerciseId — Tier 2 synonym", () => {
  it("alias italiani: 'panca piana' → bench-press-flat-barbell", () => {
    const r = matchExerciseId("panca piana");
    expect(r).not.toBeNull();
    expect(r!.matchedId).toBe("bench-press-flat-barbell");
    expect(r!.source).toBe("synonym");
  });

  it("alias 'RDL' → deadlift-romanian-barbell", () => {
    const r = matchExerciseId("RDL");
    expect(r?.matchedId).toBe("deadlift-romanian-barbell");
    expect(r?.source).toBe("synonym");
  });

  it("alias 'CMJ' → jump-squat-bodyweight", () => {
    const r = matchExerciseId("CMJ");
    expect(r?.matchedId).toBe("jump-squat-bodyweight");
  });

  it("synonym via name se id non noto: id='cmj-vert', name='Counter Movement Jump'", () => {
    const r = matchExerciseId("cmj-vert", "Counter Movement Jump");
    expect(r?.matchedId).toBe("jump-squat-bodyweight");
    expect(r?.source).toBe("synonym");
  });

  it("alias sport: 'T-Test' → t-test-agility", () => {
    const r = matchExerciseId("T-Test");
    expect(r?.matchedId).toBe("t-test-agility");
  });
});

describe("matchExerciseId — Tier 3 orphan", () => {
  it("id inventato senza catalog match → null", () => {
    const r = matchExerciseId("totally-new-exercise-xyz");
    expect(r).toBeNull();
  });

  it("nome lontano senza synonym → null (sotto soglia 0.85)", () => {
    const r = matchExerciseId("zzz-random-12345", "Random Exotic Drill");
    expect(r).toBeNull();
  });
});

describe("matchExerciseId — Tier 2 fuzzy threshold", () => {
  it("typo singolo carattere su id catalog → fuzzy match", () => {
    // "back-squat-barbel" (manca 1 l) vs "back-squat-barbell"
    // confidence = 1 - 1/18 ≈ 0.94 → sopra 0.85
    const r = matchExerciseId("back-squat-barbel");
    expect(r).not.toBeNull();
    expect(r!.matchedId).toBe("back-squat-barbell");
    expect(r!.source).toBe("fuzzy-id");
    expect(r!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("differenza grossa → null (sotto soglia)", () => {
    const r = matchExerciseId("xxxx", "yyyy");
    expect(r).toBeNull();
  });

  it("threshold custom: minConfidence=0.5 accetta match più loose", () => {
    const r = matchExerciseId("back-squat-xxxxxxxx", undefined, 0.5);
    // Probabilmente matcha back-squat-barbell con confidence ~0.6
    expect(r).not.toBeNull();
  });
});
