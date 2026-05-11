// Test golden cases per i validator strength engine (Wave 3.1).
// Riferimento: ARCHITECTURE.md §3.3, §4 Wave 3.1 (validator-specialist).
//
// Coverage:
//   B.1 validateStrengthLoadProgression: ≥10 test
//   B.2 validatePct1rmRepsCoherence:     ≥8 test
//   + perf stress test <100ms
//   + format/severity sanity check

import { describe, it, expect } from "vitest";
import {
  validateStrengthLoadProgression,
  validatePct1rmRepsCoherence,
  validateEquipmentMismatch,
  expectedRepRangeForPct1RM,
} from "../strengthValidators";
import { validatePlan } from "../../planValidator";
import type {
  TrainingPlan,
  PlannedExercise,
  PlannedSession,
  UserProfile,
  ExercisePerformance,
} from "../../../types";
import type { ValidatorCtx, RecentWorkoutForValidator } from "../../planValidator";

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

const baseProfile: UserProfile = {
  age: 30,
  sex: "m",
  weight_kg: 80,
  height_cm: 180,
  experience: "regular",
  injuries: [],
  meds: "",
  weekly_availability: { days: 4, hoursPerSession: 1 },
  equipment: ["barbell", "dumbbell"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function makeEx(p: Partial<PlannedExercise>): PlannedExercise {
  return {
    exerciseId: p.exerciseId ?? "back-squat-barbell",
    plannedSets: p.plannedSets ?? 3,
    repsTarget: p.repsTarget ?? { min: 5, max: 5 },
    rest_sec: p.rest_sec ?? 180,
    weight_kg: p.weight_kg,
    pct1RM: p.pct1RM,
    rpe_target: p.rpe_target,
    rir_target: p.rir_target,
    cue: p.cue,
  };
}

function makeSession(exercises: PlannedExercise[], type = "forza_gambe"): PlannedSession {
  return {
    day: "lun",
    type,
    duration_min: 60,
    details: "test",
    rationale: "test",
    exercises,
  };
}

function makePlan(
  weeks: Array<{ weekNumber: number; sessions: PlannedSession[] }>,
): TrainingPlan {
  return {
    generatedAt: "2026-05-09T10:00:00Z",
    validUntil: "2026-06-09T10:00:00Z",
    rationale: "test",
    weeks: weeks.map(w => ({
      weekNumber: w.weekNumber,
      focus: "test",
      sessions: w.sessions,
    })),
  };
}

/** Costruisce un workout storico con set forza strutturati. */
function makeRecentWorkout(
  exerciseId: string,
  weights: number[],
  daysAgo: number,
): RecentWorkoutForValidator {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const date = d.toISOString().slice(0, 10);
  const perf: ExercisePerformance = {
    exerciseId,
    sets: weights.map(w => ({ reps: 5, weight_kg: w, rpe: 8 })),
  };
  return {
    type: "forza_gambe",
    date,
    exercises: [perf],
  };
}

function makeCtx(recentWorkouts: RecentWorkoutForValidator[] = []): ValidatorCtx {
  return {
    profile: baseProfile,
    recentWorkouts,
    options: {},
  };
}

// ────────────────────────────────────────────────────────────────────────────
// B.1 — validateStrengthLoadProgression
// ────────────────────────────────────────────────────────────────────────────

describe("validateStrengthLoadProgression", () => {
  it("1. Storia 80→82.5→85kg, planned 92kg (≤+10%) → 0 issue", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [80], 14),
      makeRecentWorkout("back-squat-barbell", [82.5], 7),
      makeRecentWorkout("back-squat-barbell", [85], 3),
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 92 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(0);
  });

  it("2. Storia 80→82.5→85kg, planned 95kg (>+10%) → 1 issue", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [80], 14),
      makeRecentWorkout("back-squat-barbell", [82.5], 7),
      makeRecentWorkout("back-squat-barbell", [85], 3),
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 95 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("strength_load_progression");
    expect(issues[0].weekNumber).toBe(1);
  });

  it("3. Cold start (no storia) → 0 issue", () => {
    const ctx = makeCtx([]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 200 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(0);
  });

  it("4. Planned weight undefined (rpe_target only) → 0 issue", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [85], 3),
    ]);
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ rpe_target: 8, weight_kg: undefined })])],
      },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(0);
  });

  it("5. Storia >30gg vecchia → ignored (no warn anche su +50%)", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [85], 60),
      makeRecentWorkout("back-squat-barbell", [80], 45),
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 130 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    // Cold start effettivo: nessuna storia recente → no warn.
    expect(issues).toHaveLength(0);
  });

  it("6. Multi exercise: squat OK, bench fail → 1 issue (solo bench)", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [100], 5),
      makeRecentWorkout("bench-press-barbell", [60], 5),
    ]);
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [
          makeSession([
            makeEx({ exerciseId: "back-squat-barbell", weight_kg: 105 }), // OK (+5%)
            makeEx({ exerciseId: "bench-press-barbell", weight_kg: 75 }), // FAIL (+25%)
          ]),
        ],
      },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("bench-press-barbell");
    expect(issues[0].message).not.toContain("back-squat-barbell");
  });

  it("7. Multi week: week 1 OK, week 2 fail → 1 issue (solo week 2)", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [80], 5),
    ]);
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ weight_kg: 85 })])], // +6.25%, OK
      },
      {
        weekNumber: 2,
        sessions: [makeSession([makeEx({ weight_kg: 95 })])], // +18.75%, FAIL
      },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].weekNumber).toBe(2);
  });

  it("8. Issue contains exercise name + numbers ben formattati", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [85], 3),
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 100 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(1);
    const msg = issues[0].message;
    expect(msg).toContain("back-squat-barbell");
    expect(msg).toContain("100");
    expect(msg).toContain("85");
    expect(msg).toContain("Schoenfeld");
  });

  it("9. Severity = warn (mai error)", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [85], 3),
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 200 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues[0].severity).toBe("warn");
  });

  it("10. Stress: 100 sessioni storia + 10 planned → perf <100ms", () => {
    const recent: RecentWorkoutForValidator[] = [];
    for (let i = 0; i < 100; i++) {
      recent.push(makeRecentWorkout("back-squat-barbell", [80 + (i % 10)], (i % 25) + 1));
    }
    const sessions: PlannedSession[] = [];
    for (let i = 0; i < 10; i++) {
      sessions.push(makeSession([makeEx({ weight_kg: 85 + i })]));
    }
    const plan = makePlan([{ weekNumber: 1, sessions }]);
    const ctx = makeCtx(recent);
    const t0 = performance.now();
    validateStrengthLoadProgression(plan, ctx);
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(100);
  });

  // Edge cases extra (oltre i 10 richiesti)
  it("11. Planned weight = exact +10% (boundary) → 0 issue (cap inclusivo)", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [100], 5),
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 110 })])] }, // = max × 1.10
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(0);
  });

  it("12. Planned weight 0 → 0 issue (skip carichi non validi)", () => {
    const ctx = makeCtx([
      makeRecentWorkout("back-squat-barbell", [85], 3),
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 0 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(0);
  });

  it("13. Workout storico senza exercises[] (legacy v1) → ignorato (no false positive)", () => {
    const ctx = makeCtx([
      // legacy: solo fields, niente exercises strutturati
      { type: "forza_gambe", date: new Date().toISOString().slice(0, 10), fields: { tipo: "squat" } },
    ]);
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ weight_kg: 200 })])] },
    ]);
    const issues = validateStrengthLoadProgression(plan, ctx);
    expect(issues).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// B.2 — validatePct1rmRepsCoherence
