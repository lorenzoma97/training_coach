import { useEffect, useState } from "react";
import TrainingPlanView from "../components/TrainingPlanView";
import CoachFeedList from "../components/CoachFeedList";
import CoachChat from "../components/CoachChat";
import GoalsEditor from "../components/GoalsEditor";
import ZonesCard from "../components/ZonesCard";
import ZonesAnalytics from "../components/ZonesAnalytics";
import { hasApiKey } from "../lib/gemini";
import { getJSON, setJSON } from "../lib/storage";
import { savePlanWithHistory } from "../lib/coach/planHistory";
import type { UserProfile, UserGoal, TrainingPlan } from "../lib/types";
import { events } from "../lib/events";
import { generateInitialPlan } from "../lib/coach/planGenerator";
import { maybeRunWeeklyReport } from "../lib/scheduler";
import { translateGeminiError } from "../lib/geminiErrors";

type Tab = "plan" | "goals" | "zones" | "feed" | "chat";

export default function CoachPage() {
  const [tab, setTab] = useState<Tab>("plan");
  const [setupStatus, setSetupStatus] = useState<{
    hasKey: boolean; hasProfile: boolean; hasGoals: boolean; hasPlan: boolean;
  }>({ hasKey: false, hasProfile: false, hasGoals: false, hasPlan: false });
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [runningReport, setRunningReport] = useState(false);
  const [reportMsg, setReportMsg] = useState<string | null>(null);

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

  // Cross-tab sync: ricarica setup status se cambia in altra tab
  useEffect(() => {
    const off = events.on("data:externalChange", ({ key }) => {
      if (["user-profile", "user-goals", "training-plan", "llm-config", "gemini-api-key"].includes(key)) {
        refreshSetup();
      }
    });
    return off;
  }, []);

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

  const handleRunWeeklyReport = async () => {
    if (runningReport) return;
    if (!confirm("Generare ora il report settimanale integrando gli ultimi 7 giorni? Il coach rigenererà anche il piano.")) return;
    setRunningReport(true);
    setReportMsg(null);
    try {
      const item = await maybeRunWeeklyReport(true);
      if (item) {
        setReportMsg("✓ Report generato. Vai sul tab Feed per leggerlo.");
        setTab("feed");
      } else {
        setReportMsg("Impossibile generare il report. Verifica la chiave API in Impostazioni.");
      }
    } catch (e) {
      setReportMsg("✗ " + translateGeminiError(e));
    }
    setRunningReport(false);
  };

  const handleGeneratePlan = async () => {
    if (generatingPlan) return;
    setGeneratingPlan(true);
    setPlanError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      if (!profile) { setPlanError("Compila prima il profilo."); return; }
      const plan = await generateInitialPlan(profile, goals);
      // Usa savePlanWithHistory così se un vecchio piano esiste (es. post-reset
      // parziale) viene archiviato invece di perdersi silenziosamente.
      await savePlanWithHistory(plan);
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
          { id: "chat" as const, label: "Chat" },
          { id: "feed" as const, label: "Feed" },
          { id: "zones" as const, label: "Zone FC" },
          { id: "goals" as const, label: "Obiettivi" },
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
      {tab === "goals" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
            Obiettivi
          </div>
          <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5 }}>
            Modifica, aggiungi, archivia. Il coach dimensiona piano e feedback su questi obiettivi.
          </div>
          <GoalsEditor />
        </div>
      )}
      {tab === "zones" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div style={{ background: "#16213E", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "18px 20px" }}>
            <ZonesCard />
          </div>
          <div style={{ background: "#16213E", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "18px 20px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: "12px" }}>
              Analytics — tempo per zona
            </div>
            <ZonesAnalytics />
          </div>
        </div>
      )}
      {tab === "feed" && (
        <>
          {setupStatus.hasKey && setupStatus.hasProfile && (
            <div style={{ marginBottom: "12px" }}>
              <button
                onClick={handleRunWeeklyReport}
                disabled={runningReport}
                style={{
                  width: "100%", padding: "10px 14px",
                  background: runningReport ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
                  border: "none", borderRadius: "10px", color: "#FFF",
                  fontSize: "13px", fontWeight: 700,
                  cursor: runningReport ? "wait" : "pointer",
                  opacity: runningReport ? 0.5 : 1,
                }}
              >
                {runningReport ? "⏳ Generazione report…" : "📊 Genera report settimanale ora"}
              </button>
              {reportMsg && (
                <div style={{
                  marginTop: "8px", fontSize: "12px",
                  color: reportMsg.startsWith("✓") ? "#22C55E" : reportMsg.startsWith("✗") ? "#EF4444" : "#94A3B8",
                }}>{reportMsg}</div>
              )}
            </div>
          )}
          <CoachFeedList />
        </>
      )}
      {tab === "chat" && <CoachChat />}
    </div>
  );
}
