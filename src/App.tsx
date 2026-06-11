import { useEffect, useState } from "react";
import DiaryApp from "./components/DiaryApp";
import TodayPage from "./pages/TodayPage";
import PlanPage from "./pages/PlanPage";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import TrendsPage from "./pages/TrendsPage";
import BottomSheet from "./components/ui/sheet";
import { Home, CalendarRange, Plus, BookOpen, TrendingUp, Dumbbell, ClipboardCheck } from "lucide-react";
import ProactiveFeedback from "./components/ProactiveFeedback";
import ErrorBoundary from "./components/ErrorBoundary";
import OfflineBanner from "./components/OfflineBanner";
import PwaInstallBanner from "./components/PwaInstallBanner";
import LoadingSpinner from "./components/LoadingSpinner";
import { NotificationHost, useNotify } from "./components/Notification";
import { getJSON, setJSON, safeBool } from "./lib/storage";
import { maybeRunWeeklyReport } from "./lib/scheduler";
import { maybePromoteNextPlan } from "./lib/coach/planHistory";
import type { CoachFeedItem } from "./lib/types";
import { events } from "./lib/events";
import { checkPendingRestore, clearPendingRestoreFlag } from "./lib/backup";

// P1 nav piatta (2026-06-11): Oggi è la home; Coach come contenitore è smontato.
// "chat" e "settings" sono navigabili ma fuori dalla bottom nav (header icons).
type Tab = "today" | "plan" | "diary" | "trends" | "chat" | "settings";
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
  const [tab, setTab] = useState<Tab>("today");
  const [unreadCoach, setUnreadCoach] = useState(0);
  // Sheet del "+" centrale: registra allenamento / check giornaliero.
  const [addOpen, setAddOpen] = useState(false);
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

  // Il feed coach vive in Oggi e la chat è pagina dedicata: aprirle = "letto".
  useEffect(() => {
    if (tab === "today" || tab === "chat") {
      setJSON(LAST_SEEN_KEY, new Date().toISOString()).then(refreshUnread);
    }
  }, [tab]);

  // Deep link dal Piano coach → form "Aggiungi sessione" nel Diario
  useEffect(() => {
    const off = events.on("diary:openAdd", () => setTab("diary"));
    return off;
  }, []);

  // Navigazione globale tra tab. "coach" è alias legacy → home (Oggi):
  // gli emitter esistenti (TrainingPlanView, RaceCalendar) continuano a funzionare.
  useEffect(() => {
    const off = events.on("nav:goto", ({ tab }) => {
      setTab(tab === "coach" ? "today" : tab);
    });
    return off;
  }, []);

  // "Chiedi al coach" apre la pagina Chat (prima switchava il sub-tab interno).
  useEffect(() => {
    const off = events.on("chat:openWith", () => setTab("chat"));
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
    // Boot iniziale: legge flag onboarding da storage (~ms su mobile). Spinner
    // helper invece di stringa testuale per coerenza visuale con resto app.
    return (
      <div style={{ padding: "40px" }}>
        <LoadingSpinner variant="block" label="Caricamento…" data-testid="app-boot-loading" />
      </div>
    );
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

      {/* key={tab} rimonta il wrapper al cambio tab → riparte l'animazione pageIn. */}
      <div key={tab} className="page-pad-bottom page-enter">
        {/* Un ErrorBoundary per pagina: un crash in una pagina non deve abbattere
            il menu di navigazione, l'utente può passare ad altra tab. */}
        {tab === "today" && (
          <ErrorBoundary label="TodayPage"><TodayPage unreadChat={unreadCoach} /></ErrorBoundary>
        )}
        {tab === "plan" && (
          <ErrorBoundary label="PlanPage"><PlanPage /></ErrorBoundary>
        )}
        {tab === "diary" && (
          <ErrorBoundary label="DiaryApp"><DiaryApp /></ErrorBoundary>
        )}
        {tab === "trends" && (
          <ErrorBoundary label="TrendsPage"><TrendsPage /></ErrorBoundary>
        )}
        {tab === "chat" && (
          <ErrorBoundary label="ChatPage"><ChatPage /></ErrorBoundary>
        )}
        {tab === "settings" && (
          <ErrorBoundary label="SettingsPage">
            <SettingsPage onResetOnboarding={() => setOnboarded(false)} />
          </ErrorBoundary>
        )}
      </div>

      {/* Sheet del "+" centrale: l'azione primaria globale (registra). */}
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Registra">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={() => { setAddOpen(false); setTab("diary"); events.emit("diary:openNew", {}); }}
            style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "14px", minHeight: "56px",
              background: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
              border: "none", borderRadius: "14px",
              color: "#052E2A", fontSize: "15px", fontWeight: 800, cursor: "pointer",
            }}
          >
            <Dumbbell size={20} /> Allenamento
          </button>
          <button
            onClick={() => { setAddOpen(false); setTab("diary"); events.emit("diary:openDaily", {}); }}
            style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "14px", minHeight: "56px",
              background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "14px",
              color: "#E2E8F0", fontSize: "15px", fontWeight: 700, cursor: "pointer",
            }}
          >
            <ClipboardCheck size={20} /> Check giornaliero
          </button>
        </div>
      </BottomSheet>

      {/* Bottom nav piatta: Oggi · Piano · [+] · Diario · Trend */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
        background: "rgba(11, 15, 26, 0.92)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "8px 12px calc(8px + env(safe-area-inset-bottom, 0px))",
        display: "flex", gap: "4px", justifyContent: "center",
      }}>
        <div style={{ display: "flex", gap: "4px", maxWidth: "560px", width: "100%", alignItems: "center" }}>
          {([
            { id: "today" as const, label: "Oggi", Icon: Home },
            { id: "plan" as const, label: "Piano", Icon: CalendarRange },
          ]).map(t => (
            <NavButton key={t.id} active={tab === t.id} label={t.label} Icon={t.Icon} onClick={() => setTab(t.id)} />
          ))}
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Registra allenamento o check"
            style={{
              width: "52px", height: "52px", flexShrink: 0,
              margin: "0 4px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
              border: "none", borderRadius: "16px",
              color: "#052E2A", cursor: "pointer",
              boxShadow: "0 4px 14px rgba(20,184,166,0.35)",
            }}
          >
            <Plus size={24} strokeWidth={2.5} />
          </button>
          {([
            { id: "diary" as const, label: "Diario", Icon: BookOpen },
            { id: "trends" as const, label: "Trend", Icon: TrendingUp },
          ]).map(t => (
            <NavButton key={t.id} active={tab === t.id} label={t.label} Icon={t.Icon} onClick={() => setTab(t.id)} />
          ))}
        </div>
      </nav>
    </>
  );
}

function NavButton({ active, label, Icon, onClick }: {
  active: boolean;
  label: string;
  Icon: typeof Home;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-label={label} aria-current={active ? "page" : undefined}
      style={{
        flex: 1, padding: "8px 4px", background: "transparent",
        border: "none", borderRadius: "10px",
        color: active ? "#14B8A6" : "#94A3B8",
        fontSize: "10px", fontWeight: 700, cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
        minHeight: "52px", transition: "color 150ms ease-out",
      }}>
      <Icon size={21} strokeWidth={active ? 2.4 : 2} />
      <span>{label}</span>
    </button>
  );
}
