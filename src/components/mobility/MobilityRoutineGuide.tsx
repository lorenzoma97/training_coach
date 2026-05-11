// Wave 3.4 — MobilityRoutineGuide (modalità guidata full-screen).
// Owner: frontend-specialist.
//
// Render full-screen di una singola routine, 1 step alla volta. Usata da
// `MobilityLibrary` quando l'utente clicca "▶ Inizia routine guidata".
//
// Funzionalità:
//  - Progress bar in cima (X di N step)
//  - Bottone "✕ Esci" in alto a destra (esce dalla guida, torna alla lista)
//  - Step corrente in large display al centro
//  - Timer countdown se step.duration_sec presente
//  - Toggle "Auto-avanzamento" (default OFF — l'utente lo accende esplicitamente)
//  - Bottoni "← Indietro" / "Avanti →" (touch ≥44px)
//  - Allo step finale + "Avanti" → schermata "✓ Routine completata!"
//    con bottone "Torna alla lista".
//
// Mobile-first 390x844. A11y: aria-live per timer + step change, aria-label
// espliciti su bottoni navigation, focus management su step change.

import { useEffect, useMemo, useRef, useState } from "react";
import type { MobilityRoutine } from "../../lib/types/mobility";
import { colors, fontSize, fonts, radius, space, touch } from "../../lib/designTokens";
import { formatStepMetric } from "./MobilityLibrary";

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS (testabili senza React)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Avanza di 1 step. Cap superiore = totalSteps (sentinel "completata").
 * idx == totalSteps → schermata completion.
 */
export function nextStepIndex(current: number, totalSteps: number): number {
  if (current >= totalSteps) return totalSteps; // già completed, no-op
  return current + 1;
}

/**
 * Indietro di 1 step. Cap inferiore = 0 (no-op se già a 0).
 */
export function prevStepIndex(current: number): number {
  if (current <= 0) return 0;
  return current - 1;
}

/**
 * Format secondi → "MM:SS" per display countdown.
 */
