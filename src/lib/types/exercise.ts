// Catalogo esercizi: shape canonica per ogni esercizio bundlato in
// `src/lib/catalog/exercises.ts` (verrà aggiunto dal kb-content-specialist
// in Wave 2.1). L'LLM riceve la lista nomi nel prompt Pass-2 forza e DEVE
// referenziare `Exercise.id` esistenti — il validator equipment_mismatch +
// runtime substitution si appoggiano su questo contratto.

/**
 * Pattern motorio canonico (Cook/StrongFirst). Categorizza l'esercizio
 * funzionalmente, indipendentemente dall'attrezzo. Permette al validator
 * polarization/recovery di ragionare per pattern (es. due hinge consecutivi
 * = stress lombare doppio anche se uno è kettlebell e l'altro bilanciere).
 */
export type ExercisePattern =
  | "squat"
  | "hinge"
  | "lunge"
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "carry"
  | "core_antiext"
  | "core_antirot"
  | "plyometric"
  | "isometric"
  | "mobility";

/**
 * Livello tecnico minimo per eseguire l'esercizio in sicurezza.
 * - beginner: tecnica intuitiva, basso rischio (es. goblet squat).
 * - intermediate: richiede coordinazione/setup (es. back squat barbell).
 * - advanced: skill complessa o carichi alti (es. snatch, pistol squat).
 *
 * Pass-2 forza filtra il catalog escludendo `level > experienceByDiscipline.forza`.
 */
export type ExerciseLevel = "beginner" | "intermediate" | "advanced";

/**
 * Tag attrezzatura. Tutti i tag in `Exercise.equipment[]` sono required:
 * mancando anche uno solo nella `profile.equipment`, l'esercizio non è
 * eseguibile e il validator scatena substitution chain (G8).
 *
 * Volutamente granulare: distinguere bench/box/cable serve per la regola
 * di sostituzione (un esercizio con "bench" può degradare a "bodyweight"
 * solo se loadable=false; altrimenti chiede dumbbell+bench, kettlebell, etc.).
 */
export type EquipmentTag =
  | "bodyweight"
  | "dumbbell"
  | "barbell"
  | "kettlebell"
  | "band"
  | "machine"
  | "cable"
  | "trx"
  | "bench"
  | "pullup_bar"
  | "box";

/**
 * Singolo esercizio del catalog. Bundle TS const (Q1 risolta) → lookup O(1)
 * via `EXERCISES_BY_ID[id]` + tree-shaking.
 *
 * Naming convention `id`: kebab-case, attrezzo specificato nel suffisso quando
 * lo stesso pattern ha varianti (es. `back-squat-barbell` vs `goblet-squat-dumbbell`).
 * Cambiare `id` di un esercizio = breaking change (rompe Workout.exercises legacy).
 */
export interface Exercise {
  /** Slug stabile, es. "back-squat-barbell". MAI rinominare senza migration. */
  id: string;
  /** Nome user-facing italiano, es. "Back Squat con bilanciere". */
  name: string;
  pattern: ExercisePattern;
  /** Muscoli primari (≥1). Per stima volume + UI muscle map futura. */
  primaryMuscles: string[];
  /** Muscoli secondari (sinergici/stabilizzatori). */
  secondaryMuscles: string[];
  /** Equipment richiesto. TUTTI i tag sono necessari (AND, non OR). */
  equipment: EquipmentTag[];
  level: ExerciseLevel;
  /** Se true, va eseguito su entrambi i lati (sets contati per lato). */
  unilateral: boolean;
  /** Cue tecnico breve (1-2 frasi) iniettato nel UI esercizio. */
  technique: string;
  /**
   * Guida tecnica dettagliata per il Guided Player (2026-05-20).
   * 5 bullet brevi: Setup · Esecuzione · Respirazione · Errori comuni · Sicurezza.
   * Peer-reviewed-based (Schoenfeld, Helms, Rippetoe, ACSM). Opzionale: se
   * presente, mostrato in dettaglio durante l'allenamento guidato; se assente,
   * fallback su `technique`.
   * Hardcoded NON delegato a LLM (consistency + offline-capable).
   */
  guidance?: string[];
  /** Controindicazioni (es. ["lombare", "spalla anteriore"]). */
  cautions?: string[];
  /**
   * ID di esercizi sostitutivi in ordine di preferenza (G8). Il primo elemento
   * disponibile con `profile.equipment` viene usato dal substitutor. La chain
   * va degradando: barbell → dumbbell → kettlebell → bodyweight (max 3 hop).
   */
  alternatives: string[];
  /**
   * Se true, l'esercizio supporta carico esterno (kg) per stima volume
   * settimanale (sets×reps×weight). Stretch/mobility/iso a corpo libero hanno
   * loadable=false → non contribuiscono al volume forza.
   */
  loadable: boolean;
}
