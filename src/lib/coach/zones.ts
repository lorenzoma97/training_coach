// Calcolo zone di frequenza cardiaca in cascata:
// 1. Tanaka (solo età) → FCmax = 208 - 0.7 × età, sempre disponibile
// 2. Karvonen (HRR) → se abbiamo FC a riposo mattutina (daily.morningHR)
//    Zn_low = HRrest + pct_low × (FCmax - HRrest)
// 3. Empirica → se ≥ 5 corse "easy" registrate (tipo Fondo Lento, RPE ≤ 5),
//    usa il range 25°-75° percentile della FC media effettiva per Z2
//
// FCmax cascade analoga:
// - Tanaka teorica (age)
// - Osservata: max(fc_max) sui workout corsa (se > Tanaka → usata come riferimento)

import type { UserProfile } from "../types";

export type ZoneIndex = 1 | 2 | 3 | 4 | 5;
export type ZoneMethod = "tanaka" | "karvonen" | "tested";

export interface Zone {
  index: ZoneIndex;
  name: string;
  shortLabel: string;
  description: string;
  usageHint: string;
  /** Range FC in bpm (low, high inclusive). */
  hrLow: number;
  hrHigh: number;
  /** RPE tipico 1-10. */
  rpeLow: number;
  rpeHigh: number;
  /** Passo medio tipico (in sec/km) se disponibile dallo storico. */
  paceTypicalSec?: number;
}

export interface ZonesResult {
  /** Metodo usato per calcolare Z2 (la zona principale). */
  method: ZoneMethod;
  /** FCmax in bpm usata per derivare tutte le zone. */
  fcMax: number;
  /**
   * Valore informativo-only: FCmax più alta osservata nei workout di corsa.
   * NON è usato per il calcolo delle zone — quelle derivano da `fcMax`
   * (test sul campo o Tanaka). È mostrato nella card zone come riferimento
   * visivo ("oss. XYZ bpm") e nel prompt coach come hint qualitativo.
   * Ragione: un singolo battito alto da artefatto cinturino non deve
   * ridefinire le zone (Mühlen INTERLIVE 2021). Filtriamo già a
   * fcMaxCandidates con >=2 osservazioni >Tanaka+3 per ridurre noise.
   * @see computeZones dove questo campo viene popolato.
   */
  fcMaxObserved?: number;
  /** FC a riposo usata (Karvonen) se metodo = karvonen. */
  fcRest?: number;
  /** Numero di workout "easy" usati per derivazione empirica (0 se non usata). */
  empiricalSampleSize: number;
  /**
   * HINT INFORMATIVO: range FC media osservato nei tuoi fondi lenti reali
   * (25°-75° percentile). NON usato per le zone — solo per pedagogia.
   * Se è significativamente sopra il top della Z2 teorica, l'utente sta
   * probabilmente correndo i fondi lenti troppo veloci (errore amatoriale
   * documentato Stöggl/Sperlich 2014).
   */
  empiricalZ2Hint?: { low: number; high: number };
  /**
   * Suggerimento pedagogico se le corse easy sono in zona più alta di Z2.
   * Es. "Le tue corse easy hanno FC 148-158 — sei nella Z3 teorica.
   * Considera di rallentare per stare in vera Z2 (113-141 bpm)."
   */
  empiricalHintMessage?: string;
  zones: Zone[];
  /** Messaggio user-facing che spiega il metodo + come migliorarlo. */
  methodExplanation: string;
}

// Percentuali FCmax standard 5-zone (Coggan/Friel)
const ZONE_BOUNDS_PCT: Array<{ lo: number; hi: number }> = [
  { lo: 0.50, hi: 0.60 }, // Z1 Recovery
  { lo: 0.60, hi: 0.75 }, // Z2 Easy / Fondo lento (banda larga - versione Seiler sotto LT1)
  { lo: 0.75, hi: 0.85 }, // Z3 Tempo / Marathon pace
  { lo: 0.85, hi: 0.92 }, // Z4 Threshold / Soglia
  { lo: 0.92, hi: 1.00 }, // Z5 VO2max / Intervals
];

