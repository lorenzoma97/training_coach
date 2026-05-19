import { describe, it, expect } from "vitest";
import {
  ExerciseSetSchema,
  ExercisePerformanceSchema,
  OneRepMaxSchema,
} from "../../schemas/strength";

describe("ExerciseSetSchema", () => {
  it("accepts a minimal set with only reps", () => {
    expect(ExerciseSetSchema.safeParse({ reps: 8 }).success).toBe(true);
  });

  it("accepts a complete set", () => {
    const set = { reps: 5, weight_kg: 100, rpe: 8, rir: 2 };
    expect(ExerciseSetSchema.safeParse(set).success).toBe(true);
  });

  it("rejects negative reps", () => {
    expect(ExerciseSetSchema.safeParse({ reps: -1 }).success).toBe(false);
  });

  it("rejects RPE > 10", () => {
    expect(ExerciseSetSchema.safeParse({ reps: 5, rpe: 11 }).success).toBe(false);
  });

  it("rejects negative weight", () => {
    expect(ExerciseSetSchema.safeParse({ reps: 5, weight_kg: -10 }).success).toBe(false);
  });

  it("accepts weight = 0 (bodyweight)", () => {
    expect(ExerciseSetSchema.safeParse({ reps: 10, weight_kg: 0 }).success).toBe(true);
  });
});

describe("ExercisePerformanceSchema", () => {
  it("accepts a performance with multiple sets", () => {
    const perf = {
      exerciseId: "back-squat-barbell",
      sets: [
        { reps: 5, weight_kg: 80, rpe: 7 },
        { reps: 5, weight_kg: 80, rpe: 8 },
        { reps: 4, weight_kg: 80, rpe: 9 },
      ],
      notes: "buona tecnica",
    };
    expect(ExercisePerformanceSchema.safeParse(perf).success).toBe(true);
  });

  it("accepts empty sets array (sessione skippata)", () => {
    const perf = { exerciseId: "x", sets: [] };
    expect(ExercisePerformanceSchema.safeParse(perf).success).toBe(true);
  });

  it("rejects missing exerciseId", () => {
    const perf = { sets: [{ reps: 5 }] };
    expect(ExercisePerformanceSchema.safeParse(perf).success).toBe(false);
  });
});

describe("OneRepMaxSchema", () => {
  it("accepts a tested 1RM", () => {
    const orm = {
      exerciseId: "back-squat-barbell",
      value_kg: 120,
      source: "tested" as const,
      acquiredAt: "2026-04-15",
    };
    expect(OneRepMaxSchema.safeParse(orm).success).toBe(true);
  });

  it("accepts an estimated 1RM with audit trail", () => {
    const orm = {
      exerciseId: "deadlift-barbell",
      value_kg: 140,
      source: "estimated" as const,
      acquiredAt: "2026-05-01",
      fromWorkoutId: "w-2026-05-01-1",
    };
    expect(OneRepMaxSchema.safeParse(orm).success).toBe(true);
  });

  it("rejects malformed date", () => {
    const orm = {
      exerciseId: "x",
      value_kg: 100,
      source: "tested" as const,
      acquiredAt: "15/04/2026", // wrong format
    };
    expect(OneRepMaxSchema.safeParse(orm).success).toBe(false);
  });

  it("rejects 0 kg (impossibile per un 1RM)", () => {
    const orm = {
      exerciseId: "x",
      value_kg: 0,
      source: "tested" as const,
      acquiredAt: "2026-01-01",
    };
    expect(OneRepMaxSchema.safeParse(orm).success).toBe(false);
  });
});
