import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { buildCoachContext, profileAsPrompt, goalsAsPrompt, planAsPrompt, formatDaysForLLM, extractBodyComp } from "../diaryContext";
import type { SessionFeedback } from "../types";
import { checkLocalRedFlags } from "./safetyRules";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext, type WorkoutTypeId } from "./promptBuilder";

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

export async function analyzeSession(params: {
  workoutDate: string;
  workout: any;
}): Promise<SessionFeedback> {
  const ctx = await buildCoachContext({ daysBack: 7 });

  // Red flag locali (heuristics client-side — utili se la rete fallisce)
  const local = checkLocalRedFlags({
    workout: params.workout,
    last7Days: ctx.recentDaysRaw,
    profile: ctx.profile ? { age: ctx.profile.age } : null,
  });

  const workoutLine = formatDaysForLLM([{
    date: params.workoutDate,
    daily: null,
    workouts: [params.workout],
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

  const rpeNum = Number(params.workout.rpe) || 0;

  // Guard esplicito: workoutType deve essere uno degli id enumerati
  const validTypes: WorkoutTypeId[] = ["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"];
  const wt: WorkoutTypeId | undefined = validTypes.includes(params.workout.type as WorkoutTypeId)
    ? (params.workout.type as WorkoutTypeId)
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
    currentCadence: params.workout.fields?.cadenza ? Number(params.workout.fields.cadenza) : null,
    detectedConditions: extractConditionsFromProfile(ctx.profile),
  };
  const systemInstruction = PROMPTS.sessionFeedback() + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 600,
  });
  const parsed = schema.parse(raw);

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
