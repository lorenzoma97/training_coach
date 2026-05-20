// Golden tests per sessionDetail.ts (2026-05-19).
// Verifica:
//   1. Strength: prompt include allowlist filtered + 1RM + perf history
//   2. Strength: cue da catalog (non LLM-generated), substitution chain
//   3. Strength: math check rileva sessioni sovradimensionate
//   4. Cardio: prompt include readiness + recent cardio + zone
//   5. Pain-aware: pattern problematici esclusi dall'allowlist
//   6. Readiness low: prompt include downgrade instruction
//   7. Mobility/sport: ritorna sessione invariata (V1 scope)

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { UserProfile, UserGoal, PlannedSession } from "../../types";

const { mockGenerateJSON } = vi.hoisted(() => ({ mockGenerateJSON: vi.fn() }));
vi.mock("../../gemini", () => ({
  generateJSON: (...args: unknown[]) => mockGenerateJSON(...args),
  hasApiKey: () => true,
}));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  mockGenerateJSON.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); });

import { generateSessionDetail } from "../sessionDetail";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const lorenzo: UserProfile = {
  age: 28, sex: "m", weight_kg: 82, height_cm: 178,
  experience: "regular", injuries: [], meds: "",
  weekly_availability: { days: 5, hoursPerSession: 1.5 },
  availableDays: ["lun", "mar", "mer", "ven", "sab"],
  intensityPreference: "very_intense",
  equipment: ["barbell", "dumbbell", "kettlebell", "bench", "pullup_bar", "box"],
  oneRepMaxes: [
    { exerciseId: "back-squat-barbell", value_kg: 110, source: "tested", acquiredAt: "2026-04-01" },
    { exerciseId: "deadlift-conventional-barbell", value_kg: 140, source: "estimated", acquiredAt: "2026-04-15" },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

const lorenzoNoEquipment: UserProfile = {
  ...lorenzo,
  equipment: [], // solo bodyweight (implicito)
  oneRepMaxes: [],
};

const giuseppePolpaccio: UserProfile = {
  ...lorenzo, age: 62, intensityPreference: "balanced",
  injuries: ["polpaccio"], painTrackingAreas: ["polpaccio"],
};

const goal: UserGoal = {
  id: "g1", originalDescription: "Squat 1.5xBW",
  smartDescription: "Squat 1RM 125kg entro 2026-12-31",
  kpi: { metric: "squat 1RM", target: "125kg", deadline: "2026-12-31" },
  realistic: true, coachReasoning: "ok", status: "active",
  createdAt: "2026-04-01T00:00:00Z",
};

const strengthSession: PlannedSession = {
  day: "lun",
  type: "forza_gambe",
  subtype: "Circuito Misto",
  duration_min: 60,
  details: "Sessione focus quadricipiti",
  rationale: "base forza",
};

const cardioSession: PlannedSession = {
  day: "mar",
  type: "corsa",
  subtype: "Fondo Lento",
  duration_min: 45,
  details: "Z2 conversazionale",
  rationale: "base aerobica",
  zone: 2,
};

const mobilitySession: PlannedSession = {
  day: "mer",
  type: "mobilita",
  duration_min: 20,
  details: "Stretching generale",
  rationale: "recovery",
};

function captureLastCall() {
  expect(mockGenerateJSON).toHaveBeenCalled();
  const call = mockGenerateJSON.mock.calls.at(-1);
  return call![0] as { systemInstruction: string; userPrompt: string };
}

// ─── TEST SUITE 1: Strength flow ──────────────────────────────────────────

describe("generateSessionDetail — strength", () => {
  it("invoca LLM con allowlist + 1RM + readiness + restituisce exercises[]", async () => {
    mockGenerateJSON.mockResolvedValue({
      exercises: [
        { exerciseId: "back-squat-barbell", plannedSets: 4, repsTarget: { min: 6, max: 6 }, pct1RM: 75, rest_sec: 180 },
        { exerciseId: "romanian-deadlift-barbell", plannedSets: 3, repsTarget: { min: 8, max: 10 }, rpe_target: 8, rest_sec: 150 },
        { exerciseId: "bulgarian-split-squat-dumbbell", plannedSets: 3, repsTarget: { min: 10, max: 12 }, rpe_target: 7, rest_sec: 120 },
        { exerciseId: "plank-front", plannedSets: 3, repsTarget: { min: 30, max: 45 }, rpe_target: 7, rest_sec: 60 },
      ],
    });

    const result = await generateSessionDetail({ session: strengthSession, profile: lorenzo, goals: [goal] });

    expect(result.meta.kind).toBe("strength");
    expect(result.session.exercises).toBeDefined();
    expect(result.session.exercises!.length).toBeGreaterThan(0);

    const { systemInstruction, userPrompt } = captureLastCall();
    // SystemInstruction include regole
    expect(systemInstruction).toContain("REGOLE NON NEGOZIABILI");
    expect(systemInstruction).toContain("Compound first");
    // UserPrompt include allowlist con almeno un esercizio gambe
    expect(userPrompt).toMatch(/ALLOWLIST ESERCIZI/);
    expect(userPrompt).toMatch(/back-squat-barbell|goblet-squat-kettlebell|dumbbell-squat/);
    // UserPrompt include 1RM noti
    expect(userPrompt).toContain("back-squat-barbell: 110kg");
  });

  it("cue dell'esercizio viene forzato dal catalog, NON dall'LLM", async () => {
    mockGenerateJSON.mockResolvedValue({
      exercises: [
        { exerciseId: "back-squat-barbell", plannedSets: 3, repsTarget: { min: 5, max: 5 }, pct1RM: 80, rest_sec: 180,
          cue: "CUE INVENTATO DALL'LLM — IGNORARE" },
        { exerciseId: "romanian-deadlift-barbell", plannedSets: 3, repsTarget: { min: 6, max: 8 }, rpe_target: 8, rest_sec: 150 },
      ],
    });

    const result = await generateSessionDetail({ session: strengthSession, profile: lorenzo, goals: [goal] });
    // Il cue NON deve essere quello inventato dall'LLM
    expect(result.session.exercises![0].cue).not.toContain("CUE INVENTATO");
    // Deve invece coincidere con la prima frase del technique del catalog
    expect(result.session.exercises![0].cue).toMatch(/[Pp]etto alto|ginocchia/);
  });

  it("substitution chain: esercizi barbell con utente solo bodyweight → swap a bodyweight", async () => {
    mockGenerateJSON.mockResolvedValue({
      exercises: [
        { exerciseId: "back-squat-barbell", plannedSets: 3, repsTarget: { min: 8, max: 12 }, rpe_target: 7, rest_sec: 90 },
        { exerciseId: "romanian-deadlift-barbell", plannedSets: 3, repsTarget: { min: 8, max: 10 }, rpe_target: 7, rest_sec: 90 },
      ],
    });

    const result = await generateSessionDetail({
      session: strengthSession, profile: lorenzoNoEquipment, goals: [],
    });
    // Substitution applicata: gli exerciseId finali NON contengono i barbell originali
    // (devono degradare a varianti bodyweight o equivalenti nella chain alternatives)
    const finalIds = result.session.exercises!.map(e => e.exerciseId);
    expect(finalIds).not.toContain("back-squat-barbell");
    expect(finalIds).not.toContain("romanian-deadlift-barbell");
    // Meta.substitutions popolato (≥1 swap registrato)
    expect(result.meta.substitutions.length).toBeGreaterThan(0);
  });

  it("pain attivo (polpaccio) → patterns lunge/plyometric esclusi dall'allowlist", async () => {
    // Mock daily check con dolore polpaccio attivo.
    // NB: la chiave storage è `day:${date}`, non `diary-${date}` (cfr loadDay()).
    const todayIso = new Date().toISOString().split("T")[0];
    localStorage.setItem("diary-index", JSON.stringify([todayIso]));
    localStorage.setItem(`day:${todayIso}`, JSON.stringify({
      daily: { polpaccio: { pre: 3, during: 2, post: 1 } },
      workouts: [],
    }));

    mockGenerateJSON.mockResolvedValue({
      exercises: [
        { exerciseId: "back-squat-barbell", plannedSets: 3, repsTarget: { min: 6, max: 8 }, rpe_target: 7, rest_sec: 150 },
        { exerciseId: "romanian-deadlift-barbell", plannedSets: 3, repsTarget: { min: 8, max: 10 }, rpe_target: 7, rest_sec: 120 },
      ],
    });

    const result = await generateSessionDetail({
      session: strengthSession, profile: giuseppePolpaccio, goals: [],
    });
    expect(result.meta.activePainAreas).toContain("polpaccio");

    const { userPrompt } = captureLastCall();
    // L'allowlist iniettata NON deve contenere esercizi categorizzati pattern=lunge
    // (forward/reverse/lateral lunge, cossack squat) né pattern=plyometric esplicito
    // (box/broad/depth jump, lateral bound). NB: jump-squat è pattern=squat, NON
    // plyometric — esce dall'esclusione lunge/plyometric ma è OK perché il filtering
    // si basa sul pattern, non sul nome.
    expect(userPrompt).not.toMatch(/forward-lunge|reverse-lunge|lateral-lunge|cossack-squat/);
    expect(userPrompt).not.toMatch(/box-jump|broad-jump|depth-jump|lateral-bound/);
  });

  it("math check: troppi sets/recuperi sovradimensionano la sessione → flag ok=false", async () => {
    // Sessione 30 min ma 8 esercizi × 4 sets × 180s rest = 96min ben oltre 33min
    const shortSession: PlannedSession = { ...strengthSession, duration_min: 30 };
    mockGenerateJSON.mockResolvedValue({
      exercises: Array.from({ length: 8 }, (_, i) => ({
        exerciseId: i % 2 === 0 ? "back-squat-barbell" : "romanian-deadlift-barbell",
        plannedSets: 4,
        repsTarget: { min: 5, max: 5 },
        rpe_target: 8,
        rest_sec: 180,
      })),
    });
    const result = await generateSessionDetail({ session: shortSession, profile: lorenzo, goals: [goal] });
    expect(result.meta.mathCheck.ok).toBe(false);
    expect(result.meta.mathCheck.note).toMatch(/eccede target/);
  });
});

// ─── TEST SUITE 2: Cardio flow ─────────────────────────────────────────────

describe("generateSessionDetail — cardio", () => {
  it("genera intervals con warmup + main + cooldown", async () => {
    mockGenerateJSON.mockResolvedValue({
      intervals: [
        { kind: "warmup", duration_min: 10, zone: 2, cue: "Riscaldamento conversazionale" },
        { kind: "main", duration_min: 30, zone: 2, cue: "Fondo lento, passo costante" },
        { kind: "cooldown", duration_min: 5, zone: 1, cue: "Recupero camminata + corsa lenta" },
      ],
    });

    const result = await generateSessionDetail({ session: cardioSession, profile: lorenzo, goals: [] });
    expect(result.meta.kind).toBe("cardio");
    expect(result.session.intervals).toBeDefined();
    expect(result.session.intervals!.length).toBe(3);
    expect(result.meta.mathCheck.ok).toBe(true);

    const { systemInstruction, userPrompt } = captureLastCall();
    expect(systemInstruction).toContain("coach endurance");
    expect(userPrompt).toContain("Fondo Lento");
  });

  it("cardio readiness=low → prompt include downgrade", async () => {
    // Mock readiness low: scrivo direttamente in storage
    const todayIso = new Date().toISOString().split("T")[0];
    localStorage.setItem("readiness-history", JSON.stringify([
      { date: todayIso, score: 30, band: "low", inputs: {} },
    ]));

    mockGenerateJSON.mockResolvedValue({
      intervals: [
        { kind: "warmup", duration_min: 10, zone: 1, cue: "wu" },
        { kind: "main", duration_min: 30, zone: 2, cue: "main" },
        { kind: "cooldown", duration_min: 5, zone: 1, cue: "cd" },
      ],
    });
    const result = await generateSessionDetail({ session: cardioSession, profile: lorenzo, goals: [] });
    expect(result.meta.readinessBand).toBe("low");
    expect(result.meta.intensityModifier).toBe(0.9);

    const { systemInstruction } = captureLastCall();
    expect(systemInstruction).toMatch(/READINESS LOW/);
  });
});

// ─── TEST SUITE 3: Mobility/Sport (no LLM call) ────────────────────────────

describe("generateSessionDetail — mobility/sport", () => {
  it("mobility session → ritorna invariata, niente chiamata LLM", async () => {
    const result = await generateSessionDetail({
      session: mobilitySession, profile: lorenzo, goals: [],
    });
    expect(result.meta.kind).toBe("mobility");
    expect(result.session).toEqual(mobilitySession);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });
});

// ─── TEST SUITE 4: Warmup auto-link ───────────────────────────────────────

describe("generateSessionDetail — warmup auto-link", () => {
  it("corsa → warmupRoutineId pointe a dynamic-flow-runner", async () => {
    mockGenerateJSON.mockResolvedValue({
      intervals: [
        { kind: "warmup", duration_min: 10, zone: 2, cue: "wu" },
        { kind: "main", duration_min: 30, zone: 2, cue: "main" },
        { kind: "cooldown", duration_min: 5, zone: 1, cue: "cd" },
      ],
    });
    const result = await generateSessionDetail({ session: cardioSession, profile: lorenzo, goals: [] });
    expect(result.session.warmupRoutineId).toBe("dynamic-flow-runner");
  });

  it("forza → warmupRoutineId pointe a movement-prep (generico)", async () => {
    mockGenerateJSON.mockResolvedValue({
      exercises: [
        { exerciseId: "back-squat-barbell", plannedSets: 3, repsTarget: { min: 6, max: 8 }, rpe_target: 7, rest_sec: 150 },
        { exerciseId: "romanian-deadlift-barbell", plannedSets: 3, repsTarget: { min: 8, max: 10 }, rpe_target: 7, rest_sec: 120 },
      ],
    });
    const result = await generateSessionDetail({ session: strengthSession, profile: lorenzo, goals: [goal] });
    expect(result.session.warmupRoutineId).toBe("movement-prep");
  });
});
