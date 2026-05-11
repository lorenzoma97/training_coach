// Wave 3.4 — Mobility routine library UI.
// Owner: frontend-specialist.
//
// Componente standalone library navigabile delle 6 routine pre-strutturate
// definite in `src/lib/catalog/mobilityRoutines.ts` (FIFA 11+, Movement Prep,
// Dynamic Flow Runner, Foam Rolling, Yoga Recovery 20', Calf+Achilles).
//
// Funzionalità principali:
//  1. Lista routine con badge purpose, duration, sport, citation (se presente).
//  2. Filtri rapidi via chips (Tutti / Warmup / Cooldown / Recovery / Prevenzione).
//  3. Accordion expand → step-by-step renderizzato; ogni step ha toggle "✓ Fatto"
//     (tracker in-memory, NON persistito — è uno stato di sessione).
//  4. Header card con CTA "Inizia routine" → apre `MobilityRoutineGuide`
//     in modalità full-screen guidata.
//
// Mobile-first 390x844. Touch target ≥44px su ogni interactive element.
// A11y: aria-expanded sull'accordion, aria-label espliciti su tutti i bottoni,
// progress chip "Step X di N".
//
// Test runner: vitest in Node (no jsdom) — testa pure helpers + smoke import.

import { useMemo, useState } from "react";
import { MOBILITY_ROUTINES } from "../../lib/catalog/mobilityRoutines";
import type { MobilityRoutine } from "../../lib/types/mobility";
import { colors, fontSize, fonts, radius, space, touch } from "../../lib/designTokens";
import MobilityRoutineGuide from "./MobilityRoutineGuide";

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS (testabili senza React)
// ─────────────────────────────────────────────────────────────────────────────

export type PurposeFilter = "all" | MobilityRoutine["purpose"];

/**
 * Filtra le routine per scopo. "all" ritorna l'array intero.
 * Non muta l'input (filter ritorna nuovo array).
 */
export function filterRoutinesByPurpose(
  routines: MobilityRoutine[],
  filter: PurposeFilter,
): MobilityRoutine[] {
  if (filter === "all") return routines.slice();
  return routines.filter(r => r.purpose === filter);
}

/**
 * Costruisce la label user-facing per uno step (durata sec o reps).
 * Se entrambi presenti (caso anomalo), preferisce duration_sec (più informativo).
 * Se nessuno → "—".
 */
export function formatStepMetric(step: { duration_sec?: number; reps?: number }): string {
  if (step.duration_sec != null) {
    if (step.duration_sec >= 60 && step.duration_sec % 60 === 0) {
      const m = step.duration_sec / 60;
      return `${m} min`;
    }
    return `${step.duration_sec}s`;
  }
  if (step.reps != null) {
    return `${step.reps} rip${step.reps > 1 ? "" : ""}`;
  }
  return "—";
}

const PURPOSE_LABELS: Record<MobilityRoutine["purpose"], string> = {
  warmup: "Warm-up",
  cooldown: "Cool-down",
  recovery: "Recovery",
  injury_prevention: "Prevenzione",
};

const PURPOSE_COLORS: Record<MobilityRoutine["purpose"], { fg: string; bg: string; border: string }> = {
  warmup: { fg: "#F97316", bg: "#F9731622", border: "#F9731666" },
  cooldown: { fg: "#0891B2", bg: "#0891B222", border: "#0891B266" },
  recovery: { fg: "#22C55E", bg: "#22C55E22", border: "#22C55E66" },
  injury_prevention: { fg: "#A78BFA", bg: "#A78BFA22", border: "#A78BFA66" },
};

