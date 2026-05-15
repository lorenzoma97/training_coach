// Editor degli obiettivi utente (post-onboarding). Permette di:
// - Vedere i goal attivi con KPI + reasoning del coach
// - Modificare un goal esistente (ri-verifica via feasibility)
// - Accettare controproposta coach oppure tenere l'originale
// - Rimuovere / aggiungere (max 3 attivi)
// Riutilizzato sia in Settings (sezione "Obiettivi") sia nel tab Coach.

import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { UserProfile, UserGoal, TrainingPlan, FeasibilityCheck, GoalPriority } from "../lib/types";
import { checkGoalFeasibility } from "../lib/coach/feasibility";
import { regenerateNextWeek, generateInitialPlan } from "../lib/coach/planGenerator";
import { savePlanWithHistory } from "../lib/coach/planHistory";
import { buildCoachContext, getLastNDays, computeGoalProgress } from "../lib/diaryContext";
import GoalProgressCard from "./GoalProgressCard";
import { translateGeminiError } from "../lib/geminiErrors";
import { hasApiKey } from "../lib/gemini";
import { events } from "../lib/events";
import EmptyState from "./EmptyState";

const MAX_GOALS = 3;

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", background: "#1A1A2E",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
  color: "#E2E8F0", fontSize: "14px", outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 14px",
  background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
  border: "none", borderRadius: "10px", color: "#FFF",
  fontSize: "13px", fontWeight: 700, cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "9px 14px", background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px",
  color: "#CBD5E1", fontSize: "13px", fontWeight: 600, cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px", padding: "14px 16px",
};

