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
