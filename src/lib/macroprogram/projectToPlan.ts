// Proiezione deterministica macroprogramma → TrainingPlan (Sprint A, 2026-05-27).
//
// IL FIX ARCHITETTURALE CHIAVE: il macroprogramma .md contiene GIÀ sessioni
// completamente strutturate (esercizi, sets, reps, intervalli). Invece di
// passarle attraverso un LLM lite che "rigenera" (fuzzy, costoso, diverge),
// le PROIETTIAMO deterministicamente nella struttura TrainingPlan.
//
// Risultato: il piano CONCORDA col macro per costruzione.
//
// L'LLM resta utile solo per:
//  1. ADATTAMENTO daily della proiezione (readiness bassa / dolore / ACWR) —
//     gestito da adaptProjectedPlan (separato, opzionale).
//  2. Generazione from-scratch quando NON c'è macroprogramma (path invariato).
//
// Questo modulo è PURO: nessun LLM, nessun storage write. Input → output.

import type {
  TrainingPlan, PlanWeek, PlannedSession, PlannedExercise, CardioInterval, UserProfile,
} from "../types";
import type {
  MacroProgram, MacroProgramSession, MacroProgramExercise, MacroProgramInterval,
} from "../types/macroprogram";
import { computeMacroProgress, mondayOf } from "./storage";

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;

/**
 * Trova la fase del macroprogramma che copre una data settimana.
 * `weeks` può essere range [start, end] o lista esplicita [w1, w2, ...].
 */
function phaseNameForWeek(program: MacroProgram, weekNum: number): string | undefined {
  for (const p of program.phases) {
    const isRange = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1];
    const inPhase = isRange ? (weekNum >= p.weeks[0] && weekNum <= p.weeks[1]) : p.weeks.includes(weekNum);
    if (inPhase) return p.name;
  }
  return undefined;
}

/** Mappa MacroProgramExercise → PlannedExercise (deterministico). */
function projectExercise(ex: MacroProgramExercise): PlannedExercise {
  // tempo eccentrico / pausa non hanno campo dedicato in PlannedExercise:
  // li accodiamo al cue per non perdere l'informazione del macro.
  const cueParts: string[] = [];
  if (typeof ex.tempo_eccentrico_sec === "number") cueParts.push(`${ex.tempo_eccentrico_sec}s discesa`);
  if (typeof ex.pause_sec === "number") cueParts.push(`pausa ${ex.pause_sec}s`);
  const cue = cueParts.length > 0 ? cueParts.join(" · ") : undefined;

  const planned: PlannedExercise = {
    exerciseId: ex.id,
    plannedSets: ex.sets,
    repsTarget: { min: ex.reps_min, max: ex.reps_max },
    rest_sec: ex.rest_sec,
  };
  // Esattamente UNO tra (weight_kg|pct1RM) | rpe_target | rir_target — qui dal
  // macro abbiamo rpe_target (il template usa quello). Lo passiamo se presente.
  if (typeof ex.rpe_target === "number") planned.rpe_target = ex.rpe_target;
  if (cue) planned.cue = cue;
  return planned;
}

/** Mappa MacroProgramInterval → CardioInterval (deterministico). */
function projectInterval(iv: MacroProgramInterval): CardioInterval {
  const out: CardioInterval = { kind: iv.kind };
  if (typeof iv.duration_min === "number") out.duration_min = iv.duration_min;
  if (typeof iv.distance_km === "number") out.distance_km = iv.distance_km;
  if (typeof iv.zone === "number") out.zone = iv.zone;
  if (typeof iv.reps === "number") out.reps = iv.reps;
  if (typeof iv.recovery_sec === "number") out.recovery_sec = iv.recovery_sec;
  if (iv.cue) out.cue = iv.cue;
  return out;
}

/** Mappa MacroProgramSession → PlannedSession (deterministico). */
function projectSession(s: MacroProgramSession, phaseName: string | undefined): PlannedSession {
  // details: combiniamo notes_text + setup_spatial (info preservation-friendly
  // dal macro che non hanno campo dedicato in PlannedSession).
  const detailParts: string[] = [];
  if (s.notes_text) detailParts.push(s.notes_text);
  if (s.setup_spatial) detailParts.push(`Setup: ${s.setup_spatial}`);
  const details = detailParts.join(" — ");

  const session: PlannedSession = {
    day: s.day,
    type: s.type,
    duration_min: s.duration_min,
    details,
    rationale: phaseName ? `Da macroprogramma (fase ${phaseName})` : "Da macroprogramma",
  };
  // Zona: derivata dal primo intervallo "main" se cardio (per badge UI).
  const mainIv = s.intervals.find(iv => iv.kind === "main") ?? s.intervals[0];
  if (mainIv?.zone) session.zone = mainIv.zone;

  if (s.exercises.length > 0) {
    session.exercises = s.exercises.map(projectExercise);
  }
  if (s.intervals.length > 0) {
    session.intervals = s.intervals.map(projectInterval);
  }
  return session;
}

