// Regole di sicurezza hardcoded iniettate nel system prompt.
// Il coach deve rispettarle. Sono anche usate lato client per alert immediati.
// Ogni soglia è ancorata a paper peer-reviewed elencati in docs/scientific-foundations.md.

export const SAFETY = {
  // Progressione carico — paradigma aggiornato (Johansen 2025 BJSM):
  // il rischio primario non è il volume settimanale ma lo SPIKE della singola sessione
  // vs. la sessione più lunga recente. Il paper identifica 10-30% come banda di rischio
  // associata a +64% rischio overuse. Scegliamo 20% come valore intermedio: allerta nel
  // cuore della banda di rischio senza generare falsi positivi ad ogni piccola progressione.
  sessionSpikeMaxPct: 20,              // Johansen 2025 — soglia intermedia della banda di rischio 10-30%
  weeklyVolumeIncreaseMaxPct: 10,      // Buist 2008: non rigorosamente evidence-based. Tenuto come safeguard conservativo solo per neofiti.

  // Giorni riposo: age-tiered (ACSM Chodzko-Zajko 2009, Fell & Williams 2008, Doering 2016).
  // Usare restDaysMinForAge() invece dell'accesso diretto.
  restDaysMinDefault: 2,
  restDaysMinMidAge: 3,                // 50-64 anni
  restDaysMinSenior: 3,                // 65+ (inoltre max 2 giorni consecutivi allenamento)

  // Neofita / sedentario — Videbæk 2015, Buist 2010, ACSM/Piercy 2018.
  beginnerRunCapMinutesPerSession: 25,
  beginnerRunCapMinutesPerWeek: 90,
  beginnerRunPace: "alternato camminata/corsa",

  // Soglie dolore (scala 0-4+ del diario) — Silbernagel 2007 (≤5/10 tollerabile).
  // Allineate alla semantica della scala: 2=avvertibile, 3=localizzato (riduci), 4=a spillo (STOP).
  painStopThreshold: 4,                // ≥4 = STOP (a spillo)
  painWarnThreshold: 3,                // =3 = riduci intensità
  painMonitorThreshold: 2,             // =2 = monitora

  // Red flag overtraining — Watson AASM 2015 (≥7h), Walsh BJSM 2021 (≥3 notti consecutive), Fullagar 2015.
  sleepFatigueRedFlag: { sleepMaxH: 7, fatigueMin: 8, consecutiveDays: 3 },

  // FC di riferimento
  maxHRFormula: "208 - (0.7 * age)",   // Tanaka 2001 (errore ±10bpm; ±5-10% da wearable PPG — Mühlen 2021)
  z2UpperPct: 0.75,                    // Seiler 2010, Stöggl/Sperlich 2014
  z2LowerPct: 0.60,

  // RPE
  rpeEasySessionCap: 6,                // Foster 2001, Haddad 2017 — RPE>6 su Z2 = zona soglia

  // Deficit calorico / perdita peso
  maxWeightLossPerWeekKg: 0.8,         // Donnelly ACSM 2009 (range safe 0.5-1 kg)

  // Obiettivi non raggiungibili
  beginnerMaxRaceDistanceAt8w: 5,

  // Disclaimer
  notMedicalAdvice: "Questo coach non sostituisce medico, fisioterapista o preparatore. Sospendi e consulta uno specialista per dolore persistente, sintomi anomali, o decisioni cliniche.",
} as const;

/** Giorni di riposo minimi/settimana in base all'età (Chodzko-Zajko 2009, Fell 2008). */
export function restDaysMinForAge(age: number | null | undefined): number {
  if (age && age >= 65) return SAFETY.restDaysMinSenior;
  if (age && age >= 50) return SAFETY.restDaysMinMidAge;
  return SAFETY.restDaysMinDefault;
}

