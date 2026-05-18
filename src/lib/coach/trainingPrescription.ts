// Training Prescription — Personal Trainer Pro layer (2026-05-13).
//
// Owner: architect-specialist (proposta Lorenzo: "voglio essere sicuro che la
// struttura sia corretta complessivamente. L'obiettivo non e' fare micro fix ma
// analizzare il problema alla radice e costruire correttamente tutto il tool").
//
// CONTRATTO:
//   Profile + Goals + RecentLoad + Readiness + MacroPhase
//                      |
//                      v
//        computePrescription() — pure function, formule scientifiche
//                      |
//                      v
//          TrainingPrescription struct (numeri concreti)
//                      |
//                      v
//   LLM prompt riceve targets prescrittivi (no piu' hint vaghi)
//                      |
//                      v
//   Pass-3 Validator (deterministico): warning se piano fuori target
//
// Pre-fix (2026-05-13 Lorenzo): utente con intensityPreference="very_intense" +
// hoursPerSession=1.5h riceveva sessioni 40min Z2 rilassate. Causa root: le
// label di intensita' (diaryContext.ts) erano hint descrittivi "soft hint"
// non prescrittivi. L'LLM le ignorava in favore di pattern preset.
//
// Soluzione: numeri concreti calcolati da formule peer-reviewed, iniettati
// nel prompt come "PRESCRIZIONE NON NEGOZIABILE", validati post-LLM da un
// validator deterministico.
//
// VINCOLI:
// - Pure function: nessun side effect, nessun fetch, nessun I/O.
// - Deterministico: stesso input → stesso output (golden test friendly).
// - Backward compat: campi UserProfile invariati. Tutti gli input opzionali
//   tranne `profile`.
// - Cap di sicurezza: ageDecay sui >50 e >65 (Lepers 2016, Tanaka 2008);
//   restDays age-tiered (ACSM Chodzko-Zajko 2009).
//
// BASI SCIENTIFICHE (citate nei `bases` per UI trasparenza):
// - Piercy et al. 2018 (ACSM Physical Activity Guidelines) → volume base 150-300+ min/sett.
// - Seiler 2010 / Stoggl & Sperlich 2014 → distribuzione polarizzata 80/20.
// - Schoenfeld et al. 2017 → dose-response forza (volume settimanale).
// - Ratamess et al. 2009 (ACSM) → %1RM ↔ rep range, progressione.
// - Grgic et al. 2018 → frequency forza (2-3x/sett ottimale).
// - Lepers & Stapley 2016 → master athletes decline performance (~10%/decade dopo 50).
// - Tanaka & Seals 2008 → endurance performance aging.
// - Chodzko-Zajko et al. 2009 (ACSM) → exercise + physical activity for older adults.
// - Mujika & Padilla 2003 → taper -40-60% volume mantenendo intensita'.
// - Bompa & Buzzichelli (Periodization Theory) → base = aerobic accumulation.
// - Ronnestad et al. 2014 → strength training for endurance athletes (2x/sett).
// - Bosquet et al. 2007 → deload settimanale -40-50% volume.

import type { UserProfile, Experience, MacroPhase } from "../types";
import { volumeMultiplierForPhase } from "./macroPlanner";

// ────────────────────────────────────────────────────────────────────────────
// Public types.
// ────────────────────────────────────────────────────────────────────────────

export type IntensityLevel = "soft" | "balanced" | "intense" | "very_intense";

export type GoalTypeHint = "endurance" | "strength" | "general" | "sport";

export type ReadinessBand = "low" | "moderate" | "high";

export interface ZoneDistributionPct {
  /** Z1 + Z2 (recovery + easy aerobic). Tipico 70-100%. */
  z1z2Pct: number;
  /** Z3 (tempo / threshold basso). Tipico 0-20%. */
  z3Pct: number;
  /** Z4 + Z5 (threshold/VO2max). Tipico 0-20%. */
  z4z5Pct: number;
}

export interface StrengthPrescription {
  sessionsPerWeek: number;
  rpeRange: { min: number; max: number };
  pct1RMRange: { min: number; max: number };
}

/**
 * Prescrizione finale: numeri concreti che l'LLM riceve come "non negoziabile".
 * I range (vs valori secchi) servono come tolleranza realistica (~±15%).
 */
export interface TrainingPrescription {
  /** Volume totale settimanale (minuti, somma di tutte le sessioni). */
  weeklyVolumeTargetMin: number;
  /** Banda accettata ±15% intorno al target. */
  weeklyVolumeRangeMin: { min: number; max: number };

  /**
   * Durata sessione media (minuti, includendo cardio + sport).
   * Le sessioni forza/mobility hanno logica propria (durationCapMin).
   */
  avgSessionMin: number;
  /** Range accettato (lower 70% del medio, upper = cap dichiarato). */
  sessionRangeMin: { min: number; max: number };

  /** Distribuzione zone polarized (Seiler 2010, Stoggl 2014). */
  zoneDistributionPct: ZoneDistributionPct;

