// Zod schema dominio Readiness: ReadinessSnapshot.

import { z } from "zod";

export const ReadinessBandSchema = z.enum(["low", "moderate", "high"]);

export const ReadinessAdjustmentSchema = z.enum([
  "downgrade_z45",
  "skip_session",
  "none",
]);

export const ReadinessComponentsSchema = z.object({
  // hrvDelta può essere negativo (stress) o positivo (recovery boost).
  hrvDelta: z.number().min(-100).max(100).optional(),
  sleepScore: z.number().min(0).max(100).optional(),
  subjectiveScore: z.number().min(0).max(100).optional(),
  soreness: z.number().min(0).max(100).optional(),
});

export const ReadinessSnapshotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  score: z.number().min(0).max(100),
  components: ReadinessComponentsSchema,
  band: ReadinessBandSchema,
  appliedAdjustment: ReadinessAdjustmentSchema.optional(),
});
