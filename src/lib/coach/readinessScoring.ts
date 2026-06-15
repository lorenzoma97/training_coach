// Readiness scoring (G7, ARCHITECTURE.md §2.1 ReadinessSnapshot, §6 R7).
//
// Pure functions per il calcolo dello score + side-effect orchestrator per
// recompute/persist. Lo scoring combina:
//   - HRV trend (oggi 3gg moving avg vs baseline 30gg) → peso 40
//   - Sleep score (hours + quality multiplier)         → peso 30
//   - Subjective freshness (morningFreshness 1-10)     → peso 20
//   - Soreness (DOMS soggettivo 0-10, opzionale)       → peso 10
//
// Componenti assenti rinormalizzano i pesi (somma pesi presenti = 100%).
//
// R7 (ARCHITECTURE.md §7): per ridurre il rumore HRV (PPG da wearable),
// applichiamo smoothing 3gg moving avg sia su "oggi" sia su "baseline".
// Min sample 7 giorni di history HRV prima di considerare il componente
// HRV (sotto la soglia, score basato solo su sleep+soggettivo).
//
// L'algoritmo è deterministico: stesso input → stesso score (idempotenza).

import { events } from "../events";
import { getJSON, setJSON } from "../storage";
import { todayISO } from "../time";
import type { DailyCheck } from "../diaryContext";
import { getLastNDays } from "../diaryContext";
import type { ReadinessSnapshot } from "../types/readiness";

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys + costanti algoritmo
// ─────────────────────────────────────────────────────────────────────────────

/** Chiave per lo storage delle snapshot (Wave 2.1 backup). */
export const READINESS_HISTORY_KEY = "readiness-history";
/** Chiave per HRV importata da wearable (Samsung Health JSON parser). */
export const SAMSUNG_HRV_HISTORY_KEY = "samsung-hrv-history";
/** Chiave per sleep importata da wearable (Samsung Health CSV/JSON parser). */
export const SAMSUNG_SLEEP_HISTORY_KEY = "samsung-sleep-history";

/** Pesi base. La rinormalizzazione avviene a runtime se mancano componenti. */
const WEIGHTS = {
  hrv: 40,
  sleep: 30,
  subjective: 20,
  soreness: 10,
} as const;

/** Min sample per calcolare baseline HRV affidabile (R7). */
const MIN_HRV_SAMPLE_DAYS = 7;
/** Window baseline HRV (R7: 30gg). */
const HRV_BASELINE_DAYS = 30;
/** Window "oggi" HRV (R7: 3gg moving avg). */
const HRV_TODAY_WINDOW = 3;
/** Max snapshot persistite (pruning automatico). */
const MAX_SNAPSHOTS = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Tipi pubblici
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadinessInputs {
  /**
   * HRV RMSSD per gli ultimi N giorni (idealmente 30gg). Optional: gli altri
   * segnali compensano. Le entry possono essere out-of-order; l'algoritmo
   * ordina per data e prende le ultime HRV_BASELINE_DAYS.
   */
  hrvHistory?: Array<{ date: string; rmssd_ms: number }>;
  /**
   * Daily check per gli ultimi giorni (sleep + soggettivo + soreness). L'ordine
   * non importa; l'algoritmo cerca i campi sulla targetDate.
   */
  dailyHistory?: Array<{ date: string; daily: DailyCheck | null }>;
  /** Data target per cui calcolare il readiness. Default: oggi (UTC). */
  targetDate?: string;
}

