import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { profileAsPrompt, goalsAsPrompt, planAsPrompt, getLastNDays } from "../diaryContext";
import type { UserProfile, UserGoal, TrainingPlan, PlanWeek } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "./promptBuilder";
import { validatePlan, planStateHash, computePlanStartDate } from "./planValidator";
import { computeZonesContext } from "./zones";
import { workoutSubtypesForPrompt, isCanonicalSubtype } from "../workoutCatalog";

// WHY: appiattisce i giorni del diario nella shape attesa dal validator per
// lo spike check Johansen (14gg). Senza questo i call-site passavano [] e lo
// spike check era inerte.
function flattenWorkoutsForValidator(
  days: Array<{ date: string; daily: unknown; workouts: unknown[] }>,
): Array<{ type?: string; fields?: { tipo?: string; durata_totale?: number | string; durata?: number | string }; date?: string }> {
  const out: Array<{ type?: string; fields?: { tipo?: string; durata_totale?: number | string; durata?: number | string }; date?: string }> = [];
  for (const d of days) {
    for (const w of d.workouts || []) {
      const ww = w as { type?: string; fields?: { tipo?: string; durata_totale?: number | string; durata?: number | string } };
      out.push({ type: ww.type, fields: ww.fields, date: d.date });
    }
  }
  return out;
}

// Iniettato nel userPrompt quando ci sono ≥2 goal attivi: il modello deve
// esplicitare i trade-off anziché cercare di massimizzare tutti contemporaneamente
// (es. dimagrimento + ipertrofia = conflitto energetico; endurance + potenza =
// interferenza neuromuscolare).
const GOAL_CONFLICT_HINT = `
NOTA SU OBIETTIVI MULTIPLI: hai ≥2 goal attivi. Gli obiettivi possono essere conflittuali (es. dimagrimento+ipertrofia, endurance+potenza, volume+recupero). Nel campo "rationale" spiega esplicitamente come bilanci il conflitto, quale obiettivo ha PRIORITÀ questa settimana, o come alterni l'enfasi settimana-a-settimana. Non cercare di massimizzare tutti contemporaneamente.
`.trim();

const sessionSchema = z.object({
  day: z.enum(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]),
  type: z.enum(["corsa", "forza_gambe", "forza_upper", "sport", "mobilita"]),
  subtype: z.string().optional(),
  duration_min: z.number().int().min(5).max(240),
  details: z.string(),
  rationale: z.string(),
  // Zona FC target 1-5 (obbligatoria per tipi cardio, omessa per forza/mobilita).
  // Il frontend renderizza il range bpm calcolato dinamicamente dalle zone
  // personalizzate dell'utente — qui serve solo la prescrizione logica.
  zone: z.number().int().min(1).max(5).optional(),
});

const weekSchema = z.object({
  weekNumber: z.number().int().min(1),
  focus: z.string(),
  sessions: z.array(sessionSchema),
});

// Accettiamo 1-4 per retrocompatibilità con piani esistenti in localStorage,
// ma i nuovi generate/regenerate/adapt producono sempre 1 sola settimana (vedi
// schemaHint + prompt). Le settimane extra eventualmente prodotte dal modello
// vengono tollerate ma il flusso standard si basa su 1 settimana + rigenerazione
// automatica al lunedì successivo.
const planSchema = z.object({
  weeks: z.array(weekSchema).min(1).max(4),
  rationale: z.string(),
});

