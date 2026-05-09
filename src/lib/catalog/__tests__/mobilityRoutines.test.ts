import { describe, it, expect } from "vitest";
import { MOBILITY_ROUTINES, ROUTINES_BY_ID, ROUTINE_IDS } from "../mobilityRoutines";

describe("Mobility routines catalog", () => {
  it("contains at least 6 routines (G6 acceptance)", () => {
    expect(MOBILITY_ROUTINES.length).toBeGreaterThanOrEqual(6);
  });

  it("has all unique IDs", () => {
    const ids = MOBILITY_ROUTINES.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("ROUTINES_BY_ID lookup is consistent", () => {
    expect(Object.keys(ROUTINES_BY_ID).length).toBe(MOBILITY_ROUTINES.length);
    for (const r of MOBILITY_ROUTINES) {
      expect(ROUTINES_BY_ID[r.id]).toBe(r);
    }
  });

  it("ROUTINE_IDS set matches MOBILITY_ROUTINES", () => {
    expect(ROUTINE_IDS.size).toBe(MOBILITY_ROUTINES.length);
  });

  it("each routine has at least 3 steps", () => {
    const broken = MOBILITY_ROUTINES.filter(r => r.steps.length < 3);
    expect(broken.map(r => r.id)).toEqual([]);
  });

  it("each step has either duration_sec or reps", () => {
    const broken: Array<{ routineId: string; stepName: string }> = [];
    for (const r of MOBILITY_ROUTINES) {
      for (const s of r.steps) {
        if (s.duration_sec === undefined && s.reps === undefined) {
          broken.push({ routineId: r.id, stepName: s.name });
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("each step has a non-empty cue", () => {
    const broken: Array<{ routineId: string; stepName: string }> = [];
    for (const r of MOBILITY_ROUTINES) {
      for (const s of r.steps) {
        if (!s.cue || s.cue.trim().length < 10) {
          broken.push({ routineId: r.id, stepName: s.name });
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("FIFA 11+ routine exists (sport=calcio) and HAS citation (mandatory per spec)", () => {
    const fifa = ROUTINES_BY_ID["fifa-11plus"];
    expect(fifa).toBeDefined();
    expect(fifa.sport).toBe("calcio");
    expect(fifa.purpose).toBe("warmup");
    expect(fifa.citation).toBeDefined();
    expect(fifa.citation!.toLowerCase()).toContain("soligard");
  });

  it("has all 6 mandatory routines from ARCHITECTURE.md G6", () => {
    const mandatoryIds = [
      "fifa-11plus",
      "movement-prep",
      "dynamic-flow-runner",
      "foam-rolling-post-workout",
      "yoga-recovery-20",
      "calf-achilles-protocol",
    ];
    for (const id of mandatoryIds) {
      expect(ROUTINES_BY_ID[id], `Missing mandatory routine: ${id}`).toBeDefined();
    }
  });

  it("all routines have valid purpose enum value", () => {
    const validPurposes = new Set(["warmup", "cooldown", "recovery", "injury_prevention"]);
    const broken = MOBILITY_ROUTINES.filter(r => !validPurposes.has(r.purpose));
    expect(broken.map(r => r.id)).toEqual([]);
  });

  it("all IDs are kebab-case", () => {
    const broken = MOBILITY_ROUTINES.filter(r => !/^[a-z0-9-]+$/.test(r.id));
    expect(broken.map(r => r.id)).toEqual([]);
  });

  it("duration_min is positive", () => {
    const broken = MOBILITY_ROUTINES.filter(r => r.duration_min <= 0);
    expect(broken.map(r => r.id)).toEqual([]);
  });
});
