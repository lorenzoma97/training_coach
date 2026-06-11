// PlanPage (P1 nav piatta, 2026-06-11) — tab top-level "Piano".
// Header semplice + PlanTab (programma + settimana) + Mobility & Recovery
// (migrata qui dall'ex tab Tools: è una risorsa d'allenamento, non un tool).

import PlanTab from "../components/macroprogram/PlanTab";
import MobilityLibrary from "../components/mobility/MobilityLibrary";

export default function PlanPage() {
  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px 20px 8px" }}>
      <h1 style={{ fontSize: "22px", fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.02em" }}>Piano</h1>
      <PlanTab />
      <details style={{
        marginTop: "14px", background: "#16213E",
        border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", overflow: "hidden",
      }}>
        <summary style={{
          cursor: "pointer", listStyle: "none", padding: "14px 16px", minHeight: "44px",
          display: "flex", alignItems: "center", gap: "8px",
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em",
          color: "#94A3B8", textTransform: "uppercase",
        }}>
          <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', monospace" }}>▸</span>
          Mobility & Recovery
        </summary>
        <div style={{ padding: "0 16px 16px" }}>
          <MobilityLibrary />
        </div>
      </details>
    </div>
  );
}
