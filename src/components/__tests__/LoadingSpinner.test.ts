// Smoke test per LoadingSpinner.
// Pattern coerente con ProfileEditor.test.ts: solo verifica del modulo
// (no RTL/jsdom render), garantisce import sano e contract della funzione.

import { describe, it, expect } from "vitest";
import LoadingSpinner from "../LoadingSpinner";

describe("LoadingSpinner (smoke)", () => {
  it("imports without throwing", () => {
    expect(LoadingSpinner).toBeDefined();
    expect(typeof LoadingSpinner).toBe("function");
  });
});
