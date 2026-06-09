// PlanTab (Sprint B → I, 2026-06-09) — il tab "Piano" del Coach.
//
// UN SOLO posto per "cosa alleno": in cima un banner STRATEGIA (macrociclo) +
// una TIMELINE INLINE navigabile (tutte le settimane del programma, tap per
// vederne la struttura senza aprire un modale) + sotto la SETTIMANA CORRENTE
// VIVA (TrainingPlanView: proiettata dal macro, adattabile da Gemini).
//
// Sprint I: la navigazione settimana-per-settimana è ora INLINE (prima era un
// modale fullscreen ProgramView). ProgramView resta accessibile solo per la
// NARRATIVA completa + riferimenti (testo lungo), via link discreto nel banner.
// Se non c'è macro attivo: solo TrainingPlanView + entry-point per caricarne uno.

import { useEffect, useMemo, useState } from "react";
import TrainingPlanView from "../TrainingPlanView";
import ProgramView from "./ProgramView";
import MacroProgramUploadSection from "./MacroProgramUploadSection";
import { loadActiveMacroProgram, computeMacroProgress } from "../../lib/macroprogram/storage";
import { lookupExerciseHybrid } from "../../lib/macroprogram/customCatalog";
import type { MacroProgram, MacroProgramSession } from "../../lib/types/macroprogram";
import { events } from "../../lib/events";

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;

const cardStyle: React.CSSProperties = {
  background: "#16213E",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px",
  padding: "14px 16px",
};

export default function PlanTab() {
  const [macro, setMacro] = useState<MacroProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [narrativeOpen, setNarrativeOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const m = await loadActiveMacroProgram();
      setMacro(m);
      setLoaded(true);
    })();
  }, [refreshKey]);

  // Re-check macro quando il piano viene aggiornato (es. dopo import o rigenera)
  useEffect(() => {
    const off = events.on("plan:updated", () => setRefreshKey(k => k + 1));
    return () => { off(); };
  }, []);

  const progress = macro ? computeMacroProgress(macro) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Banner strategia + timeline inline (se macro attivo) */}
      {macro && (
        <>
          <MacroStrategyBanner
            program={macro}
            progress={progress}
            onOpenNarrative={() => setNarrativeOpen(true)}
          />
          <MacroTimelineInline
            program={macro}
            currentWeek={progress?.currentWeek ?? 0}
          />
          <button
            onClick={() => setManageOpen(v => !v)}
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px", background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
              color: "#94A3B8", fontSize: "11px", fontWeight: 600, cursor: "pointer",
            }}
          >
            {manageOpen ? "Chiudi gestione" : "⚙ Gestisci / sostituisci programma"}
          </button>
          {manageOpen && (
            <div style={cardStyle}>
              <MacroProgramUploadSection />
            </div>
          )}
        </>
      )}

      {/* Entry-point import (se NESSUN macro) — discovery fuori da Settings */}
      {loaded && !macro && (
        <div style={{ ...cardStyle, borderStyle: "dashed", borderColor: "rgba(232,85,58,0.3)" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
            📋 Hai un programma multi-settimana?
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "10px" }}>
            Genera un programma su Claude col template e caricalo qui: il piano settimanale lo seguirà fedelmente.
          </div>
          <button
            onClick={() => setUploadOpen(v => !v)}
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: "1px solid #E8553A66", borderRadius: "10px",
              color: "#E8553A", fontSize: "13px", fontWeight: 700, cursor: "pointer",
            }}
          >
            {uploadOpen ? "Chiudi" : "Carica programma"}
          </button>
          {uploadOpen && (
            <div style={{ marginTop: "12px" }}>
              <MacroProgramUploadSection />
            </div>
          )}
        </div>
      )}

      {/* Settimana corrente (proiettata dal macro se attivo, adattabile) */}
      <TrainingPlanView />

      {/* Narrativa completa + riferimenti (testo lungo): l'unico uso residuo del
          modale fullscreen. La navigazione settimanale è inline qui sopra. */}
      {macro && narrativeOpen && (
        <ProgramView program={macro} onClose={() => setNarrativeOpen(false)} />
      )}
    </div>
  );
}

// ─── Banner strategia compatto ──────────────────────────────────────────────

function MacroStrategyBanner({
  program, progress, onOpenNarrative,
}: {
  program: MacroProgram;
  progress: ReturnType<typeof computeMacroProgress>;
  onOpenNarrative: () => void;
}) {
  const total = program.metadata.weeks_total;
  const currentWeek = progress?.currentWeek ?? 0;
  const phase = progress?.currentPhase;

  const statusLine = currentWeek === 0
    ? `Inizia tra ${Math.abs(progress?.daysFromStart ?? 0)} giorni`
    : currentWeek > total
      ? "Programma concluso"
      : `Settimana ${currentWeek} di ${total}${phase ? ` · ${phase}` : ""}`;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #16213E 0%, #1E2746 100%)",
        border: "1px solid #E8553A55",
        borderRadius: "14px", padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: "8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <div style={{ fontSize: "10px", color: "#E8553A", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          📋 Programma
        </div>
        <button
          onClick={onOpenNarrative}
          style={{
            padding: "4px 8px", background: "transparent", border: "none",
            color: "#94A3B8", fontSize: "11px", fontWeight: 600, cursor: "pointer",
            textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "3px",
          }}
        >Narrativa e riferimenti →</button>
      </div>

      <div style={{ fontSize: "15px", fontWeight: 700, color: "#E2E8F0", lineHeight: 1.3 }}>
        {program.metadata.title}
      </div>
      <div style={{ fontSize: "12px", color: "#0891B2", fontWeight: 600 }}>
        {statusLine}
      </div>
    </div>
  );
}