  /** Forza (Schoenfeld 2017 + Grgic 2018 + Ratamess 2009). */
  strength: StrengthPrescription;

  /** Recovery (Borde 2015 + Chodzko-Zajko 2009 age-tiered). */
  minRestDaysPerWeek: number;
  /** 48h MPS + tendon repair (Schoenfeld 2016). */
  minHoursBetweenStrengthSameGroup: number;

  /** Override applicati (debug/log/UI banner). Ordine = ordine di applicazione. */
  overrides: string[];

  /** Basi scientifiche citate per UI trasparenza. */
  bases: string[];
}

export interface ComputePrescriptionInput {
  profile: UserProfile;
  /** Default: profile.intensityPreference ?? "balanced". */
  intensity?: IntensityLevel;
  /** Default: "general". */
  goalType?: GoalTypeHint;
  /** Default: null (no macro). */
  macroPhase?: MacroPhase | null;
  /** Default: "moderate" (no readiness adjustment). */
  readinessBand?: ReadinessBand;
  /**
   * Volume cardio degli ultimi 7gg (minuti, "acute load").
   * Usato per due check distinti:
   *  - target/recente >1.5 → cap target (anti-ramp, vedi check #9 esistente)
   *  - acute/chronic ratio (vedi `weeklyVolumeChronicMin`) → ACWR canonico
   */
  weeklyVolumeRecentMin?: number;
  /**
   * Volume cardio medio settimanale degli ultimi 28gg (minuti, "chronic load").
   * Se fornito insieme a `weeklyVolumeRecentMin`, attiva il check ACWR
   * canonico Gabbett 2016: ratio acute/chronic dev'essere in 0.8-1.3
   * ("sweet spot"); >1.5 = rischio overuse, <0.8 = detraining.
   */
  weeklyVolumeChronicMin?: number;
  /**
   * Signal aggregato (legacy, mantenuto per backward compat). Se
   * `goalVolumeMultiplier` è presente, ha precedenza.
   */
  goalProgressSignal?: "ahead" | "aligned" | "behind" | "very_behind";
  /**
   * Multiplier volume continuo raccomandato dal goalPredictor (Wave audit 2
   * commit 2/3). Range tipico [1.0, 1.10]. Calcolato dal caller aggregando
   * i `recommendedVolumeMultiplier` dei goal active (max-wins): se un goal
   * è infeasible serve push aggressivo, capped al safety ceiling Lydiard/
   * Gabbett (+10%/sett). Sostituisce la logica categorica del signal.
   */
  goalVolumeMultiplier?: number;
  /**
   * Adherence % della settimana precedente (0-100). Iniettato dal
   * closed-loop scheduler (weeklyReport → regen): se basso, applica
   * un cap deterministico al volume target per la nuova settimana.
   *  - <60: vol × 0.85 (forte downscale)
   *  - 60-75: vol × 0.95 (lieve downscale)
   *  - >=75: no-op
   * Sprint 1 (2026-05-18): evita di riproporre la stessa dose che
   * l'utente non è riuscito a sostenere.
   */
  adherencePct?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Tabelle scientifiche (constants).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Volume landmarks per gruppo muscolare (set/sett, working sets a RPE 6-9).
 * Schoenfeld 2017 (NSCA), Israetel/Hoffmann RP Volume Landmarks 2018.
 *
 * MV (Maintenance Volume):     minimo per non regredire.
 * MEV (Minimum Effective Volume): soglia ipertrofica minima.
 * MAV (Maximum Adaptive Volume):  range ottimale crescita.
 * MRV (Maximum Recoverable Volume): tetto, oltre = overreach.
 *
 * Iniettato nel prompt come guidance al modello quando prescrive forza,
 * specie con goal "strength" o "ipertrofia".
 */
export const MUSCLE_VOLUME_LANDMARKS: Record<string, { mv: number; mev: number; mav: [number, number]; mrv: number }> = {
  petto:          { mv: 6,  mev: 8,  mav: [12, 20], mrv: 22 },
  schiena:        { mv: 8,  mev: 10, mav: [14, 22], mrv: 25 },
  quadricipiti:   { mv: 6,  mev: 8,  mav: [12, 18], mrv: 20 },
  femorali:       { mv: 4,  mev: 6,  mav: [10, 16], mrv: 20 },
  glutei:         { mv: 4,  mev: 6,  mav: [10, 16], mrv: 20 },
  spalle:         { mv: 8,  mev: 8,  mav: [16, 20], mrv: 26 },
  bicipiti:       { mv: 4,  mev: 6,  mav: [12, 20], mrv: 26 },
  tricipiti:      { mv: 4,  mev: 6,  mav: [10, 14], mrv: 18 },
  polpacci:       { mv: 6,  mev: 8,  mav: [12, 16], mrv: 20 },
  core:           { mv: 0,  mev: 0,  mav: [4, 12], mrv: 16 },
};

/**
 * Format compatto per iniezione nel prompt LLM. Output blocco con
 * guideline numerica per ogni gruppo principale, contestualizzato per goal.
 */
export function formatVolumeLandmarksForPrompt(goalType?: GoalTypeHint): string {
  const target =
    goalType === "strength" ? "MAV (zona ottimale crescita)" :
    goalType === "endurance" ? "MEV (mantenimento + complemento endurance)" :
    "MEV-MAV (range standard)";
  const lines = Object.entries(MUSCLE_VOLUME_LANDMARKS).map(([muscle, l]) =>
    `  - ${muscle}: MV ${l.mv} | MEV ${l.mev} | MAV ${l.mav[0]}-${l.mav[1]} | MRV ${l.mrv}`,
  );
  return [
    `VOLUME LANDMARKS forza (set/sett per gruppo, Schoenfeld 2017 / Israetel RP):`,
    `Target raccomandato per goal "${goalType ?? "general"}": ${target}.`,
    `Distribuisci nelle sessioni forza_gambe + forza_upper rispettando questi landmark.`,
    `Limiti per muscolo:`,
    ...lines,
    `NB: working set = serie a RPE >= 6. Non contare warm-up sets.`,
  ].join("\n");
}

/**
 * Volume base settimanale (minuti) per livello di esperienza.
 * Riferimento: Piercy et al. 2018 ACSM Physical Activity Guidelines.
 *   - sedentary: 150 min/sett (minimo OMS+ACSM).
 *   - occasional: 200 min/sett (incremento +30%).
 *   - regular: 300 min/sett (target per "active adult").
 *   - competitive: 500 min/sett (athlete tier, Lepers 2016 master endurance).
 *
 * NB: il tipo `Experience` del codebase usa "competitive" come livello top
 * (non "advanced" come nella spec originale Lorenzo). Manteniamo coerenza col
 * tipo esistente.
 */
const VOLUME_BASE_MIN_BY_EXP: Record<Experience, number> = {
  sedentary: 150,
  occasional: 200,
  regular: 300,
  competitive: 500,
};

/**
 * Multiplier intensita'. Scala il volume base in funzione del desiderio
 * dell'utente. very_intense = +50% (gestire RED-S risk con deload periodici).
 */
const INTENSITY_MULT: Record<IntensityLevel, number> = {
  soft: 0.7,
  balanced: 1.0,
  intense: 1.3,
  very_intense: 1.5,
};

/**
 * Distribuzione zone polarized (Seiler 2010). I valori sommano sempre a 100.
 *
 * Update 2026-05-13 da scientific validator: il 75/10/15 (intense) era più
 * "pyramidal" che "polarized" (Seiler canonical = ≥80% in Z1-Z2). Rosenblat
 * 2022 meta + Stöggl & Sperlich 2014 favoriscono polarized stretto per
 * atleti recreational. very_intense: 20% Z4-Z5 tipico solo block-periodization
 * elite — per amatori 15% è upper sustainable bound.
 */
const ZONE_DIST: Record<IntensityLevel, ZoneDistributionPct> = {
  soft:         { z1z2Pct: 100, z3Pct: 0,  z4z5Pct: 0  },
  balanced:     { z1z2Pct: 80,  z3Pct: 15, z4z5Pct: 5  },
  intense:      { z1z2Pct: 80,  z3Pct: 10, z4z5Pct: 10 },  // was 75/10/15 — Seiler stretto
  very_intense: { z1z2Pct: 75,  z3Pct: 10, z4z5Pct: 15 },  // was 70/10/20 — sustainable amatori
};

interface StrengthBase {
  sessions: number;
  rpe: [number, number];
  pct1RM: [number, number];
}

/**
 * Forza base per livello esperienza.
 * Schoenfeld 2017 (volume settimanale) + Ratamess 2009 (%1RM ↔ rep range)
 * + Grgic 2018 (frequenza 2-3x/sett ottimale per ipertrofia).
 */
const STRENGTH_BY_EXP: Record<Experience, StrengthBase> = {
  sedentary:   { sessions: 1, rpe: [6, 7], pct1RM: [50, 65] },
  occasional:  { sessions: 2, rpe: [7, 8], pct1RM: [60, 75] },
  regular:     { sessions: 2, rpe: [7, 8], pct1RM: [70, 85] },
  competitive: { sessions: 3, rpe: [8, 9], pct1RM: [75, 90] },
};

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Age decay: master athletes (>50) e elder (>65) hanno minor capacita' di
 * recupero e VO2max. Riferimento: Lepers & Stapley 2016 ("Master Athletes"),
 * Tanaka & Seals 2008 ("Endurance Exercise Performance in Masters Athletes").
 *
 * Approssimazione conservativa:
 *   - <50: no decay (1.0)
 *   - 50-64: -8% (0.92)
 *   - >=65: -20% (0.80) — ACSM Chodzko-Zajko 2009.
 */
function ageDecay(age: number): number {
  if (!Number.isFinite(age)) return 1.0;
  if (age >= 65) return 0.80;
  if (age >= 50) return 0.92;
  return 1.0;
}

/**
 * Rest days age-tiered (ACSM 2009 + Chodzko-Zajko).
 *   - <50: 2 giorni minimi di riposo
 *   - >=50: 3 giorni
 *   - >=65: 3 giorni (stesso threshold ma con cap consecutive=2 altrove)
 */
function minRestDays(age: number): number {
  if (!Number.isFinite(age)) return 2;
  if (age >= 50) return 3;
  return 2;
}

/** Helper: arrotonda a intero positivo, mai sotto 0. */
function r(n: number): number {
  return Math.max(0, Math.round(n));
}

/** Helper: clamp percentuali in [0, 100] e normalizza per sommare a 100. */
function normalizeZones(z: ZoneDistributionPct): ZoneDistributionPct {
  const a = Math.max(0, Math.min(100, z.z1z2Pct));
  const b = Math.max(0, Math.min(100, z.z3Pct));
  const c = Math.max(0, Math.min(100, z.z4z5Pct));
  const sum = a + b + c;
  if (sum === 0) return { z1z2Pct: 100, z3Pct: 0, z4z5Pct: 0 };
  // Normalizza in modo tale da sommare a 100 senza distorcere proporzioni.
  // Scaling preserva i rapporti relativi.
  const k = 100 / sum;
  return {
    z1z2Pct: Math.round(a * k),
    // I residui finiscono in z3/z4z5: priorita' alta per Z3 (centrale).
    z3Pct: Math.round(b * k),
    z4z5Pct: 100 - Math.round(a * k) - Math.round(b * k),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN: computePrescription.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Calcola la prescrizione di allenamento data un profilo + context.
 *
 * Ordine di applicazione (override sequenziali, ognuno aggiunge bases/overrides):
 *  1. Volume base (esperienza) × intensity multiplier × age decay.
 *  2. Durata sessione media: volume / days, cappata da hoursPerSession × 0.9.
 *  3. Zone distribution (polarized model).
 *  4. Strength base + override per intensita' (very_intense → +1 sess, +1 RPE).
 *  5. Recovery (rest days age-tiered).
 *  6. Readiness override (low → no Z4-Z5, RPE -1).
 *  7. Macro phase override (taper → -40% vol; base → +Z1-Z2; build → +intensity).
 *  8. Goal type override (endurance → forza min 2x/sett; strength → +1 forza).
 *  9. ACWR ramp check (se volume recente noto).
 *
 * Pure function: stesso input → stesso output. Test golden friendly.
 */
export function computePrescription(input: ComputePrescriptionInput): TrainingPrescription {
  const { profile } = input;
  const intensity: IntensityLevel = input.intensity ?? profile.intensityPreference ?? "balanced";
  const goalType: GoalTypeHint = input.goalType ?? "general";
  const macroPhase = input.macroPhase ?? null;
  const readinessBand: ReadinessBand = input.readinessBand ?? "moderate";

  const overrides: string[] = [];
  const bases: string[] = [];

  // ─── 1. Volume settimanale ──────────────────────────────────────────────
  const exp: Experience = profile.experience;
  const volumeBase = VOLUME_BASE_MIN_BY_EXP[exp] ?? 200;
  const intensityMult = INTENSITY_MULT[intensity];
  const decay = ageDecay(profile.age);
  let weeklyVolume = volumeBase * intensityMult * decay;
  bases.push(`ACSM 2018 (Piercy): volume base ${volumeBase}min per livello ${exp}, × intensity ${intensityMult}, × age decay ${decay.toFixed(2)} → ${Math.round(weeklyVolume)}min/sett.`);
  if (decay < 1.0) {
    bases.push("Lepers & Stapley 2016 + Tanaka 2008: master athletes performance decline.");
  }

  // ─── 2. Durata sessione media ───────────────────────────────────────────
  const avail = profile.weekly_availability;
  const daysAvail = Math.max(1, Math.min(7, avail?.days ?? 4));
  const hoursPerSession = Math.max(0.25, avail?.hoursPerSession ?? 1);
  // Cap: 90% del max dichiarato (lascia margine per warmup/cooldown).
  const sessionCap = hoursPerSession * 60 * 0.9;
  let avgSession = weeklyVolume / daysAvail;
  if (avgSession > sessionCap) {
    // Sessione cappata da disponibilita': il volume settimanale efficace
    // potrebbe scendere sotto il target. Registrato negli overrides.
    overrides.push(`Durata sessione cappata a ${Math.round(sessionCap)}min (90% di ${hoursPerSession}h dichiarate) — volume effettivo possibile: ${Math.round(sessionCap * daysAvail)}min/sett.`);
    avgSession = sessionCap;
  }

  // ─── 3. Zone distribution ───────────────────────────────────────────────
  let zoneDist: ZoneDistributionPct = { ...ZONE_DIST[intensity] };
  bases.push("Seiler 2010 + Stoggl & Sperlich 2014: distribuzione polarizzata (80/20 base, fino 70/30 in fase peaking).");

  // ─── 4. Forza ───────────────────────────────────────────────────────────
  const strengthBase = STRENGTH_BY_EXP[exp] ?? STRENGTH_BY_EXP.regular;
  const strength: StrengthPrescription = {
    sessionsPerWeek: strengthBase.sessions,
    rpeRange: { min: strengthBase.rpe[0], max: strengthBase.rpe[1] },
    pct1RMRange: { min: strengthBase.pct1RM[0], max: strengthBase.pct1RM[1] },
  };
  // Override forza per intensita': very_intense bump +1 sess + +1 RPE (capped 10).
  if (intensity === "very_intense" && exp !== "sedentary") {
    strength.sessionsPerWeek = Math.min(strength.sessionsPerWeek + 1, 4);
    strength.rpeRange = {
      min: Math.min(strength.rpeRange.min + 1, 10),
      max: Math.min(strength.rpeRange.max + 1, 10),
    };
    overrides.push("Intensita' very_intense → forza +1 sess/sett, RPE +1.");
  } else if (intensity === "soft") {
    strength.sessionsPerWeek = Math.max(strength.sessionsPerWeek - 1, 1);
    overrides.push("Intensita' soft → forza -1 sess/sett (min 1).");
  }
  bases.push("Schoenfeld 2017 (dose-response volume) + Ratamess 2009 (%1RM ↔ rep range) + Grgic 2018 (frequenza 2-3x/sett).");

  // ─── 5. Recovery ────────────────────────────────────────────────────────
  const restDays = minRestDays(profile.age);
  bases.push("ACSM 2009 Chodzko-Zajko: rest days age-tiered. Schoenfeld 2016: 48h MPS recovery same muscle group.");

  // ─── 6. Readiness override (Wave 3.4 G7) ────────────────────────────────
  if (readinessBand === "low") {
    // Riallocazione: Z4-Z5 azzerati, surplus va in Z3 (capped 100).
    const z45Drop = zoneDist.z4z5Pct;
    zoneDist = {
      z1z2Pct: zoneDist.z1z2Pct,
      z3Pct: Math.min(zoneDist.z3Pct + z45Drop, 100),
      z4z5Pct: 0,
    };
    zoneDist = normalizeZones(zoneDist);
    strength.rpeRange = {
      min: strength.rpeRange.min,
      max: Math.max(strength.rpeRange.max - 1, 6),
    };
    overrides.push("Readiness low → Z4-Z5 azzerato (surplus su Z3), forza RPE max -1.");
  }

  // ─── 7. Macro phase override ────────────────────────────────────────────
  // Sprint 1 fix #4 (2026-05-18): volume scaling per TUTTE le fasi (non solo
  // taper). Sincronizzato con macroPlanner.VOLUME_BY_PHASE (build×1.2,
  // peak×0.9, taper×0.6, base×1.0, transition×0.5). Lo zone-shift specifico
  // per base/peak resta sotto. Per taper usiamo volumeMultiplierForPhase(
  // "taper", 1) = 0.6 (punto medio rampa); il taper-ramp preciso settimana-
  // per-settimana è gestito in macroPlanner.buildMacroCycle.
  if (macroPhase === "taper") {
    // Mujika 2003: taper -40% volume mantenendo intensita'.
    const taperMult = volumeMultiplierForPhase("taper", 1); // = 0.6
    weeklyVolume = weeklyVolume * taperMult;
    avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
    overrides.push(`Macro phase taper: vol ×${taperMult.toFixed(2)} (Mujika & Padilla 2003).`);
    bases.push("Mujika & Padilla 2003: taper -40-60% volume, intensita' invariata.");
  } else if (macroPhase === "base") {
    // Base: vol × 1.0 (no-op esplicito, ma logghiamo per trasparenza UI).
    const baseMult = volumeMultiplierForPhase("base", 1); // = 1.0
    if (baseMult !== 1.0) {
      weeklyVolume = weeklyVolume * baseMult;
      avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
    }
    overrides.push(`Macro phase base: vol ×${baseMult.toFixed(2)} (aerobic accumulation).`);
    // Base: +10% Z1-Z2 (accumulazione aerobica), -10% Z4-Z5.
    const z45Shift = Math.min(10, zoneDist.z4z5Pct);
    zoneDist = {
      z1z2Pct: Math.min(zoneDist.z1z2Pct + z45Shift, 100),
      z3Pct: zoneDist.z3Pct,
      z4z5Pct: Math.max(zoneDist.z4z5Pct - z45Shift, 0),
    };
    zoneDist = normalizeZones(zoneDist);
    overrides.push("Macro base → +10% Z1-Z2 (aerobic accumulation), -10% Z4-Z5.");
    bases.push("Bompa & Buzzichelli Periodization: base phase = aerobic accumulation.");
  } else if (macroPhase === "peak") {
    // Peak: vol × 0.9 (riduzione volume per qualità, Bompa).
    const peakMult = volumeMultiplierForPhase("peak", 1); // = 0.9
    weeklyVolume = weeklyVolume * peakMult;
    avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
    overrides.push(`Macro phase peak: vol ×${peakMult.toFixed(2)} (race-specific, Bompa).`);
    // Peak: bump Z4-Z5 +5%, Z1-Z2 -5%.
    const z12Shift = Math.min(5, zoneDist.z1z2Pct);
    zoneDist = {
      z1z2Pct: Math.max(zoneDist.z1z2Pct - z12Shift, 0),
      z3Pct: zoneDist.z3Pct,
      z4z5Pct: Math.min(zoneDist.z4z5Pct + z12Shift, 100),
    };
    zoneDist = normalizeZones(zoneDist);
    overrides.push("Macro peak → +5% Z4-Z5 (specific intensity), -5% Z1-Z2.");
  } else if (macroPhase === "build") {
    // Build: vol × 1.2 (accumulazione qualità, Bompa). Intensita' specifica
    // gia' incoraggiata dal zoneDist base[intensity].
    const buildMult = volumeMultiplierForPhase("build", 1); // = 1.2
    weeklyVolume = weeklyVolume * buildMult;
    avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
    overrides.push(`Macro phase build: vol ×${buildMult.toFixed(2)} (quality accumulation, Bompa).`);
  } else if (macroPhase === "transition") {
    // Transition: vol × 0.5 (recovery post-gara).
    const transMult = volumeMultiplierForPhase("transition", 1); // = 0.5
    weeklyVolume = weeklyVolume * transMult;
    avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
    overrides.push(`Macro phase transition: vol ×${transMult.toFixed(2)} (post-race recovery).`);
  }

  // ─── 8. Goal type override ──────────────────────────────────────────────
  if (goalType === "endurance") {
    // Ronnestad 2014: forza 2x/sett obbligatoria per atleti endurance.
    if (strength.sessionsPerWeek < 2) {
      strength.sessionsPerWeek = 2;
      overrides.push("Goal endurance → forza forzata a min 2x/sett (Ronnestad 2014).");
    }
    bases.push("Ronnestad et al. 2014: strength training improves endurance performance.");
  } else if (goalType === "strength") {
    // Goal strength: priorita' forza, +1 sess se possibile.
    strength.sessionsPerWeek = Math.min(strength.sessionsPerWeek + 1, 4);
    overrides.push("Goal strength → forza +1 sess/sett (max 4).");
  }

  // ─── 9. ACWR ramp check con FLOOR PER EXPERIENCE (Gabbett 2016 + Lydiard) ──
  // Lorenzo 2026-05-18: skip secco era rischioso per edge cases (post-infortunio
  // che riprende, casual che cambia intensity, master con chronic naturalmente
  // bassa). Sostituito con ramp graduale:
  //   effective_chronic = max(chronic, FLOOR_BY_EXP[exp])
  //   cap_target = max(effective_chronic × 1.5, original_target × 0.7)
  // Invarianti: mai >2× effective chronic, mai <70% target original.
  // - Utente nuovo/sparso: floor garantisce minimo sensato per experience
  // - Goal-driven push viene re-bounded da cap_target nel check #10
  // - Per chronic alto (>floor) si comporta come standard Gabbett 1.5x
  const FLOOR_CHRONIC_BY_EXP: Record<typeof input.profile.experience, number> = {
    sedentary: 60,
    occasional: 90,
    regular: 150,
    competitive: 250,
  };
  const floorChronic = FLOOR_CHRONIC_BY_EXP[input.profile.experience];

  // 9a. Cap target con ramp graduale (anti-spike acuto vs recente).
  if (typeof input.weeklyVolumeRecentMin === "number" && input.weeklyVolumeRecentMin > 0) {
    const ratio = weeklyVolume / input.weeklyVolumeRecentMin;
    if (ratio > 1.5) {
      const effectiveRecent = Math.max(input.weeklyVolumeRecentMin, floorChronic);
      const cappedVolume = Math.max(effectiveRecent * 1.5, weeklyVolume * 0.7);
      const cappedRounded = Math.min(weeklyVolume, cappedVolume);
      if (cappedRounded < weeklyVolume) {
        overrides.push(
          `ACWR ramp check: target ${Math.round(weeklyVolume)}min vs recente ${input.weeklyVolumeRecentMin}min (ratio ${ratio.toFixed(2)}). Effective recent (floor ${input.profile.experience}=${floorChronic}): ${effectiveRecent}min → cap a ${Math.round(cappedRounded)}min (max(effective×1.5, target×0.7), Gabbett 2016 + Lydiard ramp).`,
        );
        weeklyVolume = cappedRounded;
        avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
        bases.push("Gabbett 2016 + Lydiard ramp: cap = max(effective_chronic × 1.5, target × 0.7).");
      }
    }
  }
  // 9b. ACWR canonico acute(7gg)/chronic(28gg) — diagnostica pattern reale.
  // Anche qui usa effective_chronic (floor by experience) per evitare ratio
  // gonfiati artificialmente in utenti sparsi.
  if (
    typeof input.weeklyVolumeRecentMin === "number" &&
    typeof input.weeklyVolumeChronicMin === "number" &&
    input.weeklyVolumeChronicMin > 0
  ) {
    const effectiveChronic = Math.max(input.weeklyVolumeChronicMin, floorChronic);
    const acwr = input.weeklyVolumeRecentMin / effectiveChronic;
    if (acwr > 1.5) {
      overrides.push(
        `ACWR alto: ultimi 7gg ${input.weeklyVolumeRecentMin}min vs effective chronic ${effectiveChronic}min/sett (floor ${input.profile.experience}=${floorChronic}, ratio ${acwr.toFixed(2)}). Sweet spot 0.8-1.3 (Gabbett 2016).`,
      );
      // Cap aggiuntivo con stesso pattern ramp graduale.
      const cap = Math.max(effectiveChronic * 1.3, weeklyVolume * 0.7);
      if (cap < weeklyVolume) {
        weeklyVolume = cap;
        avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
      }
    } else if (acwr < 0.8) {
      overrides.push(
        `ACWR basso: ultimi 7gg ${input.weeklyVolumeRecentMin}min vs effective chronic ${effectiveChronic}min/sett (ratio ${acwr.toFixed(2)}). Probabile ripresa post-stop/scarico — riprogressione graduale.`,
      );
    }
    if (!bases.some(b => b.includes("Gabbett 2016"))) {
      bases.push("Gabbett 2016 + Lydiard ramp: effective_chronic floor by experience.");
    }
  }

  // ─── 9c. Adherence cap deterministico (Sprint 1 fix #2, 2026-05-18) ─────
  // Closed-loop con weeklyReport: se la settimana precedente è stata
  // sotto-aderente, riduci il target deterministicamente. NIENTE retry-LLM,
  // NIENTE bias soft — applica un multiplier secco con override esplicito.
  //  - adherence < 60: vol × 0.85 (downscale forte: utente in difficoltà)
  //  - 60 <= adherence < 75: vol × 0.95 (downscale leggero: rifinitura)
  //  - >= 75: no-op
  if (typeof input.adherencePct === "number" && Number.isFinite(input.adherencePct)) {
    let adhMult: number | null = null;
    if (input.adherencePct < 60) adhMult = 0.85;
    else if (input.adherencePct < 75) adhMult = 0.95;
    if (adhMult !== null) {
      const before = weeklyVolume;
      weeklyVolume = weeklyVolume * adhMult;
      avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
      overrides.push(
        `Adherence cap: aderenza settimana precedente ${Math.round(input.adherencePct)}% → vol ×${adhMult.toFixed(2)} (${Math.round(before)}min → ${Math.round(weeklyVolume)}min).`,
      );
      bases.push("Closed-loop adherence cap: target volume modulato sull'aderenza osservata (riduce gap target↔reale).");
    }
  }

  // ─── 10. Goal convergence auto-adapt (Wave audit 2 commit 2/3) ──────────
  // Adatta carichi via multiplier continuo dal goalPredictor (Daniels VDOT,
  // ACSM, Krustrup, Schoenfeld, Pfitzinger). Sostituisce mapping categorico
  // hardcoded. Cap +10% (Lydiard rule + Gabbett 2016 ACWR safety ceiling).
  // ACWR check resta sopra come safety net supremo.
  let multiplier: number | undefined;
  if (typeof input.goalVolumeMultiplier === "number" && input.goalVolumeMultiplier > 0) {
    multiplier = Math.min(input.goalVolumeMultiplier, 1.10); // cap Lydiard/Gabbett
  } else if (input.goalProgressSignal) {
    // Backward compat: legacy signal categorico se multiplier non fornito.
    const sig = input.goalProgressSignal;
    if (sig === "very_behind") multiplier = 1.10;
    else if (sig === "behind") multiplier = 1.05;
    else if (sig === "ahead") multiplier = 1.0; // No deload preventivo (era hardcoded errato).
  }
  if (multiplier !== undefined && multiplier !== 1.0) {
    const before = weeklyVolume;
    weeklyVolume = weeklyVolume * multiplier;
    let label = `Goal-driven volume adapt: ×${multiplier.toFixed(3)} (predictor-derived)`;
    // Re-applica ACWR cap con ramp graduale (vedi #9). Mai sotto 70% del target
    // post-multiplier per evitare cap over-aggressive.
    if (typeof input.weeklyVolumeChronicMin === "number" && input.weeklyVolumeChronicMin > 0) {
      const effectiveChronic = Math.max(input.weeklyVolumeChronicMin, floorChronic);
      const acwrCap = Math.max(effectiveChronic * 1.3, weeklyVolume * 0.7);
      if (weeklyVolume > acwrCap) {
        weeklyVolume = acwrCap;
        label += ` (capped a ACWR ceiling ${Math.round(acwrCap)}min, effective chronic ${effectiveChronic}min)`;
      }
    }
    avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
    overrides.push(`${label} (volume: ${Math.round(before)}min → ${Math.round(weeklyVolume)}min).`);
    bases.push("Goal-driven volume adapt: multiplier continuo da goalPredictor (Daniels/ACSM/Krustrup/Schoenfeld/Pfitzinger), capped Lydiard/Gabbett 2016.");
  }

  // ─── 11. Strength + cardio reconciliation (Sprint 1 fix #3, 2026-05-18) ─
  // Vincolo: strength.sessionsPerWeek + cardio_sessions_implicit ≤ daysAvail.
  // Senza questo check, l'LLM riceveva richieste impossibili (es. 3 forza +
  // 5 cardio impliciti su 5 giorni → overflow). Riduciamo strength PRIMA
  // (il cardio è il driver primario del volume target → ha precedenza).
  // Cardio sessions implicito calcolato come ceil(weeklyVolume / avgSessionMin)
  // con guard contro divisione per zero.
  if (avgSession > 0 && weeklyVolume > 0) {
    const cardioSessionsImplicit = Math.ceil(weeklyVolume / avgSession);
    const totalSessions = strength.sessionsPerWeek + cardioSessionsImplicit;
    if (totalSessions > daysAvail && strength.sessionsPerWeek > 0) {
      const strengthBefore = strength.sessionsPerWeek;
      // Riduci strength finché total entra in daysAvail. Floor a 0 (mai
      // negativo); se il cardio da solo eccede daysAvail, segnaliamo
      // comunque ma non possiamo ridurre cardio (sarebbe taglio al volume
      // target già scientificamente safety-checked).
      const targetStrength = Math.max(0, daysAvail - cardioSessionsImplicit);
      strength.sessionsPerWeek = targetStrength;
      overrides.push(
        `Strength ridotta a ${strength.sessionsPerWeek} per fit giorni: cardio implicito ${cardioSessionsImplicit} + strength ${strengthBefore} > daysAvail ${daysAvail}.`,
      );
    }
  }

  // ─── Output finale: banda ±15% sui range. ──────────────────────────────
  // NB: usiamo il TARGET rotondato come base per il range, cosi' la relazione
  // matematica `range.min === round(target * 0.85)` e' sempre vera (utile
  // per testabilita' + display UI coerente).
  const weeklyVolumeTargetMin = r(weeklyVolume);
  const weeklyVolumeRangeMin = {
    min: r(weeklyVolumeTargetMin * 0.85),
    max: r(weeklyVolumeTargetMin * 1.15),
  };
  const avgSessionMin = r(avgSession);
  const sessionRangeMin = {
    min: r(avgSessionMin * 0.7),
    max: r(sessionCap),
  };

  return {
    weeklyVolumeTargetMin,
    weeklyVolumeRangeMin,
    avgSessionMin,
    sessionRangeMin,
    zoneDistributionPct: zoneDist,
    strength,
    minRestDaysPerWeek: restDays,
    minHoursBetweenStrengthSameGroup: 48,
    overrides,
    bases,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helper di rendering: formato leggibile per prompt LLM / UI.
// Espone formatPrescriptionForPrompt() centralizzato (vs duplicato nei 3
// entry-point del planGenerator).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rendering compatto della prescrizione per iniezione nel userPrompt LLM.
 * Output target: ~400-600 caratteri. Numeri concreti + regole d'uso esplicite.
 */
export function formatPrescriptionForPrompt(p: TrainingPrescription): string {
  const minAcceptable = Math.round(p.weeklyVolumeTargetMin * 0.85);
  // FORMATO ULTRA-COMPATTO (2026-05-18): Gemini 3.1 flash lite ignora prompt
  // lunghi. Il prompt deve essere semplice, diretto, con il vincolo numerico
  // in CIMA e ripetuto. Niente paragrafi narrativi.
  const lines: string[] = [
    "═══ VINCOLO MATEMATICO INDEROGABILE ═══",
    `SOMMA TOTALE delle "duration_min" di tutte le sessioni del piano DEVE essere ≥${minAcceptable} e ≤${p.weeklyVolumeRangeMin.max} minuti.`,
    `Target ideale: ${p.weeklyVolumeTargetMin} min. Sotto ${minAcceptable} = piano RIFIUTATO.`,
    `Esempio: se prescrivi 5 sessioni, media = ${Math.round(p.weeklyVolumeTargetMin / 5)} min/sessione.`,
    "════════════════════════════════════════",
    "",
    "PRESCRIZIONE TARGET (già scientificamente safety-checked: età, esperienza, readiness, ACWR):",
    `- Volume settimanale: ${p.weeklyVolumeTargetMin} min totali (range ${p.weeklyVolumeRangeMin.min}-${p.weeklyVolumeRangeMin.max}).`,
    `- Durata media sessione: ${p.avgSessionMin} min (range ${p.sessionRangeMin.min}-${p.sessionRangeMin.max}).`,
    `- Zone: ${p.zoneDistributionPct.z1z2Pct}% Z1-Z2, ${p.zoneDistributionPct.z3Pct}% Z3, ${p.zoneDistributionPct.z4z5Pct}% Z4-Z5.`,
    `- Forza: ${p.strength.sessionsPerWeek} sess/sett, RPE ${p.strength.rpeRange.min}-${p.strength.rpeRange.max}.`,
    `- Riposo: min ${p.minRestDaysPerWeek} gg/sett.`,
  ];
  if (p.overrides.length > 0) {
    lines.push(`- Override: ${p.overrides.join(" | ")}.`);
  }
  return lines.join("\n");
}
