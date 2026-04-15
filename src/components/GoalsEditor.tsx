// Editor degli obiettivi utente (post-onboarding). Permette di:
// - Vedere i goal attivi con KPI + reasoning del coach
// - Modificare un goal esistente (ri-verifica via feasibility)
// - Accettare controproposta coach oppure tenere l'originale
// - Rimuovere / aggiungere (max 3 attivi)
// Riutilizzato sia in Settings (sezione "Obiettivi") sia nel tab Coach.

import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { UserProfile, UserGoal, FeasibilityCheck } from "../lib/types";
import { checkGoalFeasibility } from "../lib/coach/feasibility";
import { translateGeminiError } from "../lib/geminiErrors";
import { events } from "../lib/events";

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

  const load = async () => {
    const [p, g] = await Promise.all([
      getJSON<UserProfile | null>("user-profile", null),
      getJSON<UserGoal[]>("user-goals", []),
    ]);
    setProfile(p);
    setGoals(g);
  };

  useEffect(() => { load(); }, []);

  const persistGoals = async (next: UserGoal[]) => {
    await setJSON("user-goals", next);
    setGoals(next);
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
    if (!confirm("Rimuovere questo obiettivo? L'azione è reversibile solo ricreandolo.")) return;
    await persistGoals(goals.filter(g => g.id !== id));
    if (editingId === id) cancelEdit();
  };

  const toggleStatus = async (id: string, newStatus: UserGoal["status"]) => {
    await persistGoals(goals.map(g => g.id === id ? { ...g, status: newStatus } : g));
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
      <div style={{ color: "#94A3B8", fontSize: "13px", fontStyle: "italic", padding: "8px 0" }}>
        Completa l'onboarding del profilo per gestire gli obiettivi.
      </div>
    );
  }

  const activeGoals = goals.filter(g => g.status !== "archived");
  const canAdd = activeGoals.length < MAX_GOALS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {goals.length === 0 && !adding && (
        <div style={{ ...cardStyle, textAlign: "center", color: "#94A3B8", fontSize: "13px" }}>
          Nessun obiettivo impostato. Aggiungine uno per orientare il coach.
        </div>
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
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "6px", color: "#E2E8F0", lineHeight: 1.4 }}>
                  {g.smartDescription}
                </div>
                <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "8px", fontFamily: "'JetBrains Mono', monospace" }}>
                  {g.kpi.metric}: {g.kpi.target} — {g.kpi.deadline}
                </div>
                {g.originalDescription && g.originalDescription !== g.smartDescription && (
                  <div style={{ fontSize: "12px", color: "#64748B", fontStyle: "italic", marginBottom: "8px" }}>
                    Originale: "{g.originalDescription}"
                  </div>
                )}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button onClick={() => startEdit(g)} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px" }}>Modifica</button>
                  {g.status === "active" && (
                    <button onClick={() => toggleStatus(g.id, "achieved")} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px", borderColor: "#22C55E66", color: "#22C55E" }}>✓ Raggiunto</button>
                  )}
                  {g.status === "active" && (
                    <button onClick={() => toggleStatus(g.id, "archived")} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px" }}>Archivia</button>
                  )}
                  {g.status === "archived" && (
                    <button onClick={() => toggleStatus(g.id, "active")} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px", borderColor: "#E8553A66", color: "#E8553A" }}>Riattiva</button>
                  )}
                  <button onClick={() => removeGoal(g.id)} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px", borderColor: "#EF444444", color: "#EF4444" }}>Rimuovi</button>
                </div>
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
        Modificare un obiettivo non rigenera automaticamente il piano — vai sul tab Coach e usa "Rigenera con dati recenti" o "Adatta con richiesta".
      </div>
    </div>
  );
}
