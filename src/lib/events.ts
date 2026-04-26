// Event bus tipato per comunicazione tra Diario e Coach.
type Handler<T> = (payload: T) => void;

export type EventMap = {
  "workout:saved": { date: string; workout: any };
  "daily:saved": { date: string; daily: any };
  "plan:updated": { at: string };
  "goals:updated": { at: string };
  "profile:updated": { at: string };
  "diary:openAdd": {
    type?: string;
    date?: string;
    /** Campi pre-compilati nel form (es. { durata_totale: 30, subtype: "Fondo Lento" }). Subtype viene mappato case-insensitive al campo "tipo" select del workout type. */
    prefill?: Record<string, any>;
    /** Testo pre-compilato in "Note & Sensazioni". */
    notes?: string;
  };
  "nav:goto": { tab: "diary" | "trends" | "coach" | "settings" };
  "onboarding:resume": {};
  /** Emesso quando localStorage è stato modificato in un'ALTRA tab/finestra.
   *  Permette ai componenti di ri-leggere i dati e sincronizzarsi. */
  "data:externalChange": { key: string };
  /** Emesso quando il provider LLM migra automaticamente un modello deprecato. */
  "llm:migrated": { fromModelId: string; toModelId: string; reason: string };
  /** Emesso quando il modello primario LLM fallisce e si passa al fallback. */
  "llm:fallbackActivated": { primary: string; fallback: string; reason: string };
  /** Emesso quando la chat history cambia (per sync cross-tab/componente). */
  "chat:historyChanged": { length: number };
  /** Apre la chat Coach pre-compilando l'input con un prompt contestuale
   *  (es. "parlami della sessione di mer"). Tipicamente accoppiato a
   *  `nav:goto` tab="coach" dal chiamante. */
  "chat:openWith": { prompt: string };
};

const listeners = new Map<keyof EventMap, Set<Handler<any>>>();

/**
 * Validatori opzionali per-evento. Ritornano `true` se il payload è valido.
 * Il fallimento emette solo un warning e NON interrompe il flusso: scopo dev-ergo.
 */
type PayloadValidator = (payload: unknown) => boolean;

const PAYLOAD_VALIDATORS: Partial<Record<keyof EventMap, PayloadValidator>> = {
  "profile:updated": (p) =>
    !!p && typeof p === "object" && typeof (p as any).at === "string",
  "plan:updated": (p) =>
    !!p && typeof p === "object" && typeof (p as any).at === "string",
  "goals:updated": (p) =>
    !!p && typeof p === "object" && typeof (p as any).at === "string",
  "workout:saved": (p) =>
    !!p && typeof p === "object" &&
    typeof (p as any).date === "string" &&
    !!(p as any).workout && typeof (p as any).workout === "object",
  "daily:saved": (p) =>
    !!p && typeof p === "object" &&
    typeof (p as any).date === "string" &&
    !!(p as any).daily && typeof (p as any).daily === "object",
  "data:externalChange": (p) =>
    !!p && typeof p === "object" && typeof (p as any).key === "string",
  "chat:historyChanged": (p) =>
    !!p && typeof p === "object" && typeof (p as any).length === "number",
  "chat:openWith": (p) =>
    !!p && typeof p === "object" && typeof (p as any).prompt === "string",
  "llm:migrated": (p) =>
    !!p && typeof p === "object" &&
    typeof (p as any).fromModelId === "string" &&
    typeof (p as any).toModelId === "string",
  "llm:fallbackActivated": (p) =>
    !!p && typeof p === "object" &&
    typeof (p as any).primary === "string" &&
    typeof (p as any).fallback === "string",
  "nav:goto": (p) =>
    !!p && typeof p === "object" && typeof (p as any).tab === "string",
  "diary:openAdd": (p) => {
    if (!p || typeof p !== "object") return false;
    const o = p as Record<string, unknown>;
    // Tutti i campi sono opzionali: se presenti, devono rispettare il tipo.
    if (o.type !== undefined && typeof o.type !== "string") return false;
    if (o.date !== undefined && typeof o.date !== "string") return false;
    if (o.notes !== undefined && typeof o.notes !== "string") return false;
    if (o.prefill !== undefined && (typeof o.prefill !== "object" || o.prefill === null)) return false;
    return true;
  },
  "onboarding:resume": (p) =>
    !!p && typeof p === "object",
};

export const events = {
  on<K extends keyof EventMap>(ev: K, fn: Handler<EventMap[K]>): () => void {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(fn);
    return () => listeners.get(ev)!.delete(fn);
  },
  emit<K extends keyof EventMap>(ev: K, payload: EventMap[K]): void {
    const validator = PAYLOAD_VALIDATORS[ev];
    if (validator && !validator(payload)) {
      console.warn(
        `[events.emit] Payload non valido per "${String(ev)}". Campi minimi mancanti/malformati.`,
        payload,
      );
      // NON interrompere: è solo dev-ergo, gli handler ricevono comunque il payload.
    }
    listeners.get(ev)?.forEach(fn => {
      try { fn(payload); } catch (e) { console.error(`[event:${String(ev)}]`, e); }
    });
  }
};

// =========================================================================
// Cross-tab polling fallback per `data:externalChange`.
// Alcuni browser / contesti (iframe restrittivi, Safari privato) non emettono
// storage events in modo affidabile: come fallback, ogni 15s confrontiamo un
// checksum leggero di chiavi critiche e, se cambiato, emettiamo l'evento.
// =========================================================================

const POLLED_CRITICAL_KEYS = [
  "user-profile",
  "training-plan",
  "user-goals",
  "coach-feed",
  "coach-chat-history",
] as const;

const POLL_INTERVAL_MS = 15_000;

/** Checksum leggero: length + somma codici char modulo. Evita md5/sha. */
function lightChecksum(s: string | null): string {
  if (s == null) return "null";
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum + s.charCodeAt(i)) % 0xffffffff;
  return `${s.length}:${sum.toString(16)}`;
}

const lastSeenChecksums = new Map<string, string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function snapshotInitialChecksums(): void {
  for (const k of POLLED_CRITICAL_KEYS) {
    try {
      lastSeenChecksums.set(k, lightChecksum(localStorage.getItem(k)));
    } catch { /* ignore */ }
  }
}

function pollOnce(): void {
  for (const k of POLLED_CRITICAL_KEYS) {
    let current: string;
    try {
      current = lightChecksum(localStorage.getItem(k));
    } catch {
      continue;
    }
    const prev = lastSeenChecksums.get(k);
    if (prev !== undefined && prev !== current) {
      events.emit("data:externalChange", { key: k });
    }
    lastSeenChecksums.set(k, current);
  }
}

/**
 * Avvia il polling fallback per rilevare modifiche cross-tab su chiavi critiche.
 * Idempotente: chiamate successive sono no-op. Si auto-pulisce su `beforeunload`.
 * Da chiamare all'avvio dell'app (es. in main.tsx). Il costo CPU è trascurabile.
 */
export function startCrossTabPollingFallback(): void {
  if (typeof window === "undefined") return;
  if (pollTimer !== null) return;
  snapshotInitialChecksums();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  const cleanup = () => stopCrossTabPollingFallback();
  try {
    window.addEventListener("beforeunload", cleanup, { once: true });
  } catch { /* ignore */ }
}

/** Arresta il polling fallback. Idempotente. */
export function stopCrossTabPollingFallback(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Auto-avvio: il costo è nullo e copre i consumer che non chiamano esplicitamente.
if (typeof window !== "undefined") {
  try { startCrossTabPollingFallback(); } catch { /* ignore */ }
}
