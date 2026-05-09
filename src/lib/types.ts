// ─────────────────────────────────────────────────────────────────────────────
// Barrel re-exports per i nuovi domini v2 (Wave 2.1). Qualunque consumer che
// importi da "src/lib/types" continua a vedere gli stessi simboli, più i
// nuovi tipi del dominio "Personal Trainer Pro". Questo evita import sparsi
// da `types/exercise`, `types/strength`, ecc. nei call-site.
export * from "./types/exercise";
export * from "./types/strength";
export * from "./types/periodization";
export * from "./types/mobility";
export * from "./types/readiness";
export * from "./types/wearable";

import type { OneRepMax } from "./types/strength";
import type { RaceEvent, MacroPhase } from "./types/periodization";

export type Sex = "m" | "f" | "other";
export type Experience = "sedentary" | "occasional" | "regular" | "competitive";

/**
 * Tracking opzionale del ciclo mestruale per donne. Rilevante per:
 * (a) contestualizzazione di stanchezza/performance durante fasi luteali
 * (Elliott-Sale 2020: effect size trivial ma varianza individuale alta),
 * (b) rilevamento segnali RED-S (Mountjoy IOC 2023) — amenorrea persistente
 * è red flag di low energy availability.
 */
export interface MenstrualCycle {
  /** Tracking attivo? Se false, il profilo non usa questi campi. */
  enabled: boolean;
  /** Contraccezione ormonale (influenza la ciclicità dei sintomi). */
  contraception?: "none" | "combined_pill" | "progestin_only" | "iud_hormonal" | "iud_copper" | "other";
  /** Data inizio ultimo ciclo (YYYY-MM-DD). Opzionale. */
  lastPeriodStart?: string;
  /** Lunghezza media del ciclo in giorni, tipicamente 21-35. */
  avgCycleLengthDays?: number;
}

export interface UserProfile {
  age: number;
  sex: Sex;
  weight_kg: number;
  height_cm: number;
  experience: Experience;
  injuries: string[];
  meds: string;
  weekly_availability: { days: number; hoursPerSession: number };
  /**
   * Giorni della settimana in cui l'utente PUÒ allenarsi (default routine).
   * Vincolo HARD per il piano: il coach prescrive sessioni SOLO in questi giorni.
   * Se undefined o vuoto: il coach sceglie liberamente (retrocompat con piani esistenti).
   * Override per-rigenerazione disponibile dal picker "Rigenera piano".
   */
  availableDays?: Array<"lun" | "mar" | "mer" | "gio" | "ven" | "sab" | "dom">;
  /**
   * Preferenza intensità del piano. Soft hint per l'LLM: indica che tipo di
   * settimana l'utente vuole, lasciando al coach la scelta delle modalità
   * (HIIT/ripetute/long/forza pesante ecc.). Le safety rules in baseSystemPrompt
   * restano comunque applicate (FC age-tiered, recovery 48h, dolore stop).
   * - "soft":     priorità recovery e mantenimento. Volume basso, intensità Z1-Z2.
   * - "balanced": equilibrio tra base aerobica e qualità. Default.
   * - "intense":  spinto. Adatto a obiettivi peak/weight loss/performance.
   * - "very_intense": massima intensità sostenibile (peaking pre-gara, RED-S risk
   *                   se persistente — l'LLM deve consigliare deload periodici).
   */
  intensityPreference?: "soft" | "balanced" | "intense" | "very_intense";
  equipment: string[];
  notes?: string;
  /**
   * Zone del corpo di cui l'utente vuole monitorare il dolore durante gli
   * allenamenti. Se vuoto o undefined, il pain picker NON viene mostrato.
   * Valori tipici: "polpaccio", "ginocchio", "tendine d'achille", "schiena",
   * "spalla". Configurabili nell'onboarding se sono dichiarati infortuni.
   */
  painTrackingAreas?: string[];
  /** Mostrato solo se sex === "f". */
  menstrualCycle?: MenstrualCycle;
  /**
   * FCmax misurata da test sul campo (in bpm). Se presente, sostituisce la stima
   * Tanaka per il calcolo zone. Più affidabile di qualsiasi formula.
   * Test consigliato: 5km warmup + 3min hard + 2min recovery + 3min all-out finale.
   * La FC max raggiunta nell'ultima fase = FCmax.
   */
  fcMaxTested?: number;
  /** ISO date del test FCmax (per scadenza/refresh dopo 6+ mesi). */
  fcMaxTestedAt?: string;
  // ──────────────────────────────────────────────────────────────────────────
  // Estensioni v2 "Personal Trainer Pro" — tutti opzionali (no breaking).
  // Vedi ARCHITECTURE.md §2.2.

