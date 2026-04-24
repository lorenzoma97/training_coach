// Wrapper localStorage che espone la stessa API di window.storage (usata da DiaryApp).
// Usare sempre queste funzioni anziché localStorage direttamente.

import type { ZodType } from "zod";

type StorageResult = { value: string } | null;

export class StorageQuotaError extends Error {
  usedBytesApprox: number;
  constructor(message: string, usedBytesApprox: number) {
    super(message);
    this.name = "StorageQuotaError";
    this.usedBytesApprox = usedBytesApprox;
  }
}

/** Errore lanciato quando un singolo payload supera il limite hard (1MB). */
export class StorageValueTooLargeError extends Error {
  sizeBytes: number;
  key: string;
  constructor(key: string, sizeBytes: number) {
    super(
      `Payload troppo grande per la chiave "${key}" (~${Math.round(sizeBytes / 1024)} KB, limite 1MB). ` +
      `Riduci il contenuto o suddividi in più chiavi.`,
    );
    this.name = "StorageValueTooLargeError";
    this.sizeBytes = sizeBytes;
    this.key = key;
  }
}

/** Limite hard per singolo valore serializzato (1MB in bytes UTF-16 approssimati). */
export const MAX_VALUE_BYTES = 1024 * 1024;

/**
 * Allowlist di chiavi che possono superare MAX_VALUE_BYTES (limite alzato).
 * Vuoto: gli embeddings RAG sono ora in IndexedDB (vedi src/lib/ragStorage.ts),
 * non più in localStorage. Manteniamo lo scaffold per future eccezioni.
 */
const OVERSIZE_KEY_LIMITS: Record<string, number> = {};

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
  },

  /**
   * Scansiona le chiavi (opzionalmente filtrate per prefisso) e logga quelle
   * con JSON corrotto. NON rimuove nulla: l'utente/dev decide cosa fare.
   * Utile per diagnosi da console in caso di problemi di parsing.
   * Ritorna la lista delle chiavi corrotte trovate.
   */
  async cleanCorrupted(keyPrefix?: string): Promise<string[]> {
    const corrupted: string[] = [];
    const keys = await this.keys(keyPrefix);
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v === null) continue;
      try { JSON.parse(v); } catch (e) {
        corrupted.push(k);
        console.warn(
          `[storage.cleanCorrupted] Chiave corrotta: "${k}" ` +
          `(size ~${v.length} chars). Parse error:`, e,
          "\nPreview:", v.slice(0, 120) + (v.length > 120 ? "…" : ""),
        );
      }
    }
    if (corrupted.length === 0) {
      console.info(
        `[storage.cleanCorrupted] Nessuna chiave corrotta trovata` +
        `${keyPrefix ? ` (prefix: "${keyPrefix}")` : ""}.`,
      );
    } else {
      console.warn(
        `[storage.cleanCorrupted] ${corrupted.length} chiave/i corrotta/e:`,
        corrupted,
      );
    }
    return corrupted;
  },
};

/**
 * Legge e deserializza JSON da storage. Errori di parsing NON sono propagati:
 * una chiave corrotta non deve abbattere l'app (è un problema locale a quella
 * chiave, la UI può degradare in modo elegante usando il fallback). Logghiamo
 * un warning dettagliato così il dev può intervenire via `storage.cleanCorrupted`.
 */
export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const r = await storage.get(key);
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch (e) {
    console.warn(
      `[storage.getJSON] JSON corrotto per chiave "${key}" ` +
      `(size ~${r.value.length} chars). Uso fallback. Parse error:`, e,
      "\nPreview:", r.value.slice(0, 120) + (r.value.length > 120 ? "…" : ""),
    );
    return fallback;
  }
}

/**
 * Variante di `getJSON` con validazione runtime Zod. Pensata per chiavi critiche
 * (profile, plan, goals, onboarding) dove una shape corrotta/incompatibile può
 * propagare errori a cascata nella UI.
 *
 * Comportamento:
 *  - JSON.parse fallisce → warning + fallback (come getJSON).
 *  - Zod schema.safeParse fallisce → warning dettagliato + fallback.
 *  - In entrambi i casi NON rilancia: la UI deve degradare in modo elegante.
 *
 * NOTA: non sostituisce `getJSON` (retrocompat). Da adottare sui callsite
 * critici in modo incrementale.
 */
export async function getValidatedJSON<T>(
  key: string,
  schema: ZodType<T>,
  fallback: T,
): Promise<T> {
  const r = await storage.get(key);
  if (!r) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.value);
  } catch (e) {
    console.warn(
      `[storage.getValidatedJSON] JSON corrotto per chiave "${key}" ` +
      `(size ~${r.value.length} chars). Uso fallback. Parse error:`, e,
      "\nPreview:", r.value.slice(0, 120) + (r.value.length > 120 ? "…" : ""),
    );
    return fallback;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      `[storage.getValidatedJSON] Schema non valido per chiave "${key}". ` +
      `Uso fallback. Issues:`, result.error.issues,
    );
    return fallback;
  }
  return result.data;
}

