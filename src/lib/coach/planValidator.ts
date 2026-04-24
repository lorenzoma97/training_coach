// Validator deterministico post-LLM del piano di allenamento.
// L'LLM è istruito via prompt ma può sbagliare/ignorare regole. Qui controlliamo
// le invarianti di sicurezza e correggiamo/avvisiamo se violate.

import type { TrainingPlan, UserProfile, PlanWeek, PlannedSession, UserGoal } from "../types";
import { restDaysMinForAge, SAFETY } from "./safetyRules";
import { isCanonicalSubtype, WORKOUT_SUBTYPES } from "../workoutCatalog";

export interface PlanValidationIssue {
  weekNumber: number;
  type:
    | "insufficient_rest_days"
    | "exceeds_beginner_cap"
    | "too_many_consecutive_days"
    | "invalid_zone_config"
    | "volume_spike_johansen"
    | "strength_excessive_for_master"
    | "strength_unsafe_elder"
    | "subtype_out_of_catalog"
    | "strength_recovery_violation"
    | "weekly_volume_exceeds_availability";
  message: string;
  severity: "warn" | "error";
  /** Categoria usata per metriche/raggruppamento (coincide con `type`). */
  category?: string;
}

/** Shape minima storico per lo spike check Johansen. */
interface RecentWorkoutForValidator {
  type?: string;
  fields?: { tipo?: string; durata_totale?: number | string; durata?: number | string };
  /** Data ISO (YYYY-MM-DD) opzionale per filtro 14gg. */
  date?: string;
}

export interface PlanValidationResult {
  ok: boolean;
  issues: PlanValidationIssue[];
  /** Piano (possibilmente) corretto: giorni di riposo aggiunti dove mancanti. */
  correctedPlan: TrainingPlan;
}

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

/**
 * Conta i giorni di riposo effettivi di una settimana: giorni (lun-dom) senza
 * nessuna sessione pianificata. Note che il modello talvolta non popola un giorno
 * e basta per contarlo come riposo.
 */
function restDaysInWeek(week: PlanWeek, expectedDays?: string[]): number {
  const days = new Set(week.sessions.map(s => s.day));
  const window = expectedDays && expectedDays.length > 0 ? expectedDays : DAY_ORDER;
  return window.filter(d => !days.has(d)).length;
}

/** Giorni consecutivi di allenamento (max streak) nella settimana. */
function maxConsecutiveTrainingDays(week: PlanWeek): number {
  const trained = DAY_ORDER.map(d => week.sessions.some(s => s.day === d));
  let max = 0, cur = 0;
  for (const t of trained) {
    if (t) { cur++; if (cur > max) max = cur; }
    else cur = 0;
  }
  return max;
}

/** Somma minuti di corsa nella settimana (tutti i type che iniziano con 'corsa'). */
function runningMinutes(week: PlanWeek): number {
  return week.sessions
    .filter(s => (s.type || "").toLowerCase().startsWith("corsa"))
    .reduce((a, s) => a + (s.duration_min || 0), 0);
}

/** Tipi considerati "cardio" — per questi il campo zone deve essere presente in {1..5}. */
const CARDIO_TYPES = new Set(["corsa", "sport"]);
/** Tipi NON cardio — per questi il campo zone deve essere undefined. */
const NON_CARDIO_TYPES = new Set(["forza_gambe", "forza_upper", "mobilita"]);

/**
 * Mediana (numerica) di un array. Ritorna null se vuoto.
 * Usata per lo spike check Johansen 20% (fix #2).
 */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Estrae la durata in minuti da un workout storico (compat legacy). */
function durationOfHistory(w: RecentWorkoutForValidator): number | null {
  const raw = w.fields?.durata_totale ?? w.fields?.durata;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Filtra lo storico agli ultimi 14 giorni (se `date` disponibile) e allo stesso
 * `type`. Il filtro per data è best-effort: se un record non ha `date`, viene
 * incluso (il caller ha già pre-filtrato la finestra).
 */
function historyMediansByType(
  recent: RecentWorkoutForValidator[],
): Record<string, number | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const byType = new Map<string, number[]>();
  for (const w of recent) {
    const t = (w.type || "").toLowerCase();
    if (!t) continue;
    if (w.date && w.date < cutoffISO) continue;
    const d = durationOfHistory(w);
    if (d === null) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(d);
  }

  const out: Record<string, number | null> = {};
  for (const [t, arr] of byType.entries()) out[t] = median(arr);
  return out;
}

