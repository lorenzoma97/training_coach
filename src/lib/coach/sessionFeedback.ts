import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { buildCoachContext, profileAsPrompt, goalsAsPrompt, planAsPrompt, formatDaysForLLM, extractBodyComp, type Workout } from "../diaryContext";
import type { SessionFeedback } from "../types";
import { checkLocalRedFlags } from "./safetyRules";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext, type WorkoutTypeId } from "./promptBuilder";
import { computeZonesContext } from "./zones";

const schema = z.object({
  howItWent: z.string(),
  signalsToMonitor: z.string(),
  whatToDoNext: z.string(),
  redFlags: z.array(z.string()).default([]),
  severity: z.enum(["info", "warn", "danger"]).default("info"),
});

const schemaHint = `
{
  "howItWent": "1-2 frasi sulla sessione",
  "signalsToMonitor": "1-2 frasi su trend/segnali",
  "whatToDoNext": "1-2 frasi su cosa fare domani",
  "redFlags": ["stringhe descrittive, [] se nessuna"],
  "severity": "info" | "warn" | "danger"
}
`.trim();

// Type guard: valida shape minimo di Workout prima di inoltrarlo alla pipeline.
// Meglio di `workout: any` — evita errori runtime indecifrabili quando chi chiama
// passa oggetti parziali (es. draft non finalizzato) accedendo a `.fields.*` random.
// Nota: `fields` nel tipo Workout ufficiale è optional — qui lo RICHIEDIAMO perché
// analyzeSession non può fare nulla di utile senza (tutti i rami consultano fields).
function isValidWorkout(w: unknown): w is Workout & { fields: Record<string, unknown> } {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (typeof o.type !== "string" || !o.type) return false;
  if (!o.fields || typeof o.fields !== "object") return false;
  return true;
}

