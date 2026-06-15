// FASE 0 — Test di CARATTERIZZAZIONE: lib/scheduler.ts (weekly report + regen).
//
// LLM mockato (generateWeeklyReport, regenerateNextWeek): qui si fotografa
// SOLO l'orchestrazione: trigger, lock, marker data, routing dello slot piano.
//
// Storia: in Fase 0 questo file pinnava i bug C2 (regen next-week salvata
// nello slot corrente → ogni lunedì piano sostituito da quello della settimana
// dopo) e A3 (marker data scritto PRIMA della chiamata LLM → un errore
// consumava il giorno). Entrambi fixati in Fase 1: ora la regen va in
// `training-plan-next` quando il piano corrente è attivo (stesso routing del
// path manuale) e il marker è scritto solo dopo il successo del report.

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
/** Lunedì (locale) della settimana corrente — usato per il realign C2 slot-corrente. */
function currentMonday(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
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

  it("FIX C2: con piano corrente attivo, la regen next-week va in anteprima (training-plan-next)", async () => {
    const current = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    seed("user-profile", minimalProfile());
    seed("training-plan", current);

    await maybeRunWeeklyReport();

    // Il piano corrente resta attivo: la nuova settimana è in anteprima e
    // verrà promossa da maybePromoteNextPlan al lunedì.
    expect(readJSON<TrainingPlan>("training-plan")?.generatedAt).toBe(current.generatedAt);
    const next = readJSON<TrainingPlan>("training-plan-next")!;
    expect(next.rationale).toBe("piano settimana prossima");
    expect(next.startDate).toBe(localDate(7));
    expect(readJSON<TrainingPlan[]>("plan-history")).toBeNull();
  });

  it("FIX C2: senza piano corrente, la regen va nello slot corrente con startDate = lunedì corrente", async () => {
    seed("user-profile", minimalProfile());

    await maybeRunWeeklyReport();

    const plan = readJSON<TrainingPlan>("training-plan")!;
    expect(plan.rationale).toBe("piano settimana prossima");
    // Realign C2: lo slot corrente non contiene mai un piano datato alla
    // settimana prossima (il mock genera startDate +7, lo scheduler lo riancora
    // a questo lunedì → todayPlanWeekNumber=1, riga OGGI presente).
    expect(plan.startDate).toBe(currentMonday());
    expect(readJSON<TrainingPlan>("training-plan-next")).toBeNull();
  });

  it("FIX C2: con piano corrente STALE (>7gg), la regen sostituisce lo slot corrente", async () => {
    const stale = makePlan({
      generatedAt: "2026-01-01T00:00:00.000Z",
      startDate: localDate(-10),
      validUntil: new Date(Date.now() + 86400000).toISOString(), // ancora "attivo" ma vecchio
    });
    seed("user-profile", minimalProfile());
    seed("training-plan", stale);

    await maybeRunWeeklyReport();

    const plan = readJSON<TrainingPlan>("training-plan")!;
    expect(plan.rationale).toBe("piano settimana prossima");
    expect(plan.startDate).toBe(currentMonday()); // realign C2 anche per piano stale
    expect(readJSON<TrainingPlan>("training-plan-next")).toBeNull();
  });

  it("FIX A3: se l'LLM fallisce, il giorno NON è consumato (retry al prossimo mount)", async () => {
    seed("user-profile", minimalProfile());
    mockGenerateWeeklyReport.mockRejectedValue(new Error("503 model overloaded"));

    await expect(maybeRunWeeklyReport()).rejects.toThrow("503");

    // Il marker non è scritto: al prossimo mount il report riparte.
    expect(localStorage.getItem("last-weekly-report-date")).toBeNull();
    expect(readJSON<unknown[]>("coach-feed")).toBeNull();
    // Lock comunque rilasciato (finally).
    expect(localStorage.getItem("weekly-report-running")).toBeNull();

    // Retry: il secondo run (LLM tornato su) completa normalmente.
    mockGenerateWeeklyReport.mockResolvedValue(fakeReport());
    const item = await maybeRunWeeklyReport();
    expect(item?.type).toBe("weekly-report");
    expect(localStorage.getItem("last-weekly-report-date")).toBe(JSON.stringify(localDate(0)));
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

  it("FIX A3-bis: errore nella sola regen — report pubblicato, piano vecchio resta, ALERT nel feed", async () => {
    const current = makePlan({ generatedAt: "2026-01-01T00:00:00.000Z" });
    seed("user-profile", minimalProfile());
    seed("training-plan", current);
    mockRegenerateNextWeek.mockRejectedValue(new Error("LLM down"));

    const item = await maybeRunWeeklyReport();

    expect(item?.type).toBe("weekly-report");
    expect(readJSON<TrainingPlan>("training-plan")?.generatedAt).toBe(current.generatedAt);
    // Fase 0 pinnava l'errore swallowed (solo console.error); dal fix A3-bis
    // il fallimento della regen produce un item "alert" visibile nel feed.
    const feed = readJSON<Array<{ type: string }>>("coach-feed")!;
    expect(feed.map(f => f.type)).toEqual(["alert", "weekly-report"]);
  });
});
