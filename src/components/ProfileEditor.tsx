// Editor del profilo utente per Settings — permette aggiornare campi che
// cambiano nel tempo: infortuni (puoi essere guarito), farmaci/integratori,
// zone dolore tracciate. NON include età/sesso/peso/altezza che si modificano
// raramente — per quelli c'è "Reset coach" + ri-onboarding.
//
// Pattern: read-on-mount, controlled inputs, save-on-blur per tag (CSV) e
// save esplicito per alterare painTrackingAreas (richiede consapevolezza).
//
// UX redesign — feedback Lorenzo "troppo verboso":
//  - Sezioni base (disponibilità, giorni allenabili, intensità) sempre visibili
//    ma compatte (1 riga ciascuna).
//  - Giorni allenabili: 1 riga, label 1-char ("L M M G V S D"), pillole 36px.
//  - Sezioni avanzate (equipment, infortuni, farmaci, aree dolore) chiuse di
//    default in <details>, expand on demand. Counter nel summary se popolato.
//  - Aree dolore: collapsed con count "N monitorate", elimina UI custom add
//    quando chiuso (resta accessibile dentro).

import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { UserProfile } from "../lib/types";
import { events } from "../lib/events";

const SUGGESTED_AREAS = [
  "polpaccio", "ginocchio", "tendine d'achille", "schiena lombare",
  "schiena cervicale", "spalla", "anca", "caviglia", "fascia plantare",
];

const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;
// Label 1-char per layout 1-riga richiesto da Lorenzo. Stessa lettera "M" per
// martedì/mercoledì è ambigua ma standard IT (vedi calendari); titolo HTML
// completo accessibile via aria-label sul bottone.
const DAY_LETTERS: Record<typeof DAY_KEYS[number], string> = {
  lun: "L", mar: "M", mer: "M", gio: "G", ven: "V", sab: "S", dom: "D",
};
const DAY_FULL: Record<typeof DAY_KEYS[number], string> = {
  lun: "Lunedì", mar: "Martedì", mer: "Mercoledì", gio: "Giovedì",
  ven: "Venerdì", sab: "Sabato", dom: "Domenica",
};

function parseCSV(s: string): string[] {
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

// Stile uniforme per <summary> degli accordion — touch target 44px, chevron
// implicito (marker browser default). Mantiene cursor pointer e niente
// outline rumoroso al focus tastiera (sostituito da bordo dinamico).
const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  padding: "12px 14px",
  minHeight: "44px",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "13px",
  fontWeight: 600,
  color: "#CBD5E1",
  userSelect: "none",
  listStyle: "revert", // mantiene marker triangolino nativo
};

const detailsStyle: React.CSSProperties = {
  background: "#1A1A2E",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "10px",
  overflow: "hidden",
};

