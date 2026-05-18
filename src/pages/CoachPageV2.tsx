// CoachPageV2 (2026-05-18 — opt-in beta via Settings toggle).
// Today-first dashboard. 4 tab vs 6 di V1.
// Coexists con CoachPage V1 (default). Routing in App.tsx legge flag.
//
// Design (da audit architectural review):
//   1. 🏠 Oggi  — status dashboard (readiness, CTL/ATL/TSB, sessione oggi, alert)
//   2. 📅 Piano — riusa TrainingPlanView V1 invariato
//   3. 💬 Chat  — riusa CoachChat V1 invariato
//   4. 📊 Tools — collapsibles: Zone FC, Obiettivi, Feed, Warm-up, Diagnostica

import { useEffect, useState } from "react";
import TrainingPlanView from "../components/TrainingPlanView";
import CoachFeedList from "../components/CoachFeedList";
import CoachChat from "../components/CoachChat";
import GoalsEditor from "../components/GoalsEditor";
import ZonesCard from "../components/ZonesCard";
import ZonesAnalytics from "../components/ZonesAnalytics";
import FCMaxTestSection from "../components/FCMaxTestSection";
import LTThresholdSection from "../components/LTThresholdSection";
import MobilityLibrary from "../components/mobility/MobilityLibrary";
import PlanDiagnosticPanel from "../components/PlanDiagnosticPanel";
import { getJSON } from "../lib/storage";
import type { UserProfile, TrainingPlan } from "../lib/types";
import { events } from "../lib/events";
import { getLastNDays } from "../lib/diaryContext";
import { getCurrentReadiness } from "../lib/coach/readinessScoring";
import {
  aggregateDailyLoad,
  computeTrainingLoad,
  type TrainingLoadSnapshot,
} from "../lib/coach/trainingLoad";
import { loadDiagnostic, type PlanDiagnostic } from "../lib/coach/planDiagnostic";

type Tab = "today" | "plan" | "chat" | "tools";

const DAY_LABELS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;
function todayLabel(): string {
  const dow = new Date().getDay();
  return DAY_LABELS[(dow + 6) % 7];
}

// ─── Tab "Oggi" data hooks ─────────────────────────────────────────────────

interface TodayState {
  readiness: Awaited<ReturnType<typeof getCurrentReadiness>>;
  load: TrainingLoadSnapshot | null;
  todaySession: TrainingPlan["weeks"][number]["sessions"][number] | null;
  diagnostic: PlanDiagnostic | null;
  loaded: boolean;
}

function useTodayState(refreshKey: number): TodayState {
  const [s, setS] = useState<TodayState>({
    readiness: null, load: null, todaySession: null, diagnostic: null, loaded: false,
  });
  useEffect(() => {
    (async () => {
      const [readiness, plan, recentDays, diagnostic] = await Promise.all([
        getCurrentReadiness().catch(() => null),
        getJSON<TrainingPlan | null>("training-plan", null),
        getLastNDays(60).catch(() => []),
        loadDiagnostic().catch(() => null),
      ]);
      // Training load: estrai sRPE + duration dai workout, aggrega per giorno
      type RawWk = { fields?: { rpe?: number | string; durata_totale?: number | string; durata?: number | string } };
      const workoutsForLoad: Array<{ date: string; sRPE?: number; durationMin?: number }> = [];
      for (const d of recentDays) {
        for (const w of d.workouts || []) {
          const f = (w as RawWk)?.fields ?? {};
          const rpeNum = Number(f.rpe);
          const durNum = Number(f.durata_totale ?? f.durata);
          workoutsForLoad.push({
            date: d.date,
            sRPE: Number.isFinite(rpeNum) && rpeNum > 0 ? rpeNum : undefined,
            durationMin: Number.isFinite(durNum) && durNum > 0 ? durNum : undefined,
          });
        }
      }
      const load = computeTrainingLoad(aggregateDailyLoad(workoutsForLoad));
      const today = todayLabel();
      const todaySession = plan?.weeks?.[0]?.sessions.find(x => x.day === today) ?? null;
      setS({ readiness, load, todaySession, diagnostic, loaded: true });
    })();
  }, [refreshKey]);
  return s;
}

// ─── Style helpers (dark theme, mobile-first 390) ──────────────────────────

const cardStyle: React.CSSProperties = {
  background: "#16213E",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px",
  padding: "14px 16px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "10px", color: "#64748B", fontWeight: 700,
  letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "6px",
};

const valueStyle: React.CSSProperties = {
  fontSize: "20px", fontWeight: 800, color: "#E2E8F0",
  fontFamily: "'JetBrains Mono', monospace",
};

const READINESS_META: Record<string, { color: string; label: string }> = {
  low: { color: "#EF4444", label: "BASSA" },
  moderate: { color: "#F59E0B", label: "MEDIA" },
  high: { color: "#22C55E", label: "ALTA" },
};

