import { describe, it, expect } from "vitest";
import {
  trimpFromWorkout,
  aggregateDailyLoad,
  computeTrainingLoad,
  formatTrainingLoadForPrompt,
} from "../trainingLoad";

describe("trimpFromWorkout", () => {
  it("calcola TRIMP base sRPE × min", () => {
    expect(trimpFromWorkout(7, 60)).toBe(420);
    expect(trimpFromWorkout(5, 30)).toBe(150);
  });
  it("ritorna 0 per input invalido", () => {
    expect(trimpFromWorkout(undefined, 60)).toBe(0);
    expect(trimpFromWorkout(7, undefined)).toBe(0);
    expect(trimpFromWorkout(0, 60)).toBe(0);
    expect(trimpFromWorkout(11, 60)).toBe(0);
    expect(trimpFromWorkout(7, 0)).toBe(0);
    expect(trimpFromWorkout(7, -10)).toBe(0);
  });
});

describe("aggregateDailyLoad", () => {
  it("aggrega multipli workout same-day in una entry", () => {
    const out = aggregateDailyLoad([
      { date: "2026-05-01", sRPE: 6, durationMin: 60 }, // 360
      { date: "2026-05-01", sRPE: 7, durationMin: 30 }, // 210
      { date: "2026-05-02", sRPE: 5, durationMin: 45 }, // 225
    ]);
    expect(out).toEqual([
      { date: "2026-05-01", trimp: 570 },
      { date: "2026-05-02", trimp: 225 },
    ]);
  });
  it("ignora workout senza data o senza RPE valido", () => {
    const out = aggregateDailyLoad([
      { date: undefined, sRPE: 6, durationMin: 60 },
      { date: "2026-05-01", sRPE: 11, durationMin: 60 },
      { date: "2026-05-01", sRPE: 7, durationMin: 30 },
    ]);
    expect(out).toEqual([{ date: "2026-05-01", trimp: 210 }]);
  });
});

describe("computeTrainingLoad", () => {
  it("snapshot vuoto se nessun dato", () => {
    const s = computeTrainingLoad([], "2026-05-15");
    expect(s.atl).toBe(0);
    expect(s.ctl).toBe(0);
    expect(s.tsb).toBe(0);
    expect(s.band).toBe("detraining");
  });

  it("EWMA progressivo: TRIMP costante alto → ATL > CTL → TSB negativo (training band)", () => {
    // 30 giorni a TRIMP 400/giorno (es. 60min RPE 7 ogni giorno)
    const daily = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 4, 1 + i)).toISOString().slice(0, 10),
      trimp: 400,
    }));
    const s = computeTrainingLoad(daily, "2026-05-30");
    expect(s.atl).toBeGreaterThan(s.ctl); // ATL converge piu' rapidamente
    expect(s.tsb).toBeLessThan(0);
    expect(s.daysUsed).toBe(30);
  });

  it("dopo lungo carico + settimana di rest → TSB sale (fresh/peaked)", () => {
    // 35 giorni a 350 trimp + 7 giorni rest (0 trimp)
    const heavy = Array.from({ length: 35 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10),
      trimp: 350,
    }));
    const rest = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 4, 5 + i)).toISOString().slice(0, 10),
      trimp: 0,
    }));
    const s = computeTrainingLoad([...heavy, ...rest], "2026-05-12");
    expect(s.tsb).toBeGreaterThan(0); // form positiva post-rest
    expect(["fresh", "peaked", "training"]).toContain(s.band);
  });
});

describe("formatTrainingLoadForPrompt", () => {
  it("ritorna stringa vuota se daysUsed insufficiente + detraining", () => {
    const empty = computeTrainingLoad([], "2026-05-15");
    expect(formatTrainingLoadForPrompt(empty)).toBe("");
  });
  it("contiene CARICO ATTUALE, ATL, CTL, TSB", () => {
    const daily = Array.from({ length: 21 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 4, 1 + i)).toISOString().slice(0, 10),
      trimp: 300,
    }));
    const s = computeTrainingLoad(daily, "2026-05-21");
    const txt = formatTrainingLoadForPrompt(s);
    expect(txt).toContain("CARICO ATTUALE");
    expect(txt).toContain("ATL");
    expect(txt).toContain("CTL");
    expect(txt).toContain("TSB");
    expect(txt).toContain("Band:");
  });
});
