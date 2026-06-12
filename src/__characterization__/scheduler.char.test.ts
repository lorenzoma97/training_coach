// FASE 0 — Test di CARATTERIZZAZIONE: lib/scheduler.ts (weekly report + regen).
//
// LLM mockato (generateWeeklyReport, regenerateNextWeek): qui si fotografa
// SOLO l'orchestrazione: trigger, lock, marker data, routing dello slot piano.
//
// BUG documentati (audit 2026-06-12):
//  - C2: lo scheduler salva la regen "next-week" nello slot CORRENTE
//        `training-plan` (scheduler.ts:151 via savePlanWithHistory), mentre il
//        path manuale (TrainingPlanView) instrada lo stesso caso su
//        `training-plan-next`. Di lunedì il piano appena iniziato viene
//        sostituito da quello della settimana dopo. Il test pinna il
//        comportamento attuale: col fix di Fase 1 va aggiornato.
//  - A3: `last-weekly-report-date` è scritto PRIMA della chiamata LLM
//        (scheduler.ts:106): se l'LLM fallisce, il giorno è consumato e
//        report+piano saltano fino al retry retroattivo (>=7 giorni).

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrainingPlan, UserProfile, WeeklyReport } from "../lib/types";

const { mockGenerateWeeklyReport, mockRegenerateNextWeek } = vi.hoisted(() => ({
  mockGenerateWeeklyReport: vi.fn(),
  mockRegenerateNextWeek: vi.fn(),
}));

vi.mock("../lib/coach/weeklyReport", () => ({
  generateWeeklyReport: mockGenerateWeeklyReport,
}));
vi.mock("../lib/coach/planGenerator", () => ({
  regenerateNextWeek: mockRegenerateNextWeek,
}));
vi.mock("../lib/gemini", () => ({
  hasApiKey: () => true,
}));

import { maybeRunWeeklyReport } from "../lib/scheduler";

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

function seed(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
function readJSON<T>(key: string): T | null {
  const v = localStorage.getItem(key);
  return v === null ? null : (JSON.parse(v) as T);
}
function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minimalProfile(): UserProfile {
  return {
    age: 28, sex: "m", weight_kg: 81, height_cm: 178,
    experience: "regular", injuries: [], meds: "",
    weekly_availability: { days: 4, hoursPerSession: 1 },
    equipment: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as UserProfile;
}

function fakeReport(): WeeklyReport {
  return {
    summary: "settimana ok",
    volumeByDiscipline: { corsa: { planned_min: 60, actual_min: 55 } },
    painTrend: "-",
    sleepFatigueTrend: "-",
    adherencePct: 80,
    adjustments: "-",
  } as WeeklyReport;
}

function makePlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
    startDate: localDate(0),
    weeks: [{
      weekNumber: 1, focus: "base",
      sessions: [{ day: "lun", type: "corsa", duration_min: 40, details: "", rationale: "" }],
    }],
    rationale: "piano corrente",
    ...overrides,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new LocalStorageMock(),
    configurable: true,
    writable: true,
  });
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGenerateWeeklyReport.mockReset().mockResolvedValue(fakeReport());
  mockRegenerateNextWeek.mockReset().mockImplementation(async () =>
    makePlan({
      generatedAt: new Date(Date.now() + 1000).toISOString(),
      startDate: localDate(7), // il generator mette il lunedì PROSSIMO in mode next-week
      rationale: "piano settimana prossima",
    }),
  );
});

