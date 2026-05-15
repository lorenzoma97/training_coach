// Training Load science (Wave A2 — audit 2 diagnostic).
//
// Calcola CTL (Chronic Training Load), ATL (Acute Training Load), TSB
// (Training Stress Balance, "form") usando TRIMP Foster (sRPE × duration).
//
// Modello canonico TrainingPeaks (Banister 1991, Coggan refinements):
//   TRIMP_day = sRPE (1-10) × duration_min
//   ATL = EWMA(7 days)  → fitness acuto, "fatica"
//   CTL = EWMA(42 days) → fitness cronico, "forma di base"
//   TSB = CTL - ATL     → "form" (positivo = riposato, negativo = stanco)
//
// Soglie operative (Coggan, Friel, Soligard 2016):
//   TSB > +10  → riposato, possibile peaking opportunity (race-ready)
//   TSB 0..+5  → fresh, ok per high intensity
//   TSB -10..0 → fatica fisiologica, normal training
//   TSB < -10  → stanco, rischio overreach/illness — riduci intensita'
//   TSB < -30  → red flag overtraining
//
// Pure function. Nessun I/O. Testabile.
//
// Ref: Banister 1991, Foster 1998 sRPE, Soligard et al. 2016 BJSM consensus
//      (training load and injury), Coggan TrainingPeaks PMC.

export interface DayLoadInput {
  /** Data ISO YYYY-MM-DD. */
  date: string;
  /** TRIMP del giorno (sRPE × min). 0 se rest. */
  trimp: number;
}

export interface TrainingLoadSnapshot {
  /** Acute Training Load — EWMA 7gg. */
  atl: number;
  /** Chronic Training Load — EWMA 42gg. */
  ctl: number;
  /** Training Stress Balance = CTL - ATL ("form"). */
  tsb: number;
  /** Etichetta operativa derivata da TSB. */
  band: "overreach_risk" | "fatigued" | "training" | "fresh" | "peaked" | "detraining";
  /** Numero di giorni di storico effettivi usati (per affidabilita'). */
  daysUsed: number;
}

const ATL_ALPHA = 2 / (7 + 1);   // 0.25
const CTL_ALPHA = 2 / (42 + 1);  // ~0.0465

/**
 * Calcola TRIMP Foster sRPE-based per un workout.
 * sRPE valido 1-10; duration in minuti; ritorna 0 se input invalido.
 */
export function trimpFromWorkout(sRPE: number | undefined, durationMin: number | undefined): number {
  if (typeof sRPE !== "number" || typeof durationMin !== "number") return 0;
  if (sRPE < 1 || sRPE > 10 || durationMin <= 0) return 0;
  return sRPE * durationMin;
}

/**
 * Aggrega TRIMP per giorno da una lista grezza di workout. Restituisce array
 * ordinato per data ascendente, con un'entry per ogni giorno presente
 * (no zero-fill esplicito — l'EWMA gestisce gap).
 */
