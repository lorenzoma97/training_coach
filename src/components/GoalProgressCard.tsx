// Goal progress card (Wave audit 2 — opzione A).
//
// Per ogni goal active mostra:
//  - Header: tipo + nome + KPI corrente vs target
//  - Sparkline 8 settimane (riusa Sparkline.tsx)
//  - Badge segnale: AVANTI / ALLINEATO / DA ACCELERARE / MOLTO INDIETRO
//  - Footer: ETA settimane mancanti alla deadline
//
// Logica computata da `computeGoalProgress` in diaryContext.ts (pure).
// Componente puro presentational: riceve già la struct calcolata.

import Sparkline from "./Sparkline";
import {
  formatPaceSec,
  type GoalProgressData,
} from "../lib/diaryContext";
import type { GoalFeasibility } from "../lib/coach/goalPredictor";
import type { UserGoal } from "../lib/types";

// Wave audit 2 — UI badge basato su feasibility predittiva (Daniels VDOT,
// ACSM, Krustrup, Schoenfeld, Pfitzinger). Sostituisce il vecchio mapping
// signal categoriale che era basato solo su delta semplice (errato:
// volume ≠ performance).
const FEASIBILITY_META: Record<GoalFeasibility, { label: string; color: string; bg: string; icon: string }> = {
  ok:          { label: "ON TRACK",      color: "#22C55E", bg: "#22C55E22", icon: "✓" },
  stretch:     { label: "STRETCH",       color: "#0891B2", bg: "#0891B222", icon: "🔥" },
  aggressive:  { label: "AGGRESSIVE",    color: "#F59E0B", bg: "#F59E0B22", icon: "⚠" },
  infeasible:  { label: "IRRAGGIUNGIBILE", color: "#EF4444", bg: "#EF444422", icon: "🚫" },
  unknown:     { label: "DATI INSUFFICIENTI", color: "#94A3B8", bg: "#94A3B822", icon: "?" },
};

function formatValue(value: number | null, kind: GoalProgressData["kind"]): string {
  if (value == null) return "—";
  if (kind === "corsa_pace") return formatPaceSec(value); // pace
  if (kind === "frequenza" || kind === "calcio_match") return value.toFixed(1);
  if (kind === "peso" || kind === "forza_1rm" || kind === "resistenza_durata") return value.toFixed(1);
  return value.toFixed(0);
}

function formatDelta(delta: number | null, kind: GoalProgressData["kind"]): string | null {
  if (delta == null) return null;
  const sign = delta > 0 ? "+" : "";
  if (kind === "corsa_pace") {
    const abs = Math.abs(delta);
    const sec = Math.round(abs);
    return `${delta > 0 ? "+" : "−"}${sec}s/km vs target`;
  }
  if (kind === "peso" || kind === "forza_1rm") return `${sign}${delta.toFixed(1)}kg vs target`;
  if (kind === "resistenza_durata") return `${sign}${delta.toFixed(0)}min vs target`;
  if (kind === "frequenza") return `${sign}${delta.toFixed(1)} vs target`;
  return `${sign}${delta.toFixed(1)}`;
}

