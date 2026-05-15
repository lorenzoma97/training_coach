import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { profileAsPrompt, parsePaceSec, formatPaceSec } from "../diaryContext";
import { sanitizePII } from "../promptSanitizer";
import type { UserProfile, FeasibilityCheck } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "./promptBuilder";
import {
  predictRunningPace,
  predictWeightLoss,
  predictSoccerReady,
  predictStrength1RM,
  predictEnduranceDuration,
} from "./goalPredictor";

// Cache module-level: goal+profile identici → stessa risposta per 7gg.
// WHY: l'utente clicca "valuta fattibilità" ripetutamente (tweak goal testo,
// torna indietro nel wizard, ecc). Senza cache bruciamo token inutilmente.
// Storage in-memory: intenzionalmente NON persisted (un refresh pulisce la cache).
interface CacheEntry { result: FeasibilityCheck; ts: number }
const FEASIBILITY_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

// FNV-1a 32-bit: stabile e rapido, sufficiente per chiavi cache non crittografiche.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

function feasibilityCacheKey(profile: UserProfile, goalDescription: string): string {
  const profileKey = (profile as UserProfile & { id?: string }).id
    || `${profile.age}|${profile.sex}|${profile.experience}`;
  const goalKey = goalDescription.toLowerCase().trim();
  return fnv1a(`${profileKey}::${goalKey}`);
}

const schema = z.object({
  realistic: z.boolean(),
  reasoning: z.string(),
  counterProposal: z.object({
    description: z.string(),
    kpi: z.object({
      metric: z.string(),
      target: z.string(),
      deadline: z.string(),
    }),
  }),
});

const schemaHint = `
{
  "realistic": boolean,
  "reasoning": "spiegazione 2-3 frasi in italiano",
  "counterProposal": {
    "description": "versione SMART dell'obiettivo in 1 frase chiara (dettagli nel reasoning, NON qui)",
    "kpi": {
      "metric": "BREVE, max 4-5 parole (es. 'corsa continua', 'partita calcio 11', 'perdita peso')",
      "target": "NUMERICO e conciso (es. '45 min @ 5:30/km', '60 min senza cali', '-5 kg')",
      "deadline": "data o periodo (es. '28 aprile 2026', '3 mesi', '8 settimane')"
    }
  }
}
IMPORTANTE: il KPI deve essere IMMEDIATO e LEGGIBILE A COLPO D'OCCHIO.
- "metric" = COSA misuri in max 4-5 parole
- "target" = QUANTO/COME in max 6-8 parole con numeri
- NON ripetere nella metric o nel target quello che c'è nella description
- NON scrivere frasi lunghe tipo "Partecipazione a 60 minuti di gioco effettivo nella partita di Calcio a 11"
  → scrivi metric: "partita calcio 11", target: "60 min senza cali"
`.trim();

// ─── Pre-pass scientifico (Wave audit 2 commit 3/3) ───────────────────────
// Genera fact-check matematico iniettato nel prompt LLM. Usa goalPredictor
// con baseline rule-of-thumb experience-based (no diario in onboarding).
// L'LLM è obbligato a usare questi numeri nella reasoning + counterProposal.

/** Baseline pace running per esperienza (Pfitzinger consensus, sec/km). */
const PACE_BASELINE_BY_EXP: Record<UserProfile["experience"], number> = {
  sedentary: 420,    // 7:00/km (start point sedentary couch-to-running)
  occasional: 360,   // 6:00/km
  regular: 330,      // 5:30/km
  competitive: 270,  // 4:30/km
};

/** Aerobic sessions/8sett rule-of-thumb per experience (per soccer readiness). */
const AEROBIC_8WK_BY_EXP: Record<UserProfile["experience"], number> = {
  sedentary: 0,
  occasional: 4,
  regular: 10,
  competitive: 20,
};

interface KpiHints {
  kind: "corsa_pace" | "peso" | "calcio_match" | "forza_1rm" | "resistenza_durata" | "generic";
  targetValue: number | null;
  targetDistanceKm: number | null;
  weeksToDeadline: number | null;
}

