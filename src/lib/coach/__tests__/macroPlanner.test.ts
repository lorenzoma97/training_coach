// Wave 3.3 — Test suite per macroPlanner deterministico.
//
// Copertura:
//  - computePhaseForWeek (5 test): distribuzione fasi per macro 12/16/4/24
//    settimane + edge case week > totalWeeks.
//  - volumeMultiplierForPhase (3 test): valori per fase + deload week build.
//  - computeMacroLengthWeeks (3 test): cap min/max + race vicina.
//  - buildMacroCycle (4 test): macro 12-sett, race nel passato, race <14gg,
//    determinismo inputHash.
//  - selectActiveRace + currentMacroContext (4 test): selezione race A più
//    vicina, no race A → null, currentMacroContext con date.
//
// Tutti i test sono PURE — no storage, no event spy. Side-effect ops sono
// testati separatamente in macroLifecycle.test.ts (futuro).

import { describe, it, expect } from "vitest";
import {
  computePhaseForWeek,
  volumeMultiplierForPhase,
  intensityHighPctForPhase,
  focusForPhase,
  computeMacroLengthWeeks,
  macroInputHash,
  buildMacroCycle,
  selectActiveRace,
  currentMacroContext,
} from "../macroPlanner";
import type { RaceEvent } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRace(overrides: Partial<RaceEvent> = {}): RaceEvent {
  return {
    id: "r-test-1",
    name: "Race Test",
    sport: "corsa",
    date: "2026-09-15",
    distance_km: 21.0975,
    targetTime: "1:45:00",
    targetTimeSec: 6300,
    priority: "A",
    createdAt: "2026-05-09T10:00:00Z",
    ...overrides,
  };
}

