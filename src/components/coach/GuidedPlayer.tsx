// Guided Player full-screen — Step D feature "Allenamento guidato"
// (2026-05-20). Pattern Lorenzo: warmup → preflight → esercizi (con
// guidance + timer rest + bip countdown) → cooldown → diario.
//
// State machine:
//   warmup-intro → warmup-run → preflight → exercise → rest → ...
//   → cooldown-intro → cooldown-run → done
//
// Steps E (pre-flight editor) e F (recovery banner) sono feature successive.

import { useEffect, useRef, useState } from "react";
import type { PlannedSession, PlannedExercise } from "../../lib/types";
import type { ExercisePerformance, ExerciseSet } from "../../lib/types/strength";
import type { MobilityRoutine } from "../../lib/types/mobility";
import { EXERCISES_BY_ID } from "../../lib/catalog/exercises";
import { ROUTINES_BY_ID, MOBILITY_ROUTINES } from "../../lib/catalog/mobilityRoutines";
import { primeAudio, playCountdownBeep, playCompletionBeep } from "../../lib/audio";

type Stage =
  | "warmup-intro" | "warmup-run"
  | "preflight"
  | "exercise" | "rest"
  | "cooldown-intro" | "cooldown-run"
  | "done";

interface GuidedPlayerProps {
  session: PlannedSession;
  onClose: () => void;
  onComplete: (performances: ExercisePerformance[]) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function pickWarmupForSession(session: PlannedSession): MobilityRoutine | null {
  if (session.warmupRoutineId) {
    const r = ROUTINES_BY_ID[session.warmupRoutineId];
    if (r) return r;
  }
  const candidates = MOBILITY_ROUTINES.filter(r => r.purpose === "warmup");
  if (session.type === "corsa") {
    const runner = candidates.find(r => r.sport === "corsa");
    if (runner) return runner;
  }
  return candidates.find(r => !r.sport) ?? candidates[0] ?? null;
}

function pickCooldownForSession(session: PlannedSession): MobilityRoutine | null {
  const candidates = MOBILITY_ROUTINES.filter(r => r.purpose === "cooldown");
  if (session.type === "corsa") {
    const post = candidates.find(r => r.id === "cooldown-post-corsa");
    if (post) return post;
  }
  if (session.type === "forza_gambe") {
    const post = candidates.find(r => r.id === "cooldown-post-forza-lower");
    if (post) return post;
  }
  if (session.type === "forza_upper") {
    const post = candidates.find(r => r.id === "cooldown-post-forza-upper");
    if (post) return post;
  }
  return candidates.find(r => r.id === "cooldown-generale-breve") ?? candidates[0] ?? null;
}

// ─── Styles (mobile-first dark theme) ─────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 50,
  background: "#0B0F1A",
  display: "flex", flexDirection: "column",
  overflow: "auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "12px 16px",
  background: "#16213E",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const mainStyle: React.CSSProperties = {
  flex: 1, padding: "20px 16px",
  display: "flex", flexDirection: "column", gap: "16px",
};

const ctaStyle: React.CSSProperties = {
  padding: "14px 20px",
  background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
  border: "none", borderRadius: "12px",
  color: "#FFF", fontSize: "15px", fontWeight: 800, cursor: "pointer",
  minHeight: "52px",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.16)", borderRadius: "10px",
  color: "#94A3B8", fontSize: "13px", fontWeight: 600, cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  background: "#16213E",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px", padding: "16px",
};

// ─── Main component ───────────────────────────────────────────────────────

