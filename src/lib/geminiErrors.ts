// Traduce errori tipici del Gemini SDK (e degli altri provider LLM) in messaggi
// in italiano chiari e ACTIONABLE per l'utente.
//
// Ogni categoria deve:
//  - dire COSA è successo in 1 frase
//  - dire COSA fare (CTA esplicita, anche se il bottone non è qui vicino)
//  - distinguere casi simili ma non identici (es. timeout ≠ 503; key mancante ≠ key rifiutata).

// Import esplicito della classe custom — il check qui sotto usa `name` per
// robustezza (evita failure se l'istanza passa confini di modulo diversi con
// tree-shaking aggressivo), ma l'import garantisce che la class sia inclusa
// nel bundle e che i future rename siano catturati da TypeScript.
import { LLMTruncatedJSONError } from "./llm/_jsonParser";
const TRUNCATED_NAME = LLMTruncatedJSONError.name;

/**
 * Action hint opzionale allegato al messaggio di errore. Usabile dalla UI per
 * mostrare un bottone dedicato (es. "Apri Impostazioni") accanto al messaggio.
 * Il bottone/handler è responsabilità del componente chiamante.
 */
export interface ErrorAction {
  label: string;
  hint: string;
}

export interface TranslatedError {
  message: string;
  action?: ErrorAction;
  /** Categoria logica (utile per analytics / UI) */
  category?:
    | "key-missing"
    | "key-invalid"
    | "permission"
    | "quota"
    | "rate-limit"
    | "overload"
    | "network"
    | "timeout"
    | "truncated"
    | "parse"
    | "unknown";
}

/**
 * Variante strutturata: ritorna messaggio + eventuale action + categoria.
 * I chiamanti esistenti continuano a usare `translateGeminiError` (string).
 */
export function translateGeminiErrorDetailed(err: unknown): TranslatedError {
  const raw = typeof err === "string" ? err : (err as any)?.message || String(err);
  const lower = raw.toLowerCase();
  const name = (err as any)?.name || "";

  // --- Chiave mancante (nessuna config) ---
  // Questo caso è distinto da "chiave rifiutata dal provider": qui l'utente
  // non ha mai inserito una chiave (o l'ha cancellata).
  if (
    name === "LLMKeyMissingError" ||
    name === "GeminiKeyMissingError" ||
    lower.includes("chiave api gemini non configurata") ||
    lower.includes("chiave api non configurata") ||
    raw.includes("GeminiKeyMissingError") ||
    raw.includes("LLMKeyMissingError")
  ) {
    return {
      message: "Nessuna chiave API configurata. Apri Impostazioni e aggiungi una chiave per un provider (Gemini/OpenAI/Anthropic).",
      action: { label: "Apri Impostazioni", hint: "Impostazioni → Provider LLM" },
      category: "key-missing",
    };
  }

  // --- Chiave rifiutata dal provider (presente ma non valida/attiva) ---
  if (
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("api-key") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("401")
  ) {
    return {
      message: "Chiave API rifiutata dal provider (non valida, scaduta o revocata). Genera una nuova chiave e aggiornala in Impostazioni.",
      action: { label: "Aggiorna chiave in Impostazioni", hint: "Impostazioni → Provider LLM → Sostituisci chiave" },
      category: "key-invalid",
    };
  }

  // --- Permesso negato (chiave valida ma senza accesso al modello) ---
  if (lower.includes("permission") || lower.includes("403")) {
    return {
      message: "Permesso negato dal provider: la chiave potrebbe non avere accesso al modello selezionato. Scegli un altro modello in Impostazioni.",
      action: { label: "Cambia modello", hint: "Impostazioni → Modello" },
      category: "permission",
    };
  }

  // --- Quota esaurita ---
  // IMPORTANTE: il reset delle quote giornaliere free tier (Gemini/OpenAI) è a
  // MEZZANOTTE UTC (non "fra qualche ora" generico, che confonde l'utente).
  if (lower.includes("quota") || lower.includes("resource_exhausted") || lower.includes("insufficient_quota")) {
    return {
      message: "Quota API giornaliera esaurita. Il reset avviene a mezzanotte UTC. In alternativa, cambia provider in Impostazioni (es. passa da Gemini a OpenAI o viceversa).",
      action: { label: "Cambia provider in Impostazioni", hint: "Impostazioni → Provider LLM" },
      category: "quota",
    };
  }

  // --- Rate limit (429) ---
  // Distinto da quota: è un burst di richieste nel breve periodo, si risolve
  // con una breve attesa senza cambiare nulla.
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return {
      message: "Troppe richieste in poco tempo. Attendi circa 30 secondi e riprova.",
      category: "rate-limit",
    };
  }

  // --- Timeout (rete lenta / modello lento) ---
  // Distinto da 503: qui la richiesta NON ha ricevuto risposta entro il limite
  // del client, mentre il 503 è il server che rifiuta subito dicendo "busy".
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline") || lower.includes("etimedout")) {
    return {
      message: "La richiesta è andata in timeout (il modello sta impiegando troppo). Riprova; se persiste, prova un modello più veloce (es. flash-lite) in Impostazioni.",
      action: { label: "Cambia modello", hint: "Impostazioni → Modello" },
      category: "timeout",
    };
  }

  // --- 503 / overload ---
  // Distinto da timeout: il server ha risposto subito ma dicendo "occupato".
  // La via d'uscita migliore è cambiare provider (o modello), non solo aspettare.
  if (
    lower.includes("503") ||
    lower.includes("high demand") ||
    lower.includes("overload") ||
    lower.includes("overloaded") ||
    lower.includes("unavailable") ||
    lower.includes("service is currently unavailable")
  ) {
    return {
      message: "Il modello è momentaneamente sovraccarico (tipico dei modelli preview). Cambia provider in Impostazioni, oppure seleziona un modello alternativo (es. gemini-2.5-flash-lite).",
      action: { label: "Cambia provider in Impostazioni", hint: "Impostazioni → Provider LLM → scegli un altro provider/modello" },
      category: "overload",
    };
  }

  // --- Rete assente / fetch fallita ---
  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("err_internet_disconnected") ||
    lower.includes("offline")
  ) {
    return {
      message: "Connessione assente o instabile. Controlla la rete e riprova.",
      category: "network",
    };
  }

  // --- Risposta troncata (maxTokens raggiunto) ---
  // LLMTruncatedJSONError è la nostra classe custom (import a top del file).
  // Check via `.name` per robustezza ai boundary di modulo.
  if (name === TRUNCATED_NAME || err instanceof LLMTruncatedJSONError || lower.includes("troncata") || lower.includes("truncated")) {
    return {
      message: "La risposta del coach è stata troncata. Riprova con una richiesta più focalizzata, o aumenta il limite di token nei dettagli avanzati.",
      category: "truncated",
    };
  }

  // --- JSON parsing generico ---
  if (lower.includes("json") || lower.includes("parse")) {
    return {
      message: "Il coach ha restituito una risposta non valida (JSON malformato). Riprova; se persiste, prova un modello diverso.",
      category: "parse",
    };
  }

  // Default: pass-through del messaggio raw (già informativo in molti casi).
  return { message: raw, category: "unknown" };
}

/**
 * Versione legacy / retro-compatibile: ritorna solo il messaggio stringa.
 * I chiamanti UI che vogliono il bottone/action possono usare la variante
 * `translateGeminiErrorDetailed`.
 */
export function translateGeminiError(err: unknown): string {
  return translateGeminiErrorDetailed(err).message;
}
