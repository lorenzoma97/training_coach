// Zod schemas dominio Strength: ExerciseSet, ExercisePerformance, OneRepMax.
// Usati per validare input utente (DiaryApp form), output LLM (Pass-2 forza
// produrrà PlannedExercise → eseguito → ExercisePerformance), e payload
// storage 1RM.

import { z } from "zod";

export const ExerciseSetSchema = z.object({
  reps: z.number().int().min(0).max(200),
  // Range pratico amatoriale: 0 (bodyweight) → 500kg (deadlift world-class).
  // Negativi rifiutati. Decimali consentiti per kg-frazionari (microplate).
  weight_kg: z.number().min(0).max(500).optional(),
  rpe: z.number().min(1).max(10).optional(),
  rir: z.number().int().min(0).max(10).optional(),
});

export const ExercisePerformanceSchema = z.object({
  exerciseId: z.string().min(1),
  sets: z.array(ExerciseSetSchema),
  notes: z.string().optional(),
});

export const OneRepMaxSourceSchema = z.enum(["tested", "estimated"]);

export const OneRepMaxSchema = z.object({
  exerciseId: z.string().min(1),
  // Range realistico: 1kg (bambino bodyweight) → 500kg (record mondiale).
  value_kg: z.number().min(1).max(500),
  source: OneRepMaxSourceSchema,
  // YYYY-MM-DD strict.
  acquiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromWorkoutId: z.string().optional(),
});
