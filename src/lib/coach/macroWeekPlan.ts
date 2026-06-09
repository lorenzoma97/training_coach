// Orchestratore "settimana dal macroprogramma" (Sprint A, 2026-05-27).
//
// Decide: se c'è un macroprogramma attivo che copre la settimana corrente,
// il piano della settimana è una PROIEZIONE deterministica del macro (non una
// rigenerazione LLM) + un adattamento DETERMINISTICO per readiness bassa.
//
// Zero LLM in questo path → il piano concorda col macro per costruzione, e
// gli adattamenti sono espliciti e tracciati in plan.sourceMacro.adaptations.
//
// Se NON c'è macro attivo (o non copre la settimana corrente) → ritorna null
// e il chiamante usa il path LLM esistente (generateInitialPlan/regenerate).

import type { TrainingPlan, UserProfile, PlannedSession } from "../types";
import { loadActiveMacroProgram } from "../macroprogram/storage";
import { projectCurrentMacroWeek } from "../macroprogram/projectToPlan";
import { getCurrentReadiness } from "./readinessScoring";
import { generateAdaptationDiff, applyAdaptationDiff, type WeekEvent } from "./macroAdapter";

/**
 * Adattamento DETERMINISTICO per readiness bassa (Sprint A).
 * - Cardio: zone 5→3, 4→3 (downgrade intensità).
 * - Forza: plannedSets -1 (min 2).
 * Logga ogni scostamento. Mutazione immutabile (ritorna nuove sessioni).
 *
 * NB: il swap esercizi per dolore (pain-aware) è deliberatamente rimandato:
 * richiede il substitutor + mapping pain→pattern (esiste in sessionDetail).
 * Sprint A copre solo readiness. Pain → adattamento futuro.
 */
function adaptForLowReadiness(sessions: PlannedSession[]): { sessions: PlannedSession[]; adaptations: string[] } {
  const adaptations: string[] = [];
  const adapted = sessions.map(s => {
    let changed = false;
    const next: PlannedSession = { ...s };

    // Cardio: downgrade zone alte
    if (s.intervals && s.intervals.length > 0) {
      let downgraded = false;
      next.intervals = s.intervals.map(iv => {
        if (iv.zone === 5 || iv.zone === 4) {
          downgraded = true;
          return { ...iv, zone: 3 as const };
        }
        return iv;
      });
      // anche la zona-sintesi della sessione
      if (next.zone === 5 || next.zone === 4) next.zone = 3;
      if (downgraded) {
        adaptations.push(`${s.day} ${s.type}: intensità cardio Z4/Z5 → Z3 (readiness bassa).`);
        changed = true;
      }
    }

    // Forza: riduci sets di 1 (min 2)
    if (s.exercises && s.exercises.length > 0) {
      let reduced = false;
      next.exercises = s.exercises.map(ex => {
        if (ex.plannedSets > 2) {
          reduced = true;
          return { ...ex, plannedSets: ex.plannedSets - 1 };
        }
        return ex;
      });
      if (reduced) {
        adaptations.push(`${s.day} ${s.type}: sets ridotti di 1 (readiness bassa).`);
        changed = true;
      }
    }

    if (changed) next.readinessAdjusted = true;
    return next;
  });
  return { sessions: adapted, adaptations };
}

/**
 * Se un macroprogramma attivo copre la settimana corrente, ritorna il piano
 * proiettato + adattato (deterministico). Altrimenti null.
 *
 * @param profile profilo utente (per la proiezione)
 * @returns TrainingPlan con sourceMacro popolato (incl. adaptations), o null
 */
