// Normalizzatore equipment: l'utente inserisce free-text in italiano
// (`manubri`, `bilanciere`, `palestra`) ma il catalog esercizi usa tag
// inglesi canonici (`barbell`, `dumbbell`, ...). Senza normalizzazione,
// `filterAvailableExercises` escluderebbe quasi tutti gli esercizi.
//
// Strategia:
// - Map alias italiano → tag canonico (case-insensitive, trim)
// - "palestra" / "gym" / "sala pesi" espande a un superset (tutti i tag base)
// - tag già canonici passano through
// - tag sconosciuti restano (best-effort, l'utente potrebbe aver scritto
//   un alias non mappato — meglio includere che escludere troppo)

import type { EquipmentTag } from "../types/exercise";

/** Tag canonici secondo Exercise.equipment. Sorgente di verità. */
const CANONICAL_TAGS: ReadonlyArray<EquipmentTag> = [
  "bodyweight", "dumbbell", "barbell", "kettlebell", "band",
  "machine", "cable", "trx", "bench", "pullup_bar", "box",
];

const CANONICAL_SET = new Set<string>(CANONICAL_TAGS);

/**
 * Mappa alias italiano (e varianti comuni) → tag canonico.
 * Chiave: stringa normalizzata (lowercase + trim). Valore: tag.
 */
const ALIAS_MAP: Record<string, EquipmentTag> = {
  // Manubri
  "manubri": "dumbbell",
  "manubrio": "dumbbell",
  "manubri kg": "dumbbell",
  // Bilanciere
  "bilanciere": "barbell",
  "bilancere": "barbell", // typo comune
  "bilanciere olimpico": "barbell",
  "barra": "barbell",
  // Kettlebell (uguale)
  "kettlebell": "kettlebell",
  "kb": "kettlebell",
  "ghiria": "kettlebell",
  // Band / elastici
  "elastici": "band",
  "elastico": "band",
  "banda": "band",
  "banda elastica": "band",
  "bande": "band",
  "bande elastiche": "band",
  "resistance band": "band",
  // Pullup bar / sbarra
  "sbarra": "pullup_bar",
  "barra trazioni": "pullup_bar",
  "trazioni": "pullup_bar",
  "pull up bar": "pullup_bar",
  "pull-up bar": "pullup_bar",
  // Bench / panca
  "panca": "bench",
  "panchetta": "bench",
  // Machine / macchine
  "macchine": "machine",
  "macchina": "machine",
  "macchinari": "machine",
  // Cable / cavi
  "cavi": "cable",
  "cavo": "cable",
  "stazione cavi": "cable",
  // TRX
  "trx": "trx",
  "anelli": "trx", // approssimazione (anelli ginnastici ≈ trx pattern)
  // Box (plyo)
  "box": "box",
  "plyobox": "box",
  "box pliometrico": "box",
  // Bodyweight
  "corpo libero": "bodyweight",
  "bodyweight": "bodyweight",
  "a corpo libero": "bodyweight",
};

/**
 * Termini che espandono a un SUPERSET di tag (es. "palestra" implica
 * accesso a barbell + dumbbell + bench + kettlebell + machine + cable +
 * pullup_bar + box). Bodyweight è sempre disponibile a prescindere.
 */
const EXPANSION_MAP: Record<string, ReadonlyArray<EquipmentTag>> = {
  "palestra": ["barbell", "dumbbell", "bench", "kettlebell", "machine", "cable", "pullup_bar", "box"],
  "gym": ["barbell", "dumbbell", "bench", "kettlebell", "machine", "cable", "pullup_bar", "box"],
  "sala pesi": ["barbell", "dumbbell", "bench", "kettlebell", "machine", "cable", "pullup_bar", "box"],
  "weight room": ["barbell", "dumbbell", "bench", "kettlebell", "machine", "cable", "pullup_bar", "box"],
  "home gym": ["barbell", "dumbbell", "bench", "kettlebell", "pullup_bar"],
  "casa palestra": ["dumbbell", "kettlebell", "band", "pullup_bar"],
};

/**
 * Normalizza un singolo input utente in zero-o-più tag canonici.
 *
 * - Tag canonico (es. "barbell") → ritorna se stesso
 * - Alias (es. "manubri") → ritorna canonico mappato (es. "dumbbell")
 * - Espansione (es. "palestra") → ritorna array tag multipli
 * - Sconosciuto → ritorna [] (best-effort: ignora vs default-include
 *   sarebbe troppo permissivo per i validator a valle)
 */
export function normalizeOne(input: string): EquipmentTag[] {
  if (!input || typeof input !== "string") return [];
  const key = input.trim().toLowerCase();
  if (!key) return [];
  // 1. Già canonico
  if (CANONICAL_SET.has(key)) return [key as EquipmentTag];
  // 2. Espansione (controllata PRIMA dell'alias singolo)
  if (key in EXPANSION_MAP) return [...EXPANSION_MAP[key]];
  // 3. Alias singolo
  if (key in ALIAS_MAP) return [ALIAS_MAP[key]];
  // 4. Alias parziale: alcuni input hanno qualifier dopo (es. "manubri 10kg")
  //    Tentiamo split e check del primo token.
  const firstToken = key.split(/[\s\d]+/)[0];
  if (firstToken && firstToken !== key && firstToken in ALIAS_MAP) {
    return [ALIAS_MAP[firstToken]];
  }
  // 5. Sconosciuto: nessun tag (l'utente ha scritto qualcosa che non
  //    sappiamo mappare — meglio escludere che dare false signal a validator)
  return [];
}

/**
 * Normalizza un array di input utente. `bodyweight` SEMPRE incluso
 * (pattern: ogni utente può sempre fare esercizi a corpo libero, anche
 * senza dichiararlo esplicitamente).
 *
 * Output: array deduplicato di tag canonici.
 */
export function normalizeEquipmentTags(inputs: ReadonlyArray<string> | undefined): EquipmentTag[] {
  const out = new Set<EquipmentTag>(["bodyweight"]); // sempre disponibile
  if (!inputs || inputs.length === 0) return [...out];
  for (const input of inputs) {
    for (const tag of normalizeOne(input)) {
      out.add(tag);
    }
  }
  return [...out];
}
