// Cross-sport fatigue conflict validator (Wave A3 — audit 2 multi-sport).
//
// Detecta conflitti di carico tra sessioni eterogenee che il pattern MD-1/MD/MD+1
// (matchDayValidator) non copre:
//
// 1. INTERFERENCE (Wilson 2012 J Strength Cond Res, meta-analisi su concurrent
//    training): cardio Z4-Z5 < 6-24h prima di forza gambe pesante = perdita
//    fino al 30% strength gains. Stessa giornata = pessimo.
//
// 2. HARD BACK-TO-BACK: due giorni consecutivi entrambi alta intensità
//    (Z4-Z5 cardio o sport match) → ricovero CNS/muscolare incompleto.
//    Friel/Daniels: separare giorni hard con almeno 1 easy/rest.
//
// 3. SPORT MATCH < 48h post forza gambe pesante: rischio infortunio acuto
//    (Krustrup 2006, Ekstrand 2011 UEFA injury study).
//
// Output: warn (no error). Lista degli issue per settimana.
//
// Ref:
//  - Wilson 2012 JSCR concurrent training meta-analysis
//  - Ekstrand 2011 UEFA Champions League injury study
//  - Coffey & Hawley 2017 J Physiol concurrent training mechanisms

import type { PlanValidator, PlanValidationIssue } from "../planValidator";
import type { PlannedSession } from "../../types";

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

function isHighIntensityCardio(s: PlannedSession): boolean {
  if (s.type !== "corsa") return false;
  return typeof s.zone === "number" && s.zone >= 4;
}

function isStrengthLegs(s: PlannedSession): boolean {
  return s.type === "forza_gambe";
}

function isMatchSession(s: PlannedSession): boolean {
  if (s.type !== "sport") return false;
  const sub = (s.subtype || "").toLowerCase();
  return sub.includes("partita") || sub.includes("match");
}

function isHardSession(s: PlannedSession): boolean {
  return isHighIntensityCardio(s) || isStrengthLegs(s) || isMatchSession(s);
}

function describeSession(s: PlannedSession): string {
  return `${s.type}${s.subtype ? ` (${s.subtype})` : ""}${s.zone ? ` Z${s.zone}` : ""}`;
}

export const validateCrossSportConflict: PlanValidator = (plan) => {
  const issues: PlanValidationIssue[] = [];
  for (const week of plan.weeks) {
    const byDay = new Map<string, PlannedSession[]>();
    for (const s of week.sessions) {
      const list = byDay.get(s.day) ?? [];
      list.push(s);
      byDay.set(s.day, list);
    }

    // Pattern 1 — Same-day Wilson 2012 interference: Z4-Z5 cardio + forza_gambe
    for (const day of DAY_ORDER) {
      const sess = byDay.get(day);
      if (!sess || sess.length < 2) continue;
      const hasIntenseCardio = sess.some(isHighIntensityCardio);
      const hasLegStrength = sess.some(isStrengthLegs);
      if (hasIntenseCardio && hasLegStrength) {
        issues.push({
          weekNumber: week.weekNumber,
          type: "cross_sport_conflict",
          severity: "warn",
          category: "cross_sport_interference_same_day",
          message: `Settimana ${week.weekNumber}, ${day}: cardio Z4-Z5 + forza gambe stesso giorno → interferenza acuta (Wilson 2012: −20-30% strength gains). Spostare forza al mattino e cardio al pomeriggio (≥6h gap) o splittare su 2 giorni distinti.`,
        });
      }
    }

    // Pattern 2 — Consecutive day Wilson interference + hard back-to-back
    for (let i = 0; i < DAY_ORDER.length - 1; i++) {
      const dayA = DAY_ORDER[i];
      const dayB = DAY_ORDER[i + 1];
      const sessA = byDay.get(dayA) ?? [];
      const sessB = byDay.get(dayB) ?? [];
      if (sessA.length === 0 || sessB.length === 0) continue;

      // 2a. cardio Z4-Z5 dayA → forza gambe dayB (Wilson 2012, < 24h gap)
      if (sessA.some(isHighIntensityCardio) && sessB.some(isStrengthLegs)) {
        const cardio = sessA.find(isHighIntensityCardio)!;
        const strength = sessB.find(isStrengthLegs)!;
        issues.push({
          weekNumber: week.weekNumber,
          type: "cross_sport_conflict",
          severity: "warn",
          category: "cross_sport_interference_consecutive",
          message: `Settimana ${week.weekNumber}: ${dayA} ${describeSession(cardio)} + ${dayB} ${describeSession(strength)} = cardio intenso < 24h prima di forza gambe (Wilson 2012 interference). Inserire 1 giorno easy/rest tra i due o invertire ordine.`,
        });
      }

      // 2b. forza gambe pesante dayA → sport match dayB (Ekstrand 2011 injury)
      if (sessA.some(isStrengthLegs) && sessB.some(isMatchSession)) {
        const strength = sessA.find(isStrengthLegs)!;
        const match = sessB.find(isMatchSession)!;
        issues.push({
          weekNumber: week.weekNumber,
          type: "cross_sport_conflict",
          severity: "warn",
          category: "cross_sport_strength_pre_match",
          message: `Settimana ${week.weekNumber}: ${dayA} ${describeSession(strength)} + ${dayB} ${describeSession(match)} = forza gambe < 24h prima della partita. Rischio infortunio muscolare elevato (Ekstrand 2011 UEFA): spostare forza ≥48h pre-match.`,
        });
      }

      // 2c. hard back-to-back generico: due giorni consecutivi entrambi hard
      // Esclude doppia "interference same-day" (gia' segnalata).
      const aHard = sessA.some(isHardSession);
      const bHard = sessB.some(isHardSession);
      if (aHard && bHard && !(sessA.some(isHighIntensityCardio) && sessB.some(isStrengthLegs))) {
        // Marca solo se NESSUNO dei 2 e' "easy" (Z2 o sport allenamento leggero)
        const aDesc = sessA.map(describeSession).join(" + ");
        const bDesc = sessB.map(describeSession).join(" + ");
        issues.push({
          weekNumber: week.weekNumber,
          type: "cross_sport_conflict",
          severity: "warn",
          category: "cross_sport_hard_back_to_back",
          message: `Settimana ${week.weekNumber}: ${dayA} (${aDesc}) e ${dayB} (${bDesc}) entrambi alta intensità consecutivi. Coach pro (Friel/Daniels): separa giorni hard con almeno 1 easy/rest tra i due.`,
        });
      }
    }
  }
  return issues;
};