export function aggregateDailyLoad(
  workouts: Array<{ date?: string; sRPE?: number; durationMin?: number }>,
): DayLoadInput[] {
  const byDate = new Map<string, number>();
  for (const w of workouts) {
    if (!w.date) continue;
    const t = trimpFromWorkout(w.sRPE, w.durationMin);
    if (t === 0) continue;
    byDate.set(w.date, (byDate.get(w.date) || 0) + t);
  }
  return Array.from(byDate.entries())
    .map(([date, trimp]) => ({ date, trimp }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Classifica TSB in band operativa coach-actionable.
 * Range basati su Coggan PMC + Soligard 2016 BJSM training-load consensus.
 */
function classifyTsb(tsb: number, ctl: number): TrainingLoadSnapshot["band"] {
  if (ctl < 20) return "detraining"; // base troppo bassa per giudizi affidabili
  if (tsb < -30) return "overreach_risk";
  if (tsb < -10) return "fatigued";
  if (tsb <= 5) return "training";
  if (tsb <= 15) return "fresh";
  return "peaked";
}

/**
 * Computa snapshot CTL/ATL/TSB ad una data target (default: oggi).
 *
 * Algoritmo:
 *  1. Costruisce serie giornaliera completa da firstDate a targetDate
 *     (zero-fill per giorni rest).
 *  2. EWMA progressivo per ATL (alpha=0.25) e CTL (alpha=0.0465).
 *  3. Inizializzazione: EWMA[0] = TRIMP[0].
 *  4. TSB = CTL - ATL al targetDate.
 *
 * Se la finestra storica e' <14gg di dati significativi, restituisce
 * `{ band: "detraining", daysUsed: ... }` con valori comunque calcolati
 * ma flaggati come poco affidabili via la band.
 */
export function computeTrainingLoad(
  daily: DayLoadInput[],
  targetDateISO?: string,
): TrainingLoadSnapshot {
  if (daily.length === 0) {
    return { atl: 0, ctl: 0, tsb: 0, band: "detraining", daysUsed: 0 };
  }
  const target = targetDateISO ?? new Date().toISOString().slice(0, 10);
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = sorted[0].date;
  const start = new Date(`${firstDate}T00:00:00`).getTime();
  const end = new Date(`${target}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return { atl: 0, ctl: 0, tsb: 0, band: "detraining", daysUsed: 0 };
  }
  const totalDays = Math.floor((end - start) / 86400000) + 1;
  const trimpByIdx = new Array(totalDays).fill(0) as number[];
  for (const d of sorted) {
    const dt = new Date(`${d.date}T00:00:00`).getTime();
    if (Number.isNaN(dt) || dt > end) continue;
    const idx = Math.floor((dt - start) / 86400000);
    if (idx >= 0 && idx < totalDays) trimpByIdx[idx] += d.trimp;
  }
  let atl = trimpByIdx[0];
  let ctl = trimpByIdx[0];
  for (let i = 1; i < totalDays; i++) {
    atl = ATL_ALPHA * trimpByIdx[i] + (1 - ATL_ALPHA) * atl;
    ctl = CTL_ALPHA * trimpByIdx[i] + (1 - CTL_ALPHA) * ctl;
  }
  const tsb = ctl - atl;
  return {
    atl: Math.round(atl * 10) / 10,
    ctl: Math.round(ctl * 10) / 10,
    tsb: Math.round(tsb * 10) / 10,
    band: classifyTsb(tsb, ctl),
    daysUsed: totalDays,
  };
}

/**
 * Format compatto per iniezione nel prompt LLM. Restituisce stringa
 * "" se snapshot non significativo (band = detraining con daysUsed < 14).
 */
export function formatTrainingLoadForPrompt(snap: TrainingLoadSnapshot): string {
  if (snap.daysUsed < 14 && snap.band === "detraining") return "";
  const interpretation: Record<TrainingLoadSnapshot["band"], string> = {
    detraining: "base aerobica bassa, riprendere progressione graduale",
    overreach_risk: "OVERREACH RISK: riduci immediatamente intensità e volume, considera 3-5gg easy/rest",
    fatigued: "fatica accumulata: questa settimana riduci volume del 15-25%, evita Z5, consolida",
    training: "carico fisiologico normale: prosegui progressione standard",
    fresh: "fresco: ok per intensità target, sessione hard pianificabile",
    peaked: "PEAKED: forma top, ideale gara o test (ma se non gara prossima, attento al detraining post)",
  };
  return [
    `CARICO ATTUALE (TrainingPeaks PMC, Banister 1991):`,
    `- ATL ${snap.atl} (acute, 7gg) | CTL ${snap.ctl} (chronic, 42gg) | TSB ${snap.tsb} (form = CTL−ATL)`,
    `- Band: ${snap.band} → ${interpretation[snap.band]}`,
  ].join("\n");
}
