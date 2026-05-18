// Diagnostic panel mobile-friendly per debug sotto-prescrizione (Lorenzo 2026-05-18).
// Legge l'ultima diagnostica salvata dal planGenerator + permette di copiarla
// nella clipboard per share (es. WhatsApp).

import { useEffect, useState } from "react";
import { loadDiagnostic, type PlanDiagnostic } from "../lib/coach/planDiagnostic";

export default function PlanDiagnosticPanel() {
  const [d, setD] = useState<PlanDiagnostic | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void loadDiagnostic().then(setD);
  }, []);

  if (!d) {
    return (
      <div style={{ fontSize: "12px", color: "#94A3B8", fontStyle: "italic", padding: "8px 0" }}>
        Nessuna diagnostica disponibile. Rigenera un piano per popolare i dati.
      </div>
    );
  }

  const deltaColor = d.result.deltaPctVsTarget < -20 ? "#EF4444"
    : d.result.deltaPctVsTarget < -10 ? "#F59E0B"
    : d.result.deltaPctVsTarget > 15 ? "#F59E0B"
    : "#22C55E";

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("clipboard fail:", e);
      // Fallback selectAll on textarea — l'utente può fare Ctrl+C / Cmd+C.
      alert("Clipboard non disponibile. Seleziona il testo nel pannello e copia manualmente.");
    }
  };

  const fmt = (n: number) => `${Math.round(n)}`;
  const ts = new Date(d.timestamp);
  const tsStr = ts.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ fontSize: "11px", color: "#64748B" }}>
        Ultima rigenerazione: <b style={{ color: "#CBD5E1" }}>{tsStr}</b> · mode <b style={{ color: "#CBD5E1" }}>{d.mode}</b>
      </div>

      {/* Summary card */}
      <div style={{
        background: "#0F172A",
        border: `1px solid ${deltaColor}55`,
        borderRadius: "10px",
        padding: "12px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "8px",
        fontSize: "12px",
      }}>
        <div>
          <div style={{ fontSize: "10px", color: "#64748B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Target</div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#E2E8F0", fontFamily: "'JetBrains Mono', monospace" }}>
            {fmt(d.prescription.weeklyVolumeTargetMin)} min
          </div>
          <div style={{ fontSize: "10px", color: "#94A3B8" }}>range {fmt(d.prescription.rangeMin)}-{fmt(d.prescription.rangeMax)}</div>
        </div>
        <div>
          <div style={{ fontSize: "10px", color: "#64748B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Effettivo</div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: deltaColor, fontFamily: "'JetBrains Mono', monospace" }}>
            {fmt(d.result.actualVolumeMin)} min
          </div>
          <div style={{ fontSize: "10px", color: deltaColor, fontWeight: 700 }}>
            {d.result.deltaPctVsTarget >= 0 ? "+" : ""}{d.result.deltaPctVsTarget}% vs target
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: "11px", color: "#94A3B8" }}>
            {d.result.sessionsCount} sessioni · durata media target {fmt(d.prescription.avgSessionMin)}min
          </div>
        </div>
        {d.retry?.attempted && (
          <div style={{ gridColumn: "1 / -1", paddingTop: "6px" }}>
            <div style={{ fontSize: "11px", color: d.retry.success ? "#22C55E" : "#F59E0B" }}>
              ↻ Retry: {d.retry.success ? "success" : "failed"}
              {d.retry.actualVolumeMin != null && ` (${fmt(d.retry.actualVolumeMin)} min)`}
              {d.retry.error && ` · err: ${d.retry.error.slice(0, 80)}`}
            </div>
          </div>
        )}
      </div>

      {/* Sessioni breakdown */}
      <div>
        <div style={{ fontSize: "10px", color: "#64748B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>
          Sessioni generate
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {d.result.sessionsBreakdown.map((s, i) => (
            <span key={i} style={{
              padding: "4px 8px",
              background: "#1A1A2E",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "6px",
              fontSize: "11px",
              color: "#CBD5E1",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {s.day} · {s.type.replace("forza_", "f.").slice(0, 8)} · <b>{s.duration_min}min</b>
            </span>
          ))}
        </div>
      </div>

      {/* Override prescrizione */}
      {d.prescription.overrides.length > 0 && (
        <div>
          <div style={{ fontSize: "10px", color: "#F59E0B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>
            Override applicati ({d.prescription.overrides.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "11px", color: "#CBD5E1", lineHeight: 1.5 }}>
            {d.prescription.overrides.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}

      {/* Bottoni copia + expand */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button onClick={copyAll} style={{
          padding: "10px 14px", minHeight: "40px",
          background: copied ? "#22C55E22" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
          border: copied ? "1px solid #22C55E" : "none",
          borderRadius: "8px",
          color: copied ? "#22C55E" : "#FFF",
          fontSize: "12px", fontWeight: 700, cursor: "pointer",
        }}>
          {copied ? "✓ Copiato" : "📋 Copia diagnostica completa"}
        </button>
        <button onClick={() => setExpanded(e => !e)} style={{
          padding: "10px 14px", minHeight: "40px",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "8px",
          color: "#CBD5E1", fontSize: "12px", fontWeight: 600, cursor: "pointer",
        }}>
          {expanded ? "▲ Nascondi raw" : "▼ Mostra raw response"}
        </button>
      </div>

      {expanded && (
        <div>
          <div style={{ fontSize: "10px", color: "#64748B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>
            Raw Gemini response (primi 800 char)
          </div>
          <textarea
            readOnly
            value={d.result.rawResponseSnippet}
            style={{
              width: "100%",
              minHeight: "160px",
              padding: "8px 10px",
              background: "#0F172A",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              color: "#94A3B8",
              fontSize: "10px",
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1.4,
              resize: "vertical",
              boxSizing: "border-box",
            }}
            onClick={e => (e.target as HTMLTextAreaElement).select()}
          />
        </div>
      )}

      <div style={{ fontSize: "10px", color: "#64748B", lineHeight: 1.5, paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        Prompt: system {d.prompt.systemInstructionLength} char · user {d.prompt.userPromptLength} char · maxTokens {d.prompt.maxTokens}
      </div>
    </div>
  );
}