const detailsBodyStyle: React.CSSProperties = {
  padding: "4px 14px 14px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

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
  const [intensity, setIntensity] = useState<UserProfile["intensityPreference"]>(undefined);

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
        setIntensity(p.intensityPreference);
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

  const setIntensityValue = async (v: NonNullable<UserProfile["intensityPreference"]> | undefined) => {
    setIntensity(v);
    await persist({ intensityPreference: v });
  };

  const labelStyle = { fontSize: "12px", fontWeight: 600, color: "#94A3B8", display: "block", marginBottom: "4px" };
  const inputStyle = {
    width: "100%", padding: "10px 12px", background: "#1A1A2E",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
    color: "#E2E8F0", fontSize: "14px", outline: "none", boxSizing: "border-box" as const,
  };

  // Conteggi per i summary degli accordion (sempre visibili nel collapsed).
  const equipmentCount = profile.equipment?.length ?? 0;
  const injuriesCount = profile.injuries?.length ?? 0;
  const medsPresent = (profile.meds || "").trim().length > 0;
  const areasCount = areas.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* ─── Disponibilità: 1 riga compatta giorni/ore/min ────────────── */}
      <div>
        <label style={labelStyle}>Disponibilità settimanale</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
          <select
            aria-label="Giorni a settimana"
            value={days}
            onChange={e => { const v = Number(e.target.value); setDays(v); void saveAvailability(v, sessionHours, sessionMinutes); }}
            style={{ ...inputStyle, fontFamily: "inherit" }}
          >
            {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} gg/sett</option>)}
          </select>
          <select
            aria-label="Ore a sessione"
            value={sessionHours}
            onChange={e => { const v = Number(e.target.value); setSessionHours(v); void saveAvailability(days, v, sessionMinutes); }}
            style={{ ...inputStyle, fontFamily: "inherit" }}
          >
            {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n} h</option>)}
          </select>
          <select
            aria-label="Minuti a sessione"
            value={sessionMinutes}
            onChange={e => { const v = Number(e.target.value); setSessionMinutes(v); void saveAvailability(days, sessionHours, v); }}
            style={{ ...inputStyle, fontFamily: "inherit" }}
          >
            {[0, 15, 30, 45].map(n => <option key={n} value={n}>{n} min</option>)}
          </select>
        </div>
      </div>

      {/* ─── Giorni allenabili: 1 riga, 1-char, 36px ──────────────────── */}
      <div>
        <label style={labelStyle}>Giorni allenabili</label>
        <div style={{ display: "flex", gap: "4px", justifyContent: "space-between" }}>
          {DAY_KEYS.map(d => {
            const active = (availableDays || []).includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleAvailableDay(d)}
                aria-pressed={active}
                aria-label={DAY_FULL[d]}
                title={DAY_FULL[d]}
                style={{
                  flex: 1,
                  minWidth: "32px",
                  height: "36px",
                  padding: 0,
                  background: active ? "#22C55E25" : "#1A1A2E",
                  border: active ? "1px solid #22C55E66" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "10px",
                  color: active ? "#22C55E" : "#64748B",
                  fontSize: "13px", fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "uppercase",
                  opacity: active ? 1 : 0.7,
                }}
              >{DAY_LETTERS[d]}</button>
            );
          })}
        </div>
        <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>
          Vuoto = scelta libera del coach. Override settimanale dal picker "Rigenera piano".
        </div>
      </div>

      {/* ─── Intensità: 4 pillole single-line ─────────────────────────── */}
      <div>
        <label style={labelStyle}>Intensità preferita</label>
        <div style={{ display: "flex", gap: "4px" }}>
          {([
            { v: "soft" as const, label: "Soft" },
            { v: "balanced" as const, label: "Equilib." },
            { v: "intense" as const, label: "Intenso" },
            { v: "very_intense" as const, label: "Molto" },
          ]).map(opt => {
            const active = intensity === opt.v;
            return (
              <button
                key={opt.v}
                onClick={() => setIntensityValue(active ? undefined : opt.v)}
                aria-pressed={active}
                style={{
                  flex: 1,
                  height: "36px",
                  padding: "0 4px",
                  background: active ? "#E8553A25" : "#1A1A2E",
                  border: active ? "1px solid #E8553A66" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "10px",
                  color: active ? "#E8553A" : "#94A3B8",
                  fontSize: "12px", fontWeight: 700, cursor: "pointer",
                }}
              >{opt.label}</button>
            );
          })}
        </div>
      </div>

      {/* ─── Attrezzatura: collapsibile ───────────────────────────────── */}
      <details style={detailsStyle}>
        <summary style={summaryStyle} aria-label="Attrezzatura disponibile">
          <span style={{ flex: 1 }}>Attrezzatura</span>
          <span style={{ fontSize: "11px", color: equipmentCount > 0 ? "#22C55E" : "#64748B", fontWeight: 700 }}>
            {equipmentCount > 0 ? `${equipmentCount} oggetti` : "vuoto"}
          </span>
        </summary>
        <div style={detailsBodyStyle}>
          <input
            id="prof-equipment"
            type="text"
            style={inputStyle}
            value={equipmentRaw}
            placeholder="es. tapis roulant, manubri 10kg, palestra"
            onChange={e => setEquipmentRaw(e.target.value)}
            onBlur={saveEquipment}
          />
          <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.5 }}>
            Lista separata da virgola. Vuoto = solo corpo libero, corsa outdoor, mobilità.
          </div>
        </div>
      </details>

      {/* ─── Infortuni: collapsible (open di default se popolato) ─────── */}
      {/* Pattern: spread di {open: true} solo se vogliamo l'expanded iniziale.
          Passare open={false} renderebbe <details> controllato e bloccherebbe
          il toggle utente — pattern HTML/React noto. */}
      <details style={detailsStyle} {...(injuriesCount > 0 ? { open: true } : {})}>
        <summary style={summaryStyle} aria-label="Infortuni o condizioni attive">
          <span style={{ flex: 1 }}>Infortuni / condizioni</span>
          <span style={{ fontSize: "11px", color: injuriesCount > 0 ? "#F59E0B" : "#64748B", fontWeight: 700 }}>
            {injuriesCount > 0 ? `${injuriesCount} attivi` : "nessuno"}
          </span>
        </summary>
        <div style={detailsBodyStyle}>
          <input
            id="prof-injuries"
            type="text"
            style={inputStyle}
            value={injuriesRaw}
            placeholder="es. tendinopatia rotulea, ernia L5"
            onChange={e => setInjuriesRaw(e.target.value)}
            onBlur={saveInjuries}
          />
          <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.5 }}>
            Lista separata da virgola. Se sei guarito, <b>cancellalo</b> — il coach smetterà di adattare per quella zona.
          </div>
          {injuriesCount > 0 && (
            <button
              onClick={async () => { setInjuriesRaw(""); await persist({ injuries: [] }); }}
              style={{
                alignSelf: "flex-start",
                background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "8px", color: "#CBD5E1",
                padding: "10px 14px", fontSize: "12px", cursor: "pointer",
                minHeight: "44px",
              }}
            >Rimuovi tutti</button>
          )}
        </div>
      </details>

      {/* ─── Farmaci/integratori: collapsibile ────────────────────────── */}
      <details style={detailsStyle}>
        <summary style={summaryStyle} aria-label="Farmaci e integratori">
          <span style={{ flex: 1 }}>Farmaci / integratori</span>
          <span style={{ fontSize: "11px", color: medsPresent ? "#22C55E" : "#64748B", fontWeight: 700 }}>
            {medsPresent ? "compilato" : "vuoto"}
          </span>
        </summary>
        <div style={detailsBodyStyle}>
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
      </details>

      {/* ─── Aree dolore monitorate: collapsibile (richiesta esplicita) ─ */}
      <details style={detailsStyle}>
        <summary style={summaryStyle} aria-label="Aree dolore monitorate nel diario">
          <span style={{ flex: 1 }}>Aree dolore monitorate</span>
          <span style={{ fontSize: "11px", color: areasCount > 0 ? "#22C55E" : "#64748B", fontWeight: 700 }}>
            {areasCount > 0 ? `${areasCount} attive` : "nessuna"}
          </span>
        </summary>
        <div style={detailsBodyStyle}>
          <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.5 }}>
            Per ogni zona attiva il diario mostra scala 0-4 pre/durante/post sessione.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {SUGGESTED_AREAS.map(area => {
              const active = areas.includes(area);
              return (
                <button
                  key={area}
                  onClick={() => toggleArea(area)}
                  aria-pressed={active}
                  style={{
                    padding: "8px 12px", minHeight: "36px",
                    background: active ? "#22C55E25" : "#0F172A",
                    border: active ? "1px solid #22C55E66" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "999px",
                    color: active ? "#22C55E" : "#94A3B8",
                    fontSize: "12px", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {active ? "- " : "+ "}{area}
                </button>
              );
            })}
            {areas.filter(a => !SUGGESTED_AREAS.includes(a)).map(area => (
              <button
                key={area}
                onClick={() => toggleArea(area)}
                aria-pressed={true}
                style={{
                  padding: "8px 12px", minHeight: "36px",
                  background: "#22C55E25",
                  border: "1px solid #22C55E66",
                  borderRadius: "999px",
                  color: "#22C55E",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer",
                }}
              >
                - {area}
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
                padding: "8px 14px", minHeight: "40px",
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
      </details>

      {saved && (
        <div role="status" aria-live="polite" style={{ fontSize: "12px", color: "#22C55E", fontWeight: 600 }}>
          Profilo aggiornato
        </div>
      )}
    </div>
  );
}
