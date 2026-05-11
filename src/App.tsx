import { useEffect, useState } from "react";
import DiaryApp from "./components/DiaryApp";
import CoachPage from "./pages/CoachPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import TrendsPage from "./pages/TrendsPage";
import ProactiveFeedback from "./components/ProactiveFeedback";
import ErrorBoundary from "./components/ErrorBoundary";
import OfflineBanner from "./components/OfflineBanner";
import PwaInstallBanner from "./components/PwaInstallBanner";
import { NotificationHost, useNotify } from "./components/Notification";
import { getJSON, setJSON, safeBool } from "./lib/storage";
import { maybeRunWeeklyReport } from "./lib/scheduler";
import { maybePromoteNextPlan } from "./lib/coach/planHistory";
import type { CoachFeedItem } from "./lib/types";
import { events } from "./lib/events";
import { checkPendingRestore, clearPendingRestoreFlag } from "./lib/backup";

type Tab = "diary" | "trends" | "coach" | "settings";
const LAST_SEEN_KEY = "coach-feed-last-seen";

// Wrapper top-level: NotificationHost fornisce il context per tutti i
// componenti che usano useNotify(). Tenere qui (e non dentro AppShell)
// evita che la rimozione di toast causi re-mount dei children.
export default function App() {
  return (
    <NotificationHost>
      <AppShell />
    </NotificationHost>
  );
}

