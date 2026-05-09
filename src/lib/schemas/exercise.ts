// Zod schemas per il dominio Exercise. Validazione runtime quando:
// - LLM produce exerciseId in pass-2 forza (deve esistere in catalog).
// - Catalog viene caricato (sanity check al boot in dev).
// - Workout.exercises[] viene letto da storage corrotto.

import { z } from "zod";

export const ExercisePatternSchema = z.enum([
  "squat",
  "hinge",
  "lunge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "carry",
  "core_antiext",
  "core_antirot",
  "plyometric",
  "isometric",
  "mobility",
]);

export const ExerciseLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);

export const EquipmentTagSchema = z.enum([
  "bodyweight",
  "dumbbell",
  "barbell",
  "kettlebell",
  "band",
  "machine",
  "cable",
  "trx",
  "bench",
  "pullup_bar",
  "box",
]);

export const ExerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pattern: ExercisePatternSchema,
  primaryMuscles: z.array(z.string().min(1)).min(1),
  secondaryMuscles: z.array(z.string().min(1)),
  equipment: z.array(EquipmentTagSchema).min(1),
  level: ExerciseLevelSchema,
  unilateral: z.boolean(),
  technique: z.string().min(1),
  cautions: z.array(z.string()).optional(),
  alternatives: z.array(z.string()),
  loadable: z.boolean(),
});
