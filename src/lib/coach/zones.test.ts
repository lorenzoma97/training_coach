import { describe, it, expect } from "vitest";
import { computeZonesContext, inferSessionZone, stripInlineHRRange } from "./zones";
import type { UserProfile } from "../types";

const baseProfile: UserProfile = {
  age: 30, sex: "m", weight_kg: 75, height_cm: 180,
  experience: "regular", injuries: [], meds: "",
  weekly_availability: { days: 4, hoursPerSession: 1 },
  equipment: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("computeZonesContext", () => {
  it("computes zones for valid age (Tanaka 30 → 187 bpm)", () => {
    const ctx = computeZonesContext(baseProfile, []);
    expect(ctx!.zones!.fcMax).toBe(187);
    expect(ctx!.zones!.zones.length).toBe(5);
  });
  it("does NOT crash if age is missing (uses safe fallback)", () => {
    const noAge = { ...baseProfile, age: undefined as any };
    const ctx = computeZonesContext(noAge, []);
    expect(ctx!.zones!.fcMax).toBeGreaterThan(150);
    expect(ctx!.zones!.fcMax).toBeLessThan(220);
  });
  it("clamps extreme age (>95) to safe range", () => {
    const old = { ...baseProfile, age: 120 };
    const ctx = computeZonesContext(old, []);
    expect(ctx!.zones!.fcMax).toBeGreaterThan(130);
  });
  it("uses fcMaxTested when present (overrides Tanaka)", () => {
    const tested = { ...baseProfile, fcMaxTested: 195 };
    const ctx = computeZonesContext(tested, []);
    expect(ctx!.zones!.fcMax).toBe(195);
  });
});

describe("inferSessionZone", () => {
  it("Z2 for fondo lento", () => {
    expect(inferSessionZone("corsa", "Fondo Lento", "")).toBe(2);
  });
  it("Z5 for ripetute brevi", () => {
    expect(inferSessionZone("corsa", "Ripetute", "ripetute brevi 400m")).toBe(5);
  });
  it("explicit z3 token wins", () => {
    expect(inferSessionZone("corsa", "", "lavoro in z3")).toBe(3);
  });
  it("returns null for non-cardio", () => {
    expect(inferSessionZone("forza_gambe", "", "")).toBe(null);
    expect(inferSessionZone("mobilita", "", "")).toBe(null);
  });
});

describe("stripInlineHRRange", () => {
  it("removes inline HR range", () => {
    expect(stripInlineHRRange("Corsa Z2 (130-145 bpm) conversazionale")).not.toMatch(/\d+-\d+ bpm/);
  });
  it("keeps text without HR range untouched", () => {
    const s = "Corsa lunga conversazionale";
    expect(stripInlineHRRange(s)).toBe(s);
  });
});
