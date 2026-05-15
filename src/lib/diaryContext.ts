import { getJSON } from "./storage";
import type { UserProfile, UserGoal, TrainingPlan, ExercisePerformance } from "./types";
import { stripInlineHRRange } from "./coach/zones";
import { sanitizePII, sanitizePIIList } from "./promptSanitizer";

const WORKOUT_LABELS: Record<string, string> = {
  corsa: "Corsa",
  forza_gambe: "Forza Gambe",
  forza_upper: "Upper + Core",
  sport: "Sport",
  mobilita: "Mobilità / Recovery",
};

/**
 * Shape permissiva del check quotidiano. Molti campi sono stringhe perché
 * provengono da input HTML non-coercizzati (es. `"72"` invece di `72`).
 * Usiamo `Record<string, unknown>` con campi noti facoltativi: tipizziamo
 * quello che effettivamente leggiamo/scriviamo, senza forzare una shape
 * chiusa che rigetti i valori legacy.
 */
export interface DailyCheck {
  weight?: string | number;
  sleep?: string | number;
  sleepQ?: string;
  fatigue?: number | null;
  meds?: string;
  bodyFat?: string | number;
  muscleMass?: string | number;
  bodyWater?: string | number;
  morningHR?: string | number;
  morningFreshness?: number | null;
  cyclePhase?: string;
  [key: string]: unknown;
}

/** Struttura minimale di un workout salvato a diario. Volutamente permissiva. */
export interface Workout {
  id: string;
  type: string;
  fields?: Record<string, unknown>;
  rpe?: number | null;
  pain?: Record<string, unknown>;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  /**
   * v2 (Wave 2.1, ARCHITECTURE.md §2.M, I8): performance forza strutturate
   * PARALLELE al legacy `fields.note`. Lettori v2 leggono da qui se presente,
   * altrimenti fallback parser regex su `fields.note`. Mai sostituiamo
   * `fields` (lettore v1 deve continuare a funzionare).
   */
  exercises?: ExercisePerformance[];
}

/** Giorno completo: check quotidiano + lista workout. `null` se giorno mai aperto. */
export interface DiaryDay {
  daily: DailyCheck | null;
  workouts: Workout[];
}

/** Type guard: `v` è un oggetto (non-null, non-array). */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normalizza un valore raw in `DiaryDay` | null. Accetta shape legacy/parziali. */
function normalizeDay(raw: unknown): DiaryDay | null {
  if (!isObject(raw)) return null;
  const dailyRaw = raw["daily"];
  const workoutsRaw = raw["workouts"];
  const daily: DailyCheck | null = isObject(dailyRaw) ? (dailyRaw as DailyCheck) : null;
  const workouts: Workout[] = Array.isArray(workoutsRaw)
    ? (workoutsRaw.filter(isObject) as unknown as Workout[])
    : [];
  return { daily, workouts };
}

async function loadDay(date: string): Promise<DiaryDay | null> {
  const raw = await getJSON<unknown>(`day:${date}`, null);
  return normalizeDay(raw);
}

async function loadIndex(): Promise<string[]> {
  return getJSON<string[]>("diary-index", []);
}

