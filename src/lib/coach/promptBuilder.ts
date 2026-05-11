import type { UserProfile, MacroPhase } from "../types";
import { nutritionGuardrailBlock } from "./promptModules/nutritionGuardrail";
import { resistancePrescriptionBlock } from "./promptModules/resistancePrescription";
import { strengthForEnduranceBlock } from "./promptModules/strengthForEndurance";
import { masterAthleteBlock } from "./promptModules/masterAthleteRules";
import { taperingBlock, macroPhaseBlock } from "./promptModules/taperingRules";
import { chronicConditionBlock } from "./promptModules/chronicConditionRules";
import { recoveryBlock } from "./promptModules/recoveryModalities";
import { cadenceAdviceBlock } from "./promptModules/biomechanicsRunning";
import { bodyCompositionBlock, type BodyCompSummary } from "./promptModules/bodyComposition";
import { zonesBlock } from "./promptModules/zonesBlock";
import type { ZonesResult, TimeInZone } from "./zones";

/**
 * Contesto macrociclo corrente per iniezione nel prompt Pass 1 (Wave 3.3).
 * Popolato da `macroLookup.loadActiveMacroContext` quando il profile ha
 * un `activeMacroCycleId` valido. Vedi ARCHITECTURE.md §5.5.
 */
export interface BuildContextMacroCtx {
  phase: MacroPhase;
  weekNumber: number;
  totalWeeks: number;
  weeksToRace: number;
  volumeMultiplier: number;
  intensityHighPct: number;
  race: { name: string; sport: string };
}

export type WorkoutTypeId = "corsa" | "forza_gambe" | "forza_upper" | "sport" | "mobilita";

// Helper condiviso: rileva un obiettivo di corsa/gara da testo libero.
// Usato da feasibility, planGenerator, sessionFeedback, weeklyReport e CoachChat.
export const RUNNING_GOAL_RE = /corsa|run|km|gara|race|10k|5k|maratona|half|mezza/i;

export interface BuildContext {
  profile: UserProfile | null;
  workoutType?: WorkoutTypeId;
  hasRunningGoal?: boolean;
  hasStrengthInPlan?: boolean;
  daysToNearestRace?: number;
  lastSessionIntensity?: "light" | "moderate" | "hard";
  currentCadence?: number | null;
  detectedConditions?: string[];
  /** Dati BIA più recenti dal daily check (se utente traccia). */
  bodyComp?: BodyCompSummary;
  /** Delta body-comp ultimi 7gg (valore attuale - 7gg fa). */
  bodyCompTrend7d?: BodyCompSummary;
  /** Zone FC personalizzate (Tanaka/Karvonen/Empirica). Iniettate quando il contesto include corsa o obiettivo running. */
  zones?: ZonesResult;
  /** Tempo trascorso per zona ultimi N giorni + check polarizzato 80/20. */
  zonesTimeInZone?: TimeInZone[];
  zonesPolar?: { lowPct: number; highPct: number; isPolarized: boolean };
  zonesTotalSessions?: number;
  /**
   * Testo libero (goals, note workout, query utente) su cui fare keyword-match
   * per decidere l'inclusione di moduli opzionali (fix #7: nutritionGuardrail).
   * Se vuoto/undefined, l'inclusione cade su euristiche di fallback (workout con kcal/fc_media).
   */
  freeTextHints?: string;
  /** Se true forza l'inclusione del nutrition guardrail (override del keyword-match). */
  includeNutritionGuardrail?: boolean;
  /** Se il workout corrente ha fc_media + kcal tracciati (segnale indiretto di interesse nutrition). */
  workoutHasEnergyMetrics?: boolean;
  /**
   * Macro context corrente, se piano ha macroCycleId attivo (Wave 3.3).
   * Quando presente attiva `macroPhaseBlock` con direttive specifiche per
   * la fase corrente (base/build/peak/taper/transition). Quando assente
   * cade sul fallback storico `taperingBlock` se daysToNearestRace ≤21.
   */
  macroContext?: BuildContextMacroCtx;
}

