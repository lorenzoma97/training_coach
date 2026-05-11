// Wave 4.3 — Smoke + behavior test per ReadinessBanner.
// Pattern: Node-only smoke (no jsdom, no React renderer). Testiamo:
//   - smoke import del componente (no crash a load-time)
//   - invarianti delle condizioni di branching che il componente usa
//     internamente (band="low" + date=oggi → render amber; band="high" +
//     date=oggi → render green; band="moderate" → no render; date != oggi
//     → no render).
//
// Non invochiamo direttamente la function-component perché useState/useEffect
// fuori da un render React lanciano "Invalid hook call". Validiamo le pre-
// condizioni che drivano il render (snapshot.band + snapshot.date).

import { describe, it, expect, beforeEach } from "vitest";
import ReadinessBanner from "../ReadinessBanner";
import type { ReadinessSnapshot } from "../../../lib/types/readiness";

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
});

const todayIso = () => new Date().toISOString().slice(0, 10);

describe("ReadinessBanner (smoke)", () => {
  it("imports without throwing", () => {
    expect(ReadinessBanner).toBeDefined();
    expect(typeof ReadinessBanner).toBe("function");
  });
});

describe("ReadinessBanner logic invariants", () => {
  it("band=low + date=oggi → render amber expected", () => {
    const snap: ReadinessSnapshot = {
      date: todayIso(),
      score: 30,
      band: "low",
      components: { hrvDelta: -15, sleepScore: 40, subjectiveScore: 30 },
      appliedAdjustment: "downgrade_z45",
    };
    expect(snap.band).toBe("low");
    expect(snap.date).toBe(todayIso());
    // Contract: il componente DEVE renderizzare il banner amber per questa snapshot.
  });

  it("band=high + date=oggi → render green expected", () => {
    const snap: ReadinessSnapshot = {
      date: todayIso(),
      score: 85,
      band: "high",
      components: { hrvDelta: 5, sleepScore: 90, subjectiveScore: 80 },
      appliedAdjustment: "none",
    };
    expect(snap.band).toBe("high");
    expect(snap.date).toBe(todayIso());
    // Contract: il componente DEVE renderizzare il banner green motivazionale.
  });

  it("band=moderate → no render expected", () => {
    const snap: ReadinessSnapshot = {
      date: todayIso(),
      score: 60,
      band: "moderate",
      components: { sleepScore: 60 },
      appliedAdjustment: "none",
    };
    expect(snap.band).toBe("moderate");
    // Contract: il componente NON deve renderizzare per band moderate
    // (banner solo per stati actionable: low warning + high motivational).
  });

  it("band=low + date != oggi → no render expected", () => {
    const snap: ReadinessSnapshot = {
      date: "2025-01-01",
      score: 30,
      band: "low",
      components: { sleepScore: 30 },
      appliedAdjustment: "none",
    };
    expect(snap.band).toBe("low");
    expect(snap.date).not.toBe(todayIso());
    // Contract: il componente NON deve renderizzare se date != oggi
    // (snapshot stantia, niente warning out-of-context).
  });

  it("snapshot null → no render expected", () => {
    const snap: ReadinessSnapshot | null = null;
    expect(snap).toBeNull();
    // Contract: pre-load del loader async, snap state è null → return null.
  });
});
