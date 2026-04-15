// Wrapper localStorage che espone la stessa API di window.storage (usata da DiaryApp).
// Usare sempre queste funzioni anziché localStorage direttamente.

type StorageResult = { value: string } | null;

export class StorageQuotaError extends Error {
  usedBytesApprox: number;
  constructor(message: string, usedBytesApprox: number) {
    super(message);
    this.name = "StorageQuotaError";
    this.usedBytesApprox = usedBytesApprox;
  }
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; code?: number };
  return err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 || err.code === 1014;
}

function approximateStorageSize(): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) || "";
      total += k.length + v.length;
    }
  } catch { /* ignore */ }
  return total * 2; // UTF-16 2 bytes/char
}

export const storage = {
  async get(key: string): Promise<StorageResult> {
    const v = localStorage.getItem(key);
    return v !== null ? { value: v } : null;
  },
  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (isQuotaError(e)) {
        const bytes = approximateStorageSize();
        throw new StorageQuotaError(
          `Spazio locale esaurito (~${Math.round(bytes / 1024)} KB usati). Esporta un backup e usa "Pulisci knowledge base" o "Pulisci diario" per liberare spazio.`,
          bytes,
        );
      }
      throw e;
    }
  },
  async delete(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
  async keys(prefix?: string): Promise<string[]> {
    const all: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (!prefix || k.startsWith(prefix))) all.push(k);
    }
    return all;
  }
};

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const r = await storage.get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  await storage.set(key, JSON.stringify(value));
}

/** Dimensione approssimativa usata da localStorage in bytes. Utile per warning preventivi. */
export function getStorageUsageBytes(): number {
  return approximateStorageSize();
}
