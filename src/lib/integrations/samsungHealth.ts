// Samsung Health ZIP CSV import (Wave 3.2).
// Pure functions per parser/mapping/dedup; side-effect isolato in
// previewImport / commitImport (orchestrators).
//
// Architettura:
//   1. parseSamsungHealthZip(blob) -> WearableSample[]
//   2. previewImport(blob)         -> ImportPreview (no writes)
//   3. commitImport(preview)       -> { workoutsCreated, ... } (writes)
//
// Encoding: Samsung esporta CSV in UTF-16 LE con BOM (FF FE). Il parser
// rileva il BOM e usa TextDecoder("utf-16le"); fallback su UTF-8 se assente.
//
// Scope v2 (ARCHITECTURE.md §4 Wave 3.2): SOLO exercise.csv.
// HR samples / sleep / weight rinviati a Wave 3.4 (readiness).
//
// Dedup (I2): chiave deterministica
//   sha1(date_iso_minute|mappedType|round(duration_min/2)*2)
// Match contro:
//   - workouts esistenti tramite fields.dedupKey (re-import idempotente)
//   - workouts esistenti tramite (date+type+duration±2min) (manual entries)

import JSZip from "jszip";
import { storage, getJSON, setJSON } from "../storage";
import { getAllDays, type Workout, type DiaryDay } from "../diaryContext";
import type { WearableSample } from "../types/wearable";
import {
  parseSamsungHrvFromZip,
  parseSamsungSleepFromZip,
  loadSamsungZipOnce,
  type DailyHrvAggregate,
  type DailySleepAggregate,
} from "./samsungHealthJson";
import {
  SAMSUNG_HRV_HISTORY_KEY,
  SAMSUNG_SLEEP_HISTORY_KEY,
  recomputeReadinessForToday,
} from "../coach/readinessScoring";

// ─────────────────────────────────────────────────────────────────────────────
// Tipi pubblici
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportPreview {
  /** Totale sample parsati dal CSV (newWorkouts + matchedWorkouts). */
  totalSamples: number;
  /** Sample che diventeranno nuovi Workout. */
  newWorkouts: WearableSample[];
  /** Sample skippati per dedup match. */
  matchedWorkouts: WearableSample[];
  /** rawType Samsung non riconosciuti dal mapping (defaultati a "sport"). */
  unrecognizedTypes: string[];
  /** Errori di parsing per file (CSV mancante, malformato, ecc). */
  parseErrors: Array<{ file: string; error: string }>;
  /**
   * Wave 3.4: HRV aggregata per giorno (RMSSD media). Se lo ZIP contiene
   * com.samsung.shealth.hrv.csv, viene popolata; altrimenti array vuoto.
   * Storage separato (samsung-hrv-history) — NON sostituisce daily check.
   */
  hrvDaily: DailyHrvAggregate[];
  /**
   * Wave 3.4: Sleep aggregata per giorno (durata + efficiency). Se lo ZIP
   * contiene com.samsung.shealth.sleep.csv, viene popolata; altrimenti vuota.
   * Storage separato (samsung-sleep-history) — NON sostituisce daily check.
   */
  sleepDaily: DailySleepAggregate[];
}

export interface CommitResult {
  workoutsCreated: number;
  duplicatesSkipped: number;
  importLogId: string;
  /** Numero di giorni HRV importati (samsung-hrv-history). */
  hrvDaysImported: number;
  /** Numero di giorni sleep importati (samsung-sleep-history). */
  sleepDaysImported: number;
}

