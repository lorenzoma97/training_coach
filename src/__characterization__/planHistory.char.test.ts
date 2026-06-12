// FASE 0 — Test di CARATTERIZZAZIONE: lib/coach/planHistory.ts
//
// Fotografano il comportamento ATTUALE (inclusi i quirk noti) prima del
// refactoring del data-layer. Se uno di questi test si rompe, una fase
// successiva ha cambiato un comportamento osservabile: o è il fix previsto
// (aggiornare il test, con nota) o è una regressione.
//
// Quirk documentati qui:
//  - Q1: maybePromoteNextPlan promuove anche preview VECCHISSIMI (nessun
//        limite superiore: solo `startD > today` blocca). planHistory.ts:89.
//  - Q2: dedup archivio solo su history[0].generatedAt (non sull'intera lista).

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  savePlanWithHistory,
  archivePlan,
  getPlanHistory,
  maybePromoteNextPlan,
  getNextPlan,
  NEXT_PLAN_KEY,
  PLAN_HISTORY_KEY,
} from "../lib/coach/planHistory";
import type { TrainingPlan } from "../lib/types";

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

function seed(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
function readJSON<T>(key: string): T | null {
  const v = localStorage.getItem(key);
  return v === null ? null : (JSON.parse(v) as T);
}

/** Data locale YYYY-MM-DD con offset giorni rispetto a oggi. */
function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makePlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
    startDate: localDate(0),
    weeks: [{
      weekNumber: 1,
      focus: "base",
      sessions: [{ day: "lun", type: "corsa", duration_min: 40, details: "", rationale: "" }],
    }],
    rationale: "piano di test",
    ...overrides,
  };
}

describe("savePlanWithHistory / archivePlan (caratterizzazione)", () => {
  it("archivia il piano precedente se generatedAt diverso", async () => {
    const prev = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    const next = makePlan({ generatedAt: "2026-01-08T00:00:00.000Z" });
    seed("training-plan", prev);

    await savePlanWithHistory(next);

    expect(readJSON<TrainingPlan>("training-plan")?.generatedAt).toBe(next.generatedAt);
    const history = await getPlanHistory();
    expect(history).toHaveLength(1);
    expect(history[0].generatedAt).toBe(prev.generatedAt);
  });

  it("NON archivia se generatedAt identico (idempotenza)", async () => {
    const same = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    seed("training-plan", same);
    await savePlanWithHistory(same);
    expect(await getPlanHistory()).toHaveLength(0);
  });

  it("cap della history a 12 entry, più recente in testa", async () => {
    const old = Array.from({ length: 12 }, (_, i) =>
      makePlan({ generatedAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
    seed(PLAN_HISTORY_KEY, old);

    const newest = makePlan({ generatedAt: "2026-02-01T00:00:00.000Z" });
    await archivePlan(newest);

    const history = await getPlanHistory();
    expect(history).toHaveLength(12);
    expect(history[0].generatedAt).toBe(newest.generatedAt);
  });

  it("Q2: dedup solo contro history[0] — un generatedAt già presente in coda viene ri-archiviato", async () => {
    const a = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    const b = makePlan({ generatedAt: "2026-01-08T00:00:00.000Z" });
    seed(PLAN_HISTORY_KEY, [b, a]); // a NON è in testa
    await archivePlan(a);
    const history = await getPlanHistory();
    // Comportamento attuale: duplicato di `a` in testa (dedup guarda solo [0]).
    expect(history.map(p => p.generatedAt)).toEqual([
      a.generatedAt, b.generatedAt, a.generatedAt,
    ]);
  });
});

describe("maybePromoteNextPlan (caratterizzazione)", () => {
  it("promuove un preview con startDate <= oggi: sostituisce, archivia, svuota lo slot", async () => {
    const current = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    const next = makePlan({ generatedAt: "2026-01-08T00:00:00.000Z", startDate: localDate(-1) });
    seed("training-plan", current);
    seed(NEXT_PLAN_KEY, next);

    const promoted = await maybePromoteNextPlan();

    expect(promoted).toBe(true);
    expect(readJSON<TrainingPlan>("training-plan")?.generatedAt).toBe(next.generatedAt);
    expect(await getNextPlan()).toBeNull();
    expect((await getPlanHistory())[0]?.generatedAt).toBe(current.generatedAt);
  });

  it("NON promuove un preview futuro", async () => {
    const next = makePlan({ startDate: localDate(+3) });
    seed(NEXT_PLAN_KEY, next);
    expect(await maybePromoteNextPlan()).toBe(false);
    expect(readJSON<TrainingPlan>("training-plan")).toBeNull();
  });

  it("Q1: promuove anche un preview vecchio di 3 settimane (nessun limite superiore)", async () => {
    // QUIRK documentato: un preview stantio diventa piano corrente, subito stale.
    // Se un fix futuro aggiunge un limite superiore, aggiornare questo test.
    const stale = makePlan({ startDate: localDate(-21) });
    seed(NEXT_PLAN_KEY, stale);
    expect(await maybePromoteNextPlan()).toBe(true);
    expect(readJSON<TrainingPlan>("training-plan")?.startDate).toBe(stale.startDate);
  });

  it("rifiuta preview con startDate malformato o senza settimane", async () => {
    seed(NEXT_PLAN_KEY, makePlan({ startDate: "2026-6-1" })); // regex YYYY-MM-DD fallisce
    expect(await maybePromoteNextPlan()).toBe(false);

    seed(NEXT_PLAN_KEY, { ...makePlan({ startDate: localDate(-1) }), weeks: [] });
    expect(await maybePromoteNextPlan()).toBe(false);
  });
});
