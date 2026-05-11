// Wave 3.4 — Smoke + unit test per MobilityLibrary.
// Pattern test puro Node (no React DOM): smoke import + pure helper exports.
//
// Cosa testiamo:
//  - smoke import del componente (no crash a load-time)
//  - filterRoutinesByPurpose("all") ritorna tutte le routine
//  - filterRoutinesByPurpose("warmup") ritorna solo routine con purpose=warmup
//  - filterRoutinesByPurpose("cooldown") ritorna [] se nessuna routine cooldown
//  - filterRoutinesByPurpose non muta l'input
//  - formatStepMetric con duration_sec >= 60 multiplo → "X min"
//  - formatStepMetric con duration_sec < 60 → "Xs"
//  - formatStepMetric con reps → "N rip"
//  - formatStepMetric con entrambi → preferisce duration_sec
//  - formatStepMetric con nessuno → "—"
//  - MOBILITY_ROUTINES catalog ha ≥6 routine (smoke su contract di Wave 2.1)

import { describe, it, expect } from "vitest";
import MobilityLibrary, {
  filterRoutinesByPurpose,
  formatStepMetric,
} from "../MobilityLibrary";
import { MOBILITY_ROUTINES } from "../../../lib/catalog/mobilityRoutines";
import type { MobilityRoutine } from "../../../lib/types/mobility";

// ─── Smoke ──────────────────────────────────────────────────────────────────
describe("MobilityLibrary (smoke)", () => {
  it("imports without throwing", () => {
    expect(MobilityLibrary).toBeDefined();
    expect(typeof MobilityLibrary).toBe("function");
  });

  it("catalog MOBILITY_ROUTINES carica con ≥6 routine (contract Wave 2.1)", () => {
    expect(MOBILITY_ROUTINES.length).toBeGreaterThanOrEqual(6);
    // Smoke: ogni routine ha id, name, purpose, duration_min, steps[]
    for (const r of MOBILITY_ROUTINES) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.name).toBe("string");
      expect(["warmup", "cooldown", "recovery", "injury_prevention"]).toContain(r.purpose);
      expect(typeof r.duration_min).toBe("number");
      expect(Array.isArray(r.steps)).toBe(true);
      expect(r.steps.length).toBeGreaterThan(0);
    }
  });
});

// ─── filterRoutinesByPurpose ────────────────────────────────────────────────
describe("filterRoutinesByPurpose", () => {
  it("\"all\" ritorna tutte le routine del catalog", () => {
    const out = filterRoutinesByPurpose(MOBILITY_ROUTINES, "all");
    expect(out.length).toBe(MOBILITY_ROUTINES.length);
  });

  it("\"warmup\" ritorna solo routine con purpose=warmup", () => {
    const out = filterRoutinesByPurpose(MOBILITY_ROUTINES, "warmup");
    expect(out.length).toBeGreaterThan(0); // catalog include almeno FIFA 11+ + Movement Prep + Dynamic Flow
    for (const r of out) {
      expect(r.purpose).toBe("warmup");
    }
    // Verifica che almeno fifa-11plus e movement-prep siano nei warmup
    const ids = out.map(r => r.id);
    expect(ids).toContain("fifa-11plus");
    expect(ids).toContain("movement-prep");
  });

  it("\"recovery\" ritorna solo routine con purpose=recovery", () => {
    const out = filterRoutinesByPurpose(MOBILITY_ROUTINES, "recovery");
    expect(out.length).toBeGreaterThan(0); // catalog include Foam Rolling + Yoga Recovery
    for (const r of out) {
      expect(r.purpose).toBe("recovery");
    }
  });

  it("\"injury_prevention\" ritorna solo routine con purpose=injury_prevention", () => {
    const out = filterRoutinesByPurpose(MOBILITY_ROUTINES, "injury_prevention");
    for (const r of out) {
      expect(r.purpose).toBe("injury_prevention");
    }
    // Catalog include calf-achilles-protocol
    expect(out.find(r => r.id === "calf-achilles-protocol")).toBeDefined();
  });

  it("non muta l'input array", () => {
    const before = MOBILITY_ROUTINES.slice();
    filterRoutinesByPurpose(MOBILITY_ROUTINES, "warmup");
    expect(MOBILITY_ROUTINES.length).toBe(before.length);
    // Identità preservata
    for (let i = 0; i < before.length; i++) {
      expect(MOBILITY_ROUTINES[i]).toBe(before[i]);
    }
  });

  it("input vuoto → output vuoto a prescindere dal filtro", () => {
    expect(filterRoutinesByPurpose([], "all")).toEqual([]);
    expect(filterRoutinesByPurpose([], "warmup")).toEqual([]);
  });

  it("filtro su set custom: cooldown vuoto → []", () => {
    // MOBILITY_ROUTINES correnti non hanno cooldown puro (warmup/recovery/injury_prevention)
    // → ritorna [] (verifica robustezza filter, non contract catalog).
    const customSet: MobilityRoutine[] = MOBILITY_ROUTINES.filter(r => r.purpose !== "cooldown");
    const out = filterRoutinesByPurpose(customSet, "cooldown");
    expect(out).toEqual([]);
  });
});

// ─── formatStepMetric ───────────────────────────────────────────────────────
describe("formatStepMetric", () => {
  it("duration_sec multiplo di 60 → \"X min\"", () => {
    expect(formatStepMetric({ duration_sec: 60 })).toBe("1 min");
    expect(formatStepMetric({ duration_sec: 120 })).toBe("2 min");
    expect(formatStepMetric({ duration_sec: 180 })).toBe("3 min");
  });

  it("duration_sec < 60 → \"Xs\"", () => {
    expect(formatStepMetric({ duration_sec: 30 })).toBe("30s");
    expect(formatStepMetric({ duration_sec: 45 })).toBe("45s");
  });

  it("duration_sec non multiplo di 60 → \"Xs\" (non spezzato in min)", () => {
    expect(formatStepMetric({ duration_sec: 90 })).toBe("90s");
    expect(formatStepMetric({ duration_sec: 75 })).toBe("75s");
  });

  it("reps → \"N rip\"", () => {
    expect(formatStepMetric({ reps: 10 })).toBe("10 rip");
    expect(formatStepMetric({ reps: 1 })).toBe("1 rip");
  });

  it("entrambi presenti → preferisce duration_sec", () => {
    expect(formatStepMetric({ duration_sec: 30, reps: 10 })).toBe("30s");
  });

  it("nessuno → \"—\"", () => {
    expect(formatStepMetric({})).toBe("—");
  });
});
