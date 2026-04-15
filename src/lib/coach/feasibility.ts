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
  const systemInstruction = PROMPTS.feasibility({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  let raw: unknown;
  try {
    raw = await generateJSON<unknown>({
      systemInstruction,
      userPrompt,
      schemaHint,
      // 1500 (era 800): il prompt feasibility include safety rules age-tiered + conditional
      // modules + COT + JSON_CONSTRAINT + schemaHint + reasoning. Con goal ambiziosi la
      // risposta veniva troncata e parseJSONResponse lanciava "JSON non valida".
      maxTokens: 1500,
    });
  } catch (e: any) {
    // Errore di parsing (risposta non-JSON o troncata) → valutazione conservativa invece
    // di propagare "Risposta non valida" all'utente. Per errori infrastrutturali reali
    // (chiave, quota, network, 503) ri-lanciamo perché il banner rosso del wizard è utile.
    const msg = (e?.message || String(e)).toLowerCase();
    const isParseError = msg.includes("json") || msg.includes("parse") || msg.includes("raw:");
    if (!isParseError) throw e;
    console.warn("[feasibility] JSON parse failed on LLM response, fallback applied:", e?.message);
    return {
      realistic: true,
      reasoning: "Il coach non è riuscito a strutturare la valutazione (risposta troppo lunga o formato inatteso). Ho accettato il tuo obiettivo così com'è: lo userò come riferimento per costruire il piano. Se il risultato non ti convince, riprova o riformula l'obiettivo con più dettagli (es. 'correre 10 km in 55 min entro 8 settimane').",
      counterProposal: {
        description: goalDescription,
        kpi: { metric: "obiettivo utente", target: goalDescription, deadline: "come indicato" },
      },
    };
  }

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
