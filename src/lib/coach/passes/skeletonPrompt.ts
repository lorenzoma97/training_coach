// Pass-1 skeleton prompt builder — Wave 4.1.
//
// Owner: llm-prompt-specialist (Wave 4.1).
//
// CONTRATTO:
// - Costruisce il prompt USER per il Pass-1 dell'orchestrator multi-pass.
// - L'output atteso è uno SCHELETRO settimanale: array sessioni con metadata
//   high-level (day/type/duration_min/zone?/focus/subtype?) — SENZA exercises[]
//   per la forza e SENZA intervals[] dettagliati per il cardio.
// - Pass-2 (strengthSessionPrompt + cardioIntervalPrompt) arricchirà ogni
//   sessione che lo richiede; le sessioni mobility/sport restano skeleton.
//
// VINCOLI:
// - Token discipline: prompt ~1200-1800 token, output target ~800-1500 token
//   (vs ~2500-3500 del single-pass legacy).
// - Provider-agnostic: nessun costrutto Gemini-specific.
// - Pure function: nessun I/O. Tutto viene iniettato via SkeletonContext.

import type { UserProfile, UserGoal } from "../../types";
import type { BuildContextMacroCtx } from "../promptBuilder";
import type { ZonesResult } from "../zones";
import { profileAsPrompt, goalsAsPrompt } from "../../diaryContext";
import { workoutSubtypesForPrompt } from "../../workoutCatalog";

// Iniettato quando ≥2 goal attivi: gli obiettivi possono essere conflittuali
// (dimagrimento+ipertrofia, endurance+potenza). Mirror del GOAL_CONFLICT_HINT
// del planGenerator legacy (single source of truth: qui per il multi-pass).
const GOAL_CONFLICT_HINT = `
NOTA SU OBIETTIVI MULTIPLI: hai >=2 goal attivi. Gli obiettivi possono essere conflittuali (es. dimagrimento+ipertrofia, endurance+potenza). Nel "rationale" esplicita come bilanci il conflitto, quale obiettivo ha PRIORITA' questa settimana.
`.trim();

/**
 * Contesto per costruire il prompt Pass-1 skeleton.
 * Tutti i campi sono richiesti dal contratto orchestrator (passOrchestrator.ts).
 */
export interface SkeletonContext {
  profile: UserProfile;
  goals: UserGoal[];
  /** Vincolo HARD su giorni allenabili. Vuoto/undefined = scelta libera LLM. */
  availableDays?: ReadonlyArray<string>;
  /** Macro context (fase/volume/intensita') se l'utente ha race "A" attiva. */
  macroContext?: BuildContextMacroCtx;
  /** Zone FC personalizzate (banner descrittivo, non range bpm inline). */
  zones?: ZonesResult | null;
  /** Readiness band oggi: low → l'LLM deve evitare Z4-Z5. */
  readinessBand?: "low" | "moderate" | "high" | null;
  /** Modalita' di generazione (impatta wording). */
  mode: "initial" | "regen" | "adapt";
  /** Solo per mode=adapt: testo richiesta utente sanitizzato. */
  userRequest?: string;
  /** Solo per mode=regen "rest-of-week": giorni rimanenti della settimana. */
  remainingThisWeek?: ReadonlyArray<string>;
  /** Testo riassuntivo ultimi 14 giorni (mode regen/adapt). */
  recentDaysText?: string;
  /**
   * 2026-05-13: prescription block (testo gia' formattato da
   * formatPrescriptionForPrompt). Iniettato in cima al prompt come "non
   * negoziabile". Backward compat: undefined → niente blocco.
   */
  prescriptionBlock?: string;
}

/**
 * Schema hint per il Pass-1: mirror compatto del planSchema legacy ma SENZA
 * details/rationale per-sessione e SENZA exercises[]/intervals[]. Pass-2
 * popolera' i campi mancanti.
 *
 * CHIAVE: il campo "focus" per-sessione e' una stringa breve (es. "upper push",
 * "long run easy", "VO2max ripetute brevi") che Pass-2 usera' come hint
 * semantico per dettagliare. NON e' equivalente a "details" del legacy.
 */