// ────────────────────────────────────────────────────────────────────────────

describe("validatePct1rmRepsCoherence", () => {
  it("1. 75% × 8 reps → OK (bucket ipertrofia 6-12)", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ pct1RM: 75, repsTarget: { min: 8, max: 8 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(0);
  });

  it("2. 90% × 5 reps → OK (bucket forza 3-5)", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ pct1RM: 90, repsTarget: { min: 5, max: 5 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(0);
  });

  it("3. 90% × 8 reps → ISSUE (max 5 atteso)", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ pct1RM: 90, repsTarget: { min: 8, max: 8 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("pct1rm_reps_mismatch");
    expect(issues[0].severity).toBe("warn");
  });

  it("4. 50% × 20 reps → OK (bucket resistenza 12-25)", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ pct1RM: 50, repsTarget: { min: 20, max: 20 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(0);
  });

  it("5. 50% × 5 reps → ISSUE (range 12-25 atteso)", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ pct1RM: 50, repsTarget: { min: 5, max: 5 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("12-25");
  });

  it("6. pct1RM undefined → 0 issue (skip)", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [
          makeSession([
            makeEx({ pct1RM: undefined, rpe_target: 8, repsTarget: { min: 5, max: 5 } }),
          ]),
        ],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(0);
  });

  it("7. Multi-exercise mixed: solo gli incoerenti flagged", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [
          makeSession([
            makeEx({ exerciseId: "back-squat-barbell", pct1RM: 80, repsTarget: { min: 6, max: 8 } }),  // OK
            makeEx({ exerciseId: "bench-press-barbell", pct1RM: 95, repsTarget: { min: 8, max: 10 } }), // FAIL
            makeEx({ exerciseId: "deadlift-barbell", pct1RM: 70, repsTarget: { min: 10, max: 10 } }),   // OK
            makeEx({ exerciseId: "overhead-press-barbell", pct1RM: 50, repsTarget: { min: 5, max: 5 } }), // FAIL
          ]),
        ],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(2);
    const names = issues.map(i => i.message);
    expect(names.some(m => m.includes("bench-press-barbell"))).toBe(true);
    expect(names.some(m => m.includes("overhead-press-barbell"))).toBe(true);
    expect(names.every(m => !m.includes("back-squat-barbell"))).toBe(true);
    expect(names.every(m => !m.includes("deadlift-barbell"))).toBe(true);
  });

  it("8. Message format ben strutturato (settimana, esercizio, %, range, paper)", () => {
    const plan = makePlan([
      {
        weekNumber: 2,
        sessions: [
          makeSession([
            makeEx({ exerciseId: "front-squat-barbell", pct1RM: 92, repsTarget: { min: 10, max: 10 } }),
          ]),
        ],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(1);
    const msg = issues[0].message;
    expect(msg).toContain("Settimana 2");
    expect(msg).toContain("front-squat-barbell");
    expect(msg).toContain("92");
    expect(msg).toContain("10");
    expect(msg).toContain("Ratamess");
  });

  // Edge cases extra
  it("9. Range che interseca il bucket (75% 5-8 reps) → OK (overlap parziale)", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        // 75% bucket = 6-12. Range richiesto 5-8 → overlap 6-8 → OK.
        sessions: [makeSession([makeEx({ pct1RM: 75, repsTarget: { min: 5, max: 8 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(0);
  });

  it("10. pct1RM boundary 85 (forza bucket) con 5 reps → OK", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ pct1RM: 85, repsTarget: { min: 5, max: 5 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(0);
  });

  it("11. pct1RM > 100 (input malformato) → skip silently", () => {
    const plan = makePlan([
      {
        weekNumber: 1,
        sessions: [makeSession([makeEx({ pct1RM: 150, repsTarget: { min: 5, max: 5 } })])],
      },
    ]);
    const issues = validatePct1rmRepsCoherence(plan, makeCtx());
    expect(issues).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helper unit tests (sanity)
// ────────────────────────────────────────────────────────────────────────────

describe("expectedRepRangeForPct1RM (Ratamess matrix)", () => {
  it("matches canonical Ratamess buckets", () => {
    expect(expectedRepRangeForPct1RM(95)).toMatchObject({ min: 1, max: 3 });
    expect(expectedRepRangeForPct1RM(88)).toMatchObject({ min: 3, max: 5 });
    expect(expectedRepRangeForPct1RM(75)).toMatchObject({ min: 6, max: 12 });
    expect(expectedRepRangeForPct1RM(65)).toMatchObject({ min: 8, max: 15 });
    expect(expectedRepRangeForPct1RM(50)).toMatchObject({ min: 12, max: 25 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// validateEquipmentMismatch (Wave 3.5, G8) — diretti, post-fix BLOCKER BFS
// ────────────────────────────────────────────────────────────────────────────

describe("validateEquipmentMismatch (G8)", () => {
  function makeCtx(equipment: string[] | undefined): ValidatorCtx {
    return {
      profile: { ...baseProfile, equipment: (equipment ?? []) as string[] },
      recentWorkouts: [],
      options: {},
    };
  }

  it("profile.equipment=undefined → solo bodyweight implicito, esercizi non-bw producono substitution o mismatch", () => {
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ exerciseId: "back-squat-barbell" })])] },
    ]);
    const ctx = makeCtx(undefined);
    const issues = validateEquipmentMismatch(plan, ctx);
    // L'utente legacy senza equipment → bodyweight only. Substitutor BFS dovrebbe
    // raggiungere bodyweight-squat (esiste nel catalog reale).
    expect(issues.length).toBeGreaterThan(0);
    const types = new Set(issues.map(i => i.type));
    // Almeno uno dei due tipi G8 deve essere emesso (sub o mismatch).
    expect([...types].some(t => t === "equipment_substituted" || t === "equipment_mismatch")).toBe(true);
  });

  it("profile con barbell → back-squat-barbell hop 0, nessuna issue", () => {
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ exerciseId: "back-squat-barbell" })])] },
    ]);
    const ctx = makeCtx(["barbell"]);
    const issues = validateEquipmentMismatch(plan, ctx);
    expect(issues.filter(i => i.type === "equipment_substituted")).toEqual([]);
    expect(issues.filter(i => i.type === "equipment_mismatch")).toEqual([]);
  });

  it("profile bodyweight-only su back-squat-barbell → equipment_substituted (NON mismatch)", () => {
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ exerciseId: "back-squat-barbell" })])] },
    ]);
    const ctx = makeCtx([]);
    const issues = validateEquipmentMismatch(plan, ctx);
    const subs = issues.filter(i => i.type === "equipment_substituted");
    const miss = issues.filter(i => i.type === "equipment_mismatch");
    // Post fix BLOCKER BFS: catalog reale deve degradare a bodyweight, mai mismatch.
    expect(subs.length).toBe(1);
    expect(miss.length).toBe(0);
    // Wave 3.5 polish: equipment_substituted è severity "info" (no problem, solo
    // segnalazione neutra del swap — vedi Reviewer-deferred minor #1).
    expect(subs[0].severity).toBe("info");
  });

  it("non-week-1 sessions ignored (solo settimana corrente)", () => {
    const plan = makePlan([
      { weekNumber: 1, sessions: [] },
      { weekNumber: 2, sessions: [makeSession([makeEx({ exerciseId: "back-squat-barbell" })])] },
    ]);
    const ctx = makeCtx([]);
    const issues = validateEquipmentMismatch(plan, ctx);
    expect(issues).toEqual([]);
  });

  it("session non-strength ignored (es. corsa)", () => {
    const plan = makePlan([
      { weekNumber: 1, sessions: [makeSession([makeEx({ exerciseId: "back-squat-barbell" })], "corsa")] },
    ]);
    const ctx = makeCtx([]);
    const issues = validateEquipmentMismatch(plan, ctx);
    expect(issues).toEqual([]);
  });

  it("issue 'info' (equipment_substituted) NON rompe validation.ok (resta true)", () => {
    // Scenario polish Wave 3.5: l'utente bodyweight-only riceve una sessione con
    // back-squat-barbell. Il substitutor degrada a bodyweight-squat e emette
    // un'unica issue "equipment_substituted" severity=info. Siccome NON è error,
    // validatePlan deve ritornare ok=true: le info sono segnalazioni neutre.
    // Profile con budget ampio per evitare trigger di weekly_volume_exceeds_availability.
    const profile: UserProfile = {
      ...baseProfile,
      equipment: [],
      weekly_availability: { days: 7, hoursPerSession: 2 },
    };
    const session: PlannedSession = {
      day: "lun",
      type: "forza_gambe",
      duration_min: 30,
      details: "test",
      rationale: "test",
      exercises: [makeEx({ exerciseId: "back-squat-barbell" })],
    };
    const plan = makePlan([{ weekNumber: 1, sessions: [session] }]);
    const result = validatePlan(plan, profile, [], { expectedDayLabels: ["lun"] });
    const subs = result.issues.filter(i => i.type === "equipment_substituted");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every(i => i.severity === "info")).toBe(true);
    // Nessun "error" → ok=true. Anche se ci sono info, ok resta true.
    expect(result.issues.filter(i => i.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