function AppShell() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("diary");
  const [unreadCoach, setUnreadCoach] = useState(0);
  const { notify } = useNotify();

  // Toast globali per eventi di sistema (migrazione modello, fallback LLM).
  // Usa NotificationHost unificato invece di stack bespoke.
  useEffect(() => {
    const offMig = events.on("llm:migrated", p => {
      notify({
        tone: "info",
        title: "Modello migrato",
        message: `Modello ${p.fromModelId} deprecato: migrato automaticamente a ${p.toModelId}.`,
      });
    });
    const offFb = events.on("llm:fallbackActivated", p => {
      notify({
        tone: "warning",
        title: "Fallback attivato",
        message: `Modello ${p.primary} momentaneamente occupato — uso ${p.fallback}.`,
      });
    });
    return () => { offMig(); offFb(); };
  }, [notify]);

  useEffect(() => {
    (async () => {
      const done = await getJSON<boolean>("onboarding-completed", false);
      setOnboarded(done);
      // All'avvio: se c'è un restore interrotto a metà da una sessione precedente
      // (sentinel 'restore-in-progress'), avverti l'utente. Non blocchiamo l'app —
      // la flag resta finché l'utente non agisce. Vedi backup.ts checkPendingRestore.
      try {
        const pending = await checkPendingRestore();
        if (pending.status === "interrupted") {
          const startedAt = pending.info?.startedAt || "(data sconosciuta)";
          const msg = `Un ripristino backup è stato interrotto (${startedAt}). I dati potrebbero essere incompleti — puoi ripetere il ripristino da Impostazioni quando vuoi.\n\nPremi OK per chiudere questo avviso.`;
          // alert() anziché confirm() perché l'azione è singola (dismissal).
          // Cancelliamo la flag in OGNI caso (niente branch Annulla) così
          // il banner non riappare ad ogni reload (risolto loop).
          alert(msg);
          await clearPendingRestoreFlag();
        }
      } catch (e) {
        console.warn("[App] checkPendingRestore failed:", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (onboarded) {
      maybeRunWeeklyReport().catch(e => console.error("[scheduler] weekly", e));
      // Auto-promote del piano "preview" della settimana prossima → se la sua
      // startDate <= oggi, sostituisce il piano corrente (archiviando il vecchio).
      // Eseguito qui (App mount) così avviene anche se l'utente non apre il
      // tab Coach (es. apre l'app per un check rapido del diario).
      maybePromoteNextPlan().catch(e => console.error("[promote-next-plan]", e));
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
    // Debounce su refreshUnread: events + polling + plan:updated possono
    // triggerare molte chiamate ravvicinate (es. cross-tab save emette
    // contemporaneamente "data:externalChange" E "plan:updated"). Un singolo
    // setTimeout collassa le chiamate entro 200ms → una sola read storage.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshDebounced = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void refreshUnread(); }, 200);
    };
    void refreshUnread();
    // 15s fallback: il cross-tab polling via storage-event già copre le modifiche
    // live, ma alcuni browser droppano storage events in alcuni scenari (es. quota
    // eventi privacy). Questo interval è la safety net di ultima istanza.
    const id = setInterval(refreshDebounced, 15000);
    const off = events.on("plan:updated", refreshDebounced);
    const offExt = events.on("data:externalChange", ({ key }) => {
      if (key === "coach-feed" || key === "coach-feed-last-seen") refreshDebounced();
    });
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(id); off(); offExt();
    };
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

  // Cross-tab sync: ascolta modifiche a localStorage da altre tab/finestre.
  // Il browser emette `storage` event SOLO in tab diverse da quella che ha scritto.
  // Inoltra al bus eventi interno per permettere ai componenti di reagire.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return; // e.key null = localStorage.clear() — ignoriamo (raro)
      events.emit("data:externalChange", { key: e.key });

      // Re-emette eventi di dominio per componenti che già li ascoltano
      if (e.key === "training-plan") {
        events.emit("plan:updated", { at: new Date().toISOString() });
      } else if (e.key === "user-profile") {
        events.emit("profile:updated", { at: new Date().toISOString() });
      } else if (e.key === "user-goals") {
        events.emit("goals:updated", { at: new Date().toISOString() });
      } else if (e.key === "onboarding-completed") {
        // Aggiorna stato onboarded (se altra tab completa/reset)
        // safeBool gestisce valori non-JSON (es. stringa "true" letterale da
        // tab esterno) senza crashare. JSON.parse diretto qui rompeva App
        // all'arrivo di un valore inatteso cross-tab.
        let done: unknown = false;
        try { done = e.newValue ? JSON.parse(e.newValue) : false; } catch { done = e.newValue; }
        setOnboarded(safeBool(done));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (onboarded === null) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#94A3B8" }}>Caricamento…</div>;
  }

  if (!onboarded) {
    return (
      <>
        <ProactiveFeedback />
        <OfflineBanner />
        <OnboardingWizard onDone={() => setOnboarded(true)} />
        <PwaInstallBanner />
      </>
    );
  }

  return (
    <>
      <ProactiveFeedback />

      {/* Banner offline globale (gestisce internamente useOnline) */}
      <OfflineBanner />

      {/* Install PWA prompt (iOS Safari istruzioni / Android Chrome beforeinstallprompt) */}
      <PwaInstallBanner />

      <div className="page-pad-bottom">
        {/* Un ErrorBoundary per pagina: un crash nel Coach non deve abbattere
            il menu di navigazione, l'utente può passare ad altra tab. */}
        {tab === "diary" && (
          <ErrorBoundary label="DiaryApp"><DiaryApp /></ErrorBoundary>
        )}
        {tab === "trends" && (
          <ErrorBoundary label="TrendsPage"><TrendsPage /></ErrorBoundary>
        )}
        {tab === "coach" && (
          <ErrorBoundary label="CoachPage"><CoachPage /></ErrorBoundary>
        )}
        {tab === "settings" && (
          <ErrorBoundary label="SettingsPage">
            <SettingsPage onResetOnboarding={() => setOnboarded(false)} />
          </ErrorBoundary>
        )}
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
            { id: "trends" as const, label: "Trend", emoji: "📈", badge: 0 },
            { id: "coach" as const, label: "Coach", emoji: "🎯", badge: unreadCoach },
            { id: "settings" as const, label: "Impost.", emoji: "⚙", badge: 0 },
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
                  position: "absolute", top: "2px", right: "calc(50% - 24px)",
                  background: "#E8553A", color: "#FFF",
                  minWidth: "20px", height: "20px", padding: "0 6px",
                  borderRadius: "10px", fontSize: "11px", fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                  lineHeight: 1,
                }}>{t.badge > 9 ? "9+" : t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
