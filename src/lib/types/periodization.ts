// Periodizzazione race-driven (G5). L'utente configura RaceEvent →
// macroPlanner deterministico (futuro `src/lib/coach/macroPlanner.ts`)
// genera MacroCycle con phases. Pass-1 dell'orchestrator riceve
// `MacroCtx { phase, weekNumber, volumeMultiplier }` come input.

/**
 * Fasi standard di un macrociclo periodizzato (Bompa/Issurin).
 * - base: aerobic capacity, volumi alti intensità bassa.
 * - build: introduzione qualità (soglia, ripetute), volume mantenuto.
 * - peak: race-pace specifico, intensità alta + volume in calo.
 * - taper: scarico pre-gara (-30/50% volume, intensità mantenuta).
 * - transition: recovery attivo post-gara (1-2 settimane).
 */
export type MacroPhase = "base" | "build" | "peak" | "taper" | "transition";

/**
 * Race configurata dall'utente (G5). Persistita in `user-races`. Sorgente di
 * verità per il macroPlanner: cambiare/aggiungere/rimuovere race triggera
 * rigenerazione del MacroCycle (ma NON del piano corrente — vedi I3).
 *
 * sport enum stretto (Q8 risolta): macroPlanner ha rule diverse per ognuno
 * (es. trail richiede più volume Z2 + descent skills, triathlon ha 3
 * disciplines parallele). "altro" catch-all per casi non standard.
 */
export interface RaceEvent {
  /** UUID stabile generato lato client. */
  id: string;
  /** Nome user-facing (es. "Maratona di Bologna 2026"). */
  name: string;
  /** Disciplina target. Determina rules nel macroPlanner. */
  sport: "corsa" | "sport" | "trail" | "triathlon" | "altro";
  /** Data della gara (YYYY-MM-DD). Coincide con MacroCycle.endDate. */
  date: string;
  /** Distanza in km (corsa/trail). Undefined per sport di squadra/triathlon. */
  distance_km?: number;
  /**
   * Tempo target free-text (es. "1:45:00", "sub 4h"). Se l'utente specifica
   * un tempo numerico parsable, popolare anche `targetTimeSec` per validator
   * pace-based.
   */
  targetTime?: string;
  /** Tempo target in secondi (parsed da targetTime). Per calcoli pace. */
  targetTimeSec?: number;
  /**
   * Priorità race (Daniels' Running Formula):
   * - A: peak event, macrociclo intero costruito attorno (max 1-2/anno).
   * - B: gara importante usata come test (no full taper, mini-taper 1 sett).
   * - C: gara di allenamento (zero taper, performance secondaria).
   */
  priority: "A" | "B" | "C";
  /** Note libere (terreno, altimetria, condizioni). */
  notes?: string;
  /** ISO datetime di creazione record. */
  createdAt: string;
}

/**
 * Mesociclo (settimana di un macrociclo). Calcolato deterministicamente dal
 * macroPlanner — NON modificabile dall'utente direttamente. L'utente cambia
 * RaceEvent → macroPlanner ricomputa tutti i mesi.
 */
export interface MesoCycle {
  /** Numero settimana DALL'INIZIO del macrociclo (1..N). */
  weekNumber: number;
  phase: MacroPhase;
  /**
   * Moltiplicatore volume rispetto alla baseline utente.
   * 1.0 = baseline | 1.2 = +20% | 0.6 = deload | 0.4 = taper.
   * Pass-1 inietta `"VOLUME: ${volMul}x baseline"` nel prompt.
   */
  volumeMultiplier: number;
  /**
   * % sessioni Z3+ rispetto al totale corsa nella settimana.
   * Modello polarizzato Seiler: base 80/20 → peak 60/40.
   */
  intensityHighPct: number;
  /** Focus settimana user-facing (es. "base aerobica", "soglia", "race pace"). */
  focus: string;
}

/**
 * Macrociclo completo race-driven (12-24 settimane tipiche). Persistito in
 * `macro-cycle:<id>` storage. Quando l'utente aggiunge/cambia race con
 * priority=A, viene rigenerato e impostato come `profile.activeMacroCycleId`.
 *
 * I3: rigenerare il macro NON rigenera il piano corrente. UI mostra banner
 * "il tuo macrociclo è cambiato, ricalcola il piano corrente?".
 */
// DUE SISTEMI "MACRO" DISTINTI (vedi anche MacroProgram in types/macroprogram.ts):
//  - MacroCycle (QUESTO): scheletro fasi base/build/peak/taper generato dalle
//    RACE (macroPlanner.ts), storage `macro-cycle:<id>`, evento `macro:updated`.
//  - MacroProgram: programma .md IMPORTATO con sessioni complete, storage
//    `user-macroprogram`, proiezione deterministica. Sistemi separati, non si
//    parlano: il naming "macro" e' storicamente sovrapposto.
export interface MacroCycle {
  /** UUID stabile. */
  id: string;
  /** FK RaceEvent.id (sempre priority=A). */
  raceId: string;
  /** Lunedì dell'inizio del macrociclo (YYYY-MM-DD). */
  startDate: string;
  /** Coincide con race.date. */
  endDate: string;
  /** Settimane taggate per fase. Ordine cronologico. */
  phases: MesoCycle[];
  /**
   * Hash deterministico FNV-1a 32-bit di {race.id, race.date, race.sport,
   * race.targetTimeSec, startDate} (vedi macroPlanner.macroInputHash).
   * Cambia → rigenerazione necessaria. Drift detection analoga a planStateHash.
   * NB: profile.experience NON incluso (drift profilo è gestito da planStateHash
   * separatamente, non dal macro).
   */
  inputHash: string;
}
