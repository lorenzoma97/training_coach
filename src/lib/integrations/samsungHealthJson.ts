// Samsung Health JSON granular parsers (Wave 3.4).
//
// Estensione di samsungHealth.ts (Wave 3.2 — exercise CSV). Qui parsiamo:
//   - HRV: aggregazione per giorno (RMSSD media giornaliera) per readiness.
//   - Sleep: durata + efficiency per giorno.
//   - HR live_data per workout (stats avg/max).
//
// Sorgenti:
//   - HRV: com.samsung.shealth.hrv.csv (sample-level) + opzionalmente
//     jsons/com.samsung.shealth.hrv/<shard>/<uuid>.com.samsung.health.hrv.json
//     (singolo sample con RMSSD/SDNN dettagliati). v1: usiamo il CSV come
//     fonte primaria (uno-per-riga, già aggregato per sample).
//   - Sleep: com.samsung.shealth.sleep.csv (sleep stages + efficiency).
//   - HR live_data: jsons/com.samsung.shealth.exercise/<shard>/<uuid>
//     .com.samsung.health.exercise.live_data.json
//     Formato: array di {heart_rate, start_time, ...} sample-by-sample.
//
// Le funzioni esposte qui sono pure (no side-effect su storage). L'integrazione
// con previewImport / commitImport vive in samsungHealth.ts.
//
// Encoding: stessa logica di samsungHealth.ts (UTF-16 LE BOM tipico).

import JSZip from "jszip";
import { decodeSamsungBytes, parseCsvText, normalizeSamsungDatetime } from "./samsungHealth";

// ─────────────────────────────────────────────────────────────────────────────
// ZIP single-load helper (Reviewer 3.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apre uno ZIP Samsung UNA volta sola e restituisce l'istanza JSZip riusabile.
 *
 * Rationale: gli export annuali Samsung Health pesano 50-100MB. Aprire lo ZIP
 * 3+ volte (HRV CSV, Sleep CSV, exercise CSV, HR live_data per workout)
 * triplica il costo di decompressione. Chiamando `loadSamsungZipOnce(blob)`
 * una volta in `previewImport` e passando l'istanza ai parser, si ottiene un
 * singolo `JSZip.loadAsync` invece di N.
 *
 * Pure function (no side-effects, no I/O su storage). Errori di parsing dello
 * ZIP risalgono al caller (non swallowati qui).
 */
