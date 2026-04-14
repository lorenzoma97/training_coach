import { useState } from "react";
import TrainingPlanView from "../components/TrainingPlanView";
import CoachFeedList from "../components/CoachFeedList";
import CoachChat from "../components/CoachChat";
import { hasApiKey } from "../lib/gemini";

type Tab = "plan" | "feed" | "chat";

export default function CoachPage() {
  const [tab, setTab] = useState<Tab>("plan");

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px 120px" }}>
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Coach</div>
        <h1 style={{ fontSize: "26px", fontWeight: 900, margin: "4px 0 0", letterSpacing: "-0.03em" }}>Il tuo allenatore AI</h1>
      </div>

      {!hasApiKey() && (
        <div style={{
          background: "#F59E0B15", border: "1px solid #F59E0B66",
          borderRadius: "12px", padding: "14px 16px", marginBottom: "16px",
          fontSize: "13px", color: "#FCD34D",
        }}>
          ⚠ Chiave Gemini non configurata. Vai in <b>Impostazioni</b> per abilitare il coach.
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", background: "#1A1A2E", padding: "4px", borderRadius: "12px", marginBottom: "16px" }}>
        {([
          { id: "plan" as const, label: "Piano" },
          { id: "feed" as const, label: "Feed" },
          { id: "chat" as const, label: "Chat" },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: "10px", borderRadius: "8px",
            background: tab === t.id ? "#16213E" : "transparent",
            border: "none", color: tab === t.id ? "#E2E8F0" : "#64748B",
            fontSize: "13px", fontWeight: 700, cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === "plan" && <TrainingPlanView />}
      {tab === "feed" && <CoachFeedList />}
      {tab === "chat" && <CoachChat />}
    </div>
  );
}
