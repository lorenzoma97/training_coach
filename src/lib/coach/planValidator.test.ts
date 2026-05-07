import { describe, it, expect } from "vitest";
import { planStateHash } from "./planValidator";
import type { UserProfile, UserGoal } from "../types";

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
});
