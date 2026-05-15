// Sezione "Calibra il LTHR (Lactate Threshold HR) con un test sul campo".
// Protocollo Friel 30-min time trial. Salva in UserProfile.ltThreshold_bpm
// + ltThresholdTestedAt. Se presente, sovrascrive %FCmax per Z3-Z5 (zone più
// precise per atleti con test field-based).
//
// Wave B1 audit 2 — gold standard coach pro endurance.

import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { UserProfile } from "../lib/types";
import { events } from "../lib/events";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateIT(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  } catch { return iso; }
}

function monthsSince(iso: string): number {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    const ms = Date.now() - new Date(y, m - 1, d).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24 * 30));
  } catch { return 0; }
}

export default function LTThresholdSection() {
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
    if (p?.ltThreshold_bpm) setEditValue(String(p.ltThreshold_bpm));
    if (p?.ltThresholdTestedAt) setEditDate(p.ltThresholdTestedAt);
  };

  useEffect(() => { load(); }, []);

  if (!profile) {
    return (
      <div style={{ color: "#94A3B8", fontSize: "13px", fontStyle: "italic" }}>
        Completa prima l'onboarding per calibrare il LTHR.
      </div>
    );
  }

  const hasTest = typeof profile.ltThreshold_bpm === "number";
  const testAge = profile.ltThresholdTestedAt ? monthsSince(profile.ltThresholdTestedAt) : 0;
  const testIsStale = hasTest && testAge >= 6;

  const save = async () => {
    setValidationError(null);
    const n = Number(editValue);
    if (!Number.isFinite(n)) { setValidationError("Inserisci un numero valido."); return; }
    if (n < 100 || n > 220) {
      setValidationError("Valore fuori range fisiologico (100-220 bpm).");
      return;
    }
    if (typeof profile.fcMaxTested === "number" && n > profile.fcMaxTested) {
      setValidationError(`LTHR (${n}) non può essere superiore alla FCmax testata (${profile.fcMaxTested}).`);
      return;
    }
    setSaving(true);
    try {
      const updated: UserProfile = {
        ...profile,
        ltThreshold_bpm: Math.round(n),
        ltThresholdTestedAt: editDate || todayISO(),
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
    if (!confirm("Rimuovere il valore di LTHR? Le zone Z3-Z5 torneranno a usare %FCmax/Karvonen.")) return;
    setSaving(true);
    try {
      const updated: UserProfile = {
        ...profile,
        ltThreshold_bpm: undefined,
        ltThresholdTestedAt: undefined,
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
      border: `1px solid ${hasTest ? "#22C55E44" : "#0891B244"}`,
      borderRadius: "10px",
      padding: "14px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: hasTest ? "#22C55E" : "#0891B2", fontWeight: 700, fontSize: "13px" }}>
            {hasTest ? "✓ LTHR calibrato" : "⚡ Calibra il LTHR (lactate threshold)"}
          </div>
          <div style={{ color: "#94A3B8", fontSize: "12px", marginTop: "2px", lineHeight: 1.4 }}>
            {hasTest ? (
              <>
                <b style={{ color: "#E2E8F0", fontFamily: "'JetBrains Mono', monospace" }}>{profile.ltThreshold_bpm} bpm</b>
                {profile.ltThresholdTestedAt && <> · test del {formatDateIT(profile.ltThresholdTestedAt)}</>}
                {testIsStale && <span style={{ color: "#F59E0B", marginLeft: "6px" }}>· ⚠ ripeti (≥6 mesi)</span>}
              </>
            ) : (
              <>Test field-based (Friel) per zone Z3-Z5 più precise di %FCmax. Gold standard endurance coaching.</>
            )}
          </div>
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{
          padding: "8px 14px",
          background: hasTest ? "transparent" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
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
            <div style={{ fontWeight: 700, color: "#E2E8F0", marginBottom: "6px" }}>Protocollo Friel 30-min time trial</div>
            <div style={{ marginBottom: "8px", color: "#94A3B8" }}>
              Esegui da solo (no compagni che ti tirano), su pista o terreno pianeggiante,
              con cardiofrequenzimetro <b>a fascia toracica</b>. Sii riposato (no workout duro 48h prima).
            </div>
            <ol style={{ margin: "0 0 8px 18px", padding: 0 }}>
              <li><b>10 min</b> di riscaldamento progressivo (5 lento + 5 a passo medio).</li>
              <li><b>30 min all-out</b>: spingi al massimo sostenibile per 30 minuti continuativi (non sprint, ma sopra-soglia controllato).</li>
              <li>A 10 minuti dell'inizio del 30-min, premi <b>LAP</b> sull'orologio.</li>
              <li><b>FC media degli ULTIMI 20 minuti</b> ≈ il tuo LTHR (Friel approx).</li>
              <li>5-10 min defaticamento.</li>
            </ol>
            <div style={{ color: "#94A3B8" }}>
              Friel: zone Z3=90-94% LTHR, Z4=95-99% LTHR, Z5=100-106% LTHR.
              Più preciso di %FCmax perché la soglia è il vero pivot fisiologico.
            </div>
            <div style={{ color: "#F59E0B", marginTop: "8px", fontSize: "11px" }}>
              ⚠ Test esigente: evita se non sei abituato a sforzi sostenuti. Ripeti ogni 6-12 mesi.
            </div>
          </div>

          <div>
            <label style={labelStyle}>LTHR misurato (bpm)</label>
            <input
              type="number"
              inputMode="numeric"
              style={inputStyle}
              value={editValue}
              onChange={e => { setEditValue(e.target.value); setValidationError(null); }}
              placeholder="es. 170"
              min={100}
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
              {saving ? "Salvo…" : savedFlash ? "✓ Salvato" : hasTest ? "Aggiorna LTHR" : "Salva LTHR"}
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