export default function GuidedPlayer({ session, onClose, onComplete }: GuidedPlayerProps) {
  const exercises: PlannedExercise[] = session.exercises ?? [];
  const warmupRoutine = pickWarmupForSession(session);
  const cooldownRoutine = pickCooldownForSession(session);

  const [stage, setStage] = useState<Stage>(warmupRoutine ? "warmup-intro" : "preflight");
  const [exerciseIdx, setExerciseIdx] = useState(0);
  const [setIdx, setSetIdx] = useState(0);
  const [completed, setCompleted] = useState<ExercisePerformance[]>(() =>
    exercises.map(ex => ({ exerciseId: ex.effectiveExerciseId ?? ex.exerciseId, sets: [] })),
  );
  const [currentReps, setCurrentReps] = useState<string>("");
  const [currentWeight, setCurrentWeight] = useState<string>("");
  const [restSec, setRestSec] = useState<number>(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Warmup/cooldown step tracking
  const [routineStepIdx, setRoutineStepIdx] = useState(0);

  const currentExercise = exercises[exerciseIdx];
  const currentCatEx = currentExercise ? EXERCISES_BY_ID[currentExercise.effectiveExerciseId ?? currentExercise.exerciseId] : null;
  const nextExercise = exercises[exerciseIdx + 1];
  const nextCatEx = nextExercise ? EXERCISES_BY_ID[nextExercise.effectiveExerciseId ?? nextExercise.exerciseId] : null;
  const isLastSetOfExercise = currentExercise ? setIdx >= currentExercise.plannedSets - 1 : false;
  const isLastExercise = exerciseIdx >= exercises.length - 1;

  // Pre-load reps/weight defaults from plannedExercise when entering exercise stage
  useEffect(() => {
    if (stage !== "exercise" || !currentExercise) return;
    const targetReps = currentExercise.repsTarget.min === currentExercise.repsTarget.max
      ? `${currentExercise.repsTarget.min}`
      : `${Math.round((currentExercise.repsTarget.min + currentExercise.repsTarget.max) / 2)}`;
    setCurrentReps(targetReps);
    setCurrentWeight(currentExercise.weight_kg ? `${currentExercise.weight_kg}` : "");
  }, [stage, exerciseIdx, setIdx, currentExercise]);

  // Rest timer + bip countdown
  useEffect(() => {
    if (stage !== "rest" || restSec <= 0) return;
    const id = setInterval(() => {
      setRestSec(prev => {
        const next = prev - 1;
        if (next >= 0 && next <= 5) playCountdownBeep(next);
        if (next <= 0) {
          // Auto-advance
          handleRestComplete();
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  function handleStartWarmup() {
    primeAudio();
    setStage("warmup-run");
    setRoutineStepIdx(0);
  }

  function handleSkipWarmup() {
    primeAudio();
    setStage("preflight");
  }

  function handleNextWarmupStep() {
    if (!warmupRoutine) return;
    if (routineStepIdx < warmupRoutine.steps.length - 1) {
      setRoutineStepIdx(routineStepIdx + 1);
    } else {
      playCompletionBeep();
      setStage("preflight");
    }
  }

  function handleStartWorkout() {
    primeAudio();
    setStage("exercise");
    setExerciseIdx(0);
    setSetIdx(0);
  }

  function handleSetCompleted() {
    if (!currentExercise) return;
    const repsNum = parseInt(currentReps, 10);
    const weightNum = parseFloat(currentWeight);
    const set: ExerciseSet = {
      reps: Number.isFinite(repsNum) && repsNum > 0 ? repsNum : 0,
    };
    if (Number.isFinite(weightNum) && weightNum > 0) set.weight_kg = weightNum;
    // Save into completed[exerciseIdx].sets[setIdx]
    setCompleted(prev => {
      const next = [...prev];
      next[exerciseIdx] = {
        ...next[exerciseIdx],
        sets: [...next[exerciseIdx].sets, set],
      };
      return next;
    });
    // Decide next stage: rest tra set (se non ultimo) o avanza esercizio
    if (!isLastSetOfExercise) {
      setRestSec(currentExercise.rest_sec ?? 120);
      setStage("rest");
    } else if (!isLastExercise) {
      // Ultimo set di questo esercizio → rest + anteprima prossimo
      setRestSec(currentExercise.rest_sec ?? 120);
      setStage("rest");
    } else {
      // Ultimo set ultimo esercizio
      playCompletionBeep();
      if (cooldownRoutine) {
        setStage("cooldown-intro");
      } else {
        finishSession();
      }
    }
  }

  function handleRestComplete() {
    if (!currentExercise) return;
    if (!isLastSetOfExercise) {
      setSetIdx(prev => prev + 1);
      setStage("exercise");
    } else if (!isLastExercise) {
      setExerciseIdx(prev => prev + 1);
      setSetIdx(0);
      setStage("exercise");
    } else {
      // Edge: rest finito ma era già ultimo (non dovrebbe accadere se logica corretta)
      if (cooldownRoutine) setStage("cooldown-intro");
      else finishSession();
    }
  }

  function handleSkipRest() {
    setRestSec(0);
    handleRestComplete();
  }

  function handleStartCooldown() {
    primeAudio();
    setStage("cooldown-run");
    setRoutineStepIdx(0);
  }

  function handleSkipCooldown() {
    finishSession();
  }

  function handleNextCooldownStep() {
    if (!cooldownRoutine) return;
    if (routineStepIdx < cooldownRoutine.steps.length - 1) {
      setRoutineStepIdx(routineStepIdx + 1);
    } else {
      finishSession();
    }
  }

  function finishSession() {
    playCompletionBeep();
    setStage("done");
    // Filter perf con almeno 1 set eseguito (utente potrebbe aver skippato qualche esercizio)
    const validPerformances = completed.filter(p => p.sets.length > 0);
    onComplete(validPerformances);
  }

  function handleExitConfirm(action: "discard" | "save") {
    setShowExitConfirm(false);
    if (action === "discard") {
      onClose();
    } else {
      const validPerformances = completed.filter(p => p.sets.length > 0);
      onComplete(validPerformances);
    }
  }

  // ─── RENDER ─────────────────────────────────────────────────────────────

  return (
    <div style={overlayStyle}>
      <div style={headerStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Allenamento guidato
          </div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0" }}>
            {session.type}{session.subtype ? ` · ${session.subtype}` : ""}
          </div>
        </div>
        <button onClick={() => setShowExitConfirm(true)} style={{
          ...secondaryBtnStyle, padding: "6px 12px", fontSize: "12px",
        }}>✕ Esci</button>
      </div>

      <div style={mainStyle}>
        {/* WARMUP INTRO */}
        {stage === "warmup-intro" && warmupRoutine && (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#E2E8F0", marginBottom: "8px" }}>
                🔥 Warm-up: {warmupRoutine.name}
              </div>
              <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "12px" }}>
                Durata: ~{warmupRoutine.duration_min} min · {warmupRoutine.steps.length} step
              </div>
              {warmupRoutine.citation && (
                <div style={{ fontSize: "11px", color: "#64748B", fontStyle: "italic", lineHeight: 1.4 }}>
                  📚 {warmupRoutine.citation}
                </div>
              )}
            </div>
            <button onClick={handleStartWarmup} style={ctaStyle}>▶ Inizia warm-up</button>
            <button onClick={handleSkipWarmup} style={secondaryBtnStyle}>⏭ Salta warm-up</button>
          </>
        )}

        {/* WARMUP RUN */}
        {stage === "warmup-run" && warmupRoutine && (
          <WarmupCooldownStep
            routine={warmupRoutine}
            stepIdx={routineStepIdx}
            onNext={handleNextWarmupStep}
            onComplete={() => setStage("preflight")}
            mode="warmup"
          />
        )}

        {/* PREFLIGHT */}
        {stage === "preflight" && (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#22C55E", marginBottom: "10px" }}>
                ✓ Warm-up completato
              </div>
              <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "14px" }}>
                Pronto per l'allenamento. {exercises.length} esercizi pianificati.
              </div>
              <ol style={{ margin: 0, padding: "0 0 0 18px", fontSize: "13px", color: "#CBD5E1", lineHeight: 1.6 }}>
                {exercises.map((ex, i) => {
                  const catEx = EXERCISES_BY_ID[ex.effectiveExerciseId ?? ex.exerciseId];
                  const repsStr = ex.repsTarget.min === ex.repsTarget.max
                    ? `${ex.repsTarget.min}`
                    : `${ex.repsTarget.min}-${ex.repsTarget.max}`;
                  return (
                    <li key={i}>{catEx?.name ?? ex.exerciseId} — {ex.plannedSets}×{repsStr}</li>
                  );
                })}
              </ol>
            </div>
            <button onClick={handleStartWorkout} style={ctaStyle}>▶ Inizia allenamento</button>
          </>
        )}

        {/* EXERCISE */}
        {stage === "exercise" && currentExercise && currentCatEx && (
          <ExerciseStep
            exerciseIdx={exerciseIdx}
            totalExercises={exercises.length}
            setIdx={setIdx}
            plannedSets={currentExercise.plannedSets}
            exercise={currentExercise}
            catEx={currentCatEx}
            currentReps={currentReps}
            currentWeight={currentWeight}
            onChangeReps={setCurrentReps}
            onChangeWeight={setCurrentWeight}
            onSetCompleted={handleSetCompleted}
          />
        )}

        {/* REST */}
        {stage === "rest" && currentExercise && (
          <RestStep
            secLeft={restSec}
            isLastSet={isLastSetOfExercise}
            nextSetIdx={setIdx + 1}
            currentExerciseName={currentCatEx?.name ?? currentExercise.exerciseId}
            nextExercise={nextExercise}
            nextCatEx={nextCatEx}
            onSkip={handleSkipRest}
          />
        )}

        {/* COOLDOWN INTRO */}
        {stage === "cooldown-intro" && cooldownRoutine && (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#22C55E", marginBottom: "10px" }}>
                ✓ Allenamento completato
              </div>
              <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5 }}>
                Ottimo lavoro. Suggerito cool-down: <b>{cooldownRoutine.name}</b> (~{cooldownRoutine.duration_min} min) per facilitare il recupero.
              </div>
            </div>
            <button onClick={handleStartCooldown} style={ctaStyle}>▶ Inizia cool-down</button>
            <button onClick={handleSkipCooldown} style={secondaryBtnStyle}>Salta e chiudi</button>
          </>
        )}

        {/* COOLDOWN RUN */}
        {stage === "cooldown-run" && cooldownRoutine && (
          <WarmupCooldownStep
            routine={cooldownRoutine}
            stepIdx={routineStepIdx}
            onNext={handleNextCooldownStep}
            onComplete={finishSession}
            mode="cooldown"
          />
        )}

        {/* DONE */}
        {stage === "done" && (
          <div style={{ ...cardStyle, textAlign: "center", padding: "32px 16px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎉</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#22C55E", marginBottom: "8px" }}>
              Sessione completata!
            </div>
            <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5 }}>
              I dati sono stati salvati nel diario.
            </div>
          </div>
        )}
      </div>

      {/* Exit confirm modal */}
      {showExitConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60,
          background: "rgba(11,15,26,0.85)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
        }}>
          <div style={{ ...cardStyle, maxWidth: "320px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#E2E8F0", marginBottom: "8px" }}>
              Esci dall'allenamento?
            </div>
            <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "16px", lineHeight: 1.5 }}>
              Hai completato {completed.reduce((a, p) => a + p.sets.length, 0)} set finora.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={() => handleExitConfirm("save")} style={ctaStyle}>
                💾 Salva progresso e chiudi
              </button>
              <button onClick={() => handleExitConfirm("discard")} style={{
                ...secondaryBtnStyle, color: "#EF4444", borderColor: "#EF444466",
              }}>
                🗑 Scarta e chiudi
              </button>
              <button onClick={() => setShowExitConfirm(false)} style={secondaryBtnStyle}>
                ↩ Continua allenamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function WarmupCooldownStep({
  routine, stepIdx, onNext, mode,
}: {
  routine: MobilityRoutine;
  stepIdx: number;
  onNext: () => void;
  onComplete: () => void;
  mode: "warmup" | "cooldown";
}) {
  const step = routine.steps[stepIdx];
  const isLast = stepIdx >= routine.steps.length - 1;
  if (!step) return null;
  return (
    <>
      <div style={cardStyle}>
        <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
          {mode === "warmup" ? "🔥 Warm-up" : "❄ Cool-down"} · Step {stepIdx + 1}/{routine.steps.length}
        </div>
        <div style={{ fontSize: "18px", fontWeight: 800, color: "#E2E8F0", marginBottom: "10px" }}>
          {step.name}
        </div>
        <div style={{ display: "flex", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
          {step.duration_sec && (
            <span style={{ fontSize: "12px", color: "#0891B2", fontFamily: "'JetBrains Mono', monospace" }}>
              ⏱ {step.duration_sec}s
            </span>
          )}
          {step.reps && (
            <span style={{ fontSize: "12px", color: "#E8553A", fontFamily: "'JetBrains Mono', monospace" }}>
              × {step.reps} reps
            </span>
          )}
        </div>
        {step.cue && (
          <div style={{ fontSize: "13px", color: "#CBD5E1", lineHeight: 1.5 }}>{step.cue}</div>
        )}
      </div>
      <button onClick={onNext} style={ctaStyle}>
        {isLast ? "✓ Completa" : "Prossimo step →"}
      </button>
    </>
  );
}

function ExerciseStep({
  exerciseIdx, totalExercises, setIdx, plannedSets,
  exercise, catEx, currentReps, currentWeight,
  onChangeReps, onChangeWeight, onSetCompleted,
}: {
  exerciseIdx: number; totalExercises: number;
  setIdx: number; plannedSets: number;
  exercise: PlannedExercise;
  catEx: NonNullable<ReturnType<typeof EXERCISES_BY_ID["x"]>>;
  currentReps: string; currentWeight: string;
  onChangeReps: (v: string) => void; onChangeWeight: (v: string) => void;
  onSetCompleted: () => void;
}) {
  const repsTarget = exercise.repsTarget.min === exercise.repsTarget.max
    ? `${exercise.repsTarget.min}`
    : `${exercise.repsTarget.min}-${exercise.repsTarget.max}`;
  const loadHint = exercise.weight_kg ? `${exercise.weight_kg}kg`
    : exercise.pct1RM ? `${exercise.pct1RM}% 1RM`
    : exercise.rpe_target ? `RPE ${exercise.rpe_target}`
    : exercise.rir_target !== undefined ? `RIR ${exercise.rir_target}`
    : "";
  const guidance = catEx.guidance ?? [];
  return (
    <>
      <div style={cardStyle}>
        <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
          Esercizio {exerciseIdx + 1}/{totalExercises} · Set {setIdx + 1}/{plannedSets}
        </div>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#E2E8F0", marginBottom: "6px" }}>
          {catEx.name}
        </div>
        <div style={{ fontSize: "13px", color: "#0891B2", fontFamily: "'JetBrains Mono', monospace", marginBottom: "12px" }}>
          Target: {repsTarget} reps{loadHint ? ` @ ${loadHint}` : ""} · recupero {exercise.rest_sec}s
        </div>
        {guidance.length > 0 && (
          <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5, display: "flex", flexDirection: "column", gap: "4px" }}>
            {guidance.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "10px" }}>Registra il set:</div>
        <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 120px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "#64748B" }}>Reps fatte</span>
            <input
              type="number" inputMode="numeric" min={0} max={200}
              value={currentReps}
              onChange={e => onChangeReps(e.target.value)}
              style={{
                padding: "12px 10px",
                background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "10px", color: "#E2E8F0", fontSize: "16px",
                fontFamily: "'JetBrains Mono', monospace", textAlign: "center",
              }}
            />
          </label>
          <label style={{ flex: "1 1 120px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "#64748B" }}>Peso (kg)</span>
            <input
              type="number" inputMode="decimal" min={0} max={500} step={0.5}
              value={currentWeight}
              onChange={e => onChangeWeight(e.target.value)}
              style={{
                padding: "12px 10px",
                background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "10px", color: "#E2E8F0", fontSize: "16px",
                fontFamily: "'JetBrains Mono', monospace", textAlign: "center",
              }}
            />
          </label>
        </div>
        <button onClick={onSetCompleted} style={ctaStyle}>
          ✓ Set {setIdx + 1} completato
        </button>
      </div>
    </>
  );
}

function RestStep({
  secLeft, isLastSet, nextSetIdx, currentExerciseName, nextExercise, nextCatEx, onSkip,
}: {
  secLeft: number;
  isLastSet: boolean;
  nextSetIdx: number;
  currentExerciseName: string;
  nextExercise: PlannedExercise | undefined;
  nextCatEx: ReturnType<typeof EXERCISES_BY_ID["x"]> | null;
  onSkip: () => void;
}) {
  const mm = Math.floor(secLeft / 60);
  const ss = secLeft % 60;
  return (
    <>
      <div style={{ ...cardStyle, textAlign: "center", padding: "32px 16px" }}>
        <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
          ⏱ Recupero
        </div>
        <div style={{
          fontSize: "64px", fontWeight: 800, color: secLeft <= 5 ? "#E8553A" : "#0891B2",
          fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.0, marginBottom: "10px",
        }}>
          {mm}:{ss.toString().padStart(2, "0")}
        </div>
        <div style={{ fontSize: "12px", color: "#94A3B8" }}>
          {secLeft <= 5 && secLeft > 0 && "Preparati…"}
        </div>
      </div>

      {!isLastSet && (
        <div style={cardStyle}>
          <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
            Prossimo
          </div>
          <div style={{ fontSize: "14px", color: "#E2E8F0", fontWeight: 700 }}>
            {currentExerciseName} · Set {nextSetIdx + 1}
          </div>
        </div>
      )}

      {isLastSet && nextExercise && nextCatEx && (
        <div style={cardStyle}>
          <div style={{ fontSize: "11px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
            Prossimo esercizio
          </div>
          <div style={{ fontSize: "15px", color: "#E2E8F0", fontWeight: 700, marginBottom: "8px" }}>
            {nextCatEx.name}
          </div>
          {nextCatEx.guidance && nextCatEx.guidance.length > 0 && (
            <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.5, display: "flex", flexDirection: "column", gap: "3px" }}>
              {nextCatEx.guidance.slice(0, 2).map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          )}
        </div>
      )}

      <button onClick={onSkip} style={secondaryBtnStyle}>⏭ Salta recupero</button>
    </>
  );
}