export async function tryProjectMacroPlan(profile: UserProfile | null): Promise<TrainingPlan | null> {
  const program = await loadActiveMacroProgram().catch(() => null);
  if (!program) return null;

  const projected = projectCurrentMacroWeek(program, profile);
  if (!projected) return null; // macro non in range (pre-start/concluso) o settimana assente

  const plan = projected.plan;

  // Adattamento deterministico per readiness bassa
  const readiness = await getCurrentReadiness().catch(() => null);
  if (readiness?.band === "low" && plan.weeks[0]) {
    const { sessions, adaptations } = adaptForLowReadiness(plan.weeks[0].sessions);
    if (adaptations.length > 0) {
      plan.weeks[0] = { ...plan.weeks[0], sessions };
      plan.sourceMacro = {
        ...plan.sourceMacro!,
        adaptations: [...(plan.sourceMacro?.adaptations ?? []), ...adaptations],
      };
      plan.rationale += `\n\n[Adattamento readiness] ${adaptations.length} modifiche per readiness bassa oggi: ${adaptations.join(" ")}`;
    }
  }

  // profileHash per coerenza con i piani LLM (staleness detection)
  // Lasciato undefined: la proiezione segue il macro, non il profilo —
  // la staleness del macro è gestita separatamente (start_date/settimana).

  console.info("[macroWeekPlan] piano proiettato da macro: week=%d, fase=%s, adattamenti=%d",
    plan.sourceMacro?.weekNumber ?? 0,
    plan.sourceMacro?.phaseName ?? "-",
    plan.sourceMacro?.adaptations.length ?? 0);

  return plan;
}

/**
 * ADATTATORE VINCOLATO (Sprint G/H, 2026-06-09) — il path "adatta a metà
 * settimana" quando c'è un macroprogramma attivo.
 *
 * A differenza di `adaptPlan` (LLM libero che diverge dal macro), questo:
 *  1. Riparte SEMPRE dalla proiezione FEDELE della settimana corrente.
 *  2. Chiede a Gemini un DIFF VINCOLATO dati gli eventi (no piano nuovo).
 *  3. Applica + valida il diff contro lo scheletro del macro (applyAdaptationDiff).
 *
 * Risultato: la settimana resta concorde col macro per costruzione, ma si adatta
 * a dolore / readiness / deviazioni / richieste. Ogni modifica è tracciata in
 * sourceMacro.adaptations.
 *
 * Ritorna null se non c'è macro attivo (→ il chiamante usa adaptPlan legacy).
 * Se non ci sono eventi, ritorna la proiezione fedele (applied vuoto).
 */
export async function adaptMacroWeek(
  profile: UserProfile | null,
  events: WeekEvent[],
): Promise<{ plan: TrainingPlan; applied: string[]; rejectedCount: number } | null> {
  const program = await loadActiveMacroProgram().catch(() => null);
  if (!program) return null;

  const projected = projectCurrentMacroWeek(program, profile);
  if (!projected) return null;

  const plan = projected.plan;
  const weekNumber = plan.sourceMacro?.weekNumber ?? projected.meta.weekNumber;
  if (!plan.weeks[0] || events.length === 0) {
    return { plan, applied: [], rejectedCount: 0 };
  }

  const readiness = await getCurrentReadiness().catch(() => null);
  const band = readiness?.band;

  const diff = await generateAdaptationDiff({
    sessions: plan.weeks[0].sessions,
    events, program, weekNumber, profile, readinessBand: band,
  });

  const result = applyAdaptationDiff(plan.weeks[0].sessions, diff, {
    program, weekNumber, readinessBand: band,
  });

  plan.weeks[0] = { ...plan.weeks[0], sessions: result.sessions };
  plan.sourceMacro = {
    ...plan.sourceMacro!,
    adaptations: [...(plan.sourceMacro?.adaptations ?? []), ...result.applied],
  };
  if (result.applied.length > 0) {
    plan.rationale += `\n\n[Adattamento settimana] ${result.applied.length} modifiche per eventi reali: ${result.applied.join(" ")}`;
  }

  console.info("[macroWeekPlan] adattatore vincolato: eventi=%d, applicate=%d, rifiutate=%d",
    events.length, result.applied.length, result.rejected.length);

  return { plan, applied: result.applied, rejectedCount: result.rejected.length };
}
