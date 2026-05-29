// ProgramView (Sprint 4.2, 2026-05-26).
// Visualizzazione macroprogramma con timeline + week navigator + session cards.
// Pattern UX Op3 enhanced: focus su settimana corrente, navigazione fluida,
// drawer riferimenti accessibile in 1 click.

import { useMemo, useRef, useState } from "react";
import type { MacroProgram, MacroProgramSession, DayLabel } from "../../lib/types/macroprogram";
import { computeMacroProgress } from "../../lib/macroprogram/storage";
import { lookupExerciseHybrid } from "../../lib/macroprogram/customCatalog";
import { useSwipeNavigation } from "./useSwipeNavigation";
import ReferencesDrawer from "./ReferencesDrawer";
import { useModalBackButton } from "../../lib/useModalBackButton";

// ─── Phase color theme ────────────────────────────────────────────────────

const PHASE_COLORS = [
  { fg: "#22C55E", bg: "#22C55E22", border: "#22C55E66" }, // verde
  { fg: "#F97316", bg: "#F9731622", border: "#F9731666" }, // arancio
  { fg: "#EF4444", bg: "#EF444422", border: "#EF444466" }, // rosso
  { fg: "#0891B2", bg: "#0891B222", border: "#0891B266" }, // cyan
  { fg: "#A78BFA", bg: "#A78BFA22", border: "#A78BFA66" }, // viola
];

function phaseColorFor(phaseIdx: number) {
  return PHASE_COLORS[phaseIdx % PHASE_COLORS.length];
}

// ─── Styles base ──────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────

const DAY_ORDER: DayLabel[] = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

function sortSessionsByDay(sessions: MacroProgramSession[]): MacroProgramSession[] {
  return [...sessions].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
}

function phaseForWeek(program: MacroProgram, weekNum: number): { name: string; idx: number } | null {
  for (let i = 0; i < program.phases.length; i++) {
    const p = program.phases[i];
    const isRange = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1];
    if (isRange && weekNum >= p.weeks[0] && weekNum <= p.weeks[1]) {
      return { name: p.name, idx: i };
    }
    if (!isRange && p.weeks.includes(weekNum)) {
      return { name: p.name, idx: i };
    }
  }
  return null;
}

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────

