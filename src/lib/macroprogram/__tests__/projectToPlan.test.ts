// Golden test proiezione deterministica macro→piano (Sprint A, 2026-05-27).

import { describe, it, expect } from "vitest";
import { projectMacroWeekToPlan, projectCurrentMacroWeek } from "../projectToPlan";
import type { MacroProgram } from "../../types/macroprogram";
import type { UserProfile } from "../../types";

const profile: UserProfile = {
  age: 28, sex: "m", weight_kg: 82, height_cm: 178,
  experience: "regular", injuries: [], meds: "",
  weekly_availability: { days: 5, hoursPerSession: 1.5 },
  equipment: ["barbell", "dumbbell", "kettlebell"],
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z",
};

function makeProgram(startDate: string | undefined): MacroProgram {
  return {
    metadata: { title: "Test Calcio", goal: "performance", sport: "calcio", weeks_total: 5, start_date: startDate },
    phases: [
      { name: "Attivazione", weeks: [1, 2], focus: "base" },
      { name: "Condizionamento", weeks: [3, 4], focus: "rsa" },
      { name: "Re-performance", weeks: [5], focus: "picco" },
    ],
    weeks: [
      {
        week: 1, notes: "Adattamento",
        sessions: [
          {
            day: "mer", type: "corsa", duration_min: 60, notes_text: "HIIT",
            exercises: [],
            intervals: [
              { kind: "warmup", duration_min: 12, zone: 2 },
              { kind: "main", reps: 3, duration_min: 4, zone: 4, recovery_sec: 180 },
              { kind: "cooldown", duration_min: 5, zone: 1 },
            ],
          },
          {
            day: "lun", type: "forza_gambe", duration_min: 73, notes_text: "Tecnica palla in coda",
            setup_spatial: "Palestra",
            exercises: [
              { id: "goblet-squat-kettlebell", name: "Goblet Squat", sets: 3, reps_min: 10, reps_max: 10, rpe_target: 6, rest_sec: 90, tempo_eccentrico_sec: 3 },
              { id: "deadlift-romanian-dumbbell", name: "RDL", sets: 3, reps_min: 8, reps_max: 8, rpe_target: 7, rest_sec: 90 },
            ],
            intervals: [],
          },
        ],
      },
      {
        week: 3, notes: "",
        sessions: [
          { day: "lun", type: "forza_gambe", duration_min: 60, exercises: [{ id: "back-squat-barbell", sets: 4, reps_min: 6, reps_max: 6, rpe_target: 8, rest_sec: 150 }], intervals: [] },
        ],
      },
    ],
    narrative_markdown: "",
    imported_at: "2026-05-26T00:00:00Z",
  };
}

describe("projectMacroWeekToPlan — proiezione deterministica", () => {
  it("proietta la settimana 1 in TrainingPlan fedele", () => {
    const r = projectMacroWeekToPlan(makeProgram("2026-05-26"), 1, profile);
    expect(r).not.toBeNull();
    expect(r!.plan.sourceMacro?.weekNumber).toBe(1);
    expect(r!.plan.sourceMacro?.phaseName).toBe("Attivazione");
    expect(r!.plan.sourceMacro?.adaptations).toEqual([]); // proiezione pura
    expect(r!.plan.weeks).toHaveLength(1);
  });

  it("ordina le sessioni per giorno (lun prima di mer)", () => {
    const r = projectMacroWeekToPlan(makeProgram("2026-05-26"), 1, profile);
    const days = r!.plan.weeks[0].sessions.map(s => s.day);
    expect(days).toEqual(["lun", "mer"]);
  });

  it("mappa esercizi fedelmente (id, sets, reps, rest, rpe)", () => {
    const r = projectMacroWeekToPlan(makeProgram("2026-05-26"), 1, profile);
    const forza = r!.plan.weeks[0].sessions.find(s => s.type === "forza_gambe")!;
    expect(forza.exercises).toHaveLength(2);
    const goblet = forza.exercises![0];
    expect(goblet.exerciseId).toBe("goblet-squat-kettlebell");
    expect(goblet.plannedSets).toBe(3);
    expect(goblet.repsTarget).toEqual({ min: 10, max: 10 });
    expect(goblet.rpe_target).toBe(6);
    expect(goblet.rest_sec).toBe(90);
    // tempo eccentrico accodato al cue
    expect(goblet.cue).toContain("3s discesa");
  });

  it("mappa intervalli cardio fedelmente", () => {
    const r = projectMacroWeekToPlan(makeProgram("2026-05-26"), 1, profile);
    const corsa = r!.plan.weeks[0].sessions.find(s => s.type === "corsa")!;
    expect(corsa.intervals).toHaveLength(3);
    expect(corsa.intervals![1]).toMatchObject({ kind: "main", reps: 3, duration_min: 4, zone: 4, recovery_sec: 180 });
    // zona sintesi derivata dal main
    expect(corsa.zone).toBe(4);
  });

  it("combina notes_text + setup_spatial in details", () => {
    const r = projectMacroWeekToPlan(makeProgram("2026-05-26"), 1, profile);
    const forza = r!.plan.weeks[0].sessions.find(s => s.type === "forza_gambe")!;
    expect(forza.details).toContain("Tecnica palla in coda");
    expect(forza.details).toContain("Setup: Palestra");
  });

  it("calcola startDate della settimana N da metadata.start_date", () => {
    // week 3 → start_date + 2 settimane = 2026-05-26 + 14gg = 2026-06-09
    const r = projectMacroWeekToPlan(makeProgram("2026-05-26"), 3, profile);
    expect(r!.plan.startDate).toBe("2026-06-09");
  });

  it("ritorna null se la settimana non esiste nel macro", () => {
    const r = projectMacroWeekToPlan(makeProgram("2026-05-26"), 2, profile);
    expect(r).toBeNull(); // week 2 non ha entry in weeks[]
  });

  it("funziona senza start_date (usa oggi come fallback)", () => {
    const r = projectMacroWeekToPlan(makeProgram(undefined), 1, profile);
    expect(r).not.toBeNull();
    expect(r!.plan.startDate).toBeTruthy();
  });
});

describe("projectCurrentMacroWeek — settimana corrente", () => {
  it("proietta la settimana corrente in base a start_date oggi → week 1", () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const r = projectCurrentMacroWeek(makeProgram(todayIso), profile);
    expect(r).not.toBeNull();
    expect(r!.plan.sourceMacro?.weekNumber).toBe(1);
  });

  it("ritorna null se programma non ancora iniziato (start futuro)", () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = projectCurrentMacroWeek(makeProgram(future), profile);
    expect(r).toBeNull();
  });

  it("ritorna null se programma concluso (start molto passato)", () => {
    const past = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = projectCurrentMacroWeek(makeProgram(past), profile);
    expect(r).toBeNull();
  });

  it("ritorna null se settimana corrente non ha entry (es. week 2 oggi)", () => {
    // start_date 7 giorni fa → siamo in week 2, che non esiste nei weeks[]
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = projectCurrentMacroWeek(makeProgram(weekAgo), profile);
    expect(r).toBeNull();
  });
});
