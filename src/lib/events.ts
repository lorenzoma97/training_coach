// Event bus tipato per comunicazione tra Diario e Coach.
type Handler<T> = (payload: T) => void;

export type EventMap = {
  "workout:saved": { date: string; workout: any };
  "daily:saved": { date: string; daily: any };
  "plan:updated": { at: string };
  "goals:updated": { at: string };
  "profile:updated": { at: string };
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