const schemaHint = `
{
  "weeks": [
    {
      "weekNumber": 1,
      "focus": "string breve",
      "sessions": [
        {
          "day": "lun"|"mar"|"mer"|"gio"|"ven"|"sab"|"dom",
          "type": "corsa"|"forza_gambe"|"forza_upper"|"sport"|"mobilita",
          "subtype": "DEVE essere uno dei valori canonici per il tipo (lista sotto) — NON inventare nomi",
          "duration_min": number,
          "details": "descrizione breve senza numeri FC (es. 'conversazionale, passo libero'). NON scrivere range bpm — il frontend li calcola.",
          "rationale": "perché questa sessione qui",
          "zone": 1|2|3|4|5 (OBBLIGATORIO per corsa e sport; OMETTI per forza_gambe/forza_upper/mobilita)
        }
      ]
    }
  ],
  "rationale": "2-3 frasi che spiegano la logica del piano (settimana singola)"
}
IMPORTANTE: l'array "weeks" deve contenere UNA SOLA settimana con weekNumber=1.

SUBTYPE ALLOWLIST (obbligatorio — inventare nomi rompe il matching piano↔diario):
${workoutSubtypesForPrompt()}
Se un'attività non ha un subtype adatto nella lista sopra, scegli il più vicino semanticamente (es. "circuito funzionale" → "Circuito Misto") invece di inventare un nuovo nome.

ZONE: per ogni sessione cardio (corsa/sport) indica la zona target 1-5 nel campo "zone" (1=Recovery, 2=Easy/Fondo Lento, 3=Tempo, 4=Threshold/Soglia, 5=VO2max/Ripetute brevi). NON inserire numeri bpm nei "details": il frontend mostra il range corretto dalle zone personalizzate dell'utente. Scrivi solo la descrizione qualitativa (passo, sensazione, struttura).
`.trim();

/**
 * Map dei weeks Zod→PlanWeek[]. Serve perché Zod tipa `zone` come `number`
 * mentre PlannedSession.zone è `1 | 2 | 3 | 4 | 5`. La narrowing la fa
 * il schema (min 1 / max 5), il cast qui è sicuro.
 */
function coerceWeeks(weeks: z.infer<typeof planSchema>["weeks"]): PlanWeek[] {
  return weeks.map(w => ({
    weekNumber: w.weekNumber,
    focus: w.focus,
    sessions: w.sessions.map(s => ({
      day: s.day,
      type: s.type,
      subtype: s.subtype,
      duration_min: s.duration_min,
      details: s.details,
      rationale: s.rationale,
      zone: s.zone as (1 | 2 | 3 | 4 | 5 | undefined),
    })),
  }));
}

/**
 * Piano di emergenza hard-coded: usato SOLO se l'LLM fallisce durante
 * l'onboarding (generateInitialPlan). Garantisce che l'utente possa
 * completare il flusso di onboarding e iniziare ad allenarsi in sicurezza
 * anche se Gemini è down o rifiuta il JSON.
 *
 * Principi di sicurezza:
 * - Volume conservativo (≤90min/sessione, Z2 per il cardio).
 * - Età ≥65: riduzione durata corsa (20min) e zona cap Z2.
 * - experience=sedentary/occasional: nessuna Z3+, volume ridotto.
 * - Rispetta disponibilità settimanale: sforiamo verso il BASSO, mai in alto.
 * - Almeno 2 giorni di riposo.
 */