describe("maybeRunWeeklyReport — orchestrazione (caratterizzazione)", () => {
  it("prima esecuzione assoluta: corre qualsiasi giorno, scrive report + regen nel feed", async () => {
    seed("user-profile", minimalProfile());
    seed("training-plan", makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" }));

    const item = await maybeRunWeeklyReport();

    expect(item?.type).toBe("weekly-report");
    expect(mockGenerateWeeklyReport).toHaveBeenCalledTimes(1);
    expect(mockRegenerateNextWeek).toHaveBeenCalledTimes(1);
    // mode passato alla regen = "next-week" (5° argomento)
    expect(mockRegenerateNextWeek.mock.calls[0][4]).toBe("next-week");

    const feed = readJSON<Array<{ type: string }>>("coach-feed")!;
    expect(feed.map(f => f.type)).toEqual(["plan-update", "weekly-report"]);
    expect(localStorage.getItem("last-weekly-report-date")).toBe(JSON.stringify(localDate(0)));
    // Lock rilasciato nel finally
    expect(localStorage.getItem("weekly-report-running")).toBeNull();
  });

  it("BUG C2: la regen next-week sostituisce lo slot CORRENTE training-plan (preview slot non usato)", async () => {
    const current = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    seed("user-profile", minimalProfile());
    seed("training-plan", current);

    await maybeRunWeeklyReport();

    const plan = readJSON<TrainingPlan>("training-plan")!;
    // Comportamento ATTUALE: piano corrente rimpiazzato dal piano con
    // startDate = lunedì prossimo; training-plan-next resta vuoto.
    // Col fix C2 (routing su preview slot) questo test va invertito.
    expect(plan.rationale).toBe("piano settimana prossima");
    expect(plan.startDate).toBe(localDate(7));
    expect(readJSON<TrainingPlan>("training-plan-next")).toBeNull();
    // Il piano precedente è archiviato in history.
    const history = readJSON<TrainingPlan[]>("plan-history")!;
    expect(history[0].generatedAt).toBe(current.generatedAt);
  });

  it("BUG A3: marker data scritto PRIMA della LLM call — un fallimento consuma il giorno", async () => {
    seed("user-profile", minimalProfile());
    mockGenerateWeeklyReport.mockRejectedValue(new Error("503 model overloaded"));

    await expect(maybeRunWeeklyReport()).rejects.toThrow("503");

    // Comportamento ATTUALE: il giorno è marcato anche se non è uscito nulla.
    expect(localStorage.getItem("last-weekly-report-date")).toBe(JSON.stringify(localDate(0)));
    expect(readJSON<unknown[]>("coach-feed")).toBeNull();
    // Lock comunque rilasciato (finally).
    expect(localStorage.getItem("weekly-report-running")).toBeNull();
  });

  it("seconda esecuzione lo stesso giorno: no-op (marker data)", async () => {
    seed("user-profile", minimalProfile());
    await maybeRunWeeklyReport();
    mockGenerateWeeklyReport.mockClear();

    const second = await maybeRunWeeklyReport();

    expect(second).toBeNull();
    expect(mockGenerateWeeklyReport).not.toHaveBeenCalled();
  });

  it("lock cross-tab fresco di altro tab: skip senza chiamare l'LLM", async () => {
    seed("user-profile", minimalProfile());
    seed("weekly-report-running", { ts: Date.now(), tabId: "altro-tab" });

    const result = await maybeRunWeeklyReport();

    expect(result).toBeNull();
    expect(mockGenerateWeeklyReport).not.toHaveBeenCalled();
  });

  it("lock stale (>60s) di altro tab: viene scavalcato", async () => {
    seed("user-profile", minimalProfile());
    seed("weekly-report-running", { ts: Date.now() - 120_000, tabId: "altro-tab" });

    const item = await maybeRunWeeklyReport();

    expect(item?.type).toBe("weekly-report");
    expect(mockGenerateWeeklyReport).toHaveBeenCalledTimes(1);
  });

  it("errore nella sola regen: report pubblicato, piano vecchio resta, errore swallowed", async () => {
    const current = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    seed("user-profile", minimalProfile());
    seed("training-plan", current);
    mockRegenerateNextWeek.mockRejectedValue(new Error("LLM down"));

    const item = await maybeRunWeeklyReport();

    // Comportamento ATTUALE (A3-bis): il report esce, la regen fallita è solo
    // un console.error — il piano resta quello vecchio senza notifica utente.
    expect(item?.type).toBe("weekly-report");
    expect(readJSON<TrainingPlan>("training-plan")?.generatedAt).toBe(current.generatedAt);
    const feed = readJSON<Array<{ type: string }>>("coach-feed")!;
    expect(feed.map(f => f.type)).toEqual(["weekly-report"]);
  });
});