// ─── Timeline inline navigabile ──────────────────────────────────────────────

function phaseForWeek(program: MacroProgram, week: number): string | undefined {
  for (const p of program.phases) {
    const isRange = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1];
    const inPhase = isRange ? (week >= p.weeks[0] && week <= p.weeks[1]) : p.weeks.includes(week);
    if (inPhase) return p.name;
  }
  return undefined;
}

function MacroTimelineInline({
  program, currentWeek,
}: {
  program: MacroProgram;
  currentWeek: number;
}) {
  const total = program.metadata.weeks_total;
  const weeks = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  // Default: settimana corrente (o la 1 se il programma non è iniziato).
  const [selected, setSelected] = useState(currentWeek >= 1 && currentWeek <= total ? currentWeek : 1);

  const weekData = useMemo(
    () => program.weeks.find(w => w.week === selected) ?? null,
    [program, selected],
  );
  const phaseName = phaseForWeek(program, selected);
  const isCurrent = selected === currentWeek;

  const sortedSessions = useMemo(() => {
    if (!weekData) return [];
    return [...weekData.sessions].sort(
      (a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day),
    );
  }, [weekData]);

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: "11px", color: "#94A3B8", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "10px" }}>
        Timeline programma
      </div>

      {/* Chip settimane navigabili */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
        {weeks.map(w => {
          const sel = w === selected;
          const cur = w === currentWeek;
          const past = currentWeek > 0 && w < currentWeek;
          return (
            <button
              key={w}
              onClick={() => setSelected(w)}
              aria-pressed={sel}
              title={`Settimana ${w}${cur ? " (corrente)" : ""}`}
              style={{
                minWidth: "38px", padding: "7px 9px",
                background: sel ? "#E8553A" : cur ? "#E8553A22" : past ? "#0891B218" : "#1A1A2E",
                border: sel ? "1px solid #E8553A" : cur ? "1px solid #E8553A66" : "1px solid rgba(255,255,255,0.1)",
                borderRadius: "9px",
                color: sel ? "#FFF" : cur ? "#E8553A" : past ? "#0891B2" : "#94A3B8",
                fontSize: "12px", fontWeight: 700, cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {w}
            </button>
          );
        })}
      </div>

      {/* Header settimana selezionata */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0" }}>
          Settimana {selected}
        </span>
        {phaseName && <span style={{ fontSize: "12px", color: "#0891B2", fontWeight: 600 }}>· {phaseName}</span>}
        {isCurrent && (
          <span style={{ fontSize: "10px", color: "#E8553A", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            corrente
          </span>
        )}
      </div>
      {weekData?.notes && (
        <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "8px" }}>
          {weekData.notes}
        </div>
      )}

      {/* Contenuto settimana */}
      {isCurrent ? (
        <div style={{
          fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5,
          background: "#0891B212", border: "1px solid #0891B233",
          borderRadius: "9px", padding: "10px 12px",
        }}>
          Questa è la settimana corrente — la trovi viva e adattabile qui sotto ↓
        </div>
      ) : sortedSessions.length === 0 ? (
        <div style={{ fontSize: "12px", color: "#64748B" }}>Nessuna sessione in questa settimana.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {sortedSessions.map((s, i) => <SessionPreviewLine key={i} session={s} />)}
        </div>
      )}
    </div>
  );
}

/** Riga compatta read-only di una sessione del macro (per la timeline). */
function SessionPreviewLine({ session: s }: { session: MacroProgramSession }) {
  const mainIv = s.intervals.find(iv => iv.kind === "main") ?? s.intervals[0];
  const zone = mainIv?.zone;

  let summary = "";
  if (s.exercises.length > 0) {
    const top = s.exercises.slice(0, 3).map(ex => {
      const name = ex.name ?? lookupExerciseHybrid(ex.id)?.name ?? ex.id;
      const reps = ex.reps_min === ex.reps_max ? `${ex.reps_min}` : `${ex.reps_min}-${ex.reps_max}`;
      return `${name} ${ex.sets}×${reps}`;
    }).join(" · ");
    summary = top + (s.exercises.length > 3 ? ` +${s.exercises.length - 3}` : "");
  } else if (s.intervals.length > 0) {
    summary = s.intervals
      .map(iv => iv.kind === "main" && iv.reps ? `${iv.reps}×${iv.duration_min ?? "?"}min` : (iv.duration_min ? `${iv.kind} ${iv.duration_min}min` : iv.kind))
      .join(" + ");
  }

  return (
    <div style={{
      padding: "8px 10px", background: "#0F172A",
      border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px",
      display: "flex", flexDirection: "column", gap: "3px",
    }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", minWidth: "34px" }}>
          {s.day}
        </span>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#E2E8F0" }}>{s.type}</span>
        <span style={{ fontSize: "11px", color: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}>{s.duration_min}min</span>
        {typeof zone === "number" && (
          <span style={{ fontSize: "10px", color: "#38BDF8", fontWeight: 700 }}>Z{zone}</span>
        )}
      </div>
      {summary && (
        <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.4 }}>{summary}</div>
      )}
    </div>
  );
}
