import type { UserProfile } from "../types";
import { nutritionGuardrailBlock } from "./promptModules/nutritionGuardrail";
import { resistancePrescriptionBlock } from "./promptModules/resistancePrescription";
import { strengthForEnduranceBlock } from "./promptModules/strengthForEndurance";
import { masterAthleteBlock } from "./promptModules/masterAthleteRules";
import { taperingBlock } from "./promptModules/taperingRules";
import { chronicConditionBlock } from "./promptModules/chronicConditionRules";
import { recoveryBlock } from "./promptModules/recoveryModalities";
import { cadenceAdviceBlock } from "./promptModules/biomechanicsRunning";

export type WorkoutTypeId = "corsa" | "forza_gambe" | "forza_upper" | "sport" | "mobilita";

export interface BuildContext {
  profile: UserProfile | null;
  workoutType?: WorkoutTypeId;
  hasRunningGoal?: boolean;
  hasStrengthInPlan?: boolean;
  daysToNearestRace?: number;
  lastSessionIntensity?: "light" | "moderate" | "hard";
  currentCadence?: number | null;
  detectedConditions?: string[];
}

export function extractConditionsFromProfile(profile: UserProfile | null): string[] {
  if (!profile) return [];
  const text = [
    (profile.injuries || []).join(" "),
    profile.meds || "",
    profile.notes || "",
  ].join(" ").toLowerCase();
  const out: string[] = [];
  if (/diabet/.test(text)) out.push("diabetes");
  if (/iperten|hypertens|pressione alt/.test(text)) out.push("hypertension");
  if (/obes/.test(text)) out.push("obesity");
  if (/cardio|cardiac|cuore|coronari|scompenso|aritmia/.test(text)) out.push("cardiac");
  return out;
}

export function buildConditionalPrompt(ctx: BuildContext): string {
  const blocks: string[] = [];
  blocks.push(nutritionGuardrailBlock()); // sempre

  if (ctx.workoutType === "forza_gambe" || ctx.workoutType === "forza_upper") {
    blocks.push(resistancePrescriptionBlock(ctx.profile?.experience || "occasional"));
  }
  if (ctx.hasRunningGoal && ctx.hasStrengthInPlan) {
    blocks.push(strengthForEnduranceBlock());
  }
  if (ctx.profile?.age && ctx.profile.age >= 50) {
    blocks.push(masterAthleteBlock(ctx.profile.age));
  }
  if (ctx.daysToNearestRace !== undefined && ctx.daysToNearestRace <= 21) {
    blocks.push(taperingBlock(ctx.daysToNearestRace));
  }
  const conds = ctx.detectedConditions ?? extractConditionsFromProfile(ctx.profile);
  if (conds.length > 0) {
    blocks.push(chronicConditionBlock(conds));
  }
  if (ctx.lastSessionIntensity === "hard") {
    blocks.push(recoveryBlock("hard"));
  }
  if (ctx.workoutType === "corsa" && ctx.currentCadence != null && ctx.currentCadence > 0 && ctx.currentCadence < 165) {
    blocks.push(cadenceAdviceBlock(ctx.currentCadence));
  }

  return blocks.join("\n\n");
}
