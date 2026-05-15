// Goal predictor scientifico unificato (Wave audit 2 — sessione goal-driven).
//
// Predict feasibility + valore finale alla deadline + multiplier volume
// raccomandato, per 5 tipi di goal. Constants peer-reviewed.
//
// Architettura: pure function dispatcher per `kind`. Ogni predictor ritorna
// la stessa shape `GoalPrediction` per consumo uniforme da UI + prompt.
//
// Riferimenti scientifici:
//  - Corsa pace: Daniels & Gilbert 1979, Daniels 2022 "Running Formula" 4th ed,
//    Daniels-Yarbrough-Foster 1978 (PMID 689008), Pfitzinger consensus
//  - Peso: ACSM Donnelly 2009 (PMID 19127177), Hall 2011 Lancet (PMID 21872751)
//  - Calcio match: Krustrup 2006 (PMID 16826022), 2010 (PMID 19945979)
//  - Forza 1RM: Schoenfeld 2017 (PMID 27433992), Rhea 2003 (PMID 12618576)
//  - Resistenza durata: Pfitzinger consensus, Lydiard 10%/sett rule

import type { UserProfile } from "../types";

export type GoalKind = "corsa_pace" | "peso" | "calcio_match" | "forza_1rm" | "resistenza_durata" | "frequenza" | "generic";

export type GoalFeasibility = "ok" | "stretch" | "aggressive" | "infeasible" | "unknown";

export interface GoalPrediction {
  feasibility: GoalFeasibility;
  /** Valore predetto alla deadline a progressione safe. Stessa unità del target. */
  predictedFinalValue: number | null;
  /** Settimane minime per raggiungere il target a sustainable rate. */
  realisticDeadlineWeeks: number | null;
  /** Target raggiungibile entro la deadline data (se infeasible, valore < target). */
  realisticTargetAtDeadline: number | null;
  /** Multiplier volume raccomandato per `computePrescription` (1.00-1.10). */
  recommendedVolumeMultiplier: number;
  /** Spiegazione 1-2 frasi per UI tooltip + prompt LLM. */
  reasoning: string;
  /** Paper di riferimento (citazione breve). */
  scienceCitation: string;
}

// ─── Daniels VDOT helpers (Daniels & Gilbert 1979) ────────────────────────

/** Velocità (m/min) → VO2 (ml/kg/min). Daniels & Gilbert 1979. */
function vO2FromVelocity(v_m_per_min: number): number {
  return -4.60 + 0.182258 * v_m_per_min + 0.000104 * v_m_per_min * v_m_per_min;
}

/** %VO2max in funzione del tempo race (min). Daniels & Gilbert 1979. */
function pctVo2maxFromTime(timeMin: number): number {
  return 0.8
    + 0.1894393 * Math.exp(-0.012778 * timeMin)
    + 0.2989558 * Math.exp(-0.1932605 * timeMin);
}

/**
 * Pace (sec/km) + distanza race (km) → VDOT.
 * Es: pace 5:00/km su 10K → ~46 VDOT.
 */
export function paceToVdot(paceSecPerKm: number, raceDistanceKm: number = 10): number {
  if (paceSecPerKm <= 0 || raceDistanceKm <= 0) return 0;
  const v_m_per_min = 60000 / paceSecPerKm;
  const vo2 = vO2FromVelocity(v_m_per_min);
  const timeMin = (raceDistanceKm * paceSecPerKm) / 60;
  const pct = pctVo2maxFromTime(timeMin);
  return vo2 / pct;
}

/**
 * VDOT + distanza race → pace (sec/km). Bisezione iterativa per inversione
 * della formula Daniels (non chiusa analiticamente).
 */
