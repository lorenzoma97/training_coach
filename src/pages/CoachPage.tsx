import { useEffect, useState } from "react";
import TrainingPlanView from "../components/TrainingPlanView";
import CoachFeedList from "../components/CoachFeedList";
import CoachChat from "../components/CoachChat";
import { hasApiKey } from "../lib/gemini";
import { getJSON } from "../lib/storage";
import type { UserProfile, UserGoal, TrainingPlan } from "../lib/types";

type Tab = "plan" | "feed" | "chat";

export default function CoachPage() {
  const [tab, setTab] = useState<Tab>("plan");
  const [setupStatus, setSetupStatus] = useState<{
    hasKey: boolean; hasProfile: boolean; hasGoals: boolean; hasPlan: boolean;
  }>({ hasKey: false, hasProfile: false, hasGoals: false, hasPlan: false });

  useEffect(() => {
    (async () => {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      const plan = await getJSON<TrainingPlan | null>("training-plan", null);
      setSetupStatus({
        hasKey: hasApiKey(),
        hasProfile: !!profile,
        hasGoals: goals.length > 0,
        hasPlan: !!plan,
      });
    })();
  }, [tab]);

  const missing: string[] = [];
  if (!setupStatus.hasKey) missing.push("chiave Gemini");
  if (!setupStatus.hasProfile) missing.push("profilo");
  if (!setupStatus.hasGoals) missing.push("obiettivi");
  if (!setupStatus.hasPlan) missing.push("piano");
  const setupIncomplete = missing.length > 0;

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px" }}>
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Coach</div>
        <h1 style={{ fontSize: "26px", fontWeight: 900, margin: "4px 0 0", letterSpacing: "-0.03em" }}>Il tuo allenatore AI</h1>
      </div>

      {setupIncomplete && (
        <div role="alert" style={{
          background: "#F59E0B15", border: "1px solid #F59E0B66",
          borderRadius: "12px", padding: "14px 16px", marginBottom: "16px",
        }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#F59E0B", marginBottom: "6px" }}>
            ⚠ Setup incompleto
          </div>
          <div style={{ fontSize: "13px", color: "#FCD34D", lineHeight: 1.5 }}>
            Mancano: <b>{missing.join(", ")}</b>. Completa la configurazione per ricevere feedback personalizzati.
          </div>
        </div>
      )}

      <div role="tablist" style={{ display: "flex", gap: "6px", background: "#1A1A2E", padding: "4px", borderRadius: "12px", marginBottom: "16px" }}>
        {([
          { id: "plan" as const, label: "Piano" },
          { id: "feed" as const, label: "Feed" },
          { id: "chat" as const, label: "Chat" },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            role="tab" aria-selected={tab === t.id}
            style={{
              flex: 1, padding: "10px", borderRadius: "8px",
              background: tab === t.id ? "#16213E" : "transparent",
              border: "none", color: tab === t.id ? "#E2E8F0" : "#94A3B8",
              fontSize: "13px", fontWeight: 700, cursor: "pointer",
              minHeight: "40px",
            }}>{t.label}</button>
        ))}
      </div>

      {tab === "plan" && <TrainingPlanView />}
      {tab === "feed" && <CoachFeedList />}
      {tab === "chat" && <CoachChat />}
    </div>
  );
}
