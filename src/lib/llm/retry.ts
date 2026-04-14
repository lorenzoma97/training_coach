// Helper per retry automatico su errori transitori (503 overload, 429 rate limit).
// Usato principalmente per ping() e listModels() — operazioni ad-hoc brevi.
// NON usato per chiamate normali (streaming/JSON) che gestiscono già errori via UI.

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
}

export function isTransientError(err: unknown): boolean {
  const msg = ((err as Error)?.message || String(err)).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("high demand") ||
    msg.includes("overload") ||
    msg.includes("unavailable") ||
    msg.includes("try again") ||
    msg.includes("resource_exhausted")
  );
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 800, shouldRetry = isTransientError } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries || !shouldRetry(e)) throw e;
      const delay = baseDelayMs * Math.pow(2, attempt); // 800ms, 1.6s, 3.2s
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}
