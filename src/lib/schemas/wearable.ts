// Zod schema dominio Wearable: WearableSample.
// Validato dopo parsing CSV ZIP per scartare sample malformati prima della
// preview UI.

import { z } from "zod";

export const WearableSourceSchema = z.enum(["samsung_health", "manual"]);

export const WearableMappedTypeSchema = z.enum([
  "corsa",
  "forza_gambe",
  "forza_upper",
  "sport",
  "mobilita",
]);

export const WearableSampleSchema = z.object({
  source: WearableSourceSchema,
  // ISO datetime: permissivo, accetta sia con TZ che UTC.
  startedAt: z.string().min(10),
  duration_min: z.number().int().min(1).max(1440),
  rawType: z.string().min(1),
  mappedType: WearableMappedTypeSchema,
  dedupKey: z.string().min(1),
  // HR realistici amatoriale: 30 (bradicardia atleta) → 230 (max teorico bambino).
  hrAvg: z.number().int().min(30).max(230).optional(),
  hrMax: z.number().int().min(30).max(230).optional(),
  // RMSSD: 5ms (stress severo) → 200ms (atleta endurance).
  hrvRmssd: z.number().min(5).max(200).optional(),
  distance_km: z.number().min(0).max(500).optional(),
  calories: z.number().int().min(0).max(10000).optional(),
  // matchedWorkoutId: string (matched), null (skipped duplicato), undefined (new).
  matchedWorkoutId: z.string().nullable().optional(),
});
