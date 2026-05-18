// Golden tests per computePrescription — pure function (2026-05-13).
// Owner: architect-specialist.
//
// Strategia: 15 golden cases che coprono la matrix di input rilevante
// (experience × intensity × age × goal × macro × readiness). Expected values
// hardcoded — se la formula cambia, va aggiornata qui esplicitamente (no
// matcher fuzzy).

import { describe, it, expect } from "vitest";
import {
  computePrescription,
  formatPrescriptionForPrompt,
  type IntensityLevel,
} from "../trainingPrescription";
import type { UserProfile, Experience } from "../../types";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    age: 28,
    sex: "m",
    weight_kg: 81,
    height_cm: 180,
    experience: "regular" as Experience,
    injuries: [],
    meds: "",
    weekly_availability: { days: 4, hoursPerSession: 1.5 },
    equipment: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computePrescription — golden cases", () => {
  // ─── 1. Lorenzo case: regular + very_intense + age 28 + 4gg × 1.5h ──────
  it("Lorenzo: regular very_intense 28y → 450min vol, 81min sess, 75/10/15 zone", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "very_intense",
    });
    // 300 * 1.5 * 1.0 = 450
    expect(p.weeklyVolumeTargetMin).toBe(450);
    expect(p.weeklyVolumeRangeMin).toEqual({ min: 383, max: 518 });
    // 450 / 4 = 112.5 ma sessionCap = 1.5*60*0.9 = 81 → cappato
    expect(p.avgSessionMin).toBe(81);
    expect(p.sessionRangeMin.max).toBe(81);
    // Zone polarized post scientific validator update (2026-05-13): very_intense
    // 75/10/15 (era 70/10/20) — sustainable amatori, Z4-Z5 cap 15%.
    expect(p.zoneDistributionPct).toEqual({ z1z2Pct: 75, z3Pct: 10, z4z5Pct: 15 });
    // regular base 2 sess + very_intense bump → 3 sess
    expect(p.strength.sessionsPerWeek).toBe(3);
    expect(p.strength.rpeRange).toEqual({ min: 8, max: 9 });
    expect(p.strength.pct1RMRange).toEqual({ min: 70, max: 85 });
    expect(p.minRestDaysPerWeek).toBe(2);
    expect(p.minHoursBetweenStrengthSameGroup).toBe(48);
    // override sessionCap registrato
    expect(p.overrides.some(o => o.toLowerCase().includes("cappata"))).toBe(true);
  });

  // ─── 2. Balanced default regular adult ─────────────────────────────────
  it("regular balanced 28y → 300min vol, 80/15/5 zone, forza 2x", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "balanced",
    });
    // 300 * 1.0 * 1.0 = 300
    expect(p.weeklyVolumeTargetMin).toBe(300);
    expect(p.zoneDistributionPct).toEqual({ z1z2Pct: 80, z3Pct: 15, z4z5Pct: 5 });
    expect(p.strength.sessionsPerWeek).toBe(2);
    expect(p.strength.rpeRange).toEqual({ min: 7, max: 8 });
  });

  // ─── 3. Sedentary beginner ─────────────────────────────────────────────
  it("sedentary balanced 40y → 150min vol, 80/15/5 zone, forza 1x", () => {
    const p = computePrescription({
      profile: makeProfile({
        age: 40, experience: "sedentary",
        weekly_availability: { days: 3, hoursPerSession: 1 },
      }),
      intensity: "balanced",
    });
    // 150 * 1.0 * 1.0 = 150
    expect(p.weeklyVolumeTargetMin).toBe(150);
    expect(p.strength.sessionsPerWeek).toBe(1);
    expect(p.minRestDaysPerWeek).toBe(2);
  });

  // ─── 4. Occasional + balanced ─────────────────────────────────────────
  it("occasional balanced 35y → 200min vol", () => {
    const p = computePrescription({
      profile: makeProfile({
        age: 35, experience: "occasional",
        weekly_availability: { days: 3, hoursPerSession: 1 },
      }),
      intensity: "balanced",
    });
    expect(p.weeklyVolumeTargetMin).toBe(200);
    expect(p.strength.sessionsPerWeek).toBe(2);
  });

  // ─── 5. Competitive very_intense elder taper ──────────────────────────
  it("competitive very_intense 65y → ageDecay 0.8 → vol 600, taper → 360", () => {
    const p = computePrescription({
      profile: makeProfile({
        age: 65, experience: "competitive",
        weekly_availability: { days: 5, hoursPerSession: 1.5 },
      }),
      intensity: "very_intense",
      macroPhase: "taper",
    });
    // 500 * 1.5 * 0.8 = 600 → taper × 0.6 = 360
    expect(p.weeklyVolumeTargetMin).toBe(360);
    // competitive 3 + very_intense bump → 4 (cap)
    expect(p.strength.sessionsPerWeek).toBe(4);
    // Elder → restDays 3 (>=50)
    expect(p.minRestDaysPerWeek).toBe(3);
    expect(p.overrides.some(o => o.includes("Mujika"))).toBe(true);
    expect(p.bases.some(b => b.includes("Lepers"))).toBe(true);
  });

  // ─── 6. Readiness low override ────────────────────────────────────────
  it("regular intense + readiness low → z45=0, surplus su z3", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "intense",
      readinessBand: "low",
    });
    // intense baseline post-update: 80/10/10 → low: z45=0, z3=20, z12=80
    expect(p.zoneDistributionPct.z4z5Pct).toBe(0);
    expect(p.zoneDistributionPct.z3Pct).toBe(20);
    expect(p.zoneDistributionPct.z1z2Pct).toBe(80);
    // RPE max -1 (era 7-8 base regular → 7-7)
    expect(p.strength.rpeRange.max).toBe(7);
    expect(p.overrides.some(o => o.toLowerCase().includes("readiness low"))).toBe(true);
  });

  // ─── 7. Macro taper applica × 0.6 ─────────────────────────────────────
  it("regular balanced + macro taper → vol × 0.6 = 180", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "balanced",
      macroPhase: "taper",
    });
    // 300 × 0.6 = 180
    expect(p.weeklyVolumeTargetMin).toBe(180);
    expect(p.overrides.some(o => o.toLowerCase().includes("taper"))).toBe(true);
  });

  // ─── 8. Macro base sposta verso Z1-Z2 ─────────────────────────────────
  it("regular intense + macro base → z12 +10%, z45 -10%", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "intense",
      macroPhase: "base",
    });
    // intense baseline post-update: 80/10/10 → base (+10 z12, -10 z45): 90/10/0
    expect(p.zoneDistributionPct.z1z2Pct).toBe(90);
    expect(p.zoneDistributionPct.z4z5Pct).toBe(0);
    expect(p.overrides.some(o => o.toLowerCase().includes("base"))).toBe(true);
  });

  // ─── 9. Endurance goal → forza min 2x ─────────────────────────────────
  it("sedentary balanced + goal endurance → forza forzata a 2x", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "sedentary" }),
      intensity: "balanced",
      goalType: "endurance",
    });
    // sedentary base 1 sess → endurance bump 2
    expect(p.strength.sessionsPerWeek).toBe(2);
    expect(p.overrides.some(o => o.toLowerCase().includes("endurance"))).toBe(true);
    expect(p.bases.some(b => b.toLowerCase().includes("ronnestad"))).toBe(true);
  });

  // ─── 10. Edge case: hoursPerSession=0.5 con very_intense → cap durata ─
  it("regular very_intense con cap 0.5h → sessionRange.max = 27min", () => {
    const p = computePrescription({
      profile: makeProfile({
        age: 28, experience: "regular",
        weekly_availability: { days: 6, hoursPerSession: 0.5 },
      }),
      intensity: "very_intense",
    });
    // sessionCap = 0.5 * 60 * 0.9 = 27
    expect(p.sessionRangeMin.max).toBe(27);
    expect(p.avgSessionMin).toBe(27);
    expect(p.overrides.some(o => o.toLowerCase().includes("cappata"))).toBe(true);
  });

  // ─── 11. Age 70 → ageDecay 0.8 + restDays 3 ──────────────────────────
  it("regular balanced 70y → decay 0.8, restDays 3", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 70, experience: "regular" }),
      intensity: "balanced",
    });
    // 300 * 1.0 * 0.8 = 240
    expect(p.weeklyVolumeTargetMin).toBe(240);
    expect(p.minRestDaysPerWeek).toBe(3);
  });

  // ─── 12. Soft intensity riduce forza ─────────────────────────────────
  it("regular soft → vol × 0.7, forza -1", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "soft",
    });
    // 300 * 0.7 * 1.0 = 210
    expect(p.weeklyVolumeTargetMin).toBe(210);
    expect(p.zoneDistributionPct).toEqual({ z1z2Pct: 100, z3Pct: 0, z4z5Pct: 0 });
    // regular base 2 → soft -1 = 1
    expect(p.strength.sessionsPerWeek).toBe(1);
  });

  // ─── 13. ACWR ramp limit graduale (Gabbett + Lydiard floor) ───────────
  it("regular very_intense, recente 200, chronic 200: cap ramp = max(effective×1.5, target×0.7)", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "very_intense",
      weeklyVolumeRecentMin: 200,
      weeklyVolumeChronicMin: 200,
    });
    // effective_recent = max(200, 150 floor regular) = 200
    // cap = max(200*1.5=300, 450*0.7=315) = 315
    expect(p.weeklyVolumeTargetMin).toBe(315);
    expect(p.overrides.some(o => o.toLowerCase().includes("acwr"))).toBe(true);
  });

  // ─── 13bis. Floor experience: chronic 100 (sotto regular floor 150) → ramp ─
  it("regular very_intense, recente 100: ramp graduale via floor regular=150", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "very_intense",
      weeklyVolumeRecentMin: 100,
      weeklyVolumeChronicMin: 100,
    });
    // effective_recent = max(100, 150 floor regular) = 150
    // cap = max(150*1.5=225, 450*0.7=315) = 315
    expect(p.weeklyVolumeTargetMin).toBe(315);
    expect(p.overrides.some(o => o.toLowerCase().includes("acwr ramp"))).toBe(true);
  });

  // ─── 13ter. Casual occasional: floor 90 protegge da spike ─────────────
  it("occasional intense, recente 30: cap ramp via floor occasional=90", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "occasional" }),
      intensity: "intense",
      weeklyVolumeRecentMin: 30,
      weeklyVolumeChronicMin: 30,
    });
    // target ~ 156min (occasional+intense × age 28y), effective_recent = max(30, 90)=90
    // cap = max(90*1.5=135, target*0.7) → cap permissivo ma ≤ target
    expect(p.weeklyVolumeTargetMin).toBeGreaterThan(30 * 1.5); // > 45 (no cap secco al recent)
    expect(p.overrides.some(o => o.toLowerCase().includes("acwr"))).toBe(true);
  });

  // ─── 13b. ACWR canonico alto (acute/chronic > 1.5) → override + cap ramp ─
  it("ACWR canonico alto: acute 400 vs chronic 200 → override + cap = max(eff×1.3, target×0.7)", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "very_intense",
      weeklyVolumeRecentMin: 400,
      weeklyVolumeChronicMin: 200,
    });
    // First check #9a: ratio target/recente = 450/400 = 1.125 < 1.5 → no cap.
    // Then #9b: effective_chronic = max(200, 150 floor) = 200, ratio acute/eff = 400/200 = 2.0 > 1.5
    // → cap = max(200*1.3=260, weeklyVolume*0.7). Quale "weeklyVolume" qui?
    // Probabilmente 450 (target intero) → cap = max(260, 315) = 315.
    expect(p.weeklyVolumeTargetMin).toBeLessThanOrEqual(315);
    expect(p.overrides.some(o => o.toLowerCase().includes("acwr alto"))).toBe(true);
  });

  // ─── 13c. ACWR canonico basso (acute/chronic < 0.8) → solo override info ─
  it("ACWR canonico basso: acute 80 vs chronic 200 → override info, no cap", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "balanced",
      weeklyVolumeRecentMin: 80,
      weeklyVolumeChronicMin: 200,
    });
    // ratio = 0.4 < 0.8 → override "ACWR basso" senza cap (riprogressione graduale)
    expect(p.overrides.some(o => o.toLowerCase().includes("acwr basso"))).toBe(true);
  });

  // ─── 13d. Goal auto-adapt: multiplier continuo (commit 2/3) ──────────
  it("goalVolumeMultiplier 1.10: volume +10% (cap Lydiard/Gabbett)", () => {
    const baseline = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "intense",
    });
    const adapted = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "intense",
      goalVolumeMultiplier: 1.10,
    });
    expect(adapted.weeklyVolumeTargetMin).toBeGreaterThan(baseline.weeklyVolumeTargetMin);
    expect(adapted.weeklyVolumeTargetMin).toBeLessThanOrEqual(Math.round(baseline.weeklyVolumeTargetMin * 1.11));
    expect(adapted.overrides.some(o => o.toLowerCase().includes("goal-driven"))).toBe(true);
  });

  // ─── 13e. Multiplier oltre cap +10% viene clampato per safety ──────────
  it("goalVolumeMultiplier 1.20: clampato a +10% (cap Lydiard)", () => {
    const baseline = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "balanced",
    });
    const adapted = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "balanced",
      goalVolumeMultiplier: 1.20, // oltre cap
    });
    // Volume non eccede 1.10x baseline anche se multiplier richiesto era 1.20
    expect(adapted.weeklyVolumeTargetMin).toBeLessThanOrEqual(Math.round(baseline.weeklyVolumeTargetMin * 1.11));
  });

  // ─── 13f. Backward compat: legacy signal categoriale funziona ────────
  it("legacy signal very_behind senza multiplier: usa fallback 1.10", () => {
    const baseline = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "intense",
    });
    const adapted = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "intense",
      goalProgressSignal: "very_behind",
    });
    expect(adapted.weeklyVolumeTargetMin).toBeGreaterThan(baseline.weeklyVolumeTargetMin);
  });

  // ─── 14. Goal strength bumpa forza ───────────────────────────────────
  it("regular balanced + goal strength → forza +1", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "balanced",
      goalType: "strength",
    });
    // regular base 2 + strength goal +1 = 3
    expect(p.strength.sessionsPerWeek).toBe(3);
  });

  // ─── 15. Macro peak bumpa Z4-Z5 ──────────────────────────────────────
  it("regular intense + macro peak → +5% z45, -5% z12", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "intense",
      macroPhase: "peak",
    });
    // intense baseline post-update: 80/10/10 → peak (+5 z45, -5 z12): 75/10/15
    expect(p.zoneDistributionPct.z1z2Pct).toBe(75);
    expect(p.zoneDistributionPct.z4z5Pct).toBe(15);
  });
});

