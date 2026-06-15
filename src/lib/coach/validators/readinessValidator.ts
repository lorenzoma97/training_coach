// Readiness validator (Wave 3.4 — ARCHITECTURE.md §3.3, §4 Wave 3.4, §6 I7).
// Pure function, no side effects. Auto-correction NON modifica direttamente il
// piano: ritorna `PlanValidationIssue` con category "readiness_override_required";
// è il caller (`validatePlan` in planValidator.ts) che applica il downgrade
// Z4/Z5 → Z3 sul `correctedPlan` (immutability del plan input preservata).
//
// Riferimento G7 (ARCHITECTURE.md §1):
//   readiness < 50 → downgrade Z4-5 → Z2-3 sulle sessioni cardio di OGGI.
//   I7 (§6): auto-correction visibile via UI banner "Adattato per readiness
//   basso oggi" — `readinessAdjusted: true` sulla sessione modificata.
//
// Constraints (Wave 3.4 spec):
//   - Solo sessioni di OGGI (week 1, day == today's day key) sono candidate.
//   - Solo sessioni con `zone` numerica >= 4 vengono flagged.
//   - Snapshot >24h vecchio → skip (snapshot.date != todayISO).
//   - readiness null/undefined → skip.
//   - Banda "moderate"/"high" → skip (downgrade SOLO per band "low").
//   - Tipo non-cardio (forza_*, mobilita) → no zone definita → skip naturale.
//   - Validator NON modifica volume/duration. Solo zone.

import type { TrainingPlan, PlannedSession, ReadinessSnapshot } from "../../types";
import type { PlanValidator, PlanValidationIssue } from "../planValidator";
import { toISO } from "../../time";

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

/**
 * Ritorna il day key italiano (lun..dom) per la data fornita (default: oggi).
 * JS getDay(): 0=dom, 1=lun, ..., 6=sab → mappato a DAY_ORDER.
 */
function todayDayKeyFromDate(d: Date = new Date()): string {
  // dow: 0=dom, 1=lun..6=sab → indice in DAY_ORDER (lun=0..dom=6)
  const dow = d.getDay();
  const idx = (dow + 6) % 7;
  return DAY_ORDER[idx];
}

/** ISO date locale (YYYY-MM-DD). Usata per check freshness snapshot.
 *  Delega a time.ts.toISO (fonte unica). */
function todayISO(d: Date = new Date()): string {
  return toISO(d);
}

/**
 * Helper esposto per testabilità: dato un piano, una snapshot e il day key di
 * oggi, ritorna le issue `readiness_override_required` che richiedono
 * downgrade Z4/Z5 → Z3.
 *
 * Pure function: no side effects, no mutation, no I/O.
 *
 * Skip silently (return []) quando:
 *   - readiness === null o undefined (snapshot mancante)
 *   - readiness.band !== "low" (high/moderate non triggerano auto-correction)
 *   - readiness.date !== todayISO (snapshot vecchio: G7 vuole che lo
 *     scoring sia "di oggi" per essere applicato — un readiness di ieri non
 *     è più rappresentativo dello stato attuale).
 *   - nessuna sessione "oggi" nella settimana 1 con zone >= 4.
 *
 * Note design:
 *   - Solo settimana 1 ispezionata (le sessioni future Z5 NON vengono toccate
 *     dal readiness "di oggi": il piano di domani sarà valutato con la
 *     readiness di domani).
 *   - Il day key matching è case-insensitive su `session.day`.
 *   - Sessioni senza `zone` numerica (forza_*, mobilita) → skip naturale.
 */
export function evaluateReadinessIssues(
  plan: TrainingPlan,
  readiness: ReadinessSnapshot | null,
  todayDayKey: string,
  todayDateISO?: string,
): PlanValidationIssue[] {
  if (!readiness) return [];
  if (readiness.band !== "low") return [];

  // Snapshot freshness: deve essere "di oggi". Se non lo è, skip.
  // todayDateISO opzionale per testabilità (default: ora).
  const refISO = todayDateISO ?? todayISO();
  if (readiness.date !== refISO) return [];

  // Solo settimana 1 (la "current week" del piano).
  const week1 = plan.weeks.find(w => w.weekNumber === 1);
  if (!week1) return [];

  const issues: PlanValidationIssue[] = [];
  const dayKeyLc = todayDayKey.toLowerCase();

  for (const s of week1.sessions) {
    const sessionDayLc = (s.day || "").toLowerCase();
    if (sessionDayLc !== dayKeyLc) continue;
    const z = s.zone;
    if (typeof z !== "number" || !Number.isFinite(z)) continue;
    if (z < 4) continue; // Z1-Z3 già low intensity, no override

    issues.push({
      weekNumber: week1.weekNumber,
      type: "readiness_override_required",
      category: "readiness_override_required",
      message:
        `Settimana ${week1.weekNumber} / ${s.day} ${s.type}: readiness oggi ` +
        `${readiness.score}/100 (banda "low") → zona Z${z} verrà auto-` +
        `downgrade a Z3 per ridurre stress autonomico (G7).`,
      severity: "warn",
    });
  }

  return issues;
}

/**
 * PlanValidator entry point. Legge `ctx.options.readiness` e `ctx.recentWorkouts`
 * NON è usato qui (il validator dipende solo dalla snapshot di readiness).
 *
 * NB: il validator NON applica direttamente il downgrade — ritorna solo issue.
 * `validatePlan` (planValidator.ts) intercetta le issue di tipo
 * `readiness_override_required` e applica la correzione su `correctedPlan`
 * (vedi planValidator.ts auto-correction logic).
 */
export const validateReadiness: PlanValidator = (plan, ctx): PlanValidationIssue[] => {
  const readiness = ctx.options.readiness ?? null;
  const dayKey = todayDayKeyFromDate();
  return evaluateReadinessIssues(plan, readiness, dayKey);
};

// Helper esportati per testabilità (no API pubblica garantita).
export { todayDayKeyFromDate, todayISO };
