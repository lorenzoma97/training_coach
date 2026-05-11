// Wave Privacy — test per purgeChatHistoryPII (one-shot migration).
//
// Coverage:
//  - History assente / vuota → 0 purged.
//  - History pulita (no PII) → 0 purged, 0 write.
//  - History con email/telefono nei messaggi user → N purged, model invariato.
//  - Idempotenza: re-run sulla stessa history → 0 purged.
//  - Storage corrotto / shape inattesa → graceful no-crash.
//  - Solo messaggi role="user" vengono toccati (model preservato).
//
// Pattern stub: MemoryStorage installato come globalThis.localStorage,
// identico a macroLookup.test.ts e oneRepMaxEstimator.test.ts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { purgeChatHistoryPII } from "../chatHistoryPurge";

const HISTORY_KEY = "coach-chat-history";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  get length(): number { return this.map.size; }
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = new MemoryStorage();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).localStorage;
});

describe("purgeChatHistoryPII", () => {
  it("ritorna {0,0} se la history non esiste in storage", async () => {
    const r = await purgeChatHistoryPII();
    expect(r.purged).toBe(0);
    expect(r.total).toBe(0);
  });

  it("ritorna {0,0} su history vuota", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([]));
    const r = await purgeChatHistoryPII();
    expect(r.purged).toBe(0);
    expect(r.total).toBe(0);
  });

  it("ritorna {0,N} su history pulita (no PII) e non riscrive lo storage", async () => {
    const clean = [
      { id: "1", role: "user", content: "Come va l'allenamento questa settimana?" },
      { id: "2", role: "model", content: "Stai migliorando, continua così." },
      { id: "3", role: "user", content: "Posso aumentare il volume?" },
    ];
    const before = JSON.stringify(clean);
    localStorage.setItem(HISTORY_KEY, before);

    const r = await purgeChatHistoryPII();
    expect(r.purged).toBe(0);
    expect(r.total).toBe(3);

    // Storage NON modificato (no write inutile su history pulita).
    expect(localStorage.getItem(HISTORY_KEY)).toBe(before);
  });

  it("redatta email + telefono nei messaggi user e ritorna count corretto", async () => {
    const dirty = [
      {
        id: "1",
        role: "user",
        content: "Scrivimi a lorenzo.marchionni@datalogic.com per il piano",
      },
      { id: "2", role: "model", content: "Ok, ti contatto a breve." },
      {
        id: "3",
        role: "user",
        content: "Il mio numero è +39 333 1234567 chiamami quando vuoi",
      },
      {
        id: "4",
        role: "user",
        content: "Domanda generica senza PII",
      },
    ];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(dirty));

    const r = await purgeChatHistoryPII();
    expect(r.purged).toBe(2);
    expect(r.total).toBe(4);

    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY)!) as Array<{
      id: string; role: string; content: string; _piiPurgedAt?: string;
    }>;
    expect(stored[0].content).toContain("[email]");
    expect(stored[0]._piiPurgedAt).toBeDefined();
    // Messaggio model NON toccato (anche se contenesse PII — è LLM-generated).
    expect(stored[1].content).toBe("Ok, ti contatto a breve.");
    expect(stored[1]._piiPurgedAt).toBeUndefined();
    expect(stored[2].content).toContain("[telefono]");
    expect(stored[2]._piiPurgedAt).toBeDefined();
    // Messaggio user senza PII NON marcato.
    expect(stored[3].content).toBe("Domanda generica senza PII");
    expect(stored[3]._piiPurgedAt).toBeUndefined();
  });

  it("è idempotente: re-run sulla stessa history → 0 purged", async () => {
    const dirty = [
      { id: "1", role: "user", content: "Email: lorenzo@datalogic.com" },
      { id: "2", role: "user", content: "CF MRCLNZ97A01A944Z" },
    ];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(dirty));

    const r1 = await purgeChatHistoryPII();
    expect(r1.purged).toBe(2);

    // Snapshot dopo prima purge.
    const snapshot1 = localStorage.getItem(HISTORY_KEY);

    const r2 = await purgeChatHistoryPII();
    expect(r2.purged).toBe(0);
    expect(r2.total).toBe(2);

    // Storage invariato fra le due run.
    expect(localStorage.getItem(HISTORY_KEY)).toBe(snapshot1);
  });

  it("non crasha su storage corrotto (JSON non parseable)", async () => {
    localStorage.setItem(HISTORY_KEY, "{{not valid json");
    // getJSON usa il fallback [] silenziosamente → la purge vede array vuoto.
    const r = await purgeChatHistoryPII();
    expect(r.purged).toBe(0);
    expect(r.total).toBe(0);
  });

  it("non crasha su shape inattesa (oggetto invece di array)", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ not: "an array" }));
    const r = await purgeChatHistoryPII();
    expect(r.purged).toBe(0);
    expect(r.total).toBe(0);
  });

  it("preserva campi extra non standard sui messaggi (no data loss)", async () => {
    const withExtras = [
      {
        id: "1",
        role: "user",
        content: "contattami a x@y.com",
        timestamp: "2026-04-01T10:00:00Z",
        sessionId: "abc-123",
      },
    ];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(withExtras));

    const r = await purgeChatHistoryPII();
    expect(r.purged).toBe(1);

    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY)!) as Array<Record<string, unknown>>;
    expect(stored[0].content).toContain("[email]");
    // Campi extra preservati.
    expect(stored[0].timestamp).toBe("2026-04-01T10:00:00Z");
    expect(stored[0].sessionId).toBe("abc-123");
  });
});
