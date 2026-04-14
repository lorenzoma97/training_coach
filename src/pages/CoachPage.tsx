import { useEffect, useState } from "react";
import TrainingPlanView from "../components/TrainingPlanView";
import CoachFeedList from "../components/CoachFeedList";
import CoachChat from "../components/CoachChat";
import { hasApiKey } from "../lib/gemini";
import { getJSON, setJSON } from "../lib/storage";
import type { UserProfile, UserGoal, TrainingPlan } from "../lib/types";
import { events } from "../lib/events";
import { generateInitialPlan } from "../lib/coach/planGenerator";
import { translateGeminiError } from "../lib/geminiErrors";

type Tab = "plan" | "feed" | "chat";

export default function CoachPage() {
  const [tab, setTab] = useState<Tab>("plan");
  const [setupStatus, setSetupStatus] = useState<{
    hasKey: boolean; hasProfile: boolean; hasGoals: boolean; hasPlan: boolean;
  }>({ hasKey: false, hasProfile: false, hasGoals: false, hasPlan: false });
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const refreshSetup = async () => {
    const profile = await getJSON<UserProfile | null>("user-profile", null);
    const goals = await getJSON<UserGoal[]>("user-goals", []);
    const plan = await getJSON<TrainingPlan | null>("training-plan", null);
    setSetupStatus({
      hasKey: hasApiKey(),
      hasProfile: !!profile,
      hasGoals: goals.length > 0,
      hasPlan: !!plan,
    });
  };

  useEffect(() => { refreshSetup(); }, [tab]);

  const missing: string[] = [];
  if (!setupStatus.hasKey) missing.push("chiave LLM");
  if (!setupStatus.hasProfile) missing.push("profilo");
  if (!setupStatus.hasGoals) missing.push("obiettivi");
  if (!setupStatus.hasPlan) missing.push("piano");
  const setupIncomplete = missing.length > 0;

  const resumeOnboarding = () => {
    if (confirm("Riprendi l'onboarding per compilare i dati mancanti. I dati già salvati resteranno. Procedere?")) {
      events.emit("onboarding:resume", {});
    }
  };

  const goToSettings = () => events.emit("nav:goto", { tab: "settings" });

  const handleGeneratePlan = async () => {
    if (generatingPlan) return;
    setGeneratingPlan(true);
    setPlanError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      if (!profile) { setPlanError("Compila prima il profilo."); return; }
      const plan = await generateInitialPlan(profile, goals);
      await setJSON("training-plan", plan);
      events.emit("plan:updated", { at: new Date().toISOString() });
      await refreshSetup();
    } catch (e) {
      setPlanError(translateGeminiError(e));
    }
    setGeneratingPlan(false);
  };

  const btnPrimary: React.CSSProperties = {
    padding: "9px 14px",
    background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
    border: "none", borderRadius: "8px", color: "#FFF",
    fontWeight: 700, fontSize: "13px", cursor: "pointer",
  };
  const btnGhost: React.CSSProperties = {
    padding: "9px 14px", background: "#1A1A2E",
    border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px",
    color: "#E2E8F0", fontWeight: 600, fontSize: "13px", cursor: "pointer",
  };

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
          <div style={{ fontSize: "13px", color: "#FCD34D", lineHeight: 1.5, marginBottom: "12px" }}>
            Mancano: <b>{missing.join(", ")}</b>. Completa la configurazione per ricevere feedback personalizzati.
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {!setupStatus.hasKey && (
              <button onClick={goToSettings} style={btnPrimary}>⚙ Configura provider LLM</button>
            )}
            {(!setupStatus.hasProfile || !setupStatus.hasGoals) && setupStatus.hasKey && (
              <button onClick={resumeOnboarding} style={btnPrimary}>
                📝 {!setupStatus.hasProfile ? "Compila profilo" : "Aggiungi obiettivi"}
              </button>
            )}
            {setupStatus.hasKey && setupStatus.hasProfile && !setupStatus.hasPlan && (
              <button onClick={handleGeneratePlan} disabled={generatingPlan} style={{ ...btnPrimary, opacity: generatingPlan ? 0.5 : 1 }}>
                {generatingPlan ? "⏳ Generazione…" : "🎯 Genera piano ora"}
              </button>
            )}
            {setupStatus.hasProfile && (
              <button onClick={resumeOnboarding} style={btnGhost}>🔁 Riprendi wizard</button>
            )}
          </div>
          {planError && (
            <div style={{ marginTop: "10px", color: "#EF4444", fontSize: "12px" }}>{planError}</div>
          )}
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
