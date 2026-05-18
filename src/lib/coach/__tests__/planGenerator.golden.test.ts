// Golden e2e tests per planGenerator — safety net per il refactor pipeline.
//
// Scopo (Sessione A, Sprint 5):
//   Catturare gli INVARIANT che i 3 entry-point (generateInitialPlan,
//   regenerateNextWeek, adaptPlan) devono preservare anche dopo
//   l'estrazione della pipeline shared. Mock LLM controllato; nessuna
//   chiamata di rete. 5 personas rappresentative.
//
// Invariant testati:
//   1. Shape output TrainingPlan valido (weeks/sessions/rationale).
//   2. Prescription block iniettato nel systemInstruction (top-priority).
//   3. userPrompt include profilo, obiettivi, available days, recent days text.
//   4. previousReport → blocco REPORT SETTIMANA PRECEDENTE in regen.
//   5. mode="rest-of-week" → SCENARIO MID-WEEK + giorni rimanenti.
//   6. adaptPlan → userRequest presente nel userPrompt.
//   7. Fallback gracioso onboarding se LLM fallisce.
//   8. Auto-retry sotto-prescrizione: 2 chiamate LLM se primo output <80% target.
//   9. Pre-processing softenRawPlan: enum lowercase + subtype null tollerati.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { UserProfile, UserGoal, TrainingPlan, WeeklyReportSummary } from "../../types";

// Mock LLM: unico punto di controllo. Tutte le altre dipendenze (getLastNDays,
// getCurrentReadiness, loadActiveMacroContext) degradano graceful su localStorage
// vuoto in jsdom — restituiscono [] o null senza errori.
//
// vi.hoisted: necessario perché vitest hoista `vi.mock` SOPRA gli import; senza
// hoisted, la closure su `mockGenerateJSON` punterebbe a `undefined`.
const { mockGenerateJSON } = vi.hoisted(() => ({ mockGenerateJSON: vi.fn() }));
vi.mock("../../gemini", () => ({
  generateJSON: (...args: unknown[]) => mockGenerateJSON(...args),
  hasApiKey: () => true,
}));

// Silence noisy logs (planGenerator ha console.info/debug/warn diagnostici).
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  mockGenerateJSON.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Import DOPO i mock perché vitest hoist `vi.mock` ma `import` viene risolto
// al parse time del modulo: per planGenerator vogliamo che il primo `import`
// veda già il mock.
import { generateInitialPlan, regenerateNextWeek, adaptPlan } from "../planGenerator";

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAS FIXTURE — 5 archetipi audit-derived.
// ─────────────────────────────────────────────────────────────────────────────