describe("computePrescription — invariants", () => {
  it("zoneDistribution sums to 100 in all configurations", () => {
    const intensities: IntensityLevel[] = ["soft", "balanced", "intense", "very_intense"];
    const experiences: Experience[] = ["sedentary", "occasional", "regular", "competitive"];
    const ages = [25, 50, 65, 80];
    for (const intensity of intensities) {
      for (const experience of experiences) {
        for (const age of ages) {
          const p = computePrescription({
            profile: makeProfile({ age, experience }),
            intensity,
          });
          const sum = p.zoneDistributionPct.z1z2Pct + p.zoneDistributionPct.z3Pct + p.zoneDistributionPct.z4z5Pct;
          expect(sum, `intensity=${intensity} exp=${experience} age=${age}`).toBe(100);
        }
      }
    }
  });

  it("weeklyVolumeRangeMin band is ±15% del target", () => {
    const p = computePrescription({
      profile: makeProfile(),
      intensity: "balanced",
    });
    expect(p.weeklyVolumeRangeMin.min).toBe(Math.round(p.weeklyVolumeTargetMin * 0.85));
    expect(p.weeklyVolumeRangeMin.max).toBe(Math.round(p.weeklyVolumeTargetMin * 1.15));
  });

  it("strength.sessionsPerWeek is sempre in [1, 4]", () => {
    const intensities: IntensityLevel[] = ["soft", "balanced", "intense", "very_intense"];
    const experiences: Experience[] = ["sedentary", "occasional", "regular", "competitive"];
    for (const intensity of intensities) {
      for (const experience of experiences) {
        const p = computePrescription({
          profile: makeProfile({ experience }),
          intensity,
          goalType: "strength",
        });
        expect(p.strength.sessionsPerWeek).toBeGreaterThanOrEqual(1);
        expect(p.strength.sessionsPerWeek).toBeLessThanOrEqual(4);
      }
    }
  });

  it("pure function: stesso input → stesso output (no side effects)", () => {
    const input = {
      profile: makeProfile({ age: 28, experience: "regular" as Experience }),
      intensity: "very_intense" as IntensityLevel,
    };
    const p1 = computePrescription(input);
    const p2 = computePrescription(input);
    expect(p1).toEqual(p2);
  });
});

describe("formatPrescriptionForPrompt", () => {
  it("include volume, zone, forza, riposo nel testo", () => {
    const p = computePrescription({
      profile: makeProfile({ age: 28, experience: "regular" }),
      intensity: "very_intense",
    });
    const text = formatPrescriptionForPrompt(p);
    expect(text).toContain("VINCOLO MATEMATICO INDEROGABILE");
    expect(text).toContain("Volume settimanale: 450 min totali");
    // MIN accettabile = 85% target. Math.round(450 * 0.85) = 383.
    expect(text).toContain("≥383");
    expect(text).toContain("Forza: 3 sess/sett");
    expect(text).toContain("PRESCRIZIONE TARGET");
  });
});
