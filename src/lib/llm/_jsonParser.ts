// Parser JSON robusto condiviso tra tutti gli adapter LLM (gemini/openai/anthropic).
// Stage multipli:
//   1) Parse diretto
//   2) Rimozione wrapper markdown ```json ... ```
//   3) Estrazione del PRIMO oggetto JSON bilanciando le graffe (non regex greedy)
//   4) Detection di risposta TRONCATA (maxTokens raggiunto) con errore user-friendly
//
// NB: gestisce testo prima/dopo JSON, code fence, e casi comuni di output LLM "sporco".

/** Errore specifico per risposta troncata dal modello (maxTokens / stop prematuro). */
export class LLMTruncatedJSONError extends Error {
  constructor(public readonly rawExcerpt: string) {
    super("La risposta del coach è stata troncata. Riprova con una richiesta più focalizzata o aumenta il limite di token.");
    this.name = "LLMTruncatedJSONError";
  }
}

/**
 * Euristica per rilevare JSON troncato:
 *  - contiene '{' ma le parentesi non si chiudono bilanciate (depth finale > 0 fuori da stringa)
 *  - OR termina nel mezzo di una stringa (quote non chiusa)
 *  - OR termina con una virgola/chiave senza valore
 */
function looksTruncated(text: string): boolean {
  const start = text.indexOf("{");
  if (start < 0) return false;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  if (inString) return true;        // stringa non chiusa = troncato
  if (depth > 0) return true;       // parentesi non chiuse = troncato
  // Ultimo char non-whitespace lascia pendente una virgola / due punti?
  const trimmed = text.trimEnd();
  const lastChar = trimmed.slice(-1);
  if (lastChar === "," || lastChar === ":") return true;
  return false;
}

/**
 * Parser robusto: prova parse diretto, poi markdown fence, poi estrazione bilanciata.
 * Se il testo sembra troncato, lancia LLMTruncatedJSONError con messaggio utente.
 * Altrimenti lancia Error con estratto del raw (per debug).
 */
export function parseRobustJSON<T>(text: string): T {
  // 1) Parse diretto
  try { return JSON.parse(text) as T; } catch { /* fallthrough */ }

  // 2) Rimuovi wrapper markdown ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()) as T; } catch { /* fallthrough */ }
  }

  // 3) Trova il PRIMO oggetto JSON bilanciando le graffe (non il regex greedy che
  //    fallisce se il modello ritorna due JSON separati — es. quando l'utente
  //    inserisce più obiettivi in un solo campo).
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try { return JSON.parse(candidate) as T; } catch { /* fallthrough */ }
          break;
        }
      }
    }
  }

  // 4) Rilevazione troncato — errore user-friendly
  if (looksTruncated(text)) {
    throw new LLMTruncatedJSONError(text.slice(0, 200));
  }

  throw new Error(`Risposta JSON non valida dal coach. Riprova.\n(raw: ${text.slice(0, 200)}...)`);
}
