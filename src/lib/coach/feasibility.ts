import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { profileAsPrompt } from "../diaryContext";
import type { UserProfile, FeasibilityCheck } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "./promptBuilder";

const schema = z.object({
  realistic: z.boolean(),
  reasoning: z.string(),
  counterProposal: z.object({
    description: z.string(),
    kpi: z.object({
      metric: z.string(),
      target: z.string(),
      deadline: z.string(),
    }),
  }),
});

const schemaHint = `
{
  "realistic": boolean,
  "reasoning": "spiegazione 2-3 frasi in italiano",
  "counterProposal": {
    "description": "versione SMART dell'obiettivo",
    "kpi": { "metric": "es. distanza settimanale", "target": "es. 15 km", "deadline": "es. 6 settimane" }
  }
}
`.trim();

export async function checkGoalFeasibility(
  profile: UserProfile,
  goalDescription: string,
): Promise<FeasibilityCheck> {
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVO PROPOSTO DALL'UTENTE:
"${goalDescription}"

Valuta se è realistico. Se non lo è, proponi una versione SMART ragionevole.
Se è già realistico e SMART, "realistic" = true e "counterProposal" confermerà l'obiettivo originale in forma SMART.
`.trim();

  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: RUNNING_GOAL_RE.test(goalDescription),
    detectedConditions: extractConditionsFromProfile(profile),
  };
  const systemInstruction = PROMPTS.feasibility() + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 800,
  });
  const result = schema.safeParse(raw);
  if (!result.success) {
    // Fallback graceful: ritorna una valutazione conservativa invece di crashare
    console.warn("[feasibility] Zod parse failed, fallback applied:", result.error.message);
    return {
      realistic: false,
      reasoning: "Non sono riuscito a strutturare una valutazione. Prova a riformulare l'obiettivo in modo più specifico (es. 'correre 10km in 55min entro 8 settimane').",
      counterProposal: {
        description: goalDescription,
        kpi: { metric: "da definire", target: "-", deadline: "-" },
      },
    };
  }
  return result.data;
}