/** Helper: parsa "YYYY-MM-DD" → Date UTC mezzanotte (per test deterministici). */
function d(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

// ─────────────────────────────────────────────────────────────────────────────
// computePhaseForWeek (5 test)
// ─────────────────────────────────────────────────────────────────────────────

describe("computePhaseForWeek", () => {
  it("macro 12 sett: week 1=base, 6=build, 10=peak, 12=taper", () => {
    // Distribuzione attesa per 12 sett: 4 base + 4 build + 2 peak + 2 taper
    // (vedi phaseDistribution in macroPlanner.ts).
    const total = 12;
    expect(computePhaseForWeek(1, total)).toBe("base");
    expect(computePhaseForWeek(4, total)).toBe("base");
    expect(computePhaseForWeek(5, total)).toBe("build");
    expect(computePhaseForWeek(6, total)).toBe("build");
    expect(computePhaseForWeek(8, total)).toBe("build");
    expect(computePhaseForWeek(9, total)).toBe("peak");
    expect(computePhaseForWeek(10, total)).toBe("peak");
    expect(computePhaseForWeek(11, total)).toBe("taper");
    expect(computePhaseForWeek(12, total)).toBe("taper");
  });

  it("macro 16 sett: week 1=base, 8=build, 13=peak, 16=taper", () => {
    // Distribuzione attesa per 16 sett (range 16-19): taper=3, peak=2,
    // remaining=11, build=floor(11*0.45)=4, base=7.
    // Quindi: base 1-7, build 8-11, peak 12-13, taper 14-16.
    const total = 16;
    expect(computePhaseForWeek(1, total)).toBe("base");
    expect(computePhaseForWeek(7, total)).toBe("base");
    expect(computePhaseForWeek(8, total)).toBe("build");
    expect(computePhaseForWeek(11, total)).toBe("build");
    expect(computePhaseForWeek(12, total)).toBe("peak");
    expect(computePhaseForWeek(13, total)).toBe("peak");
    expect(computePhaseForWeek(14, total)).toBe("taper");
    expect(computePhaseForWeek(16, total)).toBe("taper");
  });

  it("macro 4 sett (race vicina): tutto peak/taper, no base/build", () => {
    // Distribuzione attesa per 4 sett (range 4-7): taper=min(3,3)=3, peak=1.
    const total = 4;
    expect(computePhaseForWeek(1, total)).toBe("peak");
    expect(computePhaseForWeek(2, total)).toBe("taper");
    expect(computePhaseForWeek(3, total)).toBe("taper");
    expect(computePhaseForWeek(4, total)).toBe("taper");
    // Verifica: nessuna base/build.
    for (let w = 1; w <= 4; w++) {
      const p = computePhaseForWeek(w, total);
      expect(p === "base" || p === "build").toBe(false);
    }
  });

  it("macro 24 sett (long prep): distribuzione coerente con Bompa Olympic-style", () => {
    // Distribuzione attesa per 24 sett (range 20-24): taper=3, peak=3,
    // remaining=18, build=round(18*0.38)=7, base=11.
    // Quindi: base 1-11, build 12-18, peak 19-21, taper 22-24.
    const total = 24;
    expect(computePhaseForWeek(1, total)).toBe("base");
    expect(computePhaseForWeek(11, total)).toBe("base");
    expect(computePhaseForWeek(12, total)).toBe("build");
    expect(computePhaseForWeek(18, total)).toBe("build");
    expect(computePhaseForWeek(19, total)).toBe("peak");
    expect(computePhaseForWeek(21, total)).toBe("peak");
    expect(computePhaseForWeek(22, total)).toBe("taper");
    expect(computePhaseForWeek(24, total)).toBe("taper");

    // Sanity check: ~50% base, ~30% build (proporzioni Olympic style).
    let baseCount = 0;
    let buildCount = 0;
    for (let w = 1; w <= total; w++) {
      const p = computePhaseForWeek(w, total);
      if (p === "base") baseCount++;
      if (p === "build") buildCount++;
    }
    expect(baseCount / total).toBeGreaterThan(0.4);
    expect(baseCount / total).toBeLessThan(0.55);
    expect(buildCount / total).toBeGreaterThan(0.2);
  });

  it("edge case week > totalWeeks → transition (post-race)", () => {
    expect(computePhaseForWeek(13, 12)).toBe("transition");
    expect(computePhaseForWeek(20, 12)).toBe("transition");
    expect(computePhaseForWeek(100, 24)).toBe("transition");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// volumeMultiplierForPhase (3 test)
// ─────────────────────────────────────────────────────────────────────────────

describe("volumeMultiplierForPhase", () => {
  it("base=1.0, build=1.2, peak=0.9, taper in [0.5, 0.7]", () => {
    expect(volumeMultiplierForPhase("base", 1)).toBe(1.0);
    expect(volumeMultiplierForPhase("build", 1)).toBe(1.2);
    expect(volumeMultiplierForPhase("peak", 1)).toBe(0.9);
    const taper = volumeMultiplierForPhase("taper", 1);
    expect(taper).toBeGreaterThanOrEqual(0.5);
    expect(taper).toBeLessThanOrEqual(0.7);
    // transition (post-race): valore basso recovery
    expect(volumeMultiplierForPhase("transition", 1)).toBeLessThanOrEqual(0.6);
  });

  it("build week 4 (deload ogni 4 settimane) → 0.6 invece di 1.2", () => {
    expect(volumeMultiplierForPhase("build", 4)).toBe(0.6);
    expect(volumeMultiplierForPhase("build", 8)).toBe(0.6);
    expect(volumeMultiplierForPhase("build", 12)).toBe(0.6);
  });

  it("build week 1/2/3 = 1.2 (overload progressivo, no deload)", () => {
    expect(volumeMultiplierForPhase("build", 1)).toBe(1.2);
    expect(volumeMultiplierForPhase("build", 2)).toBe(1.2);
    expect(volumeMultiplierForPhase("build", 3)).toBe(1.2);
    expect(volumeMultiplierForPhase("build", 5)).toBe(1.2);
    expect(volumeMultiplierForPhase("build", 6)).toBe(1.2);
    expect(volumeMultiplierForPhase("build", 7)).toBe(1.2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// intensityHighPctForPhase + focusForPhase (smoke test)
// ─────────────────────────────────────────────────────────────────────────────

describe("intensityHighPctForPhase", () => {
  it("rispetta polarizzazione Seiler (base bassa, peak alta)", () => {
    expect(intensityHighPctForPhase("base")).toBeLessThan(20);
    expect(intensityHighPctForPhase("build")).toBeGreaterThan(15);
    expect(intensityHighPctForPhase("build")).toBeLessThan(30);
    expect(intensityHighPctForPhase("peak")).toBeGreaterThan(25);
    expect(intensityHighPctForPhase("taper")).toBeLessThan(30);
  });
});

describe("focusForPhase", () => {
  it("ritorna stringa non vuota in italiano per ogni combo", () => {
    const phases = ["base", "build", "peak", "taper", "transition"] as const;
    const sports: RaceEvent["sport"][] = ["corsa", "trail", "triathlon", "sport", "altro"];
    for (const phase of phases) {
      for (const sport of sports) {
        const focus = focusForPhase(phase, sport);
        expect(typeof focus).toBe("string");
        expect(focus.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMacroLengthWeeks (3 test)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMacroLengthWeeks", () => {
  it("race tra 12 settimane → 12", () => {
    const today = d("2026-06-22");        // lunedì
    const race = d("2026-09-14");         // lunedì + 12 settimane (84 giorni)
    expect(computeMacroLengthWeeks(today, race)).toBe(12);
  });

  it("race tra 30 settimane → cap a 24", () => {
    const today = d("2026-01-05");
    const race = d("2026-08-03");         // ~30 settimane dopo
    expect(computeMacroLengthWeeks(today, race)).toBe(24);
  });

  it("race tra 2 settimane → 2 (mini-macro solo taper)", () => {
    const today = d("2026-05-11");
    const race = d("2026-05-25");         // +14 giorni = 2 settimane
    expect(computeMacroLengthWeeks(today, race)).toBe(2);
  });

  it("race nel passato → 0", () => {
    const today = d("2026-05-11");
    const race = d("2026-04-01");
    expect(computeMacroLengthWeeks(today, race)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildMacroCycle (4 test)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMacroCycle", () => {
  it("race futura 12 settimane → MacroCycle con 12 phases ordered", () => {
    // 2026-06-22 (lunedì) + 12 sett = 2026-09-14 (lunedì)
    const today = d("2026-06-22");
    const race = makeRace({ date: "2026-09-14" });
    const macro = buildMacroCycle(race, today);
    expect(macro).not.toBeNull();
    expect(macro!.raceId).toBe("r-test-1");
    expect(macro!.startDate).toBe("2026-06-22"); // lunedì oggi
    expect(macro!.endDate).toBe("2026-09-14");
    expect(macro!.phases).toHaveLength(12);
    // Ordine settimane crescente da 1
    expect(macro!.phases[0].weekNumber).toBe(1);
    expect(macro!.phases[11].weekNumber).toBe(12);
    // Prima fase = base, ultima = taper
    expect(macro!.phases[0].phase).toBe("base");
    expect(macro!.phases[11].phase).toBe("taper");
    // Ogni meso ha tutti i campi richiesti
    for (const m of macro!.phases) {
      expect(m.volumeMultiplier).toBeGreaterThanOrEqual(0.3);
      expect(m.volumeMultiplier).toBeLessThanOrEqual(1.5);
      expect(m.intensityHighPct).toBeGreaterThanOrEqual(0);
      expect(m.intensityHighPct).toBeLessThanOrEqual(100);
      expect(typeof m.focus).toBe("string");
      expect(m.focus.length).toBeGreaterThan(0);
    }
  });

  it("race nel passato → null", () => {
    const today = d("2026-05-11");
    const race = makeRace({ date: "2026-04-01" });
    expect(buildMacroCycle(race, today)).toBeNull();
  });

  it("race tra <14gg → null (mini-macro solo taper non valido)", () => {
    const today = d("2026-05-11");
    const race = makeRace({ date: "2026-05-20" }); // +9 giorni
    expect(buildMacroCycle(race, today)).toBeNull();
  });

  it("inputHash deterministico: stessi input → stesso hash + stesso id", () => {
    const today = d("2026-06-22");
    const race = makeRace({ date: "2026-09-14" });
    const m1 = buildMacroCycle(race, today);
    const m2 = buildMacroCycle(race, today);
    expect(m1).not.toBeNull();
    expect(m2).not.toBeNull();
    expect(m1!.inputHash).toBe(m2!.inputHash);
    expect(m1!.id).toBe(m2!.id);

    // Cambio input → cambio hash.
    const raceDifferent = makeRace({ date: "2026-09-21" });
    const m3 = buildMacroCycle(raceDifferent, today);
    expect(m3).not.toBeNull();
    expect(m3!.inputHash).not.toBe(m1!.inputHash);

    // macroInputHash standalone consistency
    const h1 = macroInputHash(race, "2026-06-22");
    const h2 = macroInputHash(race, "2026-06-22");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectActiveRace (3 test)
// ─────────────────────────────────────────────────────────────────────────────

describe("selectActiveRace", () => {
  it("multiple race A → ritorna la più vicina futura", () => {
    const today = d("2026-05-11");
    const races: RaceEvent[] = [
      makeRace({ id: "r-far", date: "2026-12-01", priority: "A" }),
      makeRace({ id: "r-near", date: "2026-09-15", priority: "A" }),
      makeRace({ id: "r-mid", date: "2026-10-15", priority: "A" }),
    ];
    const sel = selectActiveRace(races, today);
    expect(sel).not.toBeNull();
    expect(sel!.id).toBe("r-near");
  });

  it("no race A (solo B/C) → null", () => {
    const today = d("2026-05-11");
    const races: RaceEvent[] = [
      makeRace({ id: "r-b", date: "2026-09-15", priority: "B" }),
      makeRace({ id: "r-c", date: "2026-10-15", priority: "C" }),
    ];
    expect(selectActiveRace(races, today)).toBeNull();
  });

  it("race A nel passato escluse, restano solo future", () => {
    const today = d("2026-05-11");
    const races: RaceEvent[] = [
      makeRace({ id: "r-old", date: "2026-04-01", priority: "A" }),  // passata
      makeRace({ id: "r-fut", date: "2026-09-15", priority: "A" }),
    ];
    const sel = selectActiveRace(races, today);
    expect(sel).not.toBeNull();
    expect(sel!.id).toBe("r-fut");
  });

  it("array vuoto / null → null", () => {
    expect(selectActiveRace([], d("2026-05-11"))).toBeNull();
    // @ts-expect-error testing defensive null
    expect(selectActiveRace(null, d("2026-05-11"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// currentMacroContext (3 test)
// ─────────────────────────────────────────────────────────────────────────────

describe("currentMacroContext", () => {
  it("oggi nel mezzo del macro → ritorna phase corretta", () => {
    const today = d("2026-06-22");        // lunedì
    const race = makeRace({ date: "2026-09-14" }); // +12 sett
    const macro = buildMacroCycle(race, today);
    expect(macro).not.toBeNull();

    // Oggi (settimana 1) → fase base.
    let ctx = currentMacroContext(macro!, today);
    expect(ctx).not.toBeNull();
    expect(ctx!.weekNumber).toBe(1);
    expect(ctx!.phase).toBe("base");
    expect(ctx!.totalWeeks).toBe(12);
    expect(ctx!.weeksToRace).toBe(12);

    // Avanti di 5 settimane: dovremmo essere in build (week 6).
    const week6 = d("2026-07-27"); // +35 giorni
    ctx = currentMacroContext(macro!, week6);
    expect(ctx).not.toBeNull();
    expect(ctx!.weekNumber).toBe(6);
    expect(ctx!.phase).toBe("build");

    // Ultima settimana → taper (week 12).
    const lastWeek = d("2026-09-08"); // race-1 settimana
    ctx = currentMacroContext(macro!, lastWeek);
    expect(ctx).not.toBeNull();
    expect(ctx!.weekNumber).toBe(12);
    expect(ctx!.phase).toBe("taper");
    expect(ctx!.weeksToRace).toBe(1);
  });

  it("oggi prima dello start → null", () => {
    const startDay = d("2026-06-22");
    const race = makeRace({ date: "2026-09-14" });
    const macro = buildMacroCycle(race, startDay);
    expect(macro).not.toBeNull();
    const beforeStart = d("2026-06-15");
    expect(currentMacroContext(macro!, beforeStart)).toBeNull();
  });

  it("oggi dopo la race → null (macro completato)", () => {
    const startDay = d("2026-06-22");
    const race = makeRace({ date: "2026-09-14" });
    const macro = buildMacroCycle(race, startDay);
    expect(macro).not.toBeNull();
    const afterRace = d("2026-09-20");
    expect(currentMacroContext(macro!, afterRace)).toBeNull();
  });
});
