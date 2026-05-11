// Wave 3.3 — Macrocycle Planner deterministico (schema-specialist).
//
// Calcola un MacroCycle race-driven a partire da un RaceEvent e dalla data
// odierna. Tutte le funzioni qui sono PURE (no I/O, no LLM, no storage):
// stesso input → stesso output. Il side-effect di salvataggio è isolato in
// `macroLifecycle.ts`.
//
// Riferimenti scientifici:
//  - Bompa T. "Periodization: Theory and Methodology of Training" (1999)
//    → modello classico 3-fasi (base / build / peak) + taper pre-gara.
//  - Issurin V. "Block periodization: breakthrough in sport training" (2008)
//    → blocchi mesociclo concentrati su 1-2 obiettivi alla volta.
//  - Mujika I. & Padilla S. "Scientific bases for precompetition tapering
//    strategies" Med Sci Sports Exerc 2003 → 2-3 settimane taper, riduzione
//    volume 41-60%, mantenimento intensità (preserva qualità neuromuscolare).
//  - Seiler S. "What is best practice for training intensity and duration
//    distribution in endurance athletes?" Int J Sports Physiol Perform 2010
//    → polarizzazione 80/20 in base, shift verso 60/40 in build/peak.
//
// I3 (ARCHITECTURE.md §6): aggiungere/rimuovere una race rigenera il
// MacroCycle ma NON il piano corrente. La staleness è marcata via
// `markPlanStaleIfMacroChanged` in macroLifecycle.

import type { RaceEvent, MacroCycle, MesoCycle, MacroPhase } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Costanti calibrate (Bompa/Mujika/Seiler)
// ─────────────────────────────────────────────────────────────────────────────

/** Lunghezza minima di un macro pieno: sotto, ha senso solo un mini-taper. */
const MIN_MACRO_WEEKS = 2;
/** Cap minimo "macro completo": sotto questo si comprime tutto a taper. */
const FULL_MACRO_MIN_WEEKS = 8;
/** Cap massimo macro: oltre, il principio di overload diventa instabile. */
const MAX_MACRO_WEEKS = 24;

/** Distanza minima dalla race per giustificare un macro: sotto = race troppo vicina. */
const MIN_DAYS_TO_RACE = 14;

/** Volume multiplier per fase (relativo alla baseline weekly volume utente). */
const VOLUME_BY_PHASE: Record<MacroPhase, number> = {
  base: 1.0,
  build: 1.2,
  peak: 0.9,
  // Taper: useremo una rampa progressiva (vedi volumeMultiplierForPhase).
  // Questo valore "0.6" è il punto medio della rampa 0.7 → 0.5.
  taper: 0.6,
  transition: 0.5,
};

/** Deload ogni 4 settimane di build (overreach controllato). */
const DELOAD_VOLUME_MULTIPLIER = 0.6;
const DELOAD_EVERY_N_BUILD_WEEKS = 4;

/** % sessioni Z3+ per fase (modello polarizzato Seiler). */
const INTENSITY_HIGH_BY_PHASE: Record<MacroPhase, number> = {
  base: 12,    // ~10-15% (polarizzato 80/20)
  build: 22,   // ~20-25%
  peak: 32,    // ~30-35% (race-pace work)
  taper: 20,   // mantieni stimolo, riduci volume
  transition: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: date math (puro, no Date mutation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Differenza in giorni tra due date (b - a). Usa UTC per evitare drift DST.
 * Ritorna intero (floor della differenza in millisecondi).
 */
function daysBetween(a: Date, b: Date): number {
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((bUTC - aUTC) / (24 * 60 * 60 * 1000));
}

/** Parsea YYYY-MM-DD in Date (mezzanotte UTC). Throws se formato invalido. */
function parseISODate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`parseISODate: formato non valido "${s}", atteso YYYY-MM-DD`);
  }
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format Date → YYYY-MM-DD (UTC). */
function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aggiunge `days` giorni (UTC). Non muta l'input. */
function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/**
 * Trova il lunedì della settimana che contiene `d` (UTC). Standard ISO 8601:
 * la settimana inizia il lunedì. Domenica = 7, Lunedì = 1, ecc.
 */
