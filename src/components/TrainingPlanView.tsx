import { useEffect, useMemo, useRef, useState } from "react";
import { getJSON } from "../lib/storage";
import type { TrainingPlan, UserProfile, UserGoal } from "../lib/types";
import { events } from "../lib/events";
import { buildCoachContext, getLastNDays } from "../lib/diaryContext";
import { regenerateNextWeek, generateInitialPlan, adaptPlan } from "../lib/coach/planGenerator";
import { translateGeminiError } from "../lib/geminiErrors";
import { profileHashForPlan } from "../lib/coach/planValidator";
import { savePlanWithHistory, getPlanHistory } from "../lib/coach/planHistory";

const ADAPT_QUICK_PROMPTS = [
  "Più intenso",
  "Più leggero",
  "Settimana di deload",
  "Aggiungi più forza",
  "Non posso allenarmi giovedì",
];

export default function TrainingPlanView() {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);
  const [recentDays, setRecentDays] = useState<Array<{ date: string; workouts: any[] }>>([]);
  const [history, setHistory] = useState<TrainingPlan[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Adatta piano
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptRequest, setAdaptRequest] = useState("");
  const [adapting, setAdapting] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);

  // Notifica successo post-update
  const [successMsg, setSuccessMsg] = useState<{ title: string; rationale: string } | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const showSuccess = (title: string, rationale: string) => {
    setSuccessMsg({ title, rationale });
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMsg(null), 12000);
  };

  const load = async () => {
    const [p, profile, days, hist] = await Promise.all([
      getJSON<TrainingPlan | null>("training-plan", null),
      getJSON<UserProfile | null>("user-profile", null),
      getLastNDays(14),
      getPlanHistory(),
    ]);
    setPlan(p);
    setCurrentProfile(profile);
    setRecentDays(days);
    setHistory(hist);
  };

  useEffect(() => {
    load();
    const offPlan = events.on("plan:updated", load);
    const offProfile = events.on("profile:updated", load);
    const offWorkout = events.on("workout:saved", load);
    return () => { offPlan(); offProfile(); offWorkout(); };
  }, []);

  // Profile hash check: se il profilo è cambiato rispetto al piano, segnala obsolescenza.
  const profileDrift = useMemo(() => {
    if (!plan || !currentProfile || !plan.profileHash) return false;
    return plan.profileHash !== profileHashForPlan(currentProfile);
  }, [plan, currentProfile]);

  // Matching piano↔diario: per ogni giorno del piano, controlla se nel diario c'è un workout
  // registrato in quella data. Restituisce set di chiavi "weekN-dayStr" completate.
  const completedSessions = useMemo(() => {
    if (!plan || !plan.startDate || !recentDays.length) return new Set<string>();
    const done = new Set<string>();
    const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
    const [sy, sm, sd] = plan.startDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    for (let w = 0; w < plan.weeks.length; w++) {
      const week = plan.weeks[w];
      for (const s of week.sessions) {
        const dayIdx = DAY_KEYS.indexOf(s.day);
        if (dayIdx < 0) continue;
        const sessionDate = new Date(start);
        sessionDate.setDate(start.getDate() + w * 7 + dayIdx);
        const y = sessionDate.getFullYear();
        const m = String(sessionDate.getMonth() + 1).padStart(2, "0");
        const d = String(sessionDate.getDate()).padStart(2, "0");
        const dateKey = `${y}-${m}-${d}`;
        const dayEntry = recentDays.find((rd: { date: string; workouts: any[] }) => rd.date === dateKey);
        if (dayEntry && (dayEntry.workouts || []).length > 0) {
          done.add(`${week.weekNumber}-${s.day}-${sessionDate.getTime()}`);
        }
      }
    }
    return done;
  }, [plan, recentDays]);

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
      let title: string;
      if (plan) {
        const ctx = await buildCoachContext({ daysBack: 14 });
        next = await regenerateNextWeek(profile, goals, plan, ctx.recentDaysText);
        title = "✓ Piano rigenerato con i dati recenti";
      } else {
        next = await generateInitialPlan(profile, goals);
        title = "✓ Piano iniziale generato";
      }
      // Archivia il piano corrente nello storico prima di sovrascrivere (se esiste)
      await savePlanWithHistory(next);
      events.emit("plan:updated", { at: new Date().toISOString() });
      setPlan(next);
      showSuccess(title, next.rationale);
    } catch (e) {
      setRegenError(translateGeminiError(e));
    }
    setRegenerating(false);
  };

  const handleAdapt = async (requestText?: string) => {
    const req = (requestText ?? adaptRequest).trim();
    if (!req || adapting || !plan) return;
    setAdapting(true);
    setAdaptError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      if (!profile) throw new Error("Profilo mancante.");
      const ctx = await buildCoachContext({ daysBack: 14 });
      const next = await adaptPlan(profile, goals, plan, ctx.recentDaysText, req);
      await savePlanWithHistory(next);
      events.emit("plan:updated", { at: new Date().toISOString() });
      setPlan(next);
      setAdaptRequest("");
      setAdaptOpen(false);
      showSuccess(`✓ Piano adattato — "${req}"`, next.rationale);
    } catch (e) {
      setAdaptError(translateGeminiError(e));
    }
    setAdapting(false);
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

  const todayDate = new Date();
  const DAY_MAP = ["dom","lun","mar","mer","gio","ven","sab"];
  const todayKey = DAY_MAP[todayDate.getDay()];

  // Se il piano ha startDate, calcoliamo in quale settimana siamo "oggi" rispetto al piano.
  // Altrimenti fallback legacy: week 1 == settimana corrente.
  const todayPlanWeekNumber = (() => {
    if (!plan.startDate) return 1;
    const [y, m, d] = plan.startDate.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const diffDays = Math.floor((todayDate.getTime() - start.getTime()) / (24 * 3600 * 1000));
    if (diffDays < 0) return 0; // piano non ancora iniziato
    return Math.floor(diffDays / 7) + 1; // 1-based
  })();

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
      {/* Banner notifica post-update */}
      {successMsg && (
        <div style={{
          background: "#14532D", border: "1px solid #22C55E66",
          borderRadius: "12px", padding: "14px 16px",
          animation: "slideUp 0.25s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#22C55E", flex: 1 }}>{successMsg.title}</div>
            <button onClick={() => setSuccessMsg(null)} aria-label="Chiudi" style={{
              background: "transparent", border: "none", color: "#94A3B8",
              cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "0 4px",
            }}>×</button>
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px", fontWeight: 600 }}>
            Cosa è cambiato
          </div>
          <div style={{ fontSize: "14px", color: "#E2E8F0", lineHeight: 1.5 }}>{successMsg.rationale}</div>
        </div>
      )}

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
          <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5, marginBottom: isExpired ? "10px" : 0 }}>
            {isExpired ? "Il piano sottostante non viene più mostrato per evitare confusione. Rigenera o adatta per riceverne uno aggiornato." : "Presto il coach dovrà produrre il microciclo successivo."}
          </div>
          {isExpired && (
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
              }}
            >
              {regenerating ? "⏳ Rigenerazione…" : "🔁 Rigenera ora"}
            </button>
          )}
        </div>
      )}

      {profileDrift && !isExpired && (
        <div style={{
          background: "#F59E0B15", border: "1px solid #F59E0B66",
          borderRadius: "12px", padding: "12px 14px",
        }}>
          <div style={{ fontSize: "12px", color: "#F59E0B", fontWeight: 700, marginBottom: "4px" }}>
            ⚠ Profilo cambiato dopo la generazione
          </div>
          <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>
            Età, esperienza, infortuni, disponibilità o aree dolore sono state modificate. Il piano corrente potrebbe non essere più ottimale — considera una rigenerazione.
          </div>
        </div>
      )}

      {!isExpired && plan.weeks.map((w: TrainingPlan["weeks"][number]) => (
        <div key={w.weekNumber} style={{ background: "#16213E", borderRadius: "14px", padding: "18px 20px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase" }}>Settimana {w.weekNumber}</div>
            <div style={{ fontSize: "13px", color: "#CBD5E1", fontWeight: 600 }}>{w.focus}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {w.sessions.map((s: TrainingPlan["weeks"][number]["sessions"][number], i: number) => {
              // "Oggi" = il giorno della settimana corrente del piano (non hardcoded week 1)
              const isToday = w.weekNumber === todayPlanWeekNumber && s.day === todayKey;
              // È nel passato (già dovrebbe essere stata fatta)?
              const isPast = w.weekNumber < todayPlanWeekNumber ||
                (w.weekNumber === todayPlanWeekNumber && ["lun","mar","mer","gio","ven","sab","dom"].indexOf(s.day) < ["lun","mar","mer","gio","ven","sab","dom"].indexOf(todayKey));
              // Matching con diario: sessione completata se c'è un workout in quel giorno
              let isCompleted = false;
              if (plan.startDate) {
                const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
                const dayIdx = DAY_KEYS.indexOf(s.day);
                if (dayIdx >= 0) {
                  const [sy, sm, sd] = plan.startDate.split("-").map(Number);
                  const start = new Date(sy, sm - 1, sd);
                  const sessionDate = new Date(start);
                  sessionDate.setDate(start.getDate() + (w.weekNumber - 1) * 7 + dayIdx);
                  isCompleted = completedSessions.has(`${w.weekNumber}-${s.day}-${sessionDate.getTime()}`);
                }
              }
              const bg = isCompleted ? "#14532D40" : isToday ? "#E8553A15" : isPast ? "#1A1A2E80" : "#1A1A2E";
              const borderColor = isCompleted ? "#22C55E66" : isToday ? "#E8553A66" : "transparent";
              return (
                <div key={`${w.weekNumber}-${s.day}-${i}`} style={{
                  padding: "12px 14px",
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: "10px", fontSize: "13px",
                  opacity: isPast && !isCompleted ? 0.55 : 1,
                }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "3px" }}>
                    <span style={{ fontWeight: 700, textTransform: "uppercase", color: isCompleted ? "#22C55E" : isToday ? "#E8553A" : "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "32px" }}>{s.day}</span>
                    <span style={{ fontWeight: 600 }}>{s.type}{s.subtype ? ` · ${s.subtype}` : ""}</span>
                    <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>{s.duration_min}min</span>
                    {isCompleted && <span style={{ color: "#22C55E", fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>✓ FATTA</span>}
                    {!isCompleted && isToday && <span style={{ color: "#E8553A", fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>OGGI</span>}
                    {!isCompleted && !isToday && isPast && <span style={{ color: "#64748B", fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>SALTATA</span>}
                  </div>
                  <div style={{ color: "#CBD5E1", lineHeight: 1.5 }}>{s.details}</div>
                  <div style={{ color: "#94A3B8", fontSize: "12px", fontStyle: "italic", marginTop: "6px", lineHeight: 1.5 }}>{s.rationale}</div>
                  {isToday && !isCompleted && (
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

      {/* Sezione modifica piano */}
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "16px 18px", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ fontSize: "11px", color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
          Modifica piano
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={() => { setAdaptOpen(o => !o); setAdaptError(null); }}
            disabled={adapting || regenerating}
            style={{
              flex: "1 1 140px", padding: "10px 14px",
              background: adaptOpen ? "#E8553A22" : "#1A1A2E",
              border: adaptOpen ? "1px solid #E8553A" : "1px solid rgba(255,255,255,0.12)",
              borderRadius: "10px", color: adaptOpen ? "#E8553A" : "#E2E8F0",
              fontSize: "13px", fontWeight: 700, cursor: "pointer",
            }}
          >
            ✏ Adatta con richiesta
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating || adapting}
            style={{
              flex: "1 1 140px", padding: "10px 14px",
              background: regenerating ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
              border: "none", borderRadius: "10px", color: "#FFF",
              fontSize: "13px", fontWeight: 700,
              cursor: regenerating ? "wait" : "pointer",
              opacity: regenerating ? 0.5 : 1,
            }}
          >
            {regenerating ? "⏳ Rigenerazione…" : "🔁 Rigenera con dati recenti"}
          </button>
        </div>

        {adaptOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>
              Dimmi cosa vuoi cambiare. Il coach rispetterà comunque le regole di sicurezza.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {ADAPT_QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => setAdaptRequest(p)}
                  disabled={adapting}
                  style={{
                    padding: "6px 12px", fontSize: "12px",
                    background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "999px", color: "#CBD5E1", cursor: "pointer",
                  }}
                >{p}</button>
              ))}
            </div>
            <textarea
              value={adaptRequest}
              onChange={e => setAdaptRequest(e.target.value)}
              placeholder="es. 'settimana più leggera perché ho un viaggio' o 'aumenta le ripetute'"
              disabled={adapting}
              rows={2}
              style={{
                width: "100%", padding: "10px 12px",
                background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px", color: "#E2E8F0", fontSize: "14px",
                fontFamily: "inherit", resize: "vertical", minHeight: "60px",
                outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => handleAdapt()}
                disabled={adapting || !adaptRequest.trim()}
                style={{
                  flex: 1, padding: "10px",
                  background: adapting ? "#1E293B" : "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
                  border: "none", borderRadius: "10px", color: "#FFF",
                  fontSize: "13px", fontWeight: 700,
                  cursor: adapting ? "wait" : "pointer",
                  opacity: (adapting || !adaptRequest.trim()) ? 0.5 : 1,
                }}
              >
                {adapting ? "⏳ Adatto il piano…" : "Applica modifica"}
              </button>
              <button
                onClick={() => { setAdaptOpen(false); setAdaptRequest(""); setAdaptError(null); }}
                disabled={adapting}
                style={{
                  padding: "10px 14px",
                  background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "10px", color: "#94A3B8",
                  fontSize: "13px", fontWeight: 600, cursor: "pointer",
                }}
              >Annulla</button>
            </div>
            {adaptError && <div style={{ color: "#EF4444", fontSize: "12px" }}>{adaptError}</div>}
          </div>
        )}

        {regenError && <div style={{ color: "#EF4444", fontSize: "12px" }}>{regenError}</div>}
      </div>

      {!isExpired && (
        <div style={{
          background: "#1A1A2E", borderRadius: "10px",
          padding: "10px 14px", fontSize: "12px", color: "#94A3B8",
          display: "flex", alignItems: "center", gap: "8px",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <span>📅</span>
          <span style={{ lineHeight: 1.5 }}>
            La settimana prossima verrà rigenerata automaticamente lunedì sui tuoi dati reali, oppure puoi farlo ora con "Rigenera con dati recenti".
          </span>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ background: "#16213E", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <button
            onClick={() => setHistoryOpen(o => !o)}
            aria-expanded={historyOpen}
            style={{
              width: "100%", padding: "14px 18px",
              background: "transparent", border: "none",
              color: "#CBD5E1", fontSize: "13px", fontWeight: 700,
              display: "flex", alignItems: "center", gap: "10px",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ fontSize: "16px", transform: historyOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▸</span>
            <span style={{ flex: 1 }}>Settimane precedenti</span>
            <span style={{ fontSize: "11px", color: "#94A3B8", fontWeight: 500 }}>{history.length} piani archiviati</span>
          </button>

          {historyOpen && (
            <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {history.map((h: TrainingPlan, hi: number) => (
                <div key={h.generatedAt + hi} style={{ background: "#1A1A2E", borderRadius: "10px", padding: "12px 14px", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "6px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      {h.startDate ? `Settimana del ${new Date(h.startDate + "T12:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" })}` : new Date(h.generatedAt).toLocaleDateString("it-IT")}
                    </div>
                  </div>
                  {h.rationale && (
                    <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "8px", lineHeight: 1.5, fontStyle: "italic" }}>
                      {h.rationale}
                    </div>
                  )}
                  {h.weeks.map((w: TrainingPlan["weeks"][number], wi: number) => (
                    <div key={wi} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {w.sessions.map((s: TrainingPlan["weeks"][number]["sessions"][number], si: number) => (
                        <div key={si} style={{ fontSize: "12px", padding: "6px 8px", background: "#0F172A", borderRadius: "6px", display: "flex", gap: "8px", alignItems: "baseline" }}>
                          <span style={{ fontWeight: 700, textTransform: "uppercase", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", minWidth: "28px" }}>{s.day}</span>
                          <span style={{ fontWeight: 600, color: "#CBD5E1" }}>{s.type}{s.subtype ? ` · ${s.subtype}` : ""}</span>
                          <span style={{ color: "#64748B", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px" }}>{s.duration_min}min</span>
                          <span style={{ color: "#64748B", fontSize: "11px", flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.details}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: "11px", color: "#94A3B8", textAlign: "center" }}>
        Generato {new Date(plan.generatedAt).toLocaleDateString("it-IT")} — Valido fino al {new Date(plan.validUntil).toLocaleDateString("it-IT")}
      </div>
    </div>
  );
}
