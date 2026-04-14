import { getJSON, setJSON } from "./storage";
import { generateWeeklyReport } from "./coach/weeklyReport";
import { regenerateNextWeek } from "./coach/planGenerator";
import type { CoachFeedItem, TrainingPlan, UserProfile, UserGoal } from "./types";
import { buildCoachContext } from "./diaryContext";
import { hasApiKey } from "./gemini";
import { events } from "./events";

const LAST_REPORT_KEY = "last-weekly-report-date"; // YYYY-MM-DD

export async function maybeRunWeeklyReport(force = false): Promise<CoachFeedItem | null> {
  if (!hasApiKey()) return null;
  const today = new Date();
  const isMonday = today.getDay() === 1;
  if (!isMonday && !force) return null;

  const last = (await getJSON<string | null>(LAST_REPORT_KEY, null)) || "";
  const todayStr = today.toISOString().split("T")[0];
  if (last === todayStr && !force) return null;

  const profile = await getJSON<UserProfile | null>("user-profile", null);
  if (!profile) return null;

  const report = await generateWeeklyReport();
  const item: CoachFeedItem = {
    id: Date.now().toString(36),
    date: today.toISOString(),
    type: "weekly-report",
    title: "Report settimanale",
    severity: "info",
    content: [
      report.summary,
      "",
      `**Aderenza**: ${Math.round(report.adherencePct)}%`,
      `**Volume**: ${Object.entries(report.volumeByDiscipline).map(([k, v]) => `${k} ${v.actual_min}/${v.planned_min}min`).join(" · ")}`,
      `**Dolore**: ${report.painTrend}`,
      `**Sonno/Stanchezza**: ${report.sleepFatigueTrend}`,
      "",
      `**Settimana prossima**: ${report.adjustments}`,
    ].join("\n"),
  };

  const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
  feed.unshift(item);
  await setJSON("coach-feed", feed.slice(0, 200));
  await setJSON(LAST_REPORT_KEY, todayStr);

  // Rigenera piano prossime 2 settimane
  try {
    const goals = await getJSON<UserGoal[]>("user-goals", []);
    const ctx = await buildCoachContext({ daysBack: 14 });
    const currentPlan = await getJSON<TrainingPlan | null>("training-plan", null);
    const nextPlan = await regenerateNextWeek(profile, goals, currentPlan, ctx.recentDaysText);
    await setJSON("training-plan", nextPlan);
    events.emit("plan:updated", { at: new Date().toISOString() });

    const planUpdate: CoachFeedItem = {
      id: Date.now().toString(36) + "p",
      date: new Date().toISOString(),
      type: "plan-update",
      title: "Piano aggiornato",
      severity: "info",
      content: nextPlan.rationale,
    };
    const f2 = await getJSON<CoachFeedItem[]>("coach-feed", []);
    f2.unshift(planUpdate);
    await setJSON("coach-feed", f2.slice(0, 200));
  } catch (e) {
    console.error("[scheduler] plan regen failed", e);
  }

  return item;
}
