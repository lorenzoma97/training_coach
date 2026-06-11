import { useEffect, useState, type ReactNode } from "react";
import { useModalBackButton } from "../../lib/useModalBackButton";

// BottomSheet canonico (P1 redesign, 2026-06-11) — overlay livello 3 del
// sistema profondità: scrim + pannello ancorato in basso, motion 300ms,
// back-button Android integrato. Sostituisce menu inline e piccoli modali.
export default function BottomSheet({
  open, onClose, title, children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useModalBackButton(open, onClose);
  // entered: attiva la transizione di ingresso al frame successivo al mount.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!open) { setEntered(false); return; }
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ position: "fixed", inset: 0, zIndex: 100 }}
    >
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(3, 6, 14, 0.6)",
          backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
          opacity: entered ? 1 : 0,
          transition: "opacity 200ms ease-out",
        }}
      />
      {/* Pannello */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          margin: "0 auto", maxWidth: "560px",
          background: "#131C33",
          border: "1px solid rgba(255,255,255,0.08)", borderBottom: "none",
          borderRadius: "20px 20px 0 0",
          padding: "10px 16px calc(16px + env(safe-area-inset-bottom, 0px))",
          transform: entered ? "translateY(0)" : "translateY(24px)",
          opacity: entered ? 1 : 0,
          transition: "transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-out",
        }}
      >
        {/* Grabber */}
        <div aria-hidden="true" style={{
          width: "36px", height: "4px", borderRadius: "2px",
          background: "rgba(255,255,255,0.18)", margin: "0 auto 12px",
        }} />
        {title && (
          <div style={{
            fontSize: "11px", fontWeight: 700, color: "#94A3B8",
            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "10px",
          }}>{title}</div>
        )}
        {children}
      </div>
    </div>
  );
}
