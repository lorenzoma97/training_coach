// Wave 2.2 — Step opzionale "Calendario gare" dell'OnboardingWizard.
// Owner: frontend-specialist.
//
// Wireframe mobile (390x844):
//   ┌──────────────────────────────────────────┐
//   │ STEP 4 · GARE                            │
//   │ Gare e obiettivi futuri (opzionale)      │
//   │ Spiegazione 2-3 righe…                   │
//   │                                          │
//   │ ┌─ Aggiungi gara ────────────────────┐  │
//   │ │ Nome [_________________________]   │  │
//   │ │ Sport [select]                     │  │
//   │ │ Data [date picker]                 │  │
//   │ │ Distanza km [____]                 │  │
//   │ │ Tempo target [_______]             │  │
//   │ │ Priorità [A] [B] [C]               │  │
//   │ │ Note [textarea]                    │  │
//   │ │ [Aggiungi gara]                    │  │
//   │ └────────────────────────────────────┘  │
//   │                                          │
//   │ Race aggiunte:                           │
//   │ ┌─ Maratona Bologna · 2026-09-15 ────┐  │
//   │ │ Priorità A · 42 km · 3:30:00       │  │
//   │ │ [Rimuovi]                           │  │
//   │ └────────────────────────────────────┘  │
//   │                                          │
//   │ [Lo farò dopo]   [Salva e continua →]    │
//   └──────────────────────────────────────────┘

import { useId, useRef, useEffect, useState, useMemo } from "react";
import type { RaceEvent } from "../../lib/types/periodization";

const SPORT_LABELS: Record<RaceEvent["sport"], string> = {
  corsa: "Corsa",
  sport: "Sport di squadra (calcio, padel…)",
  trail: "Trail / ultra",
  triathlon: "Triathlon",
  altro: "Altro",
};

const PRIORITY_LABELS: Record<RaceEvent["priority"], { label: string; hint: string }> = {
  A: { label: "A", hint: "Peak event (max 1-2/anno)" },
  B: { label: "B", hint: "Importante, mini-taper" },
  C: { label: "C", hint: "Allenamento, no taper" },
};

// Data minima accettabile: oggi+7 giorni. Una gara troppo imminente non
// permette di costruire un macrociclo significativo (taper minimo 1 sett).
function minRaceDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// Parse "1:45:00" / "45:00" / "01:45:00" → secondi, undefined se non parsable.
// Tolerante: accetta anche "sub 4h" (non parsable, lasciamo solo targetTime).
function parseTargetTimeToSec(s: string): number | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const m = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  const h = m[3] ? parseInt(m[1], 10) : 0;
  const min = m[3] ? parseInt(m[2], 10) : parseInt(m[1], 10);
  const sec = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10);
  if (min >= 60 || sec >= 60) return undefined;
  return h * 3600 + min * 60 + sec;
}

export interface StepRacesDraft {
  // Form attivo (campi raw): l'utente lo compila e poi clicca "Aggiungi".
  form: {
    name: string;
    sport: RaceEvent["sport"];
    date: string;
    distance_km: string;
    targetTime: string;
    priority: RaceEvent["priority"];
    notes: string;
  };
  // Lista race aggiunte (già confermate dall'utente — pronte per persistenza).
  races: RaceEvent[];
}

export const EMPTY_RACES_DRAFT: StepRacesDraft = {
  form: {
    name: "",
    sport: "corsa",
    date: "",
    distance_km: "",
    targetTime: "",
    priority: "A",
    notes: "",
  },
  races: [],
};

interface Props {
  draft: StepRacesDraft;
  onDraftChange: (next: StepRacesDraft) => void;
  /** Callback "Salva e continua". Riceve l'array race da persistire (può essere []). */
  onSave: (races: RaceEvent[]) => void;
  /** Callback "Lo farò dopo": skippa senza salvare. */
  onSkip: () => void;
  /** Indietro (alla step 1RM). */
  onBack: () => void;
}

const cardStyle: React.CSSProperties = {
  background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "16px", padding: "16px",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px", background: "#1A1A2E",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
  color: "#E2E8F0", fontSize: "15px", outline: "none", boxSizing: "border-box",
  minHeight: "44px",
};
const labelStyle: React.CSSProperties = {
  fontSize: "13px", fontWeight: 600, color: "#CBD5E1",
  display: "block", marginBottom: "6px",
};
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "16px", minHeight: "44px",
  background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
  border: "none", borderRadius: "14px", color: "#FFF",
  fontSize: "16px", fontWeight: 800, cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "10px 16px", minHeight: "44px", background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px",
  color: "#94A3B8", fontSize: "14px", fontWeight: 600, cursor: "pointer",
};

