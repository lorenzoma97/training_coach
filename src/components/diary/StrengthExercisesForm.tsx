// Wave 3.1 — StrengthExercisesForm
// Owner: frontend-specialist
//
// Form strutturato per registrare esercizi di forza nel diario (parallel al
// legacy `fields.note`). Incluso da DiaryApp solo per workout type
// `forza_gambe` e `forza_upper`, dietro toggle "Modalità strutturata"
// (default OFF, backward-compat al 100%).
//
// Wireframe mobile (390x844):
//   ┌──────────────────────────────────────────┐
//   │ Esercizi (modalità strutturata)          │
//   │                                          │
//   │ ┌─ Back Squat ─────────────────────┐     │
//   │ │ Set 1 [reps] [kg] [RPE] [RIR] 🗑 │     │
//   │ │ Set 2 [reps] [kg] [RPE] [RIR] 🗑 │     │
//   │ │ + Set                             │     │
//   │ │ Note (toggle)                     │     │
//   │ │ ❌ Rimuovi esercizio              │     │
//   │ └───────────────────────────────────┘     │
//   │ ┌─ Bench Press ────────────────────┐     │
//   │ │ ...                               │     │
//   │ └───────────────────────────────────┘     │
//   │ + Aggiungi esercizio                     │
//   └──────────────────────────────────────────┘
//
// Pure helpers (esportati per testing in __tests__/StrengthExercisesForm.test.ts):
//   - filterAvailableExercises(equipment) → Exercise[]
//   - groupExercisesByPattern(list) → Record<pattern, Exercise[]>
//   - emptySet() → ExerciseSet
//   - cloneSetAsTemplate(prev) → ExerciseSet
//   - addExerciseToList(list, exerciseId) → ExercisePerformance[]
//   - removeExerciseFromList(list, idx) → ExercisePerformance[]
//   - addSetToExercise(list, exIdx) → ExercisePerformance[]
//   - removeSetFromExercise(list, exIdx, setIdx) → ExercisePerformance[]
//   - updateSetField(list, exIdx, setIdx, field, value) → ExercisePerformance[]
//   - updateExerciseNotes(list, exIdx, notes) → ExercisePerformance[]
//
// Test runner: vitest in Node (no jsdom) — niente render, solo smoke + helpers.

import { useId, useMemo, useState } from "react";
import { EXERCISES, EXERCISES_BY_ID } from "../../lib/catalog/exercises";
import type { Exercise, ExercisePattern } from "../../lib/types/exercise";
import type { ExercisePerformance, ExerciseSet } from "../../lib/types/strength";
import { normalizeEquipmentTags } from "../../lib/equipment/equipmentNormalizer";

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS (testabili senza React)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filtra il catalog esercizi tenendo solo quelli eseguibili con l'equipment
 * dichiarato dall'utente. `bodyweight` è sempre disponibile (corpo libero
 * gratis). AND check: tutti i tag in ex.equipment devono essere presenti.
 *
 * Allineato a `strengthSessionPrompt.isExerciseAvailable` (stessa semantica).
 */
export function filterAvailableExercises(availableEquipment: string[]): Exercise[] {
  // Normalizza input italiano free-text (es. "manubri", "bilanciere", "palestra")
  // in tag canonici. Senza normalizer, l'utente che ha inserito equipment in
  // italiano vedrebbe SOLO esercizi a corpo libero (filter falliva su tag IT
  // vs catalog EN). Vedi src/lib/equipment/equipmentNormalizer.ts.
  const normalizedTags = normalizeEquipmentTags(availableEquipment);
  const set = new Set<string>(normalizedTags); // include "bodyweight" sempre
  return EXERCISES.filter(ex => ex.equipment.every(tag => set.has(tag)));
}

/**
 * Raggruppa esercizi per pattern motorio. Pattern senza esercizi sono assenti.
 * Ordine interno: name (it).
 */
export function groupExercisesByPattern(list: Exercise[]): Record<string, Exercise[]> {
  const out: Record<string, Exercise[]> = {};
  for (const ex of list) {
    if (!out[ex.pattern]) out[ex.pattern] = [];
    out[ex.pattern].push(ex);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => a.name.localeCompare(b.name, "it"));
  }
  return out;
}

/** Set vuoto di default per nuovo esercizio (reps=0, tutto undefined). */
export function emptySet(): ExerciseSet {
  return { reps: 0 };
}