/**
 * Calcola la startDate (lunedì) della settimana `weekNumber` del macro,
 * a partire da `metadata.start_date` (lunedì settimana 1).
 * Ritorna undefined se start_date non valida.
 */
function weekStartDate(program: MacroProgram, weekNumber: number): string | undefined {
  if (!program.metadata.start_date) return undefined;
  // Le settimane sono lun→dom: ancoriamo al LUNEDÌ della settimana di start_date
  // (anche se l'.md importato ha una data non-lunedì, es. sabato). Senza questo
  // le settimane risultavano sfasate (range "sab-ven") e i workout sbordavano.
  const monday = mondayOf(program.metadata.start_date);
  if (!monday) return undefined;
  const startTs = Date.parse(monday);
  if (!Number.isFinite(startTs)) return undefined;
  const d = new Date(startTs + (weekNumber - 1) * 7 * 24 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ProjectMacroResult {
  plan: TrainingPlan;
  /** Diagnostica per UI/log. */
  meta: {
    weekNumber: number;
    phaseName?: string;
    sessionsCount: number;
    weekFound: boolean;
  };
}

/**
 * Proietta la settimana `weekNumber` del macroprogramma in un TrainingPlan
 * deterministico (zero LLM). Ordina le sessioni per giorno della settimana.
 *
 * @param program macroprogramma attivo
 * @param weekNumber settimana da proiettare (1..weeks_total)
 * @param profile usato per profileHash (no logica LLM)
 * @returns TrainingPlan con sourceMacro popolato (adaptations vuoto: proiezione pura)
 *          o null se la settimana non esiste nel macro.
 */
export function projectMacroWeekToPlan(
  program: MacroProgram,
  weekNumber: number,
  profile: UserProfile | null,
): ProjectMacroResult | null {
  const weekData = program.weeks.find(w => w.week === weekNumber);
  if (!weekData) return null;

  const phaseName = phaseNameForWeek(program, weekNumber);
  const sortedSessions = [...weekData.sessions].sort(
    (a, b) => DAY_ORDER.indexOf(a.day as typeof DAY_ORDER[number]) - DAY_ORDER.indexOf(b.day as typeof DAY_ORDER[number]),
  );
  const projectedSessions = sortedSessions.map(s => projectSession(s, phaseName));

  const focus = weekData.notes
    ? `${phaseName ?? "Macro"}: ${weekData.notes}`
    : (phaseName ?? "Settimana macroprogramma");

  const week: PlanWeek = {
    weekNumber: 1, // il piano corrente è sempre "settimana 1" nel modello TrainingPlan
    focus,
    sessions: projectedSessions,
  };

  const now = new Date();
  const startDate = weekStartDate(program, weekNumber)
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const plan: TrainingPlan = {
    generatedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    startDate,
    weeks: [week],
    rationale: `Settimana ${weekNumber} di ${program.metadata.weeks_total} del programma "${program.metadata.title}"${phaseName ? ` — fase ${phaseName}` : ""}. Piano proiettato fedelmente dal macroprogramma.`,
    sourceMacro: {
      programId: program.metadata.title,
      weekNumber,
      phaseName,
      adaptations: [], // proiezione pura: nessun adattamento ancora
    },
  };

  return {
    plan,
    meta: { weekNumber, phaseName, sessionsCount: projectedSessions.length, weekFound: true },
  };
}

/**
 * Convenience: proietta la settimana CORRENTE del macroprogramma (in base a
 * start_date). Ritorna null se: macro senza start_date, programma non iniziato
 * o concluso, o settimana corrente non presente nei weeks[].
 */
export function projectCurrentMacroWeek(
  program: MacroProgram,
  profile: UserProfile | null,
): ProjectMacroResult | null {
  const progress = computeMacroProgress(program);
  if (!progress) return null;
  const wk = progress.currentWeek;
  if (wk < 1 || wk > program.metadata.weeks_total) return null;
  return projectMacroWeekToPlan(program, wk, profile);
}
