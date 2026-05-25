// MacroProgram: types per programmi multi-settimanali generati esternamente
// (es. Claude Opus 4.7 deep search) e importati nel coach app.
//
// Pattern Tier 1/Tier 2 (2026-05-25):
// - Tier 1: l'utente genera il programma su Claude usando docs/MACROPROGRAM_TEMPLATE.md
// - L'utente carica il .md nell'app → parser estrae blocco JSON + narrative markdown
// - Tier 2 (planGenerator esistente) usa il MacroProgram come vincolo per generare
//   la settimana corrente strutturata, adattata ai signal daily (readiness, ACWR,
//   adherence, pain)
//
// Schema documentato in docs/MACROPROGRAM_TEMPLATE.md.

import type { ExercisePattern, EquipmentTag } from "./exercise";

export type DayLabel = "lun" | "mar" | "mer" | "gio" | "ven" | "sab" | "dom";
export type SessionType = "corsa" | "forza_gambe" | "forza_upper" | "sport" | "mobilita";
export type IntervalKind = "warmup" | "main" | "cooldown" | "repetition" | "recovery";
export type Zone = 1 | 2 | 3 | 4 | 5;
export type MetricFrequency = "daily" | "weekly" | "after_rsa_session" | "after_session";

/**
 * Esercizio nel macroprogramma. Superset di PlannedExercise (lib/types.ts)
 * con campi extra preservation-friendly per scheda Claude:
 * - tempo_eccentrico_sec, pause_sec: parametri di esecuzione fine
 * - variants: alternative selezionabili in pre-flight editor
 * - technique + guidance: SOLO per esercizi nuovi (Tier 3 auto-add)
 *
 * Quando il parser matcha l'id con catalog esistente (Tier 1/2):
 * `technique` e `guidance` vengono ignorati (consistency con catalog).
 *
 * Quando l'id è nuovo (Tier 3):
 * `technique` e `guidance` sono OBBLIGATORI — il parser crea un Exercise
 * nel user-custom catalog usando questi dati.
 */
export interface MacroProgramExercise {
  id: string;
  name?: string;
  pattern?: ExercisePattern;
  equipment?: EquipmentTag[];
  sets: number;
  reps_min: number;
  reps_max: number;
  rpe_target?: number;
  rest_sec: number;
  tempo_eccentrico_sec?: number;
  pause_sec?: number;
  variants?: string[];
  technique?: string;
  guidance?: string[];
}

export interface MacroProgramInterval {
  kind: IntervalKind;
  duration_min?: number;
  distance_km?: number;
  zone?: Zone;
  reps?: number;
  recovery_sec?: number;
  cue?: string;
}

export interface MacroProgramSession {
  day: DayLabel;
  type: SessionType;
  duration_min: number;
  notes_text?: string;
  setup_spatial?: string;
  exercises: MacroProgramExercise[];
  intervals: MacroProgramInterval[];
}

export interface MacroProgramWeek {
  week: number;
  notes?: string;
  sessions: MacroProgramSession[];
}

export interface MacroProgramPhase {
  name: string;
  weeks: number[];
  focus: string;
  rpe_target_min?: number;
  rpe_target_max?: number;
  notes?: string;
}

export interface MacroProgramMetadata {
  title: string;
  goal: string;
  sport: string;
  weeks_total: number;
  start_date?: string;
  generated_at?: string;
  generated_by?: string;
}

export interface MacroProgramTrackingMetric {
  id: string;
  name: string;
  unit: string;
  frequency: MetricFrequency;
  notes?: string;
}

/**
 * Struct completo del macroprogramma parsed.
 * Persistito in storage `user-macroprogram` (1 attivo per volta).
 */
export interface MacroProgram {
  metadata: MacroProgramMetadata;
  phases: MacroProgramPhase[];
  weeks: MacroProgramWeek[];
  tracking_metrics?: MacroProgramTrackingMetric[];
  /** Parte narrative markdown (testo prima del blocco JSON). Renderizzato as-is. */
  narrative_markdown: string;
  /** ISO datetime di import nell'app. */
  imported_at: string;
}

/**
 * Risultato del parse di un file .md macroprogramma.
 * Include esercizi non riconosciuti dal catalog (Tier 3) per UI dialog.
 */
export interface MacroProgramParseResult {
  program: MacroProgram;
  /**
   * Esercizi che il parser ha auto-aggiunto al user-custom catalog perché
   * il loro id NON esiste nel catalog hardcoded. Mostrati all'utente come
   * "+N nuovi esercizi aggiunti" notifica post-import.
   *
   * Sprint 2 (parser-only): SEMPRE vuoto (tutti gli id sono accettati come-è).
   * Sprint 3 (fuzzy matcher + Tier 3): popolato dopo lookup catalog.
   */
  orphanExercises: Array<{
    exerciseId: string;
    name?: string;
    pattern?: ExercisePattern;
  }>;
  /** Warning non-bloccanti (es. data start passata, settimane fuori sequenza). */
  warnings: string[];
}
