// Wave 3.4 — Test suite per readinessScoring (G7, ARCHITECTURE.md §6 R7).
//
// Coverage (≥10 test):
//  1. Cold start (no HRV history) → solo sleep+soggettivo, score plausibile
//  2. HRV baseline 50ms, oggi 50ms → delta 0 → score alto
//  3. HRV baseline 50ms, oggi 30ms → delta -20ms → score basso
//  4. Sleep 8h + ottimo → sleep score 100
//  5. Sleep 4h + scarso → sleep score < 30
//  6. Componenti rinormalizzati se HRV mancante
//  7. Min sample 7gg: meno → no HRV component
//  8. Band assignment: <50 low, 50-70 moderate, >70 high
//  9. Multi-day rolling (oggi 3gg avg, baseline 30gg media)
// 10. Idempotenza: stesso input → stesso score
//
// Bonus:
// 11. Sample utility/component pure functions (hrvScoreFromDelta, sleep, ecc.)
// 12. Side-effect orchestrator (recompute + persist)

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeReadinessScore,
  hrvScoreFromDelta,
  computeHrvComponent,
  computeSleepComponent,
  computeSubjectiveComponent,
  computeSorenessComponent,
  recomputeReadinessForToday,
  getCurrentReadiness,
  READINESS_HISTORY_KEY,
  SAMSUNG_HRV_HISTORY_KEY,
} from "../readinessScoring";
import type { DailyCheck } from "../../diaryContext";
import type { ReadinessSnapshot } from "../../types/readiness";

// ─────────────────────────────────────────────────────────────────────────────
// localStorage mock
// ─────────────────────────────────────────────────────────────────────────────

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
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TARGET = "2026-05-11";

function buildHrvHistory(values: number[], endDate = TARGET): Array<{ date: string; rmssd_ms: number }> {
  // Costruisce N giorni consecutivi terminanti a endDate, valori inseriti in ordine cronologico.
  const out: Array<{ date: string; rmssd_ms: number }> = [];
  const end = new Date(endDate);
  for (let i = values.length - 1, day = 0; i >= 0; i--, day++) {
    const d = new Date(end);
    d.setDate(end.getDate() - day);
    out.unshift({ date: d.toISOString().slice(0, 10), rmssd_ms: values[i] });
  }
  return out;
}

