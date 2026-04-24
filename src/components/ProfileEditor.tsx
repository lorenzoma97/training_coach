// Editor del profilo utente per Settings — permette aggiornare campi che
// cambiano nel tempo: infortuni (puoi essere guarito), farmaci/integratori,
// zone dolore tracciate. NON include età/sesso/peso/altezza che si modificano
// raramente — per quelli c'è "Reset coach" + ri-onboarding.
//
// Pattern: read-on-mount, controlled inputs, save-on-blur per tag (CSV) e
// save esplicito per alterare painTrackingAreas (richiede consapevolezza).

import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { UserProfile } from "../lib/types";
import { events } from "../lib/events";

const SUGGESTED_AREAS = [
  "polpaccio", "ginocchio", "tendine d'achille", "schiena lombare",
  "schiena cervicale", "spalla", "anca", "caviglia", "fascia plantare",
];

function parseCSV(s: string): string[] {
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

export default function ProfileEditor() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [injuriesRaw, setInjuriesRaw] = useState("");
  const [medsRaw, setMedsRaw] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [newAreaInput, setNewAreaInput] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getJSON<UserProfile | null>("user-profile", null);
      if (p) {
        setProfile(p);
        setInjuriesRaw((p.injuries || []).join(", "));
        setMedsRaw(p.meds || "");
        setAreas(p.painTrackingAreas || []);
      }
    })();
  }, []);

  if (!profile) {
    return (
      <div style={{ color: "#94A3B8", fontSize: "13px", fontStyle: "italic" }}>
        Profilo non ancora configurato. Completa l'onboarding prima.
      </div>
    );
  }

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const persist = async (patch: Partial<UserProfile>) => {
    const next: UserProfile = {
      ...profile,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await setJSON("user-profile", next);
    setProfile(next);
    events.emit("profile:updated", { at: next.updatedAt });
    flashSaved();
  };

  const saveInjuries = async () => {
    const list = parseCSV(injuriesRaw);
    if (JSON.stringify(list) === JSON.stringify(profile.injuries || [])) return;
    await persist({ injuries: list });
  };

  const saveMeds = async () => {
    if (medsRaw === (profile.meds || "")) return;
    await persist({ meds: medsRaw });
  };

  const toggleArea = async (area: string) => {
    const next = areas.includes(area) ? areas.filter(a => a !== area) : [...areas, area];
    setAreas(next);
    await persist({ painTrackingAreas: next });
  };

  const addCustomArea = async () => {
    const trimmed = newAreaInput.trim().toLowerCase();
    if (!trimmed || areas.includes(trimmed)) { setNewAreaInput(""); return; }
    const next = [...areas, trimmed];
    setAreas(next);
    setNewAreaInput("");
    await persist({ painTrackingAreas: next });
  };

  const labelStyle = { fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" };
  const inputStyle = {
    width: "100%", padding: "11px 14px", background: "#1A1A2E",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
    color: "#E2E8F0", fontSize: "15px", outline: "none", boxSizing: "border-box" as const,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <label htmlFor="prof-injuries" style={labelStyle}>Infortuni o condizioni attive</label>
        <input
          id="prof-injuries"
          type="text"
          style={inputStyle}
          value={injuriesRaw}
          placeholder="es. tendinopatia polpaccio, ernia L5 (separati da virgola)"
          onChange={e => setInjuriesRaw(e.target.value)}
          onBlur={saveInjuries}
        />
        <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.5 }}>
          Se sei guarito da un infortunio, <b>cancellalo dalla lista</b> — il coach smetterà di suggerire adattamenti per quella zona.
          {(profile.injuries || []).length > 0 && (
            <button
              onClick={async () => { setInjuriesRaw(""); await persist({ injuries: [] }); }}
              style={{
                marginLeft: "8px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "6px", color: "#CBD5E1", padding: "3px 8px", fontSize: "11px", cursor: "pointer",
              }}
            >Rimuovi tutti</button>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="prof-meds" style={labelStyle}>Farmaci / integratori</label>
        <input
          id="prof-meds"
          type="text"
          style={inputStyle}
          value={medsRaw}
          placeholder="es. magnesio, vitamina D, ibuprofene al bisogno"
          onChange={e => setMedsRaw(e.target.value)}
          onBlur={saveMeds}
        />
      </div>

      <div>
        <label style={labelStyle}>Zone di dolore da monitorare nel diario</label>
        <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "10px", lineHeight: 1.5 }}>
          Per ogni zona attiva, il diario mostra una scala 0-4 pre/durante/post per ciascun allenamento. Disattiva una zona se non hai più dolore lì.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
          {SUGGESTED_AREAS.map(area => {
            const active = areas.includes(area);
            return (
              <button
                key={area}
                onClick={() => toggleArea(area)}
                aria-pressed={active}
                style={{
                  padding: "6px 12px",
                  background: active ? "#22C55E25" : "#1A1A2E",
                  border: active ? "1px solid #22C55E66" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "999px",
                  color: active ? "#22C55E" : "#94A3B8",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer",
                }}
              >
                {active ? "✓ " : "+ "}{area}
              </button>
            );
          })}
          {areas.filter(a => !SUGGESTED_AREAS.includes(a)).map(area => (
            <button
              key={area}
              onClick={() => toggleArea(area)}
              aria-pressed={true}
              style={{
                padding: "6px 12px",
                background: "#22C55E25",
                border: "1px solid #22C55E66",
                borderRadius: "999px",
                color: "#22C55E",
                fontSize: "12px", fontWeight: 600, cursor: "pointer",
              }}
            >
              ✓ {area}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            type="text"
            placeholder="Aggiungi zona personalizzata"
            value={newAreaInput}
            onChange={e => setNewAreaInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addCustomArea(); } }}
            style={{ ...inputStyle, fontSize: "13px", padding: "8px 12px", flex: 1 }}
          />
          <button
            onClick={addCustomArea}
            disabled={!newAreaInput.trim()}
            style={{
              padding: "8px 14px",
              background: newAreaInput.trim() ? "#1A1A2E" : "#0F172A",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "8px",
              color: "#CBD5E1", fontSize: "13px", fontWeight: 600,
              cursor: newAreaInput.trim() ? "pointer" : "not-allowed",
              opacity: newAreaInput.trim() ? 1 : 0.5,
            }}
          >Aggiungi</button>
        </div>
      </div>

      {saved && (
        <div role="status" aria-live="polite" style={{ fontSize: "12px", color: "#22C55E", fontWeight: 600 }}>
          ✓ Profilo aggiornato
        </div>
      )}
    </div>
  );
}