/**
 * Clona l'ultimo set come template per il prossimo (reps + weight + rpe + rir).
 * Workflow tipico: utente compila set 1, poi "+ Set" pre-popola coi valori già
 * usati così deve solo aggiustare. NON copia rest_sec/tut_sec/notes.
 */
export function cloneSetAsTemplate(prev: ExerciseSet): ExerciseSet {
  const next: ExerciseSet = { reps: prev.reps };
  if (prev.weight_kg !== undefined) next.weight_kg = prev.weight_kg;
  if (prev.rpe !== undefined) next.rpe = prev.rpe;
  if (prev.rir !== undefined) next.rir = prev.rir;
  return next;
}

export function addExerciseToList(list: ExercisePerformance[], exerciseId: string): ExercisePerformance[] {
  return [...list, { exerciseId, sets: [emptySet()] }];
}

export function removeExerciseFromList(list: ExercisePerformance[], idx: number): ExercisePerformance[] {
  if (idx < 0 || idx >= list.length) return list;
  return list.filter((_, i) => i !== idx);
}

export function addSetToExercise(list: ExercisePerformance[], exIdx: number): ExercisePerformance[] {
  if (exIdx < 0 || exIdx >= list.length) return list;
  return list.map((ex, i) => {
    if (i !== exIdx) return ex;
    const lastSet = ex.sets[ex.sets.length - 1];
    const newSet = lastSet ? cloneSetAsTemplate(lastSet) : emptySet();
    return { ...ex, sets: [...ex.sets, newSet] };
  });
}

export function removeSetFromExercise(list: ExercisePerformance[], exIdx: number, setIdx: number): ExercisePerformance[] {
  if (exIdx < 0 || exIdx >= list.length) return list;
  return list.map((ex, i) => {
    if (i !== exIdx) return ex;
    if (setIdx < 0 || setIdx >= ex.sets.length) return ex;
    return { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) };
  });
}

export type ExerciseSetField = "reps" | "weight_kg" | "rpe" | "rir";

export function updateSetField(
  list: ExercisePerformance[],
  exIdx: number,
  setIdx: number,
  field: ExerciseSetField,
  value: number | undefined,
): ExercisePerformance[] {
  if (exIdx < 0 || exIdx >= list.length) return list;
  return list.map((ex, i) => {
    if (i !== exIdx) return ex;
    if (setIdx < 0 || setIdx >= ex.sets.length) return ex;
    return {
      ...ex,
      sets: ex.sets.map((s, j) => {
        if (j !== setIdx) return s;
        // reps è obbligatorio nel type → cade su 0 se undefined/non finito
        if (field === "reps") {
          return { ...s, reps: typeof value === "number" && Number.isFinite(value) ? value : 0 };
        }
        // weight_kg / rpe / rir: opzionali → undefined rimuove la chiave
        const next: ExerciseSet = { ...s };
        if (value === undefined) {
          if (field === "weight_kg") delete next.weight_kg;
          else if (field === "rpe") delete next.rpe;
          else if (field === "rir") delete next.rir;
        } else {
          if (field === "weight_kg") next.weight_kg = value;
          else if (field === "rpe") next.rpe = value;
          else if (field === "rir") next.rir = value;
        }
        return next;
      }),
    };
  });
}