/**
 * Keyword-match euristico per decidere se includere il blocco nutrition guardrail (fix #7).
 * Match case-insensitive su termini legati a: nutrizione diretta (kcal, calorie,
 * macro, proteine, carbo, grassi, dieta), peso corporeo (peso, dimagri, ingrassa,
 * deficit), pasti (colazione, pranzo, cena, spuntino, pasto, mangi, cibo, fame,
 * sazi), integratori, energia (energia, energetic, low energy, LEA), RED-S.
 * Espanso vs v1 per catturare più contesti (fix keyword fatigue/stanchezza
 * NON incluso: fatigue è sintomo overtraining, non primariamente nutrition).
 */
const NUTRITION_KEYWORDS_RE = /\b(nutrition|nutrizion\w*|kcal|calori\w*|peso|dimagri\w*|ingrass\w*|diet\w*|macro\w*|proteine|carboidrat\w*|grassi|deficit|energia|energetic\w*|fame|sazi\w*|mangi\w*|cibo|pasto|spuntino|integrator\w*|colazione|pranzo|cena|red[- ]?s|low.energy|\bLEA\b)\b/i;

function shouldIncludeNutritionGuardrail(ctx: BuildContext): boolean {
  if (ctx.includeNutritionGuardrail) return true;
  if (ctx.workoutHasEnergyMetrics) return true;
  const haystack = [
    ctx.freeTextHints || "",
    ctx.profile?.notes || "",
  ].join(" ");
  if (haystack && NUTRITION_KEYWORDS_RE.test(haystack)) return true;
  return false;
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
  // Fix #7 — nutrition guardrail è ora condizionale: incluso solo se il contesto
  // suggerisce rilevanza (keyword in goals/note, workout con metriche energetiche,
  // override esplicito). Evita rumore nei prompt che non parlano di nutrizione.
  if (shouldIncludeNutritionGuardrail(ctx)) {
    blocks.push(nutritionGuardrailBlock());
  }

  if (ctx.workoutType === "forza_gambe" || ctx.workoutType === "forza_upper") {
    blocks.push(resistancePrescriptionBlock(ctx.profile?.experience || "occasional"));
  }
  if (ctx.hasRunningGoal && ctx.hasStrengthInPlan) {
    blocks.push(strengthForEnduranceBlock());
  }
  if (ctx.profile?.age && ctx.profile.age >= 50) {
    blocks.push(masterAthleteBlock(ctx.profile.age));
  }
  // Wave 3.3 — periodizzazione race-driven.
  // Priorità: se è disponibile un MacroCycle attivo, iniettiamo il block
  // specifico per la fase corrente (più ricco di taperingBlock, copre
  // anche base/build/peak — non solo le ultime 3 settimane). Il vecchio
  // taperingBlock resta come SAFETY NET per due scenari:
  //   (a) utente con race "B"/"C" (no macro generato, solo countdown ≤21gg)
  //   (b) macroContext non caricato (errore storage / migrazione)
  // Se la fase corrente è "taper", il macroPhaseBlock copre già le direttive
  // di Mujika 2003 con specificità migliore — NON aggiungiamo anche il
  // taperingBlock per evitare istruzioni duplicate al modello.
  if (ctx.macroContext) {
    blocks.push(macroPhaseBlock({
      phase: ctx.macroContext.phase,
      weekNumber: ctx.macroContext.weekNumber,
      totalWeeks: ctx.macroContext.totalWeeks,
      weeksToRace: ctx.macroContext.weeksToRace,
      raceName: ctx.macroContext.race.name,
      raceSport: ctx.macroContext.race.sport,
      volumeMultiplier: ctx.macroContext.volumeMultiplier,
      intensityHighPct: ctx.macroContext.intensityHighPct,
    }));
  } else if (ctx.daysToNearestRace !== undefined && ctx.daysToNearestRace <= 21) {
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
  if (ctx.bodyComp && (ctx.bodyComp.bodyFat != null || ctx.bodyComp.muscleMass != null || ctx.bodyComp.bodyWater != null)) {
    blocks.push(bodyCompositionBlock(ctx.bodyComp, ctx.bodyCompTrend7d));
  }
  // Zone FC personalizzate: inietta quando c'è contesto corsa (workout o obiettivo)
  if (ctx.zones && (ctx.workoutType === "corsa" || ctx.hasRunningGoal)) {
    blocks.push(zonesBlock(ctx.zones, ctx.zonesTimeInZone, ctx.zonesPolar, ctx.zonesTotalSessions));
  }

  return blocks.join("\n\n");
}
