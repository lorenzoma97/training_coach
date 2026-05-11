// Wave 3.4 — Smoke + unit test per MobilityRoutineGuide.
// Pattern test puro Node (no React DOM): smoke import + pure helper exports.
//
// Cosa testiamo:
//  - smoke import del componente (no crash a load-time)
//  - nextStepIndex: avanza di 1 fino a totalSteps (sentinel completion)
//  - nextStepIndex: cap superiore = totalSteps (no overflow)
//  - prevStepIndex: torna di 1
//  - prevStepIndex: step 0 + back → no-op (cap inferiore)
//  - formatCountdown: formattazione MM:SS standard
//  - formatCountdown: clamp a 00:00 per valori negativi

import { describe, it, expect } from "vitest";
import MobilityRoutineGuide, {
  nextStepIndex,
  prevStepIndex,
  formatCountdown,
} from "../MobilityRoutineGuide";

// ─── Smoke ──────────────────────────────────────────────────────────────────
describe("MobilityRoutineGuide (smoke)", () => {
  it("imports without throwing", () => {
    expect(MobilityRoutineGuide).toBeDefined();
    expect(typeof MobilityRoutineGuide).toBe("function");
  });
});

// ─── nextStepIndex ──────────────────────────────────────────────────────────
describe("nextStepIndex", () => {
  it("avanza di 1 step normalmente", () => {
    expect(nextStepIndex(0, 5)).toBe(1);
    expect(nextStepIndex(2, 5)).toBe(3);
    expect(nextStepIndex(3, 5)).toBe(4);
  });

  it("step finale + next → totalSteps (sentinel completion)", () => {
    // step 4 di 5 (idx 0-based, ultimo step = 4) → next = 5 (= totalSteps = completed)
    expect(nextStepIndex(4, 5)).toBe(5);
  });

  it("cap superiore: idx == totalSteps → resta a totalSteps (no overflow)", () => {
    expect(nextStepIndex(5, 5)).toBe(5);
    expect(nextStepIndex(10, 5)).toBe(5); // anche oltre, clamp a totalSteps
  });

  it("totalSteps = 1 (routine single-step) → 0 → 1 (completed)", () => {
    expect(nextStepIndex(0, 1)).toBe(1);
    expect(nextStepIndex(1, 1)).toBe(1); // già completed, no-op
  });
});

// ─── prevStepIndex ──────────────────────────────────────────────────────────
describe("prevStepIndex", () => {
  it("torna di 1 step normalmente", () => {
    expect(prevStepIndex(3)).toBe(2);
    expect(prevStepIndex(2)).toBe(1);
    expect(prevStepIndex(1)).toBe(0);
  });

  it("step 0 + back → 0 (cap inferiore, no-op)", () => {
    expect(prevStepIndex(0)).toBe(0);
  });

  it("valori negativi (anomali) → 0 (clamp)", () => {
    expect(prevStepIndex(-1)).toBe(0);
    expect(prevStepIndex(-10)).toBe(0);
  });

  it("composizione next + prev = identity (mid-range)", () => {
    const total = 8;
    let idx = 3;
    idx = nextStepIndex(idx, total); // 4
    idx = prevStepIndex(idx);        // 3
    expect(idx).toBe(3);
  });

  it("composizione: 0 + back + back = 0 (resta saldo al cap)", () => {
    let idx = 0;
    idx = prevStepIndex(idx);
    idx = prevStepIndex(idx);
    expect(idx).toBe(0);
  });
});

// ─── formatCountdown ────────────────────────────────────────────────────────
describe("formatCountdown", () => {
  it("formatta secondi in MM:SS con zero-padding", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(5)).toBe("00:05");
    expect(formatCountdown(45)).toBe("00:45");
    expect(formatCountdown(60)).toBe("01:00");
    expect(formatCountdown(125)).toBe("02:05");
    expect(formatCountdown(599)).toBe("09:59");
  });

  it("clamp a 00:00 per valori negativi", () => {
    expect(formatCountdown(-1)).toBe("00:00");
    expect(formatCountdown(-100)).toBe("00:00");
  });

  it("durate lunghe (>10 min) non causano regressioni", () => {
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(1200)).toBe("20:00");
    expect(formatCountdown(1234)).toBe("20:34");
  });
});