/** Parse keyword + numeri dal goal description per estrarre hints predict. */
function extractGoalKpiHints(text: string): KpiHints {
  const t = text.toLowerCase();
  // Settimane alla deadline
  let weeks: number | null = null;
  const wkMatch = t.match(/(\d+)\s*(sett|settimane|week)/);
  if (wkMatch) weeks = parseInt(wkMatch[1], 10);
  else {
    const monthMatch = t.match(/(\d+)\s*(mese|mesi|month)/);
    if (monthMatch) weeks = parseInt(monthMatch[1], 10) * 4;
  }
  // Distanza km (solo per running)
  let distKm: number | null = null;
  const dkmMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(km|k)\b/);
  if (dkmMatch) distKm = parseFloat(dkmMatch[1].replace(",", "."));
  else if (/maratona\b/.test(t)) distKm = 42.195;
  else if (/mezza|halfmarathon|half marathon/.test(t)) distKm = 21.0975;
  // Kind detection (riusa stessa logica inferGoalKind ma su free text)
  if (/calcio.*partita|partita.*calcio|match.*calcio|calcio 11|calcio amatoriale/.test(t)) {
    return { kind: "calcio_match", targetValue: 90, targetDistanceKm: null, weeksToDeadline: weeks };
  }
  if (/passo|tempo|km|10k|5k|maratona|mezza|run/.test(t)) {
    // Target pace: cerca pattern X:YY (min/km)
    const paceMatch = t.match(/(\d+):(\d{1,2})/);
    const targetPaceSec = paceMatch ? parseInt(paceMatch[1], 10) * 60 + parseInt(paceMatch[2], 10) : null;
    return {
      kind: "corsa_pace",
      targetValue: targetPaceSec,
      targetDistanceKm: distKm ?? 10,
      weeksToDeadline: weeks,
    };
  }
  if (/peso|kg.*corp|dimagri|perdere|body.*fat|grasso|composiz/.test(t)) {
    // Cerca "-5 kg" o "perdere 5 kg" o "75 kg"
    const lossMatch = t.match(/[-−]\s*(\d+(?:[.,]\d+)?)\s*kg/) || t.match(/perdere\s+(\d+(?:[.,]\d+)?)\s*kg/);
    if (lossMatch) {
      const kg = parseFloat(lossMatch[1].replace(",", "."));
      return { kind: "peso", targetValue: kg, targetDistanceKm: null, weeksToDeadline: weeks };
    }
    const targetMatch = t.match(/(\d+(?:[.,]\d+)?)\s*kg/);
    return {
      kind: "peso",
      targetValue: targetMatch ? parseFloat(targetMatch[1].replace(",", ".")) : null,
      targetDistanceKm: null,
      weeksToDeadline: weeks,
    };
  }
  if (/1rm|panca|squat|stacco|forza|carico/.test(t)) {
    const kgMatch = t.match(/(\d+(?:[.,]\d+)?)\s*kg/);
    return {
      kind: "forza_1rm",
      targetValue: kgMatch ? parseFloat(kgMatch[1].replace(",", ".")) : null,
      targetDistanceKm: null,
      weeksToDeadline: weeks,
    };
  }
  if (/correre.*continuo|durata|min.*continui|resistenza/.test(t)) {
    const minMatch = t.match(/(\d+)\s*(min|minuti|h|ora)/);
    let targetMin: number | null = null;
    if (minMatch) {
      const n = parseInt(minMatch[1], 10);
      targetMin = minMatch[2].startsWith("h") || minMatch[2].startsWith("ora") ? n * 60 : n;
    }
    return { kind: "resistenza_durata", targetValue: targetMin, targetDistanceKm: null, weeksToDeadline: weeks };
  }
  return { kind: "generic", targetValue: null, targetDistanceKm: null, weeksToDeadline: weeks };
}

/**
 * Genera fact-check scientifico da iniettare nel prompt LLM.
 * Restituisce stringa vuota se hints insufficienti per predict.
 */