const TSB_BAND_META: Record<TrainingLoadSnapshot["band"], { color: string; label: string; copy: string }> = {
  overreach_risk: { color: "#EF4444", label: "OVERREACH RISK", copy: "riduci immediatamente carico" },
  fatigued: { color: "#F59E0B", label: "FATICATO", copy: "consolida, riduci 15-25%" },
  training: { color: "#0891B2", label: "TRAINING", copy: "carico normale" },
  fresh: { color: "#22C55E", label: "FRESCO", copy: "pronto per sessione hard" },
  peaked: { color: "#22C55E", label: "PEAKED", copy: "forma top" },
  detraining: { color: "#94A3B8", label: "DETRAINING", copy: "ripresa graduale" },
};

// ─── Tab "Oggi" ────────────────────────────────────────────────────────────

function TodayTab({ onGoToPlan }: { onGoToPlan: () => void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const off = events.on("plan:updated", () => setRefreshKey(k => k + 1));
    return () => { off(); };
  }, []);
  const s = useTodayState(refreshKey);

  if (!s.loaded) {
    return <div style={{ color: "#94A3B8", fontSize: "13px", textAlign: "center", padding: "40px 20px" }}>Caricamento…</div>;
  }

  // ─── Alert aggregation ──────────────────────────────────────────────────
  const alerts: Array<{ kind: "warn" | "danger"; text: string }> = [];
  if (s.readiness?.band === "low") {
    alerts.push({ kind: "warn", text: "Readiness BASSA oggi — preferisci Z1-Z2, evita Z4-Z5" });
  }
  if (s.load?.band === "overreach_risk") {
    alerts.push({ kind: "danger", text: `TSB ${s.load.tsb} = overreach risk — riduci immediatamente carico` });
  } else if (s.load?.band === "fatigued") {
    alerts.push({ kind: "warn", text: `Fatica accumulata (TSB ${s.load.tsb}) — consolida questa settimana` });
  }
  if (s.diagnostic && s.diagnostic.result.deltaPctVsTarget < -20) {
    alerts.push({ kind: "warn", text: `Ultimo piano sotto target del ${s.diagnostic.result.deltaPctVsTarget}% — controlla Diagnostica in Tools` });
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Alert section */}
      {alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              background: a.kind === "danger" ? "#EF444415" : "#F59E0B15",
              border: `1px solid ${a.kind === "danger" ? "#EF444466" : "#F59E0B66"}`,
              borderRadius: "10px",
              padding: "10px 12px",
              fontSize: "12px",
              color: a.kind === "danger" ? "#EF4444" : "#F59E0B",
              fontWeight: 600,
              lineHeight: 1.4,
            }}>
              {a.kind === "danger" ? "🚨 " : "⚠ "}{a.text}
            </div>
          ))}
        </div>
      )}

      {/* Stato corpo */}
      <div style={cardStyle}>
        <div style={labelStyle}>Stato corpo</div>
        {s.readiness ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
            <span style={{
              ...valueStyle,
              color: READINESS_META[s.readiness.band]?.color ?? "#E2E8F0",
            }}>
              {READINESS_META[s.readiness.band]?.label ?? s.readiness.band.toUpperCase()}
            </span>
            <span style={{ fontSize: "12px", color: "#94A3B8" }}>
              readiness score {Math.round(s.readiness.score)}/100
            </span>
          </div>
        ) : (
          <div style={{ fontSize: "12px", color: "#94A3B8" }}>
            Nessun check oggi — registra un daily check per ricevere readiness.
          </div>
        )}
      </div>

      {/* Carico settimanale */}
      <div style={cardStyle}>
        <div style={labelStyle}>Carico settimanale (TrainingPeaks PMC)</div>
        {s.load && s.load.daysUsed >= 14 ? (
          <>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "6px" }}>
              <div>
                <div style={{ fontSize: "10px", color: "#64748B" }}>ATL (7gg)</div>
                <div style={{ ...valueStyle, fontSize: "16px" }}>{s.load.atl}</div>
              </div>
              <div>
                <div style={{ fontSize: "10px", color: "#64748B" }}>CTL (42gg)</div>
                <div style={{ ...valueStyle, fontSize: "16px" }}>{s.load.ctl}</div>
              </div>
              <div>
                <div style={{ fontSize: "10px", color: "#64748B" }}>TSB</div>
                <div style={{ ...valueStyle, fontSize: "16px", color: TSB_BAND_META[s.load.band].color }}>
                  {s.load.tsb >= 0 ? "+" : ""}{s.load.tsb}
                </div>
              </div>
            </div>
            <div style={{
              fontSize: "11px",
              color: TSB_BAND_META[s.load.band].color,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              {TSB_BAND_META[s.load.band].label} · <span style={{ color: "#94A3B8", fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>{TSB_BAND_META[s.load.band].copy}</span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: "12px", color: "#94A3B8" }}>
            Servono ≥14 giorni di workout tracciati per CTL/ATL/TSB.
          </div>
        )}
      </div>

      {/* Sessione di oggi */}
      <div style={cardStyle}>
        <div style={labelStyle}>Sessione di oggi ({todayLabel()})</div>
        {s.todaySession ? (
          <>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
              {s.todaySession.type}{s.todaySession.subtype ? ` · ${s.todaySession.subtype}` : ""}
              {s.todaySession.zone ? ` · Z${s.todaySession.zone}` : ""}
            </div>
            <div style={{ fontSize: "13px", color: "#94A3B8", marginBottom: "10px" }}>
              {s.todaySession.duration_min} min
            </div>
            <button
              onClick={onGoToPlan}
              style={{
                padding: "10px 14px",
                background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
                border: "none", borderRadius: "10px",
                color: "#FFF", fontSize: "13px", fontWeight: 700, cursor: "pointer",
              }}
            >
              Vai al piano →
            </button>
          </>
        ) : (
          <div style={{ fontSize: "12px", color: "#94A3B8" }}>
            Riposo programmato oggi 🛌 — o nessun piano attivo.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab "Tools" (collapsibles) ────────────────────────────────────────────

const sectionDetailsStyle: React.CSSProperties = {
  background: "#16213E",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px",
  overflow: "hidden",
};
const sectionSummaryStyle: React.CSSProperties = {
  cursor: "pointer", listStyle: "none",
  padding: "14px 18px", minHeight: "44px",
  fontSize: "12px", color: "#94A3B8", fontWeight: 700,
  letterSpacing: "0.12em", textTransform: "uppercase",
  display: "flex", alignItems: "center", gap: "8px",
};

function ToolsTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle}><span style={{ flex: 1 }}>📊 Zone FC</span></summary>
        <div style={{ padding: "0 16px 16px" }}>
          <ZonesCard />
          <div style={{ height: "12px" }} />
          <ZonesAnalytics />
          <div style={{ height: "12px" }} />
          <FCMaxTestSection />
          <div style={{ height: "12px" }} />
          <LTThresholdSection />
        </div>
      </details>

      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle}><span style={{ flex: 1 }}>🎯 Obiettivi (sola lettura — modifica in Settings)</span></summary>
        <div style={{ padding: "0 16px 16px" }}>
          <GoalsEditor variant="full" />
        </div>
      </details>

      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle}><span style={{ flex: 1 }}>📬 Feed coach</span></summary>
        <div style={{ padding: "0 16px 16px" }}>
          <CoachFeedList />
        </div>
      </details>

      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle}><span style={{ flex: 1 }}>🧘 Warm-up library</span></summary>
        <div style={{ padding: "0 16px 16px" }}>
          <MobilityLibrary />
        </div>
      </details>

      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle}><span style={{ flex: 1 }}>🔍 Diagnostica ultima rigenerazione</span></summary>
        <div style={{ padding: "0 16px 16px" }}>
          <PlanDiagnosticPanel />
        </div>
      </details>
    </div>
  );
}

