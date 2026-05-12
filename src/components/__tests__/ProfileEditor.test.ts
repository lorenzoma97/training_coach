// UX redesign — smoke che ProfileEditor continua a renderizzare senza throw
// dopo la riorganizzazione in accordion <details>. Pattern coerente con
// SettingsPage.test.ts (no RTL/jsdom render, solo verifica del modulo).

import { describe, it, expect } from "vitest";
import ProfileEditor from "../ProfileEditor";

describe("ProfileEditor (smoke)", () => {
  it("imports without throwing", () => {
    expect(ProfileEditor).toBeDefined();
    expect(typeof ProfileEditor).toBe("function");
  });
});
