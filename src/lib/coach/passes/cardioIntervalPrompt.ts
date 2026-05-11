// Pass-2 cardio intervals prompt builder — Wave 4.1.
//
// Owner: llm-prompt-specialist (Wave 4.1).
//
// CONTRATTO:
// - Costruisce il prompt USER per dettagliare UNA singola sessione cardio
//   con intervalli strutturati (Z4 soglia / Z5 ripetute / fartlek).
// - Mirror della struttura di strengthSessionPrompt: pure function, schema
//   hint esplicito, few-shot 3 esempi, regole tassative.
// - L'orchestrator (passOrchestrator.ts) chiama buildCardioIntervalPrompt
//   SOLO per sessioni cardio con zone >= 4 (sessioni Z1-Z3 ricevono details
//   testuali sufficienti dal Pass-1).
//
// VINCOLI:
// - Token discipline: prompt ~1500-2000 token, output ~400-700 token.
// - Provider-agnostic.
// - Pure function: nessun I/O.

import type { PlannedSession, UserProfile } from "../../types";
import type { ZonesResult } from "../zones";
import { profileAsPrompt } from "../../diaryContext";

/**
 * Contesto per Pass-2 cardio intervals.
 */
export interface CardioIntervalContext {
  profile: UserProfile;
  /** Skeleton sessione (da Pass-1): metadata high-level. */
  session: Pick<PlannedSession, "type" | "day" | "duration_min" | "subtype" | "zone">;
  /** Zone FC personalizzate (banner descrittivo). */
  zones?: ZonesResult | null;
  /** Hint testuale "focus" della sessione dal Pass-1 (es. "VO2max 6x800m"). */
  sessionFocus?: string;
}

/**
 * Few-shot prescrittivi: 3 esempi che coprono Z4 soglia, Z5 ripetute brevi,
 * fartlek progressivo. Token budget ~600 token totali.
 */
export const CARDIO_INTERVAL_FEW_SHOT_EXAMPLES = `
ESEMPIO 1 — Sessione VO2max ripetute brevi (~50min totali, Z5):
{
  "intervals": [
    { "kind": "warmup", "duration_min": 15, "zone": 2, "cue": "Corsa lenta progressiva, ultimi 5 min con 4x30s allunghi." },
    { "kind": "repetition", "duration_min": 3, "zone": 5, "reps": 6, "recovery_sec": 120, "cue": "800m a passo VO2max — controllo respiro, postura alta." },
    { "kind": "cooldown", "duration_min": 10, "zone": 1, "cue": "Defaticamento + stretch dinamico polpacci/quad." }
  ],
  "details": "Warmup 15' Z2 + 6x800m Z5 (rec 2' jog) + cooldown 10' Z1.",
  "rationale": "VO2max stimulus: 6x3' a intensita' massimale aerobica con recovery completo. Progressione: settimana prossima 7x800m o riduzione recovery a 90s."
}

ESEMPIO 2 — Sessione soglia continua 20min (~50min totali, Z4):
{
  "intervals": [
    { "kind": "warmup", "duration_min": 15, "zone": 2, "cue": "Easy run, ultimi 3 min progressivi fino a Z3." },
    { "kind": "main", "duration_min": 20, "zone": 4, "cue": "Tempo run continuo a passo soglia — respirazione controllata, sforzo 'comfortably hard'." },
    { "kind": "cooldown", "duration_min": 10, "zone": 1, "cue": "Camminata + corsa lentissima, mobilita' anche." }
  ],
  "details": "Warmup 15' Z2 + 20' continuo Z4 + cooldown 10' Z1.",
  "rationale": "Threshold continuo: stimolo lattico-buffering con singolo blocco di 20'. Adatto per atleti con esperienza Z4 stabile. Progressione: settimana prossima 25' o split 2x12' con 3' jog."
}

ESEMPIO 3 — Fartlek progressivo (~45min totali, Z3-Z5):
{
  "intervals": [
    { "kind": "warmup", "duration_min": 10, "zone": 2, "cue": "Easy run, mobilita' dinamica caviglie." },
    { "kind": "repetition", "duration_min": 3, "zone": 4, "reps": 5, "recovery_sec": 90, "cue": "Fartlek 5x3' progressivo: rep 1-2 Z4, rep 3-4 Z4-5, rep 5 Z5 max sostenibile." },
    { "kind": "cooldown", "duration_min": 10, "zone": 1, "cue": "Defaticamento + foam rolling polpacci." }
  ],
  "details": "Warmup 10' + fartlek 5x3' progressivo Z4->Z5 (rec 90s) + cooldown 10'.",
  "rationale": "Fartlek progressivo: combina stimolo soglia + VO2max in singola sessione. Utile per build phase pre-gara. Variazione vs ripetute pure: meno meccanico, piu' stress mentale di gestione passo."
}
`.trim();

/**
 * Schema hint output Pass-2 cardio.
 */
