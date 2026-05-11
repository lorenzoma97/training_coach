// Pass 2 forza — prompt builder isolato per dettagliare una singola sessione
// di forza in un piano multi-pass (Wave 3.1, ARCHITECTURE.md §3.1, §5.2).
//
// Owner: llm-prompt-specialist (Wave 3.1).
//
// CONTRATTO:
// - Riceve uno "skeleton" di sessione (type/day/duration/subtype/macroPhase) prodotto da Pass 1.
// - Ritorna un prompt utente self-contained che chiede all'LLM un singolo JSON
//   conforme allo `STRENGTH_PASS2_SCHEMA_HINT` qui dichiarato.
// - L'orchestrator multi-pass (Wave 4.1) cablerà retrieval RAG + history + 1RM,
//   poi consumerà l'output con uno schema Zod separato. Qui NON facciamo
//   parsing, NON facciamo I/O: pure function string-in / string-out.
//
// VINCOLI:
// - Token discipline: prompt totale ~3500-4500 token. Catalog allowlist
//   limitata a 40 entries; few-shot 3 esempi compatti (~750 token totali).
// - Anti-hallucination: catalog allowlist iniettata + schema esplicito.
// - Provider-agnostic: nessun costrutto Gemini-specific.

import type {
  PlannedSession,
  UserProfile,
  Exercise,
  OneRepMax,
  ExercisePerformance,
  ExerciseSet,
  EquipmentTag,
} from "../../types";
import { EXERCISES, EXERCISES_BY_ID } from "../../catalog/exercises";
import { profileAsPrompt, type Workout } from "../../diaryContext";
import { normalizeEquipmentTags } from "../../equipment/equipmentNormalizer";
import { walkAlternativeChain } from "../equipmentSubstitutor";

/**
 * Contesto necessario per costruire il prompt Pass-2 forza.
 * I campi `recentStrengthHistory` e `oneRepMaxes` possono essere vuoti (utente
 * nuovo / 1RM non ancora testati): il prompt si auto-adatta.
 */
