// Wave 3.3 — Sezione "Race calendar" + banner Macrociclo attivo.
//
// Owner: frontend-specialist.
// Renderizzata inline in SettingsPage (sopra "Importa wearable") e potenzialmente
// riusabile altrove (es. CoachPage onboarding hint).
//
// Funzionalità:
//  1. Lista race configurate (caricate da `user-races` storage key con fallback
//     a `profile.races` per backward-compat con OnboardingWizard pre-Wave 3.3).
//  2. Bottone "+ Aggiungi gara" → form inline (riusa pattern di StepRaces).
//  3. Modifica race esistente (apre form con valori pre-popolati).
//  4. Rimozione race con confirm dialog.
//  5. Banner "Macrociclo attivo" se profile.activeMacroCycleId presente.
//  6. Empty state: card descrittiva + CTA quando non ci sono race.
//
// Race lifecycle (vedi I3 ARCHITECTURE.md §6):
//  - Add/Edit/Remove race → saveRaces + recomputeActiveMacro → emit `macro:updated`.
//  - Recompute coordina pruning macrocicli orfani + plan staleness.
//  - NON rigeneriamo il piano corrente automaticamente (rispetto autonomia utente).

import { useEffect, useId, useMemo, useState } from "react";
import { getJSON, setJSON, storage } from "../../lib/storage";
import { events } from "../../lib/events";
import {
  recomputeActiveMacro,
  markPlanStaleIfMacroChanged,
} from "../../lib/coach/macroLifecycle";
import { loadActiveMacroContext, type ActiveMacroLookupResult } from "../../lib/coach/macroLookup";
import type { RaceEvent, UserProfile, MacroCycle } from "../../lib/types";

const RACES_KEY = "user-races";
const PROFILE_KEY = "user-profile";
const MACRO_CYCLE_PREFIX = "macro-cycle:";

const SPORT_LABELS: Record<RaceEvent["sport"], string> = {
  corsa: "Corsa",
  sport: "Sport di squadra",
  trail: "Trail / ultra",
  triathlon: "Triathlon",
  altro: "Altro",
};

const SPORT_ICONS: Record<RaceEvent["sport"], string> = {
  corsa: "🏃",
  sport: "⚽",
  trail: "⛰",
  triathlon: "🏊",
  altro: "🎯",
};

const PRIORITY_COLORS: Record<RaceEvent["priority"], { fg: string; bg: string; border: string }> = {
  A: { fg: "#14B8A6", bg: "#14B8A622", border: "#14B8A6" },
  B: { fg: "#F59E0B", bg: "#F59E0B22", border: "#F59E0B" },
  C: { fg: "#94A3B8", bg: "#64748B22", border: "#64748B" },
};