export const PASS1_SCHEMA_HINT = `
SCHEMA OUTPUT Pass-1 (un solo JSON, niente markdown wrapper):
{
  "weeks": [
    {
      "weekNumber": 1,
      "focus": "string breve — focus tematico settimana (es. 'base aerobica + introduzione forza')",
      "sessions": [
        {
          "day": "lun"|"mar"|"mer"|"gio"|"ven"|"sab"|"dom",
          "type": "corsa"|"forza_gambe"|"forza_upper"|"sport"|"mobilita",
          "subtype": "DEVE essere uno dei valori canonici per il tipo (lista sotto)",
          "duration_min": number,
          "focus": "string breve (3-8 parole) — focus della sessione (es. 'upper push pesante', 'long run Z2', 'VO2max 6x800m', 'mobilita anche')",
          "zone": 1|2|3|4|5 (OBBLIGATORIO per corsa/sport; OMETTI per forza/mobilita)
        }
      ]
    }
  ],
  "rationale": "lista 3-4 bullet (formato '- punto') che giustifica la scelta volume/intensita'/distribuzione della settimana"
}

REGOLE Pass-1 (importante):
- L'array "weeks" deve contenere UNA SOLA settimana con weekNumber=1.
- NON includere "details" testuali per-sessione: Pass-2 li generera'.
- NON includere "exercises" o "intervals": Pass-2 li popolera'.
- "focus" per-sessione DEVE essere breve e semanticamente preciso — Pass-2 lo usera' come hint.

SUBTYPE ALLOWLIST (obbligatorio — inventare nomi rompe il matching piano-diario):
${workoutSubtypesForPrompt()}
Se un'attivita' non ha subtype adatto, scegli il piu' vicino semanticamente.

ZONE: per ogni cardio (corsa/sport) indica la zona target 1-5 (1=Recovery, 2=Easy/Fondo, 3=Tempo, 4=Threshold/Soglia, 5=VO2max/Ripetute). NON inserire bpm: il frontend calcola il range dalle zone personalizzate.
`.trim();

/**
 * Componente macro: iniettato quando l'utente ha race "A" attiva.
 */
function buildMacroBlock(macro: BuildContextMacroCtx | undefined): string {
  if (!macro) return "";
  return [
    "MACROCICLO ATTIVO:",
    `- Fase: ${macro.phase} (settimana ${macro.weekNumber}/${macro.totalWeeks}, ${macro.weeksToRace} sett. alla gara "${macro.race.name}").`,
    `- Volume multiplier: ${macro.volumeMultiplier.toFixed(2)} (modula durata sessioni cardio).`,
    `- Intensita' alta target: ${macro.intensityHighPct}% del volume settimanale (Z4-Z5).`,
    "Adatta volume e distribuzione zone alla fase: base=accumulo Z2; build=intensita' specifica; peak=tapering; race=tapering finale.",
  ].join("\n");
}

/**
 * Componente readiness: low → istruzione esplicita di NON proporre Z4-Z5.
 */
function buildReadinessBlock(band: SkeletonContext["readinessBand"]): string {
  if (band === "low") {
    return "READINESS OGGI: low — riduci intensita' programmata: NESSUNA sessione Z4/Z5 prevista. Preferisci Z1-Z3 e mobility. La sessione di OGGI deve essere recovery/easy.";
  }
  if (band === "high") {
    return "READINESS OGGI: high — utente in forma per sessioni qualita' (Z4-Z5 ammessi se coerenti col macro).";
  }
  return "";
}

/**
 * Componente zone: banner descrittivo (non range bpm inline).
 */
function buildZonesBlock(zones: ZonesResult | null | undefined): string {
  if (!zones) return "";
  const method = zones.method === "tested" ? "FCmax testata" : zones.method === "karvonen" ? "Karvonen (HR rest reale)" : "Tanaka (formula eta')";
  return `ZONE FC PERSONALIZZATE: metodo ${method}. Le 5 zone sono calcolate dal frontend; tu prescrivi la zona logica (Z1-Z5), il numero bpm appare in UI.`;
}

/**
 * Componente available-days: vincolo HARD se popolato.
 */
function buildAvailableDaysBlock(days: ReadonlyArray<string> | undefined): string {
  if (!days || days.length === 0) return "";
  return `GIORNI ALLENABILI (vincolo HARD): ${days.join(", ")}. NON proporre sessioni in altri giorni.`;
}

/**
 * Componente rest-of-week: istruzione mid-week per coprire solo i giorni rimanenti.
 */
