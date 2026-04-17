// Sezione "Calibra la tua FCmax con un test sul campo".
// Protocollo step-by-step (5km warmup + 3min hard + 2min recupero + 3min all-out)
// + input del valore osservato. Salva in UserProfile.fcMaxTested + fcMaxTestedAt.
// Sovrascrive la stima Tanaka nel calcolo delle zone FC.

import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { UserProfile } from "../lib/types";
import { events } from "../lib/events";

function tanakaFCmax(age: number): number {
  return Math.round(208 - 0.7 * age);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateIT(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

/** Mesi dal test (indicativo, 30gg/mese). */
function monthsSince(iso: string): number {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    const ms = Date.now() - new Date(y, m - 1, d).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24 * 30));
  } catch { return 0; }
}

export default function FCMaxTestSection() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editValue, setEditValue] = useState<string>("");
  const [editDate, setEditDate] = useState<string>(todayISO());
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const load = async () => {
    const p = await getJSON<UserProfile | null>("user-profile", null);
    setProfile(p);
    if (p?.fcMaxTested) setEditValue(String(p.fcMaxTested));
    if (p?.fcMaxTestedAt) setEditDate(p.fcMaxTestedAt);
  };

  useEffect(() => { load(); }, []);

  if (!profile) {
    return (
      <div style={{ color: "#94A3B8", fontSize: "13px", fontStyle: "italic" }}>
        Completa prima l'onboarding per calibrare la FCmax.
      </div>
    );
  }

  const tanaka = tanakaFCmax(profile.age);
  const hasTest = typeof profile.fcMaxTested === "number";
  const testAge = profile.fcMaxTestedAt ? monthsSince(profile.fcMaxTestedAt) : 0;
  const testIsStale = hasTest && testAge >= 6;

  const save = async () => {
    setValidationError(null);
    const n = Number(editValue);
    if (!Number.isFinite(n)) { setValidationError("Inserisci un numero valido."); return; }
    if (n < 140 || n > 220) {
      setValidationError(`Valore fuori range fisiologico (140-220 bpm). Per la tua età Tanaka stima ~${tanaka} bpm.`);
      return;
    }
    if (n < tanaka - 25) {
      setValidationError(`Valore molto sotto la stima (${tanaka}). Hai davvero raggiunto l'all-out? Ripeti il test se non sei sicuro.`);
      return;
    }
    setSaving(true);
    try {
      const updated: UserProfile = {
        ...profile,
        fcMaxTested: Math.round(n),
        fcMaxTestedAt: editDate || todayISO(),
        updatedAt: new Date().toISOString(),
      };
      await setJSON("user-profile", updated);
      events.emit("profile:updated", { at: new Date().toISOString() });
      setProfile(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  };

  const clearTest = async () => {
    if (!confirm("Rimuovere il valore di FCmax testata? Le zone torneranno a usare la stima Tanaka.")) return;
    setSaving(true);
    try {
      const updated: UserProfile = {
        ...profile,
        fcMaxTested: undefined,
        fcMaxTestedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      await setJSON("user-profile", updated);
      events.emit("profile:updated", { at: new Date().toISOString() });
      setProfile(updated);
      setEditValue("");
      setEditDate(todayISO());
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" };
  const inputStyle = {
    width: "100%", padding: "11px 14px", background: "#1A1A2E",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
    color: "#E2E8F0", fontSize: "15px", outline: "none", boxSizing: "border-box" as const,
    fontFamily: "'JetBrains Mono', monospace",
  };

  return (
    <div style={{
      background: "#1A1A2E",
      border: `1px solid ${hasTest ? "#22C55E44" : "#E8553A44"}`,
      borderRadius: "10px",
      padding: "14px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: hasTest ? "#22C55E" : "#E8553A", fontWeight: 700, fontSize: "13px" }}>
            {hasTest ? "✓ FCmax calibrata" : "🎯 Calibra la tua FCmax"}
          </div>
          <div style={{ color: "#94A3B8", fontSize: "12px", marginTop: "2px", lineHeight: 1.4 }}>
            {hasTest ? (
              <>
                <b style={{ color: "#E2E8F0", fontFamily: "'JetBrains Mono', monospace" }}>{profile.fcMaxTested} bpm</b>
                {profile.fcMaxTestedAt && <> · test del {formatDateIT(profile.fcMaxTestedAt)}</>}
                {testIsStale && <span style={{ color: "#F59E0B", marginLeft: "6px" }}>· ⚠ ripeti (≥6 mesi)</span>}
              </>
            ) : (
              <>Ora uso la stima Tanaka ({tanaka} bpm, errore ±10-15 bpm). Un test sul campo rende le zone più accurate.</>
            )}
          </div>
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{
          padding: "8px 14px",
          background: hasTest ? "transparent" : "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
          border: hasTest ? "1px solid rgba(255,255,255,0.15)" : "none",
          borderRadius: "8px",
          color: hasTest ? "#CBD5E1" : "#FFF",
          fontWeight: 700, fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" as const,
        }}>
          {expanded ? "Chiudi" : hasTest ? "Aggiorna" : "Come fare il test"}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{
            background: "#0F172A",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "8px",
            padding: "12px 14px",
            fontSize: "12px",
            color: "#CBD5E1",
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 700, color: "#E2E8F0", marginBottom: "6px" }}>Protocollo del test (~15 min totali)</div>
            <div style={{ marginBottom: "8px", color: "#94A3B8" }}>
              Esegui su terreno pianeggiante o pista, con cardiofrequenzimetro <b>a fascia toracica</b> (i sensori da polso sottostimano sotto sforzo).
              Sii riposato: no workout duro nelle 48h precedenti.
            </div>
            <ol style={{ margin: "0 0 8px 18px", padding: 0 }}>
              <li><b>5 min</b> di corsa lenta (riscaldamento a passo conversazionale).</li>
              <li><b>5 min</b> di corsa progressiva fino a ~85% della tua FC percepita come alta.</li>
              <li><b>3 min hard</b>: passo sostenuto forte, appena sotto il "non ce la faccio più".</li>
              <li><b>2 min</b> di recupero lento (trotto/camminata).</li>
              <li><b>3 min all-out finale</b>: spingi al massimo, con l'ultimo minuto a sprint totale.</li>
            </ol>
            <div style={{ color: "#94A3B8" }}>
              La <b>FC più alta</b> registrata durante il test (di solito negli ultimi secondi del 5°) = la tua FCmax.
              Stima Tanaka per riferimento: <b style={{ color: "#E2E8F0" }}>{tanaka} bpm</b> (errore individuale ±10-15 bpm).
            </div>
            <div style={{ color: "#F59E0B", marginTop: "8px", fontSize: "11px" }}>
              ⚠ Evita se hai patologie cardiovascolari non note o non sei abituato a sforzi massimali. In dubbio, chiedi al medico.
            </div>
          </div>

          <div>
            <label style={labelStyle}>FCmax raggiunta (bpm)</label>
            <input
              type="number"
              inputMode="numeric"
              style={inputStyle}
              value={editValue}
              onChange={e => { setEditValue(e.target.value); setValidationError(null); }}
              placeholder={`es. ${tanaka + 5}`}
              min={140}
              max={220}
            />
          </div>

          <div>
            <label style={labelStyle}>Data del test</label>
            <input
              type="date"
              style={inputStyle}
              value={editDate}
              onChange={e => setEditDate(e.target.value)}
              max={todayISO()}
            />
          </div>

          {validationError && (
            <div style={{ color: "#F59E0B", fontSize: "12px", background: "#F59E0B15", padding: "8px 10px", borderRadius: "6px" }}>
              {validationError}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
            <button onClick={save} disabled={saving || !editValue} style={{
              padding: "10px 16px",
              background: "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
              border: "none", borderRadius: "10px", color: "#FFF",
              fontWeight: 700, cursor: saving ? "wait" : "pointer",
              opacity: (saving || !editValue) ? 0.5 : 1,
            }}>
              {saving ? "Salvo…" : savedFlash ? "✓ Salvato" : hasTest ? "Aggiorna FCmax" : "Salva FCmax testata"}
            </button>
            {hasTest && (
              <button onClick={clearTest} disabled={saving} style={{
                padding: "10px 14px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px",
                color: "#94A3B8", fontWeight: 600, cursor: saving ? "wait" : "pointer",
              }}>
                Rimuovi
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
