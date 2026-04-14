import { useEffect, useState } from "react";
import { getJSON } from "../lib/storage";
import type { TrainingPlan } from "../lib/types";
import { events } from "../lib/events";

export default function TrainingPlanView() {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);

  const load = async () => setPlan(await getJSON<TrainingPlan | null>("training-plan", null));

  useEffect(() => {
    load();
    const off = events.on("plan:updated", load);
    return off;
  }, []);

  if (!plan) {
    return (
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "24px 20px", border: "1px dashed rgba(255,255,255,0.1)", textAlign: "center", color: "#94A3B8" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }}>🗺</div>
        <div style={{ fontSize: "14px", marginBottom: "4px" }}>Nessun piano attivo</div>
        <div style={{ fontSize: "12px" }}>Completa l'onboarding per generare un piano personalizzato.</div>
      </div>
    );
  }

  const today = new Date().getDay(); // 0=dom..6=sab
  const DAY_MAP = ["dom","lun","mar","mer","gio","ven","sab"];
  const todayKey = DAY_MAP[today];

  const registerToday = (type: string) => {
    events.emit("diary:openAdd", { type });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "16px 18px", borderLeft: "3px solid #E8553A" }}>
        <div style={{ fontSize: "11px", color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px", fontWeight: 600 }}>Razionale del piano</div>
        <div style={{ fontSize: "14px", lineHeight: 1.5 }}>{plan.rationale}</div>
      </div>
      {plan.weeks.map(w => (
        <div key={w.weekNumber} style={{ background: "#16213E", borderRadius: "14px", padding: "18px 20px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase" }}>Settimana {w.weekNumber}</div>
            <div style={{ fontSize: "13px", color: "#CBD5E1", fontWeight: 600 }}>{w.focus}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {w.sessions.map((s, i) => {
              const isToday = w.weekNumber === 1 && s.day === todayKey;
              return (
                <div key={i} style={{
                  padding: "12px 14px",
                  background: isToday ? "#E8553A15" : "#1A1A2E",
                  border: isToday ? "1px solid #E8553A66" : "1px solid transparent",
                  borderRadius: "10px", fontSize: "13px",
                }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "3px" }}>
                    <span style={{ fontWeight: 700, textTransform: "uppercase", color: isToday ? "#E8553A" : "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "32px" }}>{s.day}</span>
                    <span style={{ fontWeight: 600 }}>{s.type}{s.subtype ? ` · ${s.subtype}` : ""}</span>
                    <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>{s.duration_min}min</span>
                    {isToday && <span style={{ color: "#E8553A", fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>OGGI</span>}
                  </div>
                  <div style={{ color: "#CBD5E1", lineHeight: 1.5 }}>{s.details}</div>
                  <div style={{ color: "#94A3B8", fontSize: "12px", fontStyle: "italic", marginTop: "6px", lineHeight: 1.5 }}>{s.rationale}</div>
                  {isToday && (
                    <button onClick={() => registerToday(s.type)} style={{
                      marginTop: "10px", padding: "10px 14px",
                      background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
                      border: "none", borderRadius: "10px", color: "#FFF",
                      fontSize: "13px", fontWeight: 700, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "6px",
                    }}>
                      <span>+</span> Registra questa sessione
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ fontSize: "11px", color: "#94A3B8", textAlign: "center" }}>
        Generato {new Date(plan.generatedAt).toLocaleDateString("it-IT")} — Valido fino al {new Date(plan.validUntil).toLocaleDateString("it-IT")}
      </div>
    </div>
  );
}