export default function GoalsEditor() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [goals, setGoals] = useState<UserGoal[]>([]);

  // Modifica goal esistente (per id)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editCheck, setEditCheck] = useState<FeasibilityCheck | null>(null);
  const [editChecking, setEditChecking] = useState(false);
  const [editError, setEditError] = useState("");

  // Aggiungi nuovo goal
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCheck, setNewCheck] = useState<FeasibilityCheck | null>(null);
  const [newChecking, setNewChecking] = useState(false);
  const [newError, setNewError] = useState("");

  // Stato per rigenerazione piano da dentro GoalsEditor
  const [regenerating, setRegenerating] = useState(false);
  const [regenMsg, setRegenMsg] = useState<string | null>(null);
  const [goalsChanged, setGoalsChanged] = useState(false);

  // Wave audit 2 — Goal Progress UI: serve recentDays per computeGoalProgress.
  const [recentDays, setRecentDays] = useState<Awaited<ReturnType<typeof getLastNDays>>>([]);

  const load = async () => {
    const [p, g, rd] = await Promise.all([
      getJSON<UserProfile | null>("user-profile", null),
      getJSON<UserGoal[]>("user-goals", []),
      getLastNDays(60).catch(() => []),
    ]);
    setProfile(p);
    setGoals(g);
    setRecentDays(rd);
  };

  useEffect(() => { load(); }, []);

  // Reload recentDays su update piano/diario (mantiene progress aggiornato).
  useEffect(() => {
    const offPlan = events.on("plan:updated", () => { void load(); });
    return () => { offPlan(); };
  }, []);

  const handleRegenPlan = async () => {
    if (regenerating || !profile) return;
    setRegenerating(true);
    setRegenMsg(null);
    try {
      const currentPlan = await getJSON<TrainingPlan | null>("training-plan", null);
      let next: TrainingPlan;
      if (currentPlan) {
        const ctx = await buildCoachContext({ daysBack: 14 });
        next = await regenerateNextWeek(profile, goals, currentPlan, ctx.recentDaysText);
      } else {
        next = await generateInitialPlan(profile, goals);
      }
      await savePlanWithHistory(next);
      events.emit("plan:updated", { at: new Date().toISOString() });
      setGoalsChanged(false);
      setRegenMsg("✓ Piano rigenerato con i nuovi obiettivi");
      setTimeout(() => setRegenMsg(null), 5000);
    } catch (e) {
      setRegenMsg("✗ " + translateGeminiError(e));
    }
    setRegenerating(false);
  };

  const persistGoals = async (next: UserGoal[]) => {
    await setJSON("user-goals", next);
    setGoals(next);
    setGoalsChanged(true);
    events.emit("goals:updated", { at: new Date().toISOString() });
  };

  const startEdit = (g: UserGoal) => {
    setEditingId(g.id);
    setEditText(g.originalDescription || g.smartDescription);
    setEditCheck(null);
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
    setEditCheck(null);
    setEditError("");
  };

  const verifyEdit = async () => {
    if (!profile || !editText.trim()) return;
    setEditChecking(true);
    setEditError("");
    setEditCheck(null);
    try {
      const check = await checkGoalFeasibility(profile, editText.trim());
      setEditCheck(check);
    } catch (e: any) {
      setEditError(translateGeminiError(e));
    }
    setEditChecking(false);
  };

  const applyEdit = async (mode: "accept" | "keep") => {
    if (!editingId || !editCheck) return;
    const original = editText.trim();
    const next = goals.map(g => {
      if (g.id !== editingId) return g;
      return {
        ...g,
        originalDescription: original,
        smartDescription: mode === "accept" ? editCheck.counterProposal.description : original,
        kpi: editCheck.counterProposal.kpi,
        realistic: mode === "accept" ? editCheck.realistic : false,
        coachReasoning: mode === "accept"
          ? editCheck.reasoning
          : `Utente ha scelto di mantenere il goal originale. Ragionamento del coach: ${editCheck.reasoning}`,
      };
    });
    await persistGoals(next);
    cancelEdit();
  };

  const removeGoal = async (id: string) => {
    if (!confirm("Eliminare questo obiettivo? Potrai ricrearlo in seguito se cambi idea.")) return;
    await persistGoals(goals.filter(g => g.id !== id));
    if (editingId === id) cancelEdit();
  };

  const toggleStatus = async (id: string, newStatus: UserGoal["status"]) => {
    await persistGoals(goals.map(g => g.id === id ? { ...g, status: newStatus } : g));
  };

  const setPriority = async (id: string, priority: GoalPriority) => {
    await persistGoals(goals.map(g => g.id === id ? { ...g, priority } : g));
  };

  const moveGoal = async (id: string, direction: "up" | "down") => {
    const idx = goals.findIndex(g => g.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= goals.length) return;
    const next = [...goals];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    // Aggiorna sortOrder per riflettere il nuovo ordine
    const withOrder = next.map((g, i) => ({ ...g, sortOrder: i }));
    await persistGoals(withOrder);
  };

  const startAdd = () => {
    setAdding(true);
    setNewText("");
    setNewCheck(null);
    setNewError("");
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewText("");
    setNewCheck(null);
    setNewError("");
  };

  const verifyAdd = async () => {
    if (!profile || !newText.trim()) return;
    setNewChecking(true);
    setNewError("");
    setNewCheck(null);
    try {
      const check = await checkGoalFeasibility(profile, newText.trim());
      setNewCheck(check);
    } catch (e: any) {
      setNewError(translateGeminiError(e));
    }
    setNewChecking(false);
  };

  const applyAdd = async (mode: "accept" | "keep") => {
    if (!newCheck) return;
    const original = newText.trim();
    const goal: UserGoal = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      originalDescription: original,
      smartDescription: mode === "accept" ? newCheck.counterProposal.description : original,
      kpi: newCheck.counterProposal.kpi,
      realistic: mode === "accept" ? newCheck.realistic : false,
      coachReasoning: mode === "accept"
        ? newCheck.reasoning
        : `Utente ha scelto di mantenere il goal originale. Ragionamento del coach: ${newCheck.reasoning}`,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    await persistGoals([...goals, goal]);
    cancelAdd();
  };

  if (!profile) {
    return (
      <EmptyState
        title="Profilo non ancora configurato"
        description="Completa l'onboarding per impostare i tuoi obiettivi e ricevere un piano personalizzato."
        data-testid="goals-no-profile"
        compact
      />
    );
  }

  const activeGoals = goals.filter(g => g.status !== "archived");
  const canAdd = activeGoals.length < MAX_GOALS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* CTA rigenerazione piano dopo modifica obiettivi/priorità */}
      {goalsChanged && hasApiKey() && goals.length > 0 && (
        <div style={{
          background: "#E8553A15", border: "1px solid #E8553A66",
          borderRadius: "12px", padding: "12px 14px",
          display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: "160px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#E8553A", marginBottom: "2px" }}>
              Obiettivi modificati
            </div>
            <div style={{ fontSize: "11px", color: "#CBD5E1", lineHeight: 1.4 }}>
              Rigenera il piano per applicare le nuove priorità e modifiche.
            </div>
          </div>
          <button
            onClick={handleRegenPlan}
            disabled={regenerating}
            style={{
              padding: "10px 16px",
              background: regenerating ? "#1E293B" : "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
              border: "none", borderRadius: "10px", color: "#FFF",
              fontSize: "13px", fontWeight: 700,
              cursor: regenerating ? "wait" : "pointer",
              opacity: regenerating ? 0.5 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {regenerating ? "⏳ Rigenerazione…" : "🔁 Rigenera piano"}
          </button>
        </div>
      )}
      {regenMsg && (
        <div style={{ fontSize: "12px", color: regenMsg.startsWith("✓") ? "#22C55E" : "#EF4444", padding: "6px 0" }}>
          {regenMsg}
        </div>
      )}

      {goals.length === 0 && !adding && (
        <EmptyState
          title="Nessun obiettivo impostato"
          description="Aggiungi il primo obiettivo per orientare il piano e i feedback del coach."
          ctaLabel="Aggiungi obiettivo"
          onCta={startAdd}
          data-testid="goals-empty"
        />
      )}

      {goals.map(g => {
        const isEditing = editingId === g.id;
        const statusColor = g.status === "achieved" ? "#22C55E" : g.status === "archived" ? "#64748B" : "#E8553A";
        const statusLabel = g.status === "achieved" ? "Raggiunto" : g.status === "archived" ? "Archiviato" : "Attivo";
        return (
          <div key={g.id} style={{ ...cardStyle, borderLeft: `3px solid ${statusColor}`, opacity: g.status === "archived" ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, color: statusColor, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {statusLabel}
              </span>
              {!g.realistic && g.status !== "archived" && (
                <span style={{ fontSize: "10px", fontWeight: 700, color: "#F59E0B", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  · ambizioso (target utente)
                </span>
              )}
            </div>

            {!isEditing && (
              <>
                {/* Header sintetico: KPI + deadline + priorità chip inline. */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "15px", fontWeight: 800, color: "#E2E8F0", fontFamily: "'JetBrains Mono', monospace" }}>
                    {g.kpi.metric}: {g.kpi.target}
                  </div>
                  {g.kpi.deadline && g.kpi.deadline !== "-" && (
                    <span style={{ fontSize: "12px", color: "#E8553A", fontWeight: 600 }}>
                      · entro {g.kpi.deadline}
                    </span>
                  )}
                  {(() => {
                    const p = g.priority || "media";
                    const color = p === "alta" ? "#EF4444" : p === "media" ? "#F59E0B" : "#94A3B8";
                    return (
                      <span style={{
                        fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase", color,
                        padding: "2px 7px", borderRadius: "999px",
                        border: `1px solid ${color}66`, background: color + "15",
                        marginLeft: "auto", whiteSpace: "nowrap",
                      }}>{p}</span>
                    );
                  })()}
                </div>
                {/* Quick action sempre visibili: Modifica (touch ≥44px). */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                  <button onClick={() => startEdit(g)} style={{ ...ghostBtn, padding: "10px 14px", minHeight: "40px", fontSize: "12px" }}>Modifica</button>
                  <button onClick={() => removeGoal(g.id)} style={{ ...ghostBtn, padding: "10px 14px", minHeight: "40px", fontSize: "12px", borderColor: "#EF444444", color: "#EF4444" }}>Rimuovi</button>
                </div>
                {/* Wave audit 2 — Progress Card: solo per goal active.
                    Mostra KPI corrente vs target, sparkline 8 sett, segnale, ETA.
                    Logica in computeGoalProgress (diaryContext.ts). */}
                {g.status === "active" && (
                  <GoalProgressCard goal={g} progress={computeGoalProgress(g, recentDays, profile)} />
                )}
                {/* Avanzato: cambio priorità, riordino, stato. Collapsed di default. */}
                <details style={{ marginTop: "6px" }}>
                  <summary
                    style={{
                      cursor: "pointer", listStyle: "none",
                      fontSize: "11px", color: "#94A3B8", fontWeight: 600,
                      padding: "4px 0", minHeight: "28px",
                      display: "flex", alignItems: "center", gap: "5px",
                      userSelect: "none",
                    }}
                  >
                    <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', monospace" }}>▸</span>
                    Priorità, ordine, stato
                  </summary>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", color: "#94A3B8", fontWeight: 600 }}>Priorità:</span>
                    {(["alta", "media", "bassa"] as GoalPriority[]).map(p => {
                      const active = (g.priority || "media") === p;
                      const color = p === "alta" ? "#EF4444" : p === "media" ? "#F59E0B" : "#94A3B8";
                      return (
                        <button key={p} onClick={() => setPriority(g.id, p)} style={{
                          padding: "6px 10px", minHeight: "32px",
                          fontSize: "11px", fontWeight: 700,
                          borderRadius: "6px", cursor: "pointer",
                          background: active ? color + "25" : "transparent",
                          border: active ? `1px solid ${color}` : "1px solid rgba(255,255,255,0.08)",
                          color: active ? color : "#94A3B8",
                          textTransform: "capitalize",
                        }}>{p}</button>
                      );
                    })}
                    <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
                      <button onClick={() => moveGoal(g.id, "up")} disabled={goals.indexOf(g) === 0} title="Sposta su" style={{ ...ghostBtn, padding: "6px 10px", minHeight: "32px", fontSize: "12px", opacity: goals.indexOf(g) === 0 ? 0.3 : 1 }}>▲</button>
                      <button onClick={() => moveGoal(g.id, "down")} disabled={goals.indexOf(g) === goals.length - 1} title="Sposta giù" style={{ ...ghostBtn, padding: "6px 10px", minHeight: "32px", fontSize: "12px", opacity: goals.indexOf(g) === goals.length - 1 ? 0.3 : 1 }}>▼</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                    {g.status === "active" && (
                      <button onClick={() => toggleStatus(g.id, "achieved")} style={{ ...ghostBtn, padding: "8px 12px", minHeight: "36px", fontSize: "12px", borderColor: "#22C55E66", color: "#22C55E" }}>✓ Raggiunto</button>
                    )}
                    {g.status === "active" && (
                      <button onClick={() => toggleStatus(g.id, "archived")} style={{ ...ghostBtn, padding: "8px 12px", minHeight: "36px", fontSize: "12px" }}>Archivia</button>
                    )}
                    {g.status === "archived" && (
                      <button onClick={() => toggleStatus(g.id, "active")} style={{ ...ghostBtn, padding: "8px 12px", minHeight: "36px", fontSize: "12px", borderColor: "#E8553A66", color: "#E8553A" }}>Riattiva</button>
                    )}
                  </div>
                </details>
              </>
            )}

            {isEditing && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <textarea
                  style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
                  placeholder="es. correre 10 km sotto 55 minuti entro 8 settimane"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                />
                {editError && (
                  <div style={{ fontSize: "12px", color: "#EF4444", padding: "6px 10px", background: "#7F1D1D22", borderRadius: "8px" }}>{editError}</div>
                )}
                {editCheck && (
                  <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#0F172A", border: editCheck.realistic ? "1px solid #22C55E66" : "1px solid #F59E0B66" }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: editCheck.realistic ? "#22C55E" : "#F59E0B", textTransform: "uppercase", marginBottom: "6px" }}>
                      {editCheck.realistic ? "✓ Ben definito" : "Controproposta del coach"}
                    </div>
                    <div style={{ fontSize: "12px", color: "#CBD5E1", marginBottom: "8px", lineHeight: 1.5 }}>{editCheck.reasoning}</div>
                    <div style={{ background: "#1A1A2E", padding: "8px 10px", borderRadius: "8px" }}>
                      <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "2px" }}>{editCheck.counterProposal.description}</div>
                      <div style={{ fontSize: "11px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
                        {editCheck.counterProposal.kpi.metric}: {editCheck.counterProposal.kpi.target} — {editCheck.counterProposal.kpi.deadline}
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {!editCheck && (
                    <button onClick={verifyEdit} disabled={editChecking || !editText.trim()} style={{ ...primaryBtn, opacity: (editChecking || !editText.trim()) ? 0.5 : 1 }}>
                      {editChecking ? "Verifico…" : "Verifica col coach"}
                    </button>
                  )}
                  {editCheck && (
                    <>
                      <button onClick={() => applyEdit("accept")} style={primaryBtn}>
                        {editCheck.realistic ? "Conferma" : "Accetta proposta"}
                      </button>
                      {!editCheck.realistic && (
                        <button onClick={() => applyEdit("keep")} title="Tieni l'obiettivo originale accettando un carico più ambizioso" style={{ ...ghostBtn, borderColor: "#F59E0B66", color: "#F59E0B" }}>
                          💪 Tengo il mio
                        </button>
                      )}
                      <button onClick={() => { setEditCheck(null); }} style={ghostBtn}>Riprova</button>
                    </>
                  )}
                  <button onClick={cancelEdit} style={ghostBtn}>Annulla</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {adding && (
        <div style={{ ...cardStyle, borderLeft: "3px solid #E8553A" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
            Nuovo obiettivo
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: "60px", resize: "vertical", marginBottom: "8px" }}
            placeholder="es. correre 10 km sotto 55 minuti entro 8 settimane"
            value={newText}
            onChange={e => setNewText(e.target.value)}
          />
          {newError && (
            <div style={{ fontSize: "12px", color: "#EF4444", padding: "6px 10px", background: "#7F1D1D22", borderRadius: "8px", marginBottom: "8px" }}>{newError}</div>
          )}
          {newCheck && (
            <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#0F172A", border: newCheck.realistic ? "1px solid #22C55E66" : "1px solid #F59E0B66", marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: newCheck.realistic ? "#22C55E" : "#F59E0B", textTransform: "uppercase", marginBottom: "6px" }}>
                {newCheck.realistic ? "✓ Ben definito" : "Controproposta del coach"}
              </div>
              <div style={{ fontSize: "12px", color: "#CBD5E1", marginBottom: "8px", lineHeight: 1.5 }}>{newCheck.reasoning}</div>
              <div style={{ background: "#1A1A2E", padding: "8px 10px", borderRadius: "8px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "2px" }}>{newCheck.counterProposal.description}</div>
                <div style={{ fontSize: "11px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
                  {newCheck.counterProposal.kpi.metric}: {newCheck.counterProposal.kpi.target} — {newCheck.counterProposal.kpi.deadline}
                </div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {!newCheck && (
              <button onClick={verifyAdd} disabled={newChecking || !newText.trim()} style={{ ...primaryBtn, opacity: (newChecking || !newText.trim()) ? 0.5 : 1 }}>
                {newChecking ? "Verifico…" : "Verifica col coach"}
              </button>
            )}
            {newCheck && (
              <>
                <button onClick={() => applyAdd("accept")} style={primaryBtn}>
                  {newCheck.realistic ? "Conferma" : "Accetta proposta"}
                </button>
                {!newCheck.realistic && (
                  <button onClick={() => applyAdd("keep")} style={{ ...ghostBtn, borderColor: "#F59E0B66", color: "#F59E0B" }}>
                    💪 Tengo il mio
                  </button>
                )}
                <button onClick={() => setNewCheck(null)} style={ghostBtn}>Riprova</button>
              </>
            )}
            <button onClick={cancelAdd} style={ghostBtn}>Annulla</button>
          </div>
        </div>
      )}

      {!adding && canAdd && (
        <button onClick={startAdd} style={{ ...ghostBtn, alignSelf: "flex-start", borderStyle: "dashed", color: "#E8553A", borderColor: "#E8553A66" }}>
          + Aggiungi obiettivo
        </button>
      )}

      {!canAdd && !adding && (
        <div style={{ fontSize: "12px", color: "#94A3B8", fontStyle: "italic" }}>
          Massimo {MAX_GOALS} obiettivi attivi. Archiviane uno per aggiungerne un altro.
        </div>
      )}

      <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.5, marginTop: "6px" }}>
        Dopo aver modificato obiettivi o priorità, rigenera il piano per applicare le modifiche.
      </div>
    </div>
  );
}