function startOfWeekMonday(d: Date): Date {
  const dow = d.getUTCDay(); // 0=dom, 1=lun, ..., 6=sab
  // Quanti giorni indietro arrivare a lunedì? lun=0, dom=6.
  const offset = dow === 0 ? 6 : dow - 1;
  return addDays(d, -offset);
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribuzione fasi: tabella deterministica per durata macro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribuzione settimane base/build/peak/taper per ogni lunghezza macro
 * supportata (2..24). Mantenere la tabella esplicita evita bug da arrotondamento
 * "off-by-one" in funzioni proporzionali. Le settimane si sommano = totalWeeks.
 *
 * Razionali per lunghezza:
 *  - 2-3 sett: solo taper (race troppo vicina per mesociclo completo).
 *  - 4-7 sett: micro-macro = peak + taper (no base/build).
 *  - 8-11 sett: 3-fasi compresso (~50% base, ~25% build, ~12% peak, ~13% taper).
 *  - 12-15 sett: standard 3-fasi + taper (Bompa classico).
 *  - 16-19 sett: base più ampia (preparation generale).
 *  - 20-24 sett: macro lungo (Olympic prep style: ~50% base, ~30% build, ~10% peak, ~10% taper).
 */
function phaseDistribution(totalWeeks: number): {
  base: number;
  build: number;
  peak: number;
  taper: number;
} {
  if (totalWeeks <= 3) return { base: 0, build: 0, peak: 0, taper: totalWeeks };
  if (totalWeeks <= 7) {
    // peak 1-2 sett + taper 2-3 sett. taper sempre >= 2.
    const taper = Math.min(3, totalWeeks - 1);
    const peak = totalWeeks - taper;
    return { base: 0, build: 0, peak, taper };
  }
  if (totalWeeks <= 11) {
    // Compresso 3-fasi. Taper 2 sett, peak 1-2 sett, build ~25%, resto base.
    const taper = 2;
    const peak = totalWeeks <= 9 ? 1 : 2;
    const build = Math.max(2, Math.round((totalWeeks - taper - peak) * 0.4));
    const base = totalWeeks - taper - peak - build;
    return { base, build, peak, taper };
  }
  if (totalWeeks <= 15) {
    // Standard Bompa: ~33% base, ~33% build, ~16% peak, ~16% taper.
    // Esempio 12 sett: 4-4-2-2; 14 sett: 5-5-2-2; 15 sett: 6-5-2-2.
    const taper = 2;
    const peak = totalWeeks >= 14 ? 2 : 2;
    const remaining = totalWeeks - taper - peak;
    const build = Math.floor(remaining / 2);
    const base = remaining - build;
    return { base, build, peak, taper };
  }
  if (totalWeeks <= 19) {
    // Base più ampia. Esempio 16 sett: 6-5-2-3; 18 sett: 7-6-2-3.
    const taper = 3;
    const peak = 2;
    const remaining = totalWeeks - taper - peak;
    const build = Math.floor(remaining * 0.45);
    const base = remaining - build;
    return { base, build, peak, taper };
  }
  // 20-24 sett: macro lungo Olympic-style. ~50/30/10/10.
  // Esempio 20 sett: 10-6-2-2; 24 sett: 12-7-2-3.
  const taper = totalWeeks >= 22 ? 3 : 2;
  const peak = totalWeeks >= 22 ? 3 : 2;
  const remaining = totalWeeks - taper - peak;
  const build = Math.round(remaining * 0.38);
  const base = remaining - build;
  return { base, build, peak, taper };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pubbliche
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcola la fase del macrociclo per una settimana data.
 *
 * Logica deterministica:
 *  - Se weekNumber > totalWeeks → "transition" (post-race recovery, NON
 *    inclusa nelle phases del MacroCycle ma utile per query future).
 *  - Altrimenti applica `phaseDistribution(totalWeeks)` in ordine
 *    base → build → peak → taper.
 *
 * @param weekNumber 1-based, 1..N
 * @param totalWeeks lunghezza totale macro (2..24)
 */
export function computePhaseForWeek(weekNumber: number, totalWeeks: number): MacroPhase {
  if (weekNumber < 1) return "base";
  if (weekNumber > totalWeeks) return "transition";
  const dist = phaseDistribution(totalWeeks);
  const baseEnd = dist.base;                          // weeks 1..baseEnd
  const buildEnd = baseEnd + dist.build;              // baseEnd+1..buildEnd
  const peakEnd = buildEnd + dist.peak;               // buildEnd+1..peakEnd
  // taperEnd = peakEnd + dist.taper === totalWeeks
  if (weekNumber <= baseEnd) return "base";
  if (weekNumber <= buildEnd) return "build";
  if (weekNumber <= peakEnd) return "peak";
  return "taper";
}

/**
 * Volume multiplier per la settimana data. Per le settimane "build" applica
 * automaticamente il deload ogni `DELOAD_EVERY_N_BUILD_WEEKS` settimane di
 * build consecutive (overreach controllato Bompa).
 *
 * Per il taper applica una rampa decrescente: prima sett taper = 0.7,
 * ultima sett (race week) = 0.5. Mujika 2003: -41% to -60% volume.
 */
export function volumeMultiplierForPhase(phase: MacroPhase, weekNumber: number): number {
  if (phase !== "build" && phase !== "taper") {
    return VOLUME_BY_PHASE[phase];
  }
  if (phase === "build") {
    // Deload ogni N settimane di build. weekNumber è 1-based dall'inizio macro,
    // ma il "ciclo deload" è relativo: ogni 4 build-weeks consecutive scarico
    // la 4ª. Approssimazione: usa weekNumber % N === 0 per identificare deload.
    if (weekNumber > 0 && weekNumber % DELOAD_EVERY_N_BUILD_WEEKS === 0) {
      return DELOAD_VOLUME_MULTIPLIER;
    }
    return VOLUME_BY_PHASE.build;
  }
  // Taper: rampa lineare 0.7 → 0.5 (vedi volumeForTaperWeek inline)
  // Senza conoscere la posizione nel taper, ritorniamo il punto medio 0.6.
  // Per la rampa precisa serve `volumeForTaperWeek`, usata da buildMacroCycle.
  return VOLUME_BY_PHASE.taper;
}

/**
 * Volume multiplier specifico per una settimana di taper, data la sua posizione
 * nel taper (1-based). Rampa lineare 0.7 → 0.5.
 *  - taper 2 sett: 0.7, 0.5
 *  - taper 3 sett: 0.7, 0.6, 0.5
 */
function volumeForTaperWeek(taperWeekNumber: number, taperTotal: number): number {
  if (taperTotal <= 1) return 0.5;
  // Mappatura lineare: pos 1 → 0.7, pos taperTotal → 0.5.
  const start = 0.7;
  const end = 0.5;
  const t = (taperWeekNumber - 1) / (taperTotal - 1);
  const v = start + (end - start) * t;
  return Math.round(v * 100) / 100; // arrotonda a 2 decimali
}

/**
 * Intensità target (% sessioni cardio in Z3+) per fase.
 */
export function intensityHighPctForPhase(phase: MacroPhase): number {
  return INTENSITY_HIGH_BY_PHASE[phase];
}

/**
 * Focus testuale per fase (italiano leggibile). Iniettato in UI badge e nel
 * prompt LLM Pass-1 per tarare il focus settimanale.
 */
export function focusForPhase(phase: MacroPhase, sport: RaceEvent["sport"]): string {
  switch (phase) {
    case "base":
      if (sport === "corsa" || sport === "trail") return "base aerobica (Z2 prevalente)";
      if (sport === "triathlon") return "base aerobica multi-disciplina";
      if (sport === "sport") return "condizionamento generale + tecnica";
      return "base aerobica";
    case "build":
      if (sport === "corsa") return "soglia + ripetute medie";
      if (sport === "trail") return "soglia + uphill repeats";
      if (sport === "triathlon") return "qualità nelle 3 discipline";
      if (sport === "sport") return "potenza specifica + intermittente";
      return "qualità (soglia/ripetute)";
    case "peak":
      if (sport === "corsa" || sport === "trail") return "race pace + VO2max";
      if (sport === "triathlon") return "brick + race-specific";
      if (sport === "sport") return "intensità di gara + sprint";
      return "race-pace specifico";
    case "taper":
      return "scarico pre-gara (volume ridotto, intensità mantenuta)";
    case "transition":
      return "recovery attivo post-gara";
  }
}

/**
 * Calcola il numero ottimale di settimane di macro tra oggi e race date.
 * Cap: min 2 (mini-taper), max 24. Race tra <14gg → ritorna giorni/7
 * (mini-macro solo taper).
 *
 * Logica:
 *  - giorni dalla settimana corrente (lunedì) alla settimana della race.
 *  - Se race è entro 14gg: 1-2 settimane di taper.
 *  - Tra 14gg e 24 settimane: usa il numero di settimane disponibili.
 *  - Oltre 24 sett: cap a 24 (start del macro più tardi).
 */
export function computeMacroLengthWeeks(today: Date, raceDate: Date): number {
  const days = daysBetween(today, raceDate);
  if (days < 0) return 0; // race nel passato
  const weeks = Math.ceil(days / 7);
  if (weeks < MIN_MACRO_WEEKS) return Math.max(1, weeks);
  if (weeks > MAX_MACRO_WEEKS) return MAX_MACRO_WEEKS;
  return weeks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash deterministico (drift detection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hash deterministico semplice (FNV-1a 32-bit) → hex. Non crittografico,
 * scopo: drift detection. Stesso input → stesso output cross-platform.
 * Evitiamo dipendenze esterne (crypto.subtle è async, qui vogliamo sync).
 */
function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to unsigned 32-bit hex
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash inputs del MacroCycle. Componenti: raceId + raceDate + sport +
 * targetTimeSec + startDate. Cambiamento di uno qualunque → hash diverso →
 * macro deve essere rigenerato.
 */
export function macroInputHash(race: RaceEvent, startDate: string): string {
  const parts = [
    race.id,
    race.date,
    race.sport,
    race.targetTimeSec != null ? String(race.targetTimeSec) : "_",
    startDate,
  ];
  return fnv1a32(parts.join("|"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Build MacroCycle (composizione delle pure functions sopra)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ID generator per MacroCycle. UUID-like ma deterministico dall'input
 * (così la stessa race+startDate produce sempre lo stesso id, evitando
 * orfani in storage al re-compute).
 */
function makeMacroCycleId(race: RaceEvent, startDate: string): string {
  return `mc-${race.id}-${startDate}-${macroInputHash(race, startDate).slice(0, 6)}`;
}

/**
 * Costruisce un MacroCycle completo dato race + today.
 *
 * Ritorna `null` se:
 *  - race nel passato (race.date < today)
 *  - race troppo vicina (< MIN_DAYS_TO_RACE = 14gg)
 *
 * Lo `startDate` del macro è il LUNEDÌ della settimana corrente. La race è
 * `endDate`. Le phases coprono esattamente totalWeeks settimane.
 */
export function buildMacroCycle(race: RaceEvent, today?: Date): MacroCycle | null {
  if (!race || !race.date) return null;
  const now = today ?? new Date();
  let raceDate: Date;
  try {
    raceDate = parseISODate(race.date);
  } catch {
    return null;
  }
  const days = daysBetween(now, raceDate);
  if (days < MIN_DAYS_TO_RACE) return null;

  const startDate = startOfWeekMonday(now);
  const startISO = toISODate(startDate);
  const totalWeeks = computeMacroLengthWeeks(startDate, raceDate);
  if (totalWeeks < MIN_MACRO_WEEKS) return null;

  const dist = phaseDistribution(totalWeeks);
  const phases: MesoCycle[] = [];

  // Compute taper-relative position for ramp.
  const taperStartWeek = totalWeeks - dist.taper + 1;

  for (let w = 1; w <= totalWeeks; w++) {
    const phase = computePhaseForWeek(w, totalWeeks);
    let volMul: number;
    if (phase === "taper") {
      const taperPos = w - taperStartWeek + 1; // 1..dist.taper
      volMul = volumeForTaperWeek(taperPos, dist.taper);
    } else {
      volMul = volumeMultiplierForPhase(phase, w);
    }
    phases.push({
      weekNumber: w,
      phase,
      volumeMultiplier: volMul,
      intensityHighPct: intensityHighPctForPhase(phase),
      focus: focusForPhase(phase, race.sport),
    });
  }

  const id = makeMacroCycleId(race, startISO);
  return {
    id,
    raceId: race.id,
    startDate: startISO,
    endDate: race.date,
    phases,
    inputHash: macroInputHash(race, startISO),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Race selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina la race "A" più vicina nel futuro. Solo race priority="A"
 * generano un MacroCycle (Q3 risolta in ARCHITECTURE: macro è opt-in via
 * race.priority="A").
 *
 * - Race nel passato vengono escluse.
 * - Tra le candidate, quella con `date` più vicina vince.
 * - Tie-breaker (stessa data): `createdAt` più recente.
 */
export function selectActiveRace(races: RaceEvent[], today?: Date): RaceEvent | null {
  if (!Array.isArray(races) || races.length === 0) return null;
  const now = today ?? new Date();
  const nowISO = toISODate(now);

  const candidates = races
    .filter(r => r && r.priority === "A" && typeof r.date === "string" && r.date >= nowISO);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // Tie-breaker: createdAt più recente vince.
    const ca = a.createdAt ?? "";
    const cb = b.createdAt ?? "";
    return ca < cb ? 1 : ca > cb ? -1 : 0;
  });

  return candidates[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper UI / Pass-1 prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trova la fase corrente (week + phase) data una macrociclo e la data di oggi.
 * Utile per UI badge ("Settimana 6/12 — fase: build") e per iniettare il
 * contesto nel prompt LLM Pass-1.
 *
 * Ritorna `null` se oggi è fuori dal range del macro (prima dello start o
 * dopo la race).
 */
export function currentMacroContext(
  macro: MacroCycle,
  today?: Date,
): {
  weekNumber: number;
  phase: MacroPhase;
  weeksToRace: number;
  totalWeeks: number;
} | null {
  if (!macro || !macro.phases || macro.phases.length === 0) return null;
  const now = today ?? new Date();
  let start: Date;
  let end: Date;
  try {
    start = parseISODate(macro.startDate);
    end = parseISODate(macro.endDate);
  } catch {
    return null;
  }

  const totalWeeks = macro.phases.length;
  const daysFromStart = daysBetween(start, now);
  const daysToRace = daysBetween(now, end);

  // Fuori range: prima dello start o dopo la race.
  if (daysFromStart < 0) return null;
  // Se siamo nel giorno race o oltre, ritorna ultima settimana ma weeksToRace=0.
  if (daysToRace < 0) return null;

  const weekNumber = Math.min(totalWeeks, Math.floor(daysFromStart / 7) + 1);
  const meso = macro.phases[weekNumber - 1];
  const weeksToRace = Math.ceil(daysToRace / 7);

  return {
    weekNumber,
    phase: meso.phase,
    weeksToRace,
    totalWeeks,
  };
}
