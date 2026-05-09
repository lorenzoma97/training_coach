import { describe, it, expect } from "vitest";
import { WearableSampleSchema } from "../../schemas/wearable";
import type { WearableSample } from "../wearable";

/**
 * Helper di test che simula l'algoritmo dedupKey documentato nel design doc:
 *   sha1(date_iso_minute|mappedType|round(duration_min/2)*2)
 * Qui usiamo una versione semplificata per test (no crypto): la chiave
 * deve essere deterministica per gli stessi input e variare per durate
 * differenti oltre la soglia di 2 minuti.
 */
function computeDedupKey(startedAt: string, mappedType: string, duration_min: number): string {
  const isoMinute = startedAt.slice(0, 16); // YYYY-MM-DDTHH:MM
  const roundedDur = Math.round(duration_min / 2) * 2;
  return `${isoMinute}|${mappedType}|${roundedDur}`;
}

describe("WearableSampleSchema", () => {
  it("accepts a complete Samsung Health running sample", () => {
    const s: WearableSample = {
      source: "samsung_health",
      startedAt: "2026-05-08T07:00:00Z",
      duration_min: 45,
      rawType: "Running",
      mappedType: "corsa",
      dedupKey: "abc123",
      hrAvg: 145,
      hrMax: 168,
      distance_km: 8.5,
      calories: 480,
      matchedWorkoutId: null,
    };
    expect(WearableSampleSchema.safeParse(s).success).toBe(true);
  });

  it("accepts a manual sample without optional metrics", () => {
    const s: WearableSample = {
      source: "manual",
      startedAt: "2026-05-08T07:00:00Z",
      duration_min: 30,
      rawType: "Custom",
      mappedType: "forza_upper",
      dedupKey: "x",
    };
    expect(WearableSampleSchema.safeParse(s).success).toBe(true);
  });

  it("rejects HR outside physiological range", () => {
    const s = {
      source: "samsung_health" as const,
      startedAt: "2026-05-08T07:00:00Z",
      duration_min: 30,
      rawType: "X",
      mappedType: "corsa" as const,
      dedupKey: "k",
      hrAvg: 250, // > 230
    };
    expect(WearableSampleSchema.safeParse(s).success).toBe(false);
  });

  it("rejects duration_min = 0", () => {
    const s = {
      source: "samsung_health" as const,
      startedAt: "2026-05-08T07:00:00Z",
      duration_min: 0,
      rawType: "X",
      mappedType: "corsa" as const,
      dedupKey: "k",
    };
    expect(WearableSampleSchema.safeParse(s).success).toBe(false);
  });
});

describe("WearableSample dedupKey computation", () => {
  it("produces identical key for identical inputs", () => {
    const k1 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 45);
    const k2 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 45);
    expect(k1).toBe(k2);
  });

  it("rounds duration to nearest 2-min bucket (45 ≈ 46)", () => {
    // Round(45/2)*2 = 23*2 = 46
    // Round(46/2)*2 = 23*2 = 46
    const k1 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 45);
    const k2 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 46);
    expect(k1).toBe(k2);
  });

  it("produces different keys for sufficiently different durations", () => {
    const k1 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 45);
    const k2 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 50);
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different mappedType", () => {
    const k1 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 45);
    const k2 = computeDedupKey("2026-05-08T07:00:00Z", "sport", 45);
    expect(k1).not.toBe(k2);
  });

  it("ignores seconds in startedAt (granularità minuto)", () => {
    const k1 = computeDedupKey("2026-05-08T07:00:00Z", "corsa", 45);
    const k2 = computeDedupKey("2026-05-08T07:00:30Z", "corsa", 45);
    expect(k1).toBe(k2);
  });
});