export function vdotToPace(vdot: number, raceDistanceKm: number = 10): number {
  if (vdot <= 0) return 0;
  let lo = 150, hi = 600; // 2:30/km - 10:00/km (range realistico)
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = paceToVdot(mid, raceDistanceKm);
    if (v > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── Constants peer-reviewed per kind ─────────────────────────────────────

/** Gain VDOT/sett sostenibile cronicamente. Daniels-Yarbrough 1978 + Pfitzinger consensus. */
const VDOT_GAIN_SUSTAINABLE = 0.04;
/** Gain VDOT/sett picco acuto (Magness "Science of Running" 2014, max 4-6 sett). */
const VDOT_GAIN_ACUTE_PEAK = 0.5;

/** kg/sett perdita peso sostenibile. ACSM Donnelly 2009. */
const WEIGHT_LOSS_SUSTAINABLE_KG_WEEK = 0.5;
/** kg/sett perdita peso massima safe. Oltre = perdita LBM, RED-S risk. */
const WEIGHT_LOSS_MAX_KG_WEEK = 1.0;

/** % 1RM gain/sett per esperienza. Schoenfeld 2017, Rhea 2003. */
const STRENGTH_GAIN_PCT_WEEK: Record<UserProfile["experience"], number> = {
  sedentary: 0.025,    // 2.5%/sett early phase (newbie effect)
  occasional: 0.015,   // 1.5%/sett (early-intermediate)
  regular: 0.0075,     // 0.75%/sett (intermediate)
  competitive: 0.002,  // 0.2%/sett (advanced/elite)
};

/** Settimane minime build aerobico calcio amatoriale partita 90min. Krustrup. */
const SOCCER_AEROBIC_BUILD_MIN_WEEKS = 6;

/** Volume cap (Lydiard rule + Gabbett 2016 ACWR). */
const VOLUME_MULTIPLIER_CAP = 1.10;

// ─── Predictors per kind ──────────────────────────────────────────────────

/**
 * Classifica feasibility da urgency ratio.
 * urgency = gain_required / sustainable_rate
 */
function classifyFeasibility(urgency: number): GoalFeasibility {
  if (urgency <= 1) return "ok";
  if (urgency <= 3) return "stretch";
  if (urgency <= 10) return "aggressive";
  return "infeasible";
}

/** Multiplier volume da urgency, capped a +10% (Lydiard/Gabbett). */
function multiplierFromUrgency(urgency: number): number {
  if (urgency <= 0.5) return 1.0;
  if (urgency <= 1) return 1.0 + (urgency - 0.5) * 0.1; // 0 → +5%
  if (urgency <= 3) return Math.min(1.05 + (urgency - 1) * 0.025, 1.10); // verso cap
  return VOLUME_MULTIPLIER_CAP;
}

/**
 * Goal corsa pace: predict via Daniels VDOT trajectory.
 * - currentPaceSec: media pace ultime 14gg
 * - targetPaceSec: pace target del goal
 * - raceDistanceKm: distanza race (default 10K)
 */
export function predictRunningPace(
  currentPaceSec: number,
  targetPaceSec: number,
  raceDistanceKm: number,
  weeksLeft: number,
): GoalPrediction {
  if (currentPaceSec <= 0 || targetPaceSec <= 0 || weeksLeft <= 0) {
    return baseUnknown("Daniels & Gilbert 1979 / Daniels 2022");
  }
  const vdotCurrent = paceToVdot(currentPaceSec, raceDistanceKm);
  const vdotTarget = paceToVdot(targetPaceSec, raceDistanceKm);
  const gainRequired = (vdotTarget - vdotCurrent) / weeksLeft;
  // Se già al/oltre il target → ok (no boost)
  if (gainRequired <= 0) {
    return {
      feasibility: "ok",
      predictedFinalValue: targetPaceSec,
      realisticDeadlineWeeks: 0,
      realisticTargetAtDeadline: targetPaceSec,
      recommendedVolumeMultiplier: 1.0,
      reasoning: `Sei già al passo target (${formatSec(currentPaceSec)}/km vs target ${formatSec(targetPaceSec)}/km, VDOT ${vdotCurrent.toFixed(1)}). Mantieni progressione standard.`,
      scienceCitation: "Daniels VDOT 2022, Pfitzinger consensus",
    };
  }
  const urgency = gainRequired / VDOT_GAIN_SUSTAINABLE;
  const feasibility = classifyFeasibility(urgency);
  const multiplier = multiplierFromUrgency(urgency);
  // Predicted VDOT alla deadline a sustainable rate (con bonus se aggressive→peak)
  const effectiveGain = feasibility === "aggressive" || feasibility === "infeasible"
    ? Math.min(VDOT_GAIN_ACUTE_PEAK, gainRequired)
    : VDOT_GAIN_SUSTAINABLE;
  const vdotPredicted = vdotCurrent + effectiveGain * weeksLeft;
  const pacePredicted = vdotToPace(vdotPredicted, raceDistanceKm);
  const realisticWeeks = Math.ceil((vdotTarget - vdotCurrent) / VDOT_GAIN_SUSTAINABLE);
  const reasoning = (() => {
    if (feasibility === "ok") {
      return `Gap VDOT ${(vdotTarget - vdotCurrent).toFixed(1)} in ${weeksLeft} sett: gain richiesto ${gainRequired.toFixed(2)}/sett ≤ sustainable ${VDOT_GAIN_SUSTAINABLE}/sett. Predetto: ${formatSec(pacePredicted)}/km.`;
    }
    if (feasibility === "stretch") {
      return `Gap VDOT ${(vdotTarget - vdotCurrent).toFixed(1)} in ${weeksLeft} sett: gain ${gainRequired.toFixed(2)}/sett (urgency ${urgency.toFixed(1)}× sustainable). Push aggressivo necessario, fattibile. Predetto: ${formatSec(pacePredicted)}/km.`;
    }
    if (feasibility === "aggressive") {
      return `Gap VDOT ${(vdotTarget - vdotCurrent).toFixed(1)} in ${weeksLeft} sett: gain ${gainRequired.toFixed(2)}/sett (urgency ${urgency.toFixed(1)}× sustainable, dentro picco acuto Magness). Realisticamente raggiungibile alla deadline: ${formatSec(pacePredicted)}/km. Deadline minima per target a rate sustainable: ~${realisticWeeks} sett.`;
    }
    return `Gap VDOT ${(vdotTarget - vdotCurrent).toFixed(1)} in ${weeksLeft} sett: gain richiesto ${gainRequired.toFixed(2)}/sett è ${urgency.toFixed(0)}× il sustainable (0.04) e oltre il picco acuto (0.5). FISIOLOGICAMENTE IMPOSSIBILE. Realisticamente in ${weeksLeft} sett: pace ~${formatSec(pacePredicted)}/km. Deadline minima per pace target: ~${realisticWeeks} sett (${Math.ceil(realisticWeeks / 4)} mesi).`;
  })();
  return {
    feasibility,
    predictedFinalValue: pacePredicted,
    realisticDeadlineWeeks: realisticWeeks,
    realisticTargetAtDeadline: pacePredicted,
    recommendedVolumeMultiplier: multiplier,
    reasoning,
    scienceCitation: "Daniels VDOT 2022 (PMID 689008), Pfitzinger 'Advanced Marathoning'",
  };
}

/** Goal perdita peso. ACSM 0.5 kg/sett sustainable, 1 kg/sett max safe. */
export function predictWeightLoss(
  currentKg: number,
  targetKg: number,
  weeksLeft: number,
): GoalPrediction {
  if (currentKg <= 0 || targetKg <= 0 || weeksLeft <= 0) {
    return baseUnknown("ACSM Donnelly 2009 (PMID 19127177)");
  }
  const kgToLose = currentKg - targetKg;
  if (kgToLose <= 0) {
    return {
      feasibility: "ok",
      predictedFinalValue: targetKg,
      realisticDeadlineWeeks: 0,
      realisticTargetAtDeadline: targetKg,
      recommendedVolumeMultiplier: 1.0,
      reasoning: `Già a/sotto il peso target (${currentKg}kg vs target ${targetKg}kg). Mantenimento.`,
      scienceCitation: "ACSM Donnelly 2009",
    };
  }
  const rateRequired = kgToLose / weeksLeft;
  const urgency = rateRequired / WEIGHT_LOSS_SUSTAINABLE_KG_WEEK;
  const feasibility = classifyFeasibility(urgency);
  // NOTA: per perdita peso il volume cardio NON chiude il gap (è il deficit
  // calorico). Il multiplier resta basso anche se aggressive (volume non aiuta).
  const multiplier = urgency > 1 ? 1.05 : 1.0;
  const effectiveRate = Math.min(WEIGHT_LOSS_MAX_KG_WEEK, rateRequired);
  const predicted = currentKg - effectiveRate * weeksLeft;
  const realisticWeeks = Math.ceil(kgToLose / WEIGHT_LOSS_SUSTAINABLE_KG_WEEK);
  const reasoning = (() => {
    if (feasibility === "ok") return `${kgToLose}kg in ${weeksLeft} sett = ${rateRequired.toFixed(2)} kg/sett ≤ sustainable 0.5 kg/sett. Realistico, predetto ${predicted.toFixed(1)}kg.`;
    if (feasibility === "stretch") return `${kgToLose}kg in ${weeksLeft} sett = ${rateRequired.toFixed(2)} kg/sett. Push deficit calorico (~-500 kcal/giorno). Fattibile ma stressante.`;
    if (feasibility === "aggressive") return `${kgToLose}kg in ${weeksLeft} sett = ${rateRequired.toFixed(2)} kg/sett > 1 kg/sett (max safe ACSM). Rischio perdita massa magra + RED-S. Predetto realistico: ${predicted.toFixed(1)}kg. Deadline minima: ${realisticWeeks} sett.`;
    return `${kgToLose}kg in ${weeksLeft} sett = ${rateRequired.toFixed(2)} kg/sett > 1.5× max safe. NON consigliato. In ${weeksLeft} sett puoi perdere realisticamente ${(WEIGHT_LOSS_MAX_KG_WEEK * weeksLeft).toFixed(1)}kg max. Deadline minima per ${kgToLose}kg: ${realisticWeeks} sett (~${Math.ceil(realisticWeeks / 4)} mesi).`;
  })();
  return {
    feasibility,
    predictedFinalValue: predicted,
    realisticDeadlineWeeks: realisticWeeks,
    realisticTargetAtDeadline: predicted,
    recommendedVolumeMultiplier: multiplier,
    reasoning,
    scienceCitation: "ACSM Donnelly 2009 (PMID 19127177), Hall 2011 Lancet (PMID 21872751)",
  };
}

/**
 * Goal calcio match: serve base aerobica per 90min. Krustrup 2006.
 * - aerobicSessionsLast8Weeks: count corse/cardio continuativi >=30min ultimi 8 sett
 */
export function predictSoccerReady(
  aerobicSessionsLast8Weeks: number,
  weeksLeft: number,
): GoalPrediction {
  if (weeksLeft <= 0) return baseUnknown("Krustrup 2006/2010");
  // Heuristic: serve base aerobica sostenuta. >=12 sessioni in 8 sett (~1.5/sett) = base solida
  const baseSolida = aerobicSessionsLast8Weeks >= 12;
  const baseModerata = aerobicSessionsLast8Weeks >= 6;
  const baseAssente = aerobicSessionsLast8Weeks < 6;
  let feasibility: GoalFeasibility;
  let multiplier: number;
  let reasoning: string;
  let realisticWeeks: number;
  if (baseSolida) {
    feasibility = "ok";
    multiplier = 1.0;
    realisticWeeks = 0;
    reasoning = `Base aerobica solida (${aerobicSessionsLast8Weeks} sessioni cardio ≥30min in 8 sett). Pronto per partita 90min. Aggiungi 1-2 sport intermittenti pre-match per attivazione neuromuscolare.`;
  } else if (baseModerata && weeksLeft >= 4) {
    feasibility = "stretch";
    multiplier = 1.05;
    realisticWeeks = SOCCER_AEROBIC_BUILD_MIN_WEEKS - Math.floor(aerobicSessionsLast8Weeks / 2);
    reasoning = `Base aerobica moderata (${aerobicSessionsLast8Weeks} sessioni in 8 sett). In ${weeksLeft} sett puoi consolidare. Build progressivo 3 corse/sett Z2 30-45min + 1 sport intermittente.`;
  } else if (baseAssente && weeksLeft < SOCCER_AEROBIC_BUILD_MIN_WEEKS) {
    feasibility = "infeasible";
    multiplier = VOLUME_MULTIPLIER_CAP;
    realisticWeeks = SOCCER_AEROBIC_BUILD_MIN_WEEKS;
    reasoning = `Base aerobica assente (${aerobicSessionsLast8Weeks} sessioni in 8 sett) e solo ${weeksLeft} sett alla partita. RISCHIO INFORTUNIO ELEVATO (Krustrup 2006: 90min calcio = 8-12km + 600 cambi direzione + 30 sprint massimali). Costruisci base aerobica per ≥${SOCCER_AEROBIC_BUILD_MIN_WEEKS} sett prima di tentare 90min, oppure sostituisci con calcio a 5/7 (intensità ridotta).`;
  } else {
    feasibility = "stretch";
    multiplier = 1.05;
    realisticWeeks = SOCCER_AEROBIC_BUILD_MIN_WEEKS;
    reasoning = `Base ${aerobicSessionsLast8Weeks > 0 ? "minima" : "assente"} (${aerobicSessionsLast8Weeks} sessioni in 8 sett). ${weeksLeft} sett a disposizione: build aerobico aggressivo necessario. 4-5 sessioni cardio Z2/Z3 + drill sport-specific FIFA 11+.`;
  }
  return {
    feasibility,
    predictedFinalValue: aerobicSessionsLast8Weeks + Math.round(weeksLeft * 1.5),
    realisticDeadlineWeeks: realisticWeeks,
    realisticTargetAtDeadline: 12,
    recommendedVolumeMultiplier: multiplier,
    reasoning,
    scienceCitation: "Krustrup 2006 (PMID 16826022), 2010 (PMID 19945979); Bangsbo Yo-Yo IR test",
  };
}

/** Goal forza 1RM. Schoenfeld 2017 + Rhea 2003 caps per esperienza. */
export function predictStrength1RM(
  currentKg: number,
  targetKg: number,
  weeksLeft: number,
  experience: UserProfile["experience"],
): GoalPrediction {
  if (currentKg <= 0 || targetKg <= 0 || weeksLeft <= 0) {
    return baseUnknown("Schoenfeld 2017 (PMID 27433992)");
  }
  const kgToGain = targetKg - currentKg;
  if (kgToGain <= 0) {
    return {
      feasibility: "ok",
      predictedFinalValue: targetKg,
      realisticDeadlineWeeks: 0,
      realisticTargetAtDeadline: targetKg,
      recommendedVolumeMultiplier: 1.0,
      reasoning: `Già a/oltre il 1RM target (${currentKg}kg vs ${targetKg}kg).`,
      scienceCitation: "Schoenfeld 2017",
    };
  }
  const sustainableGainKgWeek = currentKg * STRENGTH_GAIN_PCT_WEEK[experience];
  const rateRequired = kgToGain / weeksLeft;
  const urgency = rateRequired / sustainableGainKgWeek;
  const feasibility = classifyFeasibility(urgency);
  const multiplier = multiplierFromUrgency(urgency);
  const predicted = currentKg + sustainableGainKgWeek * weeksLeft;
  const realisticWeeks = Math.ceil(kgToGain / sustainableGainKgWeek);
  const reasoning = (() => {
    const ratePct = (STRENGTH_GAIN_PCT_WEEK[experience] * 100).toFixed(2);
    if (feasibility === "ok") return `Gap ${kgToGain}kg in ${weeksLeft} sett: rate ${rateRequired.toFixed(2)} kg/sett ≤ sustainable ${sustainableGainKgWeek.toFixed(2)} kg/sett (${ratePct}%/sett ${experience}). Predetto: ${predicted.toFixed(1)}kg.`;
    if (feasibility === "stretch") return `Gap ${kgToGain}kg in ${weeksLeft} sett: rate ${rateRequired.toFixed(2)} kg/sett (urgency ${urgency.toFixed(1)}× sustainable). Push fattibile.`;
    if (feasibility === "aggressive") return `Gap ${kgToGain}kg in ${weeksLeft} sett: rate ${rateRequired.toFixed(2)} kg/sett >> sustainable ${sustainableGainKgWeek.toFixed(2)} kg/sett (${ratePct}%/sett ${experience}). Predetto realistico: ${predicted.toFixed(1)}kg. Deadline minima: ${realisticWeeks} sett.`;
    return `Gap ${kgToGain}kg in ${weeksLeft} sett è ${urgency.toFixed(0)}× il sustainable per ${experience}. Irrealistico. Predetto: ${predicted.toFixed(1)}kg. Deadline minima: ${realisticWeeks} sett (~${Math.ceil(realisticWeeks / 4)} mesi).`;
  })();
  return {
    feasibility,
    predictedFinalValue: predicted,
    realisticDeadlineWeeks: realisticWeeks,
    realisticTargetAtDeadline: predicted,
    recommendedVolumeMultiplier: multiplier,
    reasoning,
    scienceCitation: "Schoenfeld 2017 (PMID 27433992), Rhea 2003 meta (PMID 12618576)",
  };
}

/**
 * Goal resistenza durata: target durata continua (es. "correre 1h").
 * Lydiard 10%/sett rule per ramping.
 */
export function predictEnduranceDuration(
  currentMaxMin: number,
  targetMin: number,
  weeksLeft: number,
): GoalPrediction {
  if (targetMin <= 0 || weeksLeft <= 0) return baseUnknown("Pfitzinger consensus, Lydiard");
  if (currentMaxMin >= targetMin) {
    return {
      feasibility: "ok",
      predictedFinalValue: targetMin,
      realisticDeadlineWeeks: 0,
      realisticTargetAtDeadline: targetMin,
      recommendedVolumeMultiplier: 1.0,
      reasoning: `Già al/oltre il target durata (${currentMaxMin}min vs ${targetMin}min). Mantieni.`,
      scienceCitation: "Pfitzinger consensus",
    };
  }
  // Lydiard: max 10% durata/sett. predicted = currentMaxMin * 1.1^weeksLeft (capped)
  const predicted = Math.min(targetMin, currentMaxMin * Math.pow(1.10, weeksLeft));
  const realisticWeeks = currentMaxMin > 0
    ? Math.ceil(Math.log(targetMin / currentMaxMin) / Math.log(1.10))
    : Math.ceil(targetMin / 5); // da zero: parti da 5min, ramp +10% (couch-to-X)
  const urgency = realisticWeeks / weeksLeft;
  const feasibility = classifyFeasibility(urgency);
  const multiplier = multiplierFromUrgency(urgency);
  const reasoning = (() => {
    if (feasibility === "ok") return `Gap ${targetMin - currentMaxMin}min: a Lydiard 10%/sett predetto ${predicted.toFixed(0)}min in ${weeksLeft} sett. Realistico.`;
    if (feasibility === "stretch") return `Gap ${targetMin - currentMaxMin}min: serve push aggressivo. Predetto ${predicted.toFixed(0)}min, target ${targetMin}min. Deadline minima safe: ${realisticWeeks} sett.`;
    if (feasibility === "aggressive") return `Gap ${targetMin - currentMaxMin}min in ${weeksLeft} sett richiede progressione oltre Lydiard 10%/sett (rischio infortunio). Predetto safe: ${predicted.toFixed(0)}min. Deadline minima: ${realisticWeeks} sett.`;
    return `Gap ${targetMin - currentMaxMin}min in ${weeksLeft} sett è impossibile a ramping safe (Lydiard 10%/sett). Predetto ${predicted.toFixed(0)}min. Deadline minima: ${realisticWeeks} sett.`;
  })();
  return {
    feasibility,
    predictedFinalValue: predicted,
    realisticDeadlineWeeks: realisticWeeks,
    realisticTargetAtDeadline: predicted,
    recommendedVolumeMultiplier: multiplier,
    reasoning,
    scienceCitation: "Pfitzinger 'Advanced Marathoning'; Lydiard 10%/sett rule",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatSec(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

function baseUnknown(citation: string): GoalPrediction {
  return {
    feasibility: "unknown",
    predictedFinalValue: null,
    realisticDeadlineWeeks: null,
    realisticTargetAtDeadline: null,
    recommendedVolumeMultiplier: 1.0,
    reasoning: "Dati insufficienti per predizione.",
    scienceCitation: citation,
  };
}
