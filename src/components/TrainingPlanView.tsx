import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { TrainingPlan, UserProfile, UserGoal } from "../lib/types";
import { events } from "../lib/events";
import { buildCoachContext } from "../lib/diaryContext";
import { regenerateNextWeek, generateInitialPlan } from "../lib/coach/planGenerator";
import { translateGeminiError } from "../lib/geminiErrors";

export default function TrainingPlanView() {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const load = async () => setPlan(await getJSON<TrainingPlan | null>("training-plan", null));

  useEffect(() => {
    load();
    const off = events.on("plan:updated", load);
    return off;
  }, []);

  const handleRegenerate = async () => {
    if (regenerating) return;
    const msg = plan
      ? "Rigenerare il piano integrando i dati del diario degli ultimi 14 giorni?"
      : "Generare un nuovo piano basato su profilo e obiettivi?";
    if (!confirm(msg)) return;
    setRegenerating(true);
    setRegenError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      if (!profile) throw new Error("Profilo mancante. Completa l'onboarding.");
      let next: TrainingPlan;
      if (plan) {
        const ctx = await buildCoachContext({ daysBack: 14 });
        next = await regenerateNextWeek(profile, goals, plan, ctx.recentDaysText);
      } else {
        next = await generateInitialPlan(profile, goals);
      }
      await setJSON("training-plan", next);
      events.emit("plan:updated", { at: new Date().toISOString() });
      setPlan(next);
    } catch (e) {
      setRegenError(translateGeminiError(e));
    }
    setRegenerating(false);
  };

  const regenerateBtn = (
    <button
      onClick={handleRegenerate}
      disabled={regenerating}
      style={{
        padding: "10px 14px",
        background: regenerating ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
        border: "none", borderRadius: "10px", color: "#FFF",
        fontSize: "13px", fontWeight: 700,
        cursor: regenerating ? "wait" : "pointer",
        opacity: regenerating ? 0.5 : 1,
        width: "100%",
      }}
    >
      {regenerating ? "⏳ Rigenerazione…" : (plan ? "🔁 Rigenera piano (integra dati recenti)" : "🎯 Genera piano")}
    </button>
  );

  if (!plan) {
    return (
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "24px 20px", border: "1px dashed rgba(255,255,255,0.1)", textAlign: "center", color: "#94A3B8" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }}>🗺</div>
        <div style={{ fontSize: "14px", marginBottom: "4px" }}>Nessun piano attivo</div>
        <div style={{ fontSize: "12px", marginBottom: "16px" }}>Genera un piano personalizzato dal tuo profilo + obiettivi.</div>
        {regenerateBtn}
        {regenError && <div style={{ color: "#EF4444", fontSize: "12px", marginTop: "10px" }}>{regenError}</div>}
      </div>
    );
  }

  const today = new Date().getDay();
  const DAY_MAP = ["dom","lun","mar","mer","gio","ven","sab"];
  const todayKey = DAY_MAP[today];

  const registerToday = (type: string) => {
    events.emit("diary:openAdd", { type });
  };

  // Calcola giorni rimanenti al piano
  const validUntilDate = new Date(plan.validUntil);
  const daysLeft = Math.max(0, Math.round((validUntilDate.getTime() - Date.now()) / (24 * 3600 * 1000)));
  const isExpiringSoon = daysLeft <= 3;
  const isExpired = daysLeft === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "16px 18px", borderLeft: "3px solid #E8553A" }}>
        <div style={{ fontSize: "11px", color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px", fontWeight: 600 }}>Razionale del piano</div>
        <div style={{ fontSize: "14px", lineHeight: 1.5 }}>{plan.rationale}</div>
      </div>

      {(isExpiringSoon || isExpired) && (
        <div style={{
          background: isExpired ? "#EF444415" : "#F59E0B15",
          border: `1px solid ${isExpired ? "#EF444466" : "#F59E0B66"}`,
          borderRadius: "12px", padding: "12px 14px",
        }}>
          <div style={{ fontSize: "12px", color: isExpired ? "#EF4444" : "#F59E0B", fontWeight: 700, marginBottom: "4px" }}>
            {isExpired ? "⚠ Piano scaduto" : `⏰ Piano in scadenza (${daysLeft} giorni)`}
          </div>
          <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>
            {isExpired ? "Rigenera il piano per ricevere sessioni aggiornate." : "Presto il coach dovrà produrre il microciclo successivo."}
          </div>
        </div>
      )}

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

      <div style={{ marginTop: "4px" }}>
        {regenerateBtn}
        {regenError && <div style={{ color: "#EF4444", fontSize: "12px", marginTop: "8px", textAlign: "center" }}>{regenError}</div>}
      </div>

      <div style={{ fontSize: "11px", color: "#94A3B8", textAlign: "center" }}>
        Generato {new Date(plan.generatedAt).toLocaleDateString("it-IT")} — Valido fino al {new Date(plan.validUntil).toLocaleDateString("it-IT")}
      </div>
    </div>
  );
}