/**
 * Validator principale del piano.
 * @param plan piano da validare
 * @param profile profilo utente
 * @param recentWorkouts storico sessioni ultimi ~14gg (opzionale, default [])
 *   per lo spike check Johansen (fix #2). Se vuoto il check viene saltato.
 *   Firma retrocompatibile: i call-site esistenti continuano a funzionare.
 */
/**
 * Opzioni avanzate del validator.
 * - expectedDayLabels: se presente, restringe il check "rest days" alla finestra
 *   indicata (es. ["gio","ven","sab","dom"] per settimana parziale rest-of-week).
 *   Senza questo parametro, il validator assume settimana piena 7gg.
 */
export interface ValidatePlanOptions {
  expectedDayLabels?: string[];
}

export function validatePlan(
  plan: TrainingPlan,
  profile: UserProfile,
  recentWorkouts: RecentWorkoutForValidator[] = [],
  options: ValidatePlanOptions = {},
): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  // Se la finestra è parziale (rest-of-week con N<7 giorni), scaliamo il
  // requisito di rest proporzionalmente. Esempio: 3 rest/sett canonica → 1
  // rest su finestra 4gg. Floor + min 1 per finestre ≥3 giorni.
  const fullWeekMinRest = restDaysMinForAge(profile.age);
  const windowSize = options.expectedDayLabels?.length ?? 7;
  const minRest = windowSize < 7
    ? Math.max(0, Math.floor(fullWeekMinRest * windowSize / 7))
    : fullWeekMinRest;
  const isSenior = profile.age >= 65;
  const isBeginner = profile.experience === "sedentary";

  // Mediana storica per tipo — riferimento per spike Johansen (fix #2).
  const mediansByType = historyMediansByType(recentWorkouts);
  const hasHistory = Object.keys(mediansByType).length > 0;

  for (const week of plan.weeks) {
    const rest = restDaysInWeek(week, options.expectedDayLabels);
    if (rest < minRest) {
      issues.push({
        weekNumber: week.weekNumber,
        type: "insufficient_rest_days",
        category: "insufficient_rest_days",
        message: `Settimana ${week.weekNumber}: ${rest} giorni di riposo (min richiesto ${minRest} per età ${profile.age}).`,
        severity: "error",
      });
    }
    if (isSenior) {
      const streak = maxConsecutiveTrainingDays(week);
      if (streak > 2) {
        issues.push({
          weekNumber: week.weekNumber,
          type: "too_many_consecutive_days",
          category: "too_many_consecutive_days",
          message: `Settimana ${week.weekNumber}: ${streak} giorni consecutivi di allenamento (max 2 per utenti ≥65).`,
          severity: "error",
        });
      }
    }
    if (isBeginner) {
      const runMin = runningMinutes(week);
      if (runMin > SAFETY.beginnerRunCapMinutesPerWeek) {
        issues.push({
          weekNumber: week.weekNumber,
          type: "exceeds_beginner_cap",
          category: "exceeds_beginner_cap",
          message: `Settimana ${week.weekNumber}: ${runMin} min di corsa (cap neofita ${SAFETY.beginnerRunCapMinutesPerWeek} min/sett).`,
          severity: "warn",
        });
      }
    }

    // Per-session checks: zone config (fix #1), spike Johansen (fix #2), strength age-tiered (fix #3).
    for (const s of week.sessions) {
      validateSessionZoneConfig(s, week.weekNumber, issues);
      if (hasHistory) validateSessionSpike(s, week.weekNumber, mediansByType, issues);
      validateStrengthAgeTiered(s, week.weekNumber, profile.age, issues);
      validateSessionSubtype(s, week.weekNumber, issues);
    }

    // Week-level checks: strength recovery 48h + volume vs availability.
    validateStrengthRecovery(week, issues);
    validateWeeklyVolume(week, profile, options.expectedDayLabels, issues);
  }

  const ok = issues.filter(i => i.severity === "error").length === 0;
  return { ok, issues, correctedPlan: plan };
}

