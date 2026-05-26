// Fuzzy matcher per id esercizi nei macroprogrammi (Sprint 3, 2026-05-26).
//
// Tier 1: exact match in EXERCISES_BY_ID (catalog hardcoded 125 esercizi)
// Tier 2: fuzzy match (normalize + Levenshtein su id e name + synonym map)
// Tier 3: orphan → da auto-aggiungere a user-custom catalog
//
// Pattern: il parser chiama matchExerciseId(input) per ogni exerciseId nel
// macroprogram. Output { matchedId, confidence, source } o null se orphan.

import { EXERCISES, EXERCISES_BY_ID } from "../catalog/exercises";

export interface ExerciseMatchResult {
  matchedId: string;
  confidence: number;
  source: "exact" | "fuzzy-id" | "fuzzy-name" | "synonym";
}

/**
 * Synonym map curato: nomi comuni → catalog id ufficiali.
 * Coverage iniziale: alias frequenti che Claude o altri LLM tendono ad usare.
 * Estendibile run-time via user-custom catalog se Lorenzo nota ricorrenze.
 */
// NB: tutte le keys DEVONO essere già in formato normalizzato (kebab-case,
// lowercase, no spazi). Il lookup avviene su `normalizeKey(input)` quindi
// keys con spazi (es. "panca piana") NON matchano. Bug fix Sprint 3 commit
// post 3c28bb9: avevamo keys con spazi → fail. Ora tutto normalizzato.
const SYNONYM_MAP: Record<string, string> = {
  // Squat patterns
  "back-squat": "back-squat-barbell",
  "squat-con-bilanciere": "back-squat-barbell",
  "front-squat": "front-squat-barbell",
  "goblet-squat": "goblet-squat-kettlebell",
  "squat-goblet": "goblet-squat-kettlebell",
  "bulgarian-split-squat": "bulgarian-split-squat-dumbbell",
  "bulgarian": "bulgarian-split-squat-dumbbell",
  "split-squat-bulgaro": "bulgarian-split-squat-dumbbell",

  // Hinge / Deadlift
  "rdl": "deadlift-romanian-barbell",
  "stacco-rumeno": "deadlift-romanian-barbell",
  "romanian-deadlift": "deadlift-romanian-barbell",
  "deadlift-romanian": "deadlift-romanian-barbell",
  "rdl-manubri": "deadlift-romanian-dumbbell",
  "rdl-dumbbell": "deadlift-romanian-dumbbell",
  "stacco-convenzionale": "deadlift-conventional-barbell",
  "deadlift": "deadlift-conventional-barbell",
  "sumo-deadlift": "deadlift-sumo-barbell",

  // Bench / Push
  "panca-piana": "bench-press-flat-barbell",
  "panca": "bench-press-flat-barbell",
  "bench-press": "bench-press-flat-barbell",
  "panca-inclinata": "bench-press-incline-barbell",
  "panca-manubri": "bench-press-flat-dumbbell",
  "ohp": "military-press-standing-barbell",
  "overhead-press": "military-press-standing-barbell",
  "military-press": "military-press-standing-barbell",
  "shoulder-press": "seated-shoulder-press-dumbbell",
  "push-up": "push-up-standard",
  "piegamenti": "push-up-standard",

  // Pull
  "pull-up": "pull-up-bodyweight",
  "trazioni": "pull-up-bodyweight",
  "chin-up": "chin-up-bodyweight",
  "rematore": "barbell-row-bent-over",
  "barbell-row": "barbell-row-bent-over",
  "rematore-bilanciere": "barbell-row-bent-over",
  "row-manubri": "dumbbell-row-bent-over",

  // Core
  "plank": "plank-front-bodyweight",
  "plank-frontale": "plank-front-bodyweight",
  "side-plank": "side-plank-bodyweight",
  "plank-laterale": "side-plank-bodyweight",
  "dead-bug": "dead-bug-bodyweight",
  "bird-dog": "bird-dog-bodyweight",
  "nordic-hamstring": "nordic-hamstring-curl",
  "nordic": "nordic-hamstring-curl",
  "copenhagen": "copenhagen-plank",

  // Plyometric
  "cmj": "jump-squat-bodyweight",
  "counter-movement-jump": "jump-squat-bodyweight",
  "jump-squat": "jump-squat-bodyweight",
  "dj": "depth-jump",
  "drop-jump": "depth-jump",
  "broad-jump": "broad-jump",
  "salto-in-lungo": "broad-jump",
  "box-jump": "box-jump",
  "lateral-bound": "lateral-bound-bodyweight",
  "skater-jump": "lateral-bound-bodyweight",
  "pogo": "pogo-jump-bodyweight",
  "pogo-jump": "pogo-jump-bodyweight",

  // Sport-specific
  "t-test": "t-test-agility",
  "5-10-5": "pro-agility-5-10-5",
  "pro-agility": "pro-agility-5-10-5",
  "505-test": "shuttle-505-test",
  "505": "shuttle-505-test",
  "mirror-drill": "mirror-drill-reactive",
  "go-no-go": "go-no-go-reactive",
  "compass-drill": "compass-drill-reactive",
  "compass": "compass-drill-reactive",
  "sprint-lineare": "sprint-linear-progressive",
  "sprint-progressivi": "sprint-linear-progressive",
  "rsa": "rsa-shuttle-15-15",
  "rsa-lineare": "rsa-linear-30m",
  "rsa-navetta": "rsa-shuttle-15-15",
  "ssg": "ssg-4v4-football",
  "ssg-4v4": "ssg-4v4-football",
  "small-sided-game": "ssg-4v4-football",
  "1v1": "ssg-1v1-football",
};

