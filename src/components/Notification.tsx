// Componente unificato per notifiche/toast/banner.
// Sostituisce i molteplici pattern in uso (successMsg in TrainingPlanView,
// flash in ProfileEditor/DiaryApp, message in BackupSection, toast App).
//
// Due modalità:
// - type="toast": overlay fisso top-center, auto-dismiss + X manuale
// - type="popup": modale centrata con backdrop (click-outside + Escape chiudono)
//
// API imperativa globale: useNotify() → notify({tone, title, message, ...})
// Stack gestito da NotificationHost (singolo, in App.tsx).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type NotificationTone = "success" | "error" | "warning" | "info";
export type NotificationMode = "toast" | "popup";

export interface NotificationPayload {
  id?: string;
  tone: NotificationTone;
  title: string;
  message?: string;
  /** "toast" (default) = banner con X + auto-dismiss. "popup" = modale con backdrop. */
  mode?: NotificationMode;
  /** Durata ms auto-dismiss. null/0 = persistente (va chiuso manualmente). Default: 6000. */
  duration?: number | null;
  /** Pulsante azione opzionale (es. "Riprova"). */
  action?: { label: string; onClick: () => void };
}

interface StoredNotification extends NotificationPayload {
  id: string;
}

interface NotificationCtx {
  notify: (payload: NotificationPayload) => string;
  dismiss: (id: string) => void;
}

const Ctx = createContext<NotificationCtx | null>(null);

export function useNotify(): NotificationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback no-op: se un componente chiama useNotify senza provider
    // (es. test isolati), non crasha. Log console per dev.
    console.warn("[useNotify] chiamato fuori da NotificationHost — no-op");
    return { notify: () => "", dismiss: () => {} };
  }
  return ctx;
}

const TONE_COLORS: Record<NotificationTone, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "#14532D", border: "#22C55E66", text: "#22C55E", icon: "✓" },
  error:   { bg: "#7F1D1D", border: "#EF444466", text: "#FCA5A5", icon: "✕" },
  warning: { bg: "#78350F", border: "#F59E0B66", text: "#FDE68A", icon: "⚠" },
  info:    { bg: "#1E3A5F", border: "#3B82F680", text: "#CBD5E1", icon: "ℹ" },
};

// Max notifiche simultanee in pila (evita overlap visivo).
const MAX_STACK = 3;

/**
 * Host globale delle notifiche. Monta in App.tsx al top-level.
 * Espone context con notify/dismiss per tutti i consumer.
 */
export function NotificationHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<StoredNotification[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(n => n.id !== id));
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
  }, []);

  const notify = useCallback((payload: NotificationPayload): string => {
    const id = payload.id || Math.random().toString(36).slice(2, 10);
    const duration = payload.duration === null ? null : (payload.duration ?? 6000);
    const item: StoredNotification = { ...payload, id, duration };
    setItems(prev => {
      // Dedupe by id (se l'utente riusa lo stesso id, aggiorniamo invece di aggiungere).
      const without = prev.filter(n => n.id !== id);
      // Stack cap: tieni max 3 toasts visibili, drop i più vecchi.
      const toasts = without.filter(n => (n.mode ?? "toast") === "toast");
      const popups = without.filter(n => n.mode === "popup");
      const newList = [...toasts.slice(-(MAX_STACK - (item.mode === "popup" ? 0 : 1))), ...popups, item];
      return newList;
    });
    // Auto-dismiss solo per toast (popup persistono fino a user action).
    if (duration && duration > 0 && (payload.mode ?? "toast") === "toast") {
      const t = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, t);
    }
    return id;
  }, [dismiss]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current.clear();
  }, []);

  const toasts = items.filter(n => (n.mode ?? "toast") === "toast");
  const popup = items.find(n => n.mode === "popup");

  return (
    <Ctx.Provider value={{ notify, dismiss }}>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 90, display: "flex", flexDirection: "column", gap: "8px",
          maxWidth: "92vw", width: "420px",
        }} role="region" aria-label="Notifiche">
          {toasts.map(n => <ToastCard key={n.id} n={n} onDismiss={() => dismiss(n.id)} />)}
        </div>
      )}
      {popup && <PopupCard n={popup} onDismiss={() => dismiss(popup.id)} />}
    </Ctx.Provider>
  );
}

