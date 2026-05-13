// Prescription adherence validator (2026-05-13).
// Owner: architect-specialist.
//
// CONTRATTO:
// Pass-3 deterministico: confronta il piano generato dall'LLM con la
// TrainingPrescription calcolata in pre-pass. Emette WARNING (mai error,
// mai info) se il piano devia significativamente dai target prescritti.
//
// Severity discipline: il validator e' "info-level di tipo warn" — segnala
// drift ma NON blocca il piano. La validazione e' un sanity check, non un
// gate: l'LLM puo' avere ragioni legittime per deviare (es. infortuni
// inattesi nello storico, vincoli di giorni allenabili stretti).
//
// CHECK eseguiti:
//  1. Volume settimanale totale vs prescription.weeklyVolumeRangeMin.
//  2. Distribuzione zone effettiva vs prescription.zoneDistributionPct (±10%).
//  3. Numero sessioni forza vs prescription.strength.sessionsPerWeek (±1).
//
// VINCOLI:
// - Pure function: no I/O, no mutation del plan.
// - Backward compat: se `ctx.options.prescription` undefined → no-op.

import type { TrainingPlan, PlannedSession } from "../../types";
import type { PlanValidator, PlanValidationIssue } from "../planValidator";
import type { TrainingPrescription } from "../trainingPrescription";

/** Soglia di deviazione zone (percentuale assoluta) sopra cui flagghiamo drift. */
const ZONE_DRIFT_TOLERANCE_PCT = 10;
/** Soglia di deviazione forza (sessioni assolute) sopra cui flagghiamo drift. */
const STRENGTH_SESS_TOLERANCE = 1;

/**
 * Mapping zone numerica → bucket distribuzione.
 * Z1, Z2 → z1z2; Z3 → z3; Z4, Z5 → z4z5.
 */
function zoneToBucket(z: number | undefined): "z1z2" | "z3" | "z4z5" | null {
  if (typeof z !== "number") return null;
  if (z === 1 || z === 2) return "z1z2";
  if (z === 3) return "z3";
  if (z === 4 || z === 5) return "z4z5";
  return null;
}

/**
 * Calcola distribuzione zone effettiva dal plan (settimana 1).
 * Considera solo sessioni cardio (corsa/sport con zone definita). Pesa per
 * duration_min (sessioni piu' lunghe contano di piu').
 *
 * Ritorna null se non ci sono sessioni cardio (impossibile validare zone).
 */
function computeActualZoneDist(
  sessions: PlannedSession[],
): { z1z2: number; z3: number; z4z5: number; totalCardioMin: number } | null {
  let z12 = 0;
  let z3 = 0;
  let z45 = 0;
  for (const s of sessions) {
    const t = (s.type || "").toLowerCase();
    if (t !== "corsa" && t !== "sport") continue;
    const bucket = zoneToBucket(s.zone);
    if (!bucket) continue;
    const dur = s.duration_min || 0;
    if (bucket === "z1z2") z12 += dur;
    else if (bucket === "z3") z3 += dur;
    else if (bucket === "z4z5") z45 += dur;
  }
  const totalCardioMin = z12 + z3 + z45;
  if (totalCardioMin === 0) return null;
  return {
    z1z2: Math.round((z12 / totalCardioMin) * 100),
    z3: Math.round((z3 / totalCardioMin) * 100),
    z4z5: Math.round((z45 / totalCardioMin) * 100),
    totalCardioMin,
  };
}

/**
 * Funzione esposta per testabilita': data una settimana e una prescription,
 * ritorna le issue prescription. Pure function.
 */
export function validatePrescriptionAdherence(
  plan: TrainingPlan,
  prescription: TrainingPrescription,
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];

  for (const week of plan.weeks) {
    // ── Check 1: volume settimanale totale ────────────────────────────────
    const actualVolume = week.sessions.reduce((acc, s) => acc + (s.duration_min || 0), 0);
    const { min: volMin, max: volMax } = prescription.weeklyVolumeRangeMin;
    if (actualVolume < volMin || actualVolume > volMax) {
      const deltaPct = Math.round(((actualVolume - prescription.weeklyVolumeTargetMin) / Math.max(1, prescription.weeklyVolumeTargetMin)) * 100);
      issues.push({
        weekNumber: week.weekNumber,
        type: "prescription_volume_off",
        category: "prescription_volume_off",
        message: `Settimana ${week.weekNumber}: volume effettivo ${actualVolume}min vs prescription ${prescription.weeklyVolumeTargetMin}min (range ${volMin}-${volMax}, delta ${deltaPct >= 0 ? "+" : ""}${deltaPct}%).`,
        severity: "warn",
      });
    }

    // ── Check 2: distribuzione zone (solo se ci sono cardio) ─────────────
    const actualZones = computeActualZoneDist(week.sessions);
    if (actualZones) {
      const presc = prescription.zoneDistributionPct;
      const deltaZ12 = Math.abs(actualZones.z1z2 - presc.z1z2Pct);
      const deltaZ3 = Math.abs(actualZones.z3 - presc.z3Pct);
      const deltaZ45 = Math.abs(actualZones.z4z5 - presc.z4z5Pct);
      const maxDrift = Math.max(deltaZ12, deltaZ3, deltaZ45);
      if (maxDrift > ZONE_DRIFT_TOLERANCE_PCT) {
        issues.push({
          weekNumber: week.weekNumber,
          type: "prescription_zone_off",
          category: "prescription_zone_off",
          message: `Settimana ${week.weekNumber}: distribuzione zone effettiva ${actualZones.z1z2}/${actualZones.z3}/${actualZones.z4z5} vs prescription ${presc.z1z2Pct}/${presc.z3Pct}/${presc.z4z5Pct} (drift max ${maxDrift}%, soglia ${ZONE_DRIFT_TOLERANCE_PCT}%).`,
          severity: "warn",
        });
      }
    }

    // ── Check 3: numero sessioni forza ─────────────────────────────────────
    const strengthSessionsCount = week.sessions.filter(
      s => s.type === "forza_gambe" || s.type === "forza_upper",
    ).length;
    const targetStrength = prescription.strength.sessionsPerWeek;
    const strengthDelta = Math.abs(strengthSessionsCount - targetStrength);
    if (strengthDelta > STRENGTH_SESS_TOLERANCE) {
      issues.push({
        weekNumber: week.weekNumber,
        type: "prescription_strength_off",
        category: "prescription_strength_off",
        message: `Settimana ${week.weekNumber}: ${strengthSessionsCount} sessioni forza vs prescription ${targetStrength} (delta ${strengthDelta}, tolleranza ±${STRENGTH_SESS_TOLERANCE}).`,
        severity: "warn",
      });
    }
  }

  return issues;
}

/**
 * Entry point PlanValidator. Legge ctx.options.prescription (opzionale).
 * Backward compat: se prescription assente → no-op (nessuna issue).
 */
export const validatePrescription: PlanValidator = (plan, ctx): PlanValidationIssue[] => {
  const prescription = ctx.options.prescription;
  if (!prescription) return [];
  return validatePrescriptionAdherence(plan, prescription);
};