function buildScientificFactCheck(profile: UserProfile, goalDescription: string): string {
  const hints = extractGoalKpiHints(goalDescription);
  if (hints.weeksToDeadline == null || hints.weeksToDeadline <= 0) return "";

  const exp = profile.experience;
  let prediction: import("./goalPredictor").GoalPrediction | null = null;
  let baselineLine = "";

  if (hints.kind === "corsa_pace" && hints.targetValue != null && hints.targetDistanceKm != null) {
    const baselinePace = PACE_BASELINE_BY_EXP[exp];
    baselineLine = `Baseline pace stimata da experience '${exp}': ${formatPaceSec(baselinePace)}/km (Pfitzinger consensus). `;
    prediction = predictRunningPace(baselinePace, hints.targetValue, hints.targetDistanceKm, hints.weeksToDeadline);
  } else if (hints.kind === "peso" && hints.targetValue != null) {
    // Se goal è "perdere X kg" il targetValue è kg da perdere → calcolo target assoluto
    const lossMatch = goalDescription.toLowerCase().match(/[-−]\s*\d+(?:[.,]\d+)?\s*kg|perdere\s+\d/);
    const currentKg = profile.weight_kg ?? 75;
    const targetKg = lossMatch ? currentKg - hints.targetValue : hints.targetValue;
    baselineLine = `Baseline peso da profilo: ${currentKg}kg, target: ${targetKg}kg. `;
    prediction = predictWeightLoss(currentKg, targetKg, hints.weeksToDeadline);
  } else if (hints.kind === "calcio_match") {
    const baselineSessions = AEROBIC_8WK_BY_EXP[exp];
    baselineLine = `Baseline sessioni cardio 8sett stimata da experience '${exp}': ${baselineSessions}. `;
    prediction = predictSoccerReady(baselineSessions, hints.weeksToDeadline);
  } else if (hints.kind === "forza_1rm" && hints.targetValue != null) {
    // Baseline 1RM: assume target × 0.85 (conservativo, può essere off; LLM puo' chiedere conferma)
    const baselineKg = hints.targetValue * 0.85;
    baselineLine = `Baseline 1RM stimata (no test diretto): ${baselineKg.toFixed(1)}kg (=85% del target). `;
    prediction = predictStrength1RM(baselineKg, hints.targetValue, hints.weeksToDeadline, exp);
  } else if (hints.kind === "resistenza_durata" && hints.targetValue != null) {
    const baselineMin = exp === "sedentary" ? 0 : exp === "occasional" ? 15 : exp === "regular" ? 30 : 45;
    baselineLine = `Baseline durata corsa continua stimata da experience '${exp}': ${baselineMin}min. `;
    prediction = predictEnduranceDuration(baselineMin, hints.targetValue, hints.weeksToDeadline);
  }

  if (!prediction || prediction.feasibility === "unknown") return "";

  return [
    `FACT-CHECK SCIENTIFICO PRELIMINARE (deterministico — NON inventare numeri alternativi):`,
    baselineLine + `Settimane disponibili: ${hints.weeksToDeadline}.`,
    `Verdetto matematico: ${prediction.feasibility.toUpperCase()}.`,
    `Razionale: ${prediction.reasoning}`,
    `Fonte scientifica: ${prediction.scienceCitation}`,
    ``,
    `ISTRUZIONI OBBLIGATORIE PER LA TUA VALUTAZIONE:`,
    `- Se feasibility = ok/stretch → "realistic": true, counterProposal conferma il goal originale.`,
    `- Se feasibility = aggressive → "realistic": true MA reasoning avverte del rischio + counterProposal con deadline più realistica (vedi 'Deadline minima' nel razionale).`,
    `- Se feasibility = infeasible → "realistic": false, counterProposal usa il valore predetto realisticamente raggiungibile O la deadline minima safe (NON il target originale).`,
    `- USA i numeri sopra (deadline minima, valore predetto). NON inventare percentuali alternative.`,
  ].join("\n");
}

export async function checkGoalFeasibility(
  profile: UserProfile,
  goalDescription: string,
): Promise<FeasibilityCheck> {
  const cacheKey = feasibilityCacheKey(profile, goalDescription);
  const cached = FEASIBILITY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }
  const factCheck = buildScientificFactCheck(profile, goalDescription);
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVO PROPOSTO DALL'UTENTE:
"${sanitizePII(goalDescription)}"

${factCheck}