function ToastCard({ n, onDismiss }: { n: StoredNotification; onDismiss: () => void }) {
  const c = TONE_COLORS[n.tone];
  return (
    <div role="status" aria-live={n.tone === "error" ? "assertive" : "polite"} style={{
      background: c.bg, color: c.text,
      border: `1px solid ${c.border}`,
      borderRadius: "10px", padding: "10px 12px",
      fontSize: "13px", lineHeight: 1.4,
      display: "flex", alignItems: "flex-start", gap: "10px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      animation: "slideDown 0.2s ease",
    }}>
      <span aria-hidden="true" style={{ fontWeight: 800, marginTop: "1px" }}>{c.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{n.title}</div>
        {n.message && <div style={{ color: "#E2E8F0", marginTop: "3px", fontSize: "12px", lineHeight: 1.5 }}>{n.message}</div>}
      </div>
      {n.action && (
        <button onClick={() => { n.action!.onClick(); onDismiss(); }} style={{
          background: "transparent", border: `1px solid ${c.border}`,
          borderRadius: "6px", color: c.text, padding: "4px 10px",
          fontSize: "12px", fontWeight: 700, cursor: "pointer",
        }}>{n.action.label}</button>
      )}
      <button onClick={onDismiss} aria-label="Chiudi" style={{
        background: "transparent", border: "none", color: "inherit",
        fontSize: "16px", lineHeight: 1, cursor: "pointer", padding: "0 0 0 4px",
        minWidth: "24px", minHeight: "24px",
      }}>×</button>
    </div>
  );
}

function PopupCard({ n, onDismiss }: { n: StoredNotification; onDismiss: () => void }) {
  const c = TONE_COLORS[n.tone];
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus sul primo bottone focusable al mount.
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      onClick={onDismiss}
      role="presentation"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={n.title}
        onClick={e => e.stopPropagation()}
        style={{
          background: "#0F172A",
          border: `2px solid ${c.border}`,
          borderRadius: "14px",
          padding: "24px 22px",
          maxWidth: "440px", width: "100%",
          display: "flex", flexDirection: "column", gap: "14px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          animation: "slideUp 0.2s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <div style={{
            width: "40px", height: "40px", borderRadius: "999px",
            background: c.bg, color: c.text,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "20px", fontWeight: 800, flexShrink: 0,
          }} aria-hidden="true">{c.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: c.text, marginBottom: "4px" }}>
              {n.title}
            </div>
            {n.message && (
              <div style={{ fontSize: "13px", color: "#CBD5E1", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {n.message}
              </div>
            )}
          </div>
          <button onClick={onDismiss} aria-label="Chiudi" style={{
            background: "transparent", border: "none", color: "#94A3B8",
            fontSize: "22px", lineHeight: 1, cursor: "pointer", padding: "0",
            minWidth: "32px", minHeight: "32px",
          }}>×</button>
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          {n.action && (
            <button onClick={() => { n.action!.onClick(); onDismiss(); }} style={{
              padding: "10px 18px",
              background: `linear-gradient(135deg, ${c.text}, ${c.border})`,
              border: "none", borderRadius: "10px",
              color: "#0F172A", fontWeight: 700, fontSize: "13px",
              cursor: "pointer", minHeight: "44px",
            }}>{n.action.label}</button>
          )}
          <button onClick={onDismiss} style={{
            padding: "10px 18px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px",
            color: "#E2E8F0", fontWeight: 600, fontSize: "13px",
            cursor: "pointer", minHeight: "44px",
          }}>{n.action ? "Annulla" : "Chiudi"}</button>
        </div>
      </div>
    </div>
  );
}