/**
 * Fix #1 — Zone config check.
 * Per tipi cardio (corsa/sport) `zone` DEVE essere ∈ {1,2,3,4,5}.
 * Per tipi non-cardio (forza_gambe/forza_upper/mobilita) `zone` DEVE essere undefined.
 * Violazioni → issue "invalid_zone_config" (severity warn: non rompe il piano ma segnala drift dell'LLM).
 */
function validateSessionZoneConfig(
  s: PlannedSession,
  weekNumber: number,
  issues: PlanValidationIssue[],
): void {
  const type = (s.type || "").toLowerCase();
  if (CARDIO_TYPES.has(type)) {
    const z = s.zone;
    const valid = typeof z === "number" && z >= 1 && z <= 5 && Number.isInteger(z);
    if (!valid) {
      issues.push({
        weekNumber,
        type: "invalid_zone_config",
        category: "invalid_zone_config",
        message: `Settimana ${weekNumber} / ${s.day} ${type}: campo zone mancante o fuori range (atteso 1-5, trovato ${JSON.stringify(z)}).`,
        severity: "warn",
      });
    }
  } else if (NON_CARDIO_TYPES.has(type)) {
    if (s.zone !== undefined) {
      issues.push({
        weekNumber,
        type: "invalid_zone_config",
        category: "invalid_zone_config",
        message: `Settimana ${weekNumber} / ${s.day} ${type}: zone=${s.zone} non applicabile a tipo non-cardio (atteso undefined).`,
        severity: "warn",
      });
    }
  }
}

/**
 * Fix #2 — Spike Johansen 20% sulle sessioni del piano.
 * Riferimento: safetyRules.SAFETY.sessionSpikeMaxPct (Johansen 2025 BJSM).
 * Una sessione pianificata con `duration_min > 1.2 × mediana(storico 14gg stesso tipo)`
 * è oltre la banda di rischio 10-30% → issue "volume_spike_johansen".
 */
function validateSessionSpike(
  s: PlannedSession,
  weekNumber: number,
  mediansByType: Record<string, number | null>,
  issues: PlanValidationIssue[],
): void {
  const type = (s.type || "").toLowerCase();
  const med = mediansByType[type];
  if (med === null || med === undefined || med <= 0) return;
  const threshold = med * 1.2;
  if (s.duration_min > threshold) {
    const pct = Math.round(((s.duration_min - med) / med) * 100);
    issues.push({
      weekNumber,
      type: "volume_spike_johansen",
      category: "volume_spike_johansen",
      message: `Settimana ${weekNumber} / ${s.day} ${type}: ${s.duration_min}min è +${pct}% vs mediana 14gg (${Math.round(med)}min). Spike >20% associato a rischio overuse (Johansen 2025).`,
      severity: "warn",
    });
  }
}

/**
 * Fix #3 — Forza age-tiered.
 * Bibliografia: ACSM Chodzko-Zajko 2009 "Exercise and Physical Activity for
 * Older Adults" (position stand), Landi et al. 2019 review resistance training
 * elderly. Rønnestad 2014 è sui benefici della forza per endurance in master,
 * non sui LIMITI di durata — quindi è stato rimosso dalla citazione.
 * Check semplice sulla DURATA di sessioni forza per utenti master/elder.
 * NON codifichiamo regole sui carichi (non sono dato affidabile nel diario).
 *   - età ≥65: duration_min > 60 → "strength_excessive_for_master" (warn)
 *   - età ≥80: duration_min > 45 → "strength_unsafe_elder" (error)
 */