const PRIORITY_LABELS: Record<RaceEvent["priority"], { label: string; hint: string }> = {
  A: { label: "A", hint: "Peak event" },
  B: { label: "B", hint: "Mini-taper" },
  C: { label: "C", hint: "Allenamento" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function minRaceDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse "1:45:00" / "45:00" → secondi, undefined se non parsable. */
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

/** Days from today to ISO date (>=0 = future). */
function daysToRace(raceDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(raceDate + "T00:00:00");
  const ms = target.getTime() - today.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function makeRaceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `race-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Carica le race con fallback robusto: storage key `user-races` (autoritativa),
 * altrimenti `profile.races` (compat path OnboardingWizard pre-Wave 3.3).
 * Side-effect minimo: NON migra i dati (la migrazione avviene al primo save).
 */
async function loadRacesWithFallback(): Promise<RaceEvent[]> {
  const raw = await storage.get(RACES_KEY);
  if (raw) {
    const arr = await getJSON<RaceEvent[]>(RACES_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }
  const profile = await getJSON<UserProfile | null>(PROFILE_KEY, null);
  if (profile && Array.isArray(profile.races)) return profile.races;
  return [];
}

/**
 * Persiste l'array race nella storage key `user-races` E sincronizza
 * `profile.races` per backward-compat. Recompute il macro dopo.
 *
 * @returns nuovo `MacroCycle | null` attivo dopo il recompute.
 */
async function persistRacesAndRecompute(races: RaceEvent[]): Promise<MacroCycle | null> {
  // 1. Capture macro hash PRE-recompute per markPlanStale (I3).
  const profilePre = await getJSON<UserProfile | null>(PROFILE_KEY, null);
  const prevActiveId = profilePre?.activeMacroCycleId ?? null;
  const prevHash = prevActiveId
    ? (await getJSON<MacroCycle | null>(`${MACRO_CYCLE_PREFIX}${prevActiveId}`, null))?.inputHash ?? null
    : null;

  // 2. Persist autoritativa.
  await setJSON(RACES_KEY, races);

  // 3. Sync profile.races (compat path).
  if (profilePre) {
    try {
      const next: UserProfile = {
        ...profilePre,
        races,
        updatedAt: new Date().toISOString(),
      };
      await setJSON(PROFILE_KEY, next);
      events.emit("profile:updated", { at: next.updatedAt });
    } catch (e) {
      console.warn("[RaceCalendarSection.persistRacesAndRecompute] sync profile failed:", e);
    }
  }

  // 4. Recompute macro (Schema's lifecycle helper). Emette `macro:updated`.
  const macro = await recomputeActiveMacro();

  // 5. Mark plan stale se il macro è cambiato (I3).
  await markPlanStaleIfMacroChanged(prevHash);

  return macro;
}

// ─── Style tokens ───────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px", padding: "16px",
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
const ghostBtn: React.CSSProperties = {
  padding: "10px 14px", minHeight: "44px", background: "transparent",
  border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px",
  color: "#CBD5E1", fontSize: "14px", fontWeight: 600, cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  padding: "12px 16px", minHeight: "44px",
  background: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
  border: "none", borderRadius: "10px", color: "#FFF",
  fontSize: "14px", fontWeight: 700, cursor: "pointer",
};

// ─── Form state (riuso pattern StepRaces) ───────────────────────────────────

interface RaceFormState {
  name: string;
  sport: RaceEvent["sport"];
  date: string;
  distance_km: string;
  targetTime: string;
  priority: RaceEvent["priority"];
  notes: string;
}

const EMPTY_FORM: RaceFormState = {
  name: "",
  sport: "corsa",
  date: "",
  distance_km: "",
  targetTime: "",
  priority: "A",
  notes: "",
};

function raceToForm(r: RaceEvent): RaceFormState {
  return {
    name: r.name,
    sport: r.sport,
    date: r.date,
    distance_km: r.distance_km != null ? String(r.distance_km) : "",
    targetTime: r.targetTime ?? "",
    priority: r.priority,
    notes: r.notes ?? "",
  };
}

// ─── RaceForm sub-component (used inline + when editing) ────────────────────

interface RaceFormProps {
  initial: RaceFormState;
  /** undefined = creating new race; defined = editing existing race. */
  editingId?: string;
  onSubmit: (data: RaceFormState) => void;
  onCancel: () => void;
  busy?: boolean;
}

function RaceForm({ initial, editingId, onSubmit, onCancel, busy }: RaceFormProps) {
  const uid = useId();
  const fid = (k: string) => `${uid}-${k}`;
  const [form, setForm] = useState<RaceFormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const minDate = useMemo(() => minRaceDate(), []);

  const update = (patch: Partial<RaceFormState>) => setForm(s => ({ ...s, ...patch }));

  const showDistance = form.sport === "corsa" || form.sport === "trail";
  const showTargetTime = form.sport !== "sport" && form.sport !== "altro";

  const validate = (): string | null => {
    if (!form.name.trim()) return "Inserisci il nome della gara.";
    if (!form.date) return "Seleziona la data della gara.";
    // In edit mode permettiamo date passate (la race può essere già avvenuta).
    // In create, vincolo min +7gg.
    if (!editingId && form.date < minDate) return "La data deve essere almeno tra 7 giorni.";
    if (showDistance && form.distance_km.trim()) {
      const km = parseFloat(form.distance_km.replace(",", "."));
      if (!Number.isFinite(km) || km <= 0 || km > 500) return "Distanza non valida (1-500 km).";
    }
    return null;
  };

  const handleSubmit = () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    onSubmit(form);
  };

  return (
    <div
      style={{ ...cardStyle, background: "#1A1A2E" }}
      role="group"
      aria-label={editingId ? "Modifica gara" : "Aggiungi nuova gara"}
    >
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0", marginBottom: "12px" }}>
        {editingId ? "✏ Modifica gara" : "+ Aggiungi gara"}
      </div>

      <div>
        <label htmlFor={fid("name")} style={labelStyle}>Nome gara</label>
        <input
          id={fid("name")}
          type="text"
          value={form.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="es. Maratona di Bologna"
          style={inputStyle}
          maxLength={120}
          autoFocus
        />
      </div>

      <div style={{ marginTop: "12px" }}>
        <label htmlFor={fid("sport")} style={labelStyle}>Sport</label>
        <select
          id={fid("sport")}
          value={form.sport}
          onChange={e => update({ sport: e.target.value as RaceEvent["sport"] })}
          style={{ ...inputStyle, fontFamily: "inherit" }}
        >
          {(Object.keys(SPORT_LABELS) as RaceEvent["sport"][]).map(s => (
            <option key={s} value={s}>{SPORT_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <div style={{
        marginTop: "12px",
        display: "grid",
        gridTemplateColumns: showDistance ? "1fr 1fr" : "1fr",
        gap: "10px",
      }}>
        <div>
          <label htmlFor={fid("date")} style={labelStyle}>Data</label>
          <input
            id={fid("date")}
            type="date"
            value={form.date}
            min={editingId ? undefined : minDate}
            onChange={e => update({ date: e.target.value })}
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
              value={form.distance_km}
              onChange={e => update({ distance_km: e.target.value })}
              placeholder="es. 42.195"
              style={inputStyle}
            />
          </div>
        )}
      </div>

      {showTargetTime && (
        <div style={{ marginTop: "12px" }}>
          <label htmlFor={fid("time")} style={labelStyle}>Tempo target (opzionale)</label>
          <input
            id={fid("time")}
            type="text"
            value={form.targetTime}
            onChange={e => update({ targetTime: e.target.value })}
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
            const checked = form.priority === p;
            const colors = PRIORITY_COLORS[p];
            return (
              <label
                key={p}
                htmlFor={id}
                style={{
                  flex: "1 1 90px",
                  display: "flex", flexDirection: "column", gap: "2px",
                  padding: "10px 12px", minHeight: "44px",
                  background: checked ? colors.bg : "#0F172A",
                  border: checked ? `1px solid ${colors.border}` : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "10px", cursor: "pointer",
                  color: checked ? colors.fg : "#CBD5E1",
                }}
              >
                <input
                  type="radio"
                  id={id}
                  name={fid("prio")}
                  value={p}
                  checked={checked}
                  onChange={() => update({ priority: p })}
                  style={{ accentColor: colors.fg, marginBottom: "2px" }}
                />
                <span style={{ fontWeight: 700, fontSize: "13px" }}>{PRIORITY_LABELS[p].label}</span>
                <span style={{ fontSize: "11px", color: checked ? colors.fg : "#94A3B8", lineHeight: 1.3 }}>
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
          value={form.notes}
          onChange={e => update({ notes: e.target.value })}
          placeholder="terreno, altimetria, condizioni…"
          style={{ ...inputStyle, minHeight: "60px", resize: "vertical", fontFamily: "inherit" }}
          maxLength={500}
        />
      </div>

      {error && (
        <div role="alert" style={{
          marginTop: "10px", fontSize: "13px", color: "#EF4444",
          padding: "8px 12px", background: "#7F1D1D22", borderRadius: "8px",
        }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{ ...ghostBtn, flex: "0 0 auto" }}
          aria-label="Annulla"
        >
          Annulla
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy}
          style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.5 : 1, cursor: busy ? "wait" : "pointer" }}
          aria-label={editingId ? "Salva modifiche gara" : "Aggiungi questa gara"}
        >
          {busy ? "Salvo…" : editingId ? "Salva modifiche" : "+ Aggiungi"}
        </button>
      </div>
    </div>
  );
}

// ─── MacroBanner sub-component ──────────────────────────────────────────────

interface MacroBannerProps {
  macroResult: ActiveMacroLookupResult;
  onGoToPlan: () => void;
}

function MacroBanner({ macroResult, onGoToPlan }: MacroBannerProps) {
  const { macroContext: ctx, race } = macroResult;
  const phaseColor = ctx.phase === "base"
    ? "#22C55E"
    : ctx.phase === "build"
    ? "#3B82F6"
    : ctx.phase === "peak"
    ? "#14B8A6"
    : ctx.phase === "taper"
    ? "#F59E0B"
    : "#94A3B8";
  const phaseLabel = ctx.phase.toUpperCase();

  return (
    <div
      role="region"
      aria-label="Macrociclo attivo"
      style={{
        background: "linear-gradient(135deg, #16213E 0%, #1E293B 100%)",
        border: `1px solid ${phaseColor}66`,
        borderLeft: `4px solid ${phaseColor}`,
        borderRadius: "14px",
        padding: "16px",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px",
        fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em",
        color: phaseColor, textTransform: "uppercase",
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span aria-hidden>🎯</span>
        <span>Macrociclo attivo</span>
      </div>

      <div style={{ fontSize: "15px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
        In preparazione per: {race.name}
      </div>

      <div style={{
        fontSize: "12px", color: "#94A3B8", marginBottom: "12px",
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {SPORT_ICONS[race.sport]} {SPORT_LABELS[race.sport]} · {ctx.weeksToRace} settimane alla gara
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
        <span
          aria-label={`Fase ${phaseLabel}, settimana ${ctx.weekNumber} di ${ctx.totalWeeks}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "6px 10px", borderRadius: "8px",
            background: `${phaseColor}22`, color: phaseColor,
            fontSize: "12px", fontWeight: 700,
          }}
        >
          Fase: {phaseLabel} (sett {ctx.weekNumber}/{ctx.totalWeeks})
        </span>
        <span
          aria-label={`Volume target ${Math.round(ctx.volumeMultiplier * 100)} percento della baseline`}
          style={{
            display: "inline-flex", alignItems: "center",
            padding: "6px 10px", borderRadius: "8px",
            background: "#1A1A2E", color: "#A5B4FC",
            fontSize: "12px", fontWeight: 600,
          }}
        >
          Volume: {ctx.volumeMultiplier >= 1
            ? `+${Math.round((ctx.volumeMultiplier - 1) * 100)}%`
            : `${Math.round((ctx.volumeMultiplier - 1) * 100)}%`} baseline
        </span>
        <span
          aria-label={`Intensità target ${ctx.intensityHighPct} percento sessioni in zona 3 o superiore`}
          style={{
            display: "inline-flex", alignItems: "center",
            padding: "6px 10px", borderRadius: "8px",
            background: "#1A1A2E", color: "#FCD34D",
            fontSize: "12px", fontWeight: 600,
          }}
        >
          Z3+: {ctx.intensityHighPct}%
        </span>
      </div>

      <button
        type="button"
        onClick={onGoToPlan}
        aria-label="Vedi il piano della settimana corrente"
        style={{
          ...ghostBtn,
          minHeight: "44px",
          width: "100%",
          background: "transparent",
          border: `1px solid ${phaseColor}66`,
          color: phaseColor,
          fontWeight: 700,
        }}
      >
        Vedi piano settimana corrente →
      </button>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function RaceCalendarSection() {
  const [races, setRaces] = useState<RaceEvent[]>([]);
  const [macroResult, setMacroResult] = useState<ActiveMacroLookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRace, setEditingRace] = useState<RaceEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Carica race + macro al mount e quando cambia il backing storage.
  // Auto-migra `profile.races` → `user-races` se la storage key autoritativa
  // manca (caso utente che ha completato onboarding pre-Wave 3.3 e non ha
  // ancora interagito con questa sezione → senza migration, recomputeActiveMacro
  // non vedrebbe le race e il banner macro non apparirebbe).
  const reload = async () => {
    const rawUserRaces = await storage.get(RACES_KEY);
    if (!rawUserRaces) {
      const profile = await getJSON<UserProfile | null>(PROFILE_KEY, null);
      const profileRaces = (profile?.races && Array.isArray(profile.races)) ? profile.races : [];
      if (profileRaces.length > 0) {
        // Migration silente: scrive user-races + ricomputa macro.
        try {
          await setJSON(RACES_KEY, profileRaces);
          await recomputeActiveMacro();
        } catch (e) {
          console.warn("[RaceCalendarSection.reload] migration profile.races → user-races failed:", e);
        }
      }
    }
    const list = await loadRacesWithFallback();
    setRaces(list);
    const profile = await getJSON<UserProfile | null>(PROFILE_KEY, null);
    const macro = await loadActiveMacroContext(profile);
    setMacroResult(macro);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    const offMacro = events.on("macro:updated", () => { void reload(); });
    const offProfile = events.on("profile:updated", () => { void reload(); });
    const offExt = events.on("data:externalChange", ({ key }) => {
      if (key === RACES_KEY || key === PROFILE_KEY || key.startsWith(MACRO_CYCLE_PREFIX)) {
        void reload();
      }
    });
    return () => { offMacro(); offProfile(); offExt(); };
  }, []);

  // Auto-clear feedback toast.
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const handleAddSubmit = async (form: RaceFormState) => {
    if (busy) return;
    setBusy(true);
    try {
      const distance_km = (form.sport === "corsa" || form.sport === "trail") && form.distance_km.trim()
        ? parseFloat(form.distance_km.replace(",", "."))
        : undefined;
      const showTime = form.sport !== "sport" && form.sport !== "altro";
      const newRace: RaceEvent = {
        id: makeRaceId(),
        name: form.name.trim(),
        sport: form.sport,
        date: form.date,
        distance_km,
        targetTime: showTime && form.targetTime.trim() ? form.targetTime.trim() : undefined,
        targetTimeSec: showTime ? parseTargetTimeToSec(form.targetTime) : undefined,
        priority: form.priority,
        notes: form.notes.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      const next = [...races, newRace].sort((a, b) => a.date.localeCompare(b.date));
      await persistRacesAndRecompute(next);
      setShowForm(false);
      setFeedback({ type: "success", text: `✓ Gara "${newRace.name}" aggiunta.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback({ type: "error", text: `✗ Errore aggiunta: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const handleEditSubmit = async (form: RaceFormState) => {
    if (busy || !editingRace) return;
    setBusy(true);
    try {
      const distance_km = (form.sport === "corsa" || form.sport === "trail") && form.distance_km.trim()
        ? parseFloat(form.distance_km.replace(",", "."))
        : undefined;
      const showTime = form.sport !== "sport" && form.sport !== "altro";
      const updated: RaceEvent = {
        ...editingRace,
        name: form.name.trim(),
        sport: form.sport,
        date: form.date,
        distance_km,
        targetTime: showTime && form.targetTime.trim() ? form.targetTime.trim() : undefined,
        targetTimeSec: showTime ? parseTargetTimeToSec(form.targetTime) : undefined,
        priority: form.priority,
        notes: form.notes.trim() || undefined,
      };
      const next = races
        .map(r => r.id === editingRace.id ? updated : r)
        .sort((a, b) => a.date.localeCompare(b.date));
      await persistRacesAndRecompute(next);
      setEditingRace(null);
      setFeedback({ type: "success", text: `✓ Gara "${updated.name}" aggiornata.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback({ type: "error", text: `✗ Errore modifica: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (race: RaceEvent) => {
    if (busy) return;
    const isActiveA = race.priority === "A" && macroResult?.race.id === race.id;
    const confirmMsg = isActiveA
      ? `Eliminare la gara "${race.name}"? Il macrociclo associato sarà cancellato.`
      : `Eliminare la gara "${race.name}"?`;
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const next = races.filter(r => r.id !== race.id);
      await persistRacesAndRecompute(next);
      setFeedback({ type: "success", text: `✓ Gara "${race.name}" rimossa.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback({ type: "error", text: `✗ Errore rimozione: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const goToPlan = () => {
    // Nav piatta: il piano è il tab top-level "plan" (il legacy "coach"
    // atterrava su Oggi via alias).
    events.emit("nav:goto", { tab: "plan" });
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={cardStyle} aria-busy="true">
        <div style={{ color: "#94A3B8", fontSize: "13px" }}>Caricamento gare…</div>
      </div>
    );
  }

  const hasRaces = races.length > 0;

  return (
    <div data-testid="race-calendar-section" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{
        background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "14px", padding: "16px",
      }}>
        <div style={{
          display: "flex", alignItems: "baseline", gap: "10px",
          marginBottom: "12px", flexWrap: "wrap",
        }}>
          <div style={{
            fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em",
            color: "#14B8A6", textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Gare e obiettivi
          </div>
          <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.4 }}>
            Una gara priorità A attiva il macrociclo (12-24 sett, fasi base/build/peak/taper).
          </div>
        </div>

        {/* Banner Macrociclo attivo */}
        {macroResult && (
          <div style={{ marginBottom: "16px" }}>
            <MacroBanner macroResult={macroResult} onGoToPlan={goToPlan} />
          </div>
        )}

        {/* Empty state */}
        {!hasRaces && !showForm && (
          <div
            data-testid="races-empty-state"
            style={{
              padding: "14px 16px", background: "#1A1A2E",
              border: "1px dashed rgba(255,255,255,0.12)",
              borderRadius: "12px",
              color: "#CBD5E1", fontSize: "13px", lineHeight: 1.5,
              display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              Nessuna gara configurata. Aggiungi una gara priorità A per attivare il macrociclo.
            </div>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              style={{ ...primaryBtn, minHeight: "44px", flexShrink: 0 }}
              aria-label="Aggiungi la prima gara"
            >
              + Aggiungi gara
            </button>
          </div>
        )}

        {/* Lista race */}
        {hasRaces && (
          <ul
            data-testid="races-list"
            aria-label="Elenco gare configurate"
            style={{
              listStyle: "none", padding: 0, margin: "0 0 12px",
              display: "flex", flexDirection: "column", gap: "6px",
            }}
          >
            {races.map(r => {
              const days = daysToRace(r.date);
              const isPast = days < 0;
              const colors = PRIORITY_COLORS[r.priority];
              const isEditingThis = editingRace?.id === r.id;
              if (isEditingThis) {
                return (
                  <li key={r.id}>
                    <RaceForm
                      initial={raceToForm(r)}
                      editingId={r.id}
                      onSubmit={handleEditSubmit}
                      onCancel={() => setEditingRace(null)}
                      busy={busy}
                    />
                  </li>
                );
              }
              const daysLabel = isPast
                ? `passata (${-days}gg fa)`
                : days === 0 ? "oggi" : `tra ${days}gg`;
              return (
                <li key={r.id}>
                  <details
                    style={{
                      ...cardStyle,
                      padding: 0,
                      borderLeft: `3px solid ${colors.border}`,
                      background: isPast ? "#0F172A" : "#1A1A2E",
                      opacity: isPast ? 0.7 : 1,
                    }}
                  >
                    <summary
                      aria-label={`${r.name} · ${r.date} · priorità ${r.priority} · ${daysLabel}`}
                      style={{
                        listStyle: "none", cursor: "pointer",
                        padding: "10px 12px", minHeight: "44px", boxSizing: "border-box",
                        display: "flex", alignItems: "center", gap: "8px",
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          padding: "2px 6px", borderRadius: "4px",
                          background: colors.bg, color: colors.fg,
                          fontSize: "10px", fontWeight: 800, flexShrink: 0,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >{r.priority}</span>
                      <span aria-hidden style={{ fontSize: "14px", flexShrink: 0 }}>{SPORT_ICONS[r.sport]}</span>
                      <span style={{
                        flex: 1, minWidth: 0, fontWeight: 700, fontSize: "14px",
                        color: "#E2E8F0",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{r.name}</span>
                      <span style={{
                        fontSize: "11px", color: "#94A3B8", flexShrink: 0,
                        fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap",
                      }}>{r.date} · {daysLabel}</span>
                    </summary>

                    <div style={{
                      padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: "8px",
                      fontSize: "12px", color: "#CBD5E1",
                    }}>
                      <div style={{
                        display: "flex", flexWrap: "wrap", gap: "6px 12px",
                        fontFamily: "'JetBrains Mono', monospace", color: "#94A3B8",
                      }}>
                        <span>{SPORT_LABELS[r.sport]}</span>
                        {r.distance_km != null && <span>{r.distance_km} km</span>}
                        {r.targetTime && <span>target {r.targetTime}</span>}
                        <span>{PRIORITY_LABELS[r.priority].hint}</span>
                      </div>
                      {r.notes && (
                        <div style={{ fontStyle: "italic", lineHeight: 1.4 }}>{r.notes}</div>
                      )}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => { setEditingRace(r); setShowForm(false); }}
                          disabled={busy || editingRace !== null}
                          aria-label={`Modifica gara ${r.name}`}
                          style={{
                            flex: "1 1 120px", minHeight: "44px",
                            padding: "8px 12px", background: "transparent",
                            border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
                            color: "#A5B4FC", fontSize: "13px", fontWeight: 600,
                            cursor: (busy || editingRace !== null) ? "not-allowed" : "pointer",
                            opacity: (busy || editingRace !== null) ? 0.5 : 1,
                          }}
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(r)}
                          disabled={busy}
                          aria-label={`Rimuovi gara ${r.name}`}
                          data-testid={`remove-race-${r.id}`}
                          style={{
                            flex: "1 1 120px", minHeight: "44px",
                            padding: "8px 12px", background: "transparent",
                            border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px",
                            color: "#EF4444", fontSize: "13px", fontWeight: 600,
                            cursor: busy ? "wait" : "pointer",
                            opacity: busy ? 0.5 : 1,
                          }}
                        >
                          Rimuovi
                        </button>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        {/* Add form (mostrato in cima alla lista quando attivo) */}
        {showForm && !editingRace && (
          <div style={{ marginBottom: "12px" }}>
            <RaceForm
              initial={EMPTY_FORM}
              onSubmit={handleAddSubmit}
              onCancel={() => setShowForm(false)}
              busy={busy}
            />
          </div>
        )}

        {/* Bottone "+ Aggiungi" se ci sono già race e form chiuso */}
        {hasRaces && !showForm && !editingRace && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              ...primaryBtn, width: "100%",
              background: "#1A1A2E",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#E2E8F0",
              fontSize: "14px",
            }}
            aria-label="Aggiungi una nuova gara"
          >
            + Aggiungi gara
          </button>
        )}

        {/* Feedback toast */}
        {feedback && (
          <div
            role="alert"
            aria-live="polite"
            style={{
              marginTop: "12px", padding: "10px 12px",
              background: feedback.type === "success" ? "#22C55E15" : "#EF444415",
              border: `1px solid ${feedback.type === "success" ? "#22C55E44" : "#EF444444"}`,
              borderRadius: "8px",
              color: feedback.type === "success" ? "#22C55E" : "#EF4444",
              fontSize: "13px", lineHeight: 1.5,
            }}
          >
            {feedback.text}
          </div>
        )}
      </div>
    </div>
  );
}
