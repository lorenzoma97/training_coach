import { getJSON } from "./storage";
import type { UserProfile, UserGoal, TrainingPlan } from "./types";

const WORKOUT_LABELS: Record<string, string> = {
  corsa: "Corsa",
  forza_gambe: "Forza Gambe",
  forza_upper: "Upper + Core",
  sport: "Sport",
  mobilita: "Mobilità / Recovery",
};

async function loadDay(date: string): Promise<any | null> {
  try {
    const r = localStorage.getItem(`day:${date}`);
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}

async function loadIndex(): Promise<string[]> {
  try {
    const r = localStorage.getItem("diary-index");
    return r ? JSON.parse(r) : [];
  } catch { return []; }
}

/** Ultimi N giorni ordinati crescente, con workouts e daily. */
export async function getLastNDays(n: number): Promise<Array<{ date: string; daily: any; workouts: any[] }>> {
  const idx = await loadIndex();
  const sorted = idx.sort((a, b) => b.localeCompare(a)).slice(0, n).sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const date of sorted) {
    const d = await loadDay(date);
    if (d) out.push({ date, daily: d.daily, workouts: d.workouts || [] });
  }
  return out;
}

export async function getAllDays() {
  const idx = await loadIndex();
  const sorted = idx.sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const date of sorted) {
    const d = await loadDay(date);
    if (d) out.push({ date, ...d });
  }
  return out;
}

/** Formato testuale leggibile per l'LLM, riuso lo stile dell'export TXT originale. */
export function formatDaysForLLM(days: Array<{ date: string; daily: any; workouts: any[] }>): string {
  if (!days.length) return "(nessun giorno registrato)";
  const lines: string[] = [];
  for (const day of days) {
    const dt = new Date(day.date + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
    lines.push(`── ${dt} (${day.date}) ──`);
    if (day.daily) {
      const d = day.daily;
      const parts: string[] = [];
      if (d.weight) parts.push(`peso ${d.weight}kg`);
      if (d.sleep) parts.push(`sonno ${d.sleep}h (${d.sleepQ || "n/a"})`);
      if (d.fatigue) parts.push(`stanchezza ${d.fatigue}/10`);
      if (d.meds) parts.push(`farmaci: ${d.meds}`);
      if (parts.length) lines.push(`  check: ${parts.join(", ")}`);
    }
    for (const w of day.workouts || []) {
      const label = WORKOUT_LABELS[w.type] || w.type;
      const f = w.fields || {};
      const details: string[] = [];
      if (f.durata_totale || f.durata) details.push(`${f.durata_totale || f.durata}min`);
      if (f.tipo || f.sport) details.push(f.tipo || f.sport);
      if (f.passo_medio) details.push(`passo ${f.passo_medio}`);
      if (f.fc_media) details.push(`FC ${f.fc_media}bpm`);
      if (f.fc_max) details.push(`FCmax ${f.fc_max}`);
      if (f.carico) details.push(`carico ${f.carico}`);
      if (f.kcal) details.push(`${f.kcal}kcal`);
      lines.push(`  • ${label}: ${details.join(", ")}`);
      const painBits: string[] = [];
      if (w.pain?.pre != null) painBits.push(`pre ${w.pain.pre}`);
      if (w.pain?.during != null) painBits.push(`dur ${w.pain.during}`);
      if (w.pain?.post != null) painBits.push(`post ${w.pain.post}`);
      if (painBits.length) lines.push(`    dolore polpaccio: ${painBits.join(" / ")}`);
      if (w.rpe) lines.push(`    RPE ${w.rpe}/10`);
      if (w.notes) lines.push(`    note: ${w.notes}`);
    }
  }
  return lines.join("\n");
}

/** Pacchetto di contesto riusato da tutti i prompt coach. */
export async function buildCoachContext(opts: { daysBack?: number } = {}): Promise<{
  profile: UserProfile | null;
  goals: UserGoal[];
  plan: TrainingPlan | null;
  recentDaysText: string;
  recentDaysRaw: Array<{ date: string; daily: any; workouts: any[] }>;
}> {
  const profile = await getJSON<UserProfile | null>("user-profile", null);
  const goals = await getJSON<UserGoal[]>("user-goals", []);
  const plan = await getJSON<TrainingPlan | null>("training-plan", null);
  const daysBack = opts.daysBack ?? 14;
  const recentDaysRaw = await getLastNDays(daysBack);
  const recentDaysText = formatDaysForLLM(recentDaysRaw);
  return { profile, goals, plan, recentDaysText, recentDaysRaw };
}

export function profileAsPrompt(p: UserProfile | null): string {
  if (!p) return "(profilo utente non ancora configurato)";
  return [
    `Età: ${p.age}, sesso: ${p.sex}, peso: ${p.weight_kg}kg, altezza: ${p.height_cm}cm.`,
    `Livello: ${p.experience}.`,
    `Disponibilità: ${p.weekly_availability.days} giorni/settimana, ${p.weekly_availability.hoursPerSession}h/sessione.`,
    p.injuries.length ? `Infortuni: ${p.injuries.join("; ")}.` : "Nessun infortunio riportato.",
    p.meds ? `Farmaci: ${p.meds}.` : "",
    p.equipment.length ? `Attrezzatura: ${p.equipment.join(", ")}.` : "",
    p.notes ? `Note: ${p.notes}.` : "",
  ].filter(Boolean).join(" ");
}

export function goalsAsPrompt(goals: UserGoal[]): string {
  if (!goals.length) return "(nessun obiettivo definito)";
  return goals
    .filter(g => g.status === "active")
    .map((g, i) => `${i + 1}. ${g.smartDescription} — KPI: ${g.kpi.metric} ${g.kpi.target} entro ${g.kpi.deadline}.`)
    .join("\n") || "(nessun obiettivo attivo)";
}

export function planAsPrompt(plan: TrainingPlan | null): string {
  if (!plan) return "(nessun piano attivo)";
  const header = `Piano generato ${plan.generatedAt}, valido fino a ${plan.validUntil}. Razionale: ${plan.rationale}`;
  const weeks = plan.weeks.map(w => {
    const sessions = w.sessions.map(s => `  - ${s.day}: ${s.type}${s.subtype ? ` (${s.subtype})` : ""}, ${s.duration_min}min — ${s.details}`).join("\n");
    return `Settimana ${w.weekNumber} (focus: ${w.focus}):\n${sessions}`;
  }).join("\n\n");
  return `${header}\n\n${weeks}`;
}
