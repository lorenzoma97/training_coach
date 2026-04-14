import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { buildCoachContext, profileAsPrompt, goalsAsPrompt, planAsPrompt } from "../diaryContext";
import type { WeeklyReport } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, type BuildContext } from "./promptBuilder";

const schema = z.object({
  summary: z.string(),
  volumeByDiscipline: z.record(z.string(), z.object({
    planned_min: z.number(),
    actual_min: z.number(),
  })),
  painTrend: z.string(),
  sleepFatigueTrend: z.string(),
  adherencePct: z.number().min(0).max(100),
  adjustments: z.string(),
});

const schemaHint = `
{
  "summary": "2-3 frasi sulla settimana",
  "volumeByDiscipline": {
    "corsa": { "planned_min": 60, "actual_min": 55 },
    "forza_gambe": { "planned_min": 45, "actual_min": 45 }
  },
  "painTrend": "es. 'Pre: 1→1→2→1  Post: 0→1→1→0 — leggero aumento mercoledì'",
  "sleepFatigueTrend": "descrizione breve",
  "adherencePct": 0-100,
  "adjustments": "2-3 righe su cosa cambia settimana prossima"
}
`.trim();

export async function generateWeeklyReport(): Promise<WeeklyReport> {
  const ctx = await buildCoachContext({ daysBack: 7 });
  const userPrompt = `
PROFILO:
${profileAsPrompt(ctx.profile)}

OBIETTIVI:
${goalsAsPrompt(ctx.goals)}

PIANO ATTIVO:
${planAsPrompt(ctx.plan)}

SETTIMANA APPENA CONCLUSA (ultimi 7 giorni):
${ctx.recentDaysText}

Produci il report settimanale. Calcola tu i volumi sommando i minuti per tipo di sessione (corsa, forza_gambe, forza_upper, sport, mobilita).
Se il piano non copre una disciplina, planned_min = 0.
`.trim();

  const bCtx: BuildContext = {
    profile: ctx.profile,
    hasRunningGoal: ctx.goals.some(g => /corsa|run|km|gara/i.test(g.smartDescription)),
    hasStrengthInPlan: !!ctx.plan?.weeks.some(w => w.sessions.some(s => s.type.startsWith("forza"))),
    detectedConditions: extractConditionsFromProfile(ctx.profile),
  };
  const systemInstruction = PROMPTS.weeklyReport() + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 1500,
  });
  return schema.parse(raw);
}
