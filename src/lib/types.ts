export type Sex = "m" | "f" | "other";
export type Experience = "sedentary" | "occasional" | "regular" | "competitive";

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
  createdAt: string;
  updatedAt: string;
}

export type GoalStatus = "pending" | "active" | "achieved" | "archived";

export interface UserGoal {
  id: string;
  originalDescription: string;
  smartDescription: string;
  kpi: { metric: string; target: string; deadline: string };
  realistic: boolean;
  coachReasoning: string;
  status: GoalStatus;
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
}

export interface PlanWeek {
  weekNumber: number;
  focus: string;
  sessions: PlannedSession[];
}

export interface TrainingPlan {
  generatedAt: string;
  validUntil: string;
  weeks: PlanWeek[];
  rationale: string;
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