function dailyEntry(date: string, daily: Partial<DailyCheck> | null): { date: string; daily: DailyCheck | null } {
  if (daily === null) return { date, daily: null };
  return { date, daily: daily as DailyCheck };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cold start (no HRV history)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeReadinessScore — cold start (no HRV history)", () => {
  it("test 1: sleep+soggettivo soltanto → score plausibile, nessun HRV component", () => {
    const result = computeReadinessScore({
      hrvHistory: [],
      dailyHistory: [
        dailyEntry(TARGET, { sleep: 7.5, sleepQ: "buono", morningFreshness: 7 }),
      ],
      targetDate: TARGET,
    });
    expect(result.components.hrvDelta).toBeUndefined();
    expect(result.components.sleepScore).toBeDefined();
    expect(result.components.subjectiveScore).toBeDefined();
    // Score plausibile: sleep ~90, fresh ~67 → pesata (30+20)/50 ≈ 81
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.score).toBeLessThanOrEqual(95);
    expect(result.band).toBe("high");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2-3. HRV delta scoring
// ─────────────────────────────────────────────────────────────────────────────

describe("computeReadinessScore — HRV component", () => {
  it("test 2: baseline 50ms, oggi 50ms → delta 0 → HRV score 100, score alto", () => {
    // 30 giorni tutti a 50ms
    const history = buildHrvHistory(new Array(30).fill(50));
    const result = computeReadinessScore({
      hrvHistory: history,
      dailyHistory: [
        dailyEntry(TARGET, { sleep: 7, sleepQ: "buono", morningFreshness: 7 }),
      ],
      targetDate: TARGET,
    });
    expect(result.components.hrvDelta).toBe(0);
    // HRV score = 100 → contribuisce di 40 weight su 90 = ~44 punti
    // sleep score ~85, fresh score ~67
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.band).toBe("high");
  });

  it("test 3: baseline 50ms, oggi 30ms → delta -20ms → HRV score basso, score basso", () => {
    // 27 giorni a 50ms + 3 giorni a 30ms (oggi 3gg avg = 30)
    const history = buildHrvHistory([
      ...new Array(27).fill(50),
      30, 30, 30,
    ]);
    const result = computeReadinessScore({
      hrvHistory: history,
      dailyHistory: [
        dailyEntry(TARGET, { sleep: 6, sleepQ: "ok", morningFreshness: 5 }),
      ],
      targetDate: TARGET,
    });
    expect(result.components.hrvDelta).toBeLessThanOrEqual(-15);
    // HRV score in [-25, -10] interp → score molto basso (~16-17)
    // weight HRV 40: contributo 40 * ~17/100 = ~7
    // sleep ~50 weight 30 = 15; fresh ~44 weight 20 = 9
    // Totale (7+15+9) / 90 * 100 ≈ 35
    expect(result.score).toBeLessThan(50);
    expect(result.band).toBe("low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-5. Sleep component
// ─────────────────────────────────────────────────────────────────────────────

describe("computeSleepComponent", () => {
  it("test 4: 8h + 'ottimo' → score 100", () => {
    expect(computeSleepComponent(8, "ottimo")).toBe(100);
  });

  it("test 5: 4h + 'scarso' → score < 30", () => {
    // 4h hoursScore = 0 → 0 * 0.4 = 0
    expect(computeSleepComponent(4, "scarso")).toBeLessThan(30);
    // 4.5h → hoursScore 30, * 0.4 = 12
    expect(computeSleepComponent(4.5, "scarso")).toBeLessThan(30);
  });

  it("test 5b: 7h + 'buono' → score alto", () => {
    // 7h = 100, *0.9 = 90
    expect(computeSleepComponent(7, "buono")).toBe(90);
  });

  it("test 5c: hours undefined → null", () => {
    expect(computeSleepComponent(undefined, "ottimo")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Componenti rinormalizzati se HRV mancante
// ─────────────────────────────────────────────────────────────────────────────

describe("componenti rinormalizzati", () => {
  it("test 6: HRV mancante → pesi rinormalizzati su sleep+freschezza", () => {
    // Caso A: HRV presente → score blend
    const withHrv = computeReadinessScore({
      hrvHistory: buildHrvHistory(new Array(30).fill(50)),
      dailyHistory: [dailyEntry(TARGET, { sleep: 7.5, sleepQ: "ottimo", morningFreshness: 8 })],
      targetDate: TARGET,
    });
    // Caso B: HRV assente → solo sleep+freschezza, ma rinormalizzati
    const withoutHrv = computeReadinessScore({
      hrvHistory: [],
      dailyHistory: [dailyEntry(TARGET, { sleep: 7.5, sleepQ: "ottimo", morningFreshness: 8 })],
      targetDate: TARGET,
    });
    // Lo score senza HRV deve comunque essere alto (sleep 100 + fresh 78 → media pesata ~91)
    // Con HRV aggiunto (score 100) media tende a salire ulteriormente
    expect(withoutHrv.score).toBeGreaterThan(75);
    expect(withHrv.score).toBeGreaterThan(75);
    // Senza HRV: solo 2 componenti contribuiscono ai pesi totali
    expect(withoutHrv.components.hrvDelta).toBeUndefined();
    expect(withHrv.components.hrvDelta).toBe(0);
  });

  it("test 6b: solo HRV (no daily) → score basato solo su HRV", () => {
    const result = computeReadinessScore({
      hrvHistory: buildHrvHistory(new Array(30).fill(50)),
      dailyHistory: [],
      targetDate: TARGET,
    });
    expect(result.components.hrvDelta).toBe(0);
    expect(result.components.sleepScore).toBeUndefined();
    expect(result.components.subjectiveScore).toBeUndefined();
    expect(result.score).toBe(100); // Solo HRV con score 100
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Min sample 7gg
// ─────────────────────────────────────────────────────────────────────────────

describe("min sample HRV", () => {
  it("test 7a: meno di 7 giorni di HRV → no HRV component", () => {
    const result = computeReadinessScore({
      hrvHistory: buildHrvHistory(new Array(6).fill(50)), // 6 giorni < min 7
      dailyHistory: [dailyEntry(TARGET, { sleep: 7, sleepQ: "buono", morningFreshness: 6 })],
      targetDate: TARGET,
    });
    expect(result.components.hrvDelta).toBeUndefined();
    // Rationale espone il motivo
    expect(result.rationale).toMatch(/HRV.*7gg/);
  });

  it("test 7b: esattamente 7 giorni → HRV component attivo", () => {
    const result = computeReadinessScore({
      hrvHistory: buildHrvHistory(new Array(7).fill(50)),
      dailyHistory: [dailyEntry(TARGET, { sleep: 7, sleepQ: "buono", morningFreshness: 6 })],
      targetDate: TARGET,
    });
    expect(result.components.hrvDelta).toBeDefined();
    expect(result.components.hrvDelta).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Band assignment
// ─────────────────────────────────────────────────────────────────────────────

describe("band assignment", () => {
  it("test 8a: score < 50 → low", () => {
    // Sleep 4h scarso (score ~0), no fresh, no HRV
    const result = computeReadinessScore({
      hrvHistory: [],
      dailyHistory: [dailyEntry(TARGET, { sleep: 4, sleepQ: "scarso" })],
      targetDate: TARGET,
    });
    expect(result.score).toBeLessThan(50);
    expect(result.band).toBe("low");
  });

  it("test 8b: score in [50, 70] → moderate", () => {
    // Sleep 6h ok (60*0.7=42), fresh 5 (~44) → pesata su 50 = (42*30+44*20)/50 ≈ 43 → low
    // Per moderate: sleep 6.5h ok → (60+0.5*20)*0.7=49, fresh 7 → 67. (49*30+67*20)/50 = (1470+1340)/50 = 56
    const result = computeReadinessScore({
      hrvHistory: [],
      dailyHistory: [dailyEntry(TARGET, { sleep: 6.5, sleepQ: "ok", morningFreshness: 7 })],
      targetDate: TARGET,
    });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThanOrEqual(70);
    expect(result.band).toBe("moderate");
  });

  it("test 8c: score > 70 → high", () => {
    const result = computeReadinessScore({
      hrvHistory: [],
      dailyHistory: [dailyEntry(TARGET, { sleep: 8, sleepQ: "ottimo", morningFreshness: 9 })],
      targetDate: TARGET,
    });
    expect(result.score).toBeGreaterThan(70);
    expect(result.band).toBe("high");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Multi-day rolling
// ─────────────────────────────────────────────────────────────────────────────

describe("multi-day rolling HRV", () => {
  it("test 9: oggi = media 3gg, baseline = mediana 30gg smoothed", () => {
    // Costruisco baseline 50ms stabile per 27gg + 3 ultimi giorni a 70ms
    // → "oggi" (3gg avg) = 70ms
    // → baseline 30gg con smoothing 3gg dovrebbe essere ~50ms
    // → delta = +20ms → HRV score = 100 (positive delta)
    const history = buildHrvHistory([
      ...new Array(27).fill(50),
      70, 70, 70,
    ]);
    const result = computeHrvComponent(history, TARGET);
    expect(result).not.toBeNull();
    expect(result!.delta).toBeGreaterThan(0);
    // Smoothing 3gg: l'ultimo punto smoothed ≈ (50+70+70)/3 ≈ 63
    // Mediana di valori che vanno [50..63] → ~50
    // Oggi = 70, delta ≈ 20
    expect(result!.score).toBe(100);
  });

  it("test 9b: drop ultimi 3gg ma baseline alta → delta negativo", () => {
    // 27gg a 70ms + 3gg a 50ms
    const history = buildHrvHistory([
      ...new Array(27).fill(70),
      50, 50, 50,
    ]);
    const result = computeHrvComponent(history, TARGET);
    expect(result).not.toBeNull();
    expect(result!.delta).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Idempotenza
// ─────────────────────────────────────────────────────────────────────────────

describe("idempotenza", () => {
  it("test 10: stesso input → stesso score (deterministico)", () => {
    const history = buildHrvHistory([
      ...new Array(28).fill(45),
      40, 50,
    ]);
    const dailyHistory = [
      dailyEntry(TARGET, { sleep: 7, sleepQ: "buono", morningFreshness: 7 }),
    ];

    const r1 = computeReadinessScore({ hrvHistory: history, dailyHistory, targetDate: TARGET });
    const r2 = computeReadinessScore({ hrvHistory: history, dailyHistory, targetDate: TARGET });
    const r3 = computeReadinessScore({ hrvHistory: history, dailyHistory, targetDate: TARGET });

    expect(r1.score).toBe(r2.score);
    expect(r2.score).toBe(r3.score);
    expect(r1.band).toBe(r2.band);
    expect(r1.components).toEqual(r2.components);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: pure component functions
// ─────────────────────────────────────────────────────────────────────────────

describe("hrvScoreFromDelta (pure)", () => {
  it("delta ≥ 0 → 100", () => {
    expect(hrvScoreFromDelta(0)).toBe(100);
    expect(hrvScoreFromDelta(5)).toBe(100);
    expect(hrvScoreFromDelta(50)).toBe(100);
  });

  it("delta -10 → 50", () => {
    expect(hrvScoreFromDelta(-10)).toBe(50);
  });

  it("delta ≤ -25 → 0", () => {
    expect(hrvScoreFromDelta(-25)).toBe(0);
    expect(hrvScoreFromDelta(-100)).toBe(0);
  });

  it("interpolazione lineare nei range", () => {
    // delta=-5 → tra 0 e -10 → 75
    expect(hrvScoreFromDelta(-5)).toBe(75);
    // delta=-20 → tra -10 e -25 → ~16.67
    expect(hrvScoreFromDelta(-20)).toBeCloseTo(16.67, 1);
  });
});

describe("computeSubjectiveComponent (pure)", () => {
  it("freshness 1 → 0, freshness 10 → 100, lineare", () => {
    expect(computeSubjectiveComponent(1)).toBe(0);
    expect(computeSubjectiveComponent(10)).toBe(100);
    // 5.5 → 50
    expect(computeSubjectiveComponent(5.5)).toBe(50);
  });

  it("clamp fuori range", () => {
    expect(computeSubjectiveComponent(0)).toBe(0);
    expect(computeSubjectiveComponent(15)).toBe(100);
  });

  it("undefined → null", () => {
    expect(computeSubjectiveComponent(undefined)).toBeNull();
  });
});

describe("computeSorenessComponent (pure inverso)", () => {
  it("soreness 0 → 100, soreness 10 → 0", () => {
    expect(computeSorenessComponent(0)).toBe(100);
    expect(computeSorenessComponent(10)).toBe(0);
    expect(computeSorenessComponent(5)).toBe(50);
  });

  it("undefined → null (componente skippato)", () => {
    expect(computeSorenessComponent(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Side-effect orchestrator
// ─────────────────────────────────────────────────────────────────────────────

describe("recomputeReadinessForToday (side-effect)", () => {
  it("scrive snapshot in readiness-history", async () => {
    // Pre-popola HRV history (30gg stabile)
    const today = new Date().toISOString().slice(0, 10);
    const hrv: Array<{ date: string; rmssd_ms: number }> = [];
    const end = new Date(today);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      hrv.push({ date: d.toISOString().slice(0, 10), rmssd_ms: 50 });
    }
    localStorage.setItem(SAMSUNG_HRV_HISTORY_KEY, JSON.stringify(hrv));
    localStorage.setItem("diary-index", JSON.stringify([today]));
    localStorage.setItem(`day:${today}`, JSON.stringify({
      daily: { sleep: 7.5, sleepQ: "buono", morningFreshness: 7 },
      workouts: [],
    }));

    const snapshot = await recomputeReadinessForToday();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.date).toBe(today);
    expect(snapshot!.score).toBeGreaterThan(70);

    // Verifica persistenza
    const raw = localStorage.getItem(READINESS_HISTORY_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!) as ReadinessSnapshot[];
    expect(persisted.length).toBe(1);
    expect(persisted[0].date).toBe(today);
  });

  it("idempotente per stesso giorno: ricalcolo sovrascrive snapshot esistente", async () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem("diary-index", JSON.stringify([today]));
    localStorage.setItem(`day:${today}`, JSON.stringify({
      daily: { sleep: 7, sleepQ: "buono", morningFreshness: 7 },
      workouts: [],
    }));

    await recomputeReadinessForToday();
    await recomputeReadinessForToday();
    const persisted = JSON.parse(localStorage.getItem(READINESS_HISTORY_KEY)!) as ReadinessSnapshot[];
    // 2 ricalcoli stessa data → 1 sola snapshot in storage (deduplicate per date)
    expect(persisted.length).toBe(1);
  });

  it("getCurrentReadiness ritorna l'ultima snapshot ≤ oggi", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yIso = yesterday.toISOString().slice(0, 10);

    const snapshots: ReadinessSnapshot[] = [
      { date: yIso, score: 60, components: {}, band: "moderate", appliedAdjustment: "none" },
      { date: today, score: 80, components: {}, band: "high", appliedAdjustment: "none" },
    ];
    localStorage.setItem(READINESS_HISTORY_KEY, JSON.stringify(snapshots));

    const current = await getCurrentReadiness();
    expect(current).not.toBeNull();
    expect(current!.date).toBe(today);
    expect(current!.score).toBe(80);
  });
});
