// PlanTab (Sprint B, 2026-05-27) — il tab "Piano" del Coach.
//
// Fusione Piano↔Programma: in cima un banner STRATEGIA compatto (macrociclo:
// nome, dots settimane, fase, adattamenti, link "Vedi programma completo") +
// sotto la SETTIMANA corrente (TrainingPlanView, già proiettata dal macro
// grazie a Sprint A). Se non c'è macro attivo: solo TrainingPlanView + un
// entry-point discreto per caricare un programma (sposta la discovery fuori
// da Settings).
//
// La timeline completa navigabile (tutte le settimane) resta in ProgramView
// — la "sezione ad hoc" — aperta dal banner. Concordanza visibile, una sola
// schermata per "cosa alleno", programma completo a 1 tap.

import { useEffect, useState } from "react";
import TrainingPlanView from "../TrainingPlanView";
import ProgramView from "./ProgramView";
import MacroProgramUploadSection from "./MacroProgramUploadSection";
import { loadActiveMacroProgram, computeMacroProgress } from "../../lib/macroprogram/storage";
import type { MacroProgram } from "../../lib/types/macroprogram";
import { events } from "../../lib/events";

const cardStyle: React.CSSProperties = {
  background: "#16213E",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px",
  padding: "14px 16px",
};

export default function PlanTab() {
  const [macro, setMacro] = useState<MacroProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [programOpen, setProgramOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
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
      {/* Banner strategia (se macro attivo) */}
      {macro && (
        <MacroStrategyBanner
          program={macro}
          progress={progress}
          onOpenProgram={() => setProgramOpen(true)}
        />
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

      {/* Settimana corrente (proiettata dal macro se attivo) */}
      <TrainingPlanView />

      {/* Sezione ad hoc: programma completo navigabile (fullscreen) */}
      {macro && programOpen && (
        <ProgramView program={macro} onClose={() => setProgramOpen(false)} />
      )}
    </div>
  );
}

// ─── Banner strategia compatto ──────────────────────────────────────────────

function MacroStrategyBanner({
  program, progress, onOpenProgram,
}: {
  program: MacroProgram;
  progress: ReturnType<typeof computeMacroProgress>;
  onOpenProgram: () => void;
}) {
  const total = program.metadata.weeks_total;
  const currentWeek = progress?.currentWeek ?? 0;
  const phase = progress?.currentPhase;
  const weeks = Array.from({ length: total }, (_, i) => i + 1);

  const statusLine = currentWeek === 0
    ? `Inizia tra ${Math.abs(progress?.daysFromStart ?? 0)} giorni`
    : currentWeek > total
      ? "Programma concluso"
      : `Settimana ${currentWeek} di ${total}${phase ? ` · ${phase}` : ""}`;

  return (
    <div
      onClick={onOpenProgram}
      style={{
        background: "linear-gradient(135deg, #16213E 0%, #1E2746 100%)",
        border: "1px solid #E8553A55",
        borderRadius: "14px", padding: "14px 16px",
        cursor: "pointer",
        display: "flex", flexDirection: "column", gap: "10px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <div style={{ fontSize: "10px", color: "#E8553A", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          📋 Programma
        </div>
        <span style={{ fontSize: "11px", color: "#94A3B8" }}>Vedi completo →</span>
      </div>

      <div style={{ fontSize: "15px", fontWeight: 700, color: "#E2E8F0", lineHeight: 1.3 }}>
        {program.metadata.title}
      </div>

      {/* Dots settimane */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        {weeks.map(w => {
          const isPast = currentWeek > 0 && w < currentWeek;
          const isCurrent = w === currentWeek;
          return (
            <span key={w} style={{
              width: "10px", height: "10px", borderRadius: "50%",
              background: isCurrent ? "#E8553A" : isPast ? "#0891B2" : "transparent",
              border: isCurrent || isPast ? "none" : "1px solid rgba(255,255,255,0.25)",
              display: "inline-block",
            }} />
          );
        })}
        <span style={{ fontSize: "12px", color: "#0891B2", fontWeight: 600, marginLeft: "4px" }}>
          {statusLine}
        </span>
      </div>
    </div>
  );
}
