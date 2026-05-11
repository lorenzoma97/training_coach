import { useOnline } from "../lib/useOnline";

/**
 * Banner offline globale.
 *
 * Mostrato in sticky-top quando navigator.onLine === false. Informa che
 * il piano corrente (persistito in localStorage) resta consultabile, ma
 * le funzionalità che richiedono LLM (genera piano, chat coach, report
 * settimanale) non sono disponibili.
 *
 * Style inline (no Tailwind) coerente col resto della codebase.
 * Niente dismiss button: lo stato è derivato — appena torna online il
 * banner sparisce automaticamente.
 *
 * Mount in App root (sostituisce il banner inline che era in AppShell).
 */
export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 60,
        background: "#7F1D1D",
        color: "#FECACA",
        padding: "10px 16px",
        fontSize: "13px",
        fontWeight: 600,
        textAlign: "center",
        borderBottom: "1px solid #B91C1C",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      Offline — il piano corrente è disponibile, ma non puoi generare nuovo piano / chiedere al coach
    </div>
  );
}
