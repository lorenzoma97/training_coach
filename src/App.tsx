import { useEffect, useState } from "react";
import DiaryApp from "./components/DiaryApp";
import CoachPage from "./pages/CoachPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import ProactiveFeedback from "./components/ProactiveFeedback";
import { getJSON } from "./lib/storage";
import { maybeRunWeeklyReport } from "./lib/scheduler";

type Tab = "diary" | "coach" | "settings";

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("diary");

  useEffect(() => {
    (async () => {
      const done = await getJSON<boolean>("onboarding-completed", false);
      setOnboarded(done);
    })();
  }, []);

  // Weekly report check on app open
  useEffect(() => {
    if (onboarded) {
      maybeRunWeeklyReport().catch(console.error);
    }
  }, [onboarded]);

  if (onboarded === null) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>Caricamento…</div>;
  }

  if (!onboarded) {
    return (
      <>
        <ProactiveFeedback />
        <OnboardingWizard onDone={() => setOnboarded(true)} />
      </>
    );
  }

  return (
    <>
      <ProactiveFeedback />
      <div style={{ paddingBottom: "70px" }}>
        {tab === "diary" && <DiaryApp />}
        {tab === "coach" && <CoachPage />}
        {tab === "settings" && <SettingsPage onResetOnboarding={() => setOnboarded(false)} />}
      </div>

      {/* Bottom nav */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
        background: "rgba(11, 15, 26, 0.92)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "10px 12px calc(10px + env(safe-area-inset-bottom))",
        display: "flex", gap: "6px", justifyContent: "center",
      }}>
        <div style={{ display: "flex", gap: "6px", maxWidth: "560px", width: "100%" }}>
          {([
            { id: "diary" as const, label: "Diario", emoji: "📓" },
            { id: "coach" as const, label: "Coach", emoji: "🎯" },
            { id: "settings" as const, label: "Impostazioni", emoji: "⚙" },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "10px", background: tab === t.id ? "#16213E" : "transparent",
              border: "none", borderRadius: "10px",
              color: tab === t.id ? "#E2E8F0" : "#64748B",
              fontSize: "11px", fontWeight: 700, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
            }}>
              <span style={{ fontSize: "18px" }}>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
