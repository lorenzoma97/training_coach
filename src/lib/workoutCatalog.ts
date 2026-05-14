// Catalogo canonico dei sottotipi ammessi per ogni tipo di workout.
// UNICA fonte di verità condivisa tra:
//  - il form di registrazione (DiaryApp WORKOUT_TYPES)
//  - il prompt di generazione piano (LLM DEVE scegliere da qui, altrimenti
//    il matching piano↔diario fallisce e l'utente vede "VARIAZIONE" spuria)
//  - il validator (post-LLM warning se subtype fuori catalogo)
//
// Se aggiungi una voce qui, assicurati che DiaryApp.tsx → WORKOUT_TYPES
// abbia la stessa stringa (case-sensitive). Il matching usa .toLowerCase()
// ma il rendering UI mostra il testo esatto.

export const WORKOUT_SUBTYPES: Record<string, readonly string[]> = {
  corsa: ["Fondo Lento", "Fartlek", "Ripetute", "Progressione", "Test Ritmo Gara", "Test Finale", "Corsa Intermittente"],
  forza_gambe: ["HIIT Gambe", "Forza Esplosiva", "Forza Massimale", "Circuito Misto"],
  forza_upper: ["Upper Body", "Core Anti-Rotazione", "Upper + Core Combo"],
  sport: ["Tennis", "Padel", "Calcio (Allenamento)", "Calcio (Partita)", "Altro"],
  mobilita: ["Stretching Statico", "Mobilità Dinamica", "Propriocezione", "Camminata", "Foam Rolling", "Piscina / Recovery"],
};

/** True se `subtype` è un valore canonico per `type`. Confronto case-insensitive. */
export function isCanonicalSubtype(type: string, subtype: string | undefined): boolean {
  if (!subtype) return false;
  const allowed = WORKOUT_SUBTYPES[type];
  if (!allowed) return false;
  const norm = subtype.toLowerCase().trim();
  return allowed.some(a => a.toLowerCase().trim() === norm);
}

/** Tipi NON proposti dal coach nei nuovi piani.
 *  `mobilita` resta nel catalog per backward compat (diary user-input, validator
 *  su workout vecchi loggati), ma il coach non lo prescrive più (recovery =
 *  riposo, warm-up = libreria dedicata nel tab Coach). */
const COACH_HIDDEN_TYPES = new Set(["mobilita"]);

/** Formato compatto per iniettare nei prompt LLM. Esclude tipi non prescritti. */
export function workoutSubtypesForPrompt(): string {
  return Object.entries(WORKOUT_SUBTYPES)
    .filter(([type]) => !COACH_HIDDEN_TYPES.has(type))
    .map(([type, subs]) => `  - ${type}: ${subs.map(s => `"${s}"`).join(", ")}`)
    .join("\n");
}