// ─── Root CoachPageV2 ──────────────────────────────────────────────────────

export default function CoachPageV2() {
  const [tab, setTab] = useState<Tab>("today");
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    (async () => {
      const p = await getJSON<UserProfile | null>("user-profile", null);
      setProfile(p);
    })();
  }, []);

  if (!profile) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "#94A3B8" }}>
        Completa l'onboarding per usare il coach.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Tab bar 4 tab */}
      <div role="tablist" style={{
        display: "flex", gap: "4px",
        background: "#1A1A2E", padding: "4px", borderRadius: "12px",
        position: "sticky", top: "0", zIndex: 20,
        boxShadow: "0 2px 12px rgba(11,15,26,0.65)",
        overflowX: "auto",
      }}>
        {([
          { id: "today" as const, label: "🏠 Oggi" },
          { id: "plan" as const, label: "📅 Piano" },
          { id: "chat" as const, label: "💬 Chat" },
          { id: "tools" as const, label: "📊 Tools" },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            style={{
              flex: 1, minWidth: "70px",
              padding: "10px 8px", borderRadius: "8px",
              background: tab === t.id ? "#16213E" : "transparent",
              border: "none",
              color: tab === t.id ? "#E2E8F0" : "#94A3B8",
              fontSize: "12px", fontWeight: 700, cursor: "pointer",
              minHeight: "44px", whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "today" && <TodayTab onGoToPlan={() => setTab("plan")} />}
      {tab === "plan" && <TrainingPlanView />}
      {tab === "chat" && <CoachChat />}
      {tab === "tools" && <ToolsTab />}
    </div>
  );
}