function buildFallbackPlan(profile: UserProfile, goals: UserGoal[]): TrainingPlan {
  const isBeginner = profile.experience === "sedentary" || profile.experience === "occasional";
  const isSenior = profile.age >= 65;
  const availableDays = Math.max(1, Math.min(7, profile.weekly_availability?.days ?? 4));
  const hoursPerSession = Math.max(0.25, profile.weekly_availability?.hoursPerSession ?? 1);
  // Durata max per sessione, cappata a 60min per beginner/senior, altrimenti 75min.
  const maxDurMin = Math.min(
    Math.round(hoursPerSession * 60),
    isBeginner || isSenior ? 60 : 75,
  );

  // Durate conservative per i vari tipi
  const runDur = Math.min(maxDurMin, isSenior ? 20 : isBeginner ? 25 : 35);
  const strDur = Math.min(maxDurMin, 30);
  const mobDur = Math.min(maxDurMin, 20);

  // Injuries detection: keyword match lowercase sui campi dichiarati.
  // Scelta conservativa: in dubbio riduciamo cardio + aumentiamo mobility (WHY:
  // il fallback è cieco senza LLM, meglio sottostimare il volume che forzare un
  // rientro aggressivo su strutture potenzialmente non guarite).
  const injuriesBlob = (profile.injuries || []).join(" ").toLowerCase();
  const hasCalfIssue = /polpaccio|calf/i.test(injuriesBlob);
  const hasKneeIssue = /ginocchio|knee/i.test(injuriesBlob);

  // Template base 7 giorni: 3 corse Z2 + 1 forza + 1 mobilità + 2 riposi.
  // I giorni non scelti restano senza sessione (= riposo).
  type DayKey = "lun" | "mar" | "mer" | "gio" | "ven" | "sab" | "dom";

  // Cardio session factory: rispetta injuries (calf → 2 corse + 1 mobility,
  // knee → solo camminata).
  const cardioSession = (day: DayKey, slot: "lun" | "gio" | "sab"): PlanWeek["sessions"][number] => {
    if (hasKneeIssue) {
      return {
        day,
        type: "mobilita",
        subtype: "Camminata",
        duration_min: Math.min(maxDurMin, 30),
        details: "Camminata a passo sostenuto su superficie regolare. Evita salite/discese ripide finché il ginocchio non è asintomatico.",
        rationale: "Aerobico a basso impatto: carico articolare minimo con ginocchio in fase di tutela.",
      };
    }
    // Calf injury: il 3° slot (sab) diventa mobility, gli altri due restano corse.
    if (hasCalfIssue && slot === "sab") {
      return {
        day,
        type: "mobilita",
        subtype: "Foam Rolling",
        duration_min: Math.min(maxDurMin, 20),
        details: "Foam rolling polpacci + soleo, stretching prolungato gastrocnemio, mobilità caviglia. Evita impact.",
        rationale: "Sostituisce la 3a corsa per ridurre lo stress ripetuto sul polpaccio in fase di recupero.",
      };
    }
    return {
      day,
      type: "corsa",
      subtype: "Fondo Lento",
      duration_min: runDur,
      details: "Corsa conversazionale in Z2, passo libero e sostenibile. Se serve, cammina nei primi minuti per riscaldare.",
      rationale: "Fondo aerobico: base di resistenza senza stress cardiovascolare eccessivo.",
      zone: 2,
    };
  };

  const template: Array<{ day: DayKey; session: PlanWeek["sessions"][number] | null }> = [
    { day: "lun", session: cardioSession("lun", "lun") },
    {
      day: "mar",
      session: {
        day: "mar",
        type: "forza_gambe",
        // "Circuito Misto" è l'unico subtype del catalog forza_gambe che mappa
        // semanticamente un total-body bodyweight (vedi workoutCatalog.ts).
        subtype: "Circuito Misto",
        duration_min: strDur,
        details: "3 serie × 10 ripetizioni: squat a corpo libero, affondi, plank 30-45s, push-up (anche su ginocchia). Recupero 60-90s.",
        rationale: "Forza funzionale leggera: supporta corsa e previene infortuni (Rønnestad 2014).",
      },
    },
    { day: "mer", session: null }, // riposo
    { day: "gio", session: cardioSession("gio", "gio") },
    {
      day: "ven",
      session: {
        day: "ven",
        type: "mobilita",
        subtype: "Mobilità Dinamica",
        duration_min: mobDur,
        details: "Mobilità anche/caviglie + stretching dinamico gambe + core leggero. Movimenti lenti e controllati.",
        rationale: "Recovery attivo: mantiene range di movimento e riduce il rischio infortuni.",
      },
    },
    { day: "sab", session: cardioSession("sab", "sab") },
    { day: "dom", session: null }, // riposo
  ];

  // Filtra al numero di giorni disponibili. Ordine di priorità (preserviamo
  // un MIX sensato se `availableDays` è basso):
  //   1) prima corsa (lun)
  //   2) forza (mar)
  //   3) seconda corsa (gio)
  //   4) terza corsa (sab)
  //   5) mobilità (ven)
  // Così con 2 giorni disponibili otteniamo 1 corsa + 1 forza (non 2 corse),
  // con 3 → 2 corse + 1 forza, con 4+ → include anche mobilità.
  const priorityByDay: Record<string, number> = {
    lun: 1,
    mar: 2,
    gio: 3,
    sab: 4,
    ven: 5,
  };
  const activeDays = template.filter(t => t.session !== null);
  const sortedByPriority = [...activeDays].sort(
    (a, b) => (priorityByDay[a.day] ?? 99) - (priorityByDay[b.day] ?? 99),
  );
  const keepCount = Math.min(activeDays.length, availableDays);
  const keepSet = new Set(sortedByPriority.slice(0, keepCount).map(t => t.day));

  const sessions: PlanWeek["sessions"] = template
    .filter(t => t.session !== null && keepSet.has(t.day))
    .map(t => t.session!);

  const now = new Date();
  const validUntil = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  const ageNote = isSenior ? " Durate ridotte per fascia età ≥65." : "";
  const begNote = isBeginner ? " Volume e intensità conservativi (beginner cap)." : "";
  const injuryNote = hasKneeIssue
    ? " Corse sostituite da camminata per tutela ginocchio."
    : hasCalfIssue
      ? " Ridotte a 2 corse + 1 mobility per tutela polpaccio."
      : "";
  const goalNote = goals.length
    ? " Il piano si concentra su base aerobica e forza funzionale — gli obiettivi specifici saranno integrati quando il coach AI tornerà disponibile."
    : "";

  return {
    generatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    startDate: computePlanStartDate(now),
    profileHash: planStateHash(profile, goals),
    weeks: [
      {
        weekNumber: 1,
        focus: "Base aerobica + forza funzionale (piano di emergenza)",
        sessions,
      },
    ],
    rationale:
      `[Piano di emergenza — LLM non disponibile] Settimana introduttiva con ` +
      `${sessions.filter(s => s.type === "corsa").length} corse in Z2, ` +
      `${sessions.filter(s => s.type === "forza_gambe").length} sessione forza e ` +
      `${sessions.filter(s => s.type === "mobilita").length} mobilità.` +
      ageNote + begNote + injuryNote + goalNote +
      " Puoi rigenerare un piano personalizzato dal pannello Coach appena il servizio risponde.",
  };
}