const ZONE_META: Array<Pick<Zone, "index" | "name" | "shortLabel" | "description" | "usageHint" | "rpeLow" | "rpeHigh">> = [
  { index: 1, name: "Recovery",          shortLabel: "Z1", description: "Rec attivo, camminata",   usageHint: "Post sessione dura, giorno riposo attivo", rpeLow: 1, rpeHigh: 3 },
  { index: 2, name: "Easy / Fondo Lento", shortLabel: "Z2", description: "Conversazionale",         usageHint: "Volume base (~80% del tempo di corsa)",     rpeLow: 3, rpeHigh: 5 },
  { index: 3, name: "Tempo / Marathon",  shortLabel: "Z3", description: "Controllato, non parli bene", usageHint: "Passo gara 21-42 km",                    rpeLow: 5, rpeHigh: 7 },
  { index: 4, name: "Threshold / Soglia", shortLabel: "Z4", description: "Duro sostenibile",        usageHint: "Ripetute lunghe, passo gara 10 km",        rpeLow: 7, rpeHigh: 8 },
  { index: 5, name: "VO2max / Intervals", shortLabel: "Z5", description: "Molto duro",              usageHint: "Ripetute brevi 400-1000m, massimali",      rpeLow: 8, rpeHigh: 10 },
];

function tanakaFCmax(age: number | undefined | null): number {
  // Guard difensivo: se age mancante o non numerico, usa fallback adulto medio
  // (35 anni → ~184 bpm). NON è ideale ma evita crash su profili incompleti
  // (es. backup importato senza age, o utenti pre-onboarding).
  // Plus: età <18 o >85 → Tanaka extrapolato; clamp per evitare valori assurdi.
  const safeAge = (typeof age === "number" && Number.isFinite(age) && age > 0)
    ? Math.max(10, Math.min(95, age))
    : 35;
  return Math.round(208 - 0.7 * safeAge);
}

/** Karvonen: FC target = HRrest + pct × (FCmax - HRrest). */
function karvonenBand(fcMax: number, fcRest: number, pctLo: number, pctHi: number): { low: number; high: number } {
  const hrr = fcMax - fcRest;
  return {
    low: Math.round(fcRest + pctLo * hrr),
    high: Math.round(fcRest + pctHi * hrr),
  };
}

/** Percentile helper (25°, 75°) su array di numeri. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

interface HistoryWorkout {
  type: string;
  rpe?: number | null;
  fields?: { tipo?: string; fc_media?: number | string; fc_max?: number | string; passo_medio?: string; durata_totale?: number | string; durata?: number | string };
  pain?: Record<string, any>;
}

export interface ComputeZonesInput {
  profile: UserProfile;
  /** FC a riposo mattutina più recente (null se non disponibile). */
  fcRestLatest?: number | null;
  /** Ultimi N workout (tipo corsa/mobilita/altro) per derivazione empirica + FCmax osservata. */
  recentWorkouts?: HistoryWorkout[];
}

