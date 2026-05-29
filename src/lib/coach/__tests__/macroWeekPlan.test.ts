// Golden test orchestratore macroWeekPlan + adattamento readiness (Sprint A).

import { describe, it, expect, beforeEach } from "vitest";
import { tryProjectMacroPlan } from "../macroWeekPlan";
import type { UserProfile } from "../../types";

const profile: UserProfile = {
  age: 28, sex: "m", weight_kg: 82, height_cm: 178,
  experience: "regular", injuries: [], meds: "",
  weekly_availability: { days: 5, hoursPerSession: 1.5 },
  equipment: ["barbell", "kettlebell", "dumbbell"],
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z",
};

function setupMacro(startDate: string) {
  const macro = {
    metadata: { title: "Test Macro", goal: "g", sport: "calcio", weeks_total: 5, start_date: startDate },
    phases: [{ name: "Attivazione", weeks: [1, 2], focus: "base" }],
    weeks: [{
      week: 1, notes: "",
      sessions: [
        {
          day: "lun", type: "forza_gambe", duration_min: 60, exercises: [
            { id: "back-squat-barbell", sets: 4, reps_min: 6, reps_max: 6, rpe_target: 8, rest_sec: 150 },
            { id: "plank-front-bodyweight", sets: 2, reps_min: 30, reps_max: 30, rest_sec: 60 },
          ], intervals: [],
        },
        {
          day: "mer", type: "corsa", duration_min: 45, exercises: [], intervals: [
            { kind: "warmup", duration_min: 10, zone: 2 },
            { kind: "main", reps: 4, duration_min: 4, zone: 4, recovery_sec: 180 },
            { kind: "cooldown", duration_min: 5, zone: 1 },
          ],
        },
      ],
    }],
    narrative_markdown: "", imported_at: "2026-05-26T00:00:00Z",
  };
  localStorage.setItem("user-macroprogram", JSON.stringify(macro));
}

function setReadiness(band: "low" | "moderate" | "high") {
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem("readiness-history", JSON.stringify([
    { date: today, score: band === "low" ? 30 : band === "moderate" ? 60 : 85, band, inputs: {} },
  ]));
}

beforeEach(() => {
  localStorage.clear();
});

describe("tryProjectMacroPlan", () => {
  it("ritorna null se nessun macro attivo", async () => {
    const r = await tryProjectMacroPlan(profile);
    expect(r).toBeNull();
  });

  it("proietta la settimana corrente se macro attivo (readiness moderate → no adattamenti)", async () => {
    setupMacro(new Date().toISOString().slice(0, 10)); // start oggi → week 1
    setReadiness("moderate");
    const r = await tryProjectMacroPlan(profile);
    expect(r).not.toBeNull();
    expect(r!.sourceMacro?.weekNumber).toBe(1);
    expect(r!.sourceMacro?.adaptations).toEqual([]);
    // intensità invariata
    const corsa = r!.weeks[0].sessions.find(s => s.type === "corsa")!;
    expect(corsa.intervals!.find(iv => iv.kind === "main")!.zone).toBe(4);
    const forza = r!.weeks[0].sessions.find(s => s.type === "forza_gambe")!;
    expect(forza.exercises![0].plannedSets).toBe(4);
  });

  it("readiness BASSA → adattamento deterministico: Z4→Z3 + sets -1", async () => {
    setupMacro(new Date().toISOString().slice(0, 10));
    setReadiness("low");
    const r = await tryProjectMacroPlan(profile);
    expect(r).not.toBeNull();
    expect(r!.sourceMacro!.adaptations.length).toBeGreaterThan(0);

    // Cardio: zona main 4 → 3
    const corsa = r!.weeks[0].sessions.find(s => s.type === "corsa")!;
    expect(corsa.intervals!.find(iv => iv.kind === "main")!.zone).toBe(3);
    expect(corsa.readinessAdjusted).toBe(true);

    // Forza: back-squat 4 sets → 3; plank 2 sets resta 2 (min)
    const forza = r!.weeks[0].sessions.find(s => s.type === "forza_gambe")!;
    expect(forza.exercises![0].plannedSets).toBe(3); // 4-1
    expect(forza.exercises![1].plannedSets).toBe(2); // 2 resta 2 (min)
    expect(forza.readinessAdjusted).toBe(true);

    // adaptations loggati
    expect(r!.sourceMacro!.adaptations.some(a => a.includes("Z4/Z5 → Z3"))).toBe(true);
    expect(r!.sourceMacro!.adaptations.some(a => a.includes("sets ridotti"))).toBe(true);
  });

  it("ritorna null se programma concluso", async () => {
    const past = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    setupMacro(past);
    setReadiness("moderate");
    const r = await tryProjectMacroPlan(profile);
    expect(r).toBeNull();
  });
});
