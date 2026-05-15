// Match-day pattern validator (Wave A1 — audit 2 multi-sport coaching).
//
// Pattern coach pro game-sport (FIGC calcio, FIP padel, ITF tennis):
//   MD-1 (giorno prima del match): solo skill o riposo. NO Z4-Z5, NO forza
//        gambe pesante. Razionale: CNS fresco per match.
//   MD   (giorno match): la gara stessa.
//   MD+1 (giorno dopo): riposo o Z1-Z2 mobility. NO cardio intenso, NO
//        forza gambe. Razionale: recovery muscolare + glycogen replenishment.
//
// Detection: sessione "match" identificata da subtype contenente "Partita"
// o "Match" (case-insensitive). Workout type sempre "sport".
//
// Output: warning (no error) — il piano resta utilizzabile, l'utente decide.
//
// Ref: Krustrup 2006 J Sports Sci (calcio fatigue 48-72h post-match);
//      Coutts 2007 (RPE post-match correlazione recovery 48h).

import type { PlanValidator, PlanValidationIssue } from "../planValidator";
import type { PlannedSession } from "../../types";

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

/** Identifica sessione di gara (match) vs allenamento sport. */
function isMatchSession(s: PlannedSession): boolean {
  if (s.type !== "sport") return false;
  const sub = (s.subtype || "").toLowerCase();
  return sub.includes("partita") || sub.includes("match");
}

/** True se sessione cardio in zona alta (Z4 o Z5). */
function isHighIntensityCardio(s: PlannedSession): boolean {
  if (s.type !== "corsa") return false;
  return typeof s.zone === "number" && s.zone >= 4;
}

/** True se sessione forza gambe (qualunque sub: HIIT, esplosiva, massimale, circuito). */
function isStrengthLegs(s: PlannedSession): boolean {
  return s.type === "forza_gambe";
}

export const validateMatchDayPattern: PlanValidator = (plan) => {
  const issues: PlanValidationIssue[] = [];
  for (const week of plan.weeks) {
    const byDay = new Map<string, PlannedSession>();
    for (const s of week.sessions) byDay.set(s.day, s);

    for (const matchSession of week.sessions.filter(isMatchSession)) {
      const idx = DAY_ORDER.indexOf(matchSession.day);
      if (idx < 0) continue;

      // MD-1: il giorno prima
      if (idx > 0) {
        const dayBefore = DAY_ORDER[idx - 1];
        const sBefore = byDay.get(dayBefore);
        if (sBefore && (isHighIntensityCardio(sBefore) || isStrengthLegs(sBefore))) {
          issues.push({
            weekNumber: week.weekNumber,
            type: "match_day_conflict",
            severity: "warn",
            category: "match_day_conflict",
            message: `Settimana ${week.weekNumber}: ${dayBefore} ${sBefore.type}${sBefore.subtype ? ` (${sBefore.subtype})` : ""}${sBefore.zone ? ` Z${sBefore.zone}` : ""} è MD-1 di "${matchSession.subtype}" (${matchSession.day}). Coach pro game-sport: MD-1 solo skill/riposo (CNS fresco per gara). Considerare downgrade a tecnica o spostare ${dayBefore} a giorno diverso.`,
          });
        }
      }

      // MD+1: il giorno dopo
      if (idx < DAY_ORDER.length - 1) {
        const dayAfter = DAY_ORDER[idx + 1];
        const sAfter = byDay.get(dayAfter);
        if (sAfter && (isHighIntensityCardio(sAfter) || isStrengthLegs(sAfter))) {
          issues.push({
            weekNumber: week.weekNumber,
            type: "match_day_conflict",
            severity: "warn",
            category: "match_day_conflict",
            message: `Settimana ${week.weekNumber}: ${dayAfter} ${sAfter.type}${sAfter.subtype ? ` (${sAfter.subtype})` : ""}${sAfter.zone ? ` Z${sAfter.zone}` : ""} è MD+1 di "${matchSession.subtype}" (${matchSession.day}). Coach pro: MD+1 = riposo o Z1-Z2 mobility (recovery muscolare 48-72h post-match, Krustrup 2006). Considerare downgrade a Z2 o riposo.`,
          });
        }
      }
    }
  }
  return issues;
};
