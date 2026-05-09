// Readiness scoring (G7). Calcolato da `readinessScoring.ts` (Wave 3.4
// data-integration-specialist) combinando HRV trend 7gg vs baseline 30gg +
// sleep score + soggettivo (morningFreshness). Validator `validateReadiness`
// downgrade Z4/5 → Z2/3 se score < 50 (auto-correction).

/**
 * Snapshot giornaliero della readiness. Persistito in `readiness-history`
 * (last 60 days, pruning automatico). UI mostra trend sparkline + score
 * di oggi nel dashboard.
 */
export interface ReadinessSnapshot {
  /** YYYY-MM-DD. Una snapshot per giorno (overwrite se ricomputata). */
  date: string;
  /** Score 0-100. Soglie: <50 low, 50-70 moderate, >70 high. */
  score: number;
  /**
   * Componenti del calcolo, esposti per UI breakdown + debug. Ogni componente
   * è opzionale: se manca un input (es. wearable non sync da 3gg → no HRV),
   * il calcolo prosegue con i restanti pesati upward.
   */
  components: {
    /**
     * RMSSD oggi - baseline 30gg (ms). Negativo = stress autonomico.
     * Soglia warning: delta < -10ms su baseline >40ms.
     */
    hrvDelta?: number;
    /** Score sleep 0-100 derivato da hours+quality (sleep score Whoop-like). */
    sleepScore?: number;
    /** morningFreshness mappato 0-100 (1→0, 5→100). */
    subjectiveScore?: number;
    /** DOMS soggettivo 0-100 (se l'utente registra). */
    soreness?: number;
  };
  /**
   * Banda categorica derivata dal score. Mostrata in UI come pill colorata
   * (low=red, moderate=yellow, high=green) per quick read.
   */
  band: "low" | "moderate" | "high";
  /**
   * Aggiustamento applicato dal validator (audit trail). undefined o "none"
   * = nessuna modifica al piano oggi. Mostrato in UI session card come
   * "Adattato per readiness bassa: Z5 → Z3".
   */
  appliedAdjustment?: "downgrade_z45" | "skip_session" | "none";
}
