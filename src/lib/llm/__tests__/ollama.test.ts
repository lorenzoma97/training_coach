// Test per OllamaProvider + integrazione fallback Gemini in index.ts.
//
// Pattern: mock di fetch globale (no rete reale) + LocalStorageMock per
// emulare la persistenza di config. Niente jsdom richiesto.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── LocalStorage mock ──────────────────────────────────────────────────────
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

// Helper: mocka fetch globale con risposte programmate.
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return await handler(url, init);
  });
  (globalThis as any).fetch = fn;
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new LocalStorageMock(),
    configurable: true,
    writable: true,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── ollamaHealthCheck ──────────────────────────────────────────────────────
describe("ollamaHealthCheck", () => {
  it("ritorna ok=true e lista modelli quando /api/tags risponde 200", async () => {
    const { ollamaHealthCheck } = await import("../ollama");
    mockFetch(async (url) => {
      expect(url).toContain("/api/tags");
      return jsonResponse({
        models: [
          { name: "qwen2.5:7b-instruct" },
          { name: "llama3.1:8b" },
        ],
      });
    });
    const r = await ollamaHealthCheck("http://localhost:11434");
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["qwen2.5:7b-instruct", "llama3.1:8b"]);
    expect(r.error).toBeUndefined();
  });

  it("ritorna ok=false quando il server risponde 500", async () => {
    const { ollamaHealthCheck } = await import("../ollama");
    mockFetch(async () => new Response("internal error", { status: 500 }));
    const r = await ollamaHealthCheck("http://localhost:11434");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("500");
  });

  it("ritorna ok=false con messaggio di errore quando fetch lancia", async () => {
    const { ollamaHealthCheck } = await import("../ollama");
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    const r = await ollamaHealthCheck("http://localhost:11434");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
  });

  it("ritorna ok=true con array vuoto se nessun modello installato", async () => {
    const { ollamaHealthCheck } = await import("../ollama");
    mockFetch(async () => jsonResponse({ models: [] }));
    const r = await ollamaHealthCheck("http://localhost:11434");
    expect(r.ok).toBe(true);
    expect(r.models).toEqual([]);
  });
});

// ─── generateJSON (parse + jsonMode flag) ───────────────────────────────────
describe("OllamaProvider.generateJSON", () => {
  it("invia format='json' e fa parse della response", async () => {
    const { ollamaAdapter } = await import("../ollama");
    let capturedBody: any = null;
    mockFetch(async (url, init) => {
      expect(url).toContain("/api/generate");
      capturedBody = JSON.parse(String(init?.body || "{}"));
      return jsonResponse({ response: '{"plan":"settimana 1","load":42}' });
    });
    const client = ollamaAdapter.createClient({
      provider: "ollama",
      apiKey: "local",
      modelId: "qwen2.5:7b-instruct",
    });
    const out = await client.generateJSON<{ plan: string; load: number }>({
      systemInstruction: "Sei un coach.",
      userPrompt: "Genera piano.",
      schemaHint: '{"plan":"string","load":"number"}',
    });
    expect(out).toEqual({ plan: "settimana 1", load: 42 });
    expect(capturedBody.format).toBe("json");
    expect(capturedBody.stream).toBe(false);
    expect(capturedBody.model).toBe("qwen2.5:7b-instruct");
    expect(capturedBody.options.temperature).toBe(0.6);
  });

  it("recupera JSON anche se wrappato in markdown fence", async () => {
    const { ollamaAdapter } = await import("../ollama");
    mockFetch(async () => jsonResponse({
      response: '```json\n{"ok": true}\n```',
    }));
    const client = ollamaAdapter.createClient({
      provider: "ollama",
      apiKey: "",
      modelId: "qwen2.5:7b-instruct",
    });
    const out = await client.generateJSON<{ ok: boolean }>({
      systemInstruction: "x",
      userPrompt: "y",
    });
    expect(out.ok).toBe(true);
  });

  it("lancia errore se response HTTP non-ok", async () => {
    const { ollamaAdapter } = await import("../ollama");
    mockFetch(async () => new Response('{"error":"model not loaded"}', { status: 404 }));
    const client = ollamaAdapter.createClient({
      provider: "ollama",
      apiKey: "",
      modelId: "qwen2.5:7b-instruct",
    });
    await expect(client.generateJSON({
      systemInstruction: "x",
      userPrompt: "y",
    })).rejects.toThrow(/model not loaded/);
  });
});