export async function generateInitialPlan(
  profile: UserProfile,
  goals: UserGoal[],
  opts?: GenerationOptions,
): Promise<TrainingPlan> {
  // Zone FC personalizzate: onboarding ha storico nullo → Tanaka. Carichiamo
  // comunque per sicurezza (es. onboarding ripetuto con diario esistente).
  const recentDaysForZones = await getLastNDays(60).catch(() => []);
  const zonesCtxInit = computeZonesContext(profile, recentDaysForZones);
  const goalConflictHint = goals.length >= 2 ? GOAL_CONFLICT_HINT : "";
  const effectiveDays = effectiveAvailableDays(opts?.availableDaysOverride, profile.availableDays);
  const availableDaysBlock = buildAvailableDaysBlock(effectiveDays, "GIORNI ALLENABILI");
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVI:
${goalsAsPrompt(goals)}
${goalConflictHint}${availableDaysBlock}
Genera la SETTIMANA 1 del piano (una sola settimana, weekNumber=1) che porti l'utente verso gli obiettivi rispettando vincoli e sicurezza. La settimana successiva sarà rigenerata lunedì prossimo sulla base dei dati reali del diario, non anticiparla ora.
`.trim();

  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    // Il piano generato include sempre forza 2-3x/sett (see Rønnestad 2014); teniamo true per
    // attivare il modulo strengthForEndurance quando il contesto corsa è presente.
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
    zones: zonesCtxInit?.zones ?? undefined,
    zonesTimeInZone: zonesCtxInit?.timeInZone,
    zonesPolar: zonesCtxInit?.polar,
    zonesTotalSessions: zonesCtxInit?.totalSessions,
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  // Fallback graceful: se la chiamata LLM fallisce o il JSON non è parsabile,
  // restituiamo un piano di emergenza hard-coded invece di bloccare l'onboarding.
  // L'utente può rigenerare un piano personalizzato in qualunque momento.
  let raw: unknown;
  try {
    raw = await generateJSON<unknown>({
      systemInstruction,
      userPrompt,
      schemaHint,
      maxTokens: 1800,
    });
  } catch (e) {
    console.error("[planGenerator] generateJSON failed in onboarding, returning fallback plan:", e);
    return buildFallbackPlan(profile, goals);
  }
  const parseResult = planSchema.safeParse(raw);
  if (!parseResult.success) {
    console.error("[planGenerator] Zod parse failed in onboarding, returning fallback plan:", parseResult.error.message);
    return buildFallbackPlan(profile, goals);
  }
  const parsed = parseResult.data;

  const now = new Date();
  const validUntil = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  const plan: TrainingPlan = {
    generatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    startDate: computePlanStartDate(now),
    profileHash: planStateHash(profile, goals),
    weeks: coerceWeeks(parsed.weeks),
    rationale: parsed.rationale,
  };
  // Validator deterministico post-LLM: logga violazioni safety anche se il modello
  // le ha ignorate. Non ri-generiamo automaticamente (caro in token) — segnaliamo.
  const validation = validatePlan(plan, profile, flattenWorkoutsForValidator(recentDaysForZones));
  if (!validation.ok) {
    console.warn("[planGenerator] Violazioni safety nel piano generato:",
      validation.issues.map(i => i.message).join(" | "));
    plan.rationale = plan.rationale +
      "\n\n[Validator] Avvertenze rilevate: " +
      validation.issues.map(i => i.message).join(" ");
  }
  return plan;
}

/**
 * Modalità di rigenerazione del piano:
 * - "next-week" (default, comportamento storico): genera la settimana che inizia
 *   il prossimo lunedì. Usato a fine settimana o se l'utente è on-track.
 * - "rest-of-week": genera SOLO i giorni rimanenti della settimana corrente
 *   (da oggi a domenica). Usato quando l'utente ha saltato giorni passati e
 *   vuole "ricominciare" senza aspettare lunedì prossimo.
 */
export type RegenerateMode = "next-week" | "rest-of-week";

const DAY_LABELS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;

/** Da Date locale → label canonica della settimana ("lun"..."dom"). */
function dayLabelFromDate(d: Date): string {
  // JS getDay(): 0=dom, 1=lun, ..., 6=sab. Mappa a indice 0-6 lun-based.
  const dow = d.getDay();
  return DAY_LABELS[(dow + 6) % 7];
}

/**
 * Calcola i giorni allenabili effettivi per la generazione:
 *  - Se `override` è popolato: ha precedenza assoluta (picker on-demand)
 *  - Altrimenti se `profile.availableDays` è popolato: routine fissa di default
 *  - Altrimenti: undefined (= scelta libera dell'LLM, retrocompat)
 *
 *  In modalità "rest-of-week", interseca con i giorni rimanenti della settimana.
 */
function effectiveAvailableDays(
  override: ReadonlyArray<string> | undefined,
  profileDefault: ReadonlyArray<string> | undefined,
  remainingThisWeek?: ReadonlyArray<string>,
): string[] | undefined {
  let base: string[] | undefined;
  if (override && override.length > 0) base = [...override];
  else if (profileDefault && profileDefault.length > 0) base = [...profileDefault];
  else base = undefined;
  if (!base) return undefined;
  if (remainingThisWeek) {
    const remSet = new Set(remainingThisWeek);
    return base.filter(d => remSet.has(d));
  }
  return base;
}

/** Costruisce il blocco di vincolo HARD per il prompt (vuoto se libero). */
function buildAvailableDaysBlock(effective: string[] | undefined, label: string): string {
  if (!effective) return "";
  if (effective.length === 0) {
    // Caso edge: override vs remaining = nessun giorno valido. NON dovrebbe
    // arrivare qui (la UI dovrebbe bloccare il submit) ma se succede chiediamo
    // all'LLM di restituire 0 sessioni invece di inventare.
    return `\n${label}: NESSUN giorno utilizzabile in questa finestra. Rispondi con weeks=[{weekNumber:1, focus:"riposo forzato", sessions:[]}] e rationale che spieghi.`;
  }
  return `\n${label} (vincolo HARD per QUESTA generazione, sovrascrive eventuale default profilo): ${effective.join(", ")}. NON proporre sessioni in altri giorni.`;
}

/** Opzioni opzionali per le funzioni di generazione/rigenerazione. */
export interface GenerationOptions {
  /** Override per-rigenerazione dei giorni allenabili (es. picker UI). */
  availableDaysOverride?: ReadonlyArray<string>;
}

function formatDateIT(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Rigenera il piano. Vedi RegenerateMode per le due modalità. */
export async function regenerateNextWeek(
  profile: UserProfile,
  goals: UserGoal[],
  currentPlan: TrainingPlan | null,
  recentDaysText: string,
  mode: RegenerateMode = "next-week",
  opts?: GenerationOptions,
): Promise<TrainingPlan> {
  // Per "rest-of-week" calcoliamo oggi, lunedì-corrente, giorni rimanenti.
  // Il piano avrà startDate = lunedì-corrente (canonical) ma sessioni solo
  // per i giorni rimanenti. Il matching piano↔diario continua a funzionare.
  const now = new Date();
  const todayLabel = dayLabelFromDate(now);
  const todayIdx = DAY_LABELS.indexOf(todayLabel as typeof DAY_LABELS[number]);
  const remainingLabels = DAY_LABELS.slice(todayIdx); // es. ["gio","ven","sab","dom"]
  const passedLabels = DAY_LABELS.slice(0, todayIdx); // es. ["lun","mar","mer"]
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - todayIdx);

  // Finestra ≤2 gg: la settimana è quasi finita. Meglio 1 sessione leggera
  // che rincorrere volume a intensità alta in una window residua microscopica.
  const minimalWindowGuard = mode === "rest-of-week" && remainingLabels.length <= 2
    ? `\nFINESTRA RIDOTTA (${remainingLabels.length} giorni): preferire massimo 1 sessione leggera Z2 fino a 30min. NO Z4/Z5, NO ripetute, NO forza pesante. Usa gli altri giorni come riposo/mobilità breve.`
    : "";

  const restOfWeekBlock = mode === "rest-of-week" ? `
SCENARIO MID-WEEK — RIPARTI DA OGGI:
OGGI è ${todayLabel} ${formatDateIT(now)}. La settimana è iniziata lun ${formatDateIT(weekStart)}.
Genera sessioni SOLO per i giorni rimanenti: ${remainingLabels.join(", ")}.
I giorni passati (${passedLabels.join(", ")}) sono CHIUSI — considerali come riposo,
non includere sessioni per essi.${minimalWindowGuard}
` : "";

  const modeInstruction = mode === "next-week"
    ? `Genera la NUOVA settimana (weekNumber=1, una sola) a partire dalla settimana prossima, adattando in base ad aderenza, trend dolore/fatica, e risposta al carico osservati.\nSe rilevi red flag, proponi deload esplicito.`
    : `Genera la settimana corrente parziale (weekNumber=1, una sola) coprendo solo i ${remainingLabels.length} giorni rimanenti. Adatta volume/intensità in base ad aderenza, trend dolore/fatica, e risposta al carico osservati.`;

  const goalConflictHintRegen = goals.length >= 2 ? GOAL_CONFLICT_HINT : "";
  // Se mode=rest-of-week intersechiamo l'override (o profilo) con i giorni
  // RIMANENTI: l'utente non può "selezionare" un giorno passato.
  const effectiveDaysRegen = effectiveAvailableDays(
    opts?.availableDaysOverride,
    profile.availableDays,
    mode === "rest-of-week" ? remainingLabels : undefined,
  );
  const availableDaysBlockRegen = buildAvailableDaysBlock(effectiveDaysRegen, "GIORNI ALLENABILI");
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVI:
${goalsAsPrompt(goals)}
${goalConflictHintRegen}${availableDaysBlockRegen}
PIANO CORRENTE:
${planAsPrompt(currentPlan)}

ULTIMI 14 GIORNI REALI DAL DIARIO:
${recentDaysText}
${restOfWeekBlock}
${modeInstruction}
`.trim();

  const recentDaysForZonesRegen = await getLastNDays(60).catch(() => []);
  const zonesCtxRegen = computeZonesContext(profile, recentDaysForZonesRegen);
  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    // Il piano generato include sempre forza 2-3x/sett (see Rønnestad 2014); teniamo true per
    // attivare il modulo strengthForEndurance quando il contesto corsa è presente.
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
    zones: zonesCtxRegen?.zones ?? undefined,
    zonesTimeInZone: zonesCtxRegen?.timeInZone,
    zonesPolar: zonesCtxRegen?.polar,
    zonesTotalSessions: zonesCtxRegen?.totalSessions,
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 1800,
  });
  const parseResult = planSchema.safeParse(raw);
  if (!parseResult.success) {
    console.error("[planGenerator] Zod parse failed:", parseResult.error.message);
    throw new Error("Il coach non è riuscito a generare un piano strutturato. Riprova tra qualche secondo.");
  }
  const parsed = parseResult.data;
  const planStart = computePlanStartDate(now);
  // "rest-of-week": startDate = lunedì corrente (i day labels delle sessioni
  //                  rimanenti mappano correttamente).
  // "next-week": startDate = lunedì PROSSIMO (la nuova settimana inizia dopo).
  let startDate = planStart;
  if (mode === "next-week") {
    const nextMonday = new Date(now);
    const todayIdxLocal = (now.getDay() + 6) % 7; // 0=lun..6=dom
    nextMonday.setDate(now.getDate() + (7 - todayIdxLocal));
    startDate = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, "0")}-${String(nextMonday.getDate()).padStart(2, "0")}`;
  }
  const plan: TrainingPlan = {
    generatedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    startDate,
    profileHash: planStateHash(profile, goals),
    weeks: coerceWeeks(parsed.weeks),
    rationale: parsed.rationale,
  };
  // Per partial week passiamo expectedDayLabels al validator così non flagga
  // "insufficient_rest_days" su una finestra ridotta (es. gio-dom = 4 giorni).
  // Se l'utente ha ulteriormente ristretto via override/profilo, la finestra
  // effettiva è ancora più piccola — passa l'intersezione.
  let expectedDayLabels: string[] | undefined;
  if (mode === "rest-of-week") {
    expectedDayLabels = effectiveDaysRegen ?? remainingLabels.slice();
  } else if (effectiveDaysRegen) {
    expectedDayLabels = effectiveDaysRegen;
  }
  const validation = validatePlan(plan, profile, flattenWorkoutsForValidator(recentDaysForZonesRegen), { expectedDayLabels });
  if (!validation.ok) {
    console.warn("[regenerateNextWeek] Violazioni safety:", validation.issues.map(i => i.message).join(" | "));
    plan.rationale = plan.rationale + "\n\n[Validator] Avvertenze: " + validation.issues.map(i => i.message).join(" ");
  }
  return plan;
}

/**
 * Adatta un piano esistente in base a una richiesta testuale dell'utente.
 * Esempi: "più intenso", "non posso allenarmi giovedì", "voglio più forza",
 * "settimana di deload", "aggiungi yoga il martedì".
 * Il coach rispetta sempre le safety rules anche se l'utente chiede di sforzare.
 */
export async function adaptPlan(
  profile: UserProfile,
  goals: UserGoal[],
  currentPlan: TrainingPlan,
  recentDaysText: string,
  userRequest: string,
  opts?: GenerationOptions,
): Promise<TrainingPlan> {
  const goalConflictHintAdapt = goals.length >= 2 ? GOAL_CONFLICT_HINT : "";
  const effectiveDaysAdapt = effectiveAvailableDays(opts?.availableDaysOverride, profile.availableDays);
  const availableDaysBlockAdapt = buildAvailableDaysBlock(effectiveDaysAdapt, "GIORNI ALLENABILI");
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVI:
${goalsAsPrompt(goals)}
${goalConflictHintAdapt}${availableDaysBlockAdapt}
PIANO CORRENTE (da modificare):
${planAsPrompt(currentPlan)}

ULTIMI 14 GIORNI REALI DAL DIARIO:
${recentDaysText}

RICHIESTA SPECIFICA DELL'UTENTE:
"${userRequest}"

Il tuo compito: adattare il piano corrente in base ALLA RICHIESTA dell'utente, interpretandola sensatamente.
Esempi di richieste possibili:
- "più intenso/difficile" → aumenta intensità (intervalli, ripetute, carichi) mantenendo safety
- "meno intenso/voglio solo mantenere" → riduci volume/intensità, più recovery
- "non posso allenarmi [giorno]" → sposta la sessione in altro giorno della stessa settimana
- "aggiungi [disciplina]" → integra sessioni del tipo richiesto se compatibile con disponibilità
- "deload" → settimana 1 con -40-50% volume, intensità invariata (Bosquet 2007)
- "preparami per [evento X data]" → riorganizza verso quella data con tapering finale se ≤2 settimane

REGOLE NON VIOLABILI:
- Rispetta SEMPRE le regole di sicurezza e le condizioni dichiarate.
- Se la richiesta è rischiosa (es. "voglio fare triplo volume"), proponi una versione sicura e spiega perché nel "rationale".
- Non rimuovere tutti i giorni di riposo.

Rispondi con il piano MODIFICATO completo (UNA settimana, weekNumber=1, tutte le sessioni). Il "rationale" DEVE menzionare esplicitamente cosa è cambiato rispetto al piano precedente e perché.
`.trim();

  const recentDaysForZonesAdapt = await getLastNDays(60).catch(() => []);
  const zonesCtxAdapt = computeZonesContext(profile, recentDaysForZonesAdapt);
  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription)),
    hasStrengthInPlan: true,
    detectedConditions: extractConditionsFromProfile(profile),
    zones: zonesCtxAdapt?.zones ?? undefined,
    zonesTimeInZone: zonesCtxAdapt?.timeInZone,
    zonesPolar: zonesCtxAdapt?.polar,
    zonesTotalSessions: zonesCtxAdapt?.totalSessions,
  };
  const systemInstruction = PROMPTS.planGeneration({ age: profile.age }) + "\n\n" + buildConditionalPrompt(bCtx);

  const raw = await generateJSON<unknown>({
    systemInstruction,
    userPrompt,
    schemaHint,
    maxTokens: 1800,
  });
  const parseResult = planSchema.safeParse(raw);
  if (!parseResult.success) {
    console.error("[adaptPlan] Zod parse failed:", parseResult.error.message);
    throw new Error("Il coach non è riuscito a generare un piano strutturato. Riprova con una richiesta più chiara.");
  }
  const parsed = parseResult.data;
  const now = new Date();
  const plan: TrainingPlan = {
    generatedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    startDate: currentPlan.startDate ?? computePlanStartDate(now),
    profileHash: planStateHash(profile, goals),
    weeks: coerceWeeks(parsed.weeks),
    rationale: parsed.rationale,
  };
  const validation = validatePlan(plan, profile, flattenWorkoutsForValidator(recentDaysForZonesAdapt));
  if (!validation.ok) {
    console.warn("[adaptPlan] Violazioni safety:", validation.issues.map(i => i.message).join(" | "));
    plan.rationale = plan.rationale + "\n\n[Validator] Avvertenze: " + validation.issues.map(i => i.message).join(" ");
  }
  return plan;
}
