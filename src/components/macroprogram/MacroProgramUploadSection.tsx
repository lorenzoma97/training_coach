// MacroProgram upload UI (Sprint 4.1, 2026-05-26).
// Sezione integrata in SettingsPage per upload + visualizzazione status.
//
// Flow:
//  1. File input → user seleziona .md
//  2. parseAndResolveMacroProgram(content) → MacroProgramParseResult
//  3. Dialog risultato: metadata + N orphan auto-added + warnings
//  4. Bottone "Salva come programma attivo" → saveActiveMacroProgram
//  5. Banner stato: programma attivo (titolo, settimana corrente, fase)

import { useEffect, useState } from "react";
import { parseAndResolveMacroProgram, MacroProgramParseError } from "../../lib/macroprogram/parser";
import {
  saveActiveMacroProgram,
  loadActiveMacroProgram,
  clearActiveMacroProgram,
  computeMacroProgress,
  type MacroProgressInfo,
} from "../../lib/macroprogram/storage";
import { refreshCustomCache } from "../../lib/macroprogram/customCatalog";
import type { MacroProgram, MacroProgramParseResult } from "../../lib/types/macroprogram";
import ProgramView from "./ProgramView";

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

const ctaStyle: React.CSSProperties = {
  padding: "12px 18px",
  background: "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
  border: "none", borderRadius: "10px",
  color: "#FFF", fontSize: "13px", fontWeight: 700, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.16)", borderRadius: "10px",
  color: "#94A3B8", fontSize: "12px", fontWeight: 600, cursor: "pointer",
};