export function computeZones(input: ComputeZonesInput): ZonesResult {
  const { profile, fcRestLatest, recentWorkouts = [] } = input;

  // PRIORITÀ FCmax (in ordine di affidabilità scientifica):
  // 1. Test sul campo dichiarato dall'utente (profile.fcMaxTested) — gold standard
  // 2. FCmax osservata nei workout: ma SOLO come informazione visiva, non
  //    sovrascrive la teorica (un singolo battito alto da spike cinturino non
  //    può ridefinire le zone — Mühlen INTERLIVE 2021)
  // 3. Tanaka 208 - 0.7×età — fallback, errore individuale ±10-15 bpm
  const fcMaxTanaka = tanakaFCmax(profile.age);
  const fcMaxCandidates = recentWorkouts
    .map(w => Number(w.fields?.fc_max))
    .filter(n => Number.isFinite(n) && n > 100 && n < 230) as number[];
  const aboveTanakaThreshold = fcMaxCandidates.filter(n => n > fcMaxTanaka + 3);
  /**
   * Valore informativo-only (fix #4): NON usato per calcolo zone.
   * Mostrato nella card zone come riferimento visivo e nel prompt coach come hint.
   * Deliberatamente NON sovrascrive `fcMax` — vedi commenti sopra / JSDoc su ZonesResult.fcMaxObserved.
   */
  const fcMaxObservedRaw = aboveTanakaThreshold.length >= 2 ? Math.max(...aboveTanakaThreshold) : undefined;

  // FCmax usata per le zone:
  // - se l'utente ha fatto un test → usa quella (più affidabile)
  // - altrimenti Tanaka teorica
  const fcMaxFromTest = typeof profile.fcMaxTested === "number" && profile.fcMaxTested >= 100 && profile.fcMaxTested <= 230
    ? profile.fcMaxTested
    : undefined;
  const fcMax = fcMaxFromTest ?? fcMaxTanaka;

  // Estrai corse "easy" dal diario per range empirico (Fondo Lento + RPE ≤ 5 + no dolore alto)
  const easyRuns = recentWorkouts.filter(w => {
    if (w.type !== "corsa") return false;
    const tipo = (w.fields?.tipo || "").toLowerCase();
    if (!tipo.includes("fondo") && !tipo.includes("lento") && !tipo.includes("z2") && !tipo.includes("recupero")) return false;
    const rpe = typeof w.rpe === "number" ? w.rpe : null;
    if (rpe !== null && rpe > 5) return false;
    const fc = Number(w.fields?.fc_media);
    if (!Number.isFinite(fc) || fc < 70 || fc > 200) return false;
    return true;
  });
  const easyFcValues = easyRuns
    .map(w => Number(w.fields?.fc_media))
    .filter((n): n is number => Number.isFinite(n))
    .sort((a, b) => a - b);
  const hasEnoughHistory = easyFcValues.length >= 5;
  const empiricalSampleSize = easyFcValues.length;
  // HINT (non usato per le zone): 25°-75° percentile delle FC medie dei fondi lenti reali.
  // Serve SOLO per pedagogia — se significativamente sopra Z2 teorica, l'utente corre
  // i fondi lenti troppo veloci (errore amatoriale documentato Stöggl/Sperlich 2014).
  let empiricalZ2Hint: { low: number; high: number } | undefined = undefined;
  if (hasEnoughHistory) {
    const p25 = percentile(easyFcValues, 0.25);
    const p75 = percentile(easyFcValues, 0.75);
    empiricalZ2Hint = { low: p25, high: p75 };
  }

  // Passo medio tipico dalle corse easy (per mostrarlo nella card Z2)
  const easyPacesSec: number[] = [];
  for (const w of easyRuns) {
    const passo = w.fields?.passo_medio;
    if (typeof passo !== "string") continue;
    const m = passo.match(/^(\d+):(\d{1,2})/);
    if (m) {
      const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (sec >= 180 && sec <= 900) easyPacesSec.push(sec);
    }
  }
  easyPacesSec.sort((a, b) => a - b);
  const paceMedianZ2 = easyPacesSec.length >= 5
    ? easyPacesSec[Math.floor(easyPacesSec.length / 2)]
    : undefined;

  // Decide metodo principale (in ordine di affidabilità):
  // - "tested": FCmax da test sul campo (gold standard)
  // - "karvonen": HRR con FC riposo + FCmax Tanaka
  // - "tanaka": solo % FCmax Tanaka (fallback)
  let method: ZoneMethod;
  if (fcMaxFromTest) method = "tested";
  else if (fcRestLatest != null && fcRestLatest >= 35 && fcRestLatest <= 100) method = "karvonen";
  else method = "tanaka";

  // Karvonen è applicabile anche con FCmax di test, se abbiamo fcRest valida
  const useKarvonen = typeof fcRestLatest === "number" && fcRestLatest >= 35 && fcRestLatest <= 100;

  // Calcola zone sempre come % FCmax (oppure HRR se Karvonen disponibile).
  // NIENTE "inflation" basata sul range empirico: un range osservato di FC nei
  // fondi lenti troppo veloci NON è evidenza di FCmax più alta, ma di allenamento
  // fuori zona. Gonfiare la FCmax sarebbe un fit matematico, non scientifico.
  const zones: Zone[] = ZONE_META.map((meta, i) => {
    const { lo, hi } = ZONE_BOUNDS_PCT[i];
    let hrLow: number, hrHigh: number;

    if (useKarvonen && fcRestLatest) {
      const band = karvonenBand(fcMax, fcRestLatest, lo, hi);
      hrLow = band.low;
      hrHigh = band.high;
    } else {
      hrLow = Math.round(lo * fcMax);
      hrHigh = Math.round(hi * fcMax);
    }

    return {
      ...meta,
      hrLow, hrHigh,
      paceTypicalSec: meta.index === 2 ? paceMedianZ2 : undefined,
    };
  });

  // Rendi le zone adiacenti contigue (low di Z(n+1) = high di Z(n) + 1)
  // per eliminare micro-gap dovuti all'arrotondamento tra % FCmax.
  for (let i = 1; i < zones.length; i++) {
    if (zones[i].hrLow > zones[i - 1].hrHigh + 1) {
      zones[i].hrLow = zones[i - 1].hrHigh + 1;
    } else if (zones[i].hrLow <= zones[i - 1].hrHigh) {
      zones[i - 1].hrHigh = zones[i].hrLow - 1;
    }
  }

  // Hint pedagogico: se il range empirico delle corse "easy" cade sopra il top
  // della Z2 teorica, suggerisci di rallentare. Questo è l'errore amatoriale
  // classico documentato (Stöggl/Sperlich 2014): fondi lenti corsi in Z3.
  let empiricalHintMessage: string | undefined = undefined;
  if (empiricalZ2Hint) {
    const z2 = zones[1];
    const median = Math.round((empiricalZ2Hint.low + empiricalZ2Hint.high) / 2);
    if (empiricalZ2Hint.low > z2.hrHigh) {
      empiricalHintMessage = `Le tue corse easy hanno FC media ${empiricalZ2Hint.low}-${empiricalZ2Hint.high} bpm — tutte sopra il top Z2 teorica (${z2.hrHigh} bpm). Probabilmente corri i fondi lenti troppo veloci: rallenta per stare nella vera Z2 e beneficiare dell'adattamento aerobico (Stöggl/Sperlich 2014).`;
    } else if (median > z2.hrHigh) {
      empiricalHintMessage = `Le tue corse easy hanno FC media ~${median} bpm, spesso sopra Z2 teorica (${z2.hrLow}-${z2.hrHigh} bpm). Considera di rallentare alcuni fondi per un vero allenamento aerobico di base.`;
    } else if (empiricalZ2Hint.high < z2.hrLow) {
      empiricalHintMessage = `Le tue corse easy hanno FC media ${empiricalZ2Hint.low}-${empiricalZ2Hint.high} bpm — sotto Z2 teorica (${z2.hrLow}-${z2.hrHigh} bpm). Se possibile, considera un test FCmax: la formula Tanaka potrebbe sovrastimare il tuo valore reale.`;
    }
  }

  // Spiegazione user-facing del metodo
  let methodExplanation: string;
  if (method === "tested") {
    methodExplanation = `Zone calcolate dalla tua FCmax testata sul campo (${fcMax} bpm${profile.fcMaxTestedAt ? `, test del ${profile.fcMaxTestedAt}` : ""})${useKarvonen ? ` + Karvonen con FC riposo ${fcRestLatest} bpm` : ""}. Metodo più affidabile: nessuna formula, solo il tuo dato reale. Ripeti il test ogni 6 mesi o dopo cambi significativi di forma.`;
  } else if (method === "karvonen") {
    methodExplanation = `Metodo Karvonen con FC a riposo mattutina (${fcRestLatest} bpm) + FCmax Tanaka (${fcMaxTanaka} bpm, errore individuale ±10-15 bpm — Tanaka 2001). Per precisione massima, fai il test FCmax sul campo e inseriscilo nel profilo.`;
  } else {
    methodExplanation = `Stima generica con formula Tanaka (208 - 0.7×età = ${fcMaxTanaka} bpm, errore ±10-15 bpm). Per migliorare: (1) registra la FC a riposo al check mattutino → abilita Karvonen; (2) fai il test FCmax sul campo e salvalo nel profilo.`;
  }

  return {
    method, fcMax, fcMaxObserved: fcMaxObservedRaw, fcRest: fcRestLatest ?? undefined,
    empiricalSampleSize, empiricalZ2Hint, empiricalHintMessage,
    zones, methodExplanation,
  };
}

