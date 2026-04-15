// Event bus tipato per comunicazione tra Diario e Coach.
type Handler<T> = (payload: T) => void;

export type EventMap = {
  "workout:saved": { date: string; workout: any };
  "daily:saved": { date: string; daily: any };
  "plan:updated": { at: string };
  "goals:updated": { at: string };
  "profile:updated": { at: string };
  "diary:openAdd": { type?: string; date?: string };
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
};

const listeners = new Map<keyof EventMap, Set<Handler<any>>>();

export const events = {
  on<K extends keyof EventMap>(ev: K, fn: Handler<EventMap[K]>): () => void {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(fn);
    return () => listeners.get(ev)!.delete(fn);
  },
  emit<K extends keyof EventMap>(ev: K, payload: EventMap[K]): void {
    listeners.get(ev)?.forEach(fn => {
      try { fn(payload); } catch (e) { console.error(`[event:${ev}]`, e); }
    });
  }
};
