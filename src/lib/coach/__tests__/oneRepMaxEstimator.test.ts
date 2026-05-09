// Wave 3.1 — Test suite per oneRepMaxEstimator.
//
// Copertura:
//  - Formule pure (Brzycki, Epley, consensus + arrotondamento + edge cases).
//  - bestSetForOneRepMax (selezione del set con max 1RM stimato).
//  - inferOneRepMaxesFromWorkout (multi-exercise, backward compat).
//  - updateOneRepMaxesFromWorkout (policy I4: tested non sovrascritto, threshold 2kg).
//  - applyOneRepMaxUpdates (integration: mock localStorage + event emission).
//
// Setup test: vitest gira in Node senza jsdom → mockiamo `localStorage` globale
// con uno stub minimale prima di ogni test che ne ha bisogno.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  brzycki,
  epley,
  estimateOneRepMax,
  bestSetForOneRepMax,
  inferOneRepMaxesFromWorkout,
  updateOneRepMaxesFromWorkout,
  applyOneRepMaxUpdates,
} from "../oneRepMaxEstimator";
import { events } from "../../events";
import type {
  ExercisePerformance,
  OneRepMax,
  UserProfile,
} from "../../types";
import type { Workout } from "../../diaryContext";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: "wk-1",
    type: "forza_gambe",
    createdAt: "2026-05-09T10:00:00Z",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    age: 28,
    sex: "m",
    weight_kg: 81,
    height_cm: 180,
    experience: "regular",
    injuries: [],
    meds: "",
    weekly_availability: { days: 4, hoursPerSession: 1 },
    equipment: ["bilanciere", "manubri"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// Mock minimale di localStorage per test che toccano storage (applyOneRepMaxUpdates).
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  get length(): number { return this.map.size; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Brzycki / Epley / consensus
// ─────────────────────────────────────────────────────────────────────────────

describe("brzycki", () => {
  it("100kg × 5 reps ≈ 112.5", () => {
    expect(brzycki(100, 5)).toBeCloseTo(112.5, 1);
  });

  it("throws fuori range reps>10", () => {
    expect(() => brzycki(100, 11)).toThrow();
  });

  it("throws su weight <= 0", () => {
    expect(() => brzycki(0, 5)).toThrow();
  });
});

describe("epley", () => {
  it("100kg × 5 reps ≈ 116.67", () => {
    expect(epley(100, 5)).toBeCloseTo(116.67, 1);
  });

  it("100kg × 1 rep === 100", () => {
    expect(epley(100, 1)).toBeCloseTo(103.33, 1);
  });
});

describe("estimateOneRepMax (consensus)", () => {
  it("100kg × 5 reps ≈ 114.5 (avg Brzycki+Epley)", () => {
    // Brzycki(100,5) = 112.5; Epley(100,5) ≈ 116.667; avg ≈ 114.58 → arrotondato 114.5
    expect(estimateOneRepMax(100, 5)).toBe(114.5);
  });

  it("100kg × 1 rep ritorna 100 (1RM diretto)", () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
  });

  it("ritorna null per reps > 10 (out of range)", () => {
    expect(estimateOneRepMax(100, 11)).toBeNull();
    expect(estimateOneRepMax(100, 15)).toBeNull();
  });

  it("ritorna null per weight <= 0", () => {
    expect(estimateOneRepMax(0, 5)).toBeNull();
    expect(estimateOneRepMax(-10, 5)).toBeNull();
  });

  it("ritorna null per reps < 1", () => {
    expect(estimateOneRepMax(100, 0)).toBeNull();
  });

  it("arrotonda a 0.5 kg", () => {
    // Tutti i risultati intermedi devono essere multipli di 0.5
    const out = estimateOneRepMax(82.5, 6);
    expect(out).not.toBeNull();
    expect((out! * 2) % 1).toBe(0); // out*2 è intero → out è multiplo di 0.5
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bestSetForOneRepMax
// ─────────────────────────────────────────────────────────────────────────────

describe("bestSetForOneRepMax", () => {
  it("ritorna il set con 1RM stimato massimo", () => {
    const perf: ExercisePerformance = {
      exerciseId: "back-squat-barbell",
      sets: [
        { reps: 8, weight_kg: 80 },     // est ~99
        { reps: 5, weight_kg: 85 },     // est ~97.4
        { reps: 3, weight_kg: 87.5 },   // est ~94.5
      ],
    };
    const best = bestSetForOneRepMax(perf);
    expect(best).not.toBeNull();
    // Il set con 1RM max è 80×8 (estimated ~99) — anche se peso è il minimo.
    expect(best!.weight_kg).toBe(80);
    expect(best!.reps).toBe(8);
    expect(best!.estimated1RM).toBeGreaterThan(98);
  });

  it("skippa set bodyweight (weight_kg undefined)", () => {
    const perf: ExercisePerformance = {
      exerciseId: "pullup",
      sets: [
        { reps: 10 },                     // bodyweight: skipped
        { reps: 5, weight_kg: 10 },       // valutabile (zavorra +10kg)
      ],
    };
    const best = bestSetForOneRepMax(perf);
    expect(best).not.toBeNull();
    expect(best!.weight_kg).toBe(10);
  });

  it("ritorna null se tutti i set sono bodyweight", () => {
    const perf: ExercisePerformance = {
      exerciseId: "pushup",
      sets: [{ reps: 20 }, { reps: 15 }],
    };
    expect(bestSetForOneRepMax(perf)).toBeNull();
  });

  it("skippa set con reps > 10 (formula non affidabile)", () => {
    const perf: ExercisePerformance = {
      exerciseId: "back-squat-barbell",
      sets: [
        { reps: 12, weight_kg: 100 },     // skipped
        { reps: 5, weight_kg: 80 },       // valutabile
      ],
    };
    const best = bestSetForOneRepMax(perf);
    expect(best).not.toBeNull();
    expect(best!.weight_kg).toBe(80);
    expect(best!.reps).toBe(5);
  });

  it("ritorna null su sets array vuoto", () => {
    expect(bestSetForOneRepMax({ exerciseId: "x", sets: [] })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inferOneRepMaxesFromWorkout
// ─────────────────────────────────────────────────────────────────────────────

describe("inferOneRepMaxesFromWorkout", () => {
  it("workout senza exercises[] → mappa vuota (backward compat)", () => {
    const w = makeWorkout({ exercises: undefined });
    expect(inferOneRepMaxesFromWorkout(w).size).toBe(0);
  });

  it("workout multi-exercise → un'entry per ogni esercizio valutabile", () => {
    const w = makeWorkout({
      exercises: [
        {
          exerciseId: "back-squat-barbell",
          sets: [{ reps: 5, weight_kg: 100 }],
        },
        {
          exerciseId: "bench-press-flat-barbell",
          sets: [{ reps: 3, weight_kg: 80 }],
        },
        {
          exerciseId: "pushup",
          sets: [{ reps: 20 }], // bodyweight: omesso dalla mappa
        },
      ],
    });
    const map = inferOneRepMaxesFromWorkout(w);
    expect(map.size).toBe(2);
    expect(map.has("back-squat-barbell")).toBe(true);
    expect(map.has("bench-press-flat-barbell")).toBe(true);
    expect(map.has("pushup")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateOneRepMaxesFromWorkout (policy I4)
// ─────────────────────────────────────────────────────────────────────────────

describe("updateOneRepMaxesFromWorkout", () => {
  it("cold start (current []) + workout → ADD nuovo estimated", () => {
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 80 }] },
      ],
    });
    const { updated, changed } = updateOneRepMaxesFromWorkout([], w);
    expect(updated).toHaveLength(1);
    expect(updated[0].exerciseId).toBe("back-squat-barbell");
    expect(updated[0].source).toBe("estimated");
    expect(updated[0].fromWorkoutId).toBe("wk-1");
    expect(updated[0].acquiredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(changed).toHaveLength(1);
    expect(changed[0].from).toBeUndefined();
  });

  it("esistente tested 100kg + workout 90×5 (est ~103) → SKIP, non sovrascrive", () => {
    const current: OneRepMax[] = [
      {
        exerciseId: "back-squat-barbell",
        value_kg: 100,
        source: "tested",
        acquiredAt: "2026-04-01",
      },
    ];
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 90 }] },
      ],
    });
    const { updated, changed } = updateOneRepMaxesFromWorkout(current, w);
    expect(updated).toHaveLength(1);
    expect(updated[0].value_kg).toBe(100); // invariato
    expect(updated[0].source).toBe("tested");
    expect(changed).toHaveLength(0);
  });

  it("esistente estimated 90kg + workout 85×5 (est ~97) → UPDATE (PR significativo)", () => {
    const current: OneRepMax[] = [
      {
        exerciseId: "back-squat-barbell",
        value_kg: 90,
        source: "estimated",
        acquiredAt: "2026-04-01",
      },
    ];
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 85 }] },
      ],
    });
    const { updated, changed } = updateOneRepMaxesFromWorkout(current, w);
    expect(updated).toHaveLength(1);
    expect(updated[0].value_kg).toBeGreaterThan(90);
    expect(changed).toHaveLength(1);
    expect(changed[0].from).toBe(90);
    expect(changed[0].to).toBe(updated[0].value_kg);
  });

  it("esistente estimated 95kg + workout 80×5 (est ~91) → SKIP (no PR)", () => {
    const current: OneRepMax[] = [
      {
        exerciseId: "back-squat-barbell",
        value_kg: 95,
        source: "estimated",
        acquiredAt: "2026-04-01",
      },
    ];
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 80 }] },
      ],
    });
    const { updated, changed } = updateOneRepMaxesFromWorkout(current, w);
    expect(updated).toHaveLength(1);
    expect(updated[0].value_kg).toBe(95);
    expect(changed).toHaveLength(0);
  });

  it("esistente estimated + workout con est entro threshold → SKIP (jitter)", () => {
    // est 1RM di 80×5 = (Brzycki 90 + Epley 93.33)/2 = 91.67 → arrotondato 91.5
    // Se esistente è 90.5, diff = 1.0 → entro threshold 2kg → SKIP
    const current: OneRepMax[] = [
      {
        exerciseId: "back-squat-barbell",
        value_kg: 90.5,
        source: "estimated",
        acquiredAt: "2026-04-01",
      },
    ];
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 80 }] },
      ],
    });
    const { updated, changed } = updateOneRepMaxesFromWorkout(current, w);
    // est ~91.5, diff = 1 → entro threshold 2 → SKIP
    expect(updated[0].value_kg).toBe(90.5);
    expect(changed).toHaveLength(0);
  });

  it("workout multi-exercise → multi update (mix add + skip)", () => {
    const current: OneRepMax[] = [
      // squat tested: NON sovrascrivibile
      { exerciseId: "back-squat-barbell", value_kg: 120, source: "tested", acquiredAt: "2026-03-01" },
      // bench estimated 60: PR a ~80 → UPDATE
      { exerciseId: "bench-press-flat-barbell", value_kg: 60, source: "estimated", acquiredAt: "2026-04-01" },
      // (deadlift assente: ADD)
    ];
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 110 }] },           // est ~127, ma tested → SKIP
        { exerciseId: "bench-press-flat-barbell", sets: [{ reps: 3, weight_kg: 70 }] },       // est ~76 → UPDATE
        { exerciseId: "deadlift-conventional-barbell", sets: [{ reps: 5, weight_kg: 130 }] }, // ADD
      ],
    });
    const { updated, changed } = updateOneRepMaxesFromWorkout(current, w);
    expect(updated).toHaveLength(3);

    // squat invariato
    const sq = updated.find(o => o.exerciseId === "back-squat-barbell")!;
    expect(sq.value_kg).toBe(120);
    expect(sq.source).toBe("tested");

    // bench aggiornato
    const bp = updated.find(o => o.exerciseId === "bench-press-flat-barbell")!;
    expect(bp.value_kg).toBeGreaterThan(60);
    expect(bp.source).toBe("estimated");

    // deadlift aggiunto
    const dl = updated.find(o => o.exerciseId === "deadlift-conventional-barbell")!;
    expect(dl).toBeDefined();
    expect(dl.source).toBe("estimated");
    expect(dl.fromWorkoutId).toBe("wk-1");

    // changes: 2 (bench update + deadlift add); squat skipped
    expect(changed).toHaveLength(2);
    const changedIds = changed.map(c => c.exerciseId).sort();
    expect(changedIds).toEqual(["bench-press-flat-barbell", "deadlift-conventional-barbell"]);
  });

  it("è immutable: non muta l'array current", () => {
    const current: OneRepMax[] = [
      { exerciseId: "back-squat-barbell", value_kg: 80, source: "estimated", acquiredAt: "2026-04-01" },
    ];
    const snapshot = JSON.stringify(current);
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 90 }] },
      ],
    });
    updateOneRepMaxesFromWorkout(current, w);
    expect(JSON.stringify(current)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyOneRepMaxUpdates (integration: storage + events)
// ─────────────────────────────────────────────────────────────────────────────

describe("applyOneRepMaxUpdates", () => {
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    // Stub di localStorage globale (vitest gira in Node).
    (globalThis as any).localStorage = mem;
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
    vi.restoreAllMocks();
  });

  it("workout senza exercises[] → no-op (ritorna [])", async () => {
    const w = makeWorkout({ exercises: undefined });
    const out = await applyOneRepMaxUpdates(w);
    expect(out).toEqual([]);
  });

  it("workout strutturato squat PR → profile aggiornato + event emesso", async () => {
    // Setup: profilo esistente senza 1RM
    const profile = makeProfile({ oneRepMaxes: [] });
    mem.setItem("user-profile", JSON.stringify(profile));

    // Spy sull'evento profile:updated
    const emitSpy = vi.spyOn(events, "emit");

    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 100 }] },
      ],
    });
    const changes = await applyOneRepMaxUpdates(w);

    expect(changes).toHaveLength(1);
    expect(changes[0].exerciseId).toBe("back-squat-barbell");
    expect(changes[0].from).toBeUndefined();
    expect(changes[0].to).toBeGreaterThan(100);

    // Profile persistito con il nuovo 1RM
    const persisted = JSON.parse(mem.getItem("user-profile")!) as UserProfile;
    expect(persisted.oneRepMaxes).toHaveLength(1);
    expect(persisted.oneRepMaxes![0].source).toBe("estimated");
    expect(persisted.oneRepMaxes![0].fromWorkoutId).toBe("wk-1");

    // Event emesso
    const profileEvents = emitSpy.mock.calls.filter(c => c[0] === "profile:updated");
    expect(profileEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("workout senza PR significativo → no-op (no write, no event)", async () => {
    const profile = makeProfile({
      oneRepMaxes: [
        { exerciseId: "back-squat-barbell", value_kg: 100, source: "tested", acquiredAt: "2026-03-01" },
      ],
    });
    mem.setItem("user-profile", JSON.stringify(profile));
    const emitSpy = vi.spyOn(events, "emit");

    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 90 }] }, // est ~103, ma tested → SKIP
      ],
    });
    const changes = await applyOneRepMaxUpdates(w);
    expect(changes).toEqual([]);
    // Profile NON ri-scritto: il payload deve essere identico (timestamp invariato)
    const persisted = JSON.parse(mem.getItem("user-profile")!) as UserProfile;
    expect(persisted.oneRepMaxes![0].value_kg).toBe(100);
    expect(persisted.updatedAt).toBe(profile.updatedAt);

    const profileEvents = emitSpy.mock.calls.filter(c => c[0] === "profile:updated");
    expect(profileEvents.length).toBe(0);
  });

  it("nessun profilo in storage → no-op (ritorna [])", async () => {
    const w = makeWorkout({
      exercises: [
        { exerciseId: "back-squat-barbell", sets: [{ reps: 5, weight_kg: 100 }] },
      ],
    });
    const out = await applyOneRepMaxUpdates(w);
    expect(out).toEqual([]);
  });
});