export default function MacroProgramUploadSection() {
  const [activeProgram, setActiveProgram] = useState<MacroProgram | null>(null);
  const [progress, setProgress] = useState<MacroProgressInfo | null>(null);
  const [pendingResult, setPendingResult] = useState<MacroProgramParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await loadActiveMacroProgram();
      setActiveProgram(p);
      if (p) setProgress(computeMacroProgress(p));
      // Refresh custom catalog cache al mount per consistency
      await refreshCustomCache();
    })();
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setErrorDetails([]);
    setPendingResult(null);
    setBusy(true);
    try {
      const text = await file.text();
      const result = await parseAndResolveMacroProgram(text);
      setPendingResult(result);
    } catch (err) {
      if (err instanceof MacroProgramParseError) {
        setError(err.message);
        setErrorDetails(err.details);
      } else {
        setError((err as Error)?.message ?? "Errore di lettura file");
      }
    } finally {
      setBusy(false);
      // reset input per permettere re-upload stesso file
      e.target.value = "";
    }
  }

  async function handleConfirm() {
    if (!pendingResult) return;
    setBusy(true);
    try {
      await saveActiveMacroProgram(pendingResult.program);
      setActiveProgram(pendingResult.program);
      setProgress(computeMacroProgress(pendingResult.program));
      setPendingResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    setPendingResult(null);
  }

  async function handleClear() {
    if (!confirm("Sicuro di voler rimuovere il macroprogramma attivo? Verrà archiviato in history.")) return;
    setBusy(true);
    try {
      await clearActiveMacroProgram();
      setActiveProgram(null);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Active program status */}
      {activeProgram && (
        <div style={cardStyle}>
          <div style={labelStyle}>Programma attivo</div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
            {activeProgram.metadata.title}
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "4px" }}>
            Sport: <b>{activeProgram.metadata.sport}</b> · {activeProgram.metadata.weeks_total} settimane · {activeProgram.weeks.reduce((a, w) => a + w.sessions.length, 0)} sessioni totali
          </div>
          {progress && (
            <div style={{ fontSize: "12px", color: "#0891B2", fontWeight: 600, marginBottom: "10px" }}>
              {progress.currentWeek === 0
                ? `⏳ Inizio tra ${Math.abs(progress.daysFromStart)} giorni`
                : progress.currentWeek > activeProgram.metadata.weeks_total
                  ? `✓ Programma concluso (${Math.abs(progress.daysFromStart - activeProgram.metadata.weeks_total * 7)} gg fa)`
                  : `Settimana ${progress.currentWeek} di ${activeProgram.metadata.weeks_total}${progress.currentPhase ? ` · Fase ${progress.currentPhase}` : ""}`}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button onClick={() => setViewerOpen(true)} disabled={busy} style={ctaStyle}>
              📖 Apri programma
            </button>
            <button onClick={handleClear} disabled={busy} style={{ ...secondaryBtnStyle, color: "#EF4444", borderColor: "#EF444466" }}>
              🗑 Rimuovi
            </button>
          </div>
        </div>
      )}

      {/* Full-screen ProgramView */}
      {activeProgram && viewerOpen && (
        <ProgramView program={activeProgram} onClose={() => setViewerOpen(false)} />
      )}

      {/* Upload section */}
      <div style={cardStyle}>
        <div style={labelStyle}>{activeProgram ? "Sostituisci con nuovo" : "Carica programma"}</div>
        <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "12px" }}>
          Carica un file <b>.md</b> generato da Claude Opus 4.7 usando il template{" "}
          <a href="https://github.com/lorenzoma97/training_coach/blob/main/docs/MACROPROGRAM_TEMPLATE.md" target="_blank" rel="noreferrer" style={{ color: "#0891B2" }}>
            MACROPROGRAM_TEMPLATE.md
          </a>
          . Il sistema estrae il blocco JSON e auto-aggiunge eventuali esercizi nuovi al tuo catalog personale.
        </div>
        <label style={{ ...ctaStyle, display: "inline-block", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "⏳ Elaborazione…" : "📂 Seleziona file .md"}
          <input
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            onChange={handleFile}
            disabled={busy}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {/* Error display */}
      {error && (
        <div style={{ ...cardStyle, borderColor: "#EF444466", background: "#EF444415" }}>
          <div style={{ fontSize: "12px", color: "#EF4444", fontWeight: 700, marginBottom: "6px" }}>
            ⚠ Errore parsing
          </div>
          <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.5, marginBottom: "8px" }}>{error}</div>
          {errorDetails.length > 0 && (
            <details style={{ fontSize: "11px", color: "#94A3B8" }}>
              <summary style={{ cursor: "pointer" }}>Dettagli tecnici ({errorDetails.length})</summary>
              <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                {errorDetails.map((d, i) => <li key={i} style={{ marginBottom: "2px" }}>{d}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Pending result dialog (parse OK, awaiting confirm) */}
      {pendingResult && (
        <div style={{ ...cardStyle, borderColor: "#22C55E66", background: "#22C55E10" }}>
          <div style={{ fontSize: "12px", color: "#22C55E", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>
            ✓ Parse riuscito — conferma per attivare
          </div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
            {pendingResult.program.metadata.title}
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "12px", lineHeight: 1.5 }}>
            Sport: <b>{pendingResult.program.metadata.sport}</b><br />
            Settimane: <b>{pendingResult.program.metadata.weeks_total}</b><br />
            Sessioni totali: <b>{pendingResult.program.weeks.reduce((a, w) => a + w.sessions.length, 0)}</b><br />
            Fasi: <b>{pendingResult.program.phases.length}</b> ({pendingResult.program.phases.map(p => p.name).join(" → ")})
          </div>

          {pendingResult.orphanExercises.length > 0 && (
            <div style={{ marginBottom: "10px", padding: "8px 10px", background: "#0891B215", borderRadius: "8px" }}>
              <div style={{ fontSize: "12px", color: "#38BDF8", fontWeight: 600, marginBottom: "4px" }}>
                +{pendingResult.orphanExercises.length} esercizi nuovi aggiunti al catalog personale
              </div>
              <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.5 }}>
                {pendingResult.orphanExercises.map(o => o.name ?? o.exerciseId).join(" · ")}
              </div>
            </div>
          )}

          {pendingResult.warnings.length > 0 && (
            <details style={{ marginBottom: "10px", padding: "8px 10px", background: "#F59E0B15", borderRadius: "8px" }}>
              <summary style={{ fontSize: "12px", color: "#F59E0B", fontWeight: 600, cursor: "pointer" }}>
                ⚠ {pendingResult.warnings.length} avvertenze (non bloccanti)
              </summary>
              <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "11px", color: "#94A3B8", lineHeight: 1.5 }}>
                {pendingResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          {activeProgram && (
            <div style={{ fontSize: "11px", color: "#F59E0B", marginBottom: "10px", lineHeight: 1.5 }}>
              ℹ Il programma attivo corrente sarà archiviato in history (max 5 entries).
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button onClick={handleConfirm} disabled={busy} style={ctaStyle}>
              {busy ? "⏳" : "✓ Attiva programma"}
            </button>
            <button onClick={handleDiscard} disabled={busy} style={secondaryBtnStyle}>
              ✗ Scarta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
