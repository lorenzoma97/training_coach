import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { buildCoachContext, profileAsPrompt, goalsAsPrompt, planAsPrompt, formatDaysForLLM } from "../diaryContext";
import type { SessionFeedback } from "../types";
import { checkLocalRedFlags } from "./safetyRules";

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

  const raw = await generateJSON<unknown>({
    systemInstruction: PROMPTS.sessionFeedback(),
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
