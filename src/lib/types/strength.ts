// Performance forza registrata dall'utente nel diario (post-sessione) +
// stima/test 1RM per i lift principali. Pass-2 forza legge `OneRepMax`
// dal profilo per generare carichi prescrittivi (%1RM) invece di range RPE
// generici (G1, G3).

/**
 * Singolo set effettivamente eseguito. Salvato come elemento di
 * `ExercisePerformance.sets[]`. Tutti i campi metrici sono opzionali tranne
 * `reps`: il diario tollera input parziali (es. utente registra solo reps+kg
 * senza RPE) — il validator `strength_load_progression` graceful-degrade.
 */
export interface ExerciseSet {
  /** Ripetizioni effettivamente completate (può essere 0 se set fallito). */
  reps: number;
  /**
   * Carico sollevato in kg. Undefined → bodyweight (peso corporeo, derivabile
   * da `profile.weight_kg` per stima volume). Per esercizi unilaterali è il
   * peso PER LATO, non totale (convenzione: la maggior parte dei manubri).
   */
  weight_kg?: number;
  /**
   * Rate of Perceived Exertion (Borg modificato 1-10). Optional ma fortemente
   * consigliato: lo stimatore Brzycki/Epley pesa diversamente i set RPE 8+
   * vs RPE 6 (i primi sono più predittivi di 1RM reale).
   */
  rpe?: number;
  /**
   * Reps in Reserve (alternativa pedagogica a RPE: "quante reps avrei potuto
   * fare ancora"). RIR=0 ≈ RPE 10. Inietta UNO solo dei due in pass-2.
   */
  rir?: number;
  /**
   * Tempo di riposo PRIMA di questo set (sec). Per super-set/EMOM/cluster
   * sets — il primo set della sessione tipicamente non lo specifica.
   */
  rest_sec?: number;
  /**
   * Tempo sotto tensione totale del set (sec). Mostly per ipertrofia/eccentriche
   * controllate. Optional, raramente registrato dagli amatori.
   */
  tut_sec?: number;
}

/**
 * Performance di un esercizio in una sessione. Salvato in
 * `Workout.exercises?: ExercisePerformance[]` PARALLELO al legacy `fields.note`
 * (vedi I8 nel design doc). Validator `strength_load_progression` legge da qui;
 * se `exercises[]` vuoto/assente, fallback regex su `fields.note`.
 */
export interface ExercisePerformance {
  /**
   * FK a `Exercise.id`. Validato runtime: se l'id non esiste in catalog,
   * UI mostra "esercizio sconosciuto: <id>" + il nome free-text se presente.
   */
  exerciseId: string;
  /** Sets eseguiti (ordine cronologico). 0..N actualSets ≤ plannedSets. */
  sets: ExerciseSet[];
  /** Note libere dell'utente (es. "tecnica buona, ho perso bracing al 4° set"). */
  notes?: string;
  /**
   * Se l'utente segnala uno stallo, viene iniettato nel prompt di Pass-2
   * della prossima sessione per adattare il carico/volume.
   * - form_breakdown: tecnica persa → de-load 5%
   * - rpe_cap: RPE 10 raggiunto prima delle reps target → mantieni carico
   * - missed_reps: reps target non raggiunte → mantieni carico, retry settimana prossima
   * - pain: dolore → swap esercizio o skip pattern
   */
  failureReason?: "form_breakdown" | "rpe_cap" | "missed_reps" | "pain";
}

/**
 * 1RM (one-rep max) per un lift principale. Persistito in
 * `profile.oneRepMaxes[]` E in `user-1rm-history` (storage append-only per UI
 * trend). Aggiornamento policy (I4): `tested` non viene MAI sovrascritto
 * automaticamente; `estimated` viene aggiornato solo se il nuovo valore
 * stimato è > del precedente stimato (hill-climbing).
 */
export interface OneRepMax {
  /** FK Exercise.id. Tipicamente squat/bench/deadlift/overhead-press. */
  exerciseId: string;
  /** Valore 1RM in kg. Range tipico amatoriale 30-200kg. */
  value_kg: number;
  /**
   * - tested: l'utente ha fatto un test sul campo (1RM diretto o 3-5RM convertito
   *   con coefficienti standard). Massima affidabilità.
   * - estimated: derivato da una sessione del diario via Brzycki/Epley.
   *   Affidabilità inversa al numero di reps (≤6 reps = stima buona, >10 = poco
   *   affidabile, >15 = filtrare).
   */
  source: "tested" | "estimated";
  /**
   * ISO date (YYYY-MM-DD) di acquisizione. UI mostra prompt "re-test 1RM" se
   * `acquiredAt` è più vecchio di 6 mesi (i carichi cambiano con la stagione).
   */
  acquiredAt: string;
  /**
   * Solo se source=estimated: id del workout che ha generato la stima
   * (audit trail per "perché il piano usa questo carico?"). Permette di
   * ricomputare se il workout viene editato/cancellato.
   */
  fromWorkoutId?: string;
}
