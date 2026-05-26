// Parser markdown → MacroProgram (Sprint 2, 2026-05-25).
//
// Input: file .md generato da Claude usando docs/MACROPROGRAM_TEMPLATE.md.
// Output: MacroProgramParseResult con:
//  - program: MacroProgram typed (narrative + json structured)
//  - orphanExercises: [] (Sprint 2 ancora vuoto; Sprint 3 implementa il check vs catalog)
//  - warnings: hint non-bloccanti
//
// Architettura:
// 1. Estrae il blocco ```json (case-insensitive, gestisce code-fence con/senza linguaggio)
// 2. JSON.parse + Zod validate (MacroProgramJsonSchema)
// 3. Estrae narrative markdown (tutto prima del blocco JSON o il marker "## ⚙ Programma strutturato")
// 4. Validation extra (es. weeks sequence, phases coverage)
// 5. Costruisce MacroProgram struct finale

import { MacroProgramJsonSchema, type MacroProgramJson } from "../schemas/macroprogram";
import type { MacroProgram, MacroProgramParseResult } from "../types/macroprogram";
import type { Exercise, ExercisePattern } from "../types/exercise";
import { matchExerciseId } from "./exerciseMatcher";
import { buildExerciseFromMacroPayload, saveCustomExercisesBatch, refreshCustomCache } from "./customCatalog";

export class MacroProgramParseError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "MacroProgramParseError";
    this.details = details;
  }
}

/**
 * Pattern regex per estrarre il blocco JSON. Tollera:
 * - ```json (lowercase) o ```JSON
 * - whitespace tra fence e contenuto
 * - newline finale opzionale
 * - JSON multi-linea
 *
 * Usa lazy match (non-greedy) per terminare al primo ``` di chiusura.
 */
const JSON_BLOCK_RE = /```(?:json|JSON)\s*\n([\s\S]*?)\n\s*```/;

/**
 * Marker della sezione "## ⚙ Programma strutturato" — separatore narrative/json.
 * Tolleriamo variazioni di emoji + spazi + casing.
 */
const STRUCTURED_MARKER_RE = /^##\s*[⚙⚡✨]?\s*Programma\s+strutturato/im;

/**
 * Estrae il blocco JSON dal markdown. Throw se non trovato.
 */
function extractJsonBlock(markdown: string): string {
  const m = markdown.match(JSON_BLOCK_RE);
  if (!m || !m[1]) {
    throw new MacroProgramParseError(
      "Blocco JSON non trovato nel file. Il file deve contenere un blocco ```json … ``` con il programma strutturato.",
    );
  }
  return m[1].trim();
}

/**
 * Estrae la parte narrative (tutto prima del marker "## ⚙ Programma strutturato"
 * o prima del blocco JSON se il marker manca). Trim trailing whitespace.
 */
function extractNarrative(markdown: string): string {
  // Priorità 1: marker esplicito
  const markerMatch = markdown.match(STRUCTURED_MARKER_RE);
  if (markerMatch && typeof markerMatch.index === "number") {
    return markdown.slice(0, markerMatch.index).trimEnd();
  }
  // Priorità 2: tutto prima del blocco JSON
  const jsonMatch = markdown.match(JSON_BLOCK_RE);
  if (jsonMatch && typeof jsonMatch.index === "number") {
    return markdown.slice(0, jsonMatch.index).trimEnd();
  }
  // Fallback: tutto il markdown (no separazione possibile)
  return markdown.trim();
}

/**
 * Validation extra post-Zod: warning non-bloccanti.
 * - Settimane non sequenziali
 * - Phases che non coprono tutte le settimane
 * - start_date nel passato
 * - sport unknown
 */
