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
   * Volume cardio degli ultimi 7gg (minuti). Usato per check ACWR conservativo:
   * se il volume target supera del 50%+ il volume recente, registriamo un
   * override "ramp limit" e flaggiamo il rischio. Opzionale.
   */
  weeklyVolumeRecentMin?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Tabelle scientifiche (constants).
// ────────────────────────────────────────────────────────────────────────────

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
  if (macroPhase === "taper") {
    // Mujika 2003: taper -40% volume mantenendo intensita'.
    const taperMult = 0.6;
    weeklyVolume = weeklyVolume * taperMult;
    avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
    overrides.push("Macro taper → volume × 0.6 (Mujika & Padilla 2003).");
    bases.push("Mujika & Padilla 2003: taper -40-60% volume, intensita' invariata.");
  } else if (macroPhase === "base") {
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
    // Build: intensita' specifica gia' incoraggiata da zoneDist[intensity].
    overrides.push("Macro build → intensita' specifica (zone gia' bilanciate).");
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

  // ─── 9. ACWR ramp check (Gabbett 2016) ──────────────────────────────────
  if (typeof input.weeklyVolumeRecentMin === "number" && input.weeklyVolumeRecentMin > 0) {
    const ratio = weeklyVolume / input.weeklyVolumeRecentMin;
    if (ratio > 1.5) {
      // Cap il volume target al +50% del recente (ACWR sweet spot <1.5).
      const cappedVolume = input.weeklyVolumeRecentMin * 1.5;
      overrides.push(
        `ACWR ramp check: target ${Math.round(weeklyVolume)}min vs recente ${input.weeklyVolumeRecentMin}min (ratio ${ratio.toFixed(2)}) → cap a ${Math.round(cappedVolume)}min (Gabbett 2016).`,
      );
      weeklyVolume = cappedVolume;
      avgSession = Math.min(weeklyVolume / daysAvail, sessionCap);
      bases.push("Gabbett 2016: ACWR (acute:chronic workload ratio) sweet spot 0.8-1.3, rischio overuse oltre 1.5.");
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
  const lines: string[] = [
    "PRESCRIZIONE TARGET (formule scientifiche, NON negoziabile):",
    `- Volume settimanale: ${p.weeklyVolumeTargetMin} min (range ${p.weeklyVolumeRangeMin.min}-${p.weeklyVolumeRangeMin.max}).`,
    `- Durata sessione media: ${p.avgSessionMin} min (range ${p.sessionRangeMin.min}-${p.sessionRangeMin.max}).`,
    `- Distribuzione zone: ${p.zoneDistributionPct.z1z2Pct}% Z1-Z2 · ${p.zoneDistributionPct.z3Pct}% Z3 · ${p.zoneDistributionPct.z4z5Pct}% Z4-Z5.`,
    `- Forza: ${p.strength.sessionsPerWeek} sess/sett, RPE ${p.strength.rpeRange.min}-${p.strength.rpeRange.max}, carichi ${p.strength.pct1RMRange.min}-${p.strength.pct1RMRange.max}% 1RM.`,
    `- Riposo: min ${p.minRestDaysPerWeek} gg/sett, ≥${p.minHoursBetweenStrengthSameGroup}h tra forza stesso gruppo.`,
  ];
  if (p.overrides.length > 0) {
    lines.push(`- Override applicati: ${p.overrides.join(" | ")}.`);
  }
  lines.push(
    "",
    "REGOLE D'USO:",
    "- Distribuisci il volume target tra le sessioni dei giorni allenabili.",
    "- Rispetta la distribuzione zone (anche aggiustando la durata).",
    "- Non scendere sotto il 70% del volume target (sottostimolo).",
    "- Non superare il 115% (rischio overload / aderenza bassa).",
    "- Le sessioni cardio devono coprire le zone prescritte settimanalmente.",
  );
  return lines.join("\n");
}