export default function GoalProgressCard({
  goal,
  progress,
}: {
  goal: UserGoal;
  progress: GoalProgressData;
}) {
  const feasMeta = FEASIBILITY_META[progress.feasibility];
  const currentStr = formatValue(progress.currentValue, progress.kind);
  const targetStr = progress.targetValue != null ? formatValue(progress.targetValue, progress.kind) : "—";
  const predictedStr = progress.predictedFinalValue != null ? formatValue(progress.predictedFinalValue, progress.kind) : null;
  const deltaStr = formatDelta(progress.deltaToTarget, progress.kind);

  const sparkColor = feasMeta.color;

  let etaCopy = "";
  if (progress.weeksToDeadline != null) {
    if (progress.weeksToDeadline > 0) etaCopy = `${progress.weeksToDeadline} sett alla deadline`;
    else if (progress.weeksToDeadline === 0) etaCopy = "deadline questa settimana";
    else etaCopy = `deadline scaduta da ${-progress.weeksToDeadline} sett`;
  }

  return (
    <div style={{
      background: "#0F172A",
      border: `1px solid ${feasMeta.color}33`,
      borderRadius: "12px",
      padding: "12px 14px",
      marginTop: "10px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    }}>
      {/* Header: KPI corrente vs target + badge feasibility */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "10px", color: "#64748B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "3px" }}>
            Stato attuale
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", fontFamily: "'JetBrains Mono', monospace" }}>
              {currentStr}
            </span>
            <span style={{ fontSize: "12px", color: "#94A3B8" }}>{progress.unit}</span>
            <span style={{ fontSize: "12px", color: "#64748B" }}>
              → target <b style={{ color: "#CBD5E1" }}>{targetStr}</b>
            </span>
          </div>
          {deltaStr && (
            <div style={{ fontSize: "11px", color: feasMeta.color, marginTop: "3px", fontWeight: 600 }}>
              {deltaStr}
            </div>
          )}
        </div>
        <div style={{
          padding: "5px 10px",
          background: feasMeta.bg,
          border: `1px solid ${feasMeta.color}55`,
          borderRadius: "999px",
          color: feasMeta.color,
          fontSize: "10px",
          fontWeight: 800,
          letterSpacing: "0.1em",
          whiteSpace: "nowrap",
        }}>
          {feasMeta.icon} {feasMeta.label}
        </div>
      </div>

      {/* Predizione scientifica alla deadline */}
      {predictedStr && progress.feasibility !== "unknown" && (
        <div style={{
          background: "#1A1A2E",
          border: `1px solid ${feasMeta.color}22`,
          borderRadius: "8px",
          padding: "8px 10px",
          fontSize: "12px",
          color: "#CBD5E1",
          lineHeight: 1.5,
        }}>
          <div style={{ fontSize: "10px", color: "#64748B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "3px" }}>
            🔮 Predetto a deadline
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: feasMeta.color, fontWeight: 700 }}>
            {predictedStr} {progress.unit}
          </div>
          {progress.realisticDeadlineWeeks != null && progress.realisticDeadlineWeeks > 0 && (progress.feasibility === "aggressive" || progress.feasibility === "infeasible") && (
            <div style={{ fontSize: "10px", color: "#94A3B8", marginTop: "3px" }}>
              Deadline realistica per target: <b>{progress.realisticDeadlineWeeks} sett</b>
            </div>
          )}
        </div>
      )}

      {/* Sparkline 8 settimane */}
      <div>
        <div style={{ fontSize: "10px", color: "#64748B", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>
          Trend 8 settimane
        </div>
        <Sparkline
          points={progress.sparklinePoints}
          width={300}
          height={60}
          color={sparkColor}
          invertY={progress.invertY}
          formatValue={progress.kind === "corsa_pace" ? formatPaceSec : undefined}
          unit={progress.unit}
          ariaLabel={`Trend ${progress.unit} 8 settimane per goal ${goal.smartDescription}`}
        />
      </div>

      {/* Reasoning collapsibile (citazione paper + spiegazione) */}
      {progress.reasoning && progress.feasibility !== "unknown" && (
        <details style={{ fontSize: "11px", color: "#94A3B8" }}>
          <summary style={{ cursor: "pointer", color: "#64748B", fontWeight: 600, listStyle: "none" }}>
            ▸ Razionale scientifico
          </summary>
          <div style={{ marginTop: "6px", lineHeight: 1.5 }}>
            {progress.reasoning}
            <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px", fontStyle: "italic" }}>
              Fonte: {progress.scienceCitation}
            </div>
          </div>
        </details>
      )}

      {/* Footer ETA */}
      {etaCopy && (
        <div style={{ fontSize: "11px", color: "#64748B" }}>
          {etaCopy}
        </div>
      )}
    </div>
  );
}