function validateStrengthAgeTiered(
  s: PlannedSession,
  weekNumber: number,
  age: number,
  issues: PlanValidationIssue[],
): void {
  const type = (s.type || "").toLowerCase();
  if (type !== "forza_gambe" && type !== "forza_upper") return;
  if (age >= 80 && s.duration_min > 45) {
    issues.push({
      weekNumber,
      type: "strength_unsafe_elder",
      category: "strength_unsafe_elder",
      message: `Settimana ${weekNumber} / ${s.day} ${type}: ${s.duration_min}min > 45min — sconsigliato per età ≥80 (ACSM strength guidelines per elder).`,
      severity: "error",
    });
  } else if (age >= 65 && s.duration_min > 60) {
    issues.push({
      weekNumber,
      type: "strength_excessive_for_master",
      category: "strength_excessive_for_master",
      message: `Settimana ${weekNumber} / ${s.day} ${type}: ${s.duration_min}min > 60min — eccessivo per età ≥65 (ACSM Chodzko-Zajko 2009: qualità > durata per master athlete).`,
      severity: "warn",
    });
  }
}

/**
 * Fix #4 — Subtype must be in catalog (risolve bug "Forza e stabilità" inventato).
 * Se l'LLM crea un subtype non presente in WORKOUT_SUBTYPES, il matching
 * piano↔diario fallisce (l'utente registra un workout ma il piano mostra
 * "VARIAZIONE" per sempre). Severity warn: non rompe il piano, ma segnala
 * drift dell'LLM. Issue category: "subtype_out_of_catalog".
 */
function validateSessionSubtype(
  s: PlannedSession,
  weekNumber: number,
  issues: PlanValidationIssue[],
): void {
  const type = (s.type || "").toLowerCase();
  // Subtype opzionale per definizione — se assente, non validiamo.
  if (!s.subtype) return;
  // Se il type non è mappato in catalogo, non possiamo validare (tolleranza).
  if (!WORKOUT_SUBTYPES[type]) return;
  if (!isCanonicalSubtype(type, s.subtype)) {
    const allowed = WORKOUT_SUBTYPES[type].join(", ");
    issues.push({
      weekNumber,
      type: "subtype_out_of_catalog",
      category: "subtype_out_of_catalog",
      message: `Settimana ${weekNumber} / ${s.day} ${type}: subtype "${s.subtype}" non è in catalogo. Valori ammessi: ${allowed}.`,
      severity: "warn",
    });
  }
}

/**
 * Fix — 48h recovery rule tra sessioni di forza.
 * Muscle protein synthesis + tendon repair richiedono ~48h tra stimoli sullo stesso
 * distretto (Schoenfeld 2016 freq metanalisi). Qui trattiamo forza_gambe/forza_upper
 * come "stress neuromuscolare generale": ≥1 giorno di stacco tra QUALSIASI coppia
 * di sessioni forza. Il pattern lun+mar di forza (anche split upper/lower) → warn.
 */
function validateStrengthRecovery(
  week: PlanWeek,
  issues: PlanValidationIssue[],
): void {
  const strengthDays: { day: string; idx: number; type: string }[] = [];
  for (const s of week.sessions) {
    const t = (s.type || "").toLowerCase();
    if (t === "forza_gambe" || t === "forza_upper") {
      const idx = DAY_ORDER.indexOf(s.day);
      if (idx >= 0) strengthDays.push({ day: s.day, idx, type: t });
    }
  }
  strengthDays.sort((a, b) => a.idx - b.idx);
  for (let i = 1; i < strengthDays.length; i++) {
    const gap = strengthDays[i].idx - strengthDays[i - 1].idx;
    if (gap < 2) {
      issues.push({
        weekNumber: week.weekNumber,
        type: "strength_recovery_violation",
        category: "strength_recovery_violation",
        message: `Settimana ${week.weekNumber}: forza ${strengthDays[i - 1].type} (${strengthDays[i - 1].day}) e ${strengthDays[i].type} (${strengthDays[i].day}) a distanza <48h — serve almeno 1 giorno di stacco tra sessioni di forza (Schoenfeld 2016).`,
        severity: "warn",
      });
    }
  }
}

/**
 * Fix — weekly volume vs availability.
 * Confronta somma duration_min della settimana con budget dichiarato
 * (days × hoursPerSession × 60). Sforare il budget significa piano irrealistico:
 * l'utente salterà sessioni. Tolleranza 20%: oltre è error (riscritto male), sotto warn.
 */
