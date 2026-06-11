// ChatPage (P1 nav piatta, 2026-06-11) — chat coach come pagina dedicata,
// aperta dall'icona in header (Oggi) o da "Chiedi al coach" (chat:openWith).
// Back esplicito → torna a Oggi.

import { ArrowLeft } from "lucide-react";
import CoachChat from "../components/CoachChat";
import { events } from "../lib/events";

export default function ChatPage() {
  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px 20px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
        <button
          onClick={() => events.emit("nav:goto", { tab: "today" })}
          aria-label="Torna a Oggi"
          style={{
            width: "44px", height: "44px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px", color: "#CBD5E1", cursor: "pointer",
          }}
        >
          <ArrowLeft size={19} />
        </button>
        <h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Chat coach</h1>
      </div>
      <CoachChat />
    </div>
  );
}
