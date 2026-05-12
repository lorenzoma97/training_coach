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

/** Default window: importa solo ultimi 14 giorni. */
export const DEFAULT_IMPORT_WINDOW_DAYS = 14;

/** Soglia score: ≥ AUTO → enrichment automatico. */
export const SCORE_AUTO_ENRICH = 80;
/** Soglia score: AMBIGUOUS_MIN ≤ score < AUTO → match ambiguo (richiede UI). */
export const SCORE_AMBIGUOUS_MIN = 60;

/** Confidence outcome del match score-based. */
export type MatchConfidence = "certo" | "ambiguo" | "none";

/** Risultato singolo match scoring. */
export interface MatchResult {
  workoutId: string;
  /** Score 0..115 (mappedType=50 + ora=30 + durata=20 + subtype=15). */
  score: number;
  /** Categoria: certo (≥80), ambiguo (60..79), none (<60). */
  confidence: MatchConfidence;
}

/** Candidato per UI ambiguous decision (label + score). */
export interface MatchCandidate {
  workoutId: string;
  score: number;
  /** Stringa human-readable per la UI: "corsa breve 20min" tipo. */
  preview: string;
}

/** Decisione utente per un sample ambiguo o senza match. */
export type SampleDecision =
  | { kind: "enrich"; workoutId: string }
  | { kind: "new" }
  | { kind: "skip" };

export interface ImportPreview {
  /** Totale sample parsati dal CSV (post-window-filter). */
  totalSamples: number;
  /**
   * Sample CERTI da creare ex-novo (no match score>=60 con workout esistenti).
   * Note: rinominato per chiarezza vs sample che richiedono conferma.
   */
  newWorkouts: WearableSample[];
  /**
   * NEW: arricchimenti automatici (score ≥ 80). Ogni sample è già stato
   * matchato con certezza a un workout manuale; commit unirà i campi
   * biometrici Samsung mantenendo i campi user (coalesce con `??`).
   */
  autoEnrichments: Array<{
    sample: WearableSample;
    existingWorkoutId: string;
    score: number;
    /** Campi che verranno aggiunti dal sample (es. ["fc_media", "kcal"]). */
    fieldsAdded: string[];
  }>;
  /**
   * NEW: match ambigui (score 60..79) + sample senza match che richiedono
   * conferma utente. Per ognuno, lista ordinata di candidati top (max 3).
   * Se `candidates` vuoto → no-match: la UI offrirà solo "crea nuovo" / "skip".
   */
  ambiguousMatches: Array<{
    sample: WearableSample;
    candidates: MatchCandidate[];
  }>;
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
  /** NEW: finestra temporale applicata in giorni (default 14). */
  windowDays: number;
}

/** Opzioni per `previewImport`. */
export interface PreviewImportOptions {
  /**
   * Filtra sample con `startedAt < now - windowDays` PRIMA del matching.
   * Default: 14 (ultime 2 settimane). Passa numero alto (es. 3650) per
   * importare tutto lo storico.
   */
  windowDays?: number;
}