export interface StrengthSessionContext {
  profile: UserProfile;
  /** Skeleton sessione (da Pass 1): solo metadata high-level. */
  session: Pick<PlannedSession, "type" | "day" | "duration_min" | "subtype" | "macroPhase">;
  /** Workouts ultimi ~30gg per gli esercizi rilevanti (data-integration). */
  recentStrengthHistory: Workout[];
  /** Chunks RAG già concatenati (filter contexts=["strength_db"]). Vuoto se nessun match. */
  ragContextStrength: string;
  /** 1RM disponibili per esercizi rilevanti (subset di profile.oneRepMaxes). */
  oneRepMaxes: OneRepMax[];
  /** Equipment dell'utente (da profile.equipment). Override di profile.equipment se serve. */
  equipment: string[];
  /**
   * Hint testuale "focus" della sessione dal Pass-1 (es. "upper push pesante").
   * Propagato dall'orchestrator: Pass-1 popola `session.details` con `focus`
   * dal LLM skeleton, Pass-2 lo passa come `sessionFocus` per orientare la
   * scelta di pattern motori (push vs pull vs squat vs hinge).
   */
  sessionFocus?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG ALLOWLIST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estrae l'attrezzatura disponibile dell'utente come Set<string> per check O(1).
 * Tag `bodyweight` viene SEMPRE considerato disponibile (corpo libero gratis).
 *
 * Normalizza input italiano free-text (es. "manubri" → "dumbbell", "palestra" →
 * superset gym) tramite normalizeEquipmentTags. Senza questo, l'utente che ha
 * dichiarato equipment in italiano vedrebbe un prompt con "nessun esercizio
 * disponibile" → l'LLM cadrebbe in fallback bodyweight per default.
 */
function buildEquipmentSet(equipment: string[]): Set<string> {
  return new Set<string>(normalizeEquipmentTags(equipment));
}

/**
 * True se l'esercizio è eseguibile con l'equipment dell'utente
 * (TUTTI i tag in ex.equipment devono essere presenti, AND non OR).
 */
function isExerciseAvailable(ex: Exercise, equipSet: Set<string>): boolean {
  for (const tag of ex.equipment) {
    if (!equipSet.has(tag)) return false;
  }
  return true;
}

/**
 * Genera la sezione "ESERCIZI DISPONIBILI" iniettata nel prompt.
 *
 * @param equipment lista equipment dell'utente. "bodyweight" sempre incluso.
 * @param pattern   se specificato, filtra solo esercizi di quel pattern motorio.
 * @returns blocco testuale `id | name | level | primaryMuscles` (max 40 righe).
 *
 * Token budget: ~40 righe × ~25 token/riga ≈ 1000 token (worst case).
 *
 * Regole di selezione (per token economy):
 * 1. Filter equipment compatibility (hard filter).
 * 2. Filter by pattern se specificato.
 * 3. Cap a 40 entries: prioritizza loadable=true (più utili a Pass 2 forza),
 *    poi sort alfabetico (deterministico per stabilità test/cache).
 */
export function strengthCatalogForPrompt(equipment: string[], pattern?: string): string {
  const equipSet = buildEquipmentSet(equipment);
  // Wave 3.5 Reviewer-deferred minor #2: pre-filtriamo le alt[] di ciascun
  // esercizio rispetto all'equipment dichiarato. Mostriamo SOLO gli alt che
  // sono *direttamente* eseguibili dall'utente (hop=0 sul substitutor), così
  // l'LLM non vede id "fantasma" non disponibili.
  // EquipmentTag[] derivato dalla canonical Set: i tag in equipSet sono già
  // normalizzati (es. "manubri" → "dumbbell") e includono "bodyweight" implicito.
  const availableEquipment = Array.from(equipSet) as EquipmentTag[];
  let pool = EXERCISES.filter(ex => isExerciseAvailable(ex, equipSet));
  if (pattern) {
    pool = pool.filter(ex => ex.pattern === pattern);
  }

  // Sort: loadable first (forza ha bisogno di carico), poi alfabetico per id.
  // NOTA: NON ordiniamo per level (beginner-first) — l'LLM beneficia di vedere
  // i main lifts intermediate (back-squat, bench-press) anche per utenti regular.
  // Sort alfabetico = deterministico → output stabile (utile per cache/test).
  pool.sort((a, b) => {
    if (a.loadable !== b.loadable) return a.loadable ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  // Cap entries per token discipline. 40 lascia spazio sufficiente per coprire
  // tutti i main lift compatibili con un equipment medio (~30-40 esercizi).
  const MAX_ENTRIES = 40;
  const head = pool.slice(0, MAX_ENTRIES);

  const headerNote = pool.length > MAX_ENTRIES
    ? `(${pool.length} esercizi disponibili, mostrati primi ${MAX_ENTRIES} per token economy)`
    : `(${pool.length} esercizi disponibili)`;

  if (head.length === 0) {
    // Edge case: nessun esercizio compatibile (dovrebbe non succedere mai grazie a bodyweight).
    return [
      "ESERCIZI DISPONIBILI (rispetta TASSATIVAMENTE id e nome):",
      "(nessun esercizio disponibile per l'equipment dichiarato — usa esercizi a corpo libero generici)",
    ].join("\n");
  }

  const lines = head.map(ex => {
    const muscles = ex.primaryMuscles.slice(0, 3).join(", ");
    // Wave 3.5 (G8) + Reviewer-deferred minor #2: mostriamo le alternatives
    // PRE-FILTRATE per l'equipment dell'utente. Pre-filter rule: un alt è
    // "disponibile" se walkAlternativeChain(altId, hop=0) lo risolve a SE STESSO
    // (resolvedId === altId), cioè è direttamente eseguibile senza ulteriori swap.
    // Risultato: l'LLM non vede id che non potrebbe comunque scegliere → niente
    // confusione tra "alt teoriche" e "alt reali".
    // Max 3 alt mostrate per token discipline (come pre-fix).
    const filteredAlts = (ex.alternatives ?? []).filter(altId => {
      const r = walkAlternativeChain(altId, availableEquipment, EXERCISES, 0);
      return r !== null && r.resolvedId === altId;
    });
    const altList = filteredAlts.slice(0, 3).join(", ");
    const altPart = altList ? ` | alt: ${altList}` : "";
    return `- ${ex.id} | ${ex.name} | ${ex.level} | ${muscles}${altPart}`;
  });

  return [
    `ESERCIZI DISPONIBILI ${headerNote} — rispetta TASSATIVAMENTE \`exerciseId\` (slug, NON il nome):`,
    ...lines,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// FEW-SHOT EXAMPLES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 3 esempi prescrittivi di output Pass-2 forza ben formato.
 * Token budget: ~750 token totali (~250 each).
 *
 * Coerenza interna garantita:
 * - Set/reps consistenti con %1RM (>85% → ≤5 reps; 70-85% → 6-12; <70% → 12+).
 * - Rest_sec coerente: forza pesante 180-300s, ipertrofia 60-120s.
 * - Cue brevi e tecnici.
 * - Mix main lift + accessory tipico per la categoria.
 */
export const STRENGTH_FEW_SHOT_EXAMPLES = `
ESEMPIO 1 — Sessione FORZA UPPER intermediate (60min, ipertrofia, 1RM bench=80kg):
{
  "exercises": [
    { "exerciseId": "bench-press-flat-barbell", "plannedSets": 4, "repsTarget": {"min": 6, "max": 8}, "pct1RM": 75, "rest_sec": 180, "cue": "Scapole retratte, barra al petto basso, gomiti 45°" },
    { "exerciseId": "barbell-row-bent-over", "plannedSets": 4, "repsTarget": {"min": 8, "max": 10}, "rpe_target": 8, "rest_sec": 120, "cue": "Busto a 30°, tira al pube, scapole compresse" },
    { "exerciseId": "military-press-standing-barbell", "plannedSets": 3, "repsTarget": {"min": 6, "max": 8}, "rpe_target": 8, "rest_sec": 150, "cue": "Glutei attivi, barra in linea con caviglie" },
    { "exerciseId": "pull-up-bodyweight", "plannedSets": 3, "repsTarget": {"min": 6, "max": 10}, "rpe_target": 9, "rest_sec": 120, "cue": "Discesa controllata 2s, mento sopra la sbarra" },
    { "exerciseId": "plank-front-bodyweight", "plannedSets": 3, "repsTarget": {"min": 30, "max": 45}, "rpe_target": 7, "rest_sec": 60, "cue": "Bacino neutro, glutei attivi" }
  ],
  "details": "5 esercizi: bench 4x6-8 @75%1RM + row 4x8-10 + military 3x6-8 + pull-up 3x6-10 + plank 3x30-45s.",
  "rationale": "Push/pull bilanciati 2:2 per equilibrio scapolare. Bench main lift @75% per ipertrofia con stimolo neuromuscolare. Plank chiude per anti-estensione lombare.",
  "progressionRule": { "triggerCondition": "se 2 sessioni consecutive con RPE bench ≤7 a 8 reps", "action": "+2.5 kg bench la prossima settimana" }
}

ESEMPIO 2 — Sessione FORZA LOWER beginner (45min, no 1RM testati):
{
  "exercises": [
    { "exerciseId": "goblet-squat-kettlebell", "plannedSets": 3, "repsTarget": {"min": 10, "max": 12}, "rpe_target": 7, "rest_sec": 90, "cue": "Petto alto, talloni a terra, sotto parallelo" },
    { "exerciseId": "deadlift-romanian-dumbbell", "plannedSets": 3, "repsTarget": {"min": 10, "max": 12}, "rpe_target": 7, "rest_sec": 90, "cue": "Busto neutro, manubri lungo le gambe, hinge dell'anca" },
    { "exerciseId": "reverse-lunge-bodyweight", "plannedSets": 3, "repsTarget": {"min": 10, "max": 12}, "rpe_target": 6, "rest_sec": 60, "cue": "Passo lungo dietro, ginocchio anteriore stabile sopra il piede" },
    { "exerciseId": "glute-bridge-bodyweight", "plannedSets": 3, "repsTarget": {"min": 12, "max": 15}, "rpe_target": 6, "rest_sec": 60, "cue": "Spinta dei talloni, contrazione glutei 1s in cima" }
  ],
  "details": "4 esercizi total-body lower con focus tecnica: goblet squat 3x10-12 + RDL 3x10-12 + reverse lunge 3x10-12 + glute bridge 3x12-15.",
  "rationale": "Beginner senza 1RM testati: usa rpe_target invece di pct1RM. Volume moderato 12 set/sessione, focus pattern motorio (hinge + squat + lunge + isolation glutei).",
  "warmupRoutineId": "movement-prep"
}

ESEMPIO 3 — Sessione FORZA FULL BODY advanced (75min, 1RM squat=120 / bench=95):
{
  "exercises": [
    { "exerciseId": "back-squat-barbell", "plannedSets": 5, "repsTarget": {"min": 5, "max": 5}, "pct1RM": 82, "rest_sec": 240, "cue": "Bracing OPF, discesa 2s, esplosivo sull'alzata" },
    { "exerciseId": "bench-press-flat-barbell", "plannedSets": 4, "repsTarget": {"min": 5, "max": 6}, "pct1RM": 80, "rest_sec": 180, "cue": "Arch leggero, gomiti tucked, pausa 1s al petto" },
    { "exerciseId": "pull-up-bodyweight", "plannedSets": 4, "repsTarget": {"min": 6, "max": 8}, "rpe_target": 8, "rest_sec": 120, "cue": "Full ROM, scapole prima del braccio" },
    { "exerciseId": "deadlift-romanian-barbell", "plannedSets": 3, "repsTarget": {"min": 8, "max": 10}, "rpe_target": 8, "rest_sec": 120, "cue": "Hinge puro, barra vicina al corpo, schiena neutra" }
  ],
  "details": "Full body classico forza: squat 5x5 @82% + bench 4x5-6 @80% + pull-up 4x6-8 + RDL 3x8-10.",
  "rationale": "Schema 5x5 per main lifts (massima espressione di forza con 1RM disponibili). Pull-up + RDL come accessori per pattern complementari (vertical pull + hinge). Rest 4min su squat per recupero ATP-CP.",
  "progressionRule": { "triggerCondition": "se squat 5x5 completato @RPE ≤8", "action": "+2.5 kg back squat la prossima settimana" }
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPMENT SUBSTITUTION RULES (Wave 3.5, G8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Istruzioni esplicite per l'LLM su come gestire la chain di alternative quando
 * l'esercizio "canonico" preferito richiede equipment che l'utente NON ha.
 *
 * Razionale: il catalog allowlist è già pre-filtrato sull'equipment dell'utente
 * (strengthCatalogForPrompt esclude i non-eseguibili), ma per ogni esercizio
 * mostriamo `alt: id1, id2, id3` — l'LLM deve scegliere il PRIMO alt disponibile
 * (cioè il primo che compare ANCH'ESSO nella allowlist) se per qualche ragione
 * vuole "puntare" a un esercizio che non è in lista.
 *
 * Token cost: ~120 token. Budget compatibile.
 */
export const STRENGTH_SUBSTITUTION_RULES = `
EQUIPMENT SUBSTITUTION RULES (G8):
- Il catalog ESERCIZI DISPONIBILI è GIÀ filtrato sull'equipment dichiarato dall'utente.
- Se proponi un exerciseId che richiede equipment NON disponibile → output rigettato dal validator.
- Per ogni esercizio, il campo "alt: id1, id2" mostra la chain di sostituti in ordine di preferenza
  (degradante: barbell → dumbbell → kettlebell → bodyweight).
- Se l'esercizio "ideale" che vorresti proporre NON appare nella lista (perché manca un attrezzo),
  scegli il PRIMO id della sua chain "alt:" che SÌ appare nella lista.
- Esempio: vuoi prescrivere back-squat-barbell ma non è in lista (no barbell). Cerca un esercizio
  in lista che lo abbia tra le sue alt, oppure usa direttamente goblet-squat-kettlebell o
  bodyweight-squat se kettlebell/bodyweight sono disponibili.

ESEMPIO SUBSTITUTION — utente SENZA barbell, con dumbbell + bench:
{
  "exercises": [
    { "exerciseId": "goblet-squat-kettlebell", "plannedSets": 4, "repsTarget": {"min": 8, "max": 10}, "rpe_target": 7, "rest_sec": 90, "cue": "Petto alto, KB al petto a due mani" },
    { "exerciseId": "bench-press-flat-dumbbell", "plannedSets": 4, "repsTarget": {"min": 8, "max": 10}, "rpe_target": 8, "rest_sec": 120, "cue": "Manubri controllati, gomiti 45°" },
    { "exerciseId": "dumbbell-row-bent-over", "plannedSets": 3, "repsTarget": {"min": 8, "max": 12}, "rpe_target": 7, "rest_sec": 90, "cue": "Busto a 30°, scapole compresse" }
  ],
  "details": "Sessione full body adattata: KB squat + DB bench + DB row. NIENTE bilanciere usato.",
  "rationale": "Substitution G8: back-squat-barbell → goblet-squat-kettlebell (chain alt[0]); bench-press-flat-barbell → bench-press-flat-dumbbell (alt[0]). Stesso pattern motorio, equipment compatibile."
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA HINT (output atteso)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema JSON output per Pass-2 forza. Citazione esplicita dei campi
 * REQUIRED — l'orchestrator (Wave 4.1) farà parse Zod e fail se mancanti.
 *
 * NOTA: il blocco è descrittivo, non Zod-strict. La validazione vera sta
 * nello schema Zod che l'orchestrator costruirà importando i tipi da
 * `src/lib/types.ts`.
 */
export const STRENGTH_PASS2_SCHEMA_HINT = `
SCHEMA OUTPUT (un singolo oggetto JSON, niente array, niente markdown wrapper):
{
  "exercises": PlannedExercise[],   // REQUIRED, min 3 max 8 esercizi
  "intervals": undefined,            // OMETTI: sessione forza, no intervalli cardio
  "blocks": SessionBlock[]?,         // opzionale per warmup/cooldown narrativi
  "details": string,                 // REQUIRED — riassunto leggibile 1-2 frasi
  "rationale": string,               // REQUIRED — 2-3 frasi: perché questi esercizi + come progressi
  "warmupRoutineId": string?,        // opzionale: id di una MobilityRoutine (es. "movement-prep")
  "cooldownRoutineId": string?,      // opzionale
  "progressionRule": {               // opzionale ma RACCOMANDATO se 1RM noti
    "triggerCondition": string,      // es. "se 2 sessioni consecutive con RPE ≤7"
    "action": string                 // es. "+2.5 kg bench la prossima settimana"
  }?
}

SHAPE PlannedExercise (ogni elemento di "exercises"):
{
  "exerciseId": string,              // REQUIRED — DEVE essere uno slug del catalog allowlist
  "plannedSets": number,             // REQUIRED — int ≥1
  "repsTarget": { "min": number, "max": number },  // REQUIRED — min ≤ max, range tipico 1-30
  "weight_kg": number?,              // opzionale — kg assoluti (mutually exclusive con pct1RM)
  "pct1RM": number?,                 // opzionale 0-100 — solo se 1RM esercizio noto
  "rpe_target": number?,             // opzionale 1-10 — fallback se né weight_kg né pct1RM
  "rir_target": number?,             // opzionale 0-5 — alternativa pedagogica a RPE
  "rest_sec": number,                // REQUIRED — coerente con intensità (vedi REGOLE)
  "cue": string?                     // opzionale — 1 frase tecnica breve
}

REGOLA CARICO: per ogni esercizio, prescrivi UNO tra (weight_kg | pct1RM | rpe_target).
- Se 1RM esercizio noto → preferisci pct1RM (più progressivo).
- Se 1RM NON noto → SOLO rpe_target (range 6-9). NON inventare pct1RM.
- weight_kg lascialo vuoto: lo calcola il frontend da pct1RM × 1RM al rendering.

ESEMPIO shape exercises[]:
{
  "exerciseId": "back-squat-barbell",
  "plannedSets": 4,
  "repsTarget": { "min": 6, "max": 8 },
  "pct1RM": 75,
  "rest_sec": 180,
  "cue": "Petto alto, ginocchia in linea con piedi"
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY SUMMARIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estrae un riassunto compatto delle ultime N sessioni forza per esercizio.
 * Usato per iniettare progressione nel prompt: l'LLM vede "ultime 4 squat:
 * 80x5x3, 82.5x5x3, ..." e può proporre +2.5kg invece di proporre lo stesso.
 *
 * Token budget: ~1 riga per esercizio × max 6 esercizi = ~150 token.
 */
function summarizeRecentHistory(workouts: Workout[]): string {
  if (!workouts || workouts.length === 0) return "";

  // Aggregazione: per ogni exerciseId, raccogli i set più recenti (max 4 sessioni).
  type Entry = { exerciseId: string; sessions: Array<{ date?: string; sets: ExerciseSet[] }> };
  const byExercise = new Map<string, Entry>();

  for (const w of workouts) {
    const perfList: ExercisePerformance[] = w.exercises ?? [];
    const date = w.createdAt ?? w.updatedAt;
    for (const p of perfList) {
      if (!p.exerciseId || !p.sets?.length) continue;
      let entry = byExercise.get(p.exerciseId);
      if (!entry) {
        entry = { exerciseId: p.exerciseId, sessions: [] };
        byExercise.set(p.exerciseId, entry);
      }
      if (entry.sessions.length < 4) {
        entry.sessions.push({ date, sets: p.sets });
      }
    }
  }

  if (byExercise.size === 0) return "";

  const lines: string[] = [];
  // Cap a 6 esercizi per token economy.
  const entries = Array.from(byExercise.values()).slice(0, 6);
  for (const e of entries) {
    const exName = EXERCISES_BY_ID[e.exerciseId]?.name ?? e.exerciseId;
    const sessionDescs = e.sessions.map(s => {
      const repr = s.sets
        .map(set => {
          const w = set.weight_kg != null ? `${set.weight_kg}` : "BW";
          return `${w}x${set.reps}`;
        })
        .join(", ");
      return repr;
    });
    lines.push(`- ${exName} (${e.exerciseId}): [${sessionDescs.join(" | ")}]`);
  }

  return [
    "STORIA CARICHI (ultime sessioni per esercizio, formato kg×reps per set):",
    ...lines,
    "→ Applica progressive overload: se utente ha completato target con RPE ≤8, proponi +2.5kg / +1 rep / +1 set la prossima volta. Anti-mirror: NON ripetere identico l'ultima sessione.",
  ].join("\n");
}

/**
 * Riassume i 1RM disponibili in formato compatto per il prompt.
 */
function summarizeOneRepMaxes(orms: OneRepMax[]): string {
  if (!orms || orms.length === 0) {
    return "1RM DISPONIBILI: nessuno testato — usa rpe_target (range 6-9) invece di pct1RM per tutti gli esercizi.";
  }
  const lines = orms.map(o => {
    const exName = EXERCISES_BY_ID[o.exerciseId]?.name ?? o.exerciseId;
    return `- ${o.exerciseId} (${exName}): ${o.value_kg}kg [${o.source}, ${o.acquiredAt}]`;
  });
  return [
    "1RM DISPONIBILI (usa pct1RM per questi esercizi; per gli altri usa rpe_target):",
    ...lines,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDER PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Costruisce il prompt USER per Pass-2 forza. Self-contained: include profilo,
 * sessione skeleton, catalog allowlist, storia carichi, 1RM, RAG context,
 * regole, few-shot e schema hint.
 *
 * L'orchestrator (Wave 4.1) lo combinerà con un system prompt apposito
 * (persona PT pro, no replicate user, propose evolution) prima di chiamare
 * il provider LLM.
 *
 * Token budget: ~3500-4500 token.
 */
export function buildStrengthPassPrompt(ctx: StrengthSessionContext): string {
  const { profile, session, recentStrengthHistory, ragContextStrength, oneRepMaxes, equipment, sessionFocus } = ctx;

  // Pattern hint dal subtype (best-effort): se subtype contiene "upper"/"lower"/etc.,
  // potremmo restringere il catalog. Per Wave 3.1 non filtriamo per pattern: mostriamo
  // tutti gli esercizi compatibili (l'LLM sceglie). Risparmieremmo ~1K token filtrando
  // ma rischiamo di tagliare combinazioni utili (es. push/pull mix in upper).
  const catalogBlock = strengthCatalogForPrompt(equipment);

  const profileBlock = profileAsPrompt(profile);
  const historyBlock = summarizeRecentHistory(recentStrengthHistory);
  const ormBlock = summarizeOneRepMaxes(oneRepMaxes);

  const macroPhaseLine = session.macroPhase
    ? `Fase macrociclo: ${session.macroPhase} (adatta intensità/volume di conseguenza).`
    : "";

  const focusLine = sessionFocus
    ? `Focus della sessione (dal Pass-1): "${sessionFocus}" — orienta scelta esercizi e pattern motori in coerenza con questo focus.`
    : "";

  const ragBlock = ragContextStrength?.trim()
    ? [
        "CONTESTO SCIENTIFICO (RAG, contexts=strength_db):",
        ragContextStrength.trim(),
      ].join("\n")
    : "";

  const rules = `
REGOLE TASSATIVE (il validator scarta l'output se violate):
1. Ogni "exerciseId" DEVE essere uno slug presente nella ESERCIZI DISPONIBILI sopra. NON inventare id.
2. Sets/reps DEVONO matchare la zona di intensità:
   - Forza pura/potenza (>85% 1RM o RPE 9+): max 5 reps/set
   - Ipertrofia (70-85% 1RM o RPE 7-8): 6-12 reps/set
   - Endurance muscolare (<70% o RPE 5-7): 12-25 reps/set
3. "rest_sec" coerente con intensità:
   - Forza/potenza: 180-300s
   - Ipertrofia: 60-120s
   - Endurance: 30-60s
   - Core/isolation: 45-90s
4. Per ogni esercizio prescrivi UNO tra (weight_kg | pct1RM | rpe_target):
   - Se 1RM esercizio noto → pct1RM (preferito).
   - Se 1RM NON noto → SOLO rpe_target (6-9). NON inventare pct1RM né weight_kg.
5. Anti-mirror: se l'utente ha già fatto sessione simile recente (vedi STORIA),
   varia esercizio o intensità (+5-10%) o schema set/reps. NON copiare identico.
6. Min 3 max 8 esercizi totali. Bilancia pattern (push/pull/squat/hinge) coerenti
   con il subtype (upper / lower / full body).
7. duration_min target ≈ ${session.duration_min}. Stima realistica: ~5-7min per esercizio
   incluso recupero. Non sforare.
8. Output: JSON puro, NO markdown, NO commenti, NO testo extra.
`.trim();

  const sessionBlock = `
SESSIONE DA DETTAGLIARE (skeleton ricevuto da Pass 1):
- Giorno: ${session.day}
- Tipo: ${session.type}${session.subtype ? ` (subtype: ${session.subtype})` : ""}
- Durata target: ${session.duration_min} min
${macroPhaseLine}
${focusLine}
`.trim();

  // Componiamo il prompt finale.
  const sections: string[] = [
    "TASK: detta i dettagli completi di UNA singola sessione forza, restituendo un singolo JSON.",
    "",
    "PROFILO UTENTE:",
    profileBlock,
    "",
    sessionBlock,
    "",
    catalogBlock,
    "",
    ormBlock,
  ];

  if (historyBlock) {
    sections.push("");
    sections.push(historyBlock);
  }

  if (ragBlock) {
    sections.push("");
    sections.push(ragBlock);
  }

  sections.push("");
  sections.push(rules);
  sections.push("");
  sections.push(STRENGTH_SUBSTITUTION_RULES);
  sections.push("");
  sections.push("FEW-SHOT EXAMPLES (riferimento di shape e qualità — NON copiare i valori):");
  sections.push(STRENGTH_FEW_SHOT_EXAMPLES);
  sections.push("");
  sections.push(STRENGTH_PASS2_SCHEMA_HINT);

  return sections.join("\n");
}