function buildWarnings(json: MacroProgramJson): string[] {
  const warnings: string[] = [];

  // 1. weeks sequenziali da 1 a weeks_total
  const expectedWeeks = Array.from({ length: json.metadata.weeks_total }, (_, i) => i + 1);
  const actualWeeks = json.weeks.map(w => w.week).sort((a, b) => a - b);
  for (const w of expectedWeeks) {
    if (!actualWeeks.includes(w)) {
      warnings.push(`Settimana ${w} mancante (atteso 1-${json.metadata.weeks_total}).`);
    }
  }

  // 2. phases coprono tutte le settimane
  const phasesCoverage = new Set<number>();
  for (const p of json.phases) {
    if (p.weeks.length === 2 && p.weeks[0] <= p.weeks[1]) {
      // Interpretazione [start, end] range
      for (let w = p.weeks[0]; w <= p.weeks[1]; w++) phasesCoverage.add(w);
    } else {
      // Interpretazione [w1, w2, w3, ...] lista esplicita
      for (const w of p.weeks) phasesCoverage.add(w);
    }
  }
  for (const w of expectedWeeks) {
    if (!phasesCoverage.has(w)) {
      warnings.push(`Settimana ${w} non coperta da nessuna fase.`);
    }
  }

  // 3. start_date nel passato
  if (json.metadata.start_date) {
    const startTs = Date.parse(json.metadata.start_date);
    if (Number.isFinite(startTs) && startTs < Date.now() - 7 * 24 * 3600 * 1000) {
      warnings.push(`start_date (${json.metadata.start_date}) è di oltre 1 settimana fa. Considera rigenerare con data corrente.`);
    }
  }

  return warnings;
}

/**
 * Entry point principale: parse markdown → MacroProgramParseResult.
 * Throw MacroProgramParseError per problemi bloccanti (JSON mancante,
 * Zod fail). Warning non-bloccanti finiscono in result.warnings.
 */
