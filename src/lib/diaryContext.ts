import { getJSON } from "./storage";
import type { UserProfile, UserGoal, TrainingPlan } from "./types";
import { stripInlineHRRange } from "./coach/zones";

const WORKOUT_LABELS: Record<string, string> = {
  corsa: "Corsa",
  forza_gambe: "Forza Gambe",
  forza_upper: "Upper + Core",
  sport: "Sport",
  mobilita: "Mobilità / Recovery",
};

async function loadDay(date: string): Promise<any | null> {
  return getJSON<any | null>(`day:${date}`, null);
}

async function loadIndex(): Promise<string[]> {
  return getJSON<string[]>("diary-index", []);
}

/** Estrae ultimi valori body composition da un array di giorni + trend 7 giorni. */
export function extractBodyComp(days: Array<{ daily: any }>): {
  latest: { bodyFat?: number; muscleMass?: number; bodyWater?: number };
  trend7d: { bodyFat?: number; muscleMass?: number; bodyWater?: number };
} {
  const toNum = (v: any): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  // Più recente: ultimo giorno con valore
  const findLatest = (field: "bodyFat" | "muscleMass" | "bodyWater") => {
    for (let i = days.length - 1; i >= 0; i--) {
      const v = toNum(days[i]?.daily?.[field]);
      if (v !== undefined) return { v, idx: i };
    }
    return null;
  };
  const findOlder = (field: string, beforeIdx: number) => {
    for (let i = beforeIdx - 1; i >= 0; i--) {
      const v = toNum(days[i]?.daily?.[field]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const latest = { bodyFat: undefined, muscleMass: undefined, bodyWater: undefined } as any;
  const trend7d = { bodyFat: undefined, muscleMass: undefined, bodyWater: undefined } as any;
  (["bodyFat", "muscleMass", "bodyWater"] as const).forEach(f => {
    const l = findLatest(f);
    if (l) {
      latest[f] = l.v;
      const older = findOlder(f, l.idx);
      if (older !== undefined) trend7d[f] = Math.round((l.v - older) * 10) / 10;
    }
  });
  return { latest, trend7d };
}

// Soglia per batching: sotto questa quota, Promise.all senza batching è OK.
// Sopra (es. diario 1+ anno su TrendsPage), batchiamo a 60 per volta per
// evitare picchi di parsing JSON che bloccano il main thread.
const BATCH_SIZE = 60;

async function loadDaysBatched(dates: string[]): Promise<Array<{ date: string; d: any }>> {
  if (dates.length <= BATCH_SIZE) {
    return Promise.all(dates.map(date => loadDay(date).then(d => ({ date, d }))));
  }
  const out: Array<{ date: string; d: any }> = [];
  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const chunk = dates.slice(i, i + BATCH_SIZE);
    const loaded = await Promise.all(chunk.map(date => loadDay(date).then(d => ({ date, d }))));
    out.push(...loaded);
    // Yield al main thread tra batch (microtask) — permette al browser di
    // fare altri lavori pendenti (input, paint) prima del prossimo chunk.
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
}

/** Ultimi N giorni ordinati crescente, con workouts e daily. */
export async function getLastNDays(n: number): Promise<Array<{ date: string; daily: any; workouts: any[] }>> {
  const idx = await loadIndex();
  const sorted = idx.sort((a, b) => b.localeCompare(a)).slice(0, n).sort((a, b) => a.localeCompare(b));
  const loaded = await loadDaysBatched(sorted);
  return loaded
    .filter(({ d }) => d != null)
    .map(({ date, d }) => ({ date, daily: d.daily, workouts: d.workouts || [] }));
}

export async function getAllDays() {
  const idx = await loadIndex();
  const sorted = idx.sort((a, b) => a.localeCompare(b));
  const loaded = await loadDaysBatched(sorted);
  return loaded
    .filter(({ d }) => d != null)
    .map(({ date, d }) => ({ date, ...d }));
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
      if (d.morningHR) parts.push(`FC riposo mattut. ${d.morningHR}bpm`);
      if (d.morningFreshness) parts.push(`freschezza ${d.morningFreshness}/10`);
      if (d.meds) parts.push(`farmaci: ${d.meds}`);
      if (d.bodyFat) parts.push(`BF ${d.bodyFat}%`);
      if (d.muscleMass) parts.push(`massa musc ${d.muscleMass}`);
      if (d.bodyWater) parts.push(`TBW ${d.bodyWater}%`);
      if (d.cyclePhase) parts.push(`ciclo: ${d.cyclePhase}`);
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
      // Supporta entrambi i formati: legacy {pre,during,post} e nuovo {[area]:{pre,during,post}}
      if (w.pain && typeof w.pain === "object") {
        const isLegacy = "pre" in w.pain || "during" in w.pain || "post" in w.pain;
        const entries: Array<[string, any]> = isLegacy
          ? [["polpaccio", w.pain]]
          : Object.entries(w.pain as Record<string, any>);
        for (const [area, v] of entries) {
          if (!v || typeof v !== "object") continue;
          const bits: string[] = [];
          if (v.pre != null) bits.push(`pre ${v.pre}`);
          if (v.during != null) bits.push(`dur ${v.during}`);
          if (v.post != null) bits.push(`post ${v.post}`);
          if (bits.length) lines.push(`    dolore ${area}: ${bits.join(" / ")}`);
        }
      }
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
  const active = goals
    .filter(g => g.status === "active")
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  if (!active.length) return "(nessun obiettivo attivo)";
  return active
    .map((g, i) => {
      const prio = g.priority ? ` [priorità: ${g.priority}]` : "";
      return `${i + 1}. ${g.smartDescription} — KPI: ${g.kpi.metric} ${g.kpi.target} entro ${g.kpi.deadline}.${prio}`;
    })
    .join("\n");
}

export function planAsPrompt(plan: TrainingPlan | null): string {
  if (!plan) return "(nessun piano attivo)";
  const header = `Piano generato ${plan.generatedAt}, valido fino a ${plan.validUntil}. Razionale: ${plan.rationale}`;
  const weeks = plan.weeks.map(w => {
    const sessions = w.sessions.map(s => {
      // Strip di eventuali range bpm inline dai details (piani legacy) per
      // evitare che l'LLM riscriva numeri stale copiandoli dal piano corrente.
      const cleanDetails = stripInlineHRRange(s.details);
      const zoneTag = s.zone ? ` [Z${s.zone}]` : "";
      return `  - ${s.day}: ${s.type}${s.subtype ? ` (${s.subtype})` : ""}${zoneTag}, ${s.duration_min}min — ${cleanDetails}`;
    }).join("\n");
    return `Settimana ${w.weekNumber} (focus: ${w.focus}):\n${sessions}`;
  }).join("\n\n");
  return `${header}\n\n${weeks}`;
}
