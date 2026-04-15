import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { profileAsPrompt, goalsAsPrompt, planAsPrompt } from "../diaryContext";
import type { UserProfile, UserGoal, TrainingPlan } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "./promptBuilder";
import { validatePlan, profileHashForPlan, computePlanStartDate } from "./planValidator";

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
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    // Il piano generato include sempre forza 2-3x/sett (see Rønnestad 2014); teniamo true per
    // attivare il modulo strengthForEndurance quando il contesto corsa è presente.
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 3000,
  });
  const parseResult = planSchema.safeParse(raw);
  if (!parseResult.success) {
    console.error("[planGenerator] Zod parse failed:", parseResult.error.message);
    throw new Error("Il coach non è riuscito a generare un piano strutturato. Riprova tra qualche secondo.");
  }
  const parsed = parseResult.data;

  const now = new Date();
  const validUntil = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  const plan: TrainingPlan = {
    generatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    startDate: computePlanStartDate(now),
    profileHash: profileHashForPlan(profile),
    weeks: parsed.weeks.map((w: z.infer<typeof weekSchema>) => ({
      weekNumber: w.weekNumber,
      focus: w.focus,
      sessions: w.sessions.map((s: z.infer<typeof sessionSchema>) => ({
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
  // Validator deterministico post-LLM: logga violazioni safety anche se il modello
  // le ha ignorate. Non ri-generiamo automaticamente (caro in token) — segnaliamo.
  const validation = validatePlan(plan, profile);
  if (!validation.ok) {
    console.warn("[planGenerator] Violazioni safety nel piano generato:",
      validation.issues.map(i => i.message).join(" | "));
    plan.rationale = plan.rationale +
      "\n\n[Validator] Avvertenze rilevate: " +
      validation.issues.map(i => i.message).join(" ");
  }
  return plan;
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
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    // Il piano generato include sempre forza 2-3x/sett (see Rønnestad 2014); teniamo true per
    // attivare il modulo strengthForEndurance quando il contesto corsa è presente.
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 3000,
  });
  const parseResult = planSchema.safeParse(raw);
  if (!parseResult.success) {
    console.error("[planGenerator] Zod parse failed:", parseResult.error.message);
    throw new Error("Il coach non è riuscito a generare un piano strutturato. Riprova tra qualche secondo.");
  }
  const parsed = parseResult.data;
  const now = new Date();
  const plan: TrainingPlan = {
    generatedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    startDate: computePlanStartDate(now),
    profileHash: profileHashForPlan(profile),
    weeks: parsed.weeks,
    rationale: parsed.rationale,
  };
  const validation = validatePlan(plan, profile);
  if (!validation.ok) {
    console.warn("[regenerateNextWeek] Violazioni safety:", validation.issues.map(i => i.message).join(" | "));
    plan.rationale = plan.rationale + "\n\n[Validator] Avvertenze: " + validation.issues.map(i => i.message).join(" ");
  }
  return plan;
}

/**
 * Adatta un piano esistente in base a una richiesta testuale dell'utente.
 * Esempi: "più intenso", "non posso allenarmi giovedì", "voglio più forza",
 * "settimana di deload", "aggiungi yoga il martedì".
 * Il coach rispetta sempre le safety rules anche se l'utente chiede di sforzare.
 */
export async function adaptPlan(
  profile: UserProfile,
  goals: UserGoal[],
  currentPlan: TrainingPlan,
  recentDaysText: string,
  userRequest: string,
): Promise<TrainingPlan> {
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVI:
${goalsAsPrompt(goals)}

PIANO CORRENTE (da modificare):
${planAsPrompt(currentPlan)}

ULTIMI 14 GIORNI REALI DAL DIARIO:
${recentDaysText}

RICHIESTA SPECIFICA DELL'UTENTE:
"${userRequest}"

Il tuo compito: adattare il piano corrente in base ALLA RICHIESTA dell'utente, interpretandola sensatamente.
Esempi di richieste possibili:
- "più intenso/difficile" → aumenta intensità (intervalli, ripetute, carichi) mantenendo safety
- "meno intenso/voglio solo mantenere" → riduci volume/intensità, più recovery
- "non posso allenarmi [giorno]" → sposta la sessione in altro giorno della stessa settimana
- "aggiungi [disciplina]" → integra sessioni del tipo richiesto se compatibile con disponibilità
- "deload" → settimana 1 con -40-50% volume, intensità invariata (Bosquet 2007)
- "preparami per [evento X data]" → riorganizza verso quella data con tapering finale se ≤2 settimane

REGOLE NON VIOLABILI:
- Rispetta SEMPRE le regole di sicurezza e le condizioni dichiarate.
- Se la richiesta è rischiosa (es. "voglio fare triplo volume"), proponi una versione sicura e spiega perché nel "rationale".
- Non rimuovere tutti i giorni di riposo.

Rispondi con il piano MODIFICATO completo (entrambe le settimane, tutte le sessioni). Il "rationale" DEVE menzionare esplicitamente cosa è cambiato rispetto al piano precedente e perché.
`.trim();

  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 3000,
  });
  const parseResult = planSchema.safeParse(raw);
  if (!parseResult.success) {
    console.error("[adaptPlan] Zod parse failed:", parseResult.error.message);
    throw new Error("Il coach non è riuscito a generare un piano strutturato. Riprova con una richiesta più chiara.");
  }
  const parsed = parseResult.data;
  const now = new Date();
  const plan: TrainingPlan = {
    generatedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    startDate: currentPlan.startDate ?? computePlanStartDate(now),
    profileHash: profileHashForPlan(profile),
    weeks: parsed.weeks,
    rationale: parsed.rationale,
  };
  const validation = validatePlan(plan, profile);
  if (!validation.ok) {
    console.warn("[adaptPlan] Violazioni safety:", validation.issues.map(i => i.message).join(" | "));
    plan.rationale = plan.rationale + "\n\n[Validator] Avvertenze: " + validation.issues.map(i => i.message).join(" ");
  }
  return plan;
}
