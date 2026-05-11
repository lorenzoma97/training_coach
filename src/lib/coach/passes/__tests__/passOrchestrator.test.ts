// Wave 4.1 — test per il multi-pass orchestrator (Pass-1 + Pass-2 + Pass-3).
//
// Strategy:
// - Mock di generateJSON (provider LLM) per controllare l'output di ogni pass.
// - Mock minimo del modulo storage (Pass-3 usa validatePlan che NON tocca
//   storage, ma readiness/macro arrivano dal ctx — niente storage da mockare).
// - Verifichiamo: parsing skeleton, conteggio chiamate Pass-2, skip su mobility,
//   skipPass2 flag, error handling, fallback graceful.

import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mock delle dipendenze runtime ----------------------------------------
vi.mock("../../../gemini", () => ({
  generateJSON: vi.fn(),
}));

import { generateJSON } from "../../../gemini";
import { runMultiPass, type OrchestratorContext } from "../passOrchestrator";
import type { UserProfile, UserGoal } from "../../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const mockedGenerateJSON = generateJSON as unknown as ReturnType<typeof vi.fn>;

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

function mkGoal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    id: "g1",
    originalDescription: "Voglio essere piu' forte",
    smartDescription: "Migliorare forza generale",
    kpi: { metric: "1RM bench", target: "+10kg", deadline: "2026-08-01" },
    realistic: true,
    coachReasoning: "Obiettivo realistico in 12 settimane",
    status: "active",
    priority: "alta",
    sortOrder: 1,
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function mkCtx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    profile: mkProfile(),
    goals: [mkGoal()],
    recentDays: [],
    macroContext: null,
    readiness: null,
    zones: null,
    mode: "initial",
    ...overrides,
  };
}

/** Skeleton sample: 4 sessioni mix (forza upper, forza gambe, corsa Z2, mobility). */
const skeletonSample = {
  weeks: [
    {
      weekNumber: 1,
      focus: "Base aerobica + forza funzionale",
      sessions: [
        { day: "lun", type: "forza_upper", subtype: "Upper Push/Pull", duration_min: 60, focus: "upper push pesante" },
        { day: "mar", type: "corsa", subtype: "Fondo Lento", duration_min: 45, focus: "easy Z2", zone: 2 },
        { day: "gio", type: "forza_gambe", subtype: "Lower Squat", duration_min: 60, focus: "squat focus" },
        { day: "ven", type: "mobilita", subtype: "Mobilità Dinamica", duration_min: 20, focus: "anche/caviglie" },
      ],
    },
  ],
  rationale: "- Volume bilanciato\n- Forza 2x sett (Ronnestad 2014)\n- 3 giorni rest",
};

/** Skeleton con sessione cardio Z5 (richiede Pass-2 cardio). */
const skeletonWithZ5 = {
  weeks: [
    {
      weekNumber: 1,
      focus: "VO2max focus",
      sessions: [
        { day: "lun", type: "corsa", subtype: "Ripetute Brevi", duration_min: 50, focus: "VO2max 6x800m", zone: 5 },
        { day: "mer", type: "corsa", subtype: "Fondo Lento", duration_min: 45, focus: "easy Z2", zone: 2 },
        { day: "ven", type: "mobilita", subtype: "Foam Rolling", duration_min: 20, focus: "recovery" },
      ],
    },
  ],
  rationale: "- Singola qualita' settimanale\n- 1 long Z2\n- Mobilita' end of week",
};

/** Strength Pass-2 sample output. */
const strengthPass2Sample = {
  exercises: [
    { exerciseId: "bench-press-flat-barbell", plannedSets: 4, repsTarget: { min: 6, max: 8 }, rpe_target: 8, rest_sec: 180, cue: "Scapole retratte" },
    { exerciseId: "barbell-row-bent-over", plannedSets: 4, repsTarget: { min: 8, max: 10 }, rpe_target: 8, rest_sec: 120, cue: "Busto a 30°" },
    { exerciseId: "pull-up-bodyweight", plannedSets: 3, repsTarget: { min: 6, max: 10 }, rpe_target: 9, rest_sec: 120, cue: "Discesa controllata" },
  ],
  details: "3 esercizi upper bilanciati push/pull",
  rationale: "Bilanciamento push/pull 1:2 + accessorio bodyweight",
};