function buildRestOfWeekBlock(remaining: ReadonlyArray<string> | undefined): string {
  if (!remaining || remaining.length === 0) return "";
  const guard = remaining.length <= 2
    ? "\nFINESTRA RIDOTTA: max 1 sessione leggera Z2 fino a 30min. NO Z4/Z5, NO ripetute, NO forza pesante."
    : "";
  return `SCENARIO MID-WEEK: copri SOLO i giorni rimanenti ${remaining.join(", ")}. I giorni passati sono CHIUSI (riposo).${guard}`;
}

/**
 * Componente mode-specific: istruzione finale che cambia in base alla modalita'.
 */
function buildModeInstruction(mode: SkeletonContext["mode"], userRequest?: string): string {
  if (mode === "initial") {
    return "Genera lo SCHELETRO della SETTIMANA 1 (una sola, weekNumber=1). Pass-2 dettagliera' esercizi/intervalli; tu scegli solo struttura (giorni, tipo, durata, zona, focus breve).";
  }
  if (mode === "regen") {
    return "Genera lo SCHELETRO della NUOVA settimana (weekNumber=1, una sola), adattando volume/intensita' in base ai dati reali. Se rilevi red flag (dolore, fatica, aderenza bassa), proponi deload esplicito. Pass-2 dettagliera' i contenuti.";
  }
  // adapt
  return [
    `RICHIESTA UTENTE: "${userRequest ?? ""}"`,
    "Genera lo SCHELETRO della settimana modificata (weekNumber=1, una sola) interpretando la richiesta sensatamente.",
    "Esempi: 'piu' intenso' → aumenta zone alte; 'meno intenso' → piu' Z2; 'non posso giovedi' → sposta sessione; 'deload' → -40-50% volume.",
    "Se la richiesta e' rischiosa proponi versione sicura. NON rimuovere tutti i giorni di riposo. Pass-2 dettagliera' il contenuto.",
  ].join("\n");
}

/**
 * Costruisce il prompt USER Pass-1 skeleton.
 * Token target: ~1200-1800 (vs ~2500 del prompt legacy single-pass).
 */
export function buildPass1SkeletonPrompt(ctx: SkeletonContext): string {
  const sections: string[] = [
    "TASK: produci lo SCHELETRO settimanale del piano (Pass-1 di un orchestratore multi-pass). NON dettagliare esercizi/intervalli — Pass-2 lo fara'.",
  ];

  // 2026-05-13: prescription block iniettato in cima — numeri concreti dal
  // pre-pass deterministico. L'LLM e' istruito a rispettarli come "non
  // negoziabili" (vedi formatPrescriptionForPrompt).
  if (ctx.prescriptionBlock && ctx.prescriptionBlock.trim().length > 0) {
    sections.push("");
    sections.push(ctx.prescriptionBlock.trim());
  }

  sections.push(
    "",
    "PROFILO UTENTE:",
    profileAsPrompt(ctx.profile),
    "",
    "OBIETTIVI:",
    goalsAsPrompt(ctx.goals),
  );

  if (ctx.goals.length >= 2) {
    sections.push("");
    sections.push(GOAL_CONFLICT_HINT);
  }

  const macroBlock = buildMacroBlock(ctx.macroContext);
  if (macroBlock) {
    sections.push("");
    sections.push(macroBlock);
  }

  const zonesBlock = buildZonesBlock(ctx.zones ?? null);
  if (zonesBlock) {
    sections.push("");
    sections.push(zonesBlock);
  }

  const readinessBlock = buildReadinessBlock(ctx.readinessBand);
  if (readinessBlock) {
    sections.push("");
    sections.push(readinessBlock);
  }

  const availableBlock = buildAvailableDaysBlock(ctx.availableDays);
  if (availableBlock) {
    sections.push("");
    sections.push(availableBlock);
  }

  const restOfWeekBlock = buildRestOfWeekBlock(ctx.remainingThisWeek);
  if (restOfWeekBlock) {
    sections.push("");
    sections.push(restOfWeekBlock);
  }

  if (ctx.recentDaysText && ctx.recentDaysText.trim().length > 0) {
    sections.push("");
    sections.push("ULTIMI 14 GIORNI (estratto):");
    sections.push(ctx.recentDaysText.trim());
  }

  sections.push("");
  sections.push(buildModeInstruction(ctx.mode, ctx.userRequest));
  sections.push("");
  sections.push(PASS1_SCHEMA_HINT);

  return sections.join("\n");
}
