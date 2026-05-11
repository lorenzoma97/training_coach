// Test golden cases per validateReadiness (Wave 3.4 — ARCHITECTURE.md §3.3,
// §4 Wave 3.4, §6 I7). Pure function tests + integration con validatePlan
// (auto-correction).
//
// Uso `evaluateReadinessIssues` (pure, accetta todayDayKey + todayDateISO
// come parametri) per evitare flakiness legata alla data corrente.

import { describe, it, expect } from "vitest";
import {
  evaluateReadinessIssues,
} from "../readinessValidator";
import { validatePlan } from "../../planValidator";
import type {
  TrainingPlan,
  PlannedSession,
  UserProfile,
  ReadinessSnapshot,
} from "../../../types";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const TODAY_ISO = "2026-05-11";
const TODAY_DAY = "lun"; // 2026-05-11 è un lunedì

const baseProfile: UserProfile = {
  age: 30,
  sex: "m",
  weight_kg: 80,
  height_cm: 180,
  experience: "regular",
  injuries: [],
  meds: "",
  weekly_availability: { days: 4, hoursPerSession: 1 },
  equipment: ["barbell"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function makeSession(p: Partial<PlannedSession>): PlannedSession {
  return {
    day: p.day ?? TODAY_DAY,
    type: p.type ?? "corsa",
    duration_min: p.duration_min ?? 45,
    details: p.details ?? "test",
    rationale: p.rationale ?? "test",
    zone: p.zone,
    exercises: p.exercises,
    readinessAdjusted: p.readinessAdjusted,
    subtype: p.subtype,
  };
}

function makePlan(sessions: PlannedSession[], weekNumber = 1): TrainingPlan {
  return {
    generatedAt: "2026-05-11T07:00:00Z",
    validUntil: "2026-06-11T07:00:00Z",
    rationale: "test",
    weeks: [
      {
        weekNumber,
        focus: "test",
        sessions,
      },
    ],
  };
}

function makeMultiWeekPlan(
  weeksData: Array<{ weekNumber: number; sessions: PlannedSession[] }>,
): TrainingPlan {
  return {
    generatedAt: "2026-05-11T07:00:00Z",
    validUntil: "2026-06-11T07:00:00Z",
    rationale: "test",
    weeks: weeksData.map(w => ({
      weekNumber: w.weekNumber,
      focus: "test",
      sessions: w.sessions,
    })),
  };
}

function makeSnapshot(
  band: ReadinessSnapshot["band"],
  score: number,
  date: string = TODAY_ISO,
): ReadinessSnapshot {
  return {
    date,
    score,
    band,
    components: { hrvDelta: -8, sleepScore: 60, subjectiveScore: 50 },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Test cases (≥10 richiesti)
// ────────────────────────────────────────────────────────────────────────────

describe("evaluateReadinessIssues", () => {
  it("1. Readiness null → 0 issue (skip)", () => {
    const plan = makePlan([makeSession({ zone: 5 })]);
    const issues = evaluateReadinessIssues(plan, null, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });

  it("2. Readiness band 'high' (score 85) → 0 issue", () => {
    const plan = makePlan([makeSession({ zone: 5 })]);
    const snap = makeSnapshot("high", 85);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });

  it("3. Readiness band 'moderate' (score 60) → 0 issue (no auto-downgrade)", () => {
    const plan = makePlan([makeSession({ zone: 5 })]);
    const snap = makeSnapshot("moderate", 60);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });

  it("4. Readiness 'low' + sessione oggi Z4 → 1 issue", () => {
    const plan = makePlan([makeSession({ zone: 4, day: TODAY_DAY })]);
    const snap = makeSnapshot("low", 35);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("readiness_override_required");
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].weekNumber).toBe(1);
  });

  it("5. Readiness 'low' + sessione oggi Z5 → 1 issue", () => {
    const plan = makePlan([makeSession({ zone: 5, day: TODAY_DAY })]);
    const snap = makeSnapshot("low", 30);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Z5");
  });

  it("6. Readiness 'low' + sessione oggi Z2 → 0 issue (già low intensity)", () => {
    const plan = makePlan([makeSession({ zone: 2, day: TODAY_DAY })]);
    const snap = makeSnapshot("low", 35);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });

  it("7. Readiness 'low' + sessione FUTURA (week 2) Z5 → 0 issue (solo oggi)", () => {
    const plan = makeMultiWeekPlan([
      { weekNumber: 1, sessions: [makeSession({ zone: 2, day: TODAY_DAY })] },
      { weekNumber: 2, sessions: [makeSession({ zone: 5, day: TODAY_DAY })] },
    ]);
    const snap = makeSnapshot("low", 35);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });

  it("8. Multi-sessione oggi: solo Z4-5 vengono flagged (Z2 ignorata)", () => {
    const plan = makePlan([
      makeSession({ zone: 5, type: "corsa", day: TODAY_DAY }),
      makeSession({ zone: 2, type: "corsa", day: TODAY_DAY }),
      makeSession({ zone: 4, type: "sport", day: TODAY_DAY }),
    ]);
    const snap = makeSnapshot("low", 35);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(2);
    // entrambe per oggi (week 1)
    expect(issues.every(i => i.weekNumber === 1)).toBe(true);
  });

  it("9. Sessione forza_gambe (no zone) → 0 issue (validator solo per cardio)", () => {
    const plan = makePlan([
      makeSession({ type: "forza_gambe", zone: undefined, day: TODAY_DAY }),
    ]);
    const snap = makeSnapshot("low", 35);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });

  it("10. Snapshot >24h vecchio → 0 issue (skip per non-fresh)", () => {
    const plan = makePlan([makeSession({ zone: 5, day: TODAY_DAY })]);
    // snapshot di IERI
    const stale = makeSnapshot("low", 30, "2026-05-10");
    const issues = evaluateReadinessIssues(plan, stale, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });

  // Test extra (oltre i 10 richiesti) — copre sessione di altro giorno
  it("11. Sessione oggi == 'mar' ma snapshot+today='lun' → 0 issue", () => {
    // session.day = mar, today = lun → no match
    const plan = makePlan([makeSession({ zone: 5, day: "mar" })]);
    const snap = makeSnapshot("low", 35);
    const issues = evaluateReadinessIssues(plan, snap, TODAY_DAY, TODAY_ISO);
    expect(issues).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test #11 spec: integration con validatePlan → correctedPlan riceve flag
// ────────────────────────────────────────────────────────────────────────────

describe("validatePlan auto-correction (Wave 3.4)", () => {
  // NB: useremo una snapshot con date == oggi (now) perché validatePlan usa
  // `new Date()` internamente per il day key. I test sotto si basano sul
  // fatto che il day key di `new Date()` matcha il day del session.

  function getTodayDayKey(): string {
    const dow = new Date().getDay();
    const idx = (dow + 6) % 7;
    return ["lun", "mar", "mer", "gio", "ven", "sab", "dom"][idx];
  }
  function getTodayISO(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  it("11. correctedPlan ha readinessAdjusted=true e zone=3 sulle sessioni modificate", () => {
    const todayKey = getTodayDayKey();
    const todayIso = getTodayISO();
    const plan = makePlan([
      makeSession({ zone: 5, day: todayKey, type: "corsa" }),
      makeSession({ zone: 2, day: todayKey, type: "corsa" }),
    ]);
    const snap = makeSnapshot("low", 30, todayIso);

    const result = validatePlan(plan, baseProfile, [], { readiness: snap });
    expect(result.issues.some(i => i.type === "readiness_override_required")).toBe(true);

    const week1 = result.correctedPlan.weeks.find(w => w.weekNumber === 1)!;
    const adjusted = week1.sessions.find(s => s.zone === 3 && s.readinessAdjusted === true);
    expect(adjusted).toBeDefined();

    // L'altra sessione (Z2) NON deve essere stata toccata
    const untouched = week1.sessions.find(s => s.zone === 2);
    expect(untouched).toBeDefined();
    expect(untouched!.readinessAdjusted).toBeUndefined();
  });

  it("12. Senza readiness in options → backward compat (no correction)", () => {
    const todayKey = getTodayDayKey();
    const plan = makePlan([makeSession({ zone: 5, day: todayKey, type: "corsa" })]);
    const result = validatePlan(plan, baseProfile, [], {});
    expect(
      result.issues.some(i => i.type === "readiness_override_required"),
    ).toBe(false);
    const session = result.correctedPlan.weeks[0].sessions[0];
    expect(session.zone).toBe(5);
    expect(session.readinessAdjusted).toBeUndefined();
  });

  it("13. Plan input NON viene mutato (immutability)", () => {
    const todayKey = getTodayDayKey();
    const todayIso = getTodayISO();
    const plan = makePlan([makeSession({ zone: 5, day: todayKey, type: "corsa" })]);
    const snap = makeSnapshot("low", 30, todayIso);

    const result = validatePlan(plan, baseProfile, [], { readiness: snap });

    // Plan originale invariato
    expect(plan.weeks[0].sessions[0].zone).toBe(5);
    expect(plan.weeks[0].sessions[0].readinessAdjusted).toBeUndefined();
    // correctedPlan è una nuova reference
    expect(result.correctedPlan).not.toBe(plan);
  });
});
