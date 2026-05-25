// Zod schema per validare il blocco JSON estratto da un file macroprogramma.
// Tollerante a campi opzionali mancanti, ma rifiuta tipi sbagliati.
//
// Pattern di validazione:
// - Coerce numbers ([Claude potrebbe scrivere stringhe] → number)
// - Default values per campi opzionali (es. variants: [], intervals: [])
// - Nullable transformed → undefined (Claude potrebbe scrivere null)

import { z } from "zod";

import type { Zone } from "../types/macroprogram";

const DAY_LABEL = z.enum(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]);
const SESSION_TYPE = z.enum(["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"]);
const INTERVAL_KIND = z.enum(["warmup", "main", "cooldown", "repetition", "recovery"]);
// ZONE: coerce a number 1-5 + cast a Zone literal type (consistency con types/macroprogram.ts).
const ZONE = z.coerce.number().int().min(1).max(5).transform(n => n as Zone);

const EXERCISE_PATTERN = z.enum([
  "squat", "hinge", "lunge",
  "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull",
  "carry", "core_antiext", "core_antirot",
  "plyometric", "isometric", "mobility",
  "agility", "reactive", "sprint", "rsa", "ssg",
]);

const EQUIPMENT_TAG = z.enum([
  "bodyweight", "dumbbell", "barbell", "kettlebell", "band",
  "machine", "cable", "trx", "bench", "pullup_bar", "box",
]);

// Helper: transform null → undefined per campi opzionali (Claude scrive null spesso).
const nullableNumber = z.number().nullable().optional().transform(v => v ?? undefined);
const nullableString = z.string().nullable().optional().transform(v => v ?? undefined);
const nullableArrayString = z.array(z.string()).nullable().optional().transform(v => v ?? undefined);

export const MacroProgramExerciseSchema = z.object({
  id: z.string().min(1),
  name: nullableString,
  pattern: EXERCISE_PATTERN.nullable().optional().transform(v => v ?? undefined),
  equipment: z.array(EQUIPMENT_TAG).nullable().optional().transform(v => v ?? undefined),
  sets: z.coerce.number().int().min(1).max(20),
  reps_min: z.coerce.number().int().min(1).max(200),
  reps_max: z.coerce.number().int().min(1).max(200),
  rpe_target: nullableNumber,
  rest_sec: z.coerce.number().int().min(0).max(900),
  tempo_eccentrico_sec: nullableNumber,
  pause_sec: nullableNumber,
  variants: nullableArrayString,
  technique: nullableString,
  guidance: nullableArrayString,
});

export const MacroProgramIntervalSchema = z.object({
  kind: INTERVAL_KIND,
  duration_min: nullableNumber,
  distance_km: nullableNumber,
  zone: ZONE.nullable().optional().transform(v => v ?? undefined),
  reps: nullableNumber,
  recovery_sec: nullableNumber,
  cue: nullableString,
});

export const MacroProgramSessionSchema = z.object({
  day: DAY_LABEL,
  type: SESSION_TYPE,
  duration_min: z.coerce.number().int().min(5).max(240),
  notes_text: nullableString,
  setup_spatial: nullableString,
  exercises: z.array(MacroProgramExerciseSchema).default([]),
  intervals: z.array(MacroProgramIntervalSchema).default([]),
});

export const MacroProgramWeekSchema = z.object({
  week: z.coerce.number().int().min(1).max(52),
  notes: nullableString,
  sessions: z.array(MacroProgramSessionSchema),
});

export const MacroProgramPhaseSchema = z.object({
  name: z.string().min(1),
  weeks: z.array(z.coerce.number().int().min(1).max(52)).min(1),
  focus: z.string(),
  rpe_target_min: nullableNumber,
  rpe_target_max: nullableNumber,
  notes: nullableString,
});

export const MacroProgramMetadataSchema = z.object({
  title: z.string().min(1),
  goal: z.string(),
  sport: z.string(),
  weeks_total: z.coerce.number().int().min(1).max(52),
  start_date: nullableString,
  generated_at: nullableString,
  generated_by: nullableString,
});

export const MacroProgramTrackingMetricSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  unit: z.string(),
  frequency: z.enum(["daily", "weekly", "after_rsa_session", "after_session"]),
  notes: nullableString,
});

/**
 * Schema completo del blocco JSON. NON include narrative_markdown / imported_at
 * (popolati dal parser, non dal payload Claude).
 */
export const MacroProgramJsonSchema = z.object({
  metadata: MacroProgramMetadataSchema,
  phases: z.array(MacroProgramPhaseSchema).min(1),
  weeks: z.array(MacroProgramWeekSchema).min(1),
  tracking_metrics: z.array(MacroProgramTrackingMetricSchema).optional(),
});

export type MacroProgramJson = z.infer<typeof MacroProgramJsonSchema>;