Valuta se è realistico. Se non lo è, proponi una versione SMART ragionevole.
Se è già realistico e SMART, "realistic" = true e "counterProposal" confermerà l'obiettivo originale in forma SMART.
`.trim();

  const bCtx: BuildContext = {
    profile,
    hasRunningGoal: RUNNING_GOAL_RE.test(goalDescription),
    detectedConditions: extractConditionsFromProfile(profile),
    // Goal description è testo utente: usalo per euristica keyword-match nel prompt builder
    // (nutrition guardrail condizionale, fix #7).
    freeTextHints: goalDescription,
  };
  // Fix #9 — override esplicito del tono "non eccessivamente conservativo" di PROMPTS.feasibility:
  // chiarire che le regole di safety NON sono negoziabili. Questa nota viene appesa DOPO
  // il system prompt base + moduli condizionali così ha l'ultima parola nel contesto del modello.
  const SAFETY_OVERRIDE_NOTE = `
PRIORITÀ ASSOLUTA — SAFETY VS. TONO:
Le istruzioni generali chiedono di "non essere eccessivamente conservativo" per rispettare l'intento utente.
PERÒ: le regole di sicurezza (es. cap carichi iniziali per neofiti, tapering minimo pre-gara, recupero post-infortunio, progressione entro banda Johansen, cardio guidelines condizioni croniche) NON sono negoziabili.
NON marcare "realistic: true" su un obiettivo che viola le safety rules, anche se l'utente insiste o ribadisce.
In caso di conflitto: "realistic: false" + counterProposal che preserva lo spirito dell'obiettivo ma rispetta le safety rules (tipicamente allungando la timeline anziché abbassare il target).
`.trim();
  const systemInstruction = PROMPTS.feasibility({ age: profile.age })
    + "\n\n" + buildConditionalPrompt(bCtx)
    + "\n\n" + SAFETY_OVERRIDE_NOTE;

  let raw: unknown;
  try {
    raw = await generateJSON<unknown>({
      systemInstruction,
      userPrompt,
      schemaHint,
      // 1500 (era 800): il prompt feasibility include safety rules age-tiered + conditional
      // modules + COT + JSON_CONSTRAINT + schemaHint + reasoning. Con goal ambiziosi la
      // risposta veniva troncata e parseJSONResponse lanciava "JSON non valida".
      maxTokens: 1500,
    });
  } catch (e: any) {
    // Errore di parsing (risposta non-JSON o troncata) → valutazione conservativa invece
    // di propagare "Risposta non valida" all'utente. Per errori infrastrutturali reali
    // (chiave, quota, network, 503) ri-lanciamo perché il banner rosso del wizard è utile.
    const msg = (e?.message || String(e)).toLowerCase();
    const isParseError = msg.includes("json") || msg.includes("parse") || msg.includes("raw:");
    if (!isParseError) throw e;
    console.warn("[feasibility] JSON parse failed on LLM response, fallback applied:", e?.message);
    return {
      realistic: true,
      reasoning: "Il coach non è riuscito a strutturare la valutazione (risposta troppo lunga o formato inatteso). Ho accettato il tuo obiettivo così com'è: lo userò come riferimento per costruire il piano. Se il risultato non ti convince, riprova o riformula l'obiettivo con più dettagli (es. 'correre 10 km in 55 min entro 8 settimane').",
      counterProposal: {
        description: goalDescription,
        kpi: { metric: "obiettivo utente", target: goalDescription, deadline: "come indicato" },
      },
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    // Fallback graceful: ritorna una valutazione conservativa invece di crashare.
    // NON cacheiamo i fallback degradati (dall'LLM arriverà una risposta ok al retry).
    console.warn("[feasibility] Zod parse failed, fallback applied:", result.error.message);
    return {
      realistic: false,
      reasoning: "Non sono riuscito a strutturare una valutazione. Prova a riformulare l'obiettivo in modo più specifico (es. 'correre 10km in 55min entro 8 settimane').",
      counterProposal: {
        description: goalDescription,
        kpi: { metric: "da definire", target: "-", deadline: "-" },
      },
    };
  }
  FEASIBILITY_CACHE.set(cacheKey, { result: result.data, ts: Date.now() });
  return result.data;
}