export function parseMacroProgramMarkdown(markdown: string): MacroProgramParseResult {
  const jsonBlock = extractJsonBlock(markdown);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch (e) {
    throw new MacroProgramParseError(
      "JSON non valido nel blocco strutturato. Controlla la sintassi (virgole, parentesi, virgolette).",
      [(e as Error).message],
    );
  }

  const validation = MacroProgramJsonSchema.safeParse(parsed);
  if (!validation.success) {
    const details = validation.error.issues.slice(0, 10).map(
      issue => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new MacroProgramParseError(
      `Schema JSON non valido (${validation.error.issues.length} errori).`,
      details,
    );
  }

  const json = validation.data;
  const narrative = extractNarrative(markdown);
  const warnings = buildWarnings(json);

  const program: MacroProgram = {
    metadata: json.metadata,
    phases: json.phases,
    weeks: json.weeks,
    tracking_metrics: json.tracking_metrics,
    narrative_markdown: narrative,
    imported_at: new Date().toISOString(),
  };

  return {
    program,
    // Sprint 2: tutti gli esercizi sono accettati come-è (no catalog check ancora).
    // Sprint 3 estende questa funzione (o aggiunge step post-parse) con il
    // fuzzy matcher + Tier 3 orphan detection.
    orphanExercises: [],
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Sprint 3: post-parse resolution with fuzzy matcher + Tier 3 auto-add.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Risolve gli exerciseId del macroprogramma applicando il matcher in cascade:
 * - Tier 1/2: matchedId valido → riscriviamo l'id nel programma con quello canonico
 * - Tier 3 (orphan): se il payload ha name+pattern+equipment+technique+guidance,
 *   costruiamo un Exercise e lo salviamo nel user-custom catalog. L'id originale
 *   è preservato. Aggiunto a result.orphanExercises[] per UI notification.
 * - Tier 3 incompleto (mancano metadata): l'esercizio NON è aggiungibile,
 *   l'id rimane come-è e warning viene aggiunto.
 *
 * Robust dedup (2026-05-26): per ogni orphan id presente in più sessioni,
 * scegliamo il payload PIÙ COMPLETO (con più metadata) — non solo il primo.
 * Necessario perché Claude tende a popolare i metadata (technique+guidance)
 * SOLO nella prima occorrenza e lascia vuote le successive (o viceversa).
 *
 * IMPORTANTE: questa funzione modifica `result.program.weeks[*].sessions[*].exercises[*].id`
 * in-place per gli esercizi matchati a catalog esistente. Side-effect: scrive
 * su localStorage `user-custom-exercises` per orphan validi.
 */
function payloadCompletenessScore(ex: {
  name?: string; pattern?: string; equipment?: unknown[];
  technique?: string; guidance?: string[];
}): number {
  // Score 0-5: +1 per ogni campo metadata significativo presente.
  let s = 0;
  if (ex.name && ex.name.trim().length > 0) s++;
  if (ex.pattern && (ex.pattern as string).trim().length > 0) s++;
  if (ex.equipment && ex.equipment.length > 0) s++;
  if (ex.technique && ex.technique.trim().length > 0) s++;
  if (ex.guidance && ex.guidance.length >= 3) s++;
  return s;
}

export async function resolveExercisesAgainstCatalog(
  result: MacroProgramParseResult,
): Promise<MacroProgramParseResult> {
  const orphansToAdd: Exercise[] = [];
  const orphanReport: MacroProgramParseResult["orphanExercises"] = [];
  const extraWarnings: string[] = [];

  // STEP 1: riscrivi id Tier 1/2 in-place + colleziona TUTTE le occorrenze
  // orphan per id (per scegliere payload più completo in step 2).
  const orphanOccurrencesById = new Map<string, typeof result.program.weeks[number]["sessions"][number]["exercises"]>();

  for (const week of result.program.weeks) {
    for (const session of week.sessions) {
      for (const ex of session.exercises) {
        const match = matchExerciseId(ex.id, ex.name);
        if (match) {
          if (match.matchedId !== ex.id) ex.id = match.matchedId;
          continue;
        }
        // Orphan: colleziona tutte le occorrenze
        const list = orphanOccurrencesById.get(ex.id) ?? [];
        list.push(ex);
        orphanOccurrencesById.set(ex.id, list);
      }
    }
  }

  // STEP 2: per ogni orphan id, scegli payload più completo e auto-add
  for (const [id, occurrences] of orphanOccurrencesById) {
    // Trova l'occorrenza con score più alto (più metadata)
    let best = occurrences[0];
    let bestScore = payloadCompletenessScore(best);
    for (let i = 1; i < occurrences.length; i++) {
      const s = payloadCompletenessScore(occurrences[i]);
      if (s > bestScore) {
        best = occurrences[i];
        bestScore = s;
      }
    }

    const built = buildExerciseFromMacroPayload({
      id,
      name: best.name,
      pattern: best.pattern as ExercisePattern | undefined,
      equipment: best.equipment as Exercise["equipment"] | undefined,
      technique: best.technique,
      guidance: best.guidance,
    });
    if (built) {
      orphansToAdd.push(built);
      orphanReport.push({
        exerciseId: id,
        name: best.name,
        pattern: best.pattern as ExercisePattern | undefined,
      });
    } else {
      extraWarnings.push(
        `Esercizio "${id}" non in catalog e metadata incompleti (richiesti: name, pattern, equipment). NON aggiunto al catalog custom; il Player potrebbe non mostrarlo correttamente.`,
      );
    }
  }

  if (orphansToAdd.length > 0) {
    await saveCustomExercisesBatch(orphansToAdd);
    await refreshCustomCache();
  }

  return {
    ...result,
    orphanExercises: orphanReport,
    warnings: [...result.warnings, ...extraWarnings],
  };
}

/**
 * Convenience: parse + resolve in unica chiamata async.
 * Da usare nell'UI Upload (Sprint 4).
 */
export async function parseAndResolveMacroProgram(markdown: string): Promise<MacroProgramParseResult> {
  const parsed = parseMacroProgramMarkdown(markdown);
  return resolveExercisesAgainstCatalog(parsed);
}