export default function ProgramView({
  program, onClose,
}: {
  program: MacroProgram;
  onClose: () => void;
}) {
  const progress = useMemo(() => computeMacroProgress(program), [program]);
  const macroCurrentWeek = progress?.currentWeek ?? 1;
  const initialViewWeek = Math.max(1, Math.min(program.metadata.weeks_total, macroCurrentWeek));
  const [viewWeek, setViewWeek] = useState(initialViewWeek);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Sprint E: tasto indietro Android chiude ProgramView (montato = aperto).
  useModalBackButton(true, onClose);

  const swipeRef = useRef<HTMLDivElement>(null);
  useSwipeNavigation(
    swipeRef,
    () => setViewWeek(w => Math.min(program.metadata.weeks_total, w + 1)),
    () => setViewWeek(w => Math.max(1, w - 1)),
  );

  const currentPhase = phaseForWeek(program, viewWeek);
  const phaseDef = currentPhase ? program.phases[currentPhase.idx] : null;
  const phaseColor = currentPhase ? phaseColorFor(currentPhase.idx) : phaseColorFor(0);

  const weekData = program.weeks.find(w => w.week === viewWeek);
  const sortedSessions = weekData ? sortSessionsByDay(weekData.sessions) : [];

  const isViewingCurrent = viewWeek === macroCurrentWeek;
  const canPrev = viewWeek > 1;
  const canNext = viewWeek < program.metadata.weeks_total;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "#0B0F1A",
      display: "flex", flexDirection: "column",
      overflow: "auto",
    }}>
      {/* Header sticky */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 16px",
        background: "#16213E",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <button onClick={onClose} style={{
          background: "transparent", border: "none",
          color: "#94A3B8", fontSize: "13px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: "4px",
        }} aria-label="Chiudi programma">
          ← Indietro
        </button>
        <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Programma
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "8px", padding: "6px 10px",
            color: "#94A3B8", fontSize: "11px", fontWeight: 600, cursor: "pointer",
          }}
          aria-label="Apri riferimenti"
        >🔖 Riferimenti</button>
      </div>

      {/* Drawer riferimenti */}
      <ReferencesDrawer program={program} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Content */}
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* Title + meta */}
        <div style={cardStyle}>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "#E2E8F0", marginBottom: "4px" }}>
            {program.metadata.title}
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 }}>
            {program.metadata.sport} · {program.metadata.weeks_total} settimane · {program.phases.length} fasi · Obiettivo: {program.metadata.goal}
          </div>
        </div>

        {/* Timeline */}
        <ProgramTimeline
          program={program}
          viewWeek={viewWeek}
          macroCurrentWeek={macroCurrentWeek}
          onJumpToWeek={setViewWeek}
        />

        {/* Back to current badge */}
        {!isViewingCurrent && macroCurrentWeek >= 1 && macroCurrentWeek <= program.metadata.weeks_total && (
          <button
            onClick={() => setViewWeek(macroCurrentWeek)}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid #0891B266",
              borderRadius: "10px",
              color: "#0891B2",
              fontSize: "12px", fontWeight: 600,
              cursor: "pointer", alignSelf: "flex-start",
            }}
          >
            ↺ Torna a settimana corrente (S{macroCurrentWeek})
          </button>
        )}

        {/* Week navigator */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: "8px",
        }}>
          <button
            onClick={() => setViewWeek(w => w - 1)}
            disabled={!canPrev}
            style={{
              padding: "8px 12px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
              color: canPrev ? "#E2E8F0" : "#64748B",
              fontSize: "16px", cursor: canPrev ? "pointer" : "not-allowed",
              opacity: canPrev ? 1 : 0.4,
            }}
            aria-label="Settimana precedente"
          >‹</button>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0" }}>
              Settimana {viewWeek}{phaseDef ? ` — ${phaseDef.name}` : ""}
            </div>
            {phaseDef && (
              <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>
                {phaseDef.rpe_target_min && phaseDef.rpe_target_max
                  ? `RPE ${phaseDef.rpe_target_min}-${phaseDef.rpe_target_max}`
                  : "—"}
                {" · "}{sortedSessions.length} sedute
              </div>
            )}
          </div>
          <button
            onClick={() => setViewWeek(w => w + 1)}
            disabled={!canNext}
            style={{
              padding: "8px 12px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
              color: canNext ? "#E2E8F0" : "#64748B",
              fontSize: "16px", cursor: canNext ? "pointer" : "not-allowed",
              opacity: canNext ? 1 : 0.4,
            }}
            aria-label="Settimana successiva"
          >›</button>
        </div>

        {/* Week notes if present */}
        {weekData?.notes && (
          <div style={{
            ...cardStyle,
            background: `${phaseColor.bg}`,
            border: `1px solid ${phaseColor.border}`,
            padding: "10px 14px",
          }}>
            <div style={{ fontSize: "11px", color: phaseColor.fg, fontWeight: 700, marginBottom: "4px" }}>
              Note settimana
            </div>
            <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>
              {weekData.notes}
            </div>
          </div>
        )}

        {/* Sessions (swipeable) */}
        <div ref={swipeRef} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {sortedSessions.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: "center", color: "#94A3B8" }}>
              Nessuna sessione pianificata per questa settimana.
            </div>
          ) : (
            sortedSessions.map((s, i) => <SessionCard key={i} session={s} />)
          )}
        </div>

        {/* Footer hint swipe */}
        <div style={{ textAlign: "center", fontSize: "10px", color: "#64748B", padding: "8px 0" }}>
          ← Swipe per cambiare settimana →
        </div>
      </div>
    </div>
  );
}

// ─── ProgramTimeline ──────────────────────────────────────────────────────

function ProgramTimeline({
  program, viewWeek, macroCurrentWeek, onJumpToWeek,
}: {
  program: MacroProgram;
  viewWeek: number;
  macroCurrentWeek: number;
  onJumpToWeek: (w: number) => void;
}) {
  const weeks = Array.from({ length: program.metadata.weeks_total }, (_, i) => i + 1);
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>Timeline</div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "4px", padding: "4px 0",
      }}>
        {weeks.map(w => {
          const isPast = w < macroCurrentWeek;
          const isCurrent = w === macroCurrentWeek;
          const isViewing = w === viewWeek;
          const phase = phaseForWeek(program, w);
          const color = phase ? phaseColorFor(phase.idx) : { fg: "#64748B", bg: "#64748B22", border: "#64748B66" };
          return (
            <button
              key={w}
              onClick={() => onJumpToWeek(w)}
              aria-label={`Vai a settimana ${w}`}
              style={{
                width: "36px", height: "36px",
                borderRadius: "50%",
                background: isPast ? color.bg : (isCurrent ? color.fg : "transparent"),
                border: isViewing ? `2px solid #E8553A` : `1px solid ${color.border}`,
                color: isCurrent ? "#FFF" : color.fg,
                fontSize: "11px", fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: isCurrent ? "pulse 2s ease-in-out infinite" : undefined,
              }}
            >
              {isPast ? "✓" : w}
            </button>
          );
        })}
      </div>
      {/* Phase legend */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
        {program.phases.map((p, i) => {
          const c = phaseColorFor(i);
          const weeksLabel = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1]
            ? `S${p.weeks[0]}-${p.weeks[1]}`
            : `S${p.weeks.join("/")}`;
          return (
            <div key={i} style={{
              fontSize: "10px", color: c.fg, padding: "3px 8px",
              background: c.bg, border: `1px solid ${c.border}`, borderRadius: "999px",
              fontWeight: 600,
            }}>
              {p.name} ({weeksLabel})
            </div>
          );
        })}
      </div>
      <style>{`@keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }`}</style>
    </div>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────

