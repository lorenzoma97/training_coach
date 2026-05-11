// Wave 3.3 — Smoke + integration test per RaceCalendarSection.
//
// Pattern test puro Node (no RTL/jsdom — segui pattern del progetto).
// Testiamo:
//  - smoke import del componente (no crash a load-time)
//  - logica di lifecycle: storage roundtrip, recompute macro, emit eventi
//  - empty state: 0 race in storage → loadRaces ritorna []
//  - 1 race priority A futura → recomputeActiveMacro produce un MacroCycle
//  - rimozione race A attiva → macro cleared (activeMacroCycleId = null)
//  - banner condition: profile.activeMacroCycleId + macro presente in storage
//
// Per i flussi UI interattivi (click rimuovi → confirm dialog → rimozione)
// testiamo la business logic sottostante (loadRaces / saveRaces /
// recomputeActiveMacro). Smoke + handler logic, NO render React DOM.

import { describe, it, expect, beforeEach, vi } from "vitest";
import RaceCalendarSection from "../RaceCalendarSection";
import { recomputeActiveMacro } from "../../../lib/coach/macroLifecycle";
import { loadActiveMacroContext } from "../../../lib/coach/macroLookup";
import { events } from "../../../lib/events";
import type { RaceEvent, UserProfile, MacroCycle } from "../../../lib/types";