export function updateExerciseNotes(list: ExercisePerformance[], exIdx: number, notes: string): ExercisePerformance[] {
  if (exIdx < 0 || exIdx >= list.length) return list;
  return list.map((ex, i) => {
    if (i !== exIdx) return ex;
    const next = { ...ex };
    if (notes.trim() === "") {
      delete next.notes;
    } else {
      next.notes = notes;
    }
    return next;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTANTI UI
// ─────────────────────────────────────────────────────────────────────────────

/** Etichette user-facing per i pattern motori (in italiano). */
const PATTERN_LABELS: Record<ExercisePattern, string> = {
  squat: "Squat",
  hinge: "Hinge (Stacchi)",
  lunge: "Affondi",
  horizontal_push: "Spinta orizzontale",
  vertical_push: "Spinta verticale",
  horizontal_pull: "Trazione orizzontale",
  vertical_pull: "Trazione verticale",
  carry: "Trasporti",
  core_antiext: "Core anti-estensione",
  core_antirot: "Core anti-rotazione",
  plyometric: "Pliometria",
  isometric: "Isometria",
  mobility: "Mobilità",
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export interface StrengthExercisesFormProps {
  /** Equipment disponibile dell'utente (per filtro picker). "bodyweight" sempre incluso. */
  availableEquipment: string[];
  /** Stato corrente esercizi registrati. */
  exercises: ExercisePerformance[];
  /** Callback su ogni cambio (controlled component). */
  onChange: (next: ExercisePerformance[]) => void;
  /** Disabilita tutti i controlli durante save. */
  disabled?: boolean;
}

// Stili base — riutilizzati DiaryApp/StepStrength1RM (palette diario coerente)
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", background: "#1A1A2E",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px",
  color: "#E2E8F0", fontSize: "14px", outline: "none", boxSizing: "border-box",
  fontFamily: "inherit", minHeight: "44px",
};
const labelStyle: React.CSSProperties = {
  fontSize: "11px", fontWeight: 600, color: "#94A3B8",
  textTransform: "uppercase", letterSpacing: "0.05em",
  display: "block", marginBottom: "4px",
};
const cardStyle: React.CSSProperties = {
  background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px", padding: "10px 12px",
};
const ghostBtnStyle: React.CSSProperties = {
  padding: "10px 14px", minHeight: "44px", background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px",
  color: "#CBD5E1", fontSize: "14px", fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "12px 16px", minHeight: "44px",
  background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
  border: "none", borderRadius: "10px", color: "#FFF",
  fontSize: "14px", fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit",
};
const iconBtnStyle: React.CSSProperties = {
  minWidth: "44px", minHeight: "44px",
  background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "8px", color: "#94A3B8",
  fontSize: "16px", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

/** Numerico parse: "" → undefined, valida finito. */
function parseNum(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Numerico stringify per <input>: undefined → "". */
function fmtNum(v: number | undefined): string {
  return v === undefined ? "" : String(v);
}

export default function StrengthExercisesForm({
  availableEquipment,
  exercises,
  onChange,
  disabled = false,
}: StrengthExercisesFormProps) {
  const uid = useId();
  const fid = (k: string) => `${uid}-${k}`;

  const available = useMemo(() => filterAvailableExercises(availableEquipment), [availableEquipment]);
  const grouped = useMemo(() => groupExercisesByPattern(available), [available]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [notesOpen, setNotesOpen] = useState<Record<number, boolean>>({});

  const filteredForPicker = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return grouped;
    const out: Record<string, Exercise[]> = {};
    for (const [pattern, list] of Object.entries(grouped)) {
      const matches = list.filter(ex =>
        ex.name.toLowerCase().includes(q) || ex.id.toLowerCase().includes(q)
      );
      if (matches.length > 0) out[pattern] = matches;
    }
    return out;
  }, [grouped, pickerSearch]);

  const onAddExercise = (exerciseId: string) => {
    onChange(addExerciseToList(exercises, exerciseId));
    setPickerOpen(false);
    setPickerSearch("");
  };

  const onRemoveExercise = (idx: number) => {
    onChange(removeExerciseFromList(exercises, idx));
    setNotesOpen(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const onAddSet = (exIdx: number) => onChange(addSetToExercise(exercises, exIdx));
  const onRemoveSet = (exIdx: number, setIdx: number) => onChange(removeSetFromExercise(exercises, exIdx, setIdx));
  const onSetField = (exIdx: number, setIdx: number, field: ExerciseSetField, value: number | undefined) =>
    onChange(updateSetField(exercises, exIdx, setIdx, field, value));
  const onNotesChange = (exIdx: number, notes: string) => onChange(updateExerciseNotes(exercises, exIdx, notes));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {exercises.length === 0 && (
        <div style={{
          fontSize: "12px", color: "#64748B", padding: "10px 12px",
          background: "#16213E", borderRadius: "10px",
          border: "1px dashed rgba(255,255,255,0.08)",
          textAlign: "center", lineHeight: 1.4,
        }}>
          Nessun esercizio. Usa <b>+ Aggiungi esercizio</b> per registrare carichi e set.
        </div>
      )}

      {exercises.map((perf, exIdx) => {
        const exercise = EXERCISES_BY_ID[perf.exerciseId];
        const displayName = exercise?.name ?? perf.exerciseId;
        const showNotes = notesOpen[exIdx] === true || (perf.notes !== undefined && perf.notes !== "");
        return (
          <div key={`${perf.exerciseId}-${exIdx}`} style={cardStyle} role="group" aria-label={displayName}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0" }}>{displayName}</div>
                {exercise?.pattern && (
                  <div style={{
                    fontSize: "10px", color: "#64748B",
                    fontFamily: "'JetBrains Mono', monospace",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {PATTERN_LABELS[exercise.pattern] ?? exercise.pattern}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemoveExercise(exIdx)}
                disabled={disabled}
                aria-label={`Rimuovi esercizio ${displayName}`}
                title="Rimuovi esercizio"
                style={{
                  ...iconBtnStyle,
                  borderColor: "rgba(239,68,68,0.25)",
                  color: "#EF4444",
                  opacity: disabled ? 0.5 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                  flexShrink: 0,
                }}
              >×</button>
            </div>

            {/* Header set */}
            <div style={{
              display: "grid", gridTemplateColumns: "28px 1fr 1fr 1fr 1fr 44px",
              gap: "5px", marginBottom: "4px", alignItems: "end",
            }}>
              <span style={{ ...labelStyle, marginBottom: 0, textAlign: "center" }} aria-hidden="true">#</span>
              <span style={{ ...labelStyle, marginBottom: 0, textAlign: "center" }} aria-hidden="true">Reps</span>
              <span style={{ ...labelStyle, marginBottom: 0, textAlign: "center" }} aria-hidden="true">Kg</span>
              <span style={{ ...labelStyle, marginBottom: 0, textAlign: "center" }} aria-hidden="true">RPE</span>
              <span style={{ ...labelStyle, marginBottom: 0, textAlign: "center" }} aria-hidden="true">RIR</span>
              <span aria-hidden="true" />
            </div>

            {perf.sets.map((set, setIdx) => {
              const repsId = fid(`reps-${exIdx}-${setIdx}`);
              const kgId = fid(`kg-${exIdx}-${setIdx}`);
              const rpeId = fid(`rpe-${exIdx}-${setIdx}`);
              const rirId = fid(`rir-${exIdx}-${setIdx}`);
              return (
                <div key={setIdx} style={{
                  display: "grid", gridTemplateColumns: "28px 1fr 1fr 1fr 1fr 44px",
                  gap: "5px", marginBottom: "5px", alignItems: "center",
                }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "13px", color: "#94A3B8",
                    textAlign: "center", fontWeight: 700,
                  }} aria-hidden="true">{setIdx + 1}</div>
                  <input
                    id={repsId}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={999}
                    placeholder="0"
                    value={fmtNum(set.reps)}
                    onChange={e => onSetField(exIdx, setIdx, "reps", parseNum(e.target.value) ?? 0)}
                    aria-label={`${displayName}, set ${setIdx + 1}, ripetizioni`}
                    disabled={disabled}
                    style={{ ...inputStyle, padding: "10px 8px", textAlign: "center" }}
                  />
                  <input
                    id={kgId}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={1000}
                    step="0.5"
                    placeholder="—"
                    value={fmtNum(set.weight_kg)}
                    onChange={e => onSetField(exIdx, setIdx, "weight_kg", parseNum(e.target.value))}
                    aria-label={`${displayName}, set ${setIdx + 1}, peso in kg (vuoto per corpo libero)`}
                    disabled={disabled}
                    style={{ ...inputStyle, padding: "10px 8px", textAlign: "center" }}
                  />
                  <input
                    id={rpeId}
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={10}
                    step="0.5"
                    placeholder="—"
                    value={fmtNum(set.rpe)}
                    onChange={e => onSetField(exIdx, setIdx, "rpe", parseNum(e.target.value))}
                    aria-label={`${displayName}, set ${setIdx + 1}, RPE da 1 a 10 (opzionale)`}
                    disabled={disabled}
                    style={{ ...inputStyle, padding: "10px 8px", textAlign: "center" }}
                  />
                  <input
                    id={rirId}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={5}
                    placeholder="—"
                    value={fmtNum(set.rir)}
                    onChange={e => onSetField(exIdx, setIdx, "rir", parseNum(e.target.value))}
                    aria-label={`${displayName}, set ${setIdx + 1}, RIR da 0 a 5 (opzionale)`}
                    disabled={disabled}
                    style={{ ...inputStyle, padding: "10px 8px", textAlign: "center" }}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveSet(exIdx, setIdx)}
                    disabled={disabled || perf.sets.length <= 1}
                    aria-label={`Rimuovi set ${setIdx + 1} di ${displayName}`}
                    title="Rimuovi set"
                    style={{
                      ...iconBtnStyle,
                      opacity: disabled || perf.sets.length <= 1 ? 0.4 : 1,
                      cursor: disabled || perf.sets.length <= 1 ? "not-allowed" : "pointer",
                    }}
                  >🗑</button>
                </div>
              );
            })}

            <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => onAddSet(exIdx)}
                disabled={disabled}
                aria-label={`Aggiungi un nuovo set a ${displayName}`}
                style={{ ...ghostBtnStyle, flex: "1 1 120px", padding: "8px 12px", fontSize: "13px", opacity: disabled ? 0.5 : 1 }}
              >+ Set</button>
              <button
                type="button"
                onClick={() => setNotesOpen(prev => ({ ...prev, [exIdx]: !showNotes }))}
                disabled={disabled}
                aria-expanded={showNotes}
                aria-controls={fid(`notes-${exIdx}`)}
                aria-label={`${showNotes ? "Nascondi" : "Mostra"} note per ${displayName}`}
                style={{ ...ghostBtnStyle, flex: "1 1 100px", padding: "8px 12px", fontSize: "13px", opacity: disabled ? 0.5 : 1 }}
              >{showNotes ? "− Note" : "+ Note"}</button>
            </div>

            {showNotes && (
              <div style={{ marginTop: "8px" }}>
                <textarea
                  id={fid(`notes-${exIdx}`)}
                  value={perf.notes ?? ""}
                  onChange={e => onNotesChange(exIdx, e.target.value)}
                  placeholder="Note: tecnica, sensazioni, dolore..."
                  aria-label={`Note esercizio ${displayName}`}
                  disabled={disabled}
                  rows={2}
                  style={{ ...inputStyle, minHeight: "52px", resize: "vertical", padding: "8px 10px" }}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Picker per aggiungere esercizio */}
      {!pickerOpen && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={disabled || available.length === 0}
          aria-label="Apri il selettore per aggiungere un esercizio"
          style={{
            ...primaryBtnStyle, width: "100%",
            opacity: disabled || available.length === 0 ? 0.5 : 1,
            cursor: disabled || available.length === 0 ? "not-allowed" : "pointer",
          }}
        >+ Aggiungi esercizio</button>
      )}

      {pickerOpen && (
        <div style={cardStyle} role="dialog" aria-label="Seleziona esercizio dal catalogo">
          <div style={{ marginBottom: "10px" }}>
            <label htmlFor={fid("search")} style={labelStyle}>Cerca esercizio</label>
            <input
              id={fid("search")}
              type="search"
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
              placeholder="es. squat, panca, stacco..."
              disabled={disabled}
              autoFocus
              style={inputStyle}
            />
          </div>

          {available.length === 0 && (
            <div style={{ fontSize: "13px", color: "#F59E0B", padding: "8px 0" }}>
              Nessun esercizio disponibile per l'equipment dichiarato. Aggiorna il profilo.
            </div>
          )}

          <div style={{ maxHeight: "320px", overflowY: "auto", paddingRight: "4px" }}>
            {Object.entries(filteredForPicker).length === 0 && pickerSearch && (
              <div style={{ fontSize: "13px", color: "#94A3B8", padding: "8px 0" }}>
                Nessun risultato per "{pickerSearch}".
              </div>
            )}
            {Object.entries(filteredForPicker).map(([pattern, list]) => (
              <div key={pattern} style={{ marginBottom: "12px" }}>
                <div style={{
                  ...labelStyle, marginBottom: "6px",
                  color: "#E8553A",
                }}>
                  {PATTERN_LABELS[pattern as ExercisePattern] ?? pattern} · {list.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {list.map(ex => (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => onAddExercise(ex.id)}
                      disabled={disabled}
                      aria-label={`Aggiungi ${ex.name} (${ex.level})`}
                      style={{
                        textAlign: "left", padding: "10px 12px", minHeight: "44px",
                        background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: "8px", color: "#E2E8F0",
                        fontSize: "13px", fontFamily: "inherit",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.5 : 1,
                        display: "flex", justifyContent: "space-between", gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ flex: 1 }}>{ex.name}</span>
                      <span style={{
                        fontSize: "10px", color: "#64748B",
                        fontFamily: "'JetBrains Mono', monospace",
                        textTransform: "uppercase",
                      }}>{ex.level}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "10px" }}>
            <button
              type="button"
              onClick={() => { setPickerOpen(false); setPickerSearch(""); }}
              disabled={disabled}
              aria-label="Chiudi il selettore esercizi"
              style={{ ...ghostBtnStyle, width: "100%" }}
            >Annulla</button>
          </div>
        </div>
      )}
    </div>
  );
}
