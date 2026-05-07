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
  // Disponibilità + attrezzatura: aggiunti post-onboarding perché cambiano nel
  // tempo (es. iscrizione palestra, periodo lavorativo intenso). Senza editor
  // l'utente doveva fare reset onboarding completo per modificarli.
  const [days, setDays] = useState<number>(3);
  const [sessionHours, setSessionHours] = useState<number>(1);
  const [sessionMinutes, setSessionMinutes] = useState<number>(0);
  const [equipmentRaw, setEquipmentRaw] = useState("");
  const [availableDays, setAvailableDays] = useState<UserProfile["availableDays"]>([]);

  useEffect(() => {
    (async () => {
      const p = await getJSON<UserProfile | null>("user-profile", null);
      if (p) {
        setProfile(p);
        setInjuriesRaw((p.injuries || []).join(", "));
        setMedsRaw(p.meds || "");
        setAreas(p.painTrackingAreas || []);
        setDays(p.weekly_availability?.days ?? 3);
        // Decompose hoursPerSession (es. 1.5) → ore + minuti separati per UI.
        const totalH = p.weekly_availability?.hoursPerSession ?? 1;
        setSessionHours(Math.floor(totalH));
        setSessionMinutes(Math.round((totalH - Math.floor(totalH)) * 60));
        setEquipmentRaw((p.equipment || []).join(", "));
        setAvailableDays(p.availableDays || []);
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
    // Quando un infortunio viene rimosso, la zona di tracking dolore corrispondente
    // tipicamente non è più rilevante. Se nessun infortunio nel testo nuovo menziona
    // un'area attualmente tracciata, propongo di disattivare anche il tracking
    // (così il diario smette di chiedere e il coach smette di proporre adattamenti).
    const blob = list.join(" ").toLowerCase();
    const orphans = (profile.painTrackingAreas || []).filter(a => !blob.includes(a.toLowerCase()));
    let nextAreas = profile.painTrackingAreas;
    if (orphans.length > 0 && (profile.injuries || []).length > 0) {
      const ok = confirm(
        `Nessun infortunio menziona più ${orphans.length === 1 ? "questa zona" : "queste zone"}: ${orphans.join(", ")}.\n` +
        `Vuoi disattivare anche il tracking dolore (il diario smetterà di chiederlo e il coach non proporrà più adattamenti)?`
      );
      if (ok) {
        nextAreas = (profile.painTrackingAreas || []).filter(a => !orphans.includes(a));
        setAreas(nextAreas);
      }
    }
    await persist({ injuries: list, ...(nextAreas !== profile.painTrackingAreas ? { painTrackingAreas: nextAreas } : {}) });
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

  const saveAvailability = async (nextDays = days, nextHrs = sessionHours, nextMins = sessionMinutes) => {
    const hoursPerSession = (nextHrs + nextMins / 60) || 0.25; // min 15min
    const cur = profile.weekly_availability;
    if (cur && cur.days === nextDays && Math.abs(cur.hoursPerSession - hoursPerSession) < 0.01) return;
    await persist({ weekly_availability: { days: nextDays, hoursPerSession } });
  };

  const saveEquipment = async () => {
    const list = parseCSV(equipmentRaw);
    if (JSON.stringify(list) === JSON.stringify(profile.equipment || [])) return;
    await persist({ equipment: list });
  };

  const toggleAvailableDay = async (d: NonNullable<UserProfile["availableDays"]>[number]) => {
    const cur = availableDays || [];
    const next: NonNullable<UserProfile["availableDays"]> = cur.includes(d)
      ? cur.filter(x => x !== d)
      : [...cur, d];
    setAvailableDays(next);
    await persist({ availableDays: next });
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
        <label style={labelStyle}>Disponibilità settimanale</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Giorni/sett.</div>
            <select
              value={days}
              onChange={e => { const v = Number(e.target.value); setDays(v); void saveAvailability(v, sessionHours, sessionMinutes); }}
              style={{ ...inputStyle, fontFamily: "inherit" }}
            >
              {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Ore/sessione</div>
            <select
              value={sessionHours}
              onChange={e => { const v = Number(e.target.value); setSessionHours(v); void saveAvailability(days, v, sessionMinutes); }}
              style={{ ...inputStyle, fontFamily: "inherit" }}
            >
              {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Minuti</div>
            <select
              value={sessionMinutes}
              onChange={e => { const v = Number(e.target.value); setSessionMinutes(v); void saveAvailability(days, sessionHours, v); }}
              style={{ ...inputStyle, fontFamily: "inherit" }}
            >
              {[0, 15, 30, 45].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.5 }}>
          Il coach userà questi valori come <b>vincolo HARD</b>: nessuna sessione del piano supererà la durata dichiarata.
        </div>
      </div>

      <div>
        <label style={labelStyle}>Giorni allenabili (default settimanale)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
          {(["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const).map(d => {
            const active = (availableDays || []).includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleAvailableDay(d)}
                aria-pressed={active}
                style={{
                  padding: "8px 14px", minWidth: "48px",
                  background: active ? "#22C55E25" : "#1A1A2E",
                  border: active ? "1px solid #22C55E66" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "999px",
                  color: active ? "#22C55E" : "#94A3B8",
                  fontSize: "12px", fontWeight: 700, cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                }}
              >{d}</button>
            );
          })}
        </div>
        <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.5 }}>
          Routine "fissa" (es. lavoro il ven sera, calcetto il mar). Il coach prescriverà sessioni <b>solo</b> nei giorni selezionati. Vuoto = scelta libera del coach. Puoi sempre fare override per la singola settimana dal picker "Rigenera piano".
        </div>
      </div>

      <div>
        <label htmlFor="prof-equipment" style={labelStyle}>Attrezzatura disponibile</label>
        <input
          id="prof-equipment"
          type="text"
          style={inputStyle}
          value={equipmentRaw}
          placeholder="es. tapis roulant, manubri 10kg, palestra (separati da virgola)"
          onChange={e => setEquipmentRaw(e.target.value)}
          onBlur={saveEquipment}
        />
        <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.5 }}>
          Il coach proporrà <b>solo</b> esercizi realizzabili con quanto in lista. Vuoto = solo corpo libero, corsa outdoor, mobilità.
        </div>
      </div>

      <div>
        <label htmlFor="prof-injuries" style={labelStyle}>Infortuni o condizioni attive</label>
        <input
          id="prof-injuries"
          type="text"
          style={inputStyle}
          value={injuriesRaw}
          placeholder="es. tendinopatia rotulea, ernia L5 (separati da virgola)"
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
