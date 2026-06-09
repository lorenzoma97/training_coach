// Golden test adattatore vincolato macro→settimana (Sprint F, 2026-06-09).
// Verifica che l'applier rispetti gli invarianti del macro (scheletro intatto,
// magnitudine limitata) e che le op fuori vincolo vengano rifiutate.

import { describe, it, expect } from "vitest";
import { applyAdaptationDiff, type AdaptationDiff, type AdaptContext } from "../macroAdapter";
import type { PlannedSession } from "../../types";
import type { MacroProgram } from "../../types/macroprogram";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function strengthSession(day: string, sets = 4, rpe = 7): PlannedSession {
  return {
    day, type: "forza_gambe", duration_min: 60, details: "", rationale: "macro",
    exercises: [
      { exerciseId: "back-squat-barbell", plannedSets: sets, repsTarget: { min: 6, max: 6 }, rest_sec: 150, rpe_target: rpe },
      { exerciseId: "deadlift-romanian-dumbbell", plannedSets: sets, repsTarget: { min: 8, max: 8 }, rest_sec: 90, rpe_target: rpe },
    ],
  };
}

function cardioSession(day: string, zone: 1 | 2 | 3 | 4 | 5 = 4): PlannedSession {
  return {
    day, type: "corsa", duration_min: 50, details: "", rationale: "macro", zone,
    intervals: [
      { kind: "warmup", duration_min: 10, zone: 2 },
      { kind: "main", reps: 4, duration_min: 4, zone, recovery_sec: 120 },
      { kind: "cooldown", duration_min: 6, zone: 1 },
    ],
  };
}

const program: MacroProgram = {
  metadata: { title: "Test", goal: "g", sport: "calcio", weeks_total: 4, start_date: "2026-06-01" },
  phases: [{ name: "Forza", weeks: [1, 4], focus: "forza", rpe_target_min: 6, rpe_target_max: 8 }],
  weeks: [],
  narrative_markdown: "",
  imported_at: "2026-06-01T00:00:00Z",
};

const baseCtx: AdaptContext = {
  program,
  weekNumber: 2,
  readinessBand: "moderate",
  exerciseExists: (id) => ["leg-press-machine", "back-squat-barbell", "deadlift-romanian-dumbbell"].includes(id),
};

function week(): PlannedSession[] {
  return [strengthSession("lun"), cardioSession("mer"), strengthSession("ven")];
}

// ─── move ────────────────────────────────────────────────────────────────────

