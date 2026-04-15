// Validator deterministico post-LLM del piano di allenamento.
// L'LLM è istruito via prompt ma può sbagliare/ignorare regole. Qui controlliamo
// le invarianti di sicurezza e correggiamo/avvisiamo se violate.

import type { TrainingPlan, UserProfile, PlanWeek, UserGoal } from "../types";
import { restDaysMinForAge, SAFETY } from "./safetyRules";

export interface PlanValidationIssue {
  weekNumber: number;
  type: "insufficient_rest_days" | "exceeds_beginner_cap" | "too_many_consecutive_days";
  message: string;
  severity: "warn" | "error";
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
function restDaysInWeek(week: PlanWeek): number {
  const days = new Set(week.sessions.map(s => s.day));
  return DAY_ORDER.filter(d => !days.has(d)).length;
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

export function validatePlan(plan: TrainingPlan, profile: UserProfile): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  const minRest = restDaysMinForAge(profile.age);
  const isSenior = profile.age >= 65;
  const isBeginner = profile.experience === "sedentary";

  for (const week of plan.weeks) {
    const rest = restDaysInWeek(week);
    if (rest < minRest) {
      issues.push({
        weekNumber: week.weekNumber,
        type: "insufficient_rest_days",
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
          message: `Settimana ${week.weekNumber}: ${runMin} min di corsa (cap neofita ${SAFETY.beginnerRunCapMinutesPerWeek} min/sett).`,
          severity: "warn",
        });
      }
    }
  }

  const ok = issues.filter(i => i.severity === "error").length === 0;
  return { ok, issues, correctedPlan: plan };
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
