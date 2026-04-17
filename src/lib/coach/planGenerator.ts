import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { profileAsPrompt, goalsAsPrompt, planAsPrompt, getLastNDays } from "../diaryContext";
import type { UserProfile, UserGoal, TrainingPlan, PlanWeek } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "./promptBuilder";
import { validatePlan, planStateHash, computePlanStartDate } from "./planValidator";
import { computeZonesContext } from "./zones";

const sessionSchema = z.object({
  day: z.enum(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]),
  type: z.enum(["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"]),
  subtype: z.string().optional(),
  duration_min: z.number().int().min(5).max(240),
  details: z.string(),
  rationale: z.string(),
  // Zona FC target 1-5 (obbligatoria per tipi cardio, omessa per forza/mobilita).
  // Il frontend renderizza il range bpm calcolato dinamicamente dalle zone
  // personalizzate dell'utente — qui serve solo la prescrizione logica.
  zone: z.number().int().min(1).max(5).optional(),
});

const weekSchema = z.object({
  weekNumber: z.number().int().min(1),
  focus: z.string(),
  sessions: z.array(sessionSchema),
});

// Accettiamo 1-4 per retrocompatibilità con piani esistenti in localStorage,
// ma i nuovi generate/regenerate/adapt producono sempre 1 sola settimana (vedi
// schemaHint + prompt). Le settimane extra eventualmente prodotte dal modello
// vengono tollerate ma il flusso standard si basa su 1 settimana + rigenerazione
// automatica al lunedì successivo.
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
          "details": "descrizione breve senza numeri FC (es. 'conversazionale, passo libero'). NON scrivere range bpm — il frontend li calcola.",
          "rationale": "perché questa sessione qui",
          "zone": 1|2|3|4|5 (OBBLIGATORIO per corsa e sport; OMETTI per forza_gambe/forza_upper/mobilita)
        }
      ]
    }
  ],
  "rationale": "2-3 frasi che spiegano la logica del piano (settimana singola)"
}
IMPORTANTE: l'array "weeks" deve contenere UNA SOLA settimana con weekNumber=1.
ZONE: per ogni sessione cardio (corsa/sport) indica la zona target 1-5 nel campo "zone" (1=Recovery, 2=Easy/Fondo Lento, 3=Tempo, 4=Threshold/Soglia, 5=VO2max/Ripetute brevi). NON inserire numeri bpm nei "details": il frontend mostra il range corretto dalle zone personalizzate dell'utente. Scrivi solo la descrizione qualitativa (passo, sensazione, struttura).
`.trim();

/**
 * Map dei weeks Zod→PlanWeek[]. Serve perché Zod tipa `zone` come `number`
 * mentre PlannedSession.zone è `1 | 2 | 3 | 4 | 5`. La narrowing la fa
 * il schema (min 1 / max 5), il cast qui è sicuro.
 */
function coerceWeeks(weeks: z.infer<typeof planSchema>["weeks"]): PlanWeek[] {
  return weeks.map(w => ({
    weekNumber: w.weekNumber,
    focus: w.focus,
    sessions: w.sessions.map(s => ({
      day: s.day,
      type: s.type,
      subtype: s.subtype,
      duration_min: s.duration_min,
      details: s.details,
      rationale: s.rationale,
      zone: s.zone as (1 | 2 | 3 | 4 | 5 | undefined),
    })),
  }));
}

export async function generateInitialPlan(
  profile: UserProfile,
  goals: UserGoal[],
): Promise<TrainingPlan> {
  // Zone FC personalizzate: onboarding ha storico nullo → Tanaka. Carichiamo
  // comunque per sicurezza (es. onboarding ripetuto con diario esistente).
  const recentDaysForZones = await getLastNDays(60).catch(() => []);
  const zonesCtxInit = computeZonesContext(profile, recentDaysForZones);
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVI:
${goalsAsPrompt(goals)}

Genera la SETTIMANA 1 del piano (una sola settimana, weekNumber=1) che porti l'utente verso gli obiettivi rispettando vincoli e sicurezza. La settimana successiva sarà rigenerata lunedì prossimo sulla base dei dati reali del diario, non anticiparla ora.
`.trim();

  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    // Il piano generato include sempre forza 2-3x/sett (see Rønnestad 2014); teniamo true per
    // attivare il modulo strengthForEndurance quando il contesto corsa è presente.
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
    zones: zonesCtxInit?.zones ?? undefined,
    zonesTimeInZone: zonesCtxInit?.timeInZone,
    zonesPolar: zonesCtxInit?.polar,
    zonesTotalSessions: zonesCtxInit?.totalSessions,
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 1800,
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
    profileHash: planStateHash(profile, goals),
    weeks: coerceWeeks(parsed.weeks),
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

Genera la NUOVA settimana (weekNumber=1, una sola) a partire dalla settimana prossima, adattando in base ad aderenza, trend dolore/fatica, e risposta al carico osservati.
Se rilevi red flag, proponi deload esplicito.
`.trim();

  const recentDaysForZonesRegen = await getLastNDays(60).catch(() => []);
  const zonesCtxRegen = computeZonesContext(profile, recentDaysForZonesRegen);
  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    // Il piano generato include sempre forza 2-3x/sett (see Rønnestad 2014); teniamo true per
    // attivare il modulo strengthForEndurance quando il contesto corsa è presente.
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
    zones: zonesCtxRegen?.zones ?? undefined,
    zonesTimeInZone: zonesCtxRegen?.timeInZone,
    zonesPolar: zonesCtxRegen?.polar,
    zonesTotalSessions: zonesCtxRegen?.totalSessions,
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 1800,
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
    profileHash: planStateHash(profile, goals),
    weeks: coerceWeeks(parsed.weeks),
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

Rispondi con il piano MODIFICATO completo (UNA settimana, weekNumber=1, tutte le sessioni). Il "rationale" DEVE menzionare esplicitamente cosa è cambiato rispetto al piano precedente e perché.
`.trim();

  const recentDaysForZonesAdapt = await getLastNDays(60).catch(() => []);
  const zonesCtxAdapt = computeZonesContext(profile, recentDaysForZonesAdapt);
  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
    zones: zonesCtxAdapt?.zones ?? undefined,
    zonesTimeInZone: zonesCtxAdapt?.timeInZone,
    zonesPolar: zonesCtxAdapt?.polar,
    zonesTotalSessions: zonesCtxAdapt?.totalSessions,
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 1800,
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
    profileHash: planStateHash(profile, goals),
    weeks: coerceWeeks(parsed.weeks),
    rationale: parsed.rationale,
  };
  const validation = validatePlan(plan, profile);
  if (!validation.ok) {
    console.warn("[adaptPlan] Violazioni safety:", validation.issues.map(i => i.message).join(" | "));
    plan.rationale = plan.rationale + "\n\n[Validator] Avvertenze: " + validation.issues.map(i => i.message).join(" ");
  }
  return plan;
}