export function safetyRulesAsPrompt(ctx?: { age?: number | null }): string {
  const restDays = restDaysMinForAge(ctx?.age ?? null);
  const ageAdaptNote = (ctx?.age && ctx.age >= 65)
    ? ` (utente ≥65 anni: inoltre MAX 2 giorni consecutivi di allenamento, Chodzko-Zajko ACSM 2009)`
    : (ctx?.age && ctx.age >= 50)
      ? ` (utente 50-64 anni: recupero post-sessione più lento vs. giovani, Fell 2008)`
      : "";

  return `
REGOLE DI SICUREZZA (vincolanti, non negoziabili):
- Progressione singola sessione: la durata di una sessione di corsa non deve superare di oltre +${SAFETY.sessionSpikeMaxPct}% la sessione più lunga delle sessioni recenti dell'utente (finestra ~7-30 giorni). Johansen 2025 identifica la banda 10-30% come zona di rischio (+64% overuse). Questa regola sostituisce il vecchio cap "+10%/settimana" che è solo safeguard prudenziale per neofiti assoluti (Buist 2008 mostra assenza di evidenza per la regola del 10%). Nota: quando il contesto fornisce un dato pre-calcolato "spike_pct_vs_recente", usa quello; altrimenti stima dalla lista sessioni recenti.
- Minimo ${restDays} giorni di riposo/recovery a settimana${ageAdaptNote}.
- Neofita/sedentario: corsa max ${SAFETY.beginnerRunCapMinutesPerSession} min/sessione, ${SAFETY.beginnerRunCapMinutesPerWeek} min/settimana, modalità ${SAFETY.beginnerRunPace} (Videbæk 2015, Buist 2010, ACSM/Piercy 2018).
- Dolore (scala 0-4+ del diario, semantica: 0=nessuno, 1=vago, 2=avvertibile, 3=localizzato, 4+=a spillo): ≥${SAFETY.painStopThreshold} = STOP IMMEDIATO, valutare medico; =${SAFETY.painWarnThreshold} = ridurre intensità; =${SAFETY.painMonitorThreshold} = monitora trend. Principio Silbernagel 2007: per tendinopatie croniche stabili in riabilitazione, un dolore "avvertibile" ma non "localizzato" è tollerabile se torna a baseline entro 24h e non peggiora progressivamente.
- Red flag overtraining: sonno <${SAFETY.sleepFatigueRedFlag.sleepMaxH}h + stanchezza ≥${SAFETY.sleepFatigueRedFlag.fatigueMin}/10 per ≥${SAFETY.sleepFatigueRedFlag.consecutiveDays} giorni consecutivi → deload obbligatorio (Watson AASM 2015 target ≥7h; Walsh BJSM 2021; Fullagar 2015).
- FC media > ${SAFETY.z2UpperPct * 100}% FCmax (Tanaka: ${SAFETY.maxHRFormula}, errore individuale ±10bpm + ±5-10% wearable PPG) su fondo lento = troppo alta, rallentare.
- RPE > ${SAFETY.rpeEasySessionCap} su sessione Z2/fondo lento = sforzo sproporzionato, riconsiderare.
- Perdita peso realistica: max ${SAFETY.maxWeightLossPerWeekKg} kg/settimana (ACSM Donnelly 2009).
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
  /**
   * Se fornita, usa questa zona Z2 personalizzata (Karvonen o empirica) invece
   * della soglia generica Tanaka 75%. Evita di rimproverare un utente che corre
   * correttamente nella sua Z2 più alta (es. atleta con FCrest bassa).
   */
  zoneZ2?: { low: number; high: number };
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
      reasons.push(`Dolore ${area} ${maxPain}/4 (a spillo) — STOP allenamento, consulta specialista.`);
      level = "danger";
    } else if (maxPain >= SAFETY.painWarnThreshold) {
      reasons.push(`Dolore ${area} ${maxPain}/4 (localizzato) — riduci intensità.`);
      if (level === "none") level = "warn";
    } else if (maxPain >= SAFETY.painMonitorThreshold) {
      reasons.push(`Dolore ${area} ${maxPain}/4 (avvertibile) — monitora trend nelle prossime sessioni.`);
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
    const tipo = (w?.fields?.tipo || "").toLowerCase();
    const isEasy = tipo.includes("fondo lento") || tipo.includes("z2");
    if (isEasy) {
      // Priorità: se abbiamo zoneZ2 personalizzata (Karvonen o empirica), usiamola.
      // Altrimenti fallback alla soglia Tanaka 75% (comportamento legacy).
      if (input.zoneZ2) {
        if (fcMedia > input.zoneZ2.high) {
          reasons.push(`FC media ${fcMedia} bpm sopra la tua Z2 personalizzata (${input.zoneZ2.low}-${input.zoneZ2.high} bpm): stavi andando troppo forte per essere un fondo lento.`);
          if (level === "none") level = "warn";
        }
      } else {
        const fcMax = 208 - 0.7 * age;
        const pct = fcMedia / fcMax;
        if (pct > SAFETY.z2UpperPct) {
          reasons.push(`FC media ${fcMedia} bpm = ${Math.round(pct * 100)}% FCmax (Tanaka): troppo alta per Z2. Aggiungi FC a riposo mattutina nel check per una zona più personalizzata.`);
          if (level === "none") level = "warn";
        }
      }
    }
  }

  // Single-session spike detection (Johansen 2025): durata sessione attuale vs. max negli ultimi giorni.
  // Limitazione: abbiamo solo last7Days, ideale sarebbe 30gg. Usiamo 7 come proxy.
  const currentDuration = toNum(w?.fields?.durata_totale) ?? toNum(w?.fields?.durata);
  const currentTipo = (w?.fields?.tipo || "").toLowerCase();
  const isRunning = currentTipo.includes("corsa") || currentTipo.includes("fondo") || currentTipo.includes("ripetute") || currentTipo.includes("progressione") || currentTipo.includes("fartlek");
  if (currentDuration !== null && isRunning && input.last7Days?.length) {
    let maxRecent = 0;
    for (const d of input.last7Days) {
      for (const past of d.workouts || []) {
        const pastTipo = (past?.fields?.tipo || "").toLowerCase();
        const pastIsRun = pastTipo.includes("corsa") || pastTipo.includes("fondo") || pastTipo.includes("ripetute") || pastTipo.includes("progressione") || pastTipo.includes("fartlek");
        if (!pastIsRun) continue;
        const dur = toNum(past?.fields?.durata_totale) ?? toNum(past?.fields?.durata) ?? 0;
        if (dur > maxRecent) maxRecent = dur;
      }
    }
    if (maxRecent > 0) {
      const spikePct = ((currentDuration - maxRecent) / maxRecent) * 100;
      if (spikePct > SAFETY.sessionSpikeMaxPct) {
        reasons.push(`Durata ${currentDuration}min è +${Math.round(spikePct)}% vs. sessione più lunga degli ultimi 7gg (${maxRecent}min): spike >+${SAFETY.sessionSpikeMaxPct}% associato a maggior rischio overuse (Johansen 2025).`);
        if (level === "none") level = "warn";
      }
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
          sleep < SAFETY.sleepFatigueRedFlag.sleepMaxH &&
          fatigue >= SAFETY.sleepFatigueRedFlag.fatigueMin) {
        streak++;
      } else {
        streak = 0;
      }
    }
    if (streak >= SAFETY.sleepFatigueRedFlag.consecutiveDays) {
      reasons.push(`Sonno <${SAFETY.sleepFatigueRedFlag.sleepMaxH}h + stanchezza alta per ${streak} giorni consecutivi — deload consigliato (Walsh 2021).`);
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
