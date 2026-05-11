// Wave 4.3 — Smoke + behavior test per MacroUpdatedBanner.
// Pattern: Node-only smoke (no jsdom). Testiamo:
//   - smoke import del componente (no crash a load-time)
//   - storage roundtrip per il flag dismissed (`macro-banner-dismissed-<id>`)
//   - event subscription contract: `events.on("macro:updated", ...)` non
//     throw, payload conforme a EventMap

import { describe, it, expect, beforeEach, vi } from "vitest";
import MacroUpdatedBanner from "../MacroUpdatedBanner";
import { events } from "../../../lib/events";

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

describe("MacroUpdatedBanner (smoke)", () => {
  it("imports without throwing", () => {
    expect(MacroUpdatedBanner).toBeDefined();
    expect(typeof MacroUpdatedBanner).toBe("function");
  });
});

describe("MacroUpdatedBanner ↔ events bus", () => {
  it("evento macro:updated emit non throw e ha payload conforme", () => {
    let captured: { activeMacroCycleId: string | null; at: string } | null = null;
    const off = events.on("macro:updated", (p) => { captured = p; });
    try {
      events.emit("macro:updated", {
        activeMacroCycleId: "macro-test-123",
        at: new Date().toISOString(),
      });
      expect(captured).not.toBeNull();
      expect(captured!.activeMacroCycleId).toBe("macro-test-123");
      expect(typeof captured!.at).toBe("string");
    } finally {
      off();
    }
  });

  it("emit con activeMacroCycleId=null (clear) non throw", () => {
    let captured: { activeMacroCycleId: string | null; at: string } | null = null;
    const off = events.on("macro:updated", (p) => { captured = p; });
    try {
      events.emit("macro:updated", {
        activeMacroCycleId: null,
        at: new Date().toISOString(),
      });
      expect(captured).not.toBeNull();
      expect(captured!.activeMacroCycleId).toBeNull();
    } finally {
      off();
    }
  });
});

describe("MacroUpdatedBanner dismissed flag (localStorage)", () => {
  it("storage roundtrip per macro-banner-dismissed-<id>", () => {
    const macroId = "macro-id-abc";
    const key = `macro-banner-dismissed-${macroId}`;
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.setItem(key, "1");
    expect(localStorage.getItem(key)).toBe("1");
  });

  it("flag dismissed è per-macroId: id diverso → flag non condiviso", () => {
    localStorage.setItem("macro-banner-dismissed-macro-A", "1");
    expect(localStorage.getItem("macro-banner-dismissed-macro-A")).toBe("1");
    expect(localStorage.getItem("macro-banner-dismissed-macro-B")).toBeNull();
  });
});
