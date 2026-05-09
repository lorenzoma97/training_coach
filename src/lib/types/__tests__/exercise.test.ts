import { describe, it, expect } from "vitest";
import { ExerciseSchema, EquipmentTagSchema, ExercisePatternSchema } from "../../schemas/exercise";

describe("ExerciseSchema", () => {
  it("accepts a complete valid exercise", () => {
    const ex = {
      id: "back-squat-barbell",
      name: "Back Squat con bilanciere",
      pattern: "squat" as const,
      primaryMuscles: ["quadricipiti", "glutei"],
      secondaryMuscles: ["core", "lombari"],
      equipment: ["barbell" as const, "bench" as const],
      level: "intermediate" as const,
      unilateral: false,
      technique: "Petto fuori, ginocchia in linea con i piedi.",
      cautions: ["lombare"],
      alternatives: ["goblet-squat-dumbbell", "bodyweight-squat"],
      loadable: true,
    };
    expect(ExerciseSchema.safeParse(ex).success).toBe(true);
  });

  it("rejects exercise with empty id", () => {
    const ex = {
      id: "",
      name: "X",
      pattern: "squat" as const,
      primaryMuscles: ["quadricipiti"],
      secondaryMuscles: [],
      equipment: ["bodyweight" as const],
      level: "beginner" as const,
      unilateral: false,
      technique: "cue",
      alternatives: [],
      loadable: false,
    };
    expect(ExerciseSchema.safeParse(ex).success).toBe(false);
  });

  it("rejects exercise with no primary muscles", () => {
    const ex = {
      id: "x",
      name: "X",
      pattern: "squat" as const,
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: ["bodyweight" as const],
      level: "beginner" as const,
      unilateral: false,
      technique: "c",
      alternatives: [],
      loadable: false,
    };
    expect(ExerciseSchema.safeParse(ex).success).toBe(false);
  });

  it("rejects unknown pattern", () => {
    expect(ExercisePatternSchema.safeParse("rotation").success).toBe(false);
    expect(ExercisePatternSchema.safeParse("squat").success).toBe(true);
  });

  it("rejects unknown equipment", () => {
    expect(EquipmentTagSchema.safeParse("smith_machine").success).toBe(false);
    expect(EquipmentTagSchema.safeParse("barbell").success).toBe(true);
  });

  it("requires equipment to have at least one tag", () => {
    const ex = {
      id: "x",
      name: "X",
      pattern: "squat" as const,
      primaryMuscles: ["quad"],
      secondaryMuscles: [],
      equipment: [], // empty array → invalid
      level: "beginner" as const,
      unilateral: false,
      technique: "c",
      alternatives: [],
      loadable: false,
    };
    expect(ExerciseSchema.safeParse(ex).success).toBe(false);
  });
});