export const CARDIO_INTERVAL_SCHEMA_HINT = `
SCHEMA OUTPUT (un singolo JSON, niente markdown wrapper):
{
  "intervals": CardioInterval[],     // REQUIRED, min 3 max 12 blocchi (warmup + main/repetition + cooldown)
  "exercises": undefined,             // OMETTI: sessione cardio, no esercizi forza
  "details": string,                  // REQUIRED — riassunto leggibile 1-2 frasi
  "rationale": string,                // REQUIRED — 2-3 frasi: perche' questa struttura + come progressi
  "warmupRoutineId": string?,         // opzionale: id MobilityRoutine
  "cooldownRoutineId": string?,       // opzionale
  "progressionRule": {                // opzionale ma RACCOMANDATO
    "triggerCondition": string,       // es. "se RPE percepito <=7 nelle ultime 2 ripetute"
    "action": string                  // es. "+1 ripetuta o -10s recovery la prossima settimana"
  }?
}

SHAPE CardioInterval (ogni elemento di "intervals"):
{
  "kind": "warmup"|"main"|"cooldown"|"repetition"|"recovery",  // REQUIRED
  "duration_min": number?,           // REQUIRED se non distance_km
  "distance_km": number?,            // alternativa a duration_min (es. "1km @ Z4")
  "zone": 1|2|3|4|5,                 // REQUIRED per kind != recovery
  "reps": number?,                   // SOLO per kind=repetition (es. 6x800m → reps=6)
  "recovery_sec": number?,           // SOLO per kind=repetition (recovery PRIMA del prossimo rep)
  "cue": string?                     // breve cue tecnico
}

REGOLA STRUTTURA: ogni sessione DEVE avere warmup (Z1-Z2, 8-15 min) + main/repetition + cooldown (Z1, 5-10 min).
- Warmup: kind="warmup", zone 1-2, 8-15 min.
- Main: o kind="main" (continuo Z3-Z4) o kind="repetition" (Z4-Z5 con reps + recovery_sec).
- Cooldown: kind="cooldown", zone 1, 5-10 min.

REGOLA RECOVERY tra ripetute (kind=repetition):
- Z5 brevi (200-800m, 30s-3min): recovery 60-180s in jog Z1.
- Z4 medi (800-1600m, 3-6min): recovery 60-120s in jog Z1.
- Z4 soglia continua: NESSUNA recovery (kind="main" singolo blocco).
`.trim();

/**
 * Componente zone block (descrittivo).
 */
function buildZonesBlock(zones: ZonesResult | null | undefined): string {
  if (!zones) return "";
  const method = zones.method === "tested" ? "FCmax testata" : zones.method === "karvonen" ? "Karvonen" : "Tanaka";
  return `ZONE FC: metodo ${method}. Le 5 zone sono calcolate dal frontend; tu prescrivi la zona logica (Z1-Z5).`;
}

/**
 * Costruisce il prompt USER per Pass-2 cardio. Self-contained.
 */
export function buildCardioIntervalPrompt(ctx: CardioIntervalContext): string {
  const { profile, session, zones, sessionFocus } = ctx;

  const profileBlock = profileAsPrompt(profile);
  const zonesBlock = buildZonesBlock(zones);

  const focusLine = sessionFocus
    ? `Focus dichiarato (Pass-1): "${sessionFocus}" — interpreta sensatamente per scegliere struttura intervalli.`
    : "";

  const sessionBlock = `
SESSIONE DA DETTAGLIARE (skeleton ricevuto da Pass-1):
- Giorno: ${session.day}
- Tipo: ${session.type}${session.subtype ? ` (subtype: ${session.subtype})` : ""}
- Durata target: ${session.duration_min} min
- Zona prevalente: Z${session.zone ?? "?"}
${focusLine}
`.trim();

  const rules = `
REGOLE TASSATIVE (il validator scarta l'output se violate):
1. Min 3 blocchi (warmup + main/repetition + cooldown). Max 12.
2. Warmup obbligatorio Z1-Z2 (8-15 min). Cooldown obbligatorio Z1 (5-10 min).
3. Se zone target = 5 → preferisci kind=repetition con reps + recovery_sec (NON un singolo blocco da 30min Z5).
4. Se zone target = 4 → puoi usare kind=main (continuo singolo) O kind=repetition (rep lunghe).
5. duration_min totale (warmup + reps*durata + cooldown) ≈ ${session.duration_min} min. Stima realistica.
6. Anti-mirror: se sessione precedente era stessa struttura, varia (cambia reps, durata, recovery, zone mix).
7. Output: JSON puro, NO markdown, NO commenti, NO testo extra.
`.trim();

  const sections: string[] = [
    "TASK: detta i dettagli completi di UNA singola sessione cardio (Z4-Z5 o intervalli), restituendo un singolo JSON.",
    "",
    "PROFILO UTENTE:",
    profileBlock,
    "",
    sessionBlock,
  ];

  if (zonesBlock) {
    sections.push("");
    sections.push(zonesBlock);
  }

  sections.push("");
  sections.push(rules);
  sections.push("");
  sections.push("FEW-SHOT EXAMPLES (riferimento di shape e qualita' — NON copiare i valori):");
  sections.push(CARDIO_INTERVAL_FEW_SHOT_EXAMPLES);
  sections.push("");
  sections.push(CARDIO_INTERVAL_SCHEMA_HINT);

  return sections.join("\n");
}
