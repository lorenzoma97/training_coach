// Smoke test per EmptyState.
// Pattern coerente con ProfileEditor.test.ts: solo verifica del modulo
// (no RTL/jsdom render), garantisce import sano e contract della funzione.

import { describe, it, expect } from "vitest";
import EmptyState from "../EmptyState";

describe("EmptyState (smoke)", () => {
  it("imports without throwing", () => {
    expect(EmptyState).toBeDefined();
    expect(typeof EmptyState).toBe("function");
  });
});