  /**
   * 1RM per i lift principali (G3). Estensibile (qualsiasi Exercise.id).
   * Pass-2 forza usa `pct1RM` se presente, altrimenti `rpe_target`.
   */
  oneRepMaxes?: OneRepMax[];
  /**
   * True se l'utente ha collegato un wearable (Samsung Health v2).
   * Influenza la UI (pulsante "Importa Samsung") e il fallback readinessScoring.
   */
  wearableConnected?: boolean;
  /** ISO datetime ultima sync wearable. */
  wearableLastSync?: string;
  /**
   * Race future configurate (G5). Sorgente di verità per macroPlanner.
   * Cambiare → rigenera `MacroCycle` ma NON il piano corrente (I3).
   */
  races?: RaceEvent[];
  /**
   * ID del MacroCycle attivo (race priority=A più imminente). Calcolato.
   * Persistito separatamente in `macro-cycle:<id>` storage key.
   */
  activeMacroCycleId?: string;
  /**
   * Esperienza per disciplina, più granulare di `profile.experience` globale.
   * Pass-2 forza filtra `Exercise.level <= experienceByDiscipline.forza` per
   * non proporre exercise advanced a un beginner forza che è regular nella corsa.
   */
  experienceByDiscipline?: {
    corsa?: Experience;
    forza?: Experience;
    sport?: Experience;
  };
  createdAt: string;
  updatedAt: string;
}

export type GoalStatus = "pending" | "active" | "achieved" | "archived";

export type GoalPriority = "alta" | "media" | "bassa";

export interface UserGoal {
  id: string;
  originalDescription: string;
  smartDescription: string;
  kpi: { metric: string; target: string; deadline: string };
  realistic: boolean;
  coachReasoning: string;
  status: GoalStatus;
  /** Priorità selezionata dall'utente. Default "media". Iniettata nel prompt del coach. */
  priority?: GoalPriority;
  /** Ordine di visualizzazione (0-based). Più basso = più in alto nella lista. */
  sortOrder?: number;
  createdAt: string;
}

/**
 * Esercizio prescritto in una sessione forza (Wave 2.1, Personal Trainer Pro).
 * Riferenzia un `Exercise.id` del catalog. Esattamente UNO tra
 * (weight_kg | pct1RM | rpe_target) deve essere definito — il validator
 * `pct1rm_reps_mismatch` enforce questa invariante a livello di plan.
 */
export interface PlannedExercise {
  /** FK Exercise.id (catalog). LLM allowlist iniettata nel prompt Pass-2. */
  exerciseId: string;
  /** Numero set programmati. */
  plannedSets: number;
  /**
   * Range reps target. Renderizzato in UI come "8-10 reps".
   * Se min === max (es. 5-5), UI mostra solo il numero singolo.
   */
  repsTarget: { min: number; max: number };
  /** Carico assoluto kg. Mutually exclusive con pct1RM. */
  weight_kg?: number;
  /** Carico relativo %1RM (0-100). Richiede `profile.oneRepMaxes[exerciseId]`. */
  pct1RM?: number;
  /** Target RPE (1-10). Fallback se manca pct1RM e weight_kg. */
  rpe_target?: number;
  /** Reps in Reserve target (0-5). Alternativa pedagogica a RPE. */
  rir_target?: number;
  /** Riposo tra i set in secondi. Required per evitare sessioni "open-ended". */
  rest_sec: number;
  /** Cue tecnico breve (1 frase). */
  cue?: string;
  /**
   * ID dell'esercizio sostitutivo runtime (G8). Calcolato a render-time dal
   * substitutor in base a `profile.equipment` corrente. NON persistito —
   * il piano salvato contiene sempre `exerciseId` originale.
   */
  effectiveExerciseId?: string;
}