// ─── ping ───────────────────────────────────────────────────────────────────
describe("ollamaAdapter.ping", () => {
  it("ok=true se health check + modello installato", async () => {
    const { ollamaAdapter } = await import("../ollama");
    mockFetch(async () => jsonResponse({
      models: [{ name: "qwen2.5:7b-instruct" }],
    }));
    const r = await ollamaAdapter.ping("ignored", "qwen2.5:7b-instruct");
    expect(r.ok).toBe(true);
  });

  it("ok=false se modello richiesto non installato", async () => {
    const { ollamaAdapter } = await import("../ollama");
    mockFetch(async () => jsonResponse({
      models: [{ name: "llama3.1:8b" }],
    }));
    const r = await ollamaAdapter.ping("ignored", "qwen2.5:7b-instruct");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("non installato");
  });

  it("ok=false se Ollama non raggiungibile", async () => {
    const { ollamaAdapter } = await import("../ollama");
    mockFetch(async () => { throw new Error("connection refused"); });
    const r = await ollamaAdapter.ping("ignored", "qwen2.5:7b-instruct");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("connection refused");
  });
});

// ─── Fallback automatico a Gemini quando Ollama unreachable ─────────────────
describe("getCurrentClientWithFallback — fallback Gemini se Ollama down", () => {
  it("usa Ollama se health check ok", async () => {
    const indexMod = await import("../index");
    indexMod.invalidateOllamaHealthCache();
    mockFetch(async (url) => {
      if (url.includes("/api/tags")) {
        return jsonResponse({ models: [{ name: "qwen2.5:7b-instruct" }] });
      }
      return new Response("not hit", { status: 500 });
    });
    // Persist Ollama config
    localStorage.setItem("llm-config", JSON.stringify({
      provider: "ollama",
      apiKey: "local",
      modelId: "qwen2.5:7b-instruct",
    }));
    const client = await indexMod.getCurrentClientWithFallback();
    expect(client.provider).toBe("ollama");
  });

  it("fallback a Gemini se Ollama down e chiave Gemini legacy presente", async () => {
    const indexMod = await import("../index");
    indexMod.invalidateOllamaHealthCache();
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    localStorage.setItem("llm-config", JSON.stringify({
      provider: "ollama",
      apiKey: "local",
      modelId: "qwen2.5:7b-instruct",
    }));
    // Chiave Gemini legacy disponibile come fallback
    localStorage.setItem("gemini-api-key", "AIzaTestKeyFallbackForTests");
    const client = await indexMod.getCurrentClientWithFallback();
    expect(client.provider).toBe("gemini");
  });

  it("lancia errore se Ollama down e nessuna chiave Gemini disponibile", async () => {
    const indexMod = await import("../index");
    indexMod.invalidateOllamaHealthCache();
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    localStorage.setItem("llm-config", JSON.stringify({
      provider: "ollama",
      apiKey: "local",
      modelId: "qwen2.5:7b-instruct",
    }));
    await expect(indexMod.getCurrentClientWithFallback()).rejects.toThrow(/Ollama non raggiungibile/);
  });
});

// ─── BaseUrl getter/setter ──────────────────────────────────────────────────
describe("getOllamaBaseUrl / setOllamaBaseUrl", () => {
  it("default è http://localhost:11434", async () => {
    const { getOllamaBaseUrl } = await import("../ollama");
    expect(getOllamaBaseUrl()).toBe("http://localhost:11434");
  });

  it("setOllamaBaseUrl normalizza trailing slash", async () => {
    const { getOllamaBaseUrl, setOllamaBaseUrl } = await import("../ollama");
    setOllamaBaseUrl("http://my-pc.lan:11434/");
    expect(getOllamaBaseUrl()).toBe("http://my-pc.lan:11434");
  });

  it("setOllamaBaseUrl con stringa vuota resetta a default", async () => {
    const { getOllamaBaseUrl, setOllamaBaseUrl } = await import("../ollama");
    setOllamaBaseUrl("http://x:11434");
    setOllamaBaseUrl("");
    expect(getOllamaBaseUrl()).toBe("http://localhost:11434");
  });
});

// ─── hasLLMConfig per Ollama (no apiKey required) ───────────────────────────
describe("hasLLMConfig con provider=ollama", () => {
  it("ritorna true con apiKey vuota se provider=ollama e modelId presente", async () => {
    const { hasLLMConfig } = await import("../index");
    localStorage.setItem("llm-config", JSON.stringify({
      provider: "ollama",
      apiKey: "",
      modelId: "qwen2.5:7b-instruct",
    }));
    expect(hasLLMConfig()).toBe(true);
  });

  it("ritorna false se provider=gemini ma apiKey troppo corta", async () => {
    const { hasLLMConfig } = await import("../index");
    localStorage.setItem("llm-config", JSON.stringify({
      provider: "gemini",
      apiKey: "short",
      modelId: "gemini-3.1-flash-lite-preview",
    }));
    expect(hasLLMConfig()).toBe(false);
  });
});