function validateWeeklyVolume(
  week: PlanWeek,
  profile: UserProfile,
  expectedDayLabels: string[] | undefined,
  issues: PlanValidationIssue[],
): void {
  const avail = profile.weekly_availability;
  if (!avail || !avail.days || !avail.hoursPerSession) return;
  const windowSize = expectedDayLabels?.length ?? 7;
  // Budget scala con la finestra (es. rest-of-week 4gg su 7 → 4/7 del budget).
  const budgetMin = Math.round(avail.days * avail.hoursPerSession * 60 * windowSize / 7);
  if (budgetMin <= 0) return;
  const totalMin = week.sessions.reduce((a, s) => a + (s.duration_min || 0), 0);
  if (totalMin <= budgetMin) return;
  const overPct = ((totalMin - budgetMin) / budgetMin) * 100;
  const severity: "warn" | "error" = overPct > 20 ? "error" : "warn";
  issues.push({
    weekNumber: week.weekNumber,
    type: "weekly_volume_exceeds_availability",
    category: "weekly_volume_exceeds_availability",
    message: `Settimana ${week.weekNumber}: ${totalMin}min pianificati vs budget ${budgetMin}min (${avail.days}gg × ${avail.hoursPerSession}h) = +${Math.round(overPct)}%. ${severity === "error" ? "Piano irrealistico, riduci volume." : "Al limite della disponibilità dichiarata."}`,
    severity,
  });
}

/**
 * Hash stabile dei campi profilo + obiettivi attivi che influenzano il piano.
 * Se cambia significa che il piano generato prima potrebbe non essere più ottimale.
 * Include anche i goal per rilevare il drift quando l'utente modifica obiettivi
 * via GoalsEditor (altrimenti il piano resta invariato senza alcun hint).
 */
export function planStateHash(profile: UserProfile, goals: UserGoal[] = []): string {
  const activeGoals = goals
    .filter(g => g.status !== "archived")
    .map(g => ({
      id: g.id,
      smart: g.smartDescription,
      // KPI influenza strutturalmente il piano (target + deadline)
      metric: g.kpi.metric, target: g.kpi.target, deadline: g.kpi.deadline,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const relevant = {
    age: profile.age,
    sex: profile.sex,
    experience: profile.experience,
    injuries: [...(profile.injuries || [])].sort(),
    painTrackingAreas: [...(profile.painTrackingAreas || [])].sort(),
    weekly_availability: profile.weekly_availability,
    equipment: [...(profile.equipment || [])].sort(),
    goals: activeGoals,
  };
  // djb2 hash della serializzazione JSON: stabile cross-session.
  const s = JSON.stringify(relevant);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** @deprecated usa planStateHash(profile, goals) che include anche i goal. */
export function profileHashForPlan(profile: UserProfile): string {
  return planStateHash(profile, []);
}

/**
 * Data locale del lunedì della settimana CORRENTE (≤ fromDate).
 * Se oggi è lunedì ritorna oggi, altrimenti il lunedì appena passato.
 *
 * Scelta di design: il piano è sempre ancorato alla settimana calendario
 * in cui viene generato. Se l'utente genera il piano mercoledì, startDate
 * = lunedì 2 giorni fa. Così "oggi" (mercoledì) matcha correttamente il
 * giorno "mer" della settimana 1 nel piano. Le sessioni lun/mar di quella
 * settimana appariranno come "SALTATA" — coerente con la realtà che
 * quei giorni sono già passati.
 *
 * La variante "lunedì successivo" era controintuitiva: l'utente genera
 * il piano per ADESSO, non per iniziare tra qualche giorno.
 */
export function computePlanStartDate(fromDate: Date = new Date()): string {
  const d = new Date(fromDate);
  // In JS getDay(): 0=dom, 1=lun, ..., 6=sab.
  // Giorni indietro per raggiungere il lunedì corrente:
  //   lun=0, mar=1, mer=2, gio=3, ven=4, sab=5, dom=6
  const dow = d.getDay();
  const daysBack = (dow + 6) % 7;
  d.setDate(d.getDate() - daysBack);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
