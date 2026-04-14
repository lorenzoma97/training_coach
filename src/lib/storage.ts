// Wrapper localStorage che espone la stessa API di window.storage (usata da DiaryApp).
// Usare sempre queste funzioni anziché localStorage direttamente.

type StorageResult = { value: string } | null;

export const storage = {
  async get(key: string): Promise<StorageResult> {
    const v = localStorage.getItem(key);
    return v !== null ? { value: v } : null;
  },
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
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