export async function loadSamsungZipOnce(blob: Blob): Promise<JSZip> {
  // Eager materialize: leggi tutto in ArrayBuffer prima di passarlo a JSZip,
  // dove possibile. Necessario perché JSZip + Blob fa lazy read del content
  // interno al primo `file.async()` — se il Blob viene "consumato" (stream
  // single-use in alcuni browser e SettingsPage.test.ts via real Blob), le
  // riletture successive falliscono con "Can't read the data of '<file>'".
  // Fallback: se il "blob" non ha .arrayBuffer (test fixture mock o JSZip
  // generateAsync({type:"blob"}) in Node senza Blob.prototype completo),
  // passa direttamente — JSZip accetta Blob/Buffer/Uint8Array/ArrayBuffer.
  const hasArrayBuffer =
    blob && typeof (blob as Blob).arrayBuffer === "function";
  if (hasArrayBuffer) {
    try {
      const buf = await blob.arrayBuffer();
      return JSZip.loadAsync(buf);
    } catch {
      // Fall-through al passaggio diretto (graceful).
    }
  }
  return JSZip.loadAsync(blob);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipi pubblici
// ─────────────────────────────────────────────────────────────────────────────

export interface SamsungHrvSample {
  /** Unix ms (epoch). */
  startTimestamp: number;
  rmssd_ms: number;
  sdnn_ms?: number;
}

export interface SamsungSleepSample {
  startTimestamp: number;
  endTimestamp: number;
  durationMinutes: number;
  deepMinutes?: number;
  remMinutes?: number;
  lightMinutes?: number;
  /** 0-100. Samsung esporta tipicamente 80-95. */
  efficiency?: number;
}

export interface DailyHrvAggregate {
  /** YYYY-MM-DD (data locale del sample). */
  date: string;
  /** RMSSD medio della giornata (ms). */
  rmssd_ms: number;
}

export interface DailySleepAggregate {
  /** YYYY-MM-DD del WAKE-UP (convenzione: il sonno notturno è attribuito al giorno del risveglio). */
  date: string;
  /** Durata totale del sonno in quella giornata (somma se più sessioni). */
  durationMinutes: number;
  /** Efficiency media pesata per durata, se disponibile. */
  efficiency?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Header candidates (Samsung varia tra release)
// ─────────────────────────────────────────────────────────────────────────────

const HRV_HEADER_CANDIDATES = {
  startTime: ["start_time", "com.samsung.health.hrv.start_time"],
  rmssd: ["rmssd", "com.samsung.health.hrv.rmssd"],
  sdnn: ["sdnn", "com.samsung.health.hrv.sdnn"],
  // Alcune release esportano "heart_rate_variability" come campo aggregato (ms)
  hrv: ["heart_rate_variability", "com.samsung.health.hrv.heart_rate_variability"],
};

const SLEEP_HEADER_CANDIDATES = {
  startTime: ["start_time", "com.samsung.health.sleep.start_time"],
  endTime: ["end_time", "com.samsung.health.sleep.end_time"],
  efficiency: ["efficiency", "com.samsung.health.sleep.efficiency"],
  // Sleep stages (deep/rem/light) talvolta in colonne separate, talvolta in JSON associato
  deep: ["deep_sleep_minutes", "deep_sleep"],
  rem: ["rem_sleep_minutes", "rem_sleep"],
  light: ["light_sleep_minutes", "light_sleep"],
};

function findHeaderIdx(header: string[], candidates: string[]): number {
  const lc = header.map(h => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lc.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// HRV: CSV → aggregato per giorno
// ─────────────────────────────────────────────────────────────────────────────

const HRV_CSV_PATTERN = /com\.samsung\.shealth\.hrv(?:\..+)?\.csv$/i;

/**
 * Parsa il contenuto testuale del CSV HRV in sample-level entries.
 * Header tollerante: accetta sia "rmssd" sia "heart_rate_variability".
 *
 * Esposta come pure function per testing. L'aggregazione per giorno avviene
 * in `aggregateHrvByDay` per separazione di responsabilità.
 */
export function parseHrvCsv(text: string): SamsungHrvSample[] {
  const rows = parseCsvText(text);
  if (rows.length < 2) return [];

  // Skip eventuale riga commento prima dell'header (pattern Samsung)
  let headerRowIdx = 0;
  const looksLikeHeader = (r: string[]) => {
    const lc = r.map(c => c.trim().toLowerCase());
    return lc.some(c =>
      HRV_HEADER_CANDIDATES.startTime.includes(c) ||
      HRV_HEADER_CANDIDATES.rmssd.includes(c) ||
      HRV_HEADER_CANDIDATES.hrv.includes(c),
    );
  };
  if (!looksLikeHeader(rows[0]) && rows.length > 1 && looksLikeHeader(rows[1])) {
    headerRowIdx = 1;
  }
  const header = rows[headerRowIdx];

  const idxStart = findHeaderIdx(header, HRV_HEADER_CANDIDATES.startTime);
  const idxRmssd = findHeaderIdx(header, HRV_HEADER_CANDIDATES.rmssd);
  const idxSdnn = findHeaderIdx(header, HRV_HEADER_CANDIDATES.sdnn);
  const idxHrv = findHeaderIdx(header, HRV_HEADER_CANDIDATES.hrv);

  if (idxStart < 0) return [];
  // Almeno una colonna di valore HRV richiesta
  if (idxRmssd < 0 && idxHrv < 0) return [];

  const samples: SamsungHrvSample[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const startIso = normalizeSamsungDatetime(row[idxStart] ?? "");
    if (!startIso) continue;
    const ts = new Date(startIso).getTime();
    if (!Number.isFinite(ts)) continue;

    // RMSSD: prefer colonna dedicata; fallback su "heart_rate_variability"
    let rmssd = idxRmssd >= 0 ? parseNumber(row[idxRmssd]) : undefined;
    if (rmssd === undefined && idxHrv >= 0) rmssd = parseNumber(row[idxHrv]);
    if (rmssd === undefined || !Number.isFinite(rmssd) || rmssd <= 0) continue;
    // Range plausibile: 5-200 ms (PPG noise può uscire fuori)
    if (rmssd < 5 || rmssd > 200) continue;

    const sample: SamsungHrvSample = { startTimestamp: ts, rmssd_ms: rmssd };
    if (idxSdnn >= 0) {
      const sdnn = parseNumber(row[idxSdnn]);
      if (sdnn !== undefined && sdnn > 0 && sdnn <= 300) sample.sdnn_ms = sdnn;
    }
    samples.push(sample);
  }
  return samples;
}

/**
 * Aggrega sample HRV per giorno (RMSSD media giornaliera).
 * Convenzione: il giorno è quello del timestamp del sample (UTC ISO date).
 *
 * Output ordinato per data crescente.
 */
export function aggregateHrvByDay(samples: SamsungHrvSample[]): DailyHrvAggregate[] {
  const buckets = new Map<string, number[]>();
  for (const s of samples) {
    const date = new Date(s.startTimestamp).toISOString().slice(0, 10);
    const arr = buckets.get(date) ?? [];
    arr.push(s.rmssd_ms);
    buckets.set(date, arr);
  }
  const out: DailyHrvAggregate[] = [];
  for (const [date, arr] of buckets) {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    out.push({ date, rmssd_ms: Math.round(avg * 10) / 10 });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Parsa file HRV Samsung dal ZIP (CSV principalmente; v1 ignora i JSON
 * granulari per sample, perché il CSV ha già RMSSD pre-calcolato).
 *
 * Aggrega per giorno (RMSSD media giornaliera).
 *
 * @param zipBlob ZIP blob originale (usato come fallback se `preloadedZip` non passato).
 * @param preloadedZip Istanza JSZip già caricata via `loadSamsungZipOnce` (single-load
 *   optimization). Se omesso → comportamento legacy (apre lo ZIP qui).
 */
export async function parseSamsungHrvFromZip(
  zipBlob: Blob,
  preloadedZip?: JSZip,
): Promise<DailyHrvAggregate[]> {
  let zip: JSZip;
  if (preloadedZip) {
    zip = preloadedZip;
  } else {
    try {
      zip = await JSZip.loadAsync(zipBlob);
    } catch {
      return [];
    }
  }

  const csvFiles: JSZip.JSZipObject[] = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    if (HRV_CSV_PATTERN.test(relativePath)) csvFiles.push(file);
  });

  if (csvFiles.length === 0) return [];

  const allSamples: SamsungHrvSample[] = [];
  for (const file of csvFiles) {
    try {
      const bytes = await file.async("uint8array");
      const text = decodeSamsungBytes(bytes);
      const samples = parseHrvCsv(text);
      allSamples.push(...samples);
    } catch {
      // skip file singolo, continua con gli altri
    }
  }

  return aggregateHrvByDay(allSamples);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep: CSV → aggregato per giorno
// ─────────────────────────────────────────────────────────────────────────────

const SLEEP_CSV_PATTERN = /com\.samsung\.shealth\.sleep(?:\..+)?\.csv$/i;

/**
 * Parsa il contenuto testuale del CSV sleep in sample-level entries.
 * Ogni riga = una sleep session (start, end, eventualmente stages + efficiency).
 */
export function parseSleepCsv(text: string): SamsungSleepSample[] {
  const rows = parseCsvText(text);
  if (rows.length < 2) return [];

  let headerRowIdx = 0;
  const looksLikeHeader = (r: string[]) => {
    const lc = r.map(c => c.trim().toLowerCase());
    return lc.some(c =>
      SLEEP_HEADER_CANDIDATES.startTime.includes(c) ||
      SLEEP_HEADER_CANDIDATES.endTime.includes(c),
    );
  };
  if (!looksLikeHeader(rows[0]) && rows.length > 1 && looksLikeHeader(rows[1])) {
    headerRowIdx = 1;
  }
  const header = rows[headerRowIdx];

  const idxStart = findHeaderIdx(header, SLEEP_HEADER_CANDIDATES.startTime);
  const idxEnd = findHeaderIdx(header, SLEEP_HEADER_CANDIDATES.endTime);
  const idxEff = findHeaderIdx(header, SLEEP_HEADER_CANDIDATES.efficiency);
  const idxDeep = findHeaderIdx(header, SLEEP_HEADER_CANDIDATES.deep);
  const idxRem = findHeaderIdx(header, SLEEP_HEADER_CANDIDATES.rem);
  const idxLight = findHeaderIdx(header, SLEEP_HEADER_CANDIDATES.light);

  if (idxStart < 0 || idxEnd < 0) return [];

  const samples: SamsungSleepSample[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const startIso = normalizeSamsungDatetime(row[idxStart] ?? "");
    const endIso = normalizeSamsungDatetime(row[idxEnd] ?? "");
    if (!startIso || !endIso) continue;
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const durMs = end - start;
    const durationMinutes = Math.round(durMs / 60000);
    if (durationMinutes < 30 || durationMinutes > 1440) continue; // sanity: 30min-24h

    const sample: SamsungSleepSample = {
      startTimestamp: start,
      endTimestamp: end,
      durationMinutes,
    };

    if (idxEff >= 0) {
      const eff = parseNumber(row[idxEff]);
      if (eff !== undefined && eff >= 0 && eff <= 100) sample.efficiency = eff;
    }
    if (idxDeep >= 0) {
      const deep = parseNumber(row[idxDeep]);
      if (deep !== undefined && deep >= 0) sample.deepMinutes = Math.round(deep);
    }
    if (idxRem >= 0) {
      const rem = parseNumber(row[idxRem]);
      if (rem !== undefined && rem >= 0) sample.remMinutes = Math.round(rem);
    }
    if (idxLight >= 0) {
      const light = parseNumber(row[idxLight]);
      if (light !== undefined && light >= 0) sample.lightMinutes = Math.round(light);
    }

    samples.push(sample);
  }
  return samples;
}

/**
 * Aggrega sample sleep per giorno. Convenzione: una sleep session è
 * attribuita al giorno del WAKE-UP (endTimestamp). Se più sessioni nello
 * stesso giorno → somma di durata, efficiency = media pesata.
 */
export function aggregateSleepByDay(samples: SamsungSleepSample[]): DailySleepAggregate[] {
  const buckets = new Map<string, { dur: number; effSum: number; effWeight: number }>();
  for (const s of samples) {
    const date = new Date(s.endTimestamp).toISOString().slice(0, 10);
    const cur = buckets.get(date) ?? { dur: 0, effSum: 0, effWeight: 0 };
    cur.dur += s.durationMinutes;
    if (s.efficiency !== undefined) {
      cur.effSum += s.efficiency * s.durationMinutes;
      cur.effWeight += s.durationMinutes;
    }
    buckets.set(date, cur);
  }
  const out: DailySleepAggregate[] = [];
  for (const [date, b] of buckets) {
    const entry: DailySleepAggregate = { date, durationMinutes: b.dur };
    if (b.effWeight > 0) {
      entry.efficiency = Math.round((b.effSum / b.effWeight) * 10) / 10;
    }
    out.push(entry);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Parsa file Sleep Samsung dal ZIP. Aggrega per giorno (durata + efficiency).
 *
 * @param zipBlob ZIP blob originale (fallback se `preloadedZip` non passato).
 * @param preloadedZip Istanza JSZip già caricata (single-load optimization).
 *   Se omesso → comportamento legacy (apre lo ZIP qui).
 */
export async function parseSamsungSleepFromZip(
  zipBlob: Blob,
  preloadedZip?: JSZip,
): Promise<DailySleepAggregate[]> {
  let zip: JSZip;
  if (preloadedZip) {
    zip = preloadedZip;
  } else {
    try {
      zip = await JSZip.loadAsync(zipBlob);
    } catch {
      return [];
    }
  }

  const csvFiles: JSZip.JSZipObject[] = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    if (SLEEP_CSV_PATTERN.test(relativePath)) csvFiles.push(file);
  });

  if (csvFiles.length === 0) return [];

  const allSamples: SamsungSleepSample[] = [];
  for (const file of csvFiles) {
    try {
      const bytes = await file.async("uint8array");
      const text = decodeSamsungBytes(bytes);
      const samples = parseSleepCsv(text);
      allSamples.push(...samples);
    } catch {
      // skip
    }
  }

  return aggregateSleepByDay(allSamples);
}

// ─────────────────────────────────────────────────────────────────────────────
// HR live_data per workout (uuid)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Path pattern per HR live_data:
 *   jsons/com.samsung.shealth.exercise/<shard>/<uuid>.com.samsung.health.exercise.live_data.json
 *
 * Costruisco il regex matchando solo la parte uuid + suffix per essere
 * tollerante a path varianti (case, separator). Il caller passa l'uuid esatto.
 */
function liveDataPatternFor(uuid: string): RegExp {
  // Escape per uuid (di norma alfanumerico + trattini, ma sicurezza first)
  const escaped = uuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\.com\\.samsung\\.health\\.exercise\\.live_data\\.json$`, "i");
}

/**
 * Estrae heart_rate samples da un blob JSON Samsung live_data.
 *
 * Formato osservato:
 *   [{ "heart_rate": 142, "start_time": "2026-05-08 07:00:01.000", ... }, ...]
 * oppure wrapper { "live_data": [...] } oppure { "heart_rate_data": [...] }.
 *
 * Esposta come pure function per testing.
 */
export function parseHrLiveDataJson(text: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  let arr: unknown[];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const candidate = obj["live_data"] ?? obj["heart_rate_data"] ?? obj["data"] ?? obj["samples"];
    if (Array.isArray(candidate)) arr = candidate;
    else return [];
  } else {
    return [];
  }

  const samples: number[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    // Cerca tipici nomi di campo HR
    const hrRaw =
      obj["heart_rate"] ??
      obj["heartRate"] ??
      obj["hr"] ??
      obj["bpm"] ??
      obj["heart_beat"];
    const hr = typeof hrRaw === "number" ? hrRaw : Number(hrRaw);
    if (!Number.isFinite(hr)) continue;
    if (hr < 30 || hr > 230) continue; // sanity range (esclude artefatti)
    samples.push(Math.round(hr));
  }
  return samples;
}

/**
 * Parsa HR live_data per un workout (uuid) dal ZIP. Calcola statistiche
 * basilari: avg, max, samples count.
 *
 * Ritorna null se il file non viene trovato o non contiene sample validi.
 *
 * @param zipBlob ZIP blob originale (fallback se `preloadedZip` non passato).
 * @param uuid UUID del workout target.
 * @param preloadedZip Istanza JSZip già caricata (single-load optimization).
 *   Se omesso → comportamento legacy (apre lo ZIP qui).
 */
export async function parseHrLiveDataForWorkout(
  zipBlob: Blob,
  uuid: string,
  preloadedZip?: JSZip,
): Promise<{ samples: number[]; avg: number; max: number } | null> {
  let zip: JSZip;
  if (preloadedZip) {
    zip = preloadedZip;
  } else {
    try {
      zip = await JSZip.loadAsync(zipBlob);
    } catch {
      return null;
    }
  }

  const pattern = liveDataPatternFor(uuid);
  let target: JSZip.JSZipObject | null = null;
  zip.forEach((relativePath, file) => {
    if (target || file.dir) return;
    if (pattern.test(relativePath)) target = file;
  });
  if (!target) return null;
  const file: JSZip.JSZipObject = target;

  let bytes: Uint8Array;
  try {
    bytes = await file.async("uint8array");
  } catch {
    return null;
  }
  // I JSON sono solitamente UTF-8 puro (no BOM), ma rimaniamo tolleranti
  const text = decodeSamsungBytes(bytes);

  const samples = parseHrLiveDataJson(text);
  if (samples.length === 0) return null;
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  const max = Math.max(...samples);
  return { samples, avg, max };
}