// --- Analytics: tempo per zona dai workout di corsa ---

export interface TimeInZone {
  zoneIndex: ZoneIndex;
  minutes: number;
  sessionCount: number;
}

/**
 * Calcola il tempo totale per zona dalle corse dell'intervallo.
 * Bucketing semplice: ogni workout di corsa con fc_media nota è assegnato
 * a UNA zona (quella che contiene la sua fc_media). La durata totale
 * conta come tempo in zona.
 *
 * Limite noto: una corsa reale ha oscillazioni FC. Senza sample HR
 * granulari (che il diario non registra), questa è la miglior stima.
 */
export function timeInZones(workouts: HistoryWorkout[], zones: Zone[]): TimeInZone[] {
  const buckets: Record<ZoneIndex, { minutes: number; count: number }> = {
    1: { minutes: 0, count: 0 }, 2: { minutes: 0, count: 0 }, 3: { minutes: 0, count: 0 },
    4: { minutes: 0, count: 0 }, 5: { minutes: 0, count: 0 },
  };
  for (const w of workouts) {
    if (w.type !== "corsa") continue;
    const fc = Number(w.fields?.fc_media);
    const dur = Number(w.fields?.durata_totale ?? w.fields?.durata);
    if (!Number.isFinite(fc) || !Number.isFinite(dur) || dur <= 0) continue;
    // Trova la zona che contiene fc
    let zoneIdx: ZoneIndex | null = null;
    for (const z of zones) {
      if (fc >= z.hrLow && fc <= z.hrHigh) { zoneIdx = z.index; break; }
    }
    // Se fuori (sotto Z1 o sopra Z5), assegna ai bordi
    if (zoneIdx === null) {
      if (fc < zones[0].hrLow) zoneIdx = 1;
      else zoneIdx = 5;
    }
    buckets[zoneIdx].minutes += dur;
    buckets[zoneIdx].count += 1;
  }
  return ([1, 2, 3, 4, 5] as ZoneIndex[]).map(i => ({
    zoneIndex: i,
    minutes: buckets[i].minutes,
    sessionCount: buckets[i].count,
  }));
}

