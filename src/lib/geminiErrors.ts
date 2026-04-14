// Traduce errori tipici del Gemini SDK in messaggi in italiano chiari per l'utente.
export function translateGeminiError(err: unknown): string {
  const raw = typeof err === "string" ? err : (err as any)?.message || String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("api key not valid") || lower.includes("api_key_invalid") || lower.includes("invalid api key") || lower.includes("api-key")) {
    return "Chiave API Gemini non valida. Controlla in Impostazioni.";
  }
  if (lower.includes("permission") || lower.includes("403")) {
    return "Permesso negato da Gemini. La chiave potrebbe non avere accesso al modello.";
  }
  if (lower.includes("quota") || lower.includes("resource_exhausted")) {
    return "Quota API esaurita per oggi. Riprova tra qualche ora (Gemini free tier = ~1500 richieste/giorno).";
  }
  if (lower.includes("429") || lower.includes("rate limit")) {
    return "Troppe richieste in poco tempo. Attendi 30 secondi e riprova.";
  }
  if (lower.includes("503") || lower.includes("high demand") || lower.includes("overload") || lower.includes("unavailable")) {
    return "Il modello è momentaneamente sovraccarico (questo è tipico dei modelli preview). Riprova tra qualche minuto, oppure vai in Impostazioni e seleziona un modello alternativo (es. gemini-2.5-flash).";
  }
  if (lower.includes("network") || lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Connessione assente o instabile. Riprova quando sei online.";
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return "Il coach ci sta mettendo troppo. Riprova.";
  }
  if (lower.includes("json") || lower.includes("parse")) {
    return "Il coach ha restituito una risposta non valida. Riprova.";
  }
  if (lower.includes("chiave api gemini non configurata") || lower.includes("chiave api") || raw.includes("GeminiKeyMissingError")) {
    return "Chiave API Gemini non configurata. Vai in Impostazioni.";
  }
  return raw;
}