interface ImportLogEntry {
  id: string;
  importedAt: string;
  source: "samsung_health";
  totalSamples: number;
  workoutsCreated: number;
  duplicatesSkipped: number;
  unrecognizedTypes: string[];
  /** Wave 3.4: tracking aggiuntivo HRV/sleep importati. Optional per back-compat log v1. */
  hrvDaysImported?: number;
  sleepDaysImported?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping table (esercizio Samsung → mappedType app)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapping Samsung exercise_type → mappedType app + human label.
 *
 * REALTÀ POST-2026-05 (export reale verificato su Lorenzo lolo7):
 * Samsung Health esporta `exercise_type` come **CODICE NUMERICO** (es. 1002,
 * 10007, 15005), NON come stringa "Running". Le release vecchie usavano
 * stringhe localizzate; teniamo entrambi i formati per backward compat.
 *
 * Codici noti (community + fonti pubbliche Samsung Tizen SDK):
 *  - 1001 = Walking, 1002 = Running, 1003 = Treadmill walking
 *  - 4xxx = Swimming family
 *  - 6002 = Cycling, 6003 = MTB, 6004 = Indoor cycling
 *  - 10007 = Hiking (frequente: tipica seconda attività dopo running/walking)
 *  - 13xxx = Various sports (climbing, etc.)
 *  - 14xxx = Team sports (basketball, baseball, ...)
 *  - 15xxx = Racquet sports (15001=Tennis, 15002=Badminton, 15004=Table Tennis,
 *            15005=Squash/Padel, 15006=Volleyball)
 *  - 0 = "Other" generico
 *
 * Aggiornare quando emergono nuovi codici. Non hardcodare in altri moduli.
 */
const SAMSUNG_TYPE_MAP: Record<string, WearableSample["mappedType"]> = {
  // ── CODICI NUMERICI (formato post-2026) ──
  "1001": "mobilita",      // Walking
  "1002": "corsa",         // Running
  "1003": "mobilita",      // Treadmill walking
  "1004": "corsa",         // Treadmill running
  "4001": "sport",         // Swimming (laps)
  "4002": "sport",         // Open water swim
  "4003": "sport",         // Indoor swim
  "4004": "sport",         // Swimming variant
  "6002": "sport",         // Cycling
  "6003": "sport",         // Mountain biking
  "6004": "sport",         // Indoor cycling / spinning
  "10001": "mobilita",     // Hiking
  "10002": "sport",        // Cardio workout (machine)
  "10003": "sport",        // Aerobics
  "10004": "mobilita",     // Yoga
  "10005": "mobilita",     // Stretching
  "10006": "mobilita",     // Pilates
  "10007": "mobilita",     // Hiking/Trekking outdoor
  "11007": "sport",        // Soccer (Football)
  "13001": "sport",        // Climbing
  "14001": "sport",        // Basketball
  "14002": "sport",        // Baseball
  "14004": "sport",        // Volleyball
  "14008": "sport",        // American football
  "15001": "sport",        // Tennis
  "15002": "sport",        // Badminton
  "15003": "sport",        // Squash
  "15004": "sport",        // Table tennis
  "15005": "sport",        // Padel / Racquetball
  "15006": "sport",        // Volleyball indoor
  "16002": "sport",        // Skiing
  "0": "sport",            // "Other" — fallback Samsung
  // ── STRINGHE LOCALIZZATE (formato pre-2026, preservato per back-compat) ──
  // Corsa
  "running": "corsa",
  "trail running": "corsa",
  "treadmill running": "corsa",
  "track running": "corsa",
  // Walking / hiking → mobilita
  "walking": "mobilita",
  "hiking": "mobilita",
  "treadmill walking": "mobilita",
  // Forza
  "strength training": "forza_gambe",
  "weight training": "forza_gambe",
  "weightlifting": "forza_gambe",
  "resistance training": "forza_gambe",
  "circuit training": "forza_gambe",
  // Sport
  "football": "sport",
  "soccer": "sport",
  "tennis": "sport",
  "padel": "sport",
  "badminton": "sport",
  "basketball": "sport",
  "volleyball": "sport",
  "cycling": "sport",
  "mountain biking": "sport",
  "spinning": "sport",
  "indoor cycling": "sport",
  "swimming": "sport",
  "rowing": "sport",
  "elliptical": "sport",
  "boxing": "sport",
  "martial arts": "sport",
  // Mobility / recovery
  "yoga": "mobilita",
  "pilates": "mobilita",
  "stretching": "mobilita",
  "foam rolling": "mobilita",
};

/** Map separato CODICE → label human-readable (per UI display). */
const SAMSUNG_CODE_TO_LABEL: Record<string, string> = {
  "0": "Altro", "1001": "Camminata", "1002": "Corsa", "1003": "Tapis roulant cammino",
  "1004": "Tapis roulant corsa", "4001": "Nuoto", "4002": "Nuoto in acque libere",
  "4003": "Nuoto indoor", "4004": "Nuoto", "6002": "Bicicletta",
  "6003": "Mountain bike", "6004": "Spinning", "10001": "Trekking",
  "10002": "Cardio macchina", "10003": "Aerobica", "10004": "Yoga",
  "10005": "Stretching", "10006": "Pilates", "10007": "Trekking outdoor",
  "11007": "Calcio", "13001": "Arrampicata", "14001": "Basket",
  "14002": "Baseball", "14004": "Pallavolo", "14008": "Football americano",
  "15001": "Tennis", "15002": "Badminton", "15003": "Squash",
  "15004": "Tennis tavolo", "15005": "Padel", "15006": "Pallavolo indoor",
  "16002": "Sci",
};

/** Converte codice Samsung in label leggibile. Non-codice → ritorna l'input. */
export function samsungTypeToHumanLabel(rawType: string): string {
  const t = rawType.trim();
  if (/^\d+$/.test(t) && SAMSUNG_CODE_TO_LABEL[t]) return SAMSUNG_CODE_TO_LABEL[t];
  return rawType;
}

/**
 * Mapping canonico Samsung exercise type → app mappedType.
 * Accetta sia codice numerico ("1002") sia stringa ("Running").
 * Default → "sport" (catch-all). Caller può controllare unrecognizedTypes
 * nel preview per warn UI.
 */
export function mapSamsungTypeToApp(rawType: string): WearableSample["mappedType"] {
  const t = rawType.trim();
  // Codici numerici Samsung NON vanno lowercase
  if (/^\d+$/.test(t)) return SAMSUNG_TYPE_MAP[t] ?? "sport";
  return SAMSUNG_TYPE_MAP[t.toLowerCase()] ?? "sport";
}

/** Predicato pubblico: il tipo è nel mapping table o cade nel default? */
export function isRecognizedSamsungType(rawType: string): boolean {
  const t = rawType.trim();
  if (/^\d+$/.test(t)) return SAMSUNG_TYPE_MAP[t] !== undefined;
  return SAMSUNG_TYPE_MAP[t.toLowerCase()] !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedup key (sha1 con fallback djb2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcola dedupKey deterministico (vedi I2 in ARCHITECTURE.md).
 * Algoritmo: sha1(date_iso_minute | mappedType | round(duration_min/2)*2)
 *
 * - date_iso_minute: precisione minuto (Samsung exact, manual ±qualche min).
 * - mappedType: distingue corsa vs forza nello stesso slot.
 * - duration round-to-2-min: tolleranza per registrazioni manuali.
 *
 * Implementazione sha1: usa Web Crypto API (`crypto.subtle.digest`).
 * Fallback: hash djb2 (tagged "djb2:") per env senza Web Crypto (Node test
 * legacy). Le due famiglie producono chiavi NON intercambiabili: un sample
 * dedup-keyato in browser non collidere con uno keyato in fallback. In
 * pratica tutti gli env target hanno Web Crypto (browser moderni + Node 16+).
 */
export async function computeDedupKey(
  startedAt: string,
  mappedType: string,
  duration_min: number,
): Promise<string> {
  const isoMinute = startedAt.slice(0, 16); // YYYY-MM-DDTHH:MM
  const roundedDur = Math.round(duration_min / 2) * 2;
  const input = `${isoMinute}|${mappedType}|${roundedDur}`;

  // Web Crypto path (browser, Node 16+)
  const cryptoObj = typeof globalThis !== "undefined" ? (globalThis as unknown as { crypto?: Crypto }).crypto : undefined;
  if (cryptoObj?.subtle?.digest) {
    try {
      const enc = new TextEncoder().encode(input);
      const buf = await cryptoObj.subtle.digest("SHA-1", enc);
      const bytes = new Uint8Array(buf);
      let hex = "";
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, "0");
      }
      return hex;
    } catch {
      // Fallthrough al fallback djb2
    }
  }

  // Fallback djb2 (deterministico, no crypto). Prefisso per evitare
  // collisioni accidentali con chiavi sha1 (lunghezza diversa).
  return "djb2:" + djb2(input);
}

function djb2(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  // Unsigned hex
  return (hash >>> 0).toString(16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Encoding detection + CSV parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decodifica un Uint8Array in stringa.
 * - UTF-16 LE BOM (FF FE) → TextDecoder("utf-16le")
 * - UTF-16 BE BOM (FE FF) → TextDecoder("utf-16be")
 * - UTF-8 BOM (EF BB BF)  → TextDecoder("utf-8") con BOM stripping
 * - Default                → UTF-8
 */
export function decodeSamsungBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Parser CSV minimale: supporta quote `"`, escape `""`, separator `,`.
 * Splitta riga per riga (CRLF / LF). Righe completamente vuote vengono
 * skippate. Non implementa separator-detection (Samsung Health usa sempre `,`).
 *
 * Ritorna array di righe; ogni riga è array di campi (trim non applicato).
 */
export function parseCsvText(text: string): string[][] {
  // Normalizza CRLF -> LF; rimuovi LF finale opzionale
  const norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let curField = "";
  let curRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (inQuotes) {
      if (c === '"') {
        if (norm[i + 1] === '"') {
          // Escape doppia quota
          curField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        curField += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        curRow.push(curField);
        curField = "";
      } else if (c === "\n") {
        curRow.push(curField);
        curField = "";
        // Skip righe completamente vuote (no campi non-vuoti)
        if (curRow.length > 1 || curRow[0] !== "") rows.push(curRow);
        curRow = [];
      } else {
        curField += c;
      }
    }
  }
  // Ultima riga senza newline finale
  if (curField !== "" || curRow.length > 0) {
    curRow.push(curField);
    if (curRow.length > 1 || curRow[0] !== "") rows.push(curRow);
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Samsung exercise CSV → WearableSample[]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Header tipici di com.samsung.shealth.exercise.csv (variano per release).
 * Fallback: il parser riconosce header con o senza prefisso `com.samsung.health.exercise.`
 * (alcune versioni emettono header tipo `com.samsung.health.exercise.start_time`).
 */
const FIELD_CANDIDATES = {
  startTime: ["start_time", "com.samsung.health.exercise.start_time"],
  endTime: ["end_time", "com.samsung.health.exercise.end_time"],
  exerciseType: [
    "exercise_type", "com.samsung.health.exercise.exercise_type",
    // Alcune release usano "exercise_custom_type" se Tizen custom; lo trattiamo come fallback
    "exercise_custom_type",
  ],
  meanHr: ["mean_heart_rate", "com.samsung.health.exercise.mean_heart_rate"],
  maxHr: ["max_heart_rate", "com.samsung.health.exercise.max_heart_rate"],
  distance: ["distance", "com.samsung.health.exercise.distance"],
  calorie: ["calorie", "com.samsung.health.exercise.calorie"],
  duration: ["duration", "com.samsung.health.exercise.duration"], // millis (alternativa a end_time-start_time)
};

function findHeaderIdx(header: string[], candidates: string[]): number {
  const lc = header.map(h => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lc.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Normalizza una stringa datetime Samsung in ISO UTC.
 * Samsung esporta tipicamente "2026-05-08 07:00:00.000" (locale, NO timezone).
 * Per v2 NON facciamo conversione TZ esplicita (info non sempre disponibile
 * nell'header); accettiamo l'orario "as-is" interpretandolo come UTC. Il
 * dedup è tollerante (granularità minuto), quindi un eventuale offset di
 * qualche ora non spezza il match contro workout manuali registrati lo
 * stesso giorno.
 */
export function normalizeSamsungDatetime(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  // "2026-05-08 07:00:00.000" -> "2026-05-08T07:00:00.000Z"
  // "2026-05-08T07:00:00Z"     -> as-is
  let candidate = trimmed.replace(" ", "T");
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(candidate)) candidate += "Z";
  const d = new Date(candidate);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseInteger(v: string | undefined): number | undefined {
  const n = parseNumber(v);
  if (n === undefined) return undefined;
  return Math.round(n);
}

/**
 * Parsa il contenuto testuale di com.samsung.shealth.exercise.csv in
 * WearableSample[]. Le righe malformate vengono skippate con warn (non
 * crashano l'import). dedupKey è calcolato per ogni sample.
 *
 * Ritorna anche un report degli errori di parsing per riga (per UI debug).
 */
export async function parseExerciseCsv(text: string): Promise<{
  samples: WearableSample[];
  rowErrors: Array<{ row: number; error: string }>;
  unrecognizedTypes: Set<string>;
}> {
  const rows = parseCsvText(text);
  const samples: WearableSample[] = [];
  const rowErrors: Array<{ row: number; error: string }> = [];
  const unrecognizedTypes = new Set<string>();

  if (rows.length < 2) {
    return { samples, rowErrors: [{ row: 0, error: "CSV vuoto o senza dati" }], unrecognizedTypes };
  }

  // Samsung talvolta emette una riga prefisso prima dell'header (commento tipo
  // "com.samsung.shealth.exercise"). Rilevazione: la prima riga ha 1 colonna o
  // i suoi campi non includono "start_time"/"exercise_type". In quel caso usa
  // riga 1 come header.
  let headerRowIdx = 0;
  const looksLikeHeader = (r: string[]) => {
    const lc = r.map(c => c.trim().toLowerCase());
    return lc.some(c => FIELD_CANDIDATES.startTime.includes(c) || FIELD_CANDIDATES.exerciseType.includes(c));
  };
  if (!looksLikeHeader(rows[0]) && rows.length > 1 && looksLikeHeader(rows[1])) {
    headerRowIdx = 1;
  }
  const header = rows[headerRowIdx];

  const idxStartTime = findHeaderIdx(header, FIELD_CANDIDATES.startTime);
  const idxEndTime = findHeaderIdx(header, FIELD_CANDIDATES.endTime);
  const idxType = findHeaderIdx(header, FIELD_CANDIDATES.exerciseType);
  const idxMeanHr = findHeaderIdx(header, FIELD_CANDIDATES.meanHr);
  const idxMaxHr = findHeaderIdx(header, FIELD_CANDIDATES.maxHr);
  const idxDistance = findHeaderIdx(header, FIELD_CANDIDATES.distance);
  const idxCalorie = findHeaderIdx(header, FIELD_CANDIDATES.calorie);
  const idxDuration = findHeaderIdx(header, FIELD_CANDIDATES.duration);

  if (idxStartTime < 0 || idxType < 0) {
    return {
      samples,
      rowErrors: [{ row: headerRowIdx, error: `Header CSV incompleto: manca ${idxStartTime < 0 ? "start_time" : "exercise_type"}` }],
      unrecognizedTypes,
    };
  }

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    try {
      const startedAt = normalizeSamsungDatetime(row[idxStartTime] ?? "");
      if (!startedAt) {
        rowErrors.push({ row: r, error: "start_time non parsabile" });
        continue;
      }

      // Calcolo duration_min: prefer end_time-start_time se disponibile, altrimenti duration (millis).
      let duration_min: number | undefined;
      if (idxEndTime >= 0) {
        const endIso = normalizeSamsungDatetime(row[idxEndTime] ?? "");
        if (endIso) {
          const ms = new Date(endIso).getTime() - new Date(startedAt).getTime();
          if (ms > 0) duration_min = Math.round(ms / 60000);
        }
      }
      if (duration_min === undefined && idxDuration >= 0) {
        const durMs = parseNumber(row[idxDuration]);
        if (durMs !== undefined && durMs > 0) duration_min = Math.round(durMs / 60000);
      }
      if (duration_min === undefined || duration_min < 1) {
        rowErrors.push({ row: r, error: "duration non determinabile o < 1 min" });
        continue;
      }
      // Cap superiore difensivo (1440min = 24h). Schema lo enforza ma evitiamo
      // di propagare valori chiaramente bug a downstream.
      if (duration_min > 1440) duration_min = 1440;

      const rawType = (row[idxType] ?? "").trim() || "Unknown";
      const mappedType = mapSamsungTypeToApp(rawType);
      if (!isRecognizedSamsungType(rawType)) {
        unrecognizedTypes.add(rawType);
      }

      const dedupKey = await computeDedupKey(startedAt, mappedType, duration_min);

      const sample: WearableSample = {
        source: "samsung_health",
        startedAt,
        duration_min,
        rawType,
        mappedType,
        dedupKey,
      };

      // Metriche opzionali — applica solo se nel range schema (HR 30-230, ecc.)
      const hrAvg = idxMeanHr >= 0 ? parseInteger(row[idxMeanHr]) : undefined;
      if (hrAvg !== undefined && hrAvg >= 30 && hrAvg <= 230) sample.hrAvg = hrAvg;

      const hrMax = idxMaxHr >= 0 ? parseInteger(row[idxMaxHr]) : undefined;
      if (hrMax !== undefined && hrMax >= 30 && hrMax <= 230) sample.hrMax = hrMax;

      // distance Samsung è in metri
      const distM = idxDistance >= 0 ? parseNumber(row[idxDistance]) : undefined;
      if (distM !== undefined && distM > 0) {
        const km = Math.round((distM / 1000) * 100) / 100;
        if (km <= 500) sample.distance_km = km;
      }

      const cal = idxCalorie >= 0 ? parseInteger(row[idxCalorie]) : undefined;
      if (cal !== undefined && cal >= 0 && cal <= 10000) sample.calories = cal;

      samples.push(sample);
    } catch (e) {
      rowErrors.push({ row: r, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { samples, rowErrors, unrecognizedTypes };
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP parser (jszip)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pattern del filename exercise CSV nello ZIP. Samsung usa
 * `com.samsung.shealth.exercise.[date].csv` o varianti senza data; si
 * matchano tutti per robustezza.
 */
const EXERCISE_CSV_PATTERN = /com\.samsung\.shealth\.exercise(?:\..+)?\.csv$/i;

/**
 * Parsa un blob ZIP esportato da Samsung Health.
 *
 * Samsung Health Settings → Download personal data produce uno ZIP con
 * vari CSV. Encoding tipico: UTF-16 LE con BOM. Header riga separata.
 *
 * v2 supporta SOLO com.samsung.shealth.exercise.csv (workout). HR, sleep,
 * weight rinviati a Wave 3.4.
 *
 * Sample con mappedType non riconosciuto vengono mappati a "sport" + warn log.
 */
export async function parseSamsungHealthZip(zipBlob: Blob): Promise<WearableSample[]> {
  const result = await parseSamsungHealthZipDetailed(zipBlob);
  return result.samples;
}

/**
 * Variante con report dettagliato (usata da previewImport).
 *
 * @param zipBlob ZIP blob originale (fallback se `preloadedZip` non passato).
 * @param preloadedZip Istanza JSZip già caricata via `loadSamsungZipOnce`
 *   (single-load optimization Reviewer 3.4). Se omesso → apre lo ZIP qui.
 */
export async function parseSamsungHealthZipDetailed(
  zipBlob: Blob,
  preloadedZip?: JSZip,
): Promise<{
  samples: WearableSample[];
  parseErrors: Array<{ file: string; error: string }>;
  unrecognizedTypes: Set<string>;
}> {
  const samples: WearableSample[] = [];
  const parseErrors: Array<{ file: string; error: string }> = [];
  const unrecognizedTypes = new Set<string>();

  let zip: JSZip;
  if (preloadedZip) {
    zip = preloadedZip;
  } else {
    try {
      // Usa loadSamsungZipOnce (type-guarded arrayBuffer) per evitare la
      // lazy-read trap di JSZip.loadAsync(Blob) → file.async("uint8array")
      // che fallisce con "Can't read the data of '<file>'" quando il Blob
      // originale viene consumato/perso. Preloaded path già passato dal
      // caller usa stesso helper.
      zip = await loadSamsungZipOnce(zipBlob);
    } catch (e) {
      parseErrors.push({ file: "<zip>", error: `ZIP non valido: ${e instanceof Error ? e.message : String(e)}` });
      return { samples, parseErrors, unrecognizedTypes };
    }
  }

  const exerciseFiles: Array<{ name: string; file: JSZip.JSZipObject }> = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    if (EXERCISE_CSV_PATTERN.test(relativePath)) {
      exerciseFiles.push({ name: relativePath, file });
    }
  });

  if (exerciseFiles.length === 0) {
    parseErrors.push({
      file: "<zip>",
      error: "Nessun file com.samsung.shealth.exercise.*.csv trovato nello ZIP",
    });
    return { samples, parseErrors, unrecognizedTypes };
  }

  for (const { name, file } of exerciseFiles) {
    try {
      const bytes = await file.async("uint8array");
      const text = decodeSamsungBytes(bytes);
      const { samples: rowSamples, rowErrors, unrecognizedTypes: rowUnrec } = await parseExerciseCsv(text);
      samples.push(...rowSamples);
      rowUnrec.forEach(t => unrecognizedTypes.add(t));
      if (rowErrors.length > 0) {
        // Aggrega errori per file (non per riga) per non inondare la UI
        parseErrors.push({
          file: name,
          error: `${rowErrors.length} righe skippate (es: ${rowErrors.slice(0, 3).map(e => `riga ${e.row}: ${e.error}`).join("; ")})`,
        });
      }
    } catch (e) {
      parseErrors.push({ file: name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { samples, parseErrors, unrecognizedTypes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedup vs workout esistenti
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trova workout corrispondente in lista esistente per un sample.
 *
 * Strategia (in ordine di priorità):
 *   1. Match per `fields.dedupKey` esatto → re-import idempotente.
 *   2. Match per (date YYYY-MM-DD + type + duration±2min) → manual entry.
 *
 * Ritorna workout id se match, null altrimenti.
 *
 * NB: questa funzione opera su workout già caricati in memory (caller
 * responsabile di passare un range ragionevole, es. ±90 giorni).
 */
export function findMatchingWorkout(sample: WearableSample, workouts: Workout[]): string | null {
  // 1. Match dedupKey
  for (const w of workouts) {
    const wf = w.fields as Record<string, unknown> | undefined;
    if (wf && typeof wf.dedupKey === "string" && wf.dedupKey === sample.dedupKey) {
      return w.id;
    }
  }

  // 2. Match (date+type+duration±2min)
  const sampleDate = sample.startedAt.slice(0, 10); // YYYY-MM-DD
  for (const w of workouts) {
    if (w.type !== sample.mappedType) continue;
    const wf = w.fields as Record<string, unknown> | undefined;
    // Workout creati dall'import hanno fields.startedAt (ISO). Workout legacy
    // potrebbero non averlo: in tal caso fall-back su createdAt (ISO).
    const candidateIso = (wf && typeof wf.startedAt === "string" ? wf.startedAt : undefined)
      ?? w.createdAt;
    if (!candidateIso) continue;
    const candDate = candidateIso.slice(0, 10);
    if (candDate !== sampleDate) continue;
    // duration: cerca in fields.durata_totale | fields.durata | fields.duration_min
    const wDur = readWorkoutDurationMin(wf);
    if (wDur === undefined) continue;
    if (Math.abs(wDur - sample.duration_min) <= 2) {
      return w.id;
    }
  }

  return null;
}

function readWorkoutDurationMin(fields: Record<string, unknown> | undefined): number | undefined {
  if (!fields) return undefined;
  const candidates = ["duration_min", "durata_totale", "durata", "minuti"];
  for (const k of candidates) {
    const v = fields[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample → Workout
// ─────────────────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Converte un WearableSample in un Workout pronto da scrivere a diario.
 * Le metriche Samsung vanno in `fields` per compat con form esistente +
 * legacy reader (formatDaysForLLM legge fc_media, kcal, ecc.).
 *
 * Convenzioni naming `fields`:
 *  - fc_media / fc_max   → HR (formatDaysForLLM li legge già)
 *  - kcal                → calorie
 *  - distance_km         → distanza
 *  - duration_min        → durata
 *  - source              → "samsung_health"
 *  - dedupKey            → per future dedup cross-import (I2)
 *  - startedAt           → ISO datetime preciso (oltre alla data del giorno)
 *  - rawType             → tipo nativo Samsung (debug/audit)
 */
export function sampleToWorkout(sample: WearableSample): Workout {
  // tipo: il subtype/label human va nel campo "tipo" (per UI) oltre che
  // in rawTypeLabel per audit. Es. rawType "1002" → tipo "Corsa".
  const humanLabel = samsungTypeToHumanLabel(sample.rawType);
  const fields: Record<string, unknown> = {
    source: "samsung_health",
    dedupKey: sample.dedupKey,
    startedAt: sample.startedAt,
    rawType: sample.rawType,
    rawTypeLabel: humanLabel,
    tipo: humanLabel, // per il form diario (subtype display)
    duration_min: sample.duration_min,
  };
  if (sample.hrAvg !== undefined) fields.fc_media = sample.hrAvg;
  if (sample.hrMax !== undefined) fields.fc_max = sample.hrMax;
  if (sample.calories !== undefined) fields.kcal = sample.calories;
  if (sample.distance_km !== undefined) fields.distance_km = sample.distance_km;

  return {
    id: uid(),
    type: sample.mappedType,
    fields,
    createdAt: sample.startedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ricava il dataset di workout dei giorni recenti per dedup matching.
 * Limit ±90 giorni: oltre, il match (date+type+duration) ha falsi positivi
 * troppo alti per essere utile.
 */
async function loadRecentWorkouts(): Promise<Array<{ date: string; workouts: Workout[] }>> {
  const allDays = await getAllDays();
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoff = ninetyDaysAgo.toISOString().slice(0, 10);
  return allDays.filter(d => d.date >= cutoff).map(d => ({ date: d.date, workouts: d.workouts }));
}

/**
 * Inietta un nuovo Workout nel day:YYYY-MM-DD storage. Se il giorno non
 * esiste ancora, lo crea con daily=null. Aggiorna anche diary-index.
 */
async function appendWorkoutToDay(date: string, workout: Workout): Promise<void> {
  const key = `day:${date}`;
  const existing = await getJSON<DiaryDay | null>(key, null);
  const dayData: DiaryDay = existing && typeof existing === "object"
    ? { daily: existing.daily ?? null, workouts: Array.isArray(existing.workouts) ? existing.workouts : [] }
    : { daily: null, workouts: [] };
  dayData.workouts.push(workout);
  await setJSON(key, dayData);

  // Aggiorna index
  const idx = await getJSON<string[]>("diary-index", []);
  if (!idx.includes(date)) {
    idx.push(date);
    await setJSON("diary-index", idx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrators (side effects)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Side-effect orchestrator: parsa ZIP, dedup contro storage esistente,
 * ritorna ImportPreview per UI conferma.
 *
 * NON scrive nulla. La conferma avviene via `commitImport`.
 */
export async function previewImport(zipBlob: Blob): Promise<ImportPreview> {
  // Reviewer 3.4: apri lo ZIP UNA volta sola e ripassa l'istanza ai parser.
  // Export annuali Samsung sono 50-100MB: prima si decomprimeva 3x (exercise,
  // HRV, Sleep), ora 1x. Se loadAsync fallisce, fall-back a comportamento
  // legacy: parseSamsungHealthZipDetailed loggerà l'errore e ritornerà vuoto.
  let preloadedZip: JSZip | undefined;
  try {
    preloadedZip = await loadSamsungZipOnce(zipBlob);
  } catch {
    preloadedZip = undefined;
  }

  const { samples, parseErrors, unrecognizedTypes } = await parseSamsungHealthZipDetailed(
    zipBlob,
    preloadedZip,
  );

  // Carica workout esistenti ±90 giorni per dedup
  const recentDays = await loadRecentWorkouts();
  const allWorkouts = recentDays.flatMap(d => d.workouts);

  const newWorkouts: WearableSample[] = [];
  const matchedWorkouts: WearableSample[] = [];

  // Dedup intra-import: se due sample dello stesso ZIP hanno stesso dedupKey
  // (rarissimo ma possibile se Samsung ha duplicati interni), tieni il primo.
  const seenDedupKeys = new Set<string>();

  for (const sample of samples) {
    if (seenDedupKeys.has(sample.dedupKey)) {
      matchedWorkouts.push({ ...sample, matchedWorkoutId: null });
      continue;
    }
    seenDedupKeys.add(sample.dedupKey);

    const matchedId = findMatchingWorkout(sample, allWorkouts);
    if (matchedId) {
      matchedWorkouts.push({ ...sample, matchedWorkoutId: matchedId });
    } else {
      newWorkouts.push(sample);
    }
  }

  // Wave 3.4: parse HRV + Sleep dal medesimo ZIP. Storage separati, non sostituiscono
  // daily check. parseErrors NON è inquinato perché i parser aggregati non
  // espongono per-file errors (sono best-effort).
  // Reviewer 3.4: passa l'istanza ZIP precaricata per evitare ri-decompressione.
  let hrvDaily: DailyHrvAggregate[] = [];
  let sleepDaily: DailySleepAggregate[] = [];
  try {
    hrvDaily = await parseSamsungHrvFromZip(zipBlob, preloadedZip);
  } catch (e) {
    parseErrors.push({ file: "<hrv>", error: e instanceof Error ? e.message : String(e) });
  }
  try {
    sleepDaily = await parseSamsungSleepFromZip(zipBlob, preloadedZip);
  } catch (e) {
    parseErrors.push({ file: "<sleep>", error: e instanceof Error ? e.message : String(e) });
  }

  return {
    totalSamples: samples.length,
    newWorkouts,
    matchedWorkouts,
    unrecognizedTypes: Array.from(unrecognizedTypes).sort(),
    parseErrors,
    hrvDaily,
    sleepDaily,
  };
}

/**
 * Side-effect orchestrator: applica l'import dopo conferma utente.
 * Scrive nuovi Workout via storage, aggiorna `wearable-import-log`.
 *
 * Idempotente: se `commitImport` viene chiamato due volte sullo stesso
 * preview, il secondo run vedrà i workout creati dal primo via dedupKey
 * → 0 nuovi (test #17).
 *
 * NB: la preview passata può essere "stale" (workout creati nel frattempo
 * da altre tab); ri-eseguiamo dedup live contro lo storage attuale per
 * sicurezza.
 */
export async function commitImport(preview: ImportPreview): Promise<CommitResult> {
  const importLogId = uid();
  let workoutsCreated = 0;
  let duplicatesSkipped = preview.matchedWorkouts.length;

  // Re-load workout per dedup live (preview può essere stale)
  const recentDays = await loadRecentWorkouts();
  const allWorkouts = recentDays.flatMap(d => d.workouts);
  const liveDedupKeys = new Set<string>();
  for (const w of allWorkouts) {
    const wf = w.fields as Record<string, unknown> | undefined;
    if (wf && typeof wf.dedupKey === "string") liveDedupKeys.add(wf.dedupKey);
  }

  for (const sample of preview.newWorkouts) {
    if (liveDedupKeys.has(sample.dedupKey)) {
      duplicatesSkipped++;
      continue;
    }
    const workout = sampleToWorkout(sample);
    const date = sample.startedAt.slice(0, 10);
    try {
      await appendWorkoutToDay(date, workout);
      liveDedupKeys.add(sample.dedupKey);
      workoutsCreated++;
    } catch (e) {
      // Workout singolo fallisce → log + continua. UI vedrà discrepanza
      // tra preview.newWorkouts.length e workoutsCreated.
      console.warn(`[commitImport] saveDay fallito per ${date}:`, e);
    }
  }

  // Wave 3.4: persist HRV/sleep aggregati (storage separati). Merge con
  // history esistente, dedup per `date` (l'import nuovo VINCE su quello vecchio
  // — l'utente sta sincronizzando dati più recenti). Pruning a 90gg.
  const hrvDaysImported = await mergeHrvHistory(preview.hrvDaily);
  const sleepDaysImported = await mergeSleepHistory(preview.sleepDaily);

  // Trigger ricalcolo readiness se sono arrivati nuovi dati HRV/sleep
  if (hrvDaysImported > 0 || sleepDaysImported > 0) {
    try {
      await recomputeReadinessForToday();
    } catch (e) {
      console.warn("[commitImport] recompute readiness fallito:", e);
    }
  }

  // Append import log
  const logEntry: ImportLogEntry = {
    id: importLogId,
    importedAt: new Date().toISOString(),
    source: "samsung_health",
    totalSamples: preview.totalSamples,
    workoutsCreated,
    duplicatesSkipped,
    unrecognizedTypes: preview.unrecognizedTypes,
    hrvDaysImported,
    sleepDaysImported,
  };
  const log = await getJSON<ImportLogEntry[]>("wearable-import-log", []);
  log.push(logEntry);
  // Pruning: tieni ultimi 50 log (~5KB ciascuno = 250KB max)
  const trimmed = log.slice(-50);
  try {
    await setJSON("wearable-import-log", trimmed);
  } catch (e) {
    console.warn("[commitImport] failed to write wearable-import-log:", e);
  }

  return { workoutsCreated, duplicatesSkipped, importLogId, hrvDaysImported, sleepDaysImported };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wave 3.4: HRV / Sleep history merging (storage separati)
// ─────────────────────────────────────────────────────────────────────────────

/** Pruning window per HRV/sleep history (90gg) per evitare blow-up storage. */
const WEARABLE_HISTORY_DAYS = 90;

function pruneCutoffDate(): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - WEARABLE_HISTORY_DAYS);
  return cutoff.toISOString().slice(0, 10);
}

/**
 * Merge nuovi sample HRV con storage esistente. Strategy: l'import nuovo
 * VINCE per stessa data (l'utente sta ri-sincronizzando dati più recenti).
 * Pruning automatico a WEARABLE_HISTORY_DAYS.
 *
 * Ritorna il numero di giorni effettivamente importati (post-merge).
 */
async function mergeHrvHistory(incoming: DailyHrvAggregate[]): Promise<number> {
  if (incoming.length === 0) return 0;
  const existing = await getJSON<DailyHrvAggregate[]>(SAMSUNG_HRV_HISTORY_KEY, []);
  const map = new Map<string, DailyHrvAggregate>();
  for (const entry of existing) {
    if (entry && typeof entry.date === "string") map.set(entry.date, entry);
  }
  let imported = 0;
  for (const entry of incoming) {
    map.set(entry.date, entry);
    imported++;
  }
  const cutoff = pruneCutoffDate();
  const merged = Array.from(map.values())
    .filter(e => e.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
  try {
    await setJSON(SAMSUNG_HRV_HISTORY_KEY, merged);
  } catch (e) {
    console.warn("[mergeHrvHistory] failed to persist:", e);
  }
  return imported;
}

/** Stessa logica per sleep. */
async function mergeSleepHistory(incoming: DailySleepAggregate[]): Promise<number> {
  if (incoming.length === 0) return 0;
  const existing = await getJSON<DailySleepAggregate[]>(SAMSUNG_SLEEP_HISTORY_KEY, []);
  const map = new Map<string, DailySleepAggregate>();
  for (const entry of existing) {
    if (entry && typeof entry.date === "string") map.set(entry.date, entry);
  }
  let imported = 0;
  for (const entry of incoming) {
    map.set(entry.date, entry);
    imported++;
  }
  const cutoff = pruneCutoffDate();
  const merged = Array.from(map.values())
    .filter(e => e.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
  try {
    await setJSON(SAMSUNG_SLEEP_HISTORY_KEY, merged);
  } catch (e) {
    console.warn("[mergeSleepHistory] failed to persist:", e);
  }
  return imported;
}

// Re-export per consumer che vogliono accesso a storage helper interni
// (es. test integrazione che mockano)
export const __internal__ = {
  appendWorkoutToDay,
  loadRecentWorkouts,
  storage,
};