/**
 * Blocco strutturato di una sessione cardio (Wave 2.1). Sostituisce le
 * "details" free-text della v1 per le sessioni corsa: warmup + main + cooldown
 * con zone/duration esplicite. Il validator polarization legge da qui.
 */
export interface CardioInterval {
  /**
   * Tipo blocco. "repetition" = uno dei N intervalli di una serie ripetute;
   * "recovery" = recovery jog tra repetition.
   */
  kind: "warmup" | "main" | "cooldown" | "repetition" | "recovery";
  /** Durata in minuti. Mutually exclusive con distance_km a discrezione coach. */
  duration_min?: number;
  /** Distanza km (es. "1km @ Z4"). Mutually exclusive con duration_min. */
  distance_km?: number;
  /** Zona FC target. Coerente con PlannedSession.zone (cardio types). */
  zone?: 1 | 2 | 3 | 4 | 5;
  /** Numero ripetizioni se kind=repetition (es. 6×400m). */
  reps?: number;
  /** Recovery PRIMA del prossimo rep (sec). Solo per kind=repetition/recovery. */
  recovery_sec?: number;
  /** Cue/note tecniche. */
  cue?: string;
}

/**
 * Blocco generico per sessioni mobility/sport pre-strutturate (Wave 2.1).
 * Es. sport calcio: blocchi "Activation 10' / Skill 15' / Conditioning 20'".
 * Free-text intentional: il dettaglio dei singoli step sta in
 * `MobilityRoutine.steps` se è una routine catalogata.
 */
export interface SessionBlock {
  /** Nome blocco user-facing (es. "Activation", "Skill", "Conditioning"). */
  name: string;
  duration_min: number;
  /** Descrizione free-text del contenuto. */
  details: string;
}

/**
 * Regola di progressione settimana-su-settimana (Wave 2.1). Iniettata in
 * Pass-2 della prossima settimana per adattare il carico in base ai risultati.
 * Free-text + condizione: l'LLM interpreta. Esempio:
 *   triggerCondition: "se 3 sessioni consecutive con RPE ≤ 7"
 *   action: "+2.5 kg sul main lift"
 */
export interface ProgressionRule {
  triggerCondition: string;
  action: string;
}

export interface PlannedSession {
  day: string;            // "lun" | "mar" | ... | ISO date se assegnato a data
  date?: string;          // YYYY-MM-DD
  type: string;           // uno dei WORKOUT_TYPES.id
  subtype?: string;
  duration_min: number;
  details: string;
  rationale: string;
  /**
   * Zona FC target (1-5, modello Coggan/Friel). Solo per tipi cardio (corsa/sport).
   * Se presente, il frontend renderizza il range bpm CALCOLATO al momento della
   * visualizzazione dalle zone personalizzate dell'utente — separando la
   * prescrizione logica (es. "Z2") dal valore numerico che varia col profilo.
   * Per piani legacy senza questo campo, l'inference avviene da subtype/details.
   */
  zone?: 1 | 2 | 3 | 4 | 5;

  // ──────────────────────────────────────────────────────────────────────────
  // Estensioni v2 "Personal Trainer Pro" — tutti opzionali (no breaking).
  // Vedi ARCHITECTURE.md §2.2.

