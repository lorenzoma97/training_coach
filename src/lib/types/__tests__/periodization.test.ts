import { describe, it, expect } from "vitest";
import {
  RaceEventSchema,
  MesoCycleSchema,
  MacroCycleSchema,
} from "../../schemas/periodization";

describe("RaceEventSchema", () => {
  it("accepts a marathon race", () => {
    const r = {
      id: "r-bologna-2026",
      name: "Maratona di Bologna 2026",
      sport: "corsa" as const,
      date: "2026-09-15",
      distance_km: 42.195,
      targetTime: "3:30:00",
      targetTimeSec: 12600,
      priority: "A" as const,
      createdAt: "2026-05-09T10:00:00Z",
    };
    expect(RaceEventSchema.safeParse(r).success).toBe(true);
  });

  it("accepts a soccer match without distance", () => {
    const r = {
      id: "r-torneo-1",
      name: "Torneo aziendale",
      sport: "sport" as const,
      date: "2026-06-15",
      priority: "C" as const,
      createdAt: "2026-05-09T10:00:00Z",
    };
    expect(RaceEventSchema.safeParse(r).success).toBe(true);
  });

  it("rejects YYYY/MM/DD date format", () => {
    const r = {
      id: "x",
      name: "X",
      sport: "corsa" as const,
      date: "2026/09/15",
      priority: "A" as const,
      createdAt: "2026-05-09T10:00:00Z",
    };
    expect(RaceEventSchema.safeParse(r).success).toBe(false);
  });

  it("rejects unknown sport", () => {
    const r = {
      id: "x",
      name: "X",
      sport: "nuoto",
      date: "2026-09-15",
      priority: "A",
      createdAt: "2026-05-09T10:00:00Z",
    };
    expect(RaceEventSchema.safeParse(r).success).toBe(false);
  });

  it("rejects priority outside A/B/C", () => {
    const r = {
      id: "x",
      name: "X",
      sport: "corsa" as const,
      date: "2026-09-15",
      priority: "D",
      createdAt: "2026-05-09T10:00:00Z",
    };
    expect(RaceEventSchema.safeParse(r).success).toBe(false);
  });
});

describe("MesoCycleSchema", () => {
  it("accepts a base phase with 1.0 volume multiplier", () => {
    const m = {
      weekNumber: 1,
      phase: "base" as const,
      volumeMultiplier: 1.0,
      intensityHighPct: 15,
      focus: "base aerobica",
    };
    expect(MesoCycleSchema.safeParse(m).success).toBe(true);
  });

  it("rejects volumeMultiplier outside [0.3, 1.5]", () => {
    const m = {
      weekNumber: 1,
      phase: "peak" as const,
      volumeMultiplier: 2.0,
      intensityHighPct: 40,
      focus: "race pace",
    };
    expect(MesoCycleSchema.safeParse(m).success).toBe(false);
  });

  it("rejects intensityHighPct > 100", () => {
    const m = {
      weekNumber: 1,
      phase: "build" as const,
      volumeMultiplier: 1.1,
      intensityHighPct: 120,
      focus: "soglia",
    };
    expect(MesoCycleSchema.safeParse(m).success).toBe(false);
  });
});

describe("MacroCycleSchema", () => {
  it("accepts a complete 12-week cycle", () => {
    const phases = Array.from({ length: 12 }, (_, i) => ({
      weekNumber: i + 1,
      phase: (i < 6 ? "base" : i < 10 ? "build" : i < 11 ? "peak" : "taper") as
        | "base"
        | "build"
        | "peak"
        | "taper",
      volumeMultiplier: 1.0,
      intensityHighPct: 20,
      focus: "f",
    }));
    const mc = {
      id: "mc-1",
      raceId: "r-bologna-2026",
      startDate: "2026-06-22",
      endDate: "2026-09-15",
      phases,
      inputHash: "abc123",
    };
    expect(MacroCycleSchema.safeParse(mc).success).toBe(true);
  });

  it("rejects empty phases", () => {
    const mc = {
      id: "mc-1",
      raceId: "r-1",
      startDate: "2026-06-22",
      endDate: "2026-09-15",
      phases: [],
      inputHash: "x",
    };
    expect(MacroCycleSchema.safeParse(mc).success).toBe(false);
  });
});