/** Estrae ultimi valori body composition da un array di giorni + trend 7 giorni. */
export function extractBodyComp(days: Array<{ daily: DailyCheck | null }>): {
  latest: { bodyFat?: number; muscleMass?: number; bodyWater?: number };
  trend7d: { bodyFat?: number; muscleMass?: number; bodyWater?: number };
} {
  const toNum = (v: unknown): number | undefined => {
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
  const findOlder = (field: "bodyFat" | "muscleMass" | "bodyWater", beforeIdx: number) => {
    for (let i = beforeIdx - 1; i >= 0; i--) {
      const v = toNum(days[i]?.daily?.[field]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const latest: { bodyFat?: number; muscleMass?: number; bodyWater?: number } = {};
  const trend7d: { bodyFat?: number; muscleMass?: number; bodyWater?: number } = {};
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

async function loadDaysBatched(dates: string[]): Promise<Array<{ date: string; d: DiaryDay | null }>> {
  if (dates.length <= BATCH_SIZE) {
    return Promise.all(dates.map(date => loadDay(date).then(d => ({ date, d }))));
  }
  const out: Array<{ date: string; d: DiaryDay | null }> = [];
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
export async function getLastNDays(
  n: number,
): Promise<Array<{ date: string; daily: DailyCheck | null; workouts: Workout[] }>> {
  const idx = await loadIndex();
  const sorted = idx.sort((a, b) => b.localeCompare(a)).slice(0, n).sort((a, b) => a.localeCompare(b));
  const loaded = await loadDaysBatched(sorted);
  const out: Array<{ date: string; daily: DailyCheck | null; workouts: Workout[] }> = [];
  for (const { date, d } of loaded) {
    if (d == null) continue;
    out.push({ date, daily: d.daily, workouts: d.workouts });
  }
  return out;
}

export async function getAllDays(): Promise<Array<{ date: string; daily: DailyCheck | null; workouts: Workout[] }>> {
  const idx = await loadIndex();
  const sorted = idx.sort((a, b) => a.localeCompare(b));
  const loaded = await loadDaysBatched(sorted);
  const out: Array<{ date: string; daily: DailyCheck | null; workouts: Workout[] }> = [];
  for (const { date, d } of loaded) {
    if (d == null) continue;
    out.push({ date, daily: d.daily, workouts: d.workouts });
  }
  return out;
}

/** Formato testuale leggibile per l'LLM, riuso lo stile dell'export TXT originale.
 *  `activePainAreas` (opzionale): se passato, filtra le righe "dolore X" includendo
 *  SOLO le aree ancora in tracking dal profilo + le righe con valore > 0. Evita di
 *  trascinare dolori "risolti" (es. polpaccio rimosso dagli infortuni) come segnale
 *  attivo nel context LLM. Se omesso, mostra tutte le aree (retrocompat).
 */
export function formatDaysForLLM(
  days: Array<{ date: string; daily: DailyCheck | null; workouts: Workout[] }>,
  activePainAreas?: string[],
): string {
  if (!days.length) return "(nessun giorno registrato)";
  const lines: string[] = [];
  // Utility per stringify sicura di valori primitivi/scalari noti.
  const asStr = (v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  };
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
      if (d.meds) parts.push(`farmaci: ${sanitizePII(String(d.meds))}`);
      if (d.bodyFat) parts.push(`BF ${d.bodyFat}%`);
      if (d.muscleMass) parts.push(`massa musc ${d.muscleMass}`);
      if (d.bodyWater) parts.push(`TBW ${d.bodyWater}%`);
      if (d.cyclePhase) parts.push(`ciclo: ${d.cyclePhase}`);
      if (parts.length) lines.push(`  check: ${parts.join(", ")}`);
    }
    for (const w of day.workouts || []) {
      const label = WORKOUT_LABELS[w.type] || w.type;
      const f: Record<string, unknown> = w.fields || {};
      const details: string[] = [];
      const durata = asStr(f.durata_totale) ?? asStr(f.durata);
      if (durata) details.push(`${durata}min`);
      const tipo = asStr(f.tipo) ?? asStr(f.sport);
      if (tipo) details.push(tipo);
      const passo = asStr(f.passo_medio);
      if (passo) details.push(`passo ${passo}`);
      const fcMedia = asStr(f.fc_media);
      if (fcMedia) details.push(`FC ${fcMedia}bpm`);
      const fcMax = asStr(f.fc_max);
      if (fcMax) details.push(`FCmax ${fcMax}`);
      const carico = asStr(f.carico);
      if (carico) details.push(`carico ${carico}`);
      const kcal = asStr(f.kcal);
      if (kcal) details.push(`${kcal}kcal`);
      lines.push(`  • ${label}: ${details.join(", ")}`);
      // Supporta entrambi i formati: legacy {pre,during,post} e nuovo {[area]:{pre,during,post}}
      if (w.pain && isObject(w.pain)) {
        const painObj = w.pain as Record<string, unknown>;
        const isLegacy = "pre" in painObj || "during" in painObj || "post" in painObj;
        const entries: Array<[string, unknown]> = isLegacy
          ? [["polpaccio", painObj]]
          : Object.entries(painObj);
        const activeSet = activePainAreas ? new Set(activePainAreas.map(a => a.toLowerCase())) : null;
        for (const [area, v] of entries) {
          if (!isObject(v)) continue;
          // Skip aree non più tracciate dall'utente, A MENO CHE non ci siano valori > 0:
          // un dolore reale registrato in passato resta visibile (informa il coach), ma
          // i "0/0/0" stale di un'area disattivata vengono filtrati.
          const valsNum = [v.pre, v.during, v.post].map(x => typeof x === "number" ? x : null);
          const maxVal = Math.max(0, ...valsNum.filter((x): x is number => x !== null));
          if (activeSet && !activeSet.has(area.toLowerCase()) && maxVal === 0) continue;
          const bits: string[] = [];
          if (v.pre != null) bits.push(`pre ${String(v.pre)}`);
          if (v.during != null) bits.push(`dur ${String(v.during)}`);
          if (v.post != null) bits.push(`post ${String(v.post)}`);
          if (bits.length) lines.push(`    dolore ${area}: ${bits.join(" / ")}`);
        }
      }
      if (w.rpe) lines.push(`    RPE ${w.rpe}/10`);
      if (w.notes) lines.push(`    note: ${sanitizePII(w.notes)}`);
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
  recentDaysRaw: Array<{ date: string; daily: DailyCheck | null; workouts: Workout[] }>;
}> {
  const profile = await getJSON<UserProfile | null>("user-profile", null);
  const goals = await getJSON<UserGoal[]>("user-goals", []);
  const plan = await getJSON<TrainingPlan | null>("training-plan", null);
  const daysBack = opts.daysBack ?? 14;
  const recentDaysRaw = await getLastNDays(daysBack);
  // Filtra pain history per le aree ANCORA tracciate. Se l'utente ha rimosso
  // un'area (es. polpaccio risolto), dolori 0/0/0 stale vengono esclusi dal
  // context LLM — evita che il coach proponga adattamenti per infortuni passati.
  const recentDaysText = formatDaysForLLM(recentDaysRaw, profile?.painTrackingAreas);
  return { profile, goals, plan, recentDaysText, recentDaysRaw };
}

/**
 * Mappa aree dolore/infortunio comuni a sostituzioni concrete (cardio +
 * forza) che il coach DEVE proporre al posto di esercizi controindicati.
 * Senza questo, il prompt segnalava "infortunio polpaccio" ma il modello
 * proponeva comunque corsa intensa, lasciando all'utente l'adattamento.
 *
 * Match keyword case-insensitive contro `painTrackingAreas` + `injuries`.
 * Restituisce stringa pronta per il prompt; "" se nessun match.
 */
const PAIN_SUBSTITUTIONS: Array<{ keywords: string[]; avoid: string; substitute: string }> = [
  {
    keywords: ["polpaccio", "calf", "soleo", "gastrocnemio"],
    avoid: "corsa Z3-Z5, ripetute, salite, plyometric, salti",
    substitute: "bici (easy/Z2), nuoto, ellittica, vogatore. Corsa Z2 leggera ammessa solo se dolore ≤2 e trend stabile o in calo",
  },
  {
    keywords: ["ginocchio", "knee", "patella", "rotuleo"],
    avoid: "squat profondi pesanti, corsa downhill, salti, lunges profondi",
    substitute: "bici (sella alta, no salita pesante), nuoto, leg press parziale, leg curl",
  },
  {
    keywords: ["caviglia", "ankle"],
    avoid: "corsa, salti, agility, cambi direzione",
    substitute: "bici, nuoto upper-body, vogatore, pulley/curl/press in stazione",
  },
  {
    keywords: ["achille", "tendine d'achille", "achilles"],
    avoid: "corsa, salti, eccentriche calf, sprint",
    substitute: "bici (cadenza alta, basso sforzo), nuoto, eccentriche calf ISOMETRICHE solo se dolore ≤1",
  },
  {
    keywords: ["schiena", "lombare", "lower back", "sciatica"],
    avoid: "deadlift, squat pesanti, addominali con flessione (sit-up, crunch), iperestensioni",
    substitute: "nuoto (NO rana), camminata, McGill big-3 (bird-dog, side-plank, curl-up), cinghia/cavi senza flessione spinale",
  },
  {
    keywords: ["spalla", "shoulder", "cuffia"],
    avoid: "panca, military press, pull-up, lat machine pesante, push-up profondi",
    substitute: "corsa, bici, esercizi cuffia rotatori (resistance band external rotation), face-pull leggero",
  },
  {
    keywords: ["anca", "hip", "psoas"],
    avoid: "corsa intensa, lunges profondi, salti, abductor pesanti",
    substitute: "bici (easy), nuoto, glute bridge, clamshell, mobilità anca dinamica",
  },
];

function painSubstitutionsHint(p: UserProfile): string {
  const haystack = [
    ...(p.painTrackingAreas || []),
    ...(p.injuries || []),
  ].join(" ").toLowerCase();
  if (!haystack.trim()) return "";
  const matched = PAIN_SUBSTITUTIONS.filter(s =>
    s.keywords.some(k => haystack.includes(k.toLowerCase())),
  );
  if (matched.length === 0) return "";
  const lines = matched.map(s =>
    `  - ${s.keywords[0]}: EVITA ${s.avoid}. SOSTITUISCI con ${s.substitute}.`,
  );
  return `SOSTITUZIONI ATTIVE per aree con dolore/infortunio dichiarato (regole hardcoded, non negoziabili):\n${lines.join("\n")}`;
}

export function profileAsPrompt(p: UserProfile | null): string {
  if (!p) return "(profilo utente non ancora configurato)";
  // Disponibilità: stringify esplicito di entrambi i numeri + commento "MAX
  // assoluto per sessione" — l'LLM tendeva a sforare hoursPerSession su sessioni
  // intense (es. "60min long run + 20min mobilità" su availability=60min).
  const minPerSession = Math.round((p.weekly_availability.hoursPerSession ?? 1) * 60);
  // painTrackingAreas: se un'area è stata RIMOSSA dall'utente, NON deve apparire
  // qui — il filtro a monte (formatDaysForLLM con activePainAreas) si occupa del
  // cleanup nelle entry diario, ma l'LLM beneficia anche di una dichiarazione
  // esplicita "non monitorata" così non inferisce dal contesto storico.
  const trackingLine = p.painTrackingAreas && p.painTrackingAreas.length > 0
    ? `Zone dolore monitorate attualmente: ${p.painTrackingAreas.join(", ")}.`
    : "Nessuna zona dolore monitorata attualmente (eventuali infortuni passati sono risolti).";
  // availableDays: se popolato è vincolo HARD (override per-rigen viene passato
  // separatamente via param da planGenerator e ha precedenza). Se undefined,
  // l'LLM è libero di scegliere i giorni → comportamento retrocompat.
  const availableDaysLine = p.availableDays && p.availableDays.length > 0
    ? `Giorni allenabili (vincolo HARD: prescrivi sessioni SOLO in questi giorni): ${p.availableDays.join(", ")}.`
    : "";
  // intensityPreference: ridotto a label semplice (2026-05-13 architect-specialist).
  // I dettagli prescrittivi (volume, zone, forza) sono ora calcolati pre-LLM
  // dalla pure function `computePrescription` (trainingPrescription.ts) e
  // iniettati nel prompt dal planGenerator come blocco "PRESCRIZIONE TARGET".
  // Mantenere qui label brevi evita duplicazione e mantiene "single source of
  // truth" sui numeri.
  const intensityLabels: Record<NonNullable<UserProfile["intensityPreference"]>, string> = {
    soft: "soft",
    balanced: "balanced",
    intense: "intense",
    very_intense: "very_intense",
  };
  const intensityLine = p.intensityPreference
    ? `Preferenza intensità: ${intensityLabels[p.intensityPreference]}.`
    : "";
  // NB: i vincoli HARD (max minuti/sessione, attrezzatura, giorni allenabili)
  // sono dichiarati una volta sola nel system prompt PROMPTS.planGeneration.
  // Qui esponiamo solo i VALORI del profilo, senza ripetere la formula
  // "vincolo HARD: NON sforare" (era duplicata, ~2KB token wasted/regen).
  return [
    `Età: ${p.age}, sesso: ${p.sex}, peso: ${p.weight_kg}kg, altezza: ${p.height_cm}cm.`,
    `Livello: ${p.experience}.`,
    `Disponibilità: ${p.weekly_availability.days} giorni/settimana, max ${minPerSession} min/sessione.`,
    intensityLine,
    availableDaysLine,
    p.injuries.length ? `Infortuni attivi: ${sanitizePIIList(p.injuries).join("; ")}.` : "Nessun infortunio attivo riportato.",
    trackingLine,
    painSubstitutionsHint(p),
    p.meds ? `Farmaci: ${sanitizePII(p.meds)}.` : "",
    p.equipment.length
      ? `Attrezzatura disponibile: ${p.equipment.join(", ")}.`
      : "Nessuna attrezzatura dichiarata (solo corpo libero, corsa outdoor, mobilità).",
    p.notes ? `Note: ${sanitizePII(p.notes)}.` : "",
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
      return `${i + 1}. ${sanitizePII(g.smartDescription)} — KPI: ${g.kpi.metric} ${g.kpi.target} entro ${g.kpi.deadline}.${prio}`;
    })
    .join("\n");
}

/**
 * Tournament cluster context (Wave C2 audit 2).
 *
 * Tornei game-sport (padel/tennis weekend, 3-4 match in 2gg) richiedono
 * periodizzazione diversa da race singola: deload pre-torneo identico, ma
 * inter-match recovery + multi-day cluster strategy.
 *
 * Detection: race priority="A" nei prossimi 14gg con name contenente
 * "torneo"/"tournament"/"tournoi"/"slam"/"open". Backward compat totale:
 * niente cambi schema, solo keyword match su nome user-input.
 *
 * Output: blocco prompt con protocollo specifico tournament. Stringa
 * vuota se nessun torneo imminente.
 */
export function tournamentClusterContext(profile: UserProfile | null): string {
  if (!profile?.races || profile.races.length === 0) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const TOURNAMENT_KEYWORDS = ["torneo", "tournament", "tournoi", "slam", "open", "campionato", "championship"];
  const tournamentRace = profile.races.find(r => {
    if (r.priority !== "A") return false;
    if (!r.date) return false;
    const dt = new Date(`${r.date}T00:00:00`).getTime();
    if (Number.isNaN(dt)) return false;
    const days = Math.floor((dt - today.getTime()) / 86400000);
    if (days < 0 || days > 14) return false;
    const name = (r.name || "").toLowerCase();
    return TOURNAMENT_KEYWORDS.some(k => name.includes(k));
  });
  if (!tournamentRace) return "";
  const daysToStart = Math.floor((new Date(`${tournamentRace.date}T00:00:00`).getTime() - today.getTime()) / 86400000);
  return [
    `TOURNAMENT MODE (torneo "${tournamentRace.name}" inizia tra ${daysToStart}gg, ${tournamentRace.sport}):`,
    `- I tornei game-sport richiedono periodizzazione cluster (multi-match in 2-3gg consecutivi). Diverso da race singola.`,
    `- Settimana PRE-torneo: deload completo (-50% volume), preserva intensità tecnica/skill, NIENTE Z4-Z5, NIENTE forza pesante. Rifinitura skill 2-3 sessioni 30-45min RPE 3-5.`,
    `- Inter-match SAME DAY (es. quarti 10:00 + semi 16:00): tra i match prevedere finestra recovery 4-6h con (a) snack 30-50g carbs entro 30min post-match, (b) idratazione attiva (300-500ml + elettroliti), (c) doccia tiepida + leggero camminato 10min, (d) NO stretching aggressivo prima del prossimo match.`,
    `- Inter-day (es. sabato match + domenica match): la sera dopo il match → cena ricca carbs (1-1.5g/kg) + proteine (0.3g/kg). Mattina dopo → colazione 1-2h prima del match, warm-up specifico ridotto a 8-10min (no allunghi sprint, già attivato dal giorno prima).`,
    `- Settimana POST-torneo: 5-7gg easy/recovery (Z1-Z2 solo, niente forza pesante, focus su mobility e sonno). Soligard 2016: rischio infortuno post-tournament alto se ripresa volume troppo rapida.`,
  ].join("\n");
}

/**
 * Race-day execution plan (Wave C1 audit 2).
 *
 * Coach pro endurance fornisce nei 7-14gg pre-gara A: pacing strategy,
 * nutrition window, warm-up race-day execution. Tool oggi gestisce solo
 * il taper (volume reduction Bosquet 2007) ma non l'esecuzione operativa.
 *
 * Helper: cerca race priority="A" nei prossimi 14gg dal profilo.
 * Se trovata, genera blocco con:
 *  - Pacing: target pace + indicazioni negative-split
 *  - Nutrition: carb-loading 48h, pasto pre-gara, durante (se >75min)
 *  - Warm-up race-day: 15-20 min protocollo standardizzato
 *
 * Iniettato nel prompt SOLO se race A imminente. Altrimenti stringa vuota.
 */
export function raceDayExecutionContext(profile: UserProfile | null): string {
  if (!profile?.races || profile.races.length === 0) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const within14d = profile.races.filter(r => {
    if (r.priority !== "A") return false;
    if (!r.date) return false;
    const dt = new Date(`${r.date}T00:00:00`).getTime();
    if (Number.isNaN(dt)) return false;
    const days = Math.floor((dt - today.getTime()) / 86400000);
    return days >= 0 && days <= 14;
  });
  if (within14d.length === 0) return "";
  const r = within14d.sort((a, b) => a.date.localeCompare(b.date))[0];
  const daysToRace = Math.floor((new Date(`${r.date}T00:00:00`).getTime() - today.getTime()) / 86400000);
  const lines: string[] = [
    `RACE-DAY EXECUTION (gara A "${r.name}" tra ${daysToRace}gg, ${r.sport}${r.distance_km ? ` ${r.distance_km}km` : ""}${r.targetTime ? ` target ${r.targetTime}` : ""}):`,
    `- Settimana race: il piano DEVE essere taper completo (volume -40-50% rispetto a CTL recente, intensità preservata Bosquet 2007).`,
  ];
  // Pacing
  if (r.targetTimeSec && r.distance_km && r.sport === "corsa") {
    const paceSec = r.targetTimeSec / r.distance_km;
    const paceMin = Math.floor(paceSec / 60);
    const paceRem = Math.round(paceSec % 60);
    lines.push(
      `- PACING strategy (negative split): primi 1/3 a ${paceMin}:${String(paceRem).padStart(2, "0")}/km +5-10s (controllo, NON tirare), secondo 1/3 a target ${paceMin}:${String(paceRem).padStart(2, "0")}/km, ultimo 1/3 a target -2-5s/km (push finale).`,
    );
  } else if (r.sport === "corsa") {
    lines.push(`- PACING strategy: parti controllato (+5-10s/km vs target), accelera gradualmente, push finale ultimo 1/3.`);
  }
  // Nutrition (corsa endurance > 60 min tipicamente)
  if (r.sport === "corsa" || r.sport === "triathlon" || r.sport === "trail") {
    lines.push(`- NUTRITION race-day:`);
    lines.push(`  · 48-24h prima: carb-loading 5-7g/kg/giorno (es. 70kg → 350-490g carbs/giorno).`);
    lines.push(`  · 3-4h prima: pasto leggero ricco di carbs 1-2g/kg (es. 100-150g pasta/riso/avena), basso grassi/fibre.`);
    lines.push(`  · 30-45min prima: snack 30g carbs facili (banana, gel, barretta, pane+miele) + 200-300ml acqua.`);
    if (!r.distance_km || r.distance_km > 15) {
      lines.push(`  · Durante (se >75min): 30-60g carbs/h (1-2 gel + acqua, oppure sport drink). Idratazione: 150-250ml ogni 15-20min.`);
    }
  }
  // Warm-up race-day
  if (r.sport === "corsa" || r.sport === "trail") {
    lines.push(`- WARM-UP race-day (15-20 min, finire 10-15min prima del via):`);
    lines.push(`  · 8-10 min easy Z1-Z2 (riscaldamento progressivo).`);
    lines.push(`  · 4-6 allunghi 60-80m al 80-90% velocità con recupero camminato (attivazione neuromuscolare).`);
    lines.push(`  · 1-2 sprint 100m al 95% per attivare CNS (ultimo finire ≥10min prima del via).`);
    lines.push(`  · 2-3 min stretching dinamico (leg swings, mobilità anche), NO static stretching.`);
  }
  return lines.join("\n");
}

/**
 * Sport-specific S&C auto-prescriber (Wave B2 audit 2).
 *
 * Coach pro game-sport prescrive routine OBBLIGATORIE in base allo sport
 * praticato (evidence-based injury prevention):
 *  - Calcio → FIFA 11+ 2-3x/sett (Soligard 2008 BMJ: -35% infortuni RCT su
 *    1892 calciatrici 13-17y, validato anche maschi adulti Silvers-Granelli
 *    2017 JSCR).
 *  - Calcio con ≥2 sessioni/sett → Nordic hamstring eccentrico 1x/sett
 *    (Al Attar 2017 Sports Med meta-analysis: -51% strain ischiocrurale).
 *  - Tennis/Padel ≥1x/sett → rotatori cuffia + core anti-rotazione 1x/sett
 *    (Kovacs 2007 J Strength Cond Res).
 *
 * Helper analizza recentDays per individuare sport praticati frequentemente
 * negli ultimi 21gg e restituisce blocco prompt con raccomandazioni
 * hardcoded. Stringa vuota se nessuno sport ricorrente.
 */
export function sportSpecificPrescriptions(
  recentDays: Array<{ date: string; daily: unknown; workouts: unknown[] }>,
): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff21 = today.getTime() - 21 * 86400000;
  type Workout = { type?: string; fields?: { tipo?: string; sport?: string } };
  let calcioCount = 0;
  let tennisPadelCount = 0;
  for (const d of recentDays) {
    const dt = new Date(d.date).getTime();
    if (Number.isNaN(dt) || dt < cutoff21) continue;
    for (const w of d.workouts || []) {
      const ww = w as Workout;
      if (ww.type !== "sport") continue;
      const sub = ((ww.fields?.tipo || ww.fields?.sport) || "").toLowerCase();
      if (sub.includes("calcio") || sub.includes("football") || sub.includes("soccer")) calcioCount++;
      else if (sub.includes("tennis") || sub.includes("padel") || sub.includes("paddle")) tennisPadelCount++;
    }
  }
  const lines: string[] = [];
  if (calcioCount >= 1) {
    lines.push(`- CALCIO rilevato (${calcioCount} sessioni 21gg) → prescrivere FIFA 11+ 2-3x/sett come warm-up obbligatorio prima di sessioni cardio/sport (Soligard 2008 BMJ: -35% infortuni). Iniettare come "subtype" in sessione sport allenamento o nel rationale dell'esercizio mobility.`);
    if (calcioCount >= 2) {
      lines.push(`- CALCIO ≥2/sett → aggiungere Nordic Hamstring 1x/sett 3×5 reps eccentriche in sessione forza_gambe (Al Attar 2017: -51% strain ischiocrurale).`);
    }
  }
  if (tennisPadelCount >= 1) {
    lines.push(`- TENNIS/PADEL rilevati (${tennisPadelCount} sessioni 21gg) → in sessione forza_upper includi 1× rotatori cuffia (band external rotation 3×12 lato) + core anti-rotazione (Pallof press 3×10 lato). Kovacs 2007.`);
  }
  if (lines.length === 0) return "";
  return `PROTOCOLLI SPORT-SPECIFICI OBBLIGATORI (evidence-based injury prevention, regole hardcoded):\n${lines.join("\n")}`;
}

/**
 * Goal convergence tracking (Wave 2.2 audit): calcola lo STATO ATTUALE di
 * ogni goal rispetto al diario recente, così il modello capisce se l'utente
 * è on-track e può prescrivere accelerazione/scarico/correzione.
 *
 * Output: blocco multi-line per ogni goal active. Per ogni goal:
 *   - giorni alla deadline (se parsabile come ISO)
 *   - se goal-corsa: numero corse + media passo ultimi 14gg
 *   - se goal-forza: frequenza sessioni forza ultime 14gg
 *   - segnale qualitativo on-track/da-accelerare se confronto possibile
 *
 * No machine learning, solo numeri grezzi: il modello fa la sintesi.
 */
export function goalProgressContext(
  goals: UserGoal[],
  recentDays: Array<{ date: string; daily: unknown; workouts: unknown[] }>,
): string {
  const active = goals.filter(g => g.status === "active");
  if (active.length === 0) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff14 = today.getTime() - 14 * 86400000;

  // Estrazione metriche dal diario degli ultimi 14gg.
  type Workout = { type?: string; fields?: { passo_medio?: number | string; durata_totale?: number | string; carico?: number | string } };
  const recent14: Array<{ date: string; w: Workout }> = [];
  for (const d of recentDays) {
    const dt = new Date(d.date).getTime();
    if (Number.isNaN(dt) || dt < cutoff14) continue;
    for (const w of d.workouts || []) recent14.push({ date: d.date, w: w as Workout });
  }

  const corseRecent = recent14.filter(r => r.w.type === "corsa");
  const forzaRecent = recent14.filter(r => r.w.type === "forza_gambe" || r.w.type === "forza_upper");

  // Parse passo "5:25" → 325 sec
  const parsePace = (s: number | string | undefined): number | null => {
    if (s == null) return null;
    if (typeof s === "number") return s > 0 ? s : null;
    const m = String(s).match(/^(\d+):(\d{1,2})$/);
    if (!m) return null;
    const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return sec > 0 ? sec : null;
  };
  const formatPace = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

  const corsaPaces = corseRecent.map(r => parsePace(r.w.fields?.passo_medio)).filter((n): n is number => n != null);
  const corsaPaceAvg = corsaPaces.length > 0 ? corsaPaces.reduce((a, b) => a + b, 0) / corsaPaces.length : null;

  const lines: string[] = [];
  for (const g of active) {
    const dl = g.kpi.deadline;
    let daysToDeadline: number | null = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(dl)) {
      const dlDate = new Date(`${dl}T00:00:00`).getTime();
      if (!Number.isNaN(dlDate)) daysToDeadline = Math.floor((dlDate - today.getTime()) / 86400000);
    }
    const deadlinePart = daysToDeadline != null
      ? (daysToDeadline > 0 ? `${daysToDeadline}gg alla deadline (${Math.ceil(daysToDeadline / 7)} sett)` : `deadline scaduta da ${-daysToDeadline}gg`)
      : `deadline ${dl}`;

    const metric = g.kpi.metric.toLowerCase();
    const target = g.kpi.target;
    let stateLine = "";

    // Goal corsa-related
    if (/passo|tempo|km|10k|5k|maratona|mezza|corsa|run/i.test(metric + " " + g.smartDescription)) {
      if (corseRecent.length === 0) {
        stateLine = `Stato: 0 corse negli ultimi 14gg → no baseline. Avvia subito allenamento.`;
      } else if (corsaPaceAvg) {
        const targetSec = parsePace(target);
        let trend = "";
        if (targetSec) {
          const delta = corsaPaceAvg - targetSec;
          if (delta < -10) trend = ` → AVANTI sul target (più veloce di ${Math.round(-delta)}s/km)`;
          else if (delta < 10) trend = ` → ALLINEATO al target`;
          else if (delta < 30) trend = ` → DA ACCELERARE (${Math.round(delta)}s/km più lento del target)`;
          else trend = ` → MOLTO INDIETRO sul target (+${Math.round(delta)}s/km). Valutare se realistico in ${daysToDeadline ?? "?"}gg.`;
        }
        stateLine = `Stato: ${corseRecent.length} corse 14gg, passo medio ${formatPace(corsaPaceAvg)}/km${trend}.`;
      } else {
        stateLine = `Stato: ${corseRecent.length} corse 14gg (passo medio non rilevato).`;
      }
    }
    // Goal forza-related
    else if (/forza|1rm|panca|squat|stacco|massa|ipertrof/i.test(metric + " " + g.smartDescription)) {
      stateLine = `Stato: ${forzaRecent.length} sessioni forza 14gg.`;
    }
    // Goal generico
    else {
      stateLine = `Stato: ${recent14.length} workout 14gg totali.`;
    }

    lines.push(`- "${sanitizePII(g.smartDescription)}" → KPI ${g.kpi.metric} ${g.kpi.target} | ${deadlinePart}. ${stateLine}`);
  }

  return `STATO GOAL (per pianificare sapendo dove sei vs. dove vuoi arrivare):\n${lines.join("\n")}`;
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