const FILTER_OPTIONS: Array<{ id: PurposeFilter; label: string }> = [
  { id: "all", label: "Tutti" },
  { id: "warmup", label: "Warm-up" },
  { id: "cooldown", label: "Cool-down" },
  { id: "recovery", label: "Recovery" },
  { id: "injury_prevention", label: "Prevenzione" },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function MobilityLibrary() {
  const [filter, setFilter] = useState<PurposeFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Tracker in-memory: routineId → Set<stepIndex> completati.
  // Volutamente NON persisted (richiesta task: stato sessione).
  const [doneByRoutine, setDoneByRoutine] = useState<Record<string, Set<number>>>({});
  // Routine attualmente in modalità guidata full-screen (null = lista visibile).
  const [guideRoutineId, setGuideRoutineId] = useState<string | null>(null);

  const visible = useMemo(() => filterRoutinesByPurpose(MOBILITY_ROUTINES, filter), [filter]);
  const guideRoutine = useMemo(
    () => guideRoutineId ? MOBILITY_ROUTINES.find(r => r.id === guideRoutineId) ?? null : null,
    [guideRoutineId],
  );

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const toggleStepDone = (routineId: string, stepIdx: number) => {
    setDoneByRoutine(prev => {
      const cur = prev[routineId] ?? new Set<number>();
      const next = new Set(cur);
      if (next.has(stepIdx)) next.delete(stepIdx);
      else next.add(stepIdx);
      return { ...prev, [routineId]: next };
    });
  };

  const startGuide = (id: string) => {
    setGuideRoutineId(id);
  };

  const closeGuide = () => {
    setGuideRoutineId(null);
  };

  // Modalità guidata full-screen → render solo la guida (overlay totale).
  if (guideRoutine) {
    return <MobilityRoutineGuide routine={guideRoutine} onExit={closeGuide} />;
  }

  return (
    <div data-testid="mobility-library" style={{ display: "flex", flexDirection: "column", gap: space.xl }}>
      {/* Header */}
      <div>
        <div style={{
          fontSize: fontSize.xs, fontWeight: 700, letterSpacing: "0.15em",
          color: colors.accent, textTransform: "uppercase",
          fontFamily: fonts.mono, marginBottom: space.sm,
        }}>
          Mobility & Recovery
        </div>
        <div style={{ fontSize: fontSize.base, color: colors.textMuted, lineHeight: 1.5 }}>
          {MOBILITY_ROUTINES.length} routine pre-strutturate basate su evidenza
          scientifica. Espandi per vedere step-by-step o avvia la modalità guidata.
        </div>
      </div>

      {/* Filtri rapidi */}
      <div
        role="tablist"
        aria-label="Filtra routine per scopo"
        style={{
          display: "flex", flexWrap: "wrap", gap: space.md,
        }}
      >
        {FILTER_OPTIONS.map(opt => {
          const active = filter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`Filtra: ${opt.label}`}
              onClick={() => setFilter(opt.id)}
              data-testid={`filter-chip-${opt.id}`}
              style={{
                minHeight: touch.min,
                padding: `${space.lg} ${space.xxxl}`,
                background: active
                  ? `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`
                  : colors.bgElevated,
                border: active ? "none" : `1px solid ${colors.border}`,
                borderRadius: radius.pill,
                color: active ? colors.textPrimary : colors.textSecondary,
                fontSize: fontSize.base,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Lista routine */}
      {visible.length === 0 ? (
        <div
          data-testid="mobility-empty-state"
          style={{
            padding: space.huge, background: colors.bgElevated,
            border: `1px dashed ${colors.borderStrong}`,
            borderRadius: radius.xl, textAlign: "center",
            color: colors.textMuted, fontSize: fontSize.base, lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: space.md }} aria-hidden>🧘</div>
          <div>Nessuna routine per questo filtro.</div>
        </div>
      ) : (
        <ul
          data-testid="mobility-routines-list"
          aria-label="Elenco routine mobility"
          style={{
            listStyle: "none", padding: 0, margin: 0,
            display: "flex", flexDirection: "column", gap: space.xl,
          }}
        >
          {visible.map(routine => {
            const isExpanded = expandedId === routine.id;
            const purposeColors = PURPOSE_COLORS[routine.purpose];
            const doneSet = doneByRoutine[routine.id] ?? new Set<number>();
            const totalSteps = routine.steps.length;
            const doneCount = doneSet.size;

            return (
              <li
                key={routine.id}
                data-testid={`routine-card-${routine.id}`}
                style={{
                  background: colors.bgRaised,
                  border: `1px solid ${colors.border}`,
                  borderLeft: `4px solid ${purposeColors.border}`,
                  borderRadius: radius.xxl,
                  overflow: "hidden",
                }}
              >
                {/* Header collassato (sempre visibile) */}
                <button
                  type="button"
                  onClick={() => toggleExpand(routine.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`routine-details-${routine.id}`}
                  aria-label={`${isExpanded ? "Chiudi" : "Espandi"} routine ${routine.name}`}
                  data-testid={`routine-toggle-${routine.id}`}
                  style={{
                    width: "100%", textAlign: "left",
                    padding: space.xxxl, minHeight: touch.min,
                    background: "transparent", border: "none", cursor: "pointer",
                    color: colors.textPrimary,
                    display: "flex", flexDirection: "column", gap: space.md,
                  }}
                >
                  {/* Riga badge top */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: space.md, alignItems: "center" }}>
                    <span
                      style={{
                        display: "inline-flex", alignItems: "center",
                        padding: `${space.xs} ${space.lg}`,
                        background: purposeColors.bg,
                        color: purposeColors.fg,
                        border: `1px solid ${purposeColors.border}`,
                        borderRadius: radius.sm,
                        fontSize: fontSize.xs,
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      {PURPOSE_LABELS[routine.purpose]}
                    </span>
                    <span style={{
                      fontSize: fontSize.sm, color: colors.textMuted,
                      fontFamily: fonts.mono,
                    }}>
                      {routine.duration_min} min · {totalSteps} step
                    </span>
                    {routine.sport && (
                      <span style={{
                        padding: `${space.xs} ${space.md}`,
                        background: colors.bgElevated,
                        border: `1px solid ${colors.border}`,
                        borderRadius: radius.sm,
                        fontSize: fontSize.xs,
                        color: colors.textSecondary,
                        fontWeight: 600,
                      }}>
                        {routine.sport}
                      </span>
                    )}
                    <span aria-hidden style={{
                      marginLeft: "auto",
                      fontSize: fontSize.xl,
                      color: colors.textMuted,
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.15s ease",
                    }}>
                      ▾
                    </span>
                  </div>

                  {/* Nome routine */}
                  <div style={{
                    fontSize: fontSize.xl, fontWeight: 700,
                    color: colors.textPrimary, lineHeight: 1.3,
                  }}>
                    {routine.name}
                  </div>

                  {/* Citation (se presente) */}
                  {routine.citation && (
                    <div style={{
                      fontSize: fontSize.xs, color: colors.textDim,
                      fontStyle: "italic", lineHeight: 1.4,
                    }}>
                      📖 {routine.citation.length > 120
                        ? routine.citation.slice(0, 117) + "…"
                        : routine.citation}
                    </div>
                  )}

                  {/* Progress badge se ci sono step completati */}
                  {doneCount > 0 && (
                    <div
                      aria-label={`${doneCount} step completati su ${totalSteps}`}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: space.xs,
                        padding: `${space.xs} ${space.lg}`,
                        background: colors.successFaint,
                        border: `1px solid ${colors.successSoft}`,
                        borderRadius: radius.sm,
                        color: colors.success,
                        fontSize: fontSize.xs,
                        fontWeight: 700,
                        alignSelf: "flex-start",
                      }}
                    >
                      ✓ {doneCount}/{totalSteps} fatti
                    </div>
                  )}
                </button>

                {/* Body espanso */}
                {isExpanded && (
                  <div
                    id={`routine-details-${routine.id}`}
                    role="region"
                    aria-label={`Dettagli routine ${routine.name}`}
                    style={{
                      padding: `0 ${space.xxxl} ${space.xxxl}`,
                      borderTop: `1px solid ${colors.border}`,
                      paddingTop: space.xxxl,
                      display: "flex", flexDirection: "column", gap: space.xl,
                    }}
                  >
                    {/* CTA "Inizia routine" */}
                    <button
                      type="button"
                      onClick={() => startGuide(routine.id)}
                      aria-label={`Inizia routine guidata: ${routine.name}`}
                      data-testid={`start-guide-${routine.id}`}
                      style={{
                        width: "100%", minHeight: touch.min,
                        padding: `${space.xl} ${space.xxxl}`,
                        background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`,
                        border: "none", borderRadius: radius.lg,
                        color: colors.textPrimary,
                        fontSize: fontSize.md, fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      ▶ Inizia routine guidata
                    </button>

                    {/* Citation completa (se presente) */}
                    {routine.citation && (
                      <div style={{
                        padding: space.xl,
                        background: colors.bgElevated,
                        borderRadius: radius.lg,
                        fontSize: fontSize.sm,
                        color: colors.textSecondary,
                        lineHeight: 1.5,
                        fontStyle: "italic",
                      }}>
                        <span style={{ color: colors.accent, fontWeight: 700, fontStyle: "normal" }}>📖 Evidenza scientifica:</span>{" "}
                        {routine.citation}
                      </div>
                    )}

                    {/* Lista step */}
                    <ol
                      data-testid={`steps-list-${routine.id}`}
                      style={{
                        listStyle: "none", padding: 0, margin: 0,
                        display: "flex", flexDirection: "column", gap: space.lg,
                        counterReset: "stepCounter",
                      }}
                    >
                      {routine.steps.map((step, idx) => {
                        const done = doneSet.has(idx);
                        return (
                          <li
                            key={idx}
                            data-testid={`step-${routine.id}-${idx}`}
                            style={{
                              padding: space.xl,
                              background: done ? colors.successFaint : colors.bgElevated,
                              border: `1px solid ${done ? colors.successSoft : colors.border}`,
                              borderRadius: radius.lg,
                              display: "flex", flexDirection: "column", gap: space.md,
                              opacity: done ? 0.85 : 1,
                              transition: "background 0.15s, opacity 0.15s",
                            }}
                          >
                            <div style={{
                              display: "flex", justifyContent: "space-between",
                              alignItems: "flex-start", gap: space.md,
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  display: "flex", alignItems: "center", gap: space.md,
                                  marginBottom: space.xs,
                                }}>
                                  <span
                                    aria-label={`Step ${idx + 1} di ${totalSteps}`}
                                    style={{
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      minWidth: "28px", height: "28px",
                                      borderRadius: radius.pill,
                                      background: done ? colors.success : colors.accent,
                                      color: colors.textPrimary,
                                      fontSize: fontSize.xs,
                                      fontWeight: 800,
                                      fontFamily: fonts.mono,
                                      padding: `0 ${space.md}`,
                                    }}
                                  >
                                    {idx + 1}
                                  </span>
                                  <span style={{
                                    fontSize: fontSize.sm,
                                    color: colors.textMuted,
                                    fontFamily: fonts.mono,
                                    fontWeight: 700,
                                  }}>
                                    {formatStepMetric(step)}
                                  </span>
                                </div>
                                <div style={{
                                  fontSize: fontSize.md, fontWeight: 700,
                                  color: done ? colors.textSecondary : colors.textPrimary,
                                  textDecoration: done ? "line-through" : "none",
                                  lineHeight: 1.3,
                                }}>
                                  {step.name}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleStepDone(routine.id, idx)}
                                aria-pressed={done}
                                aria-label={`${done ? "Annulla completamento" : "Segna come fatto"} step ${idx + 1}: ${step.name}`}
                                data-testid={`step-toggle-${routine.id}-${idx}`}
                                style={{
                                  flexShrink: 0,
                                  minWidth: touch.min, minHeight: touch.min,
                                  padding: `${space.md} ${space.xl}`,
                                  background: done ? colors.success : "transparent",
                                  border: `1px solid ${done ? colors.success : colors.borderStrong}`,
                                  borderRadius: radius.lg,
                                  color: done ? colors.textPrimary : colors.textSecondary,
                                  fontSize: fontSize.sm,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                {done ? "✓ Fatto" : "○ Fatto?"}
                              </button>
                            </div>
                            {/* Cue tecnico */}
                            <div style={{
                              fontSize: fontSize.sm,
                              color: colors.textSecondary,
                              lineHeight: 1.5,
                              paddingLeft: "40px",
                            }}>
                              {step.cue}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
