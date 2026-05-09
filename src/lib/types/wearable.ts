// Sample importato da wearable (G4). v2: solo Samsung Health (Q6 risolta).
// Architettura predisposta per espansione futura (`source` enum).
// Parser Samsung Health ZIP CSV in `samsungHealthParser.ts` (Wave 3.2).

/**
 * Singolo sample di attività/metrica importato. Persistito in
 * `wearable-samples-v1` finché non viene matched a un Workout esistente
 * (cleanup dopo 90 giorni se non matched). Post-import flow:
 *   1. Parser produce WearableSample[] dal CSV ZIP.
 *   2. UI preview con dedup info (vedi I2: dedupKey-based).
 *   3. User conferma → samples diventano Workout o vengono attached a
 *      Workout esistenti via matchedWorkoutId.
 */
export interface WearableSample {
  /** Sorgente. v2 supporta solo "samsung_health"; "manual" per record di test. */
  source: "samsung_health" | "manual";
  /**
   * ISO datetime UTC normalizzato. Samsung Health esporta in local timezone:
   * il parser converte in UTC usando la TZ esportata nel CSV header.
   */
  startedAt: string;
  /** Durata sessione in minuti (intero, arrotondato dal parser). */
  duration_min: number;
  /**
   * Tipo nativo dal wearable (es. "Running", "Soccer", "Weight training").
   * Conservato per debug/audit + permette di mostrare warning per tipi
   * sconosciuti senza perderli.
   */
  rawType: string;
  /**
   * Tipo mappato all'enum app via mapping table (in `samsungHealthMapping.ts`).
   * Tipi sconosciuti → "sport" (catch-all) con warning UI.
   */
  mappedType: "corsa" | "forza_gambe" | "forza_upper" | "sport" | "mobilita";
  /**
   * Hash deterministico per dedup (I2). Algoritmo (definito in spec §5.3):
   *   sha1(date_iso_minute|mappedType|round(duration_min/2)*2)
   * Granularità 2 min sulla durata per tollerare differenze trascurabili
   * tra wearable (rounding a end-of-session) e diario manuale.
   * Match contro `workout.fields.dedupKey` esistente → skip import.
   */
  dedupKey: string;
  /** HR media bpm. Optional: alcuni sample (forza) non hanno HR continuo. */
  hrAvg?: number;
  /** HR max bpm raggiunta nella sessione. */
  hrMax?: number;
  /**
   * RMSSD ms se Samsung Health esporta HRV per quella sessione (rare —
   * tipicamente HRV è solo morning). Usato da readinessScoring se presente.
   */
  hrvRmssd?: number;
  /** Distanza km (corsa/trail/bike). */
  distance_km?: number;
  /** Calorie stimate dal wearable. Bassa affidabilità ma esposte per audit. */
  calories?: number;
  /**
   * ID del Workout matched post-import:
   * - undefined = importato come nuovo Workout standalone.
   * - string = attached a Workout esistente (utente aveva registrato a mano,
   *   l'import arricchisce con HR/distance dal wearable).
   * - null = match candidato presente ma utente ha scelto "duplicato, skip".
   */
  matchedWorkoutId?: string | null;
}
