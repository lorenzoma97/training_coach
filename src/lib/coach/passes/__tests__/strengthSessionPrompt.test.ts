import { describe, it, expect } from "vitest";
import {
  strengthCatalogForPrompt,
  buildStrengthPassPrompt,
  STRENGTH_FEW_SHOT_EXAMPLES,
  STRENGTH_PASS2_SCHEMA_HINT,
  type StrengthSessionContext,
} from "../strengthSessionPrompt";
import { EXERCISE_IDS } from "../../../catalog/exercises";
import type { UserProfile, OneRepMax } from "../../../types";
import type { Workout } from "../../../diaryContext";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mkProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  const now = "2026-05-09T08:00:00.000Z";
  return {
    age: 28,
    sex: "m",
    weight_kg: 81,
    height_cm: 178,
    experience: "regular",
    injuries: [],
    meds: "",
    weekly_availability: { days: 4, hoursPerSession: 1 },
    equipment: ["bodyweight", "dumbbell", "barbell", "bench"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mkContext(overrides: Partial<StrengthSessionContext> = {}): StrengthSessionContext {
  return {
    profile: mkProfile(),
    session: {
      type: "forza_upper",
      day: "mar",
      duration_min: 60,
      subtype: "Upper Push/Pull",
    },
    recentStrengthHistory: [],
    ragContextStrength: "",
    oneRepMaxes: [],
    equipment: ["bodyweight", "dumbbell", "barbell", "bench"],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// strengthCatalogForPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("strengthCatalogForPrompt", () => {
  it("excludes exercises that require barbell when user only has bodyweight", () => {
    const out = strengthCatalogForPrompt(["bodyweight"]);
    expect(out).not.toContain("back-squat-barbell");
    expect(out).not.toContain("bench-press-flat-barbell");
    expect(out).not.toContain("deadlift-conventional-barbell");
    // Should still contain bodyweight exercises
    expect(out).toContain("bodyweight-squat");
  });

  it("includes back-squat-barbell + bench-press when user has barbell + bench", () => {
    // We force a high MAX_ENTRIES by checking that at least these key barbell
    // exercises appear once filtered (default sort: loadable=true first, then
    // beginner. Both back-squat-barbell and bench-press-flat-barbell are loadable
    // intermediate, but we have 30 entries cap — they should both be in top 30.
    const out = strengthCatalogForPrompt(["bodyweight", "barbell", "bench"]);
    expect(out).toContain("back-squat-barbell");
    expect(out).toContain("bench-press-flat-barbell");
  });

  it("with pattern='squat' returns only squat exercises (and only bodyweight if equipment empty)", () => {
    const out = strengthCatalogForPrompt([], "squat");
    // Tutti i bodyweight squat presenti
    expect(out).toContain("bodyweight-squat");
    expect(out).toContain("pistol-squat-bodyweight");
    // Nessun barbell/dumbbell squat
    expect(out).not.toContain("back-squat-barbell");
    expect(out).not.toContain("dumbbell-squat");
    expect(out).not.toContain("goblet-squat-kettlebell");
  });

  it("returns header note + at least one exercise line when pool non-empty", () => {
    const out = strengthCatalogForPrompt(["bodyweight"]);
    expect(out).toMatch(/^ESERCIZI DISPONIBILI/);
    expect(out.split("\n").length).toBeGreaterThan(2);
  });

  it("caps output to 40 entries (token economy)", () => {
    const out = strengthCatalogForPrompt(["bodyweight", "dumbbell", "barbell", "kettlebell", "band", "machine", "cable", "trx", "bench", "pullup_bar", "box"]);
    const lines = out.split("\n").filter(l => l.startsWith("- "));
    expect(lines.length).toBeLessThanOrEqual(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildStrengthPassPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("buildStrengthPassPrompt", () => {
  it("contains key markers: ESERCIZI DISPONIBILI, PROFILO, FEW-SHOT, schema hint", () => {
    const text = buildStrengthPassPrompt(mkContext());
    expect(text).toContain("ESERCIZI DISPONIBILI");
    expect(text).toContain("PROFILO");
    expect(text).toContain("FEW-SHOT");
    expect(text).toContain("SCHEMA OUTPUT");
    // Also includes session metadata
    expect(text).toContain("forza_upper");
    expect(text).toContain("60 min");
  });

  it("token estimate (text.length / 4) stays under 5000 on realistic input", () => {
    // Realistic: full equipment, 4 sessions of history, 3 ORMs, RAG context.
    const history: Workout[] = [
      {
        id: "w1",
        type: "forza_gambe",
        createdAt: "2026-05-02T10:00:00.000Z",
        exercises: [
          {
            exerciseId: "back-squat-barbell",
            sets: [
              { reps: 5, weight_kg: 80, rpe: 7 },
              { reps: 5, weight_kg: 80, rpe: 7 },
              { reps: 5, weight_kg: 80, rpe: 8 },
            ],
          },
        ],
      },
      {
        id: "w2",
        type: "forza_upper",
        createdAt: "2026-05-04T10:00:00.000Z",
        exercises: [
          {
            exerciseId: "bench-press-flat-barbell",
            sets: [
              { reps: 6, weight_kg: 60, rpe: 7 },
              { reps: 6, weight_kg: 60, rpe: 8 },
            ],
          },
        ],
      },
    ];
    const orms: OneRepMax[] = [
      { exerciseId: "back-squat-barbell", value_kg: 100, source: "tested", acquiredAt: "2026-04-01" },
      { exerciseId: "bench-press-flat-barbell", value_kg: 80, source: "estimated", acquiredAt: "2026-04-15" },
    ];
    const ragContext = "Schoenfeld 2017: 10+ set/muscle/week ottimale per ipertrofia. Ratamess 2009: rest 2-3min su main lifts per espressione di forza ottimale.";
    const ctx = mkContext({
      recentStrengthHistory: history,
      oneRepMaxes: orms,
      ragContextStrength: ragContext,
      equipment: ["bodyweight", "dumbbell", "barbell", "kettlebell", "bench", "pullup_bar"],
    });
    const text = buildStrengthPassPrompt(ctx);
    const estTokens = text.length / 4;
    expect(estTokens).toBeLessThan(5000);
  });

  it("when oneRepMaxes empty includes 'usa rpe_target invece di pct1RM'", () => {
    const ctx = mkContext({ oneRepMaxes: [] });
    const text = buildStrengthPassPrompt(ctx);
    expect(text).toMatch(/nessuno testato.*rpe_target/i);
  });

  it("when recentStrengthHistory has 4 squat sessions includes progression hint", () => {
    const history: Workout[] = Array.from({ length: 4 }, (_, i) => ({
      id: `w${i}`,
      type: "forza_gambe",
      createdAt: `2026-04-${20 + i}T10:00:00.000Z`,
      exercises: [
        {
          exerciseId: "back-squat-barbell",
          sets: [
            { reps: 5, weight_kg: 80 + i * 2.5, rpe: 7 },
            { reps: 5, weight_kg: 80 + i * 2.5, rpe: 8 },
          ],
        },
      ],
    }));
    const ctx = mkContext({ recentStrengthHistory: history });
    const text = buildStrengthPassPrompt(ctx);
    expect(text).toContain("STORIA CARICHI");
    expect(text).toContain("back-squat-barbell");
    expect(text).toMatch(/progressive overload|Anti-mirror/i);
  });

  it("includes RAG context block when ragContextStrength is non-empty", () => {
    const ctx = mkContext({ ragContextStrength: "Test scientific reference content." });
    const text = buildStrengthPassPrompt(ctx);
    expect(text).toContain("CONTESTO SCIENTIFICO");
    expect(text).toContain("Test scientific reference content.");
  });

  it("omits RAG context block when ragContextStrength empty", () => {
    const ctx = mkContext({ ragContextStrength: "" });
    const text = buildStrengthPassPrompt(ctx);
    expect(text).not.toContain("CONTESTO SCIENTIFICO");
  });

  it("includes macroPhase line when session.macroPhase is set", () => {
    const ctx = mkContext({
      session: { type: "forza_upper", day: "mar", duration_min: 60, macroPhase: "build" },
    });
    const text = buildStrengthPassPrompt(ctx);
    expect(text).toMatch(/Fase macrociclo:\s*build/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Few-shot integrity: every exerciseId in examples must exist in catalog
// ─────────────────────────────────────────────────────────────────────────────

describe("STRENGTH_FEW_SHOT_EXAMPLES integrity", () => {
  it("contains 3 distinct example sessions", () => {
    expect(STRENGTH_FEW_SHOT_EXAMPLES).toContain("ESEMPIO 1");
    expect(STRENGTH_FEW_SHOT_EXAMPLES).toContain("ESEMPIO 2");
    expect(STRENGTH_FEW_SHOT_EXAMPLES).toContain("ESEMPIO 3");
  });

  it("every exerciseId referenced in few-shot examples exists in catalog", () => {
    // Estrai tutti i pattern "exerciseId": "<slug>"
    const re = /"exerciseId"\s*:\s*"([^"]+)"/g;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(STRENGTH_FEW_SHOT_EXAMPLES)) !== null) {
      found.add(m[1]);
    }
    expect(found.size).toBeGreaterThan(0);
    const missing = Array.from(found).filter(id => !EXERCISE_IDS.has(id));
    expect(missing).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema hint surface contract
// ─────────────────────────────────────────────────────────────────────────────

describe("STRENGTH_PASS2_SCHEMA_HINT surface", () => {
  it("documents required fields explicitly", () => {
    expect(STRENGTH_PASS2_SCHEMA_HINT).toContain("exercises");
    expect(STRENGTH_PASS2_SCHEMA_HINT).toContain("REQUIRED");
    expect(STRENGTH_PASS2_SCHEMA_HINT).toContain("plannedSets");
    expect(STRENGTH_PASS2_SCHEMA_HINT).toContain("repsTarget");
    expect(STRENGTH_PASS2_SCHEMA_HINT).toContain("rest_sec");
    expect(STRENGTH_PASS2_SCHEMA_HINT).toContain("rationale");
  });

  it("forbids markdown/comments wrapping in output", () => {
    expect(STRENGTH_PASS2_SCHEMA_HINT).toMatch(/NO markdown|JSON puro|niente markdown/i);
  });
});
