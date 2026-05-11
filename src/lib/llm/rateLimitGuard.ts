// Rate limit guard per Gemini Flash free tier (15 req/min, 1M token/min).
// Multi-pass orchestrator (Wave 4.1) può fare 5-6 chiamate per regen del piano:
// 1 Pass-1 + 3-4 Pass-2 strength + 1 Pass-2 cardio = 5-6 req in pochi secondi.
// Senza guard: rischio HTTP 429 dal provider durante uso intenso o regen
// concorrente. Questo guard mantiene una sliding-window su richieste recenti
// e blocca/rallenta proattivamente prima che il provider risponda 429.
//
// Strategia "ottimistica": se siamo sotto 80% della soglia, proceedi senza
// attesa. Se siamo tra 80-100%, aspetta il delta minimo per scendere sotto
// soglia. Se siamo a 100%+, aspetta finché la finestra si libera. Tutto
// in-memory, reset automatico a chiusura tab.
//
// NB: il guard non sostituisce la gestione 429 lato provider — il backoff
// retry esiste già negli adapter (`gemini.ts` retry con jitter). Questo è
// un layer preventivo che riduce la frequenza dei 429.

/** Soglia richieste/minuto Gemini Flash free tier (margine 80% per safety). */
const RPM_LIMIT_GEMINI_FREE = 15;
const RPM_SAFETY_MARGIN = 0.8; // proceed senza attesa fino a 12 req/min

/** Finestra temporale per il counting (ms). 60s = standard RPM. */
const WINDOW_MS = 60_000;

/** Storage in-memory delle ultime richieste per provider. */
const requestLog: Map<string, number[]> = new Map();

/** Cleanup vecchie entry oltre la finestra. */
function pruneOldEntries(provider: string, now: number): number[] {
  const log = requestLog.get(provider) ?? [];
  const cutoff = now - WINDOW_MS;
  const fresh = log.filter(ts => ts > cutoff);
  requestLog.set(provider, fresh);
  return fresh;
}

/**
 * Acquisisce un "slot" per fare una request al provider.
 * Se la rate è sotto soglia: ritorna immediatamente.
 * Se la rate è al limite: aspetta il delta minimo per scendere sotto.
 *
 * @param provider id del provider (es. "gemini", "openai"). Ogni provider ha
 *   counter separato. Per Ollama (locale) il guard è no-op.
 * @returns Promise<void> che si risolve quando è safe procedere.
 */
export async function acquireRateLimitSlot(provider: string): Promise<void> {
  // Ollama gira locale, no rate limit.
  if (provider === "ollama") return;

  const now = Date.now();
  const fresh = pruneOldEntries(provider, now);

  const safeThreshold = Math.floor(RPM_LIMIT_GEMINI_FREE * RPM_SAFETY_MARGIN);

  if (fresh.length < safeThreshold) {
    // Sotto 80% → proceed.
    fresh.push(now);
    requestLog.set(provider, fresh);
    return;
  }

  if (fresh.length < RPM_LIMIT_GEMINI_FREE) {
    // Tra 80-100% → micro-throttle proporzionale (200-1000ms).
    const overage = fresh.length - safeThreshold;
    const throttleMs = Math.min(1000, 200 * (overage + 1));
    await new Promise(resolve => setTimeout(resolve, throttleMs));
    const after = pruneOldEntries(provider, Date.now());
    after.push(Date.now());
    requestLog.set(provider, after);
    return;
  }

  // Al limite: aspetta finché la richiesta più vecchia esce dalla finestra.
  const oldest = fresh[0];
  const waitMs = Math.max(100, WINDOW_MS - (now - oldest) + 50); // +50ms buffer
  console.warn(
    `[rateLimitGuard] ${provider} rate limit raggiunto (${fresh.length}/${RPM_LIMIT_GEMINI_FREE} req/min). Attendo ${waitMs}ms.`,
  );
  await new Promise(resolve => setTimeout(resolve, waitMs));
  const after = pruneOldEntries(provider, Date.now());
  after.push(Date.now());
  requestLog.set(provider, after);
}

/** Stato corrente per UI debug / dashboard. */
export function getRateLimitStatus(provider: string): {
  current: number;
  limit: number;
  safeThreshold: number;
} {
  const now = Date.now();
  const fresh = pruneOldEntries(provider, now);
  return {
    current: fresh.length,
    limit: RPM_LIMIT_GEMINI_FREE,
    safeThreshold: Math.floor(RPM_LIMIT_GEMINI_FREE * RPM_SAFETY_MARGIN),
  };
}

/** Reset utile per testing. */
export function resetRateLimitForTesting(provider?: string): void {
  if (provider) requestLog.delete(provider);
  else requestLog.clear();
}