describe("applyAdaptationDiff — move", () => {
  it("sposta una sessione su un giorno libero", () => {
    const diff: AdaptationDiff = { ops: [{ op: "move", day: "ven", toDay: "sab", reason: "impegno" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.applied).toHaveLength(1);
    expect(r.sessions.map(s => s.day)).toEqual(["lun", "mer", "sab"]);
    expect(r.sessions.find(s => s.day === "sab")?.type).toBe("forza_gambe");
  });

  it("rifiuta move su giorno occupato (no double-book)", () => {
    const diff: AdaptationDiff = { ops: [{ op: "move", day: "ven", toDay: "mer", reason: "x" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/occupato/);
    expect(r.sessions).toHaveLength(3); // invariato
  });

  it("rifiuta move su giorno non valido", () => {
    const diff: AdaptationDiff = { ops: [{ op: "move", day: "ven", toDay: "xyz" as any, reason: "x" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });
});

// ─── scaleVolume ───────────────────────────────────────────────────────────────

describe("applyAdaptationDiff — scaleVolume", () => {
  it("riduce durata e set forza", () => {
    const diff: AdaptationDiff = { ops: [{ op: "scaleVolume", day: "lun", factor: 0.5, reason: "fatica" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    const lun = r.sessions.find(s => s.day === "lun")!;
    expect(lun.duration_min).toBe(30);
    expect(lun.exercises![0].plannedSets).toBe(2);
    expect(lun.readinessAdjusted).toBe(true);
  });

  it("clampa factor sotto 0.5", () => {
    const diff: AdaptationDiff = { ops: [{ op: "scaleVolume", day: "mer", factor: 0.1, reason: "x" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    const mer = r.sessions.find(s => s.day === "mer")!;
    expect(mer.duration_min).toBe(25); // 50 * 0.5
  });

  it("non scende sotto 2 set", () => {
    const diff: AdaptationDiff = { ops: [{ op: "scaleVolume", day: "lun", factor: 0.5, reason: "x" }], summary: "" };
    const sessions = [strengthSession("lun", 3)];
    const r = applyAdaptationDiff(sessions, diff, baseCtx);
    expect(r.sessions[0].exercises![0].plannedSets).toBe(2);
  });
});

// ─── scaleIntensity ─────────────────────────────────────────────────────────────

describe("applyAdaptationDiff — scaleIntensity", () => {
  it("downgrade zona cardio + intervalli", () => {
    const diff: AdaptationDiff = { ops: [{ op: "scaleIntensity", day: "mer", deltaZone: -1, reason: "readiness" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    const mer = r.sessions.find(s => s.day === "mer")!;
    expect(mer.zone).toBe(3);
    expect(mer.intervals!.find(i => i.kind === "main")!.zone).toBe(3);
  });

  it("blocca upgrade se readiness bassa", () => {
    const diff: AdaptationDiff = { ops: [{ op: "scaleIntensity", day: "mer", deltaZone: 1, reason: "sto bene" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, { ...baseCtx, readinessBand: "low" });
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/readiness/);
  });

  it("cappa rpe upgrade al max della fase (8)", () => {
    const diff: AdaptationDiff = { ops: [{ op: "scaleIntensity", day: "lun", deltaZone: 1, reason: "sto bene" }], summary: "" };
    const sessions = [strengthSession("lun", 4, 8)]; // gia' a rpe 8 = cap fase
    const r = applyAdaptationDiff(sessions, diff, { ...baseCtx, readinessBand: "high" });
    expect(r.sessions[0].exercises![0].rpe_target).toBe(8); // non sale a 9
  });
});

// ─── swapExercise ───────────────────────────────────────────────────────────────

describe("applyAdaptationDiff — swapExercise", () => {
  it("sostituisce un esercizio esistente nel catalog", () => {
    const diff: AdaptationDiff = { ops: [{ op: "swapExercise", day: "lun", exerciseId: "back-squat-barbell", toExerciseId: "leg-press-machine", reason: "dolore ginocchio" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    const lun = r.sessions.find(s => s.day === "lun")!;
    expect(lun.exercises![0].exerciseId).toBe("leg-press-machine");
    expect(lun.exercises![0].plannedSets).toBe(4); // sets/reps preservati
  });

  it("rifiuta swap verso esercizio non nel catalog", () => {
    const diff: AdaptationDiff = { ops: [{ op: "swapExercise", day: "lun", exerciseId: "back-squat-barbell", toExerciseId: "esercizio-inventato", reason: "x" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/non nel catalog/);
  });

  it("rifiuta swap di esercizio non presente nella sessione", () => {
    const diff: AdaptationDiff = { ops: [{ op: "swapExercise", day: "lun", exerciseId: "bench-press", toExerciseId: "leg-press-machine", reason: "x" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/non presente/);
  });
});

// ─── dropSession + invarianti scheletro ──────────────────────────────────────────

describe("applyAdaptationDiff — dropSession + invarianti", () => {
  it("rimuove una sessione entro il limite", () => {
    const diff: AdaptationDiff = { ops: [{ op: "dropSession", day: "mer", reason: "riposo" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.sessions).toHaveLength(2);
    expect(r.sessions.map(s => s.day)).toEqual(["lun", "ven"]);
  });

  it("rifiuta drop oltre il limite (max 40% = 1 su 3)", () => {
    const diff: AdaptationDiff = {
      ops: [
        { op: "dropSession", day: "lun", reason: "x" },
        { op: "dropSession", day: "mer", reason: "x" },
      ],
      summary: "",
    };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.applied).toHaveLength(1);   // solo il primo
    expect(r.rejected).toHaveLength(1);  // il secondo oltre limite
    expect(r.sessions).toHaveLength(2);
  });

  it("nessuna op cambia il TIPO delle sessioni (scheletro macro intatto)", () => {
    const diff: AdaptationDiff = {
      ops: [
        { op: "move", day: "ven", toDay: "sab", reason: "x" },
        { op: "scaleVolume", day: "lun", factor: 0.8, reason: "x" },
        { op: "scaleIntensity", day: "mer", deltaZone: -1, reason: "x" },
      ],
      summary: "",
    };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    const types = r.sessions.map(s => s.type).sort();
    expect(types).toEqual(["corsa", "forza_gambe", "forza_gambe"]);
  });

  it("output ordinato per giorno della settimana", () => {
    const diff: AdaptationDiff = { ops: [{ op: "move", day: "lun", toDay: "dom", reason: "x" }], summary: "" };
    const r = applyAdaptationDiff(week(), diff, baseCtx);
    expect(r.sessions.map(s => s.day)).toEqual(["mer", "ven", "dom"]);
  });

  it("diff vuoto = settimana invariata", () => {
    const r = applyAdaptationDiff(week(), { ops: [], summary: "" }, baseCtx);
    expect(r.applied).toHaveLength(0);
    expect(r.sessions).toHaveLength(3);
  });
});