  /**
   * Esercizi prescritti per sessioni forza_*. Pass-2 forza popola questo
   * campo con ≥4 esercizi (G9). UI legacy (senza questo campo) renderizza
   * `details` come fallback.
   */
  exercises?: PlannedExercise[];
  /**
   * Blocchi cardio strutturati (corsa: warmup + main + cooldown + repetition).
   * Pass-2 corsa popola questo campo con ≥3 blocchi.
   */
  intervals?: CardioInterval[];
  /**
   * Blocchi generici per mobility/sport. Es. sport calcio:
   * [Activation, Skill, Conditioning].
   */
  blocks?: SessionBlock[];
  /**
   * FK MobilityRoutine.id iniettata come warmup. Il render UI mostra
   * step-by-step della routine prima della sessione principale.
   */
  warmupRoutineId?: string;
  /** FK MobilityRoutine.id iniettata come cooldown. */
  cooldownRoutineId?: string;
  /**
   * Regola di progressione per la settimana successiva. Letto da Pass-2
   * della next-week per ricalcolare carichi/volume.
   */
  progressionRule?: ProgressionRule;
  /**
   * Fase del macrociclo a cui appartiene questa sessione (audit + UI badge).
   * Calcolato da macroPlanner via `MacroCycle.phases[weekNumber-1].phase`.
   */
  macroPhase?: MacroPhase;
  /**
   * True se il validator readiness ha applicato auto-correction (G7).
   * Es. Z5 originale → downgrade a Z3. UI mostra banner spiegativo.
   */
  readinessAdjusted?: boolean;
}

export interface PlanWeek {
  weekNumber: number;
  focus: string;
  sessions: PlannedSession[];
}

export interface TrainingPlan {
  generatedAt: string;
  validUntil: string;
  /**
   * Data del primo giorno della settimana 1 (YYYY-MM-DD, locale).
   * Serve per il matching "oggi" con una sessione pianificata indipendentemente
   * dalla settimana corrente. Se assente, il consumatore assume week1 == settimana
   * corrente (comportamento legacy). Riempito automaticamente dal generator.
   */
  startDate?: string;
  weeks: PlanWeek[];
  rationale: string;
  /**
   * Hash dei campi profilo che hanno influenzato la generazione (age, injuries,
   * experience, availability, painTrackingAreas). Se il profilo cambia, il piano
   * può essere marcato come "potenzialmente obsoleto" senza invalidarlo.
   */
  profileHash?: string;
  // ──────────────────────────────────────────────────────────────────────────
  // Estensioni v2 "Personal Trainer Pro" — tutti opzionali (no breaking).
  // Vedi ARCHITECTURE.md §2.2.

  /** ID del MacroCycle attivo. Coincide con `profile.activeMacroCycleId` al moment della generazione. */
  macroCycleId?: string;
  /** Settimana corrente nel macrociclo (1..N). UI badge in plan view. */
  macroWeekNumber?: number;
  /** Fase corrente del macrociclo. Audit + UI badge. */
  macroPhase?: MacroPhase;
  /**
   * Provenienza generazione:
   * - "single": legacy 1-pass (planGenerator.ts).
   * - "multi": nuovo orchestrator (Pass 1+2+3, Wave 4.1).
   * Default undefined per piani pre-v2 — letto come "single".
   */
  generationMode?: "single" | "multi";
}

export type FeedType = "session-feedback" | "weekly-report" | "alert" | "motivation" | "plan-update";

export interface CoachFeedItem {
  id: string;
  date: string;           // ISO datetime
  type: FeedType;
  title: string;
  content: string;        // markdown-ish plain text
  severity?: "info" | "warn" | "danger";
  relatedWorkoutId?: string;
  dismissed?: boolean;
}

export interface SessionFeedback {
  howItWent: string;
  signalsToMonitor: string;
  whatToDoNext: string;
  redFlags: string[];     // stringhe descrittive
  severity: "info" | "warn" | "danger";
}

export interface FeasibilityCheck {
  realistic: boolean;
  reasoning: string;
  counterProposal: {
    description: string;
    kpi: { metric: string; target: string; deadline: string };
  };
}

export interface WeeklyReport {
  summary: string;
  volumeByDiscipline: Record<string, { planned_min: number; actual_min: number }>;
  painTrend: string;
  sleepFatigueTrend: string;
  adherencePct: number;
  adjustments: string;
}
