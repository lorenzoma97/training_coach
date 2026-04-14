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

  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const w = input.workout;
  // Normalizza due formati: legacy {pre,during,post} (polpaccio) e nuovo {[area]:{pre,during,post}}
  const painEntries: Array<{ area: string; max: number }> = [];
  if (w?.pain && typeof w.pain === "object") {
    const isLegacy = "pre" in w.pain || "during" in w.pain || "post" in w.pain;
    if (isLegacy) {
      const pre = toNum(w.pain.pre) ?? 0;
      const dur = toNum(w.pain.during) ?? 0;
      const post = toNum(w.pain.post) ?? 0;
      painEntries.push({ area: "polpaccio", max: Math.max(pre, dur, post) });
    } else {
      for (const [area, v] of Object.entries(w.pain)) {
        if (v && typeof v === "object") {
          const p = toNum((v as any).pre) ?? 0;
          const d = toNum((v as any).during) ?? 0;
          const po = toNum((v as any).post) ?? 0;
          const max = Math.max(p, d, po);
          if (max > 0) painEntries.push({ area, max });
        }
      }
    }
  }
  for (const { area, max: maxPain } of painEntries) {
    if (maxPain >= SAFETY.painStopThreshold) {
      reasons.push(`Dolore ${area} ${maxPain}/4 — STOP allenamento, consulta specialista.`);
      level = "danger";
    } else if (maxPain >= SAFETY.painWarnThreshold) {
      reasons.push(`Dolore ${area} ${maxPain}/4 — monitora, riduci intensità.`);
      if (level === "none") level = "warn";
    }
  }

  // RPE sproporzionato
  const rpe = toNum(w?.rpe);
  if (rpe !== null && rpe > SAFETY.rpeEasySessionCap) {
    const tipo = (w?.fields?.tipo || "").toLowerCase();
    if (tipo.includes("fondo lento") || tipo.includes("z2")) {
      reasons.push(`RPE ${rpe}/10 su fondo lento: sforzo troppo alto.`);
      if (level === "none") level = "warn";
    }
  }

  // FC alta su fondo lento
  const fcMedia = toNum(w?.fields?.fc_media);
  const age = toNum(input.profile?.age);
  if (fcMedia !== null && age !== null && age > 0) {
    const fcMax = 208 - 0.7 * age;
    const pct = fcMedia / fcMax;
    const tipo = (w.fields.tipo || "").toLowerCase();
    if ((tipo.includes("fondo lento") || tipo.includes("z2")) && pct > SAFETY.z2UpperPct) {
      reasons.push(`FC media ${fcMedia} bpm = ${Math.round(pct * 100)}% FCmax: troppo alta per Z2.`);
      if (level === "none") level = "warn";
    }
  }

  // Combo sonno + stanchezza consecutivi (richiede last7Days)
  if (input.last7Days?.length) {
    let streak = 0;
    const sorted = [...input.last7Days].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    for (const d of sorted) {
      const daily = d.daily;
      const sleep = toNum(daily?.sleep);
      const fatigue = toNum(daily?.fatigue);
      if (sleep !== null && fatigue !== null &&
          sleep <= SAFETY.sleepFatigueRedFlag.sleepMaxH &&
          fatigue >= SAFETY.sleepFatigueRedFlag.fatigueMin) {
        streak++;
      } else {
        streak = 0;
      }
    }
    if (streak >= SAFETY.sleepFatigueRedFlag.consecutiveDays) {
      reasons.push(`Sonno scarso + stanchezza alta per ${streak} giorni consecutivi — deload consigliato.`);
      if (level !== "danger") level = "warn";
    }

    // Red flag RED-S: amenorrea registrata >= 2 volte negli ultimi 30 giorni
    const amenorreaCount = input.last7Days.filter(d => d?.daily?.cyclePhase === "amenorrea").length;
    if (amenorreaCount >= 2) {
      reasons.push(`Amenorrea registrata ${amenorreaCount} volte — possibile segnale RED-S. Consulta medico sportivo/endocrinologo.`);
      level = "danger";
    }
  }

  return { level, reasons };
}