export function formatCountdown(sec: number): string {
  if (sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface MobilityRoutineGuideProps {
  routine: MobilityRoutine;
  onExit: () => void;
}

export default function MobilityRoutineGuide({ routine, onExit }: MobilityRoutineGuideProps) {
  const totalSteps = routine.steps.length;
  const [stepIdx, setStepIdx] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  // Riferimento al setTimeout/Interval per cleanup garantito
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isCompleted = stepIdx >= totalSteps;
  const currentStep = !isCompleted ? routine.steps[stepIdx] : null;
  const progressPct = useMemo(() => {
    if (totalSteps === 0) return 0;
    return Math.min(100, Math.round((stepIdx / totalSteps) * 100));
  }, [stepIdx, totalSteps]);

  // Reset timer quando cambia step
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (currentStep?.duration_sec != null) {
      setRemainingSec(currentStep.duration_sec);
    } else {
      setRemainingSec(null);
    }
  }, [stepIdx, currentStep]);

  // Tick del countdown se duration_sec presente E auto-advance attivo
  // (oppure visualizzazione passiva senza auto-advance).
  // Decisione: il countdown TICKA SEMPRE se duration_sec presente (utile come
  // riferimento), ma auto-advance fa scattare il next solo se toggle ON.
  useEffect(() => {
    if (remainingSec == null) return;
    if (remainingSec <= 0) {
      if (autoAdvance && !isCompleted) {
        // Auto-advance allo step successivo allo scadere del timer
        setStepIdx(prev => nextStepIndex(prev, totalSteps));
      }
      return;
    }
    timerRef.current = setInterval(() => {
      setRemainingSec(prev => prev != null ? prev - 1 : null);
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [remainingSec, autoAdvance, isCompleted, totalSteps]);

  const handleNext = () => {
    setStepIdx(prev => nextStepIndex(prev, totalSteps));
  };

  const handlePrev = () => {
    setStepIdx(prev => prevStepIndex(prev));
  };

  const handleExit = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onExit();
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="mobility-routine-guide"
      role="dialog"
      aria-modal="true"
      aria-label={`Routine guidata: ${routine.name}`}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        background: colors.bg,
        zIndex: 1000,
        display: "flex", flexDirection: "column",
        // Padding bottom per safe-area iOS + spazio per bottoni nav
        padding: `env(safe-area-inset-top, 0px) 0 calc(${space.huge} + env(safe-area-inset-bottom, 0px)) 0`,
        overflowY: "auto",
      }}
    >
      {/* Top bar: Exit + progress */}
      <div style={{
        display: "flex", alignItems: "center", gap: space.xl,
        padding: `${space.xl} ${space.huge}`,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgRaised,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: fontSize.xs, fontWeight: 700, letterSpacing: "0.12em",
            color: colors.accent, textTransform: "uppercase",
            fontFamily: fonts.mono, marginBottom: "2px",
          }}>
            Mobility · {routine.duration_min} min
          </div>
          <div style={{
            fontSize: fontSize.md, fontWeight: 700,
            color: colors.textPrimary,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {routine.name}
          </div>
        </div>
        <button
          type="button"
          onClick={handleExit}
          aria-label="Esci dalla routine guidata"
          data-testid="exit-guide"
          style={{
            minWidth: touch.min, minHeight: touch.min,
            padding: `${space.md} ${space.xl}`,
            background: colors.bgElevated,
            border: `1px solid ${colors.borderStrong}`,
            borderRadius: radius.lg,
            color: colors.textPrimary,
            fontSize: fontSize.md,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ✕ Esci
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ padding: `${space.xl} ${space.huge} 0` }}>
        <div
          role="progressbar"
          aria-label={isCompleted
            ? "Routine completata"
            : `Step ${stepIdx + 1} di ${totalSteps}`}
          aria-valuenow={isCompleted ? totalSteps : stepIdx + 1}
          aria-valuemin={0}
          aria-valuemax={totalSteps}
          style={{
            width: "100%", height: "8px",
            background: colors.bgElevated,
            borderRadius: radius.pill,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: isCompleted ? "100%" : `${progressPct}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`,
              transition: "width 0.25s ease",
            }}
          />
        </div>
        <div style={{
          marginTop: space.md,
          fontSize: fontSize.sm,
          color: colors.textMuted,
          fontFamily: fonts.mono,
          textAlign: "center",
        }}>
          {isCompleted
            ? `${totalSteps} di ${totalSteps} step`
            : `Step ${stepIdx + 1} di ${totalSteps}`}
        </div>
      </div>

      {/* Body: step corrente o completion screen */}
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "stretch",
        padding: `${space.huge} ${space.huge}`,
        gap: space.huge,
      }}>
        {isCompleted ? (
          <div
            data-testid="completion-screen"
            role="status"
            aria-live="polite"
            style={{
              textAlign: "center",
              display: "flex", flexDirection: "column",
              alignItems: "center", gap: space.huge,
            }}
          >
            <div style={{ fontSize: "72px", lineHeight: 1 }} aria-hidden>✓</div>
            <div style={{
              fontSize: fontSize.huge, fontWeight: 900,
              color: colors.textPrimary,
              letterSpacing: "-0.02em",
            }}>
              Routine completata!
            </div>
            <div style={{
              fontSize: fontSize.base, color: colors.textMuted,
              maxWidth: "320px", lineHeight: 1.5,
            }}>
              Hai completato <b style={{ color: colors.textPrimary }}>{routine.name}</b>.
              Tieni d'occhio le sensazioni nelle prossime ore (dolori muscolari,
              rigidità) e regola la prossima sessione di conseguenza.
            </div>
            <button
              type="button"
              onClick={handleExit}
              aria-label="Torna alla lista delle routine mobility"
              data-testid="back-to-list"
              style={{
                minHeight: touch.min,
                padding: `${space.xl} ${space.big}`,
                background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`,
                border: "none", borderRadius: radius.lg,
                color: colors.textPrimary,
                fontSize: fontSize.md, fontWeight: 700,
                cursor: "pointer",
                marginTop: space.md,
              }}
            >
              Torna alla lista
            </button>
          </div>
        ) : currentStep && (
          <div
            data-testid={`guide-step-${stepIdx}`}
            // aria-live="polite" aggiorna SR ad ogni cambio step
            aria-live="polite"
            style={{
              display: "flex", flexDirection: "column", gap: space.xl,
              alignItems: "center", textAlign: "center",
            }}
          >
            {/* Metric (durata o reps) */}
            <div style={{
              fontSize: fontSize.xs, fontWeight: 700, letterSpacing: "0.15em",
              color: colors.accent, textTransform: "uppercase",
              fontFamily: fonts.mono,
            }}>
              {formatStepMetric(currentStep)}
            </div>

            {/* Nome step */}
            <div style={{
              fontSize: fontSize.display, fontWeight: 900,
              color: colors.textPrimary,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              maxWidth: "560px",
            }}>
              {currentStep.name}
            </div>

            {/* Countdown timer (se duration_sec presente) */}
            {remainingSec != null && (
              <div
                aria-live="off"
                aria-label={`Tempo rimanente: ${formatCountdown(remainingSec)}`}
                style={{
                  fontSize: "56px",
                  fontWeight: 900,
                  color: remainingSec <= 5 ? colors.warning : colors.textPrimary,
                  fontFamily: fonts.mono,
                  letterSpacing: "0.02em",
                  padding: `${space.md} ${space.huge}`,
                  background: colors.bgRaised,
                  border: `1px solid ${remainingSec <= 5 ? colors.warningSoft : colors.border}`,
                  borderRadius: radius.xxl,
                  minWidth: "180px",
                }}
              >
                {formatCountdown(remainingSec)}
              </div>
            )}

            {/* Cue tecnico */}
            <div style={{
              fontSize: fontSize.lg,
              color: colors.textSecondary,
              lineHeight: 1.5,
              maxWidth: "520px",
              padding: `${space.xl} ${space.huge}`,
              background: colors.bgElevated,
              borderRadius: radius.lg,
              border: `1px solid ${colors.border}`,
            }}>
              {currentStep.cue}
            </div>

            {/* Toggle auto-advance (visibile solo se step ha duration_sec) */}
            {currentStep.duration_sec != null && (
              <label
                style={{
                  display: "inline-flex", alignItems: "center", gap: space.md,
                  padding: `${space.md} ${space.xl}`,
                  background: colors.bgElevated,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radius.lg,
                  cursor: "pointer",
                  minHeight: touch.compact,
                }}
              >
                <input
                  type="checkbox"
                  checked={autoAdvance}
                  onChange={e => setAutoAdvance(e.target.checked)}
                  aria-label="Auto-avanzamento allo scadere del timer"
                  data-testid="auto-advance-toggle"
                  style={{
                    width: "20px", height: "20px",
                    accentColor: colors.accent,
                    cursor: "pointer",
                  }}
                />
                <span style={{
                  fontSize: fontSize.sm,
                  color: colors.textSecondary,
                  fontWeight: 600,
                }}>
                  Auto-avanzamento (timer scaduto → next step)
                </span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav: Indietro / Avanti (nascosto in completion screen) */}
      {!isCompleted && (
        <div style={{
          display: "flex", gap: space.xl,
          padding: `${space.xl} ${space.huge}`,
          borderTop: `1px solid ${colors.border}`,
          background: colors.bgRaised,
        }}>
          <button
            type="button"
            onClick={handlePrev}
            disabled={stepIdx === 0}
            aria-label="Step precedente"
            data-testid="nav-prev"
            style={{
              flex: 1, minHeight: touch.min,
              padding: `${space.xl} ${space.xxxl}`,
              background: colors.bgElevated,
              border: `1px solid ${colors.borderStrong}`,
              borderRadius: radius.lg,
              color: stepIdx === 0 ? colors.textDim : colors.textPrimary,
              fontSize: fontSize.md, fontWeight: 700,
              cursor: stepIdx === 0 ? "not-allowed" : "pointer",
              opacity: stepIdx === 0 ? 0.5 : 1,
            }}
          >
            ← Indietro
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label={stepIdx === totalSteps - 1 ? "Completa routine" : "Step successivo"}
            data-testid="nav-next"
            style={{
              flex: 2, minHeight: touch.min,
              padding: `${space.xl} ${space.xxxl}`,
              background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`,
              border: "none", borderRadius: radius.lg,
              color: colors.textPrimary,
              fontSize: fontSize.md, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {stepIdx === totalSteps - 1 ? "✓ Completa" : "Avanti →"}
          </button>
        </div>
      )}
    </div>
  );
}
