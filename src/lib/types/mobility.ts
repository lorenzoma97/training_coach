// Routine mobility/warmup/cooldown pre-strutturate (G6). Bundlate in
// `src/lib/catalog/mobilityRoutines.ts` (kb-content-specialist Wave 2.1)
// con ≥6 routine: FIFA 11+, Movement Prep, Dynamic Flow Runner, Foam Rolling,
// Yoga Recovery 20', Calf+Achilles Protocol.

/**
 * Singolo step di una routine. duration_sec XOR reps (almeno uno dei due).
 * Stretch tipici: duration_sec 30-60. Movimenti dinamici: reps 8-15.
 */
export interface MobilityStep {
  /** Nome user-facing (es. "World's Greatest Stretch"). */
  name: string;
  /** Durata in secondi (mutually exclusive con reps). */
  duration_sec?: number;
  /** Ripetizioni (mutually exclusive con duration_sec). Per unilaterale: per lato. */
  reps?: number;
  /** Cue tecnico breve (1 frase). Es. "Spinta dal tallone, ginocchio sopra il piede". */
  cue: string;
}

/**
 * Routine completa. Iniettabile in `PlannedSession.warmupRoutineId/cooldownRoutineId`.
 * UI rendering step-by-step con timer (Q5: in-app, no link esterni — PWA offline-first).
 */
export interface MobilityRoutine {
  /** Slug stabile, es. "fifa-11plus", "movement-prep". */
  id: string;
  /** Nome user-facing. */
  name: string;
  /**
   * Scopo principale. Influenza quando viene proposta dal coach:
   * - warmup: pre-sessione (5-15 min).
   * - cooldown: post-sessione (5-10 min).
   * - recovery: giorno di riposo attivo (15-30 min).
   * - injury_prevention: routine programmatica (FIFA 11+ pre-calcio).
   */
  purpose: "warmup" | "cooldown" | "recovery" | "injury_prevention";
  /** Durata totale della routine (sec sommati per stima). */
  duration_min: number;
  /** Step ordinati. Nessun re-ordering: la sequenza è prescrittiva. */
  steps: MobilityStep[];
  /**
   * Sport target. Undefined = generalista. Es. "calcio" per FIFA 11+, "corsa"
   * per Dynamic Flow Runner. Filtra catalog nella UI selector per sport.
   */
  sport?: string;
  /** Citazione scientifica opzionale (es. "Soligard BMJ 2008"). */
  citation?: string;
}
