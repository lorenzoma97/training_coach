import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { profileAsPrompt, goalsAsPrompt, planAsPrompt } from "../diaryContext";
import type { UserProfile, UserGoal, TrainingPlan } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, type BuildContext } from "./promptBuilder";

const sessionSchema = z.object({
  day: z.enum(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]),
  type: z.enum(["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"]),
  subtype: z.string().optional(),
  duration_min: z.number().int().min(5).max(240),
  details: z.string(),
  rationale: z.string(),
});

const weekSchema = z.object({
  weekNumber: z.number().int().min(1),
  focus: z.string(),
  sessions: z.array(sessionSchema),
});

const planSchema = z.object({
  weeks: z.array(weekSchema).min(1).max(4),
  rationale: z.string(),
});

const schemaHint = `
{
  "weeks": [
    {
      "weekNumber": 1,
      "focus": "string breve",
      "sessions": [
        {
          "day": "lun"|"mar"|"mer"|"gio"|"ven"|"sab"|"dom",
          "type": "corsa"|"forza_gambe"|"forza_upper"|"sport"|"mobilita",
          "subtype": "opzionale es. 'Fondo Lento'",
          "duration_min": number,
          "details": "descrizione breve (es. '25min Z2, conversazionale, passo libero')",
          "rationale": "perché questa sessione qui"
        }
      ]
    }
  ],
  "rationale": "2-3 frasi che spiegano la logica del piano"
}
`.trim();

export async function generateInitialPlan(
  profile: UserProfile,
  goals: UserGoal[],
): Promise<TrainingPlan> {
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVI:
${goalsAsPrompt(goals)}

Genera un microciclo di 2 settimane (weeks con weekNumber 1 e 2) che porti l'utente verso gli obiettivi rispettando vincoli e sicurezza.
`.trim();

  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => /corsa|run|km|gara|10k|maratona/i.test(g.smartDescription)),
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
  };
  const systemInstruction = PROMPTS.planGeneration() + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 3000,
  });
  const parsed = planSchema.parse(raw);

  const now = new Date();
  const validUntil = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  return {
    generatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    weeks: parsed.weeks.map(w => ({
      weekNumber: w.weekNumber,
      focus: w.focus,
      sessions: w.sessions.map(s => ({
        day: s.day,
        type: s.type,
        subtype: s.subtype,
        duration_min: s.duration_min,
        details: s.details,
        rationale: s.rationale,
      })),
    })),
    rationale: parsed.rationale,
  };
}

/** Rigenera il piano per la settimana successiva integrando i dati reali. */
export async function regenerateNextWeek(
  profile: UserProfile,
  goals: UserGoal[],
  currentPlan: TrainingPlan | null,
  recentDaysText: string,
): Promise<TrainingPlan> {
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVI:
${goalsAsPrompt(goals)}

PIANO CORRENTE:
${planAsPrompt(currentPlan)}

ULTIMI 14 GIORNI REALI DAL DIARIO:
${recentDaysText}

Genera il nuovo microciclo di 2 settimane a partire dalla settimana prossima, adattando in base a aderenza, trend dolore/fatica, e risposta al carico.
Se rilevi red flag, proponi deload esplicito nella settimana 1.
`.trim();

  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => /corsa|run|km|gara|10k|maratona/i.test(g.smartDescription)),
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
  };
  const systemInstruction = PROMPTS.planGeneration() + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 3000,
  });
  const parsed = planSchema.parse(raw);
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    weeks: parsed.weeks,
    rationale: parsed.rationale,
  };
}
