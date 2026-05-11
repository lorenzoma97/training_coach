// Wave Privacy: defensive PII redaction sui campi free-text che finiscono nel
// prompt LLM. Tutti i campi free-text user-controlled (profile.notes, meds,
// injuries, workout.notes, goal.smartDescription) vengono passati attraverso
// `sanitizePII` prima di entrare nel prompt. I dati strutturati (peso, FC,
// sleep) NON vengono toccati: sono biometrici aggregati non identificativi.
//
// Pattern riconosciuti (italiani-aware): email, telefono (cellulare/fisso IT),
// codice fiscale, IBAN, URL. Sostituiti con placeholder `[email]`,
// `[telefono]`, `[CF]`, `[IBAN]`, `[URL]`. NB: l'app non chiede mai questi
// dati; questa è difesa contro PII che l'utente potrebbe scrivere nelle note
// (es. "ho parlato col dott. Rossi 333 1234567 dr.rossi@example.com").
//
// NO ML, NO NER: solo regex. False positive bassi grazie a pattern stretti
// (es. CF richiede 16 char con shape preciso, IBAN richiede prefix IT).

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Telefoni IT: cellulare (3xx) o fisso (0xx) con prefisso +39 opzionale.
// Min 9 cifre totali (esclude pesi/durate tipo "081 kg" o "210 min").
// Match con separatori spazio/punto/trattino tra blocchi.
const PHONE_IT_RE = /(?:\+?39[\s.-]?)?(?:3\d{2}|0\d{1,3})[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g;

// Codice fiscale italiano: 6 lettere + 2 cifre + 1 lettera + 2 cifre + 1
// lettera + 3 cifre + 1 lettera. Total 16 char. Match case-insensitive.
const CF_IT_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi;

// IBAN italiano: "IT" + 2 check digits + 1 lettera CIN + 5 ABI + 5 CAB +
// 12 numero conto. Total 27 char. Tolleriamo spazi opzionali ogni 4 char
// nel rendering ma il match è sulla forma compatta.
const IBAN_IT_RE = /\bIT\d{2}[A-Z]\d{22}\b/gi;

// URL: http/https con eventuali path/query. Stoppa su whitespace.
const URL_RE = /https?:\/\/\S+/gi;

/**
 * Redact PII patterns nel testo. Chain di replace preservando l'ordine
 * (URL prima di email per evitare che query string `?email=` matchi email).
 * Sicuro su input vuoto/null/undefined → ritorna stringa vuota.
 */
export function sanitizePII(input: string | null | undefined): string {
  if (!input) return "";
  let out = input;
  out = out.replace(URL_RE, "[URL]");
  out = out.replace(EMAIL_RE, "[email]");
  out = out.replace(IBAN_IT_RE, "[IBAN]");
  out = out.replace(CF_IT_RE, "[CF]");
  out = out.replace(PHONE_IT_RE, "[telefono]");
  return out;
}

/**
 * Variante array: applica `sanitizePII` su ogni elemento. Ritorna array
 * della stessa lunghezza (nessun filter). Utile per `injuries: string[]`.
 */
export function sanitizePIIList(inputs: ReadonlyArray<string> | null | undefined): string[] {
  if (!inputs || !inputs.length) return [];
  return inputs.map(s => sanitizePII(s));
}