export interface CommitResult {
  workoutsCreated: number;
  /** NEW: workout esistenti arricchiti con biometrici Samsung. */
  workoutsEnriched: number;
  duplicatesSkipped: number;
  /** NEW: ambigui risolti dall'utente (somma di enrich+new+skip dalle decisions). */
  ambiguousResolved: number;
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
  /** Wave 3.5: tracking arricchimenti + ambigui risolti. */
  workoutsEnriched?: number;
  ambiguousResolved?: number;
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
// Pattern stretto: SOLO file principale `com.samsung.shealth.exercise.<timestamp>.csv`
// (timestamp = solo digit). Esclude variant satellite presenti nell'export reale:
//   exercise.extension.* / exercise.weather.* / exercise.max_heart_rate.* /
//   exercise.recovery_heart_rate.* / exercise.hr_zone.* / exercise.periodization_*
// Quei file hanno schema CSV diverso (no exercise_type column) e parsarli
// produrrebbe solo parse errors aggregati nella UI senza valore aggiunto.
// Verificato su export reale Samsung Health 2026-05-09 di Lorenzo.
const EXERCISE_CSV_PATTERN = /com\.samsung\.shealth\.exercise\.\d+\.csv$/i;

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
// Matching score-based (Wave 3.5) vs workout esistenti
// ─────────────────────────────────────────────────────────────────────────────
//
// Score breakdown (max 115 con tutti i bonus):
//   +50  mappedType uguale   (VINCOLANTE: se diverso, score = 0)
//   +30  ora inizio entro ±15 min (Samsung startedAt vs workout createdAt o
//                                  fields.ora_inizio se presente)
//   +20  durata entro ±5%      (vs fields.durata_totale / durata / duration_min)
//   +15  subtype/rawType matcha sub label workout (es. "Padel" su sport generic)
//
// Soglie:
//   ≥ 80  → certo  → enrichment automatico
//   60..79 → ambiguo → richiesta UI utente
//   < 60   → none   → richiesta UI ("crea nuovo o skip")
//
// NB: dedupKey match (re-import idempotente) gestito separatamente PRE-scoring:
// se dedupKey esatto, score = 1000 → categoria "certo" (skip puro, no enrich).

/** Score returnato per match dedupKey esatto (pseudo-infinito, sempre vince). */
const DEDUP_KEY_EXACT_SCORE = 1000;

/**
 * Calcola score di matching tra un sample Samsung e un workout candidato.
 * Pure function: no storage access, no async. Non distingue se stesso giorno
 * o no — il chiamante deve filtrare PRIMA per data (we score solo workout
 * dello stesso giorno).
 *
 * Ritorna 0 se mappedType non combacia (criterio VINCOLANTE).
 */
export function scoreWorkoutMatch(sample: WearableSample, workout: Workout): number {
  // Dedup-key esatto: re-import idempotente, vince su tutto.
  const wf = workout.fields as Record<string, unknown> | undefined;
  if (wf && typeof wf.dedupKey === "string" && wf.dedupKey === sample.dedupKey) {
    return DEDUP_KEY_EXACT_SCORE;
  }

  // mappedType VINCOLANTE: tipo diverso → no match.
  if (workout.type !== sample.mappedType) return 0;
  let score = 50;

  // Bonus ora inizio (±15 min). workout.fields.ora_inizio (HH:MM) ha priorità,
  // altrimenti createdAt o fields.startedAt (ISO datetime).
  const sampleMinutes = isoToMinutesSinceMidnight(sample.startedAt);
  const workoutMinutes = readWorkoutStartMinutes(wf, workout.createdAt);
  if (sampleMinutes !== null && workoutMinutes !== null) {
    const diff = Math.abs(sampleMinutes - workoutMinutes);
    // Tolleranza wraparound mezzanotte (raro ma possibile).
    const wrapDiff = Math.min(diff, 1440 - diff);
    if (wrapDiff <= 15) score += 30;
  }

  // Bonus durata (±5%). 5% di tolleranza con minimo 2min (per workout brevi).
  const wDur = readWorkoutDurationMin(wf);
  if (wDur !== undefined && wDur > 0) {
    const tol = Math.max(2, Math.round(wDur * 0.05));
    if (Math.abs(wDur - sample.duration_min) <= tol) score += 20;
  }

  // Bonus subtype: rawType Samsung (label human) matcha fields.tipo del workout.
  // Discrimina "sport" generic (Padel vs Calcio vs Tennis nello stesso slot).
  const sampleLabel = samsungTypeToHumanLabel(sample.rawType).toLowerCase().trim();
  const workoutSub = readWorkoutSubtype(wf);
  if (sampleLabel && workoutSub) {
    const sub = workoutSub.toLowerCase().trim();
    if (sub === sampleLabel || sub.includes(sampleLabel) || sampleLabel.includes(sub)) {
      score += 15;
    }
  }

  return score;
}

/**
 * Trova il miglior match per un sample tra una lista di workout dello stesso
 * giorno. Tie-breaking: top score; in caso di parità, primo cronologico
 * (createdAt più antico).
 *
 * Ritorna workoutId + score + confidence (certo/ambiguo/none).
 */
export function findBestMatch(sample: WearableSample, workouts: Workout[]): MatchResult {
  let best: { workout: Workout; score: number } | null = null;
  for (const w of workouts) {
    const s = scoreWorkoutMatch(sample, w);
    if (s <= 0) continue;
    if (!best || s > best.score) {
      best = { workout: w, score: s };
    } else if (s === best.score) {
      // Tie-break: primo cronologico (createdAt minore)
      const aCreated = best.workout.createdAt ?? "";
      const bCreated = w.createdAt ?? "";
      if (bCreated && (!aCreated || bCreated < aCreated)) {
        best = { workout: w, score: s };
      }
    }
  }

  if (!best) return { workoutId: "", score: 0, confidence: "none" };

  const confidence: MatchConfidence =
    best.score >= SCORE_AUTO_ENRICH ? "certo" :
    best.score >= SCORE_AMBIGUOUS_MIN ? "ambiguo" :
    "none";

  return { workoutId: best.workout.id, score: best.score, confidence };
}

/**
 * Backward-compat: `findMatchingWorkout` ritorna workoutId della top match
 * SOLO se score ≥ AUTO (certo). Mantenuto come thin wrapper su findBestMatch
 * per non rompere consumer esterni eventuali. Nuovo codice usa findBestMatch.
 */
export function findMatchingWorkout(sample: WearableSample, workouts: Workout[]): string | null {
  const m = findBestMatch(sample, workouts);
  return m.confidence === "certo" ? m.workoutId : null;
}

/** Estrae minuti dalla mezzanotte da una stringa ISO datetime. */
function isoToMinutesSinceMidnight(iso: string): number | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // UTC per coerenza con Samsung normalization (UTC-treated)
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Estrae l'ora di inizio del workout in minuti dalla mezzanotte. */
function readWorkoutStartMinutes(
  fields: Record<string, unknown> | undefined,
  createdAt: string | undefined,
): number | null {
  // Priorità 1: fields.ora_inizio (formato "HH:MM" utente, locale)
  if (fields) {
    const oi = fields.ora_inizio;
    if (typeof oi === "string") {
      const m = oi.match(/^(\d{1,2}):(\d{2})/);
      if (m) {
        const hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) return hh * 60 + mm;
      }
    }
    // Priorità 2: fields.startedAt ISO (workout già importati da Samsung)
    if (typeof fields.startedAt === "string") {
      const v = isoToMinutesSinceMidnight(fields.startedAt);
      if (v !== null) return v;
    }
  }
  // Priorità 3: createdAt ISO (proxy)
  if (createdAt) {
    const v = isoToMinutesSinceMidnight(createdAt);
    if (v !== null) return v;
  }
  return null;
}