/**
 * Utility di coercizione boolean per valori che arrivano da fonti esterne
 * (storage event da altra tab, localStorage corrotto, migrazioni).
 * Accetta true/false nativi, "true"/"false" (case-insensitive), 1/0, "1"/"0".
 * Tutto il resto (null, undefined, oggetti, stringhe arbitrarie) → false.
 *
 * Motivazione: `JSON.parse("true")` funziona, ma un tab esterno può scrivere
 * la stringa letterale `true` (senza quote) o un boolean mal serializzato;
 * fare `JSON.parse(e.newValue)` nel caller crasha su input non-JSON.
 */
export function safeBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1";
  }
  return false;
}

/**
 * Serializza e salva un valore. In caso di quota exceeded, prova pruning automatico
 * su chiavi note (coach-chat-history, coach-feed, plan-history) e ritenta 1 volta.
 * In caso di payload > 1MB, rifiuta subito con StorageValueTooLargeError.
 * Può lanciare: StorageValueTooLargeError, StorageQuotaError, o Error generico.
 */
export async function setJSON<T>(key: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value);
  // Stima bytes UTF-16 (2 bytes/char)
  const sizeBytes = serialized.length * 2;

  // Limite per chiave: alcune chiavi (es. RAG embeddings) sono nella allowlist
  // e possono superare 1MB fino a un limite specifico più alto.
  const effectiveLimit = OVERSIZE_KEY_LIMITS[key] ?? MAX_VALUE_BYTES;
  if (sizeBytes > effectiveLimit) {
    console.warn(
      `[storage.setJSON] Payload rifiutato per chiave "${key}": ` +
      `~${Math.round(sizeBytes / 1024)} KB supera il limite ${Math.round(effectiveLimit / 1024)} KB.`,
    );
    throw new StorageValueTooLargeError(key, sizeBytes);
  }

  try {
    await storage.set(key, serialized);
  } catch (e) {
    const isQuota = e instanceof StorageQuotaError || isQuotaError(e);
    if (!isQuota) {
      throw e;
    }

    console.warn(
      `[storage.setJSON] Quota exceeded scrivendo "${key}". Tento pruning automatico...`,
    );
    try {
      const freed = await pruneOldData();
      console.info(`[storage.setJSON] Pruning liberato ~${freed} bytes. Ritento la scrittura.`);
    } catch (pruneErr) {
      console.error("[storage.setJSON] Pruning fallito:", pruneErr);
    }

    // Ritenta una sola volta
    try {
      await storage.set(key, serialized);
    } catch (retryErr) {
      console.error(
        `[storage.setJSON] Scrittura "${key}" fallita anche dopo pruning. ` +
        `Size payload: ~${Math.round(sizeBytes / 1024)} KB. ` +
        `Usage stimato: ~${Math.round(approximateStorageSize() / 1024)} KB.`,
        retryErr,
      );
      throw retryErr;
    }
  }
}

/**
 * Effettua pruning automatico su chiavi note per liberare spazio.
 * - coach-chat-history: tieni ultimi 50 messaggi
 * - coach-feed: tieni primi 200 elementi
 * - plan-history: tieni primi 20 elementi
 * Ritorna la stima dei bytes liberati.
 */
export async function pruneOldData(): Promise<number> {
  let freedChars = 0;

  async function prune(key: string, mode: "last" | "first", n: number): Promise<void> {
    const r = await storage.get(key);
    if (!r) return;
    let arr: unknown;
    try { arr = JSON.parse(r.value); } catch { return; }
    if (!Array.isArray(arr)) return;
    if (arr.length <= n) return;

    const beforeLen = r.value.length;
    const trimmed = mode === "last" ? arr.slice(-n) : arr.slice(0, n);
    const newSerialized = JSON.stringify(trimmed);
    try {
      await storage.set(key, newSerialized);
      freedChars += beforeLen - newSerialized.length;
    } catch (e) {
      console.warn(`[storage.pruneOldData] Fallita riscrittura "${key}" post-prune:`, e);
    }
  }

  await prune("coach-chat-history", "last", 50);
  await prune("coach-feed", "first", 200);
  await prune("plan-history", "first", 20);

  return freedChars * 2; // bytes UTF-16 approssimati
}

/** Dimensione approssimativa usata da localStorage in bytes. Utile per warning preventivi. */
export function getStorageUsageBytes(): number {
  return approximateStorageSize();
}
