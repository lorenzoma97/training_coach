// Zod schemas dominio Periodization: RaceEvent, MesoCycle, MacroCycle.
// Validazione runtime quando l'utente aggiunge una race in UI o quando
// MacroCycle viene letto dal storage.

import { z } from "zod";

export const MacroPhaseSchema = z.enum(["base", "build", "peak", "taper", "transition"]);

export const RaceSportSchema = z.enum(["corsa", "sport", "trail", "triathlon", "altro"]);

export const RacePrioritySchema = z.enum(["A", "B", "C"]);

export const RaceEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sport: RaceSportSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Range pratico: 0.1km (sprint) → 250km (ultra-trail).
  distance_km: z.number().positive().max(500).optional(),
  targetTime: z.string().optional(),
  targetTimeSec: z.number().int().positive().optional(),
  priority: RacePrioritySchema,
  notes: z.string().optional(),
  // ISO datetime (più permissivo di YYYY-MM-DD per i timestamp di creazione).
  createdAt: z.string().min(10),
});

export const MesoCycleSchema = z.object({
  weekNumber: z.number().int().min(1).max(52),
  phase: MacroPhaseSchema,
  // 0.3 (full taper) → 1.5 (peak overload). Fuori range = errore di pianificazione.
  volumeMultiplier: z.number().min(0.3).max(1.5),
  // 0-100% sessioni high-intensity. Polarized 80/20 → typically 10-40%.
  intensityHighPct: z.number().min(0).max(100),
  focus: z.string().min(1),
});

export const MacroCycleSchema = z.object({
  id: z.string().min(1),
  raceId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phases: z.array(MesoCycleSchema).min(1).max(52),
  inputHash: z.string().min(1),
});
