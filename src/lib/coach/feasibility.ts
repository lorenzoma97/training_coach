import { z } from "zod";
import { generateJSON } from "../gemini";
import { PROMPTS } from "./systemPrompts";
import { profileAsPrompt } from "../diaryContext";
import type { UserProfile, FeasibilityCheck } from "../types";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "./promptBuilder";

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

export async function checkGoalFeasibility(
  profile: UserProfile,
  goalDescription: string,
): Promise<FeasibilityCheck> {
  const cacheKey = feasibilityCacheKey(profile, goalDescription);
  const cached = FEASIBILITY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }
  const userPrompt = `
PROFILO UTENTE:
${profileAsPrompt(profile)}

OBIETTIVO PROPOSTO DALL'UTENTE:
"${goalDescription}"

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
