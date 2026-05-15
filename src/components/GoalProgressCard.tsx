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
  type GoalSignal,
} from "../lib/diaryContext";
import type { UserGoal } from "../lib/types";

const SIGNAL_META: Record<GoalSignal, { label: string; color: string; bg: string }> = {
  ahead:        { label: "AVANTI",          color: "#22C55E", bg: "#22C55E22" },
  aligned:      { label: "ALLINEATO",       color: "#0891B2", bg: "#0891B222" },
  behind:       { label: "DA ACCELERARE",   color: "#F59E0B", bg: "#F59E0B22" },
  very_behind:  { label: "MOLTO INDIETRO",  color: "#EF4444", bg: "#EF444422" },
  unknown:      { label: "DATI INSUFFICIENTI", color: "#94A3B8", bg: "#94A3B822" },
};

function formatValue(value: number | null, kind: GoalProgressData["kind"], unit: string): string {
  if (value == null) return "—";
  if (kind === "corsa") return formatPaceSec(value); // pace
  if (kind === "frequenza") return `${value.toFixed(1)}`;
  if (kind === "peso" || kind === "forza") return `${value.toFixed(1)}`;
  return value.toFixed(0);
}

function formatDelta(delta: number | null, kind: GoalProgressData["kind"]): string | null {
  if (delta == null) return null;
  const sign = delta > 0 ? "+" : "";
  if (kind === "corsa") {
    // delta in sec/km. Pace: positivo = più lento del target = peggio.
    const abs = Math.abs(delta);
    const sec = Math.round(abs);
    return `${delta > 0 ? "+" : "−"}${sec}s/km vs target`;
  }
  if (kind === "peso") return `${sign}${delta.toFixed(1)}kg vs target`;
  if (kind === "forza") return `${sign}${delta.toFixed(1)}kg vs target`;
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
  const sigMeta = SIGNAL_META[progress.signal];
  const currentStr = formatValue(progress.currentValue, progress.kind, progress.unit);
  const targetStr = progress.targetValue != null ? formatValue(progress.targetValue, progress.kind, progress.unit) : "—";
  const deltaStr = formatDelta(progress.deltaToTarget, progress.kind);

  // Sparkline color: matcha il segnale per immediatezza visiva
  const sparkColor =
    progress.signal === "ahead" ? "#22C55E" :
    progress.signal === "aligned" ? "#0891B2" :
    progress.signal === "behind" ? "#F59E0B" :
    progress.signal === "very_behind" ? "#EF4444" :
    "#94A3B8";

  // ETA copy
  let etaCopy = "";
  if (progress.weeksToDeadline != null) {
    if (progress.weeksToDeadline > 0) etaCopy = `${progress.weeksToDeadline} sett alla deadline`;
    else if (progress.weeksToDeadline === 0) etaCopy = "deadline questa settimana";
    else etaCopy = `deadline scaduta da ${-progress.weeksToDeadline} sett`;
  }

  return (
    <div style={{
      background: "#0F172A",
      border: `1px solid ${sigMeta.color}33`,
      borderRadius: "12px",
      padding: "12px 14px",
      marginTop: "10px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    }}>
      {/* Header: KPI corrente vs target + badge segnale */}
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
            <div style={{ fontSize: "11px", color: sigMeta.color, marginTop: "3px", fontWeight: 600 }}>
              {deltaStr}
            </div>
          )}
        </div>
        <div style={{
          padding: "5px 10px",
          background: sigMeta.bg,
          border: `1px solid ${sigMeta.color}55`,
          borderRadius: "999px",
          color: sigMeta.color,
          fontSize: "10px",
          fontWeight: 800,
          letterSpacing: "0.1em",
          whiteSpace: "nowrap",
        }}>
          {sigMeta.label}
        </div>
      </div>

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
          formatValue={progress.kind === "corsa" ? formatPaceSec : undefined}
          unit={progress.unit}
          ariaLabel={`Trend ${progress.unit} 8 settimane per goal ${goal.smartDescription}`}
        />
      </div>

      {/* Footer ETA */}
      {etaCopy && (
        <div style={{ fontSize: "11px", color: "#64748B" }}>
          {etaCopy}
        </div>
      )}
    </div>
  );
}
