// TodayPage (P1 nav piatta, 2026-06-11) — la HOME dell'app.
// Header: titolo + icone Chat (con badge non letti) e Impostazioni.
// Contenuto: TodayTab (eroe sessione + stati + feed), già rifinito in P2-Oggi.

import { MessageCircle, Settings } from "lucide-react";
import { TodayTab } from "./CoachPageV2";
import { events } from "../lib/events";

export default function TodayPage({ unreadChat }: { unreadChat: number }) {
  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px 20px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        <h1 style={{ flex: 1, fontSize: "22px", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Oggi</h1>
        <button
          onClick={() => events.emit("nav:goto", { tab: "chat" })}
          aria-label={unreadChat > 0 ? `Chat coach, ${unreadChat} novità` : "Chat coach"}
          style={{
            position: "relative", width: "44px", height: "44px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px", color: "#CBD5E1", cursor: "pointer",
          }}
        >
          <MessageCircle size={19} />
          {unreadChat > 0 && (
            <span style={{
              position: "absolute", top: "6px", right: "6px",
              width: "9px", height: "9px", borderRadius: "50%",
              background: "#14B8A6", border: "2px solid #0B0F1A",
            }} />
          )}
        </button>
        <button
          onClick={() => events.emit("nav:goto", { tab: "settings" })}
          aria-label="Impostazioni"
          style={{
            width: "44px", height: "44px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px", color: "#CBD5E1", cursor: "pointer",
          }}
        >
          <Settings size={19} />
        </button>
      </div>
      <TodayTab onGoToPlan={() => events.emit("nav:goto", { tab: "plan" })} />
    </div>
  );
}
