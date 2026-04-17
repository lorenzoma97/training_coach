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
export type ZoneMethod = "tanaka" | "karvonen" | "empirical";

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
  /** Se disponibile, FC max mai osservata nei workout. */
  fcMaxObserved?: number;
  /** FC a riposo usata (Karvonen) se metodo = karvonen. */
  fcRest?: number;
  /** Numero di workout "easy" usati per derivazione empirica (0 se non usata). */
  empiricalSampleSize: number;
  /** Se empirica, range osservato 25°-75° pct di fc_media. */
  empiricalZ2Range?: { low: number; high: number };
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

function tanakaFCmax(age: number): number {
  return Math.round(208 - 0.7 * age);
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

  // FCmax: Tanaka teorica, sovrascritta da FCmax osservata solo se più osservazioni
  // la confermano (protegge da spike cinturino isolati). Richiediamo ≥2 workout
  // con fc_max > Tanaka + 3 bpm per adottare la nuova stima, e usiamo come riferimento
  // il MASSIMO tra quelle osservazioni (non il percentile, per non perdere un PR legittimo).
  const fcMaxTanaka = tanakaFCmax(profile.age);
  const fcMaxCandidates = recentWorkouts
    .map(w => Number(w.fields?.fc_max))
    .filter(n => Number.isFinite(n) && n > 100 && n < 230) as number[];
  const aboveTanakaThreshold = fcMaxCandidates.filter(n => n > fcMaxTanaka + 3);
  const confirmedObserved = aboveTanakaThreshold.length >= 2 ? Math.max(...aboveTanakaThreshold) : undefined;
  // Separiamo per trasparenza UI: mostriamo "osservata" solo se confermata (>1 volta sopra Tanaka+3)
  const fcMaxObserved = confirmedObserved;
  let fcMax = fcMaxObserved ?? fcMaxTanaka;

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
  // Calcola 25°-75° percentile e assicura larghezza minima 10 bpm (altrimenti
  // con pochi dati molto tight si hanno range come 152-154 che creano sovrapposizioni
  // con le altre zone). Se più stretto di 10, allarghiamo centrando sulla mediana.
  let empiricalZ2Range: { low: number; high: number } | undefined = undefined;
  if (hasEnoughHistory) {
    const p25 = percentile(easyFcValues, 0.25);
    const p75 = percentile(easyFcValues, 0.75);
    const MIN_WIDTH = 10;
    if (p75 - p25 < MIN_WIDTH) {
      const center = Math.round((p25 + p75) / 2);
      const half = Math.round(MIN_WIDTH / 2);
      empiricalZ2Range = { low: center - half, high: center + half };
    } else {
      empiricalZ2Range = { low: p25, high: p75 };
    }
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

  // Decide metodo principale
  let method: ZoneMethod;
  if (hasEnoughHistory) method = "empirical";
  else if (fcRestLatest != null && fcRestLatest >= 35 && fcRestLatest <= 100) method = "karvonen";
  else method = "tanaka";

  // Costruisci le 5 zone secondo il metodo scelto.
  // Se FCrest è disponibile, usiamo Karvonen (HRR) per TUTTE le zone, anche in
  // modalità empirical — empirica sovrascrive solo Z2 con il range osservato.
  // Questo evita di perdere la personalizzazione Karvonen quando salta in empirical.
  const useKarvonen = (method === "karvonen" || method === "empirical") && typeof fcRestLatest === "number" && fcRestLatest >= 35 && fcRestLatest <= 100;

  // Quando è attivo il metodo EMPIRICAL, usiamo il top della Z2 empirica
  // come proxy di LT1 (soglia aerobica). Nel modello Coggan/Friel standard,
  // Z2 top ≈ 75% FCmax. Quindi FCmax_effettiva ≈ Z2_empirica.top / 0.75.
  // Questo respecta la scienza: se i tuoi fondi lenti reali hanno FC alta,
  // la tua FCmax è probabilmente > Tanaka (errore individuale ±10-15 bpm).
  // Tutte le zone vengono poi ricalcolate come % di questa FCmax effettiva,
  // rendendo il ladder contiguo per costruzione con larghezze realistiche.
  let effectiveFCmax = fcMax;
  if (method === "empirical" && empiricalZ2Range) {
    const impliedFCmax = Math.round(empiricalZ2Range.high / 0.75);
    // Usa l'implicita solo se > Tanaka (user più fit del predetto)
    // Safety cap: 220 bpm (limite fisiologico realistico per maggior parte adulti)
    const SAFETY_CAP = 220;
    if (impliedFCmax > fcMax && impliedFCmax <= SAFETY_CAP) {
      effectiveFCmax = impliedFCmax;
    }
  }

  // Calcola zone come contigue (% di effectiveFCmax per Tanaka, oppure Karvonen)
  const zones: Zone[] = ZONE_META.map((meta, i) => {
    const { lo, hi } = ZONE_BOUNDS_PCT[i];
    let hrLow: number, hrHigh: number;

    if (useKarvonen && fcRestLatest) {
      const band = karvonenBand(effectiveFCmax, fcRestLatest, lo, hi);
      hrLow = band.low;
      hrHigh = band.high;
    } else {
      hrLow = Math.round(lo * effectiveFCmax);
      hrHigh = Math.round(hi * effectiveFCmax);
    }

    return {
      ...meta,
      hrLow, hrHigh,
      paceTypicalSec: meta.index === 2 ? paceMedianZ2 : undefined,
    };
  });

  // Rendi le zone adjacente contigue (low di Z(n+1) = high di Z(n) + 1)
  // per eliminare micro-gap dovuti all'arrotondamento tra % FCmax.
  for (let i = 1; i < zones.length; i++) {
    if (zones[i].hrLow > zones[i - 1].hrHigh + 1) {
      zones[i].hrLow = zones[i - 1].hrHigh + 1;
    } else if (zones[i].hrLow <= zones[i - 1].hrHigh) {
      zones[i - 1].hrHigh = zones[i].hrLow - 1;
    }
  }

  // Aggiorna fcMax visualizzato se è stata usata l'implicita
  if (effectiveFCmax !== fcMax) {
    // Persiste la scelta nella UI tramite il campo fcMax
    fcMax = effectiveFCmax;
  }

  // Spiegazione user-facing del metodo
  let methodExplanation: string;
  if (method === "empirical") {
    const wasAdjusted = effectiveFCmax !== (fcMaxObserved ?? fcMaxTanaka);
    if (wasAdjusted) {
      methodExplanation = `Z2 empirica da ${empiricalSampleSize} fondi lenti reali (${empiricalZ2Range?.low}-${empiricalZ2Range?.high} bpm). Il top Z2 suggerisce FCmax effettiva ~${effectiveFCmax} bpm (più alta della stima Tanaka ${fcMaxTanaka}) — coerente con errore individuale ±10-15 bpm documentato (Tanaka 2001). Tutte le zone sono ricalcolate come % della FCmax effettiva per un ladder contiguo scientificamente coerente (modello Coggan/Friel 5-zone).`;
    } else {
      methodExplanation = `Z2 empirica da ${empiricalSampleSize} fondi lenti reali. Altre zone calcolate come % FCmax (${effectiveFCmax} bpm).`;
    }
  } else if (method === "karvonen") {
    methodExplanation = `Metodo Karvonen con la tua FC a riposo mattutina (${fcRestLatest} bpm) + FCmax ${fcMaxObserved ? `osservata ${fcMaxObserved}` : `Tanaka ${fcMaxTanaka}`}. Registra 5+ fondi lenti e scatterà il calcolo empirico dalle tue corse reali.`;
  } else {
    methodExplanation = `Stima generica (formula Tanaka 208 - 0.7×età = ${fcMaxTanaka} bpm, errore ±10 bpm). Aggiungi la FC a riposo al check mattutino per migliorare con Karvonen, e registra 5+ fondi lenti per il calcolo empirico.`;
  }

  return {
    method, fcMax, fcMaxObserved, fcRest: fcRestLatest ?? undefined,
    empiricalSampleSize, empiricalZ2Range,
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

/**
 * Distribuzione polarizzata 80/20 (Seiler): % tempo in Z1+Z2 vs. Z3+Z4+Z5.
 * Atleti d'élite stanno ~80% in bassa intensità.
 */
export function polarizationCheck(timeInZone: TimeInZone[]): { lowPct: number; highPct: number; isPolarized: boolean } {
  const total = timeInZone.reduce((a, z) => a + z.minutes, 0) || 1;
  const low = timeInZone.filter(z => z.zoneIndex <= 2).reduce((a, z) => a + z.minutes, 0);
  const high = timeInZone.filter(z => z.zoneIndex >= 3).reduce((a, z) => a + z.minutes, 0);
  const lowPct = Math.round((low / total) * 100);
  const highPct = Math.round((high / total) * 100);
  return { lowPct, highPct, isPolarized: lowPct >= 75 };
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
  const polar = polarizationCheck(timeInZone);
  const totalSessions = timeInZone.reduce((a, z) => a + z.sessionCount, 0);
  return { zones, timeInZone, polar, totalSessions };
}
