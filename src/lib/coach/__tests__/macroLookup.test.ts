// Wave 3.3 — Test per loadActiveMacroContext.
//
// Coverage:
//  - profile null → null
//  - profile senza activeMacroCycleId → null
//  - profile con id ma macro non in storage → null
//  - profile + macro in storage ma race non in user-races → null
//  - profile + macro + race tutti presenti → ritorna context corretto
//  - currentMacroContext ritorna null (oggi fuori range) → null
//
// Mock storage: useremo lo stesso pattern di oneRepMaxEstimator.test.ts
// (MemoryStorage stub installato come globalThis.localStorage).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadActiveMacroContext } from "../macroLookup";
import type { MacroCycle, RaceEvent, UserProfile } from "../../types";

// Stub localStorage globale (vitest gira in Node senza jsdom).
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  get length(): number { return this.map.size; }
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = new MemoryStorage();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).localStorage;
});

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    age: 28,
    sex: "m",
    weight_kg: 81,
    height_cm: 180,
    experience: "regular",
    injuries: [],
    meds: "",
    weekly_availability: { days: 4, hoursPerSession: 1 },
    equipment: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRace(overrides: Partial<RaceEvent> = {}): RaceEvent {
  return {
    id: "r-bologna-2026",
    name: "Maratona di Bologna 2026",
    sport: "corsa",
    date: "2026-09-15",
    priority: "A",
    createdAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeMacro(overrides: Partial<MacroCycle> = {}): MacroCycle {
  // 12 settimane standard: 4 base / 4 build / 2 peak / 2 taper.
  // startDate 2026-06-22 (lun), endDate 2026-09-15 (race).
  const phases = Array.from({ length: 12 }, (_, i) => {
    const w = i + 1;
    let phase: "base" | "build" | "peak" | "taper";
    let volMul: number;
    let intHigh: number;
    if (w <= 4) { phase = "base"; volMul = 1.0; intHigh = 12; }
    else if (w <= 8) { phase = "build"; volMul = 1.2; intHigh = 22; }
    else if (w <= 10) { phase = "peak"; volMul = 0.9; intHigh = 32; }
    else { phase = "taper"; volMul = w === 11 ? 0.7 : 0.5; intHigh = 20; }
    return { weekNumber: w, phase, volumeMultiplier: volMul, intensityHighPct: intHigh, focus: phase };
  });
  return {
    id: "mc-bologna-2026",
    raceId: "r-bologna-2026",
    startDate: "2026-06-22",
    endDate: "2026-09-15",
    phases,
    inputHash: "abc123",
    ...overrides,
  };
}

describe("loadActiveMacroContext — early returns", () => {
  it("ritorna null se profile è null", async () => {
    const r = await loadActiveMacroContext(null);
    expect(r).toBeNull();
  });

  it("ritorna null se profile senza activeMacroCycleId", async () => {
    const r = await loadActiveMacroContext(makeProfile());
    expect(r).toBeNull();
  });

  it("ritorna null se profile.activeMacroCycleId punta a macro inesistente", async () => {
    const profile = makeProfile({ activeMacroCycleId: "mc-ghost" });
    const r = await loadActiveMacroContext(profile);
    expect(r).toBeNull();
  });
});

describe("loadActiveMacroContext — happy path", () => {
  it("carica macro + race + ritorna context corretto", async () => {
    const macro = makeMacro();
    const race = makeRace();
    localStorage.setItem(`macro-cycle:${macro.id}`, JSON.stringify(macro));
    localStorage.setItem("user-races", JSON.stringify([race]));

    const profile = makeProfile({ activeMacroCycleId: macro.id });
    // Today: 2026-07-13 (lun) → settimana 4 del macro (base, ultima sett base).
    const today = new Date(Date.UTC(2026, 6, 13));
    const r = await loadActiveMacroContext(profile, today);

    expect(r).not.toBeNull();
    expect(r!.macroContext.weekNumber).toBe(4);
    expect(r!.macroContext.phase).toBe("base");
    expect(r!.macroContext.totalWeeks).toBe(12);
    expect(r!.macroContext.volumeMultiplier).toBe(1.0);
    expect(r!.macroContext.intensityHighPct).toBe(12);
    expect(r!.macroContext.race.name).toBe("Maratona di Bologna 2026");
    expect(r!.macroContext.race.sport).toBe("corsa");
    // weeksToRace: dal 2026-07-13 al 2026-09-15 = 64 giorni → 9 settimane (ceil).
    expect(r!.macroContext.weeksToRace).toBeGreaterThanOrEqual(9);
    expect(r!.macroContext.weeksToRace).toBeLessThanOrEqual(10);
  });

  it("ritorna null se macro presente ma race orfana (non in user-races)", async () => {
    const macro = makeMacro();
    localStorage.setItem(`macro-cycle:${macro.id}`, JSON.stringify(macro));
    // user-races vuoto: race orfana.
    localStorage.setItem("user-races", JSON.stringify([]));

    const profile = makeProfile({ activeMacroCycleId: macro.id });
    const today = new Date(Date.UTC(2026, 6, 13));
    const r = await loadActiveMacroContext(profile, today);
    expect(r).toBeNull();
  });

  it("ritorna null se today è dopo la race (macro chiuso)", async () => {
    const macro = makeMacro();
    const race = makeRace();
    localStorage.setItem(`macro-cycle:${macro.id}`, JSON.stringify(macro));
    localStorage.setItem("user-races", JSON.stringify([race]));

    const profile = makeProfile({ activeMacroCycleId: macro.id });
    // Today: 2026-09-30 → race era il 2026-09-15.
    const today = new Date(Date.UTC(2026, 8, 30));
    const r = await loadActiveMacroContext(profile, today);
    expect(r).toBeNull();
  });

  it("identifica correttamente fase taper nelle ultime settimane", async () => {
    const macro = makeMacro();
    const race = makeRace();
    localStorage.setItem(`macro-cycle:${macro.id}`, JSON.stringify(macro));
    localStorage.setItem("user-races", JSON.stringify([race]));

    const profile = makeProfile({ activeMacroCycleId: macro.id });
    // Today: 2026-09-08 (lun, settimana 12 = ultima taper).
    const today = new Date(Date.UTC(2026, 8, 8));
    const r = await loadActiveMacroContext(profile, today);

    expect(r).not.toBeNull();
    expect(r!.macroContext.phase).toBe("taper");
    expect(r!.macroContext.weekNumber).toBeGreaterThanOrEqual(11);
  });
});
