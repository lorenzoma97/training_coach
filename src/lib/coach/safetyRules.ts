// Regole di sicurezza hardcoded iniettate nel system prompt.
// Il coach deve rispettarle. Sono anche usate lato client per alert immediati.

export const SAFETY = {
  // Progressione carico
  weeklyVolumeIncreaseMaxPct: 10,
  restDaysMinPerWeek: 2,

  // Neofita / sedentario
  beginnerRunCapMinutesPerSession: 25,
  beginnerRunCapMinutesPerWeek: 90,
  beginnerRunPace: "alternato camminata/corsa",

  // Soglie dolore (scala 0-4+ del diario)
  painStopThreshold: 3,
  painWarnThreshold: 2,

  // Red flag combo
  sleepFatigueRedFlag: { sleepMaxH: 6, fatigueMin: 8, consecutiveDays: 2 },

  // FC di riferimento
  maxHRFormula: "208 - (0.7 * age)",           // Tanaka
  z2UpperPct: 0.75,                             // FC > 75% FCmax in fondo lento = troppo alto
  z2LowerPct: 0.60,

  // RPE
  rpeEasySessionCap: 6,                         // RPE > 6 su fondo lento = segnale

  // Deficit calorico / perdita peso (se mai entrasse)
  maxWeightLossPerWeekKg: 0.8,

  // Obiettivi non raggiungibili
  beginnerMaxRaceDistanceAt8w: 5,               // km realistici per neofita in 8 settimane

  // Disclaimer
  notMedicalAdvice: "Questo coach non sostituisce medico, fisioterapista o preparatore. Sospendi e consulta uno specialista per dolore persistente, sintomi anomali, o decisioni cliniche.",
} as const;

export function safetyRulesAsPrompt(): string {
  return `
REGOLE DI SICUREZZA (vincolanti, non negoziabili):
- Progressione volume massima: +${SAFETY.weeklyVolumeIncreaseMaxPct}% a settimana.
- Minimo ${SAFETY.restDaysMinPerWeek} giorni di riposo/recovery a settimana.
- Neofita/sedentario: corsa max ${SAFETY.beginnerRunCapMinutesPerSession} min/sessione, ${SAFETY.beginnerRunCapMinutesPerWeek} min/settimana, modalità ${SAFETY.beginnerRunPace}.
- Dolore polpaccio (scala 0-4+ del diario): ≥${SAFETY.painStopThreshold} = STOP IMMEDIATO, valutare medico; =${SAFETY.painWarnThreshold} = ridurre intensità.
- Red flag overtraining: sonno ≤${SAFETY.sleepFatigueRedFlag.sleepMaxH}h + stanchezza ≥${SAFETY.sleepFatigueRedFlag.fatigueMin}/10 per ≥${SAFETY.sleepFatigueRedFlag.consecutiveDays} giorni consecutivi → deload obbligatorio.
- FC media > ${SAFETY.z2UpperPct * 100}% FCmax (Tanaka: ${SAFETY.maxHRFormula}) su fondo lento = troppo alta, rallentare.
- RPE > ${SAFETY.rpeEasySessionCap} su sessione Z2/fondo lento = sforzo sproporzionato, riconsiderare.
- Perdita peso realistica: max ${SAFETY.maxWeightLossPerWeekKg} kg/settimana.
- Obiettivi per neofita: max ~${SAFETY.beginnerMaxRaceDistanceAt8w} km di gara in 8 settimane di preparazione.

DISCLAIMER (da ricordare se rilevante): ${SAFETY.notMedicalAdvice}
`.trim();
}

export interface RedFlagCheck {
  level: "none" | "warn" | "danger";
  reasons: string[];
}

export function checkLocalRedFlags(input: {
  workout?: any;
  last7Days?: any[];
  profile?: { age?: number } | null;
}): RedFlagCheck {
  const reasons: string[] = [];
  let level: "none" | "warn" | "danger" = "none";

  const w = input.workout;
  if (w?.pain) {
    const maxPain = Math.max(w.pain.pre ?? 0, w.pain.during ?? 0, w.pain.post ?? 0);
    if (maxPain >= SAFETY.painStopThreshold) {
      reasons.push(`Dolore polpaccio ${maxPain}/4 — STOP allenamento, consulta specialista.`);
      level = "danger";
    } else if (maxPain >= SAFETY.painWarnThreshold) {
      reasons.push(`Dolore polpaccio ${maxPain}/4 — monitora, riduci intensità.`);
      if (level === "none") level = "warn";
    }
  }

  // RPE sproporzionato
  if (w?.rpe && w.rpe > SAFETY.rpeEasySessionCap) {
    const tipo = (w?.fields?.tipo || "").toLowerCase();
    if (tipo.includes("fondo lento") || tipo.includes("z2")) {
      reasons.push(`RPE ${w.rpe}/10 su fondo lento: sforzo troppo alto.`);
      if (level === "none") level = "warn";
    }
  }

  // FC alta su fondo lento
  if (w?.fields?.fc_media && input.profile?.age) {
    const fcMax = 208 - 0.7 * input.profile.age;
    const pct = Number(w.fields.fc_media) / fcMax;
    const tipo = (w.fields.tipo || "").toLowerCase();
    if ((tipo.includes("fondo lento") || tipo.includes("z2")) && pct > SAFETY.z2UpperPct) {
      reasons.push(`FC media ${w.fields.fc_media} bpm = ${Math.round(pct * 100)}% FCmax: troppo alta per Z2.`);
      if (level === "none") level = "warn";
    }
  }

  // Combo sonno + stanchezza consecutivi (richiede last7Days)
  if (input.last7Days?.length) {
    let streak = 0;
    const sorted = [...input.last7Days].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    for (const d of sorted) {
      const daily = d.daily;
      if (daily && Number(daily.sleep) <= SAFETY.sleepFatigueRedFlag.sleepMaxH && Number(daily.fatigue) >= SAFETY.sleepFatigueRedFlag.fatigueMin) {
        streak++;
      } else {
        streak = 0;
      }
    }
    if (streak >= SAFETY.sleepFatigueRedFlag.consecutiveDays) {
      reasons.push(`Sonno scarso + stanchezza alta per ${streak} giorni consecutivi — deload consigliato.`);
      if (level !== "danger") level = "warn";
    }
  }

  return { level, reasons };
}
