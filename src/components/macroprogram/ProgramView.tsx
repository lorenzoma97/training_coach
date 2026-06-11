// ProgramView (Sprint 4.2 → P2 redesign, 2026-06-11).
// Visualizzazione macroprogramma con timeline + week navigator + session cards.
//
// P2 "strumento": monocromo + teal (via i 5 colori-fase arbitrari), icone lucide
// al posto delle emoji, niente pulse animation, superfici quiete. La fase è
// un'etichetta (chip neutra, corrente evidenziata), non un arcobaleno.

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, ChevronDown, ChevronUp, Dumbbell, Footprints, Trophy, Activity, Check } from "lucide-react";
import type { MacroProgram, MacroProgramSession, DayLabel } from "../../lib/types/macroprogram";
import { computeMacroProgress } from "../../lib/macroprogram/storage";
import { lookupExerciseHybrid } from "../../lib/macroprogram/customCatalog";
import { useSwipeNavigation } from "./useSwipeNavigation";
import ReferencesDrawer from "./ReferencesDrawer";
import { useModalBackButton } from "../../lib/useModalBackButton";

// ─── Styles base ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "#16213E",
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
  // Tasto indietro Android chiude ProgramView (montato = aperto).
  useModalBackButton(true, onClose);

  const swipeRef = useRef<HTMLDivElement>(null);
  useSwipeNavigation(
    swipeRef,
    () => setViewWeek(w => Math.min(program.metadata.weeks_total, w + 1)),
    () => setViewWeek(w => Math.max(1, w - 1)),
  );

  const currentPhase = phaseForWeek(program, viewWeek);
  const phaseDef = currentPhase ? program.phases[currentPhase.idx] : null;

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
        background: "rgba(11, 15, 26, 0.92)",
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <button onClick={onClose} style={{
          background: "transparent", border: "none",
          color: "#CBD5E1", fontSize: "13px", fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: "6px", minHeight: "44px",
        }} aria-label="Chiudi programma">
          <ArrowLeft size={17} /> Indietro
        </button>
        <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Programma
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "10px", padding: "8px 12px", minHeight: "40px",
            color: "#94A3B8", fontSize: "11px", fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: "6px",
          }}
          aria-label="Apri riferimenti"
        ><Bookmark size={13} /> Riferimenti</button>
      </div>

      {/* Drawer riferimenti */}
      <ReferencesDrawer program={program} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Content */}
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px", maxWidth: "560px", margin: "0 auto", width: "100%" }}>
        {/* Title + meta */}
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#E2E8F0", lineHeight: 1.25, letterSpacing: "-0.02em", marginBottom: "6px" }}>
            {program.metadata.title}
          </div>
          <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5 }}>
            {program.metadata.sport} · {program.metadata.weeks_total} settimane · {program.phases.length} fasi
          </div>
          <div style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5, marginTop: "2px" }}>
            {program.metadata.goal}
          </div>
        </div>

        {/* Timeline */}
        <ProgramTimeline
          program={program}
          viewWeek={viewWeek}
          macroCurrentWeek={macroCurrentWeek}
          onJumpToWeek={setViewWeek}
        />

        {/* Back to current */}
        {!isViewingCurrent && macroCurrentWeek >= 1 && macroCurrentWeek <= program.metadata.weeks_total && (
          <button
            onClick={() => setViewWeek(macroCurrentWeek)}
            style={{
              padding: "8px 14px", minHeight: "40px",
              background: "transparent",
              border: "1px solid rgba(20,184,166,0.4)",
              borderRadius: "10px",
              color: "#14B8A6",
              fontSize: "12px", fontWeight: 700,
              cursor: "pointer", alignSelf: "flex-start",
            }}
          >
            Torna a settimana corrente (S{macroCurrentWeek})
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
              width: "44px", height: "44px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px",
              color: canPrev ? "#E2E8F0" : "#64748B",
              fontSize: "18px", cursor: canPrev ? "pointer" : "not-allowed",
              opacity: canPrev ? 1 : 0.4,
            }}
            aria-label="Settimana precedente"
          >‹</button>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: "#E2E8F0" }}>
              Settimana {viewWeek}{phaseDef ? ` — ${phaseDef.name}` : ""}
            </div>
            {phaseDef && (
              <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "2px", fontFamily: "'JetBrains Mono', monospace" }}>
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
              width: "44px", height: "44px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px",
              color: canNext ? "#E2E8F0" : "#64748B",
              fontSize: "18px", cursor: canNext ? "pointer" : "not-allowed",
              opacity: canNext ? 1 : 0.4,
            }}
            aria-label="Settimana successiva"
          >›</button>
        </div>

        {/* Week notes if present — superficie quieta, label teal */}
        {weekData?.notes && (
          <div style={{ ...cardStyle, padding: "12px 14px" }}>
            <div style={{ fontSize: "10px", color: "#14B8A6", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>
              Note settimana
            </div>
            <div style={{ fontSize: "13px", color: "#CBD5E1", lineHeight: 1.55 }}>
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
          Swipe per cambiare settimana
        </div>
      </div>
    </div>
  );
}

// ─── ProgramTimeline ──────────────────────────────────────────────────────
// Monocromo + teal: passato = check teal attenuato, corrente = teal pieno,
// futuro = outline neutro; la settimana visualizzata ha l'anello chiaro.

function ProgramTimeline({
  program, viewWeek, macroCurrentWeek, onJumpToWeek,
}: {
  program: MacroProgram;
  viewWeek: number;
  macroCurrentWeek: number;
  onJumpToWeek: (w: number) => void;
}) {
  const weeks = Array.from({ length: program.metadata.weeks_total }, (_, i) => i + 1);
  const currentPhaseIdx = phaseForWeek(program, macroCurrentWeek)?.idx ?? -1;
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
          return (
            <button
              key={w}
              onClick={() => onJumpToWeek(w)}
              aria-label={`Vai a settimana ${w}`}
              style={{
                width: "38px", height: "38px",
                borderRadius: "50%",
                background: isCurrent ? "#14B8A6" : isPast ? "rgba(20,184,166,0.14)" : "transparent",
                border: isViewing ? "2px solid #E2E8F0" : "1px solid rgba(255,255,255,0.14)",
                color: isCurrent ? "#052E2A" : isPast ? "#14B8A6" : "#94A3B8",
                fontSize: "12px", fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {isPast ? <Check size={15} strokeWidth={2.6} /> : w}
            </button>
          );
        })}
      </div>
      {/* Phase legend — chip neutre, la fase corrente è evidenziata */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
        {program.phases.map((p, i) => {
          const isCurrentPhase = i === currentPhaseIdx;
          const weeksLabel = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1]
            ? `S${p.weeks[0]}-${p.weeks[1]}`
            : `S${p.weeks.join("/")}`;
          return (
            <div key={i} style={{
              fontSize: "11px",
              color: isCurrentPhase ? "#14B8A6" : "#94A3B8",
              padding: "4px 10px",
              background: isCurrentPhase ? "rgba(20,184,166,0.12)" : "#1A1A2E",
              border: isCurrentPhase ? "1px solid rgba(20,184,166,0.4)" : "1px solid transparent",
              borderRadius: "999px",
              fontWeight: 600,
            }}>
              {p.name} <span style={{ fontFamily: "'JetBrains Mono', monospace", opacity: 0.8 }}>{weeksLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, typeof Dumbbell> = {
  forza_gambe: Dumbbell,
  forza_upper: Dumbbell,
  corsa: Footprints,
  sport: Trophy,
  mobilita: Activity,
};

function SessionCard({ session }: { session: MacroProgramSession }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TYPE_ICONS[session.type] ?? Activity;
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
          <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
            {session.day}
          </div>
          <div style={{ fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
            <Icon size={16} style={{ color: "#14B8A6", flexShrink: 0 }} />
            <span style={{ textTransform: "capitalize" }}>{session.type.replace("_", " ")}</span>
            <span style={{ color: "#94A3B8", fontWeight: 500, fontFamily: "'JetBrains Mono', monospace", fontSize: "13px" }}>{session.duration_min}′</span>
          </div>
          {session.notes_text && (
            <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px", lineHeight: 1.45 }}>
              {session.notes_text}
            </div>
          )}
        </div>
        <div style={{ color: "#64748B", flexShrink: 0 }}>
          {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {session.setup_spatial && (
            <div style={{
              fontSize: "12px", color: "#94A3B8", lineHeight: 1.5,
              padding: "8px 10px", margin: "10px 0",
              background: "#0F172A", borderRadius: "8px",
            }}>
              <span style={{ fontWeight: 700, color: "#CBD5E1" }}>Setup:</span> {session.setup_spatial}
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
                    background: "#1A1A2E",
                    borderRadius: "8px", padding: "10px 12px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0" }}>
                        {i + 1}. {name}
                      </div>
                      <div style={{ fontSize: "12px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
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
                    background: "#1A1A2E",
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
