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

// Wave 4.1 OQ4.1.1 — mock RAG retrieval per intercettare le chiamate dal Pass-2.
// Default: retrieveRelevantChunks ritorna [] (no chunks, nessun effetto sul prompt).
// chunksAsPromptBlock(< [] >) → "" (vedi knowledge/retriever.ts).
// I test che vogliono validare il wiring verificheranno gli args di
// retrieveRelevantChunks (contexts, query).
vi.mock("../../../knowledge", () => ({
  retrieveRelevantChunks: vi.fn(async () => []),
  chunksAsPromptBlock: vi.fn(() => ""),
  contextsForPass: vi.fn((pass: string) => {
    switch (pass) {
      case "pass2_strength":
        return ["strength_db", "macro_periodization"];
      case "pass2_cardio":
        return ["cardio_intervals", "macro_periodization"];
      default:
        return [];
    }
  }),
}));

import { generateJSON } from "../../../gemini";
import { retrieveRelevantChunks, contextsForPass } from "../../../knowledge";
import { runMultiPass, type OrchestratorContext } from "../passOrchestrator";
import type { UserProfile, UserGoal } from "../../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const mockedGenerateJSON = generateJSON as unknown as ReturnType<typeof vi.fn>;
const mockedRetrieveChunks = retrieveRelevantChunks as unknown as ReturnType<typeof vi.fn>;
const mockedContextsForPass = contextsForPass as unknown as ReturnType<typeof vi.fn>;

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
  mockedRetrieveChunks.mockReset();
  mockedRetrieveChunks.mockImplementation(async () => []);
  mockedContextsForPass.mockClear();
  // Riapplica l'implementazione dopo il reset (mockClear non resetta l'impl, ma
  // mockReset sì — ri-istanziamo per sicurezza nel test che chiama mockReset).
  mockedContextsForPass.mockImplementation((pass: string) => {
    switch (pass) {
      case "pass2_strength":
        return ["strength_db", "macro_periodization"];
      case "pass2_cardio":
        return ["cardio_intervals", "macro_periodization"];
      default:
        return [];
    }
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4.1 OQ4.1.1 — RAG wiring (Pass-2 strength + cardio)
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Wave 4.1 OQ4.1.1 RAG wiring", () => {
  it("calls retrieveRelevantChunks for each strength session with contexts=pass2_strength", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)         // Pass-1
      .mockResolvedValueOnce(strengthPass2Sample)    // forza_upper
      .mockResolvedValueOnce(strengthPass2Sample);   // forza_gambe

    await runMultiPass(mkCtx());

    // 2 strength sessions → 2 RAG calls (cardio Z2 e mobility skip Pass-2 e RAG).
    expect(mockedRetrieveChunks).toHaveBeenCalledTimes(2);

    // Verifica args: ogni call deve avere contexts da pass2_strength.
    const callArgs = mockedRetrieveChunks.mock.calls.map(c => c[0]);
    for (const args of callArgs) {
      expect(args.contexts).toEqual(["strength_db", "macro_periodization"]);
      // Query attesa: subtype + (macroPhase opzionale). Nei sample no macroCtx → solo subtype.
      expect(typeof args.query).toBe("string");
      expect(args.query.length).toBeGreaterThan(0);
    }
  });

  it("calls retrieveRelevantChunks for cardio Z5 session with contexts=pass2_cardio", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonWithZ5)       // Pass-1
      .mockResolvedValueOnce(cardioPass2Sample);   // Pass-2 cardio Z5

    await runMultiPass(mkCtx());

    // Solo 1 sessione cardio Z5 eligibile → 1 RAG call.
    expect(mockedRetrieveChunks).toHaveBeenCalledTimes(1);
    const args = mockedRetrieveChunks.mock.calls[0][0];
    expect(args.contexts).toEqual(["cardio_intervals", "macro_periodization"]);
    expect(args.query).toMatch(/Ripetute/i);
  });

  it("RAG query includes macroPhase when macroContext is provided", async () => {
    const macroCtx = {
      phase: "peak" as const,
      weekNumber: 8,
      totalWeeks: 12,
      weeksToRace: 4,
      volumeMultiplier: 1.0,
      intensityHighPct: 35,
      race: { name: "Half Marathon", sport: "running" },
    };
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonWithZ5)
      .mockResolvedValueOnce(cardioPass2Sample);

    await runMultiPass(mkCtx({ macroContext: macroCtx }));

    const args = mockedRetrieveChunks.mock.calls[0][0];
    expect(args.query).toContain("peak");
    expect(args.query).toContain("Ripetute");
  });

  it("does NOT call retrieveRelevantChunks for mobility/cardio Z1-Z3", async () => {
    // skeletonSample include mobility e corsa Z2 — entrambe NON eligibili Pass-2 → no RAG.
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    await runMultiPass(mkCtx());

    // 2 RAG calls (solo le strength), no calls per mobility o corsa Z2.
    expect(mockedRetrieveChunks).toHaveBeenCalledTimes(2);
  });

  it("RAG retrieval failure is non-fatal (warning + continue)", async () => {
    // Forziamo retrieve a throw → orchestrator deve continuare.
    mockedRetrieveChunks.mockRejectedValue(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    // Plan ancora generato, sessions arricchite.
    const upperSession = result.plan.weeks[0].sessions.find(s => s.type === "forza_upper");
    expect(upperSession?.exercises).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("RAG retrieval"));

    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4.1 OQ4.1.2 — token telemetry (estimate)
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Wave 4.1 OQ4.1.2 token estimate", () => {
  it("Pass-1 PassLog has tokens > 0 (estimated)", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const pass1Log = result.passLogs.find(l => l.pass === 1);
    expect(pass1Log?.tokens).toBeDefined();
    expect(pass1Log!.tokens!).toBeGreaterThan(0);
  });

  it("Pass-2 PassLog has tokens summed across all enriched sessions", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const pass2Log = result.passLogs.find(l => l.pass === 2);
    expect(pass2Log?.tokens).toBeDefined();
    expect(pass2Log!.tokens!).toBeGreaterThan(0);
  });

  it("Pass-3 PassLog has tokens=undefined when no LLM repair (default)", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const pass3Log = result.passLogs.find(l => l.pass === 3);
    // Pass-3 deterministico → no LLM call → tokens undefined.
    expect(pass3Log?.tokens).toBeUndefined();
  });

  it("skipPass2 mode: Pass-2 PassLog has tokens undefined", async () => {
    mockedGenerateJSON.mockResolvedValueOnce(skeletonSample);

    const result = await runMultiPass(mkCtx(), { skipPass2: true });

    const pass2Log = result.passLogs.find(l => l.pass === 2);
    expect(pass2Log?.tokens).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4.1 OQ4.1.3 — parallelizzazione Pass-2 (cap=3)
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Wave 4.1 OQ4.1.3 parallel Pass-2", () => {
  /**
   * Skeleton con 4 sessioni strength → forza il path multi-task. Verifichiamo:
   * - tutte le call vengono effettuate (count finale corretto).
   * - tempo totale < tempo seriale (4 task da 50ms → seriale ~200ms, parallel cap=3 ~100ms).
   */
  const skeleton4Strength = {
    weeks: [
      {
        weekNumber: 1,
        focus: "Forza intensa",
        sessions: [
          { day: "lun", type: "forza_upper", subtype: "Upper A", duration_min: 60, focus: "push" },
          { day: "mar", type: "forza_gambe", subtype: "Lower A", duration_min: 60, focus: "squat" },
          { day: "gio", type: "forza_upper", subtype: "Upper B", duration_min: 60, focus: "pull" },
          { day: "ven", type: "forza_gambe", subtype: "Lower B", duration_min: 60, focus: "hinge" },
        ],
      },
    ],
    rationale: "4 sessioni forza split upper/lower",
  };

  it("invokes Pass-2 once per eligible session (4 strength → 4 calls)", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeleton4Strength)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    await runMultiPass(mkCtx());

    // 1 Pass-1 + 4 Pass-2 strength = 5 totali.
    expect(mockedGenerateJSON).toHaveBeenCalledTimes(5);
  });

  it("Pass-2 runs in parallel (4 tasks @ 50ms with cap=3 → significantly faster than serial)", async () => {
    const TASK_MS = 50;
    let pass1Called = false;

    mockedGenerateJSON.mockImplementation(async () => {
      if (!pass1Called) {
        pass1Called = true;
        return skeleton4Strength;
      }
      // Simula latency Pass-2.
      await new Promise(resolve => setTimeout(resolve, TASK_MS));
      return strengthPass2Sample;
    });

    const t0 = Date.now();
    await runMultiPass(mkCtx());
    const elapsed = Date.now() - t0;

    // Seriale: 4 × 50ms = 200ms. Parallel cap=3: ceil(4/3) batches × 50ms = 100ms.
    // Threshold conservativo: deve essere < 180ms (margin per noise CI).
    expect(elapsed).toBeLessThan(180);
  });

  it("preserves session order in output plan after parallel exec", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeleton4Strength)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    const result = await runMultiPass(mkCtx());

    const days = result.plan.weeks[0].sessions.map(s => s.day);
    expect(days).toEqual(["lun", "mar", "gio", "ven"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4.1 OQ4.1.4 — Pass-3 LLM-repair (FACOLTATIVO)
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Wave 4.1 OQ4.1.4 Pass-3 LLM repair", () => {
  it("default (enablePass3Repair=undefined): Pass-3 NEVER calls LLM", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    await runMultiPass(mkCtx());

    // 1 Pass-1 + 2 Pass-2 = 3. Pass-3 mai LLM di default.
    expect(mockedGenerateJSON).toHaveBeenCalledTimes(3);
  });

  it("with enablePass3Repair=true but no errors: still NO LLM call (validator passed)", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    await runMultiPass(mkCtx(), { enablePass3Repair: true });

    // Nessun error issue → repair branch NON triggers.
    expect(mockedGenerateJSON).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4.1 OQ4.1.5 — focus handover Pass-1 → Pass-2 strength
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiPass — Wave 4.1 OQ4.1.5 focus handover", () => {
  it("Pass-1 focus is propagated as sessionFocus to Pass-2 strength prompt", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonSample)
      .mockResolvedValueOnce(strengthPass2Sample)
      .mockResolvedValueOnce(strengthPass2Sample);

    await runMultiPass(mkCtx());

    // Le call Pass-2 sono quelle dopo la prima (Pass-1).
    // Il prompt user deve contenere la stringa di focus dello skeleton ("upper push pesante" / "squat focus").
    const pass2Calls = mockedGenerateJSON.mock.calls.slice(1);
    const allUserPrompts = pass2Calls.map(c => (c[0] as { userPrompt: string }).userPrompt);

    // Almeno una delle call deve includere il focus dell'upper.
    const upperFocusFound = allUserPrompts.some(p => p.includes("upper push pesante"));
    const lowerFocusFound = allUserPrompts.some(p => p.includes("squat focus"));
    expect(upperFocusFound).toBe(true);
    expect(lowerFocusFound).toBe(true);

    // Verifica anche che il marker label "Focus della sessione" (introdotto nel prompt) sia presente.
    const focusMarkerFound = allUserPrompts.some(p => p.includes("Focus della sessione"));
    expect(focusMarkerFound).toBe(true);
  });

  it("Pass-1 focus is propagated as sessionFocus to Pass-2 cardio prompt (already wired)", async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce(skeletonWithZ5)
      .mockResolvedValueOnce(cardioPass2Sample);

    await runMultiPass(mkCtx());

    const pass2Calls = mockedGenerateJSON.mock.calls.slice(1);
    const userPrompt = (pass2Calls[0][0] as { userPrompt: string }).userPrompt;

    // skeletonWithZ5 ha focus="VO2max 6x800m" sulla sessione Z5.
    expect(userPrompt).toContain("VO2max 6x800m");
    expect(userPrompt).toContain("Focus dichiarato");
  });
});