/** Cardio Pass-2 sample output. */
const cardioPass2Sample = {
  intervals: [
    { kind: "warmup", duration_min: 15, zone: 2, cue: "Easy progressivo" },
    { kind: "repetition", duration_min: 3, zone: 5, reps: 6, recovery_sec: 120, cue: "800m a passo VO2max" },
    { kind: "cooldown", duration_min: 10, zone: 1, cue: "Defaticamento + stretch" },
  ],
  details: "Warmup 15' + 6x800m Z5 + cooldown 10'",
  rationale: "VO2max stimulus con recovery completo",
};

beforeEach(() => {
  mockedGenerateJSON.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Pass-1 parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Pass-1 skeleton", () => {
  it("parses skeleton correctly and returns plan with weeks/sessions", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)        // Pass-1
      .mockResolvedValueOnce(strengthPass2Sample)   // Pass-2 forza_upper
      .mockResolvedValueOnce(strengthPass2Sample);  // Pass-2 forza_gambe

    const result = await runMultiPass(mkCtx());

    expect(result.plan.weeks).toHaveLength(1);
    expect(result.plan.weeks[0].sessions).toHaveLength(4);
    expect(result.plan.generationMode).toBe("multi");
    expect(result.passLogs).toHaveLength(3);
    expect(result.passLogs[0].pass).toBe(1);
  });

  it("throws if Pass-1 LLM call fails (caller decides fallback)", async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error("LLM down"));

    await expect(runMultiPass(mkCtx())).rejects.toThrow();
  });

  it("throws if Pass-1 output fails Zod parsing", async () => {
    mockedGenerateJSON.mockResolvedValueOnce({ invalid: "shape" });

    await expect(runMultiPass(mkCtx())).rejects.toThrow(/Pass-1 Zod parse/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pass-2 invocation count
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Pass-2 strength routing", () => {
  it("invokes Pass-2 once per strength session, skips mobility/cardio_low", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)         // Pass-1
      .mockResolvedValueOnce(strengthPass2Sample)    // forza_upper (lun)
      .mockResolvedValueOnce(strengthPass2Sample);   // forza_gambe (gio)

    await runMultiPass(mkCtx());

    // 1 Pass-1 + 2 Pass-2 (solo le 2 forza, no mobilita, no corsa Z2)
    expect(mockedGenerateJSON).toHaveBeenCalledTimes(3);
  });

  it("attaches exercises[] to strength sessions after Pass-2", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const upperSession = result.plan.weeks[0].sessions.find(s => s.type === "forza_upper");
    expect(upperSession?.exercises).toBeDefined();
    expect(upperSession?.exercises?.length).toBe(3);
    expect(upperSession?.exercises?.[0].exerciseId).toBe("bench-press-flat-barbell");
  });

  it("does NOT attach exercises[] to mobility/cardio_low sessions", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const mobility = result.plan.weeks[0].sessions.find(s => s.type === "mobilita");
    const easyRun = result.plan.weeks[0].sessions.find(s => s.type === "corsa" && s.zone === 2);
    expect(mobility?.exercises).toBeUndefined();
    expect(mobility?.intervals).toBeUndefined();
    expect(easyRun?.intervals).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pass-2 cardio routing (Z4-Z5)
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Pass-2 cardio routing (Z4-Z5)", () => {
  it("invokes Pass-2 cardio for sessions with zone >= 4", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonWithZ5)        // Pass-1
      .mockResolvedValueOnce(cardioPass2Sample);    // Pass-2 cardio Z5 (lun)

    const result = await runMultiPass(mkCtx());

    // 1 Pass-1 + 1 Pass-2 cardio (Z2 e mobility skip)
    expect(mockedGenerateJSON).toHaveBeenCalledTimes(2);

    const z5Session = result.plan.weeks[0].sessions.find(s => s.zone === 5);
    expect(z5Session?.intervals).toBeDefined();
    expect(z5Session?.intervals?.length).toBe(3);
    expect(z5Session?.intervals?.[1].kind).toBe("repetition");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// skipPass2 (legacy mode)
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — skipPass2 option (legacy mode)", () => {
  it("with skipPass2=true: only Pass-1 is invoked, sessions remain skeleton", async () => {
    mockedGenerateJSON.mockResolvedValueOnce(skeletonSample);

    const result = await runMultiPass(mkCtx(), { skipPass2: true });

    expect(mockedGenerateJSON).toHaveBeenCalledTimes(1); // solo Pass-1
    expect(result.plan.weeks[0].sessions.every(s => !s.exercises && !s.intervals)).toBe(true);
    expect(result.passLogs[1].note).toContain("skipped");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error resilience: Pass-2 failure on single session
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — error resilience", () => {
  it("logs warning if Pass-2 fails on single session, keeps skeleton for that session", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)             // Pass-1
      .mockRejectedValueOnce(new Error("LLM timeout"))   // Pass-2 forza_upper FAIL
      .mockResolvedValueOnce(strengthPass2Sample);       // Pass-2 forza_gambe OK

    const result = await runMultiPass(mkCtx());

    const upperSession = result.plan.weeks[0].sessions.find(s => s.type === "forza_upper");
    const lowerSession = result.plan.weeks[0].sessions.find(s => s.type === "forza_gambe");

    // Upper rimane skeleton (no exercises), lower e' arricchito.
    expect(upperSession?.exercises).toBeUndefined();
    expect(lowerSession?.exercises).toBeDefined();

    // Pass-2 log riporta il warning.
    const pass2Log = result.passLogs.find(l => l.pass === 2);
    expect(pass2Log?.issues).toBeDefined();
    expect(pass2Log?.issues?.length).toBeGreaterThan(0);
    expect(pass2Log?.issues?.[0]).toContain("Pass-2 strength fallito");
  });

  it("logs warning if Pass-2 returns invalid JSON shape", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce({ invalid: "shape" })       // Pass-2 forza_upper Zod fail
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const pass2Log = result.passLogs.find(l => l.pass === 2);
    expect(pass2Log?.issues?.[0]).toMatch(/Zod parse/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pass-3 validator integration
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Pass-3 validator", () => {
  it("Pass-3 always runs and logs ok/issues", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const pass3Log = result.passLogs.find(l => l.pass === 3);
    expect(pass3Log).toBeDefined();
    expect(pass3Log?.note).toBeTruthy();
  });

  it("Pass-3 NEVER calls LLM (deterministic)", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    await runMultiPass(mkCtx());

    // Total LLM calls = Pass-1 (1) + Pass-2 (2) = 3. Pass-3 zero.
    expect(mockedGenerateJSON).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — plan metadata", () => {
  it("sets generationMode='multi' on output plan", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());
    expect(result.plan.generationMode).toBe("multi");
  });

  it("attaches macroPhase from ctx.macroContext to enriched sessions", async () => {
    const macroCtx = {
      phase: "build" as const,
      weekNumber: 3,
      totalWeeks: 12,
      weeksToRace: 9,
      volumeMultiplier: 1.1,
      intensityHighPct: 25,
      race: { name: "Half Marathon Bologna", sport: "running" },
    };
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx({ macroContext: macroCtx }));

    const upperSession = result.plan.weeks[0].sessions.find(s => s.type === "forza_upper");
    expect(upperSession?.macroPhase).toBe("build");
  });
});