export async function analyzeSession(params: {
  workoutDate: string;
  workout: unknown;
}): Promise<SessionFeedback> {
  if (!isValidWorkout(params.workout)) {
    throw new Error(
      "Sessione non valida: mancano campi obbligatori (id, type, fields). Impossibile generare feedback."
    );
  }
  const workout = params.workout;
  const ctx = await buildCoachContext({ daysBack: 7 });

  // Zone FC personalizzate (Tanaka/Karvonen/Empirica) + tempo-per-zona + polar.
  // Usate per (a) sostituire soglia Tanaka fissa in checkLocalRedFlags,
  // (b) iniettare il blocco zones nel prompt LLM.
  const zonesCtx = computeZonesContext(ctx.profile, ctx.recentDaysRaw || []);
  const z2 = zonesCtx?.zones?.zones.find(x => x.index === 2);
  const zoneZ2 = z2 ? { low: z2.hrLow, high: z2.hrHigh } : undefined;

  // Red flag locali (heuristics client-side — utili se la rete fallisce)
  const local = checkLocalRedFlags({
    workout,
    last7Days: ctx.recentDaysRaw,
    profile: ctx.profile ? { age: ctx.profile.age } : null,
    zoneZ2,
  });

  const workoutLine = formatDaysForLLM([{
    date: params.workoutDate,
    daily: null,
    workouts: [workout],
  }]);

  const userPrompt = `
PROFILO:
${profileAsPrompt(ctx.profile)}

OBIETTIVI ATTIVI:
${goalsAsPrompt(ctx.goals)}

PIANO ATTIVO:
${planAsPrompt(ctx.plan)}

ULTIMI 7 GIORNI:
${ctx.recentDaysText}

SESSIONE APPENA SALVATA (${params.workoutDate}):
${workoutLine}

RED FLAG RILEVATI LOCALMENTE:
${local.reasons.length ? local.reasons.map(r => `- ${r}`).join("\n") : "(nessuno)"}

Dai feedback strutturato. Se ci sono red flag locali, includili in redFlags e alza severity di conseguenza (danger se dolore ≥3 o segnali rossi, warn altrimenti).
`.trim();

  const rpeNum = Number(workout.rpe) || 0;

  // Guard esplicito: workoutType deve essere uno degli id enumerati
  const validTypes: WorkoutTypeId[] = ["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"];
  const wt: WorkoutTypeId | undefined = validTypes.includes(workout.type as WorkoutTypeId)
    ? (workout.type as WorkoutTypeId)
    : undefined;

  // Calcola giorni alla gara più vicina (da obiettivi con deadline parsable)
  const daysToNearestRace = computeDaysToNearestRace(ctx.goals);

  const bc = extractBodyComp(ctx.recentDaysRaw);
  const bCtx: BuildContext = {
    profile: ctx.profile,
    bodyComp: bc.latest,
    bodyCompTrend7d: bc.trend7d,
    workoutType: wt,
    hasRunningGoal: ctx.goals.some(g => RUNNING_GOAL_RE.test((g.smartDescription || "") + " " + (g.kpi?.metric || ""))),
    hasStrengthInPlan: !!ctx.plan?.weeks.some(w => w.sessions.some(s => s.type.startsWith("forza"))),
    daysToNearestRace,
    lastSessionIntensity: rpeNum >= 8 ? "hard" : rpeNum >= 5 ? "moderate" : "light",
    currentCadence: workout.fields?.cadenza ? Number(workout.fields.cadenza) : null,
    detectedConditions: extractConditionsFromProfile(ctx.profile),
    zones: zonesCtx?.zones ?? undefined,
    zonesTimeInZone: zonesCtx?.timeInZone,
    zonesPolar: zonesCtx?.polar,
    zonesTotalSessions: zonesCtx?.totalSessions,
  };
  const systemInstruction = PROMPTS.sessionFeedback({ age: ctx.profile?.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 600,
  });
  const result = schema.safeParse(raw);
  const parsed = result.success ? result.data : {
    howItWent: "Ho ricevuto i dati della sessione ma non sono riuscito a strutturare un feedback completo. I red flag locali restano validi.",
    signalsToMonitor: "",
    whatToDoNext: "Riprova a salvare oppure chiedi al coach in chat.",
    redFlags: [],
    severity: (local.level === "none" ? "info" : local.level) as SessionFeedback["severity"],
  };
  if (!result.success) console.warn("[sessionFeedback] Zod parse failed:", result.error.message);

  // Garantisce che severity non sia mai sotto quella rilevata localmente
  const severityOrder = { info: 0, warn: 1, danger: 2 } as const;
  const localSev: SessionFeedback["severity"] = local.level === "none" ? "info" : local.level;
  if (severityOrder[localSev] > severityOrder[parsed.severity]) {
    parsed.severity = localSev;
  }

  const existingFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags : [];
  parsed.redFlags = Array.from(new Set([...existingFlags, ...local.reasons]));
  return parsed;
}

// Estrae la gara più vicina dagli obiettivi attivi. Parse best-effort su deadline libere.
function computeDaysToNearestRace(goals: Array<{ kpi?: { deadline?: string }; smartDescription?: string; status?: string }>): number | undefined {
  const now = Date.now();
  let minDays: number | undefined;
  for (const g of goals) {
    if (g.status && g.status !== "active") continue;
    const desc = (g.smartDescription || "").toLowerCase();
    const isRace = /gara|race|maratona|10k|5k|half|mezza/.test(desc);
    if (!isRace) continue;
    const deadline = g.kpi?.deadline;
    if (!deadline) continue;
    let date: Date | null = null;
    const iso = deadline.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    if (!date) {
      const weeks = deadline.match(/(\d+)\s*settim/i);
      if (weeks) date = new Date(now + Number(weeks[1]) * 7 * 24 * 3600 * 1000);
    }
    if (!date || isNaN(date.getTime())) continue;
    const days = Math.max(0, Math.round((date.getTime() - now) / (24 * 3600 * 1000)));
    if (minDays === undefined || days < minDays) minDays = days;
  }
  return minDays;
}