/** Livello di esperienza per calibrare la soglia di "polarizzazione" (fix #6). */
export type PolarizationExperienceLevel = "neofita" | "amatore" | "competitivo";

/**
 * Soglie di % tempo in bassa intensità (Z1+Z2) per considerare "polarizzato"
 * il training. Calibrate per livello:
 *   - neofita: 50% — obiettivo realistico per chi inizia, evita demoralizzazione.
 *   - amatore: 65% — target pratico documentato in letteratura non-élite.
 *   - competitivo: 75% — principio Seiler per atleti strutturati
 *     (gli 80% di Seiler 2010 sono élite e inapplicabili al pubblico generale).
 */
const POLARIZATION_LOW_PCT_BY_LEVEL: Record<PolarizationExperienceLevel, number> = {
  neofita: 50,
  amatore: 65,
  competitivo: 75,
};

/**
 * Distribuzione polarizzata (Seiler-adapted): % tempo in Z1+Z2 vs. Z3+Z4+Z5.
 * @param timeInZone output di timeInZones()
 * @param experienceLevel soglia tarata sul livello utente (default "amatore" = 65%).
 *   Firma retrocompatibile: chiamate senza secondo arg restano valide.
 */
export function polarizationCheck(
  timeInZone: TimeInZone[],
  experienceLevel: PolarizationExperienceLevel = "amatore",
): { lowPct: number; highPct: number; isPolarized: boolean; thresholdPct: number } {
  const total = timeInZone.reduce((a, z) => a + z.minutes, 0) || 1;
  const low = timeInZone.filter(z => z.zoneIndex <= 2).reduce((a, z) => a + z.minutes, 0);
  const high = timeInZone.filter(z => z.zoneIndex >= 3).reduce((a, z) => a + z.minutes, 0);
  const lowPct = Math.round((low / total) * 100);
  const highPct = Math.round((high / total) * 100);
  const thresholdPct = POLARIZATION_LOW_PCT_BY_LEVEL[experienceLevel];
  return { lowPct, highPct, isPolarized: lowPct >= thresholdPct, thresholdPct };
}

/**
 * Mappa il campo `profile.experience` (sedentary/occasional/regular/competitive)
 * alla classificazione polarizzazione (neofita/amatore/competitivo).
 *   - sedentary / occasional → neofita
 *   - regular → amatore
 *   - competitive → competitivo
 */
export function mapExperienceToPolarizationLevel(
  experience: "sedentary" | "occasional" | "regular" | "competitive" | string | undefined,
): PolarizationExperienceLevel {
  if (experience === "competitive") return "competitivo";
  if (experience === "regular") return "amatore";
  if (experience === "sedentary" || experience === "occasional") return "neofita";
  return "amatore";
}

/** Formatta passo da secondi a "M:SS/km". */
export function formatPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/**
 * Helper one-shot per i prompt coach: dato il recentDaysRaw e il profile,
 * calcola ZonesResult + TimeInZone + polarization check. Unica dipendenza,
 * evita duplicazione di logica di estrazione morningHR / flattening workouts.
 */
