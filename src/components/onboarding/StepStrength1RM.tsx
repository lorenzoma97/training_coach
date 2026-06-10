// Wave 2.2 — Step opzionale "Test 1RM" dell'OnboardingWizard.
// Owner: frontend-specialist.
//
// Wireframe mobile (390x844):
//   ┌──────────────────────────────────────────┐
//   │ STEP 3 · TEST FORZA                      │
//   │ Test forza (opzionale)                   │
//   │ Spiegazione 2-3 righe…                   │
//   │ 📖 Come fare il test 1RM (link)          │
//   │                                          │
//   │ ┌─ Squat ─────────────────────────┐      │
//   │ │ Peso (kg) [____]                │      │
//   │ │ ◉ Testato  ◯ Stimato            │      │
//   │ │ Data [date picker]              │      │
//   │ └─────────────────────────────────┘      │
//   │ ┌─ Panca piana ───────────────────┐      │
//   │ │ … stessi campi …                │      │
//   │ └─────────────────────────────────┘      │
//   │ ┌─ Stacco da terra ───────────────┐      │
//   │ └─────────────────────────────────┘      │
//   │ + Aggiungi altro esercizio              │
//   │                                          │
//   │ [Lo farò dopo]   [Salva e continua →]    │
//   └──────────────────────────────────────────┘

import { useId, useMemo, useRef, useEffect, useState } from "react";
import { EXERCISES, EXERCISES_BY_ID } from "../../lib/catalog/exercises";
import type { OneRepMax } from "../../lib/types/strength";

// Default lift principali — sempre mostrati. ID coerenti col catalog reale
// (back-squat-barbell, bench-press-flat-barbell, deadlift-conventional-barbell).
const DEFAULT_LIFTS: ReadonlyArray<string> = [
  "back-squat-barbell",
  "bench-press-flat-barbell",
  "deadlift-conventional-barbell",
];

// Range realistico (validazione lieve, non scientifica): bassissimo per
// principianti su accessori (5kg) → world-record-ish max (500kg).
const KG_MIN = 5;
const KG_MAX = 500;

// Link alla guida. Path relativo al repo: in dev la guida è on-disk.
// In Wave 5 polish potremmo servirla come asset PWA o linkare GitHub raw.
const GUIDE_URL = "docs/guida-test-1rm.md";

export interface Step1RMDraft {
  /** Mappa exerciseId → input draft (anche se vuoto, persiste l'ordine custom). */
  entries: Array<{
    exerciseId: string;
    valueKg: string;            // raw input per preservare "" (nessun valore)
    source: "tested" | "estimated";
    acquiredAt: string;         // YYYY-MM-DD
  }>;
}

export const EMPTY_1RM_DRAFT: Step1RMDraft = {
  entries: DEFAULT_LIFTS.map(id => ({
    exerciseId: id,
    valueKg: "",
    source: "tested",
    acquiredAt: new Date().toISOString().slice(0, 10),
  })),
};

/**
 * Costruisce gli OneRepMax da persistere a partire dal draft. Ignora le
 * entry con valueKg vuoto o fuori range. Idempotente.
 */
export function buildOneRepMaxesFromDraft(draft: Step1RMDraft): OneRepMax[] {
  const out: OneRepMax[] = [];
  for (const e of draft.entries) {
    const v = parseFloat(e.valueKg.replace(",", "."));
    if (!Number.isFinite(v) || v < KG_MIN || v > KG_MAX) continue;
    if (!EXERCISES_BY_ID[e.exerciseId]) continue;
    out.push({
      exerciseId: e.exerciseId,
      value_kg: Math.round(v * 10) / 10,
      source: e.source,
      acquiredAt: e.acquiredAt || new Date().toISOString().slice(0, 10),
    });
  }
  return out;
}