// UUID stabile lato client. Crypto API quando disponibile, fallback string.
function makeRaceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `race-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function StepRaces({ draft, onDraftChange, onSave, onSkip, onBack }: Props) {
  const uid = useId();
  const fid = (k: string) => `${uid}-${k}`;
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [formError, setFormError] = useState<string>("");

  useEffect(() => {
    firstInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minDate = useMemo(() => minRaceDate(), []);

  const updateForm = (patch: Partial<StepRacesDraft["form"]>) => {
    onDraftChange({ ...draft, form: { ...draft.form, ...patch } });
  };

  // distance_km è rilevante solo per corsa/trail (vincolo UX dal design doc).
  const showDistance = draft.form.sport === "corsa" || draft.form.sport === "trail";
  // Stesso per targetTime (free text utile per qualsiasi sport ma convenzionalmente endurance).
  const showTargetTime = draft.form.sport !== "sport" && draft.form.sport !== "altro";

  const validateForm = (): string | null => {
    const f = draft.form;
    if (!f.name.trim()) return "Inserisci il nome della gara.";
    if (!f.date) return "Seleziona la data della gara.";
    if (f.date < minDate) return "La data deve essere almeno tra 7 giorni.";
    if (showDistance && f.distance_km.trim()) {
      const km = parseFloat(f.distance_km.replace(",", "."));
      if (!Number.isFinite(km) || km <= 0 || km > 500) return "Distanza non valida (1-500 km).";
    }
    return null;
  };

  const addRace = () => {
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError("");
    const f = draft.form;
    const distance_km = showDistance && f.distance_km.trim()
      ? parseFloat(f.distance_km.replace(",", "."))
      : undefined;
    const targetTimeSec = showTargetTime ? parseTargetTimeToSec(f.targetTime) : undefined;
    const race: RaceEvent = {
      id: makeRaceId(),
      name: f.name.trim(),
      sport: f.sport,
      date: f.date,
      distance_km,
      targetTime: showTargetTime && f.targetTime.trim() ? f.targetTime.trim() : undefined,
      targetTimeSec,
      priority: f.priority,
      notes: f.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    onDraftChange({
      form: { ...EMPTY_RACES_DRAFT.form },
      races: [...draft.races, race].sort((a, b) => a.date.localeCompare(b.date)),
    });
  };

  const removeRace = (id: string) => {
    onDraftChange({
      ...draft,
      races: draft.races.filter(r => r.id !== id),
    });
  };

  const handleSave = () => {
    onSave(draft.races);
  };

  const hasAnyRace = draft.races.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em",
          color: "#6366F1", textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace",
        }}>Step 4 · Gare</div>
        <h2 style={{
          fontSize: "26px", fontWeight: 900, margin: "6px 0 4px",
          letterSpacing: "-0.03em",
        }}>Gare e obiettivi futuri (opzionale)</h2>
        <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0, lineHeight: 1.5 }}>
          Se hai una gara o evento target nei prossimi mesi, il coach pianificherà un{" "}
          <b>macrociclo</b> (12-24 settimane) con fasi base / build / peak / taper.
          Senza, pianifica settimana-per-settimana.
        </p>
      </div>

      {/* Lista race già aggiunte */}
      {hasAnyRace && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {draft.races.map(r => (
            <div key={r.id} style={{ ...cardStyle, borderLeft: `3px solid ${r.priority === "A" ? "#6366F1" : r.priority === "B" ? "#F59E0B" : "#64748B"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "11px", color: r.priority === "A" ? "#6366F1" : "#94A3B8", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "4px" }}>
                    PRIORITÀ {r.priority} · {SPORT_LABELS[r.sport]}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px", wordBreak: "break-word" }}>
                    {r.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
                    {r.date}
                    {r.distance_km != null && ` · ${r.distance_km} km`}
                    {r.targetTime && ` · target ${r.targetTime}`}
                  </div>
                  {r.notes && (
                    <div style={{ fontSize: "12px", color: "#CBD5E1", marginTop: "6px", fontStyle: "italic" }}>
                      {r.notes}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeRace(r.id)}
                  aria-label={`Rimuovi gara ${r.name}`}
                  style={{
                    background: "transparent", border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#EF4444", borderRadius: "8px", padding: "6px 10px",
                    fontSize: "12px", cursor: "pointer", minHeight: "32px", flexShrink: 0,
                  }}
                >Rimuovi</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form aggiunta race */}
      <div style={cardStyle} role="group" aria-label="Form aggiunta gara">
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0", marginBottom: "12px" }}>
          {hasAnyRace ? "Aggiungi un'altra gara" : "Aggiungi una gara"}
        </div>

        <div>
          <label htmlFor={fid("name")} style={labelStyle}>Nome gara</label>
          <input
            ref={firstInputRef}
            id={fid("name")}
            type="text"
            value={draft.form.name}
            onChange={e => updateForm({ name: e.target.value })}
            placeholder="es. Maratona di Bologna"
            style={inputStyle}
            maxLength={120}
          />
        </div>

        <div style={{ marginTop: "12px" }}>
          <label htmlFor={fid("sport")} style={labelStyle}>Sport</label>
          <select
            id={fid("sport")}
            value={draft.form.sport}
            onChange={e => updateForm({ sport: e.target.value as RaceEvent["sport"] })}
            style={{ ...inputStyle, fontFamily: "inherit" }}
          >
            {(Object.keys(SPORT_LABELS) as RaceEvent["sport"][]).map(s => (
              <option key={s} value={s}>{SPORT_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: showDistance ? "1fr 1fr" : "1fr", gap: "10px" }}>
          <div>
            <label htmlFor={fid("date")} style={labelStyle}>Data</label>
            <input
              id={fid("date")}
              type="date"
              value={draft.form.date}
              min={minDate}
              onChange={e => updateForm({ date: e.target.value })}
              style={inputStyle}
            />
          </div>
          {showDistance && (
            <div>
              <label htmlFor={fid("distance")} style={labelStyle}>Distanza (km)</label>
              <input
                id={fid("distance")}
                type="number"
                inputMode="decimal"
                min="1"
                max="500"
                step="0.1"
                value={draft.form.distance_km}
                onChange={e => updateForm({ distance_km: e.target.value })}
                placeholder="es. 42.195"
                style={inputStyle}
              />
            </div>
          )}
        </div>

        {showTargetTime && (
          <div style={{ marginTop: "12px" }}>
            <label htmlFor={fid("targetTime")} style={labelStyle}>Tempo target (opzionale)</label>
            <input
              id={fid("targetTime")}
              type="text"
              value={draft.form.targetTime}
              onChange={e => updateForm({ targetTime: e.target.value })}
              placeholder="es. 1:45:00 oppure 'sub 4h'"
              style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
            />
          </div>
        )}

        <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
          <legend style={{ ...labelStyle, padding: 0 }}>Priorità</legend>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {(["A", "B", "C"] as const).map(p => {
              const id = `${fid("prio")}-${p}`;
              const checked = draft.form.priority === p;
              return (
                <label
                  key={p}
                  htmlFor={id}
                  style={{
                    flex: "1 1 90px",
                    display: "flex", flexDirection: "column", gap: "2px",
                    padding: "10px 12px", minHeight: "44px",
                    background: checked ? "#6366F122" : "#1A1A2E",
                    border: checked ? "1px solid #6366F1" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px", cursor: "pointer",
                    color: checked ? "#6366F1" : "#CBD5E1",
                  }}
                >
                  <input
                    type="radio"
                    id={id}
                    name={fid("prio")}
                    value={p}
                    checked={checked}
                    onChange={() => updateForm({ priority: p })}
                    style={{ accentColor: "#6366F1", marginBottom: "2px" }}
                  />
                  <span style={{ fontWeight: 700, fontSize: "13px" }}>{PRIORITY_LABELS[p].label}</span>
                  <span style={{ fontSize: "11px", color: checked ? "#6366F1" : "#94A3B8", lineHeight: 1.3 }}>
                    {PRIORITY_LABELS[p].hint}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div style={{ marginTop: "12px" }}>
          <label htmlFor={fid("notes")} style={labelStyle}>Note (opzionale)</label>
          <textarea
            id={fid("notes")}
            value={draft.form.notes}
            onChange={e => updateForm({ notes: e.target.value })}
            placeholder="terreno, altimetria, condizioni…"
            style={{ ...inputStyle, minHeight: "60px", resize: "vertical", fontFamily: "inherit" }}
            maxLength={500}
          />
        </div>

        {formError && (
          <div role="alert" style={{
            marginTop: "10px", fontSize: "13px", color: "#EF4444",
            padding: "8px 12px", background: "#7F1D1D22", borderRadius: "8px",
          }}>{formError}</div>
        )}

        <button
          type="button"
          onClick={addRace}
          style={{
            ...primaryBtn, marginTop: "14px",
            background: "#16213E", border: "1px solid rgba(255,255,255,0.12)",
            fontSize: "14px", padding: "12px",
          }}
          aria-label="Aggiungi questa gara alla lista"
        >
          + Aggiungi gara
        </button>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={ghostBtn} aria-label="Torna allo step precedente">
          ← Indietro
        </button>
        <button type="button" onClick={onSkip} style={{ ...ghostBtn, flex: "1 1 140px" }}>
          Lo farò dopo
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{ ...primaryBtn, flex: "2 1 200px" }}
        >
          {hasAnyRace ? "Salva e continua →" : "Salta →"}
        </button>
      </div>
    </div>
  );
}