// ─── localStorage mock (shared con altri test) ──────────────────────────────
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new LocalStorageMock(),
    configurable: true,
    writable: true,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Helper: race A futura a 12 settimane (date dinamica così il test resta
// stabile nel tempo: il macroPlanner richiede race tra 14gg e 24 settimane).
function futureRaceA(name: string, daysFromNow = 84): RaceEvent {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return {
    id: `race-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    sport: "corsa",
    date: d.toISOString().slice(0, 10),
    distance_km: 21.097,
    targetTime: "1:45:00",
    targetTimeSec: 6300,
    priority: "A",
    notes: "test race",
    createdAt: new Date().toISOString(),
  };
}

function minimalProfile(): UserProfile {
  return {
    age: 28,
    sex: "m",
    weight_kg: 81,
    height_cm: 178,
    experience: "regular",
    injuries: [],
    meds: "",
    weekly_availability: { days: 4, hoursPerSession: 1 },
    equipment: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Smoke ──────────────────────────────────────────────────────────────────
describe("RaceCalendarSection (smoke)", () => {
  it("imports without throwing", () => {
    expect(RaceCalendarSection).toBeDefined();
    expect(typeof RaceCalendarSection).toBe("function");
  });
});

// ─── Storage / lifecycle integration ────────────────────────────────────────
describe("RaceCalendarSection ↔ macroLifecycle (storage roundtrip)", () => {
  it("empty state: nessuna race in user-races né in profile.races → loader ritorna []", async () => {
    // loadRacesWithFallback è inline al componente, ma testiamo il backing
    // storage end-to-end via macroLifecycle (che condivide la convention
    // user-races autoritativa + fallback profile.races).
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    // Nessuna user-races key → recompute non genera macro.
    const macro = await recomputeActiveMacro();
    expect(macro).toBeNull();
    // Profile activeMacroCycleId resta undefined.
    const updated = JSON.parse(localStorage.getItem("user-profile")!) as UserProfile;
    expect(updated.activeMacroCycleId).toBeUndefined();
  });

  it("1 race priority A futura → recompute produce un MacroCycle persistito", async () => {
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    const race = futureRaceA("Mezza di Bologna", 84);
    localStorage.setItem("user-races", JSON.stringify([race]));

    const macro = await recomputeActiveMacro();
    expect(macro).not.toBeNull();
    expect(macro!.raceId).toBe(race.id);
    expect(macro!.endDate).toBe(race.date);
    expect(macro!.phases.length).toBeGreaterThan(0);

    // Verifica persistenza
    const stored = localStorage.getItem(`macro-cycle:${macro!.id}`);
    expect(stored).not.toBeNull();
    const parsedMacro = JSON.parse(stored!) as MacroCycle;
    expect(parsedMacro.id).toBe(macro!.id);

    // Profile aggiornato con activeMacroCycleId
    const updatedProfile = JSON.parse(localStorage.getItem("user-profile")!) as UserProfile;
    expect(updatedProfile.activeMacroCycleId).toBe(macro!.id);
  });

  it("loadActiveMacroContext ritorna context valido se profile + macro + race presenti", async () => {
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    const race = futureRaceA("Maratona Test", 120);
    localStorage.setItem("user-races", JSON.stringify([race]));
    const macro = await recomputeActiveMacro();
    expect(macro).not.toBeNull();

    const updatedProfile = JSON.parse(localStorage.getItem("user-profile")!) as UserProfile;
    const ctx = await loadActiveMacroContext(updatedProfile);
    expect(ctx).not.toBeNull();
    expect(ctx!.race.id).toBe(race.id);
    expect(ctx!.macroContext.race.name).toBe(race.name);
    expect(ctx!.macroContext.weekNumber).toBeGreaterThanOrEqual(1);
    expect(ctx!.macroContext.totalWeeks).toBeGreaterThanOrEqual(1);
    expect(typeof ctx!.macroContext.volumeMultiplier).toBe("number");
    expect(typeof ctx!.macroContext.intensityHighPct).toBe("number");
  });

  it("rimozione race A → recompute clear activeMacroCycleId + macro orfano cancellato", async () => {
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    const race = futureRaceA("Race da rimuovere", 90);
    localStorage.setItem("user-races", JSON.stringify([race]));
    const macroCreated = await recomputeActiveMacro();
    expect(macroCreated).not.toBeNull();
    const macroKey = `macro-cycle:${macroCreated!.id}`;
    expect(localStorage.getItem(macroKey)).not.toBeNull();

    // Simula la rimozione: salviamo lista vuota e ri-recomputiamo.
    localStorage.setItem("user-races", JSON.stringify([]));
    const macroAfter = await recomputeActiveMacro();
    expect(macroAfter).toBeNull();

    // Profile deve avere activeMacroCycleId = undefined
    const updatedProfile = JSON.parse(localStorage.getItem("user-profile")!) as UserProfile;
    expect(updatedProfile.activeMacroCycleId).toBeUndefined();

    // Macro orfano deve essere stato rimosso dal pruning
    expect(localStorage.getItem(macroKey)).toBeNull();
  });

  it("race priority B (no A) → recompute non genera macro (Q3: macro è opt-in via priority A)", async () => {
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    const race: RaceEvent = { ...futureRaceA("Race B", 90), priority: "B" };
    localStorage.setItem("user-races", JSON.stringify([race]));

    const macro = await recomputeActiveMacro();
    expect(macro).toBeNull();
    const updated = JSON.parse(localStorage.getItem("user-profile")!) as UserProfile;
    expect(updated.activeMacroCycleId).toBeUndefined();
  });

  it("race A troppo vicina (<14gg) → no macro generato (mini-taper threshold)", async () => {
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    const race = futureRaceA("Race troppo vicina", 7);
    localStorage.setItem("user-races", JSON.stringify([race]));

    const macro = await recomputeActiveMacro();
    expect(macro).toBeNull();
  });
});

// ─── Eventi ──────────────────────────────────────────────────────────────────
describe("RaceCalendarSection ↔ events bus", () => {
  it("recompute con cambio macro emette `macro:updated` con activeMacroCycleId", async () => {
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    const race = futureRaceA("Race evt", 84);
    localStorage.setItem("user-races", JSON.stringify([race]));

    const captured: Array<{ activeMacroCycleId: string | null }> = [];
    const off = events.on("macro:updated", (p) => { captured.push({ activeMacroCycleId: p.activeMacroCycleId }); });
    try {
      const macro = await recomputeActiveMacro();
      expect(macro).not.toBeNull();
      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured[captured.length - 1].activeMacroCycleId).toBe(macro!.id);
    } finally {
      off();
    }
  });

  it("recompute clear (no race A) emette `macro:updated` con activeMacroCycleId=null", async () => {
    const profile = minimalProfile();
    localStorage.setItem("user-profile", JSON.stringify(profile));
    localStorage.setItem("user-races", JSON.stringify([]));

    const captured: Array<{ activeMacroCycleId: string | null }> = [];
    const off = events.on("macro:updated", (p) => { captured.push({ activeMacroCycleId: p.activeMacroCycleId }); });
    try {
      const macro = await recomputeActiveMacro();
      expect(macro).toBeNull();
      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured[captured.length - 1].activeMacroCycleId).toBeNull();
    } finally {
      off();
    }
  });
});
