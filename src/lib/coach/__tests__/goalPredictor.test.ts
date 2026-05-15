import { describe, it, expect } from "vitest";
import {
  paceToVdot,
  vdotToPace,
  predictRunningPace,
  predictWeightLoss,
  predictSoccerReady,
  predictStrength1RM,
  predictEnduranceDuration,
} from "../goalPredictor";

describe("Daniels VDOT helpers", () => {
  it("pace 5:00/km su 10K (50:00 finish) → VDOT ~38-41 (Daniels table)", () => {
    const vdot = paceToVdot(300, 10);
    expect(vdot).toBeGreaterThan(38);
    expect(vdot).toBeLessThan(42);
  });
  it("pace 4:00/km su 5K (20:00 finish) → VDOT ~48-52", () => {
    const vdot = paceToVdot(240, 5);
    expect(vdot).toBeGreaterThan(48);
    expect(vdot).toBeLessThan(52);
  });
  it("vdotToPace è inversa di paceToVdot (entro tolleranza)", () => {
    const pace = 330; // 5:30/km
    const vdot = paceToVdot(pace, 10);
    const back = vdotToPace(vdot, 10);
    expect(Math.abs(back - pace)).toBeLessThan(2);
  });
});

describe("predictRunningPace", () => {
  it("5:25 → 5:00 in 8 sett: aggressive (urgency ~10× sustainable)", () => {
    const p = predictRunningPace(325, 300, 10, 8);
    expect(["aggressive", "infeasible"]).toContain(p.feasibility);
    expect(p.recommendedVolumeMultiplier).toBeGreaterThan(1.0);
    expect(p.recommendedVolumeMultiplier).toBeLessThanOrEqual(1.10);
  });
  it("5:40 → 5:00 in 2 sett: infeasible (oltre picco acuto)", () => {
    const p = predictRunningPace(340, 300, 10, 2);
    expect(p.feasibility).toBe("infeasible");
    expect(p.realisticDeadlineWeeks).not.toBeNull();
    expect(p.realisticDeadlineWeeks!).toBeGreaterThan(2);
  });
  it("5:00 → 5:00 (già a target): ok no boost", () => {
    const p = predictRunningPace(300, 300, 10, 8);
    expect(p.feasibility).toBe("ok");
    expect(p.recommendedVolumeMultiplier).toBe(1.0);
  });
  it("5:25 → 5:00 in 24 sett: aggressive (gap richiede ~95 sett a sustainable)", () => {
    const p = predictRunningPace(325, 300, 10, 24);
    expect(["aggressive", "stretch"]).toContain(p.feasibility);
    expect(p.recommendedVolumeMultiplier).toBeLessThanOrEqual(1.10);
  });
});

describe("predictWeightLoss", () => {
  it("82 → 77kg in 10 sett: ok (0.5 kg/sett sustainable)", () => {
    const p = predictWeightLoss(82, 77, 10);
    expect(p.feasibility).toBe("ok");
  });
  it("82 → 77kg in 4 sett: stretch (1.25 kg/sett, urgency 2.5)", () => {
    const p = predictWeightLoss(82, 77, 4);
    expect(["stretch", "aggressive"]).toContain(p.feasibility);
    // Volume cardio non risolve dimagrimento — multiplier basso anche aggressive
    expect(p.recommendedVolumeMultiplier).toBeLessThanOrEqual(1.05);
  });
  it("82 → 77kg in 2 sett: aggressive (urgency 5, oltre max safe ACSM)", () => {
    const p = predictWeightLoss(82, 77, 2);
    expect(["aggressive", "infeasible"]).toContain(p.feasibility);
    expect(p.realisticDeadlineWeeks!).toBeGreaterThanOrEqual(8);
  });
  it("75 → 77kg (gain): ok mantenimento", () => {
    const p = predictWeightLoss(75, 77, 8);
    expect(p.feasibility).toBe("ok");
  });
});

describe("predictSoccerReady", () => {
  it("base solida 16 sessioni in 8 sett: ok", () => {
    const p = predictSoccerReady(16, 4);
    expect(p.feasibility).toBe("ok");
  });
  it("base assente 2 sessioni + 2 sett alla partita: infeasible", () => {
    const p = predictSoccerReady(2, 2);
    expect(p.feasibility).toBe("infeasible");
    expect(p.reasoning.toLowerCase()).toContain("rischio infortunio");
  });
  it("base moderata 8 sessioni + 6 sett: stretch", () => {
    const p = predictSoccerReady(8, 6);
    expect(["ok", "stretch"]).toContain(p.feasibility);
  });
});

describe("predictStrength1RM", () => {
  it("regular: squat 100 → 110kg in 8 sett, rate ~1.25kg/sett vs sustainable 0.75kg → stretch", () => {
    const p = predictStrength1RM(100, 110, 8, "regular");
    expect(["stretch", "aggressive"]).toContain(p.feasibility);
  });
  it("regular: squat 100 → 105kg in 12 sett: ok", () => {
    const p = predictStrength1RM(100, 105, 12, "regular");
    expect(p.feasibility).toBe("ok");
  });
  it("regular: squat 100 → 130kg in 4 sett: aggressive (urgency 10x sustainable)", () => {
    const p = predictStrength1RM(100, 130, 4, "regular");
    expect(["aggressive", "infeasible"]).toContain(p.feasibility);
  });
});

describe("predictEnduranceDuration", () => {
  it("0 → 60min in 12 sett: ok (couch-to-1h con Lydiard)", () => {
    const p = predictEnduranceDuration(0, 60, 12);
    expect(["ok", "stretch"]).toContain(p.feasibility);
  });
  it("30 → 60min in 8 sett a Lydiard 10%/sett: ok", () => {
    // 30 * 1.1^8 = 30 * 2.14 = 64min ≥ 60 → ok
    const p = predictEnduranceDuration(30, 60, 8);
    expect(p.feasibility).toBe("ok");
  });
  it("0 → 60min in 2 sett: aggressive (couch-to-1h serve ~12 sett, urgency 6x)", () => {
    const p = predictEnduranceDuration(0, 60, 2);
    expect(["aggressive", "infeasible"]).toContain(p.feasibility);
  });
});
