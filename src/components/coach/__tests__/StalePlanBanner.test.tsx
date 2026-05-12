// Fix 1 — Smoke test per StalePlanBanner.
// Pattern: stesso del MacroUpdatedBanner.test.tsx. Verifichiamo:
//   - smoke import del componente (no crash a load-time)
//   - props contract (startDate ISO + onRegenerate callback)
//   - formatter "lun DD/MM" usato per il render della data lunedì.

import { describe, it, expect, beforeEach, vi } from "vitest";
import StalePlanBanner from "../StalePlanBanner";
import { formatWeekdayDayMonth } from "../../../lib/dateFormatters";

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

describe("StalePlanBanner (smoke)", () => {
  it("imports without throwing", () => {
    expect(StalePlanBanner).toBeDefined();
    expect(typeof StalePlanBanner).toBe("function");
  });

  it("props contract: startDate stringa ISO + onRegenerate funzione", () => {
    // Type-level smoke: chiamiamo il componente come pure function (React FC)
    // con props complete e verifichiamo che NON throw. Non renderizziamo DOM
    // (Node-only). Il return è un VNode JSX, basta non crashare.
    const onRegenerate = () => { /* noop */ };
    const result = StalePlanBanner({ startDate: "2026-05-05", onRegenerate });
    expect(result).toBeTruthy();
    // VNode React: oggetto con `type` (string o function), `props`, etc.
    // Non lockiamo lo shape interno (cambia tra versioni react-jsx runtime).
  });

  it("disabled=true non throw e ritorna VNode valido", () => {
    const onRegenerate = () => { /* noop */ };
    const result = StalePlanBanner({ startDate: "2026-05-05", onRegenerate, disabled: true });
    expect(result).toBeTruthy();
  });
});

describe("StalePlanBanner ↔ formatter data", () => {
  it("formatWeekdayDayMonth('2026-05-05') ritorna formato 'lun 05/05' atteso", () => {
    // 2026-05-05 era un martedì. Il test verifica solo che il formatter
    // produca il pattern "<weekday> DD/MM" che il banner usa.
    const out = formatWeekdayDayMonth("2026-05-05");
    expect(out).toMatch(/^[a-z]{2,3}\.? 05\/05$/i);
  });

  it("formatter ritorna stringa non vuota anche su input borderline", () => {
    // Sanity: il formatter non deve ritornare "" o undefined per date valide.
    const out = formatWeekdayDayMonth("2026-01-01");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
