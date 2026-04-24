// IndexedDB persistence per gli embeddings RAG.
// Motivazione: gli embeddings sono ~2MB (30 chunk × 768-dim float). Sopra
// il limite hard di 1MB di setJSON e occupano il 40% della quota localStorage
// (~5MB su iOS Safari, fino a 10MB altrove). IndexedDB ha quota molto più
// ampia (~50MB+ tipica, fino al 60% del disco) → libera localStorage per
// diario/chat/feed e risolve i crash su iOS private mode.
//
// API: stesso shape di getJSON/setJSON ma async via Promise wrapper.
// La migrazione una-tantum da localStorage avviene al primo `getRagCache()`.

const DB_NAME = "training-coach";
const DB_VERSION = 1;
const STORE = "rag";
const RAG_KEY = "embeddings-v1";
// Vecchia chiave localStorage da cui migrare (1-shot).
const LEGACY_LOCALSTORAGE_KEY = "rag-embeddings-v1";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB upgrade bloccato (chiudi altre tab)"));
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result ?? null) as T | null);
    req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB set failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
  });
}

let migrationDone = false;

/**
 * Migrazione una-tantum: se esiste ancora la vecchia cache in localStorage,
 * la sposta in IndexedDB e cancella l'originale. Best-effort: se fallisce
 * (storage events disabilitati, browser anomalo) l'utente vedrà "missing"
 * e potrà rigenerare. Eseguita lazy al primo accesso.
 */
async function migrateFromLocalStorageOnce(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const legacyRaw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
    if (!legacyRaw) return;
    const existingInIDB = await idbGet<unknown>(RAG_KEY);
    if (existingInIDB) {
      // IndexedDB ha già una cache più recente — cancella solo il legacy.
      localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
      console.info("[ragStorage] Cache già in IndexedDB; cancello copia legacy localStorage.");
      return;
    }
    const parsed = JSON.parse(legacyRaw);
    await idbSet(RAG_KEY, parsed);
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
    console.info("[ragStorage] Cache RAG migrata da localStorage a IndexedDB.");
  } catch (e) {
    console.warn("[ragStorage] Migrazione legacy fallita (non critico):", e);
  }
}

export async function getRagCache<T>(): Promise<T | null> {
  await migrateFromLocalStorageOnce();
  try {
    return await idbGet<T>(RAG_KEY);
  } catch (e) {
    console.warn("[ragStorage] get fallito:", e);
    return null;
  }
}

export async function setRagCache<T>(value: T): Promise<void> {
  await migrateFromLocalStorageOnce();
  await idbSet(RAG_KEY, value);
}

export async function deleteRagCache(): Promise<void> {
  await migrateFromLocalStorageOnce();
  try {
    await idbDelete(RAG_KEY);
  } catch (e) {
    console.warn("[ragStorage] delete fallito:", e);
  }
  // Cancella anche eventuali residui legacy se la migrazione non ha avuto
  // successo per qualche motivo.
  try { localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY); } catch { /* noop */ }
}