interface Props {
  draft: Step1RMDraft;
  onDraftChange: (next: Step1RMDraft) => void;
  /** Callback "Salva e continua". Riceve OneRepMax[] da persistire (può essere []). */
  onSave: (oneRepMaxes: OneRepMax[]) => void;
  /** Callback "Lo farò dopo": skippa senza salvare. */
  onSkip: () => void;
  /** Indietro (alla step Profilo). */
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

export default function StepStrength1RM({ draft, onDraftChange, onSave, onSkip, onBack }: Props) {
  const uid = useId();
  const fid = (k: string) => `${uid}-${k}`;
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // Focus management: al mount, focus sul primo input (Squat kg).
  useEffect(() => {
    firstInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lista esercizi loadable disponibili per il dropdown "+ aggiungi".
  // Esclude quelli già nel draft. Ordinati per pattern → name per UX.
  const availableForAdd = useMemo(() => {
    const inDraft = new Set(draft.entries.map(e => e.exerciseId));
    return EXERCISES
      .filter(e => e.loadable && !inDraft.has(e.id))
      .sort((a, b) => {
        if (a.pattern !== b.pattern) return a.pattern.localeCompare(b.pattern);
        return a.name.localeCompare(b.name, "it");
      });
  }, [draft.entries]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState("");

  const updateEntry = (idx: number, patch: Partial<Step1RMDraft["entries"][number]>) => {
    const next = draft.entries.map((e, i) => i === idx ? { ...e, ...patch } : e);
    onDraftChange({ entries: next });
  };

  const removeEntry = (idx: number) => {
    // I 3 default lift sono rimovibili come gli altri; se tutti vuoti
    // l'utente può saltare. Niente vincoli rigidi.
    const next = draft.entries.filter((_, i) => i !== idx);
    onDraftChange({ entries: next });
  };

  const addExercise = () => {
    if (!pickerValue) return;
    if (draft.entries.some(e => e.exerciseId === pickerValue)) return;
    const next: Step1RMDraft = {
      entries: [
        ...draft.entries,
        {
          exerciseId: pickerValue,
          valueKg: "",
          source: "tested",
          acquiredAt: new Date().toISOString().slice(0, 10),
        },
      ],
    };
    onDraftChange(next);
    setPickerValue("");
    setPickerOpen(false);
  };

  // Validazione: any entry compilata fuori range → blocca save (mostra alert inline).
  const validation = draft.entries.map(e => {
    if (!e.valueKg.trim()) return null; // vuoto = ok (skip)
    const v = parseFloat(e.valueKg.replace(",", "."));
    if (!Number.isFinite(v)) return "Valore non numerico.";
    if (v < KG_MIN) return `Minimo ${KG_MIN} kg.`;
    if (v > KG_MAX) return `Massimo ${KG_MAX} kg.`;
    return null;
  });
  const hasValidationError = validation.some(v => v !== null);
  const hasAnyValue = draft.entries.some(e => e.valueKg.trim() !== "");

  const handleSave = () => {
    if (hasValidationError) return;
    onSave(buildOneRepMaxesFromDraft(draft));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em",
          color: "#6366F1", textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace",
        }}>Step 3 · Test forza</div>
        <h2 style={{
          fontSize: "26px", fontWeight: 900, margin: "6px 0 4px",
          letterSpacing: "-0.03em",
        }}>Test forza (opzionale)</h2>
        <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0, lineHeight: 1.5 }}>
          Il <b>1RM</b> (1 Rep Max) è il peso massimo che puoi sollevare per <b>1 ripetizione</b> in un esercizio.
          Se lo conosci per i tuoi lift principali, il coach può prescriverti carichi precisi
          (es. "4×8 @70% 1RM"). Senza, userà RPE/RIR (più semplice ma meno preciso).
        </p>
      </div>

      <a
        href={GUIDE_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Apri la guida: come fare il test 1RM (nuova scheda)"
        style={{
          alignSelf: "flex-start",
          color: "#6366F1", fontSize: "13px", fontWeight: 600,
          textDecoration: "none", padding: "8px 0",
        }}
      >
        📖 Come fare il test 1RM &rarr;
      </a>

      {draft.entries.map((entry, idx) => {
        const exercise = EXERCISES_BY_ID[entry.exerciseId];
        const err = validation[idx];
        const valueId = fid(`val-${idx}`);
        const sourceName = fid(`src-${idx}`);
        const dateId = fid(`date-${idx}`);
        const errId = fid(`err-${idx}`);
        return (
          <div key={entry.exerciseId} style={cardStyle} role="group" aria-label={exercise?.name ?? entry.exerciseId}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: "12px", gap: "8px",
            }}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#E2E8F0" }}>
                  {exercise?.name ?? entry.exerciseId}
                </div>
                {exercise?.pattern && (
                  <div style={{
                    fontSize: "11px", color: "#64748B",
                    fontFamily: "'JetBrains Mono', monospace",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>{exercise.pattern.replace(/_/g, " ")}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeEntry(idx)}
                aria-label={`Rimuovi ${exercise?.name ?? entry.exerciseId} dalla lista 1RM`}
                style={{
                  background: "transparent", border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#EF4444", borderRadius: "8px", padding: "6px 10px",
                  fontSize: "12px", cursor: "pointer", minHeight: "32px",
                }}
              >Rimuovi</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label htmlFor={valueId} style={labelStyle}>Peso (kg)</label>
                <input
                  ref={idx === 0 ? firstInputRef : undefined}
                  id={valueId}
                  type="number"
                  inputMode="decimal"
                  min={KG_MIN}
                  max={KG_MAX}
                  step="0.5"
                  placeholder="es. 100"
                  value={entry.valueKg}
                  onChange={e => updateEntry(idx, { valueKg: e.target.value })}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? errId : undefined}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor={dateId} style={labelStyle}>Data</label>
                <input
                  id={dateId}
                  type="date"
                  value={entry.acquiredAt}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={e => updateEntry(idx, { acquiredAt: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>

            <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
              <legend style={{ ...labelStyle, padding: 0 }}>Origine valore</legend>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(["tested", "estimated"] as const).map(src => {
                  const id = `${sourceName}-${src}`;
                  const checked = entry.source === src;
                  return (
                    <label
                      key={src}
                      htmlFor={id}
                      style={{
                        flex: "1 1 140px",
                        display: "flex", alignItems: "center", gap: "8px",
                        padding: "10px 12px", minHeight: "44px",
                        background: checked ? "#6366F122" : "#1A1A2E",
                        border: checked ? "1px solid #6366F1" : "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "10px", cursor: "pointer",
                        fontSize: "13px", color: checked ? "#6366F1" : "#CBD5E1",
                        fontWeight: 600,
                      }}
                    >
                      <input
                        type="radio"
                        id={id}
                        name={sourceName}
                        value={src}
                        checked={checked}
                        onChange={() => updateEntry(idx, { source: src })}
                        style={{ accentColor: "#6366F1" }}
                      />
                      {src === "tested" ? "Testato" : "Stimato"}
                    </label>
                  );
                })}
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginTop: "6px", lineHeight: 1.4 }}>
                <b>Testato</b>: hai eseguito un test 1RM o 3-5RM convertito.
                {" "}<b>Stimato</b>: il valore è una tua stima/percezione.
              </div>
            </fieldset>

            {err && (
              <div id={errId} role="alert" style={{
                marginTop: "8px", fontSize: "12px", color: "#EF4444",
                padding: "6px 10px", background: "#7F1D1D22", borderRadius: "6px",
              }}>{err}</div>
            )}
          </div>
        );
      })}

      {/* Picker per aggiungere altri esercizi */}
      <div style={cardStyle}>
        {!pickerOpen && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={availableForAdd.length === 0}
            aria-label="Aggiungi un altro esercizio alla lista 1RM"
            style={{
              ...ghostBtn, width: "100%",
              opacity: availableForAdd.length === 0 ? 0.5 : 1,
              cursor: availableForAdd.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            + Aggiungi altro esercizio
          </button>
        )}
        {pickerOpen && (
          <div>
            <label htmlFor={fid("picker")} style={labelStyle}>
              Scegli un esercizio
            </label>
            <select
              id={fid("picker")}
              value={pickerValue}
              onChange={e => setPickerValue(e.target.value)}
              style={{ ...inputStyle, fontFamily: "inherit" }}
            >
              <option value="">— Seleziona —</option>
              {availableForAdd.map(ex => (
                <option key={ex.id} value={ex.id}>
                  {ex.name} · {ex.pattern.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
              <button type="button" onClick={() => { setPickerOpen(false); setPickerValue(""); }} style={ghostBtn}>
                Annulla
              </button>
              <button
                type="button"
                onClick={addExercise}
                disabled={!pickerValue}
                style={{
                  ...primaryBtn, flex: 1, padding: "10px 14px", fontSize: "14px",
                  opacity: pickerValue ? 1 : 0.5,
                  cursor: pickerValue ? "pointer" : "not-allowed",
                }}
              >
                Aggiungi
              </button>
            </div>
          </div>
        )}
      </div>

      {hasValidationError && (
        <div role="alert" style={{
          fontSize: "13px", color: "#F59E0B",
          padding: "10px 12px", background: "#F59E0B15",
          borderRadius: "8px", border: "1px solid #F59E0B33",
        }}>
          Correggi i valori fuori range ({KG_MIN}–{KG_MAX} kg) prima di continuare.
        </div>
      )}

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
          disabled={hasValidationError}
          style={{
            ...primaryBtn, flex: "2 1 200px",
            opacity: hasValidationError ? 0.5 : 1,
            cursor: hasValidationError ? "not-allowed" : "pointer",
          }}
        >
          {hasAnyValue ? "Salva e continua →" : "Salta →"}
        </button>
      </div>
    </div>
  );
}