/**
 * Normalizza un input (id o nome) per comparazione fuzzy.
 * - lowercase
 * - trim whitespace
 * - replace _ e spazi con -
 * - collapse multipli -
 * - strip caratteri non alfanumerici (eccetto -)
 */
export function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

/**
 * Levenshtein distance classic DP O(n*m).
 * Per stringhe brevi (id esercizi tipicamente < 40 char) è instantaneo.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,        // deletion
        dp[i][j - 1] + 1,        // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * Confidence 0-1 da Levenshtein: 1 = match perfetto, 0 = totalmente diverso.
 * Formula: 1 - (distance / max(a.length, b.length))
 */
function confidenceFromLev(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Main matcher. Tre tier in cascade.
 *
 * @param inputId id grezzo da macroprogramma (es. "back_squat", "Back Squat", "rdl")
 * @param inputName opzionale: nome esercizio (es. "Stacco Rumeno") per fuzzy name match
 * @param minConfidence soglia fuzzy auto-accept (default 0.85). Sotto questa → null
 * @returns ExerciseMatchResult o null (orphan, da Tier 3 auto-add)
 */
export function matchExerciseId(
  inputId: string,
  inputName?: string,
  minConfidence = 0.85,
): ExerciseMatchResult | null {
  // TIER 1: exact match
  if (EXERCISES_BY_ID[inputId]) {
    return { matchedId: inputId, confidence: 1.0, source: "exact" };
  }

  const normInput = normalizeKey(inputId);
  if (EXERCISES_BY_ID[normInput]) {
    return { matchedId: normInput, confidence: 0.98, source: "exact" };
  }

  // TIER 2a: synonym map lookup (su id normalizzato + nome se presente)
  const synonymHit = SYNONYM_MAP[normInput] ?? (inputName ? SYNONYM_MAP[normalizeKey(inputName)] : undefined);
  if (synonymHit && EXERCISES_BY_ID[synonymHit]) {
    return { matchedId: synonymHit, confidence: 0.95, source: "synonym" };
  }

  // TIER 2b: fuzzy match su id (Levenshtein sui id esistenti)
  let bestId: ExerciseMatchResult | null = null;
  for (const ex of EXERCISES) {
    const c = confidenceFromLev(normInput, ex.id);
    if (c >= minConfidence && (!bestId || c > bestId.confidence)) {
      bestId = { matchedId: ex.id, confidence: c, source: "fuzzy-id" };
    }
  }
  if (bestId) return bestId;

  // TIER 2c: fuzzy match su name (se inputName fornito)
  if (inputName) {
    const normName = normalizeKey(inputName);
    let bestName: ExerciseMatchResult | null = null;
    for (const ex of EXERCISES) {
      const c = confidenceFromLev(normName, normalizeKey(ex.name));
      if (c >= minConfidence && (!bestName || c > bestName.confidence)) {
        bestName = { matchedId: ex.id, confidence: c, source: "fuzzy-name" };
      }
    }
    if (bestName) return bestName;
  }

  // TIER 3: orphan — il parser dovrà auto-aggiungere al user-custom catalog
  return null;
}