export function computeZonesContext(
  profile: UserProfile | null,
  recentDaysRaw: Array<{ date: string; daily: any; workouts: any[] }>,
): {
  zones: ZonesResult | null;
  timeInZone: TimeInZone[];
  polar: { lowPct: number; highPct: number; isPolarized: boolean };
  totalSessions: number;
} | null {
  if (!profile) return null;
  const allWorkouts: any[] = [];
  let latestMorningHR: number | null = null;
  for (const d of [...recentDaysRaw].sort((a, b) => b.date.localeCompare(a.date))) {
    allWorkouts.push(...(d.workouts || []));
    if (latestMorningHR === null && typeof d.daily?.morningHR === "string" && d.daily.morningHR) {
      const n = Number(d.daily.morningHR);
      if (Number.isFinite(n) && n >= 35 && n <= 100) latestMorningHR = n;
    }
  }
  const zones = computeZones({ profile, fcRestLatest: latestMorningHR, recentWorkouts: allWorkouts });
  const timeInZone = timeInZones(allWorkouts, zones.zones);
  const polar = polarizationCheck(timeInZone, mapExperienceToPolarizationLevel(profile.experience));
  const totalSessions = timeInZone.reduce((a, z) => a + z.sessionCount, 0);
  return { zones, timeInZone, polar, totalSessions };
}

// --- Inference e pulizia per piani legacy senza campo `zone` esplicito ---

/**
 * Inferisce la zona FC target (1-5) da subtype / details di una sessione
 * pianificata. Usato SOLO come fallback per piani generati prima che il campo
 * `zone` venisse aggiunto a PlannedSession. Ritorna null per sessioni non
 * cardio o quando non c'è segnale chiaro.
 *
 * Match in ordine di specificità: prima token espliciti "Z1".."Z5" nei
 * details, poi mappature semantiche del subtype.
 */
export function inferSessionZone(
  type: string,
  subtype: string | undefined,
  details: string | undefined,
): ZoneIndex | null {
  if (type !== "corsa" && type !== "sport") return null;
  const text = `${subtype || ""} ${details || ""}`.toLowerCase();

  // Token espliciti Z1..Z5 (priorità massima)
  const zMatch = text.match(/\bz([1-5])\b/);
  if (zMatch) return Number(zMatch[1]) as ZoneIndex;

  // Mappature semantiche (subtype ha più peso, ma controlliamo tutto il testo)
  if (/\brecover|recupero|recover/i.test(text)) return 1;
  if (/\bvo2|scatt|sprint|ripetute brev|intervall.{0,10}brev|400\s*m|800\s*m/i.test(text)) return 5;
  if (/\bsogli|threshold|tempo run|ripetute lungh|1000\s*m|1k/i.test(text)) return 4;
  if (/\btempo\b|marathon|pace gara|gara 21|gara 42/i.test(text)) return 3;
  if (/\blento|easy|fondo|conversazional|z2|base aerobica/i.test(text)) return 2;
  if (/\bprogressiv/i.test(text)) return 3; // finale in Z3
  // Fallback conservativo (fix #5): se il testo menziona "ripetute" o "intervalli" senza
  // qualificativo (brev/lungh/400m/...), non possiamo distinguere Z4 (threshold) da Z5
  // (VO2max). Scegliamo Z4 perché:
  //   - è la default più frequente nella pratica amatoriale (ripetute in soglia),
  //   - è meno aggressivo: un errore verso il basso è più sicuro di uno verso l'alto,
  //   - VO2max massimale richiede solitamente qualificativi espliciti nel piano.
  if (/\bripetute\b|\bintervall[oi]?\b/i.test(text)) return 4;
  return null;
}

/**
 * Rimuove dai details "inline" range bpm numerici (es. "Z2 (152-154 bpm)"
 * → "Z2", oppure "150-160 bpm" → ""). Serve per:
 * (a) pulire la visualizzazione quando il chip zona mostra il range corretto,
 * (b) evitare che l'LLM riscriva range stale copiandoli dal piano corrente.
 */
export function stripInlineHRRange(text: string | undefined): string {
  if (!text) return "";
  return text
    // "(152-154 bpm)" o "(152-154)"
    .replace(/\s*\(\s*\d{2,3}\s*[-–]\s*\d{2,3}(?:\s*bpm)?\s*\)/gi, "")
    // "152-154 bpm" / "152–154 bpm" standalone
    .replace(/\s*\d{2,3}\s*[-–]\s*\d{2,3}\s*bpm/gi, "")
    // pulizia spazi doppi / virgole orfane lasciate
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}
