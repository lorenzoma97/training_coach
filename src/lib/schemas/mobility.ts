// Zod schemas dominio Mobility: MobilityStep, MobilityRoutine.

import { z } from "zod";

// Almeno uno tra duration_sec e reps deve essere presente. Validato via
// .superRefine per un errore user-friendly.
export const MobilityStepSchema = z
  .object({
    name: z.string().min(1),
    duration_sec: z.number().int().min(1).max(600).optional(),
    reps: z.number().int().min(1).max(100).optional(),
    cue: z.string().min(1),
  })
  .superRefine((step, ctx) => {
    if (step.duration_sec === undefined && step.reps === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MobilityStep: almeno uno tra duration_sec e reps deve essere definito",
      });
    }
  });

export const MobilityPurposeSchema = z.enum([
  "warmup",
  "cooldown",
  "recovery",
  "injury_prevention",
]);

export const MobilityRoutineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  purpose: MobilityPurposeSchema,
  duration_min: z.number().int().min(1).max(120),
  steps: z.array(MobilityStepSchema).min(1),
  sport: z.string().optional(),
  citation: z.string().optional(),
});