/** Estrae subtype/label del workout (es. "Padel", "corsa intervalli"). */
function readWorkoutSubtype(fields: Record<string, unknown> | undefined): string | null {
  if (!fields) return null;
  const candidates = ["tipo", "subtype", "rawTypeLabel", "label"];
  for (const k of candidates) {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) return v.trim();
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
// Enrichment (Wave 3.5): preserve user data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista campi biometrici candidati a enrichment dal sample Samsung.
 * "Preserve user data": sovrascriviamo SOLO se il workout esistente non ha
 * già un valore in quel campo (coalesce con `??`).
 */
const ENRICHABLE_FIELDS: Array<{
  key: string;
  /** Estrattore valore dal sample. Ritorna undefined se sample non ha il dato. */
  pick: (s: WearableSample) => unknown;
}> = [
  { key: "fc_media",   pick: (s) => s.hrAvg },
  { key: "fc_max",     pick: (s) => s.hrMax },
  { key: "kcal",       pick: (s) => s.calories },
  { key: "distance_km", pick: (s) => s.distance_km },
];

/**
 * Pure function: ritorna un nuovo Workout arricchito con i biometrici Samsung.
 * Mai sovrascrive campi user esistenti (coalesce). Aggiunge metadata
 * `enrichedFrom` + `dedupKey` per re-import idempotente.
 *
 * Calcola anche `passo_medio` (min/km) se sample ha distance_km e durata.
 */
export function enrichWorkoutFromSample(workout: Workout, sample: WearableSample): Workout {
  const oldFields = (workout.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = { ...oldFields };
  const added: string[] = [];

  for (const { key, pick } of ENRICHABLE_FIELDS) {
    const newVal = pick(sample);
    if (newVal === undefined || newVal === null) continue;
    if (oldFields[key] === undefined || oldFields[key] === null || oldFields[key] === "") {
      fields[key] = newVal;
      added.push(key);
    }
  }

  // Passo medio (min/km) se sample ha distance + durata e workout non ce l'ha già.
  const distKm = (fields.distance_km as number | undefined) ?? sample.distance_km;
  if (
    distKm !== undefined && distKm > 0 &&
    sample.duration_min > 0 &&
    (oldFields.passo_medio === undefined || oldFields.passo_medio === null || oldFields.passo_medio === "")
  ) {
    const paceMinPerKm = sample.duration_min / distKm;
    fields.passo_medio = Math.round(paceMinPerKm * 100) / 100;
    added.push("passo_medio");
  }

  // Metadata per re-import idempotente: dedupKey + enrichedFrom (data ISO sample).
  fields.dedupKey = sample.dedupKey;
  const enrichedDate = sample.startedAt.slice(0, 10);
  fields.enrichedFrom = `samsung-${enrichedDate}`;
  if (sample.startedAt && oldFields.startedAt === undefined) {
    fields.startedAt = sample.startedAt;
  }

  return {
    ...workout,
    fields,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Identifica quali campi `enrichWorkoutFromSample` aggiungerebbe (dry-run).
 * Usato dalla preview UI per mostrare "+FC +kcal +distance" all'utente.
 */
export function previewEnrichmentFields(workout: Workout, sample: WearableSample): string[] {
  const oldFields = (workout.fields ?? {}) as Record<string, unknown>;
  const added: string[] = [];
  for (const { key, pick } of ENRICHABLE_FIELDS) {
    const newVal = pick(sample);
    if (newVal === undefined || newVal === null) continue;
    if (oldFields[key] === undefined || oldFields[key] === null || oldFields[key] === "") {
      added.push(key);
    }
  }
  const distKm = (oldFields.distance_km as number | undefined) ?? sample.distance_km;
  if (
    distKm !== undefined && distKm > 0 &&
    sample.duration_min > 0 &&
    (oldFields.passo_medio === undefined || oldFields.passo_medio === null || oldFields.passo_medio === "")
  ) {
    added.push("passo_medio");
  }
  return added;
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

/**
 * Aggiorna in-place un workout esistente in `day:YYYY-MM-DD`. Usato per
 * applicare enrichment (campi biometrici Samsung su workout manuale).
 *
 * Ritorna true se update applicato; false se il workout non è stato trovato
 * (es. è stato cancellato tra preview e commit, edge case race).
 */
async function updateWorkoutInDay(date: string, updated: Workout): Promise<boolean> {
  const key = `day:${date}`;
  const existing = await getJSON<DiaryDay | null>(key, null);
  if (!existing || !Array.isArray(existing.workouts)) return false;
  const idx = existing.workouts.findIndex(w => w.id === updated.id);
  if (idx < 0) return false;
  existing.workouts[idx] = updated;
  await setJSON(key, existing);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrators (side effects)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Side-effect orchestrator: parsa ZIP, applica filtro finestra temporale,
 * categorizza in 3 gruppi (nuovi / auto-enrich / da-confermare), ritorna
 * ImportPreview per UI conferma.
 *
 * NON scrive nulla. La conferma avviene via `commitImport` con le `decisions`
 * raccolte dalla UI per gli ambigui.
 *
 * @param zipBlob ZIP esportato da Samsung Health.
 * @param opts.windowDays Filtra sample con `startedAt < now - windowDays`
 *   PRIMA del matching (default 14 = ultime 2 settimane).
 */
export async function previewImport(
  zipBlob: Blob,
  opts?: PreviewImportOptions,
): Promise<ImportPreview> {
  const windowDays = opts?.windowDays ?? DEFAULT_IMPORT_WINDOW_DAYS;

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

  const { samples: allSamples, parseErrors, unrecognizedTypes } = await parseSamsungHealthZipDetailed(
    zipBlob,
    preloadedZip,
  );

  // Filtro finestra temporale: scarta sample troppo vecchi PRIMA del matching.
  // Riduce noise (utenti tipicamente non vogliono re-importare 2 anni di storia).
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = cutoff.toISOString();
  const samples = allSamples.filter(s => s.startedAt >= cutoffIso);

  // Carica workout esistenti ±90 giorni per match (per-day buckets per scoring).
  const recentDays = await loadRecentWorkouts();
  const workoutsByDate = new Map<string, Workout[]>();
  for (const d of recentDays) {
    if (d.workouts.length > 0) workoutsByDate.set(d.date, d.workouts);
  }

  const newWorkouts: WearableSample[] = [];
  const autoEnrichments: ImportPreview["autoEnrichments"] = [];
  const ambiguousMatches: ImportPreview["ambiguousMatches"] = [];

  // Dedup intra-import: se due sample dello stesso ZIP hanno stesso dedupKey
  // (rarissimo ma possibile se Samsung ha duplicati interni), tieni il primo.
  // Skippiamo i duplicati silenziosamente (non li categorizziamo come ambigui).
  const seenDedupKeys = new Set<string>();

  for (const sample of samples) {
    if (seenDedupKeys.has(sample.dedupKey)) continue;
    seenDedupKeys.add(sample.dedupKey);

    const sampleDate = sample.startedAt.slice(0, 10);
    const dayWorkouts = workoutsByDate.get(sampleDate) ?? [];

    const best = findBestMatch(sample, dayWorkouts);

    // Dedup-key esatto = re-import idempotente. Score 1000 → "certo" ma
    // NON va in autoEnrichments (il workout già contiene quei dati Samsung):
    // diventa duplicate silenzioso. Lo intercettiamo prima della categorizzazione.
    if (best.score === DEDUP_KEY_EXACT_SCORE) {
      continue;
    }

    if (best.confidence === "certo") {
      // Score ≥ 80 → enrichment automatico
      const targetWorkout = dayWorkouts.find(w => w.id === best.workoutId)!;
      const fieldsAdded = previewEnrichmentFields(targetWorkout, sample);
      autoEnrichments.push({
        sample,
        existingWorkoutId: best.workoutId,
        score: best.score,
        fieldsAdded,
      });
    } else if (best.confidence === "ambiguo") {
      // Score 60..79 → ambiguo. Includi TUTTI i candidati con score ≥ AMBIGUOUS_MIN
      // (max 3, ordinati per score desc) per la UI di scelta.
      const candidates = buildCandidateList(sample, dayWorkouts);
      ambiguousMatches.push({ sample, candidates });
    } else {
      // No match (score < 60).
      // Se esistono workout dello stesso giorno (anche se non matchano bene),
      // l'utente potrebbe voler associarli → categorizziamo come ambiguo
      // con `candidates: []` (UI mostra solo "crea nuovo" / "skip").
      // Se NON ci sono workout del giorno → newWorkouts (path certo).
      if (dayWorkouts.length === 0) {
        newWorkouts.push(sample);
      } else {
        // NEW (design approvato): chiediamo conferma anche per i no-match
        // quando esistono workout dello stesso giorno (l'utente potrebbe
        // averne registrato uno con tipo/orario molto diversi).
        const candidates = buildCandidateList(sample, dayWorkouts);
        ambiguousMatches.push({ sample, candidates });
      }
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
    autoEnrichments,
    ambiguousMatches,
    unrecognizedTypes: Array.from(unrecognizedTypes).sort(),
    parseErrors,
    hrvDaily,
    sleepDaily,
    windowDays,
  };
}

/**
 * Costruisce lista candidati ordinati per score desc (max 3).
 * Include solo workout con stesso mappedType (score > 0).
 */
function buildCandidateList(sample: WearableSample, workouts: Workout[]): MatchCandidate[] {
  const scored: Array<{ w: Workout; s: number }> = [];
  for (const w of workouts) {
    const s = scoreWorkoutMatch(sample, w);
    if (s > 0 && s < DEDUP_KEY_EXACT_SCORE) scored.push({ w, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 3).map(({ w, s }) => ({
    workoutId: w.id,
    score: s,
    preview: buildWorkoutPreviewLabel(w),
  }));
}

/** Stringa human-readable per UI candidato: "corsa breve 20min" tipo. */
function buildWorkoutPreviewLabel(w: Workout): string {
  const wf = (w.fields ?? {}) as Record<string, unknown>;
  const sub = readWorkoutSubtype(wf);
  const dur = readWorkoutDurationMin(wf);
  const parts: string[] = [];
  if (sub) parts.push(sub);
  else parts.push(w.type);
  if (dur) parts.push(`${dur}min`);
  return parts.join(" ");
}

/**
 * Side-effect orchestrator: applica l'import dopo conferma utente.
 *
 * Strategy:
 *  1. `preview.newWorkouts` → CREATE nuovi Workout (sample senza candidati).
 *  2. `preview.autoEnrichments` → UPDATE workout esistenti con biometrici
 *     Samsung (preserve user data: coalesce `??`).
 *  3. `preview.ambiguousMatches` → per ognuno guarda `decisions.get(sampleId)`:
 *     - `{kind:"enrich",workoutId}` → enrich workout target
 *     - `{kind:"new"}` → CREATE nuovo Workout
 *     - `{kind:"skip"}` o decision mancante → skip (default safe)
 *
 * Idempotente: dedupKey check live contro storage attuale + score=1000 dedup
 * filtra ri-import dello stesso sample. UI può chiamare `commitImport(preview)`
 * senza `decisions` → ambigui vengono tutti skippati (safe default).
 *
 * NB: la preview può essere "stale" (workout creati nel frattempo da altre
 * tab); ri-eseguiamo dedup live contro lo storage attuale per sicurezza.
 *
 * @param preview Output di `previewImport`.
 * @param decisions Map sampleDedupKey → decisione utente (opzionale).
 */
export async function commitImport(
  preview: ImportPreview,
  decisions?: Map<string, SampleDecision>,
): Promise<CommitResult> {
  const importLogId = uid();
  let workoutsCreated = 0;
  let workoutsEnriched = 0;
  // Conta come "duplicati silenziosi" i sample che la preview ha già filtrato
  // via dedupKey-match (re-import idempotente). totalSamples include i sample
  // post-window-filter; le 3 categorie li dovrebbero coprire tutti — il
  // residuo è quanto è stato matchato per dedupKey esatto.
  const categorizedCount =
    preview.newWorkouts.length +
    preview.autoEnrichments.length +
    preview.ambiguousMatches.length;
  let duplicatesSkipped = Math.max(0, preview.totalSamples - categorizedCount);
  let ambiguousResolved = 0;

  // Re-load workout live per dedup + targeting enrichment (preview può essere stale)
  const recentDays = await loadRecentWorkouts();
  const allWorkouts = recentDays.flatMap(d => d.workouts);
  const liveDedupKeys = new Set<string>();
  for (const w of allWorkouts) {
    const wf = w.fields as Record<string, unknown> | undefined;
    if (wf && typeof wf.dedupKey === "string") liveDedupKeys.add(wf.dedupKey);
  }
  // Index per ricerca workout by id (per enrichment).
  const workoutIndex = new Map<string, { date: string; workout: Workout }>();
  for (const d of recentDays) {
    for (const w of d.workouts) workoutIndex.set(w.id, { date: d.date, workout: w });
  }

  // ─── 1. newWorkouts → CREATE ─────────────────────────────────────────────
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
      console.warn(`[commitImport] saveDay fallito per ${date}:`, e);
    }
  }

  // ─── 2. autoEnrichments → UPDATE ─────────────────────────────────────────
  for (const enrich of preview.autoEnrichments) {
    if (liveDedupKeys.has(enrich.sample.dedupKey)) {
      // Già importato in passato (enrich applicato prima): skip.
      duplicatesSkipped++;
      continue;
    }
    const target = workoutIndex.get(enrich.existingWorkoutId);
    if (!target) {
      // Workout sparito tra preview e commit (race con altra tab). Fall-back:
      // creiamo nuovo workout per non perdere il dato Samsung.
      console.warn(`[commitImport] target ${enrich.existingWorkoutId} non trovato, fall-back create`);
      const w = sampleToWorkout(enrich.sample);
      const date = enrich.sample.startedAt.slice(0, 10);
      try {
        await appendWorkoutToDay(date, w);
        liveDedupKeys.add(enrich.sample.dedupKey);
        workoutsCreated++;
      } catch (e) {
        console.warn(`[commitImport] fallback create fallito:`, e);
      }
      continue;
    }
    const updated = enrichWorkoutFromSample(target.workout, enrich.sample);
    try {
      const ok = await updateWorkoutInDay(target.date, updated);
      if (ok) {
        liveDedupKeys.add(enrich.sample.dedupKey);
        workoutsEnriched++;
        // Aggiorna index in memoria per coerenza intra-loop (utile se enrich
        // multipli puntano allo stesso workoutId — edge case).
        workoutIndex.set(target.workout.id, { date: target.date, workout: updated });
      } else {
        console.warn(`[commitImport] update fallito per ${target.workout.id} (workout sparito)`);
      }
    } catch (e) {
      console.warn(`[commitImport] enrich fallito per ${target.workout.id}:`, e);
    }
  }

  // ─── 3. ambiguousMatches → decisions o skip ──────────────────────────────
  for (const amb of preview.ambiguousMatches) {
    const decision = decisions?.get(amb.sample.dedupKey);
    if (!decision || decision.kind === "skip") {
      // Default: skip (no decision = utente non ha confermato).
      duplicatesSkipped++;
      if (decision) ambiguousResolved++;
      continue;
    }
    if (liveDedupKeys.has(amb.sample.dedupKey)) {
      duplicatesSkipped++;
      ambiguousResolved++;
      continue;
    }
    if (decision.kind === "new") {
      const w = sampleToWorkout(amb.sample);
      const date = amb.sample.startedAt.slice(0, 10);
      try {
        await appendWorkoutToDay(date, w);
        liveDedupKeys.add(amb.sample.dedupKey);
        workoutsCreated++;
        ambiguousResolved++;
      } catch (e) {
        console.warn(`[commitImport] ambiguous-new fallito:`, e);
      }
    } else if (decision.kind === "enrich") {
      const target = workoutIndex.get(decision.workoutId);
      if (!target) {
        console.warn(`[commitImport] ambiguous-enrich target ${decision.workoutId} non trovato`);
        duplicatesSkipped++;
        continue;
      }
      const updated = enrichWorkoutFromSample(target.workout, amb.sample);
      try {
        const ok = await updateWorkoutInDay(target.date, updated);
        if (ok) {
          liveDedupKeys.add(amb.sample.dedupKey);
          workoutsEnriched++;
          ambiguousResolved++;
          workoutIndex.set(target.workout.id, { date: target.date, workout: updated });
        }
      } catch (e) {
        console.warn(`[commitImport] ambiguous-enrich fallito:`, e);
      }
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
    workoutsEnriched,
    ambiguousResolved,
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

  return {
    workoutsCreated,
    workoutsEnriched,
    duplicatesSkipped,
    ambiguousResolved,
    importLogId,
    hrvDaysImported,
    sleepDaysImported,
  };
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

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — Upload cartella estratta Samsung Health (mobile Android).
// Samsung Health Android esporta in /Documents/Samsung Health/<timestamp>/
// come cartella NON zippata. UI `<input webkitdirectory>` ritorna una
// FileList con tutti i file della cartella selezionata. Costruiamo uno ZIP
// in-memory così la pipeline `previewImport(blob)` esistente non cambia.
// NB iOS Safari ignora `webkitdirectory` → degrade a picker file singolo.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Costruisce un Blob ZIP in-memory partendo da una FileList ottenuta da
 * `<input webkitdirectory>`. Preserva i path relativi via
 * `File.webkitRelativePath` così le regex del parser (es. `Samsung Health/...`)
 * continuano a matchare. Fallback su `file.name` se l'attributo è vuoto
 * (browser legacy che non popola webkitRelativePath).
 *
 * @param files FileList da `event.target.files` dell'input directory.
 * @returns Blob compresso ZIP, consumabile da `previewImport(blob, opts)`.
 */
export async function fileListToZipBlob(files: FileList | File[]): Promise<Blob> {
  const zip = new JSZip();
  // FileList non è iterabile su tutti i browser → Array.from.
  const arr: File[] = Array.from(files);
  for (const f of arr) {
    const buf = await f.arrayBuffer();
    // webkitRelativePath è il path relativo dalla root della cartella
    // selezionata (es. "Samsung Health/samsunghealth_xxx/com.samsung...csv").
    // Su input file singolo (no webkitdirectory) il valore è "" → fallback name.
    const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    zip.file(relPath, buf);
  }
  return await zip.generateAsync({ type: "blob" });
}

// Re-export per consumer che vogliono accesso a storage helper interni
// (es. test integrazione che mockano)
export const __internal__ = {
  appendWorkoutToDay,
  updateWorkoutInDay,
  loadRecentWorkouts,
  storage,
};
