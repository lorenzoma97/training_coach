// PlanTab (redesign function-first, 2026-06-11) — il tab "Piano".
//
// Gerarchia per funzione:
//   1. Riga contesto programma (titolo + S2/5 · fase + progress) → Narrativa.
//   2. TrainingPlanView: LA SETTIMANA (7 righe lun→dom, eroe della pagina).
// Timeline e anteprime vivono SOLO nella Narrativa: niente doppioni.

import { useEffect, useState } from "react";
import TrainingPlanView from "../TrainingPlanView";
import ProgramView from "./ProgramView";
import MacroProgramUploadSection from "./MacroProgramUploadSection";
import { loadActiveMacroProgram, computeMacroProgress, setMacroStartDate, mondayOf } from "../../lib/macroprogram/storage";
import { todayISO } from "../../lib/time";
import type { MacroProgram } from "../../lib/types/macroprogram";
import { events } from "../../lib/events";
import { uiCard } from "../../lib/theme";

const cardStyle = uiCard; // design system (theme.ts)

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
      {/* Contesto programma: UNA riga compatta (titolo + S2/5 · fase + progress).
          Timeline e anteprima settimane vivono SOLO nella Narrativa → niente
          doppioni. Tap → apre il programma completo. */}
      {macro && (
        <>
          <button
            onClick={() => setNarrativeOpen(true)}
            aria-label="Apri il programma completo"
            style={{
              width: "100%", textAlign: "left", cursor: "pointer",
              background: "#16213E", border: "1px solid rgba(20,184,166,0.25)",
              borderRadius: "14px", padding: "12px 16px",
              display: "flex", alignItems: "center", gap: "12px",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#14B8A6", marginBottom: "3px" }}>Programma</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{macro.metadata.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", fontWeight: 700, color: "#14B8A6", flexShrink: 0 }}>
                  {progress && progress.currentWeek >= 1 && progress.currentWeek <= macro.metadata.weeks_total
                    ? `S${progress.currentWeek}/${macro.metadata.weeks_total}`
                    : progress && progress.currentWeek === 0 ? "Non iniziato" : "Concluso"}
                </span>
                {progress?.currentPhase && (
                  <span style={{ fontSize: "12px", color: "#94A3B8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{progress.currentPhase}</span>
                )}
                <span style={{ flex: 1, height: "4px", borderRadius: "2px", background: "#0F172A", overflow: "hidden", minWidth: "40px" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.min(100, Math.max(0, ((progress?.currentWeek ?? 0) / macro.metadata.weeks_total) * 100))}%`, background: "#14B8A6" }} />
                </span>
              </div>
            </div>
            <span aria-hidden="true" style={{ color: "#64748B", fontSize: "18px", flexShrink: 0 }}>›</span>
          </button>
          <button
            onClick={() => setManageOpen(v => !v)}
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px", background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
              color: "#94A3B8", fontSize: "11px", fontWeight: 600, cursor: "pointer",
            }}
          >
            {manageOpen ? "Chiudi gestione" : "Gestisci / sostituisci programma"}
          </button>
          {manageOpen && (
            <>
              <div style={cardStyle}>
                <StartDateEditor program={macro} onChanged={() => setRefreshKey(k => k + 1)} />
              </div>
              <div style={cardStyle}>
                <MacroProgramUploadSection />
              </div>
            </>
          )}
        </>
      )}

      {/* Entry-point import (se NESSUN macro) — discovery fuori da Settings */}
      {loaded && !macro && (
        <div style={{ ...cardStyle, borderStyle: "dashed", borderColor: "rgba(232,85,58,0.3)" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
            Hai un programma multi-settimana?
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "10px" }}>
            Genera un programma su Claude col template e caricalo qui: il piano settimanale lo seguirà fedelmente.
          </div>
          <button
            onClick={() => setUploadOpen(v => !v)}
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: "1px solid #14B8A666", borderRadius: "10px",
              color: "#14B8A6", fontSize: "13px", fontWeight: 700, cursor: "pointer",
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

      {/* Narrativa completa + riferimenti (testo lungo): unico uso del modale. */}
      {macro && narrativeOpen && (
        <ProgramView program={macro} onClose={() => setNarrativeOpen(false)} />
      )}
    </div>
  );
}

// ─── Editor data di inizio (Sprint, 2026-06-09) ───────────────────────────────

function StartDateEditor({ program, onChanged }: { program: MacroProgram; onChanged: () => void }) {
  const [val, setVal] = useState(program.metadata.start_date ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const progress = computeMacroProgress(program);
  const total = program.metadata.weeks_total;

  const fmtIT = (iso?: string) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y) return iso;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  };

  const apply = async (dateISO: string) => {
    if (!dateISO || saving) return;
    setSaving(true); setMsg(null);
    const updated = await setMacroStartDate(dateISO);
    setSaving(false);
    if (updated) {
      setVal(updated.metadata.start_date ?? dateISO);
      // plan:updated → TrainingPlanView riproietta sulla nuova settimana corrente.
      events.emit("plan:updated", { at: new Date().toISOString() });
      setMsg(`Inizio impostato a lun ${fmtIT(updated.metadata.start_date)}.`);
      onChanged();
    } else {
      setMsg("Data non valida.");
    }
  };

  const thisMonday = mondayOf(todayISO()); // todayISO/mondayOf da time.ts (fonte unica)

  const statusLine = !progress
    ? "—"
    : progress.currentWeek === 0
      ? `inizia tra ${Math.abs(progress.daysFromStart)} giorni`
      : progress.currentWeek > total
        ? "concluso"
        : `oggi: settimana ${progress.currentWeek}/${total}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#E2E8F0" }}>📅 Data di inizio</div>
      <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.5 }}>
        Le settimane vanno lun→dom: la settimana 1 parte dal lunedì scelto (la data viene riportata al lunedì della sua settimana). Cambiala per ricominciare dopo uno stop, o per far partire il piano questa settimana.
      </div>
      <div style={{ fontSize: "12px", color: "#CBD5E1" }}>
        Attuale: <b>lun {fmtIT(program.metadata.start_date)}</b> · {statusLine}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="date"
          value={val}
          onChange={e => setVal(e.target.value)}
          style={{
            padding: "8px 10px", background: "#0F172A",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
            color: "#E2E8F0", fontSize: "13px",
          }}
        />
        <button
          onClick={() => apply(val)}
          disabled={saving || !val}
          style={{
            padding: "8px 14px", background: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
            border: "none", borderRadius: "8px", color: "#052E2A", fontSize: "13px", fontWeight: 800,
            cursor: saving ? "wait" : "pointer", opacity: saving || !val ? 0.6 : 1,
          }}
        >Applica</button>
      </div>
      {thisMonday && (
        <button
          onClick={() => apply(thisMonday)}
          disabled={saving}
          style={{
            alignSelf: "flex-start", padding: "8px 12px", background: "transparent",
            border: "1px solid #0891B266", borderRadius: "8px",
            color: "#0891B2", fontSize: "12px", fontWeight: 700, cursor: saving ? "wait" : "pointer",
          }}
        >↻ Ricomincia da questa settimana (lun {fmtIT(thisMonday)})</button>
      )}
      {msg && <div style={{ fontSize: "11px", color: "#22C55E" }}>{msg}</div>}
    </div>
  );
}