function SessionCard({ session }: { session: MacroProgramSession }) {
  const [expanded, setExpanded] = useState(false);
  const typeIcon: Record<string, string> = {
    forza_gambe: "🏋",
    forza_upper: "💪",
    corsa: "🏃",
    sport: "⚽",
    mobilita: "🧘",
  };
  const icon = typeIcon[session.type] ?? "•";
  const totalItems = session.exercises.length + session.intervals.length;
  return (
    <div style={{ ...cardStyle, padding: "0", overflow: "hidden" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%", textAlign: "left",
          background: "transparent", border: "none",
          padding: "14px 16px", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
          color: "#E2E8F0",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>
            {session.day}
          </div>
          <div style={{ fontSize: "14px", fontWeight: 700 }}>
            {icon} {session.type.replace("_", " ")} <span style={{ color: "#94A3B8", fontWeight: 500 }}>· {session.duration_min} min</span>
          </div>
          {session.notes_text && (
            <div style={{ fontSize: "11px", color: "#64748B", marginTop: "4px", fontStyle: "italic" }}>
              {session.notes_text}
            </div>
          )}
        </div>
        <div style={{ fontSize: "16px", color: "#64748B" }}>{expanded ? "▴" : "▾"}</div>
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {session.setup_spatial && (
            <div style={{
              fontSize: "11px", color: "#94A3B8", lineHeight: 1.4,
              padding: "8px 10px", margin: "10px 0",
              background: "#0B0F1A", borderRadius: "8px",
            }}>
              📐 Setup: {session.setup_spatial}
            </div>
          )}

          {session.exercises.length > 0 && (
            <ol style={{ margin: "10px 0 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
              {session.exercises.map((ex, i) => {
                const catEx = lookupExerciseHybrid(ex.id);
                const name = ex.name ?? catEx?.name ?? ex.id;
                const repsStr = ex.reps_min === ex.reps_max ? `${ex.reps_min}` : `${ex.reps_min}-${ex.reps_max}`;
                const load = ex.rpe_target ? `RPE ${ex.rpe_target}` : "";
                return (
                  <li key={i} style={{
                    background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "8px", padding: "10px 12px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0" }}>
                        {i + 1}. {name}
                      </div>
                      <div style={{ fontSize: "11px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
                        {ex.sets} × {repsStr}{load ? ` @ ${load}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748B", marginTop: "4px" }}>
                      Recupero {ex.rest_sec}s
                      {ex.tempo_eccentrico_sec ? ` · ${ex.tempo_eccentrico_sec}s discesa` : ""}
                      {ex.pause_sec ? ` · pausa ${ex.pause_sec}s` : ""}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {session.intervals.length > 0 && (
            <ol style={{ margin: "10px 0 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
              {session.intervals.map((iv, i) => {
                const kindLabel = iv.kind === "warmup" ? "Warm-up"
                  : iv.kind === "main" ? "Main"
                  : iv.kind === "cooldown" ? "Cool-down"
                  : iv.kind === "repetition" ? "Ripetuta"
                  : "Recovery";
                const measure = iv.distance_km ? `${iv.distance_km}km` : iv.duration_min ? `${iv.duration_min}min` : "—";
                const repBit = iv.reps ? `${iv.reps}× ${measure}` : measure;
                return (
                  <li key={i} style={{
                    background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "8px", padding: "8px 12px",
                    display: "flex", justifyContent: "space-between", gap: "8px",
                  }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#0891B2" }}>{kindLabel}</span>
                    <span style={{ fontSize: "12px", color: "#E2E8F0", fontFamily: "'JetBrains Mono', monospace" }}>
                      {repBit}{iv.zone ? ` · Z${iv.zone}` : ""}{iv.recovery_sec ? ` · rec ${iv.recovery_sec}s` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
