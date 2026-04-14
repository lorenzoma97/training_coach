import { useEffect, useState } from "react";
import DiaryApp from "./components/DiaryApp";
import CoachPage from "./pages/CoachPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import ProactiveFeedback from "./components/ProactiveFeedback";
import { getJSON, setJSON } from "./lib/storage";
import { maybeRunWeeklyReport } from "./lib/scheduler";
import type { CoachFeedItem } from "./lib/types";
import { useOnline } from "./lib/useOnline";
import { events } from "./lib/events";

type Tab = "diary" | "coach" | "settings";
const LAST_SEEN_KEY = "coach-feed-last-seen";

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("diary");
  const [unreadCoach, setUnreadCoach] = useState(0);
  const online = useOnline();

  useEffect(() => {
    (async () => {
      const done = await getJSON<boolean>("onboarding-completed", false);
      setOnboarded(done);
    })();
  }, []);

  useEffect(() => {
    if (onboarded) {
      maybeRunWeeklyReport().catch(console.error);
    }
  }, [onboarded]);

  // Conta feed non letti (item con date > last-seen)
  const refreshUnread = async () => {
    const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
    const lastSeen = (await getJSON<string>(LAST_SEEN_KEY, "")) || "";
    const unread = feed.filter(i => !i.dismissed && i.date > lastSeen).length;
    setUnreadCoach(unread);
  };

  useEffect(() => {
    refreshUnread();
    const id = setInterval(refreshUnread, 4000);
    const off = events.on("plan:updated", refreshUnread);
    return () => { clearInterval(id); off(); };
  }, []);

  // Quando si apre il tab Coach, segna tutto come "letto"
  useEffect(() => {
    if (tab === "coach") {
      setJSON(LAST_SEEN_KEY, new Date().toISOString()).then(refreshUnread);
    }
  }, [tab]);

  // Deep link dal Piano coach → form "Aggiungi sessione" nel Diario
  useEffect(() => {
    const off = events.on("diary:openAdd", () => setTab("diary"));
    return off;
  }, []);

  // Navigazione globale tra tab (es. da CoachPage "vai a Impostazioni")
  useEffect(() => {
    const off = events.on("nav:goto", ({ tab }) => setTab(tab));
    return off;
  }, []);

  // Richiesta di riprendere onboarding (da CoachPage se setup incompleto)
  useEffect(() => {
    const off = events.on("onboarding:resume", async () => {
      await setJSON("onboarding-completed", false);
      setOnboarded(false);
    });
    return off;
  }, []);

  if (onboarded === null) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#94A3B8" }}>Caricamento…</div>;
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

      {/* Banner offline globale */}
      {!online && (
        <div role="status" style={{
          position: "sticky", top: 0, zIndex: 60,
          background: "#78350F", color: "#FEF3C7",
          padding: "8px 16px", fontSize: "13px", fontWeight: 600,
          textAlign: "center", borderBottom: "1px solid #92400E",
        }}>
          📡 Offline — diario disponibile, coach richiede connessione
        </div>
      )}

      <div className="page-pad-bottom">
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
        padding: "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))",
        display: "flex", gap: "6px", justifyContent: "center",
      }}>
        <div style={{ display: "flex", gap: "6px", maxWidth: "560px", width: "100%" }}>
          {([
            { id: "diary" as const, label: "Diario", emoji: "📓", badge: 0 },
            { id: "coach" as const, label: "Coach", emoji: "🎯", badge: unreadCoach },
            { id: "settings" as const, label: "Impostazioni", emoji: "⚙", badge: 0 },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-label={t.label}
              aria-current={tab === t.id ? "page" : undefined}
              style={{
                flex: 1, padding: "10px 8px", background: tab === t.id ? "#16213E" : "transparent",
                border: "none", borderRadius: "10px",
                color: tab === t.id ? "#E2E8F0" : "#94A3B8",
                fontSize: "11px", fontWeight: 700, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                position: "relative", minHeight: "52px",
              }}>
              <span style={{ fontSize: "20px", lineHeight: 1 }}>{t.emoji}</span>
              <span>{t.label}</span>
              {t.badge > 0 && (
                <span aria-label={`${t.badge} nuovi`} style={{
                  position: "absolute", top: "4px", right: "calc(50% - 22px)",
                  background: "#E8553A", color: "#FFF",
                  minWidth: "18px", height: "18px", padding: "0 5px",
                  borderRadius: "9px", fontSize: "10px", fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                }}>{t.badge > 9 ? "9+" : t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
