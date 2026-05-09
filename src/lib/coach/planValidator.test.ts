import { describe, it, expect } from "vitest";
import { planStateHash } from "./planValidator";
import type { UserProfile, UserGoal, OneRepMax, RaceEvent } from "../types";

const baseProfile: UserProfile = {
  age: 30,
  sex: "m",
  weight_kg: 75,
  height_cm: 180,
  experience: "regular",
  injuries: [],
  meds: "",
  weekly_availability: { days: 4, hoursPerSession: 1 },
  equipment: ["manubri"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("planStateHash", () => {
  it("returns stable hash for same input", () => {
    const h1 = planStateHash(baseProfile, []);
    const h2 = planStateHash(baseProfile, []);
    expect(h1).toBe(h2);
  });

  it("changes when injuries change", () => {
    const h1 = planStateHash(baseProfile, []);
    const h2 = planStateHash({ ...baseProfile, injuries: ["polpaccio"] }, []);
    expect(h1).not.toBe(h2);
  });

  it("changes when availableDays change", () => {
    const h1 = planStateHash(baseProfile, []);
    const h2 = planStateHash({ ...baseProfile, availableDays: ["lun", "mer", "ven"] }, []);
    expect(h1).not.toBe(h2);
  });

  it("is order-insensitive on injuries (sorted internally)", () => {
    const h1 = planStateHash({ ...baseProfile, injuries: ["a", "b", "c"] }, []);
    const h2 = planStateHash({ ...baseProfile, injuries: ["c", "a", "b"] }, []);
    expect(h1).toBe(h2);
  });

  it("changes when intensityPreference changes", () => {
    const h1 = planStateHash(baseProfile, []);
    const h2 = planStateHash({ ...baseProfile, intensityPreference: "intense" }, []);
    expect(h1).not.toBe(h2);
  });

  it("ignores archived goals", () => {
    const goalActive: UserGoal = {
      id: "1", originalDescription: "x", smartDescription: "y",
      kpi: { metric: "km", target: "10", deadline: "2026-12-31" },
      realistic: true, coachReasoning: "ok", status: "active",
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    };
    const goalArchived: UserGoal = { ...goalActive, id: "2", status: "archived" };
    const h1 = planStateHash(baseProfile, [goalActive]);
    const h2 = planStateHash(baseProfile, [goalActive, goalArchived]);
    expect(h1).toBe(h2);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // v2 (Wave 2.1) — drift detection sui nuovi campi.
  describe("v2 fields", () => {
    const orm1: OneRepMax = {
      exerciseId: "back-squat-barbell",
      value_kg: 100,
      source: "tested",
      acquiredAt: "2026-04-01",
    };
    const race1: RaceEvent = {
      id: "r1",
      name: "Maratona",
      sport: "corsa",
      date: "2026-09-15",
      priority: "A",
      createdAt: "2026-05-09T10:00:00Z",
    };

    it("changes when oneRepMaxes change", () => {
      const h1 = planStateHash(baseProfile, []);
      const h2 = planStateHash({ ...baseProfile, oneRepMaxes: [orm1] }, []);
      expect(h1).not.toBe(h2);
    });

    it("changes when 1RM value changes", () => {
      const h1 = planStateHash({ ...baseProfile, oneRepMaxes: [orm1] }, []);
      const h2 = planStateHash(
        { ...baseProfile, oneRepMaxes: [{ ...orm1, value_kg: 110 }] },
        [],
      );
      expect(h1).not.toBe(h2);
    });

    it("is order-insensitive on oneRepMaxes (sorted internally by id)", () => {
      const orm2: OneRepMax = { ...orm1, exerciseId: "bench-press-barbell" };
      const h1 = planStateHash({ ...baseProfile, oneRepMaxes: [orm1, orm2] }, []);
      const h2 = planStateHash({ ...baseProfile, oneRepMaxes: [orm2, orm1] }, []);
      expect(h1).toBe(h2);
    });

    it("changes when races change", () => {
      const h1 = planStateHash(baseProfile, []);
      const h2 = planStateHash({ ...baseProfile, races: [race1] }, []);
      expect(h1).not.toBe(h2);
    });

    it("changes when race date changes", () => {
      const h1 = planStateHash({ ...baseProfile, races: [race1] }, []);
      const h2 = planStateHash(
        { ...baseProfile, races: [{ ...race1, date: "2026-10-15" }] },
        [],
      );
      expect(h1).not.toBe(h2);
    });

    it("is order-insensitive on races (sorted by date+id)", () => {
      const race2: RaceEvent = { ...race1, id: "r2", date: "2026-07-15" };
      const h1 = planStateHash({ ...baseProfile, races: [race1, race2] }, []);
      const h2 = planStateHash({ ...baseProfile, races: [race2, race1] }, []);
      expect(h1).toBe(h2);
    });

    it("changes when activeMacroCycleId changes", () => {
      const h1 = planStateHash({ ...baseProfile, activeMacroCycleId: "mc-1" }, []);
      const h2 = planStateHash({ ...baseProfile, activeMacroCycleId: "mc-2" }, []);
      expect(h1).not.toBe(h2);
    });

    it("changes when experienceByDiscipline changes", () => {
      const h1 = planStateHash(baseProfile, []);
      const h2 = planStateHash(
        { ...baseProfile, experienceByDiscipline: { forza: "regular" } },
        [],
      );
      expect(h1).not.toBe(h2);
    });

    it("does NOT change when wearableConnected/wearableLastSync changes (excluded by design)", () => {
      const h1 = planStateHash(baseProfile, []);
      const h2 = planStateHash(
        { ...baseProfile, wearableConnected: true, wearableLastSync: "2026-05-09T08:00:00Z" },
        [],
      );
      expect(h1).toBe(h2);
    });
  });
});