const lorenzo: UserProfile = {
  age: 28, sex: "m", weight_kg: 82, height_cm: 178,
  experience: "regular", injuries: [], meds: "",
  weekly_availability: { days: 5, hoursPerSession: 1.5 },
  availableDays: ["lun", "mar", "mer", "ven", "sab"],
  intensityPreference: "very_intense",
  equipment: ["palestra completa", "scarpe corsa"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

const anna: UserProfile = {
  age: 35, sex: "f", weight_kg: 70, height_cm: 165,
  experience: "sedentary", injuries: [], meds: "",
  weekly_availability: { days: 3, hoursPerSession: 0.75 },
  availableDays: ["lun", "mer", "ven"],
  intensityPreference: "soft",
  equipment: ["scarpe corsa"],
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

const marco: UserProfile = {
  age: 40, sex: "m", weight_kg: 70, height_cm: 175,
  experience: "advanced", injuries: [], meds: "",
  weekly_availability: { days: 5, hoursPerSession: 1.0 },
  availableDays: ["lun", "mar", "mer", "ven", "sab"],
  intensityPreference: "intense",
  equipment: ["scarpe corsa", "manubri"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

const giuseppe: UserProfile = {
  age: 62, sex: "m", weight_kg: 78, height_cm: 172,
  experience: "regular", injuries: ["polpaccio"], meds: "",
  weekly_availability: { days: 3, hoursPerSession: 0.75 },
  availableDays: ["mar", "gio", "sab"],
  intensityPreference: "balanced",
  equipment: ["palestra completa"],
  painTrackingAreas: ["polpaccio"],
  createdAt: "2026-02-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

const sara: UserProfile = {
  age: 26, sex: "f", weight_kg: 62, height_cm: 165,
  experience: "advanced", injuries: [], meds: "",
  weekly_availability: { days: 4, hoursPerSession: 1.25 },
  availableDays: ["lun", "mer", "ven", "sab"],
  intensityPreference: "intense",
  equipment: ["bilanciere", "rack", "manubri"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

const goalRunning: UserGoal = {
  id: "g1", originalDescription: "Correre 10K sotto i 50 minuti",
  smartDescription: "Correre 10K sotto 50min entro 2026-09-30",
  kpi: { metric: "tempo 10K", target: "<50min", deadline: "2026-09-30" },
  realistic: true, coachReasoning: "Base aerobica solida + 5 mesi",
  status: "active", createdAt: "2026-04-01T00:00:00Z",
};

const goalWeightLoss: UserGoal = {
  id: "g2", originalDescription: "Perdere 5 kg",
  smartDescription: "Calo peso da 70 a 65 kg entro 2026-08-30",
  kpi: { metric: "peso", target: "65kg", deadline: "2026-08-30" },
  realistic: true, coachReasoning: "Rate sostenibile 0.5-1kg/mese",
  status: "active", createdAt: "2026-04-01T00:00:00Z",
};

const goalStrength: UserGoal = {
  id: "g3", originalDescription: "Squat 1.5x BW",
  smartDescription: "Squat 1RM ≥ 95kg entro 2026-12-31",
  kpi: { metric: "squat 1RM", target: "95kg", deadline: "2026-12-31" },
  realistic: true, coachReasoning: "Progression linear-periodized 6 mesi",
  status: "active", createdAt: "2026-04-01T00:00:00Z",
};

const PERSONAS: Array<{ name: string; profile: UserProfile; goals: UserGoal[] }> = [
  { name: "Lorenzo (28m regular very_intense)", profile: lorenzo, goals: [goalRunning, goalStrength] },
  { name: "Anna (35f sedentary soft)", profile: anna, goals: [goalWeightLoss] },
  { name: "Marco (40m advanced intense)", profile: marco, goals: [goalRunning] },
  { name: "Giuseppe (62m regular balanced injury)", profile: giuseppe, goals: [] },
  { name: "Sara (26f advanced intense strength)", profile: sara, goals: [goalStrength] },
];

// ─────────────────────────────────────────────────────────────────────────────
// MOCK LLM RESPONSE BUILDER
// ─────────────────────────────────────────────────────────────────────────────
// Genera una risposta plausibile dato un volume target. La somma duration_min
// è dimensionata per superare l'85% del target così l'auto-retry non scatta.

function buildMockResponse(opts: {
  totalMin: number;
  days?: string[];
  weekNumber?: number;
  rationale?: string;
}): { weeks: unknown[]; rationale: string } {
  const days = opts.days ?? ["lun", "mar", "mer", "gio", "ven"];
  const perSession = Math.max(20, Math.round(opts.totalMin / days.length));
  return {
    weeks: [{
      weekNumber: opts.weekNumber ?? 1,
      focus: "Build aerobic base + strength support",
      sessions: days.map((d, i) => ({
        day: d,
        type: i === 1 ? "forza_gambe" : "corsa",
        subtype: i === 1 ? "Circuito Misto" : "Fondo Lento",
        duration_min: perSession,
        details: i === 1 ? "Squat 3x10, push-up 3x10" : "Conversazionale in Z2",
        rationale: "Sessione per costruire base",
        ...(i !== 1 ? { zone: 2 } : {}),
      })),
    }],
    rationale: opts.rationale ?? "- Volume entro target\n- Rispetta vincoli\n- Bilanciato corsa+forza",
  };
}

// Helper: estrae l'ultima chiamata a generateJSON e ritorna systemInstruction + userPrompt.
function capturePromptArgs(): { systemInstruction: string; userPrompt: string } {
  expect(mockGenerateJSON).toHaveBeenCalled();
  const call = mockGenerateJSON.mock.calls.at(-1);
  expect(call).toBeDefined();
  const params = call![0] as { systemInstruction: string; userPrompt: string };
  return params;
}

// Genera la lista giorni disponibili dal profilo (defaults a 5 giorni feriali).
function daysFor(profile: UserProfile): string[] {
  return profile.availableDays && profile.availableDays.length > 0
    ? [...profile.availableDays]
    : ["lun", "mar", "mer", "gio", "ven"];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 1: generateInitialPlan × 5 personas
// ─────────────────────────────────────────────────────────────────────────────

describe("generateInitialPlan — shape + prompt invariants", () => {
  it.each(PERSONAS)("$name → ritorna TrainingPlan valido e prompt completo", async ({ profile, goals }) => {
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 600,
      days: daysFor(profile),
    }));

    const plan = await generateInitialPlan(profile, goals);

    // Shape invariants.
    expect(plan).toBeDefined();
    expect(plan.weeks.length).toBeGreaterThanOrEqual(1);
    expect(plan.weeks[0].sessions.length).toBeGreaterThan(0);
    expect(plan.rationale).toBeTruthy();
    expect(plan.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(plan.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(plan.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(plan.profileHash).toBeTruthy();
    for (const s of plan.weeks[0].sessions) {
      expect(s.day).toBeTruthy();
      expect(s.type).toBeTruthy();
      expect(s.duration_min).toBeGreaterThan(0);
      expect(s.details).toBeTruthy();
      expect(s.rationale).toBeTruthy();
    }

    // Prompt invariants.
    const { systemInstruction, userPrompt } = capturePromptArgs();
    expect(systemInstruction).toContain("VINCOLO MATEMATICO INDEROGABILE");
    expect(systemInstruction).toContain("PRESCRIZIONE TARGET");
    expect(userPrompt).toContain("PROFILO UTENTE");
    if (goals.length > 0) {
      expect(userPrompt).toContain("OBIETTIVI");
    }
    // availableDays è injectato come blocco esplicito.
    expect(userPrompt).toContain("GIORNI ALLENABILI");
    for (const d of daysFor(profile)) {
      expect(userPrompt.toLowerCase()).toContain(d);
    }
  });

  it("Lorenzo (very_intense + 1.5h) — prescription target ≥600 min/sett", async () => {
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 600,
      days: daysFor(lorenzo),
    }));
    await generateInitialPlan(lorenzo, [goalRunning]);

    const { systemInstruction } = capturePromptArgs();
    // Estrai numero target dal blocco "Volume settimanale: NNN min totali".
    const m = systemInstruction.match(/Volume settimanale: (\d+) min/);
    expect(m).toBeTruthy();
    const target = Number(m![1]);
    // Lorenzo very_intense + regular + 1.5h × 5gg = target alto.
    // Guard rail: deve essere ≥250 (era il bug live: 126min). Cap superiore
    // largo (1500) per essere robusto a future tuning della prescrizione.
    expect(target).toBeGreaterThanOrEqual(250);
    expect(target).toBeLessThanOrEqual(1500);
  });

  it("Giuseppe (62y) — prescription include age decay nel blocco", async () => {
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 200,
      days: daysFor(giuseppe),
    }));
    await generateInitialPlan(giuseppe, []);

    const { systemInstruction } = capturePromptArgs();
    // Età ≥50: minRestDays = 3 (vs 2 per <50). Verifica che la prescription
    // riporti il rest constraint.
    expect(systemInstruction).toMatch(/Riposo: min 3 gg/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 2: regenerateNextWeek × 5 personas + previousReport + rest-of-week
// ─────────────────────────────────────────────────────────────────────────────

describe("regenerateNextWeek — shape + closed-loop invariants", () => {
  const currentPlan: TrainingPlan = {
    generatedAt: "2026-05-11T00:00:00Z",
    validUntil: "2026-05-25T00:00:00Z",
    startDate: "2026-05-11",
    profileHash: "h1",
    weeks: [{
      weekNumber: 1, focus: "base",
      sessions: [
        { day: "lun", type: "corsa", duration_min: 60, details: "Z2", rationale: "base", zone: 2 },
        { day: "gio", type: "forza_gambe", duration_min: 45, details: "squat", rationale: "forza" },
      ],
    }],
    rationale: "piano precedente",
  };

  it.each(PERSONAS)("$name → next-week shape valido", async ({ profile, goals }) => {
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 500,
      days: daysFor(profile),
    }));

    const plan = await regenerateNextWeek(profile, goals, currentPlan, "DIARIO DEI 14GG", "next-week");

    expect(plan.weeks.length).toBeGreaterThanOrEqual(1);
    expect(plan.weeks[0].sessions.length).toBeGreaterThan(0);
    expect(plan.rationale).toBeTruthy();

    const { systemInstruction, userPrompt } = capturePromptArgs();
    expect(systemInstruction).toContain("PRESCRIZIONE TARGET");
    expect(userPrompt).toContain("PIANO CORRENTE");
    expect(userPrompt).toContain("ULTIMI 14 GIORNI REALI DAL DIARIO");
    expect(userPrompt).toContain("DIARIO DEI 14GG");
  });

  it("previousReport → blocco REPORT SETTIMANA PRECEDENTE iniettato", async () => {
    const previousReport: WeeklyReportSummary = {
      adherencePct: 65,
      volumeByDiscipline: { corsa: { planned_min: 300, actual_min: 180 } },
      painTrend: "stabile",
      adjustmentsHints: "ridurre volume cardio del 15%",
    };
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 400,
      days: daysFor(lorenzo),
    }));

    await regenerateNextWeek(lorenzo, [goalRunning], currentPlan, "diario", "next-week", undefined, previousReport);

    const { userPrompt } = capturePromptArgs();
    expect(userPrompt).toContain("REPORT SETTIMANA PRECEDENTE");
    expect(userPrompt).toContain("Aderenza: 65%");
    expect(userPrompt).toContain("pianificato 300min vs eseguito 180min");
    expect(userPrompt).toContain("ridurre volume cardio del 15%");
  });

  it("adherence bassa → target volume ridotto (adherence cap deterministico)", async () => {
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 400,
      days: daysFor(lorenzo),
    }));

    const reportLow: WeeklyReportSummary = {
      adherencePct: 50, // <60 → multiplier 0.85
      volumeByDiscipline: { corsa: { planned_min: 400, actual_min: 200 } },
      painTrend: "",
      adjustmentsHints: "",
    };
    await regenerateNextWeek(lorenzo, [goalRunning], currentPlan, "diario", "next-week", undefined, reportLow);
    const lowTarget = Number(capturePromptArgs().systemInstruction.match(/Volume settimanale: (\d+) min/)![1]);

    mockGenerateJSON.mockReset();
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 600,
      days: daysFor(lorenzo),
    }));
    const reportHigh: WeeklyReportSummary = {
      adherencePct: 95,
      volumeByDiscipline: { corsa: { planned_min: 400, actual_min: 380 } },
      painTrend: "",
      adjustmentsHints: "",
    };
    await regenerateNextWeek(lorenzo, [goalRunning], currentPlan, "diario", "next-week", undefined, reportHigh);
    const highTarget = Number(capturePromptArgs().systemInstruction.match(/Volume settimanale: (\d+) min/)![1]);

    // Invariant: aderenza bassa NON deve produrre target ≥ aderenza alta.
    expect(lowTarget).toBeLessThanOrEqual(highTarget);
  });

  it('mode="rest-of-week" → blocco SCENARIO MID-WEEK presente', async () => {
    // Forziamo "oggi = mercoledì" così i giorni rimanenti sono mer..dom.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T10:00:00")); // mercoledì
    try {
      mockGenerateJSON.mockResolvedValue(buildMockResponse({
        totalMin: 200,
        days: ["mer", "ven", "sab"],
      }));
      await regenerateNextWeek(lorenzo, [goalRunning], currentPlan, "diario", "rest-of-week");

      const { userPrompt } = capturePromptArgs();
      expect(userPrompt).toContain("SCENARIO MID-WEEK");
      expect(userPrompt).toMatch(/OGGI è mer/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mode="rest-of-week" con finestra ≤2gg → guardrail leggera attivato', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00")); // sabato → restano sab+dom = 2
    try {
      mockGenerateJSON.mockResolvedValue(buildMockResponse({
        totalMin: 60,
        days: ["sab"],
      }));
      await regenerateNextWeek(lorenzo, [goalRunning], currentPlan, "diario", "rest-of-week");

      const { userPrompt } = capturePromptArgs();
      expect(userPrompt).toContain("FINESTRA RIDOTTA");
      expect(userPrompt).toMatch(/NO Z4\/Z5/);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 3: adaptPlan
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptPlan — userRequest invariants", () => {
  const currentPlan: TrainingPlan = {
    generatedAt: "2026-05-11T00:00:00Z",
    validUntil: "2026-05-25T00:00:00Z",
    startDate: "2026-05-11",
    weeks: [{
      weekNumber: 1, focus: "base",
      sessions: [
        { day: "lun", type: "corsa", duration_min: 60, details: "Z2", rationale: "base", zone: 2 },
      ],
    }],
    rationale: "piano",
  };

  it("Lorenzo richiesta 'sostituisci giovedì con padel' → presente nel prompt", async () => {
    mockGenerateJSON.mockResolvedValue(buildMockResponse({
      totalMin: 450,
      days: daysFor(lorenzo),
    }));

    const userRequest = "Sostituisci la sessione di giovedì con un'ora di padel agonistico";
    const plan = await adaptPlan(lorenzo, [goalRunning], currentPlan, "diario", userRequest);

    expect(plan.weeks[0].sessions.length).toBeGreaterThan(0);
    const { userPrompt } = capturePromptArgs();
    expect(userPrompt).toContain(userRequest);
    expect(userPrompt).toContain("PIANO CORRENTE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 4: Fallback gracioso onboarding
// ─────────────────────────────────────────────────────────────────────────────

describe("generateInitialPlan — fallback gracioso se LLM fallisce", () => {
  it("LLM throw → ritorna piano di emergenza (no throw)", async () => {
    mockGenerateJSON.mockRejectedValue(new Error("Gemini down"));

    const plan = await generateInitialPlan(lorenzo, [goalRunning]);
    expect(plan).toBeDefined();
    expect(plan.weeks[0].sessions.length).toBeGreaterThan(0);
    // Fallback include marker testuale nel rationale.
    expect(plan.rationale).toContain("Piano di emergenza");
  });

  it("LLM ritorna JSON malformato (Zod fail) → fallback", async () => {
    mockGenerateJSON.mockResolvedValue({ weeks: "not-an-array", rationale: 123 });

    const plan = await generateInitialPlan(anna, [goalWeightLoss]);
    expect(plan).toBeDefined();
    expect(plan.rationale).toContain("Piano di emergenza");
  });

  it("fallback senior (Giuseppe 62y) → durate ridotte + note età", async () => {
    mockGenerateJSON.mockRejectedValue(new Error("LLM unreachable"));

    const plan = await generateInitialPlan(giuseppe, []);
    expect(plan.rationale).toContain("Piano di emergenza");
    expect(plan.rationale).toMatch(/fascia età ≥65|Cardio sospeso/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 5: Auto-retry sotto-prescrizione
// ─────────────────────────────────────────────────────────────────────────────

describe("generateInitialPlan — auto-retry sotto-prescrizione", () => {
  it("primo output <80% target → 2 chiamate LLM (retry attivato)", async () => {
    // Lorenzo target ~600 min. Primo output 200 → -67%, dentro la soglia retry.
    mockGenerateJSON.mockResolvedValueOnce(buildMockResponse({
      totalMin: 200, days: daysFor(lorenzo),
    }));
    mockGenerateJSON.mockResolvedValueOnce(buildMockResponse({
      totalMin: 600, days: daysFor(lorenzo),
    }));

    await generateInitialPlan(lorenzo, [goalRunning]);

    expect(mockGenerateJSON).toHaveBeenCalledTimes(2);
    // Il secondo prompt deve contenere l'addendum esplicito.
    const secondCall = mockGenerateJSON.mock.calls[1]![0] as { userPrompt: string };
    expect(secondCall.userPrompt).toContain("ATTENZIONE — RIGENERAZIONE OBBLIGATORIA");
  });

  it("primo output dentro range (≥80% target) → NO retry", async () => {
    mockGenerateJSON.mockResolvedValueOnce(buildMockResponse({
      totalMin: 600, days: daysFor(lorenzo),
    }));

    await generateInitialPlan(lorenzo, [goalRunning]);

    expect(mockGenerateJSON).toHaveBeenCalledTimes(1);
  });

  it("retry fallisce (LLM throw secondo turno) → mantiene primo piano (no exception)", async () => {
    mockGenerateJSON.mockResolvedValueOnce(buildMockResponse({
      totalMin: 200, days: daysFor(lorenzo),
    }));
    mockGenerateJSON.mockRejectedValueOnce(new Error("retry network down"));

    const plan = await generateInitialPlan(lorenzo, [goalRunning]);
    expect(plan).toBeDefined();
    expect(plan.weeks[0].sessions.length).toBeGreaterThan(0);
    expect(mockGenerateJSON).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 6: Schema tolerance (softenRawPlan + Zod transforms)
// ─────────────────────────────────────────────────────────────────────────────

describe("schema tolerance — variations Gemini reali tollerate", () => {
  it("subtype:null + duration_min stringa + enum UPPERCASE → parsing OK", async () => {
    mockGenerateJSON.mockResolvedValue({
      weeks: [{
        weekNumber: 1,
        focus: "test",
        sessions: [
          {
            day: "LUN", // uppercase: softenRawPlan lo lowercase
            type: "CORSA",
            subtype: null, // null tollerato
            duration_min: "60", // string coerced
            details: "test",
            rationale: "test",
            zone: "2", // string coerced
          },
          {
            day: "mer",
            type: "forza_gambe",
            subtype: null,
            duration_min: 45,
            details: "squat",
            rationale: "test",
          },
        ],
      }],
      rationale: "ok",
    });

    const plan = await generateInitialPlan(lorenzo, [goalRunning]);
    expect(plan.weeks[0].sessions[0].day).toBe("lun");
    expect(plan.weeks[0].sessions[0].type).toBe("corsa");
    expect(plan.weeks[0].sessions[0].duration_min).toBe(60);
    expect(plan.weeks[0].sessions[0].zone).toBe(2);
  });

  it("rationale come array di stringhe → joinato in bullet list", async () => {
    mockGenerateJSON.mockResolvedValue({
      weeks: [{
        weekNumber: 1, focus: "test",
        sessions: [{
          day: "lun", type: "corsa", subtype: "Fondo Lento",
          duration_min: 60, details: "Z2", rationale: "base", zone: 2,
        }],
      }],
      rationale: ["primo bullet", "- secondo bullet", "terzo bullet"],
    });

    const plan = await generateInitialPlan(lorenzo, [goalRunning]);
    // L'array deve essere joinato come lista markdown.
    expect(plan.rationale).toContain("- primo bullet");
    expect(plan.rationale).toContain("- secondo bullet");
    expect(plan.rationale).toContain("- terzo bullet");
  });
});