export interface ReadinessResult extends ReadinessSnapshot {
  /** Note pedagogiche per UI/log (es. "HRV -8ms vs baseline, sonno 5h scarso"). */
  rationale: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers numerici
// ─────────────────────────────────────────────────────────────────────────────

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function todayIso(): string {
  // Fix UTC-bug (Fase 2): prima `new Date().toISOString().slice(0,10)` dava il
  // giorno UTC → tra mezzanotte e le 02:00 (Europe/Rome) lo snapshot readiness
  // veniva datato "ieri", mentre readinessValidator/diario usano la data LOCALE
  // → snapshot appena creato giudicato non-fresco. Ora data locale via time.ts.
  return todayISO();
}

/** Mediana di un array di numeri. Ritorna undefined se l'array è vuoto. */
function median(arr: number[]): number | undefined {
  if (arr.length === 0) return undefined;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Media aritmetica. Ritorna undefined se l'array è vuoto. */
function mean(arr: number[]): number | undefined {
  if (arr.length === 0) return undefined;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component scoring (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcola HRV component score 0-100 dato delta (oggi - baseline, ms).
 *
 * Regola (R7):
 *  - delta ≥ 0      → 100 (sopra o pari a baseline)
 *  - delta = -10ms  → 50  (warning soft)
 *  - delta ≤ -25ms  → 0   (stress autonomico marcato)
 *  - intermedi      → lineare
 */
export function hrvScoreFromDelta(delta: number): number {
  if (delta >= 0) return 100;
  if (delta <= -25) return 0;
  // Interpolazione a tratti:
  //   [-10, 0)  → [50, 100)  pendenza 5/ms
  //   [-25, -10] → [0, 50]   pendenza 10/3 ≈ 3.33/ms
  if (delta >= -10) {
    return 100 + delta * 5; // delta=0 → 100, delta=-10 → 50
  }
  // delta in [-25, -10)
  const slope = 50 / 15; // 0..50 across 15ms
  return clamp((delta + 25) * slope, 0, 50);
}

/**
 * Calcola HRV component da history.
 *
 * Algoritmo:
 *   1. Ordina history per data crescente.
 *   2. baseline = mediana di (HRV ultimi HRV_BASELINE_DAYS giorni, smoothed
 *      con 3gg moving avg).
 *   3. oggi = media degli ultimi HRV_TODAY_WINDOW giorni RMSSD.
 *   4. delta = oggi - baseline.
 *   5. Se sample < MIN_HRV_SAMPLE_DAYS → ritorna null (non affidabile).
 */
export function computeHrvComponent(
  history: Array<{ date: string; rmssd_ms: number }>,
  targetDate: string,
): { score: number; delta: number } | null {
  // Filtra entries ≤ targetDate (esclude future, mantiene oggi)
  const filtered = history
    .filter(h => h.date <= targetDate && Number.isFinite(h.rmssd_ms) && h.rmssd_ms > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length < MIN_HRV_SAMPLE_DAYS) return null;

  // Baseline: ultimi HRV_BASELINE_DAYS giorni
  const baselineWindow = filtered.slice(-HRV_BASELINE_DAYS);

  // Smoothing 3gg moving avg sul window baseline
  const smoothed: number[] = [];
  for (let i = 0; i < baselineWindow.length; i++) {
    const start = Math.max(0, i - 2);
    const slice = baselineWindow.slice(start, i + 1).map(x => x.rmssd_ms);
    const m = mean(slice);
    if (m !== undefined) smoothed.push(m);
  }
  const baseline = median(smoothed);
  if (baseline === undefined) return null;

  // "Oggi" = media degli ultimi HRV_TODAY_WINDOW giorni
  const todaySlice = baselineWindow.slice(-HRV_TODAY_WINDOW).map(x => x.rmssd_ms);
  const today = mean(todaySlice);
  if (today === undefined) return null;

  const delta = today - baseline;
  return { score: hrvScoreFromDelta(delta), delta: Math.round(delta * 10) / 10 };
}

/**
 * Calcola sleep component score 0-100 da hours + quality.
 *
 * hours score:
 *  - ≥ 7h   → 100
 *  - 5-7h   → 60-100 (lineare)
 *  - 4-5h   → 0-60   (lineare)
 *  - < 4h   → 0
 *
 * quality multiplier:
 *  - "ottimo"  → 1.0
 *  - "buono"   → 0.9
 *  - "ok"      → 0.7
 *  - "scarso"  → 0.4
 *  - undefined → 0.85 (neutral, leggera penalità per ambiguità)
 *
 * Score finale = hoursScore × qualityMultiplier (clamped 0-100).
 */
export function computeSleepComponent(
  hours: number | undefined,
  quality: string | undefined,
): number | null {
  if (hours === undefined || !Number.isFinite(hours) || hours < 0) return null;

  let hoursScore: number;
  if (hours >= 7) hoursScore = 100;
  else if (hours >= 5) hoursScore = 60 + (hours - 5) * 20; // 5h→60, 7h→100
  else if (hours >= 4) hoursScore = (hours - 4) * 60;       // 4h→0, 5h→60
  else hoursScore = 0;

  const qNorm = (quality ?? "").trim().toLowerCase();
  const qualityMap: Record<string, number> = {
    ottimo: 1.0,
    buono: 0.9,
    ok: 0.7,
    scarso: 0.4,
  };
  const qMul = qualityMap[qNorm] ?? 0.85;

  return clamp(Math.round(hoursScore * qMul), 0, 100);
}

/**
 * Mappa morningFreshness 1-10 → score 0-100 lineare.
 * 1 → 0, 10 → 100. Valori fuori range vengono clampati.
 */
export function computeSubjectiveComponent(freshness: number | undefined): number | null {
  if (freshness === undefined || !Number.isFinite(freshness)) return null;
  const v = clamp(freshness, 1, 10);
  return Math.round(((v - 1) / 9) * 100);
}

/**
 * Mappa soreness 0-10 → score 0-100 INVERSO (10 = score 0, 0 = score 100).
 * Se l'utente non registra soreness → null (componente skippato).
 */
export function computeSorenessComponent(soreness: number | undefined): number | null {
  if (soreness === undefined || !Number.isFinite(soreness)) return null;
  const v = clamp(soreness, 0, 10);
  return Math.round((1 - v / 10) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Score finale + band
// ─────────────────────────────────────────────────────────────────────────────

function bandFromScore(score: number): "low" | "moderate" | "high" {
  if (score < 50) return "low";
  if (score <= 70) return "moderate";
  return "high";
}

/**
 * Calcola ReadinessSnapshot dati gli input.
 *
 * Algoritmo high-level:
 *  1. HRV component (peso 40 se presente e ≥7gg sample).
 *  2. Sleep component (peso 30) da hours+quality del DailyCheck su targetDate.
 *  3. Subjective freshness (peso 20) da morningFreshness 1-10.
 *  4. Soreness (peso 10) se l'utente lo registra.
 *  5. Score finale = somma pesata, rinormalizzata sui pesi presenti.
 *  6. Band: <50 low, 50-70 moderate, >70 high.
 *
 * Cold start (no HRV history): score basato solo su sleep + soggettivo. Se
 * mancano anche quelli → score 50 (moderate) + rationale "dati insufficienti".
 */
export function computeReadinessScore(inputs: ReadinessInputs): ReadinessResult {
  const targetDate = inputs.targetDate ?? todayIso();

  // 1. HRV component
  const hrvHistory = inputs.hrvHistory ?? [];
  const hrvResult = computeHrvComponent(hrvHistory, targetDate);

  // 2-4. Estrai DailyCheck per targetDate
  const dailyEntry = (inputs.dailyHistory ?? []).find(d => d.date === targetDate);
  const daily = dailyEntry?.daily ?? null;

  const sleepHours = toNumber(daily?.sleep);
  const sleepQuality = typeof daily?.sleepQ === "string" ? daily.sleepQ : undefined;
  const sleepScore = computeSleepComponent(sleepHours, sleepQuality);

  const freshness = toNumber(daily?.morningFreshness ?? undefined);
  const subjectiveScore = computeSubjectiveComponent(freshness);

  // soreness in DailyCheck è permissivo: cerchiamo "soreness" o "doms"
  const soreRaw = toNumber(daily?.soreness ?? daily?.doms);
  const sorenessScore = computeSorenessComponent(soreRaw);

  // 5. Pesata + rinormalizzazione
  const components: Array<{ score: number; weight: number }> = [];
  if (hrvResult !== null) components.push({ score: hrvResult.score, weight: WEIGHTS.hrv });
  if (sleepScore !== null) components.push({ score: sleepScore, weight: WEIGHTS.sleep });
  if (subjectiveScore !== null) components.push({ score: subjectiveScore, weight: WEIGHTS.subjective });
  if (sorenessScore !== null) components.push({ score: sorenessScore, weight: WEIGHTS.soreness });

  let finalScore: number;
  let rationaleParts: string[] = [];

  if (components.length === 0) {
    // Cold start completo: nessun input → neutral 50
    finalScore = 50;
    rationaleParts.push("dati insufficienti (no HRV, no daily check)");
  } else {
    const totalWeight = components.reduce((a, c) => a + c.weight, 0);
    const weighted = components.reduce((a, c) => a + c.score * c.weight, 0);
    finalScore = Math.round(weighted / totalWeight);
  }

  // Rationale pedagogica
  if (hrvResult !== null) {
    const sign = hrvResult.delta >= 0 ? "+" : "";
    rationaleParts.push(`HRV ${sign}${hrvResult.delta}ms vs baseline`);
  } else if (hrvHistory.length > 0 && hrvHistory.length < MIN_HRV_SAMPLE_DAYS) {
    rationaleParts.push(`HRV: serve ≥${MIN_HRV_SAMPLE_DAYS}gg di sample (attuali ${hrvHistory.length})`);
  }
  if (sleepScore !== null && sleepHours !== undefined) {
    rationaleParts.push(`sonno ${sleepHours}h${sleepQuality ? ` (${sleepQuality})` : ""}`);
  }
  if (subjectiveScore !== null && freshness !== undefined) {
    rationaleParts.push(`freschezza ${freshness}/10`);
  }
  if (sorenessScore !== null && soreRaw !== undefined) {
    rationaleParts.push(`DOMS ${soreRaw}/10`);
  }

  const finalScoreClamped = clamp(finalScore, 0, 100);

  return {
    date: targetDate,
    score: finalScoreClamped,
    components: {
      hrvDelta: hrvResult?.delta,
      sleepScore: sleepScore ?? undefined,
      subjectiveScore: subjectiveScore ?? undefined,
      soreness: sorenessScore ?? undefined,
    },
    band: bandFromScore(finalScoreClamped),
    appliedAdjustment: "none",
    rationale: rationaleParts.join(", "),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-effect orchestrators
// ─────────────────────────────────────────────────────────────────────────────

/** Carica HRV history dallo storage Samsung. */
async function loadHrvHistory(): Promise<Array<{ date: string; rmssd_ms: number }>> {
  return getJSON<Array<{ date: string; rmssd_ms: number }>>(SAMSUNG_HRV_HISTORY_KEY, []);
}

/**
 * Side-effect orchestrator: legge HRV + diary, calcola readiness, salva in
 * `readiness-history`. Pruning automatico a MAX_SNAPSHOTS giorni.
 *
 * Idempotente per giorno: se esiste già una snapshot per oggi, viene sovrascritta.
 *
 * Ritorna la snapshot calcolata (o null se non ci sono input minimi).
 */
export async function recomputeReadinessForToday(): Promise<ReadinessSnapshot | null> {
  const targetDate = todayIso();

  const hrvHistory = await loadHrvHistory();
  // 30 giorni di daily check sono sufficienti per il calcolo (HRV usa fino a 30gg)
  const dailyHistory = await getLastNDays(35);

  const result = computeReadinessScore({
    hrvHistory,
    dailyHistory: dailyHistory.map(d => ({ date: d.date, daily: d.daily })),
    targetDate,
  });

  // Persist: rimpiazza eventuale snapshot stessa data, prune a MAX_SNAPSHOTS
  const existing = await getJSON<ReadinessSnapshot[]>(READINESS_HISTORY_KEY, []);
  const filtered = existing.filter(s => s.date !== targetDate);
  filtered.push({
    date: result.date,
    score: result.score,
    components: result.components,
    band: result.band,
    appliedAdjustment: result.appliedAdjustment,
  });
  // Sort cronologico crescente, prune ai più recenti
  filtered.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = filtered.slice(-MAX_SNAPSHOTS);

  try {
    await setJSON(READINESS_HISTORY_KEY, trimmed);
  } catch (e) {
    console.warn("[recomputeReadinessForToday] failed to persist:", e);
    // Non rilancio: lo score è comunque calcolato e ritornato al chiamante.
  }

  // Notifica UI: il banner readiness può rinfrescare. Wave 3.4 frontend
  // aggiungerà un evento dedicato; usiamo "data:externalChange" per non
  // alterare l'EventMap (validator hardcoded).
  try {
    events.emit("data:externalChange", { key: READINESS_HISTORY_KEY });
  } catch { /* ignore */ }

  return {
    date: result.date,
    score: result.score,
    components: result.components,
    band: result.band,
    appliedAdjustment: result.appliedAdjustment,
  };
}

/**
 * Get the latest readiness from storage. Used by UI banner + validator.
 *
 * Ritorna la snapshot più recente (≤ oggi). Se non c'è alcuna snapshot,
 * tenta di calcolarne una ora chiamando `recomputeReadinessForToday`.
 */
export async function getCurrentReadiness(): Promise<ReadinessSnapshot | null> {
  const history = await getJSON<ReadinessSnapshot[]>(READINESS_HISTORY_KEY, []);
  if (history.length === 0) {
    // Lazy compute: se non c'è snapshot, ne creo una al volo
    return recomputeReadinessForToday();
  }
  // Ultima snapshot ≤ oggi
  const today = todayIso();
  const valid = history
    .filter(s => s.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  return valid[0] ?? null;
}
