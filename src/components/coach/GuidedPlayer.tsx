// Guided Player full-screen — Step D feature "Allenamento guidato"
// (2026-05-20). Pattern Lorenzo: warmup → preflight → esercizi (con
// guidance + timer rest + bip countdown) → cooldown → diario.
//
// State machine:
//   warmup-intro → warmup-run → preflight → exercise → rest → ...
//   → cooldown-intro → cooldown-run → done
//
// Steps E (pre-flight editor) e F (recovery banner) sono feature successive.

import { useEffect, useMemo, useState } from "react";
import { setJSON, getJSON } from "../../lib/storage";
import type { PlannedSession, PlannedExercise } from "../../lib/types";
import type { ExercisePerformance, ExerciseSet } from "../../lib/types/strength";
import type { MobilityRoutine } from "../../lib/types/mobility";
import type { Exercise, EquipmentTag } from "../../lib/types/exercise";
import { EXERCISES, EXERCISES_BY_ID } from "../../lib/catalog/exercises";
import { ROUTINES_BY_ID, MOBILITY_ROUTINES } from "../../lib/catalog/mobilityRoutines";
import { primeAudio, playCountdownBeep, playCompletionBeep } from "../../lib/audio";
import { useModalBackButton } from "../../lib/useModalBackButton";

type Stage =
  | "warmup-intro" | "warmup-run"
  | "preflight"
  | "exercise" | "rest"
  | "cooldown-intro" | "cooldown-run"
  | "done";

// ─── Snapshot storage (Step F: recovery sessione interrotta) ──────────────
// Persistito in localStorage ad ogni evento (set completato, stage change).
// Letto a mount per ripristinare lo stato se l'utente ha chiuso a metà.

const SNAPSHOT_KEY = "guided-session-in-progress";
const SNAPSHOT_TTL_MS = 24 * 3600 * 1000; // 24h: oltre → auto-discarded

export interface GuidedSessionSnapshot {
  sessionDay: string;
  sessionType: string;
  startedAt: string;
  exercises: PlannedExercise[];
  completed: ExercisePerformance[];
  stage: Stage;
  exerciseIdx: number;
  setIdx: number;
  routineStepIdx: number;
}

export async function loadGuidedSessionSnapshot(): Promise<GuidedSessionSnapshot | null> {
  const snap = await getJSON<GuidedSessionSnapshot | null>(SNAPSHOT_KEY, null);
  if (!snap) return null;
  // TTL check: snapshot >24h fa → scarto silently
  const startedTs = new Date(snap.startedAt).getTime();
  if (!Number.isFinite(startedTs) || Date.now() - startedTs > SNAPSHOT_TTL_MS) {
    await setJSON(SNAPSHOT_KEY, null);
    return null;
  }
  return snap;
}

export async function clearGuidedSessionSnapshot(): Promise<void> {
  await setJSON(SNAPSHOT_KEY, null);
}

interface GuidedPlayerProps {
  session: PlannedSession;
  userEquipment?: string[];
  /** Snapshot per ripristinare una sessione interrotta (Step F). */
  resumeFromSnapshot?: GuidedSessionSnapshot | null;
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
  background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
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

export default function GuidedPlayer({ session, userEquipment, resumeFromSnapshot, onClose, onComplete }: GuidedPlayerProps) {
  // Editable scaletta: lo stato iniziale è la scaletta dal SessionDetail; il
  // pre-flight editor (Step E) permette modifica peso/sets/reps + reorder +
  // add/remove prima di avviare l'allenamento. Una volta partito, la scaletta
  // è bloccata (si modifica solo registrando il set).
  const initialExercises: PlannedExercise[] = useMemo(() => session.exercises ?? [], [session]);
  const warmupRoutine = pickWarmupForSession(session);
  const cooldownRoutine = pickCooldownForSession(session);

  // Snapshot resume: se presente E coerente con questa sessione (stesso day+type),
  // ripristina lo state. Altrimenti partenza fresh.
  const canResume = resumeFromSnapshot &&
    resumeFromSnapshot.sessionDay === session.day &&
    resumeFromSnapshot.sessionType === session.type;
  const startedAtRef = useMemo(() => canResume ? resumeFromSnapshot!.startedAt : new Date().toISOString(), [canResume]);

  const [exercises, setExercises] = useState<PlannedExercise[]>(
    canResume ? resumeFromSnapshot!.exercises : initialExercises,
  );
  const [stage, setStage] = useState<Stage>(
    canResume ? resumeFromSnapshot!.stage : (warmupRoutine ? "warmup-intro" : "preflight"),
  );
  const [exerciseIdx, setExerciseIdx] = useState(canResume ? resumeFromSnapshot!.exerciseIdx : 0);
  const [setIdx, setSetIdx] = useState(canResume ? resumeFromSnapshot!.setIdx : 0);
  const [completed, setCompleted] = useState<ExercisePerformance[]>(() =>
    canResume
      ? resumeFromSnapshot!.completed
      : initialExercises.map(ex => ({ exerciseId: ex.effectiveExerciseId ?? ex.exerciseId, sets: [] })),
  );
  const [currentReps, setCurrentReps] = useState<string>("");
  const [currentWeight, setCurrentWeight] = useState<string>("");
  const [restSec, setRestSec] = useState<number>(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // Sprint E: tasto indietro Android → apri l'exit-confirm (c'è progresso da
  // proteggere) invece di chiudere brutalmente la sessione.
  useModalBackButton(true, () => setShowExitConfirm(true));

  // Warmup/cooldown step tracking
  const [routineStepIdx, setRoutineStepIdx] = useState(canResume ? resumeFromSnapshot!.routineStepIdx : 0);

  // Snapshot persistence (Step F): salva ad ogni cambio di stage/completed/idx.
  // Skip "warmup-intro" e "done" (non rilevanti per recovery).
  useEffect(() => {
    if (stage === "warmup-intro" || stage === "done") return;
    const snap: GuidedSessionSnapshot = {
      sessionDay: session.day, sessionType: session.type,
      startedAt: startedAtRef,
      exercises, completed,
      stage, exerciseIdx, setIdx, routineStepIdx,
    };
    void setJSON(SNAPSHOT_KEY, snap);
  }, [stage, exercises, completed, exerciseIdx, setIdx, routineStepIdx, session.day, session.type, startedAtRef]);

  const currentExercise = exercises[exerciseIdx];
  const currentCatEx: Exercise | null = currentExercise ? (EXERCISES_BY_ID[currentExercise.effectiveExerciseId ?? currentExercise.exerciseId] ?? null) : null;
  const nextExercise = exercises[exerciseIdx + 1];
  const nextCatEx: Exercise | null = nextExercise ? (EXERCISES_BY_ID[nextExercise.effectiveExerciseId ?? nextExercise.exerciseId] ?? null) : null;
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
    void clearGuidedSessionSnapshot();
    // Filter perf con almeno 1 set eseguito (utente potrebbe aver skippato qualche esercizio)
    const validPerformances = completed.filter(p => p.sets.length > 0);
    onComplete(validPerformances);
  }

  function handleExitConfirm(action: "discard" | "save" | "pause") {
    setShowExitConfirm(false);
    if (action === "discard") {
      void clearGuidedSessionSnapshot();
      onClose();
    } else if (action === "save") {
      // Save: salva nel diario E pulisci snapshot (sessione chiusa).
      void clearGuidedSessionSnapshot();
      const validPerformances = completed.filter(p => p.sets.length > 0);
      onComplete(validPerformances);
    } else {
      // Pause: NON pulisce lo snapshot — l'utente torna nel TodayTab e
      // vede il banner "Riprendi" per continuare in seguito.
      onClose();
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

        {/* PREFLIGHT — editor scaletta */}
        {stage === "preflight" && (
          <PreflightEditor
            exercises={exercises}
            sessionType={session.type}
            userEquipment={(userEquipment ?? []) as EquipmentTag[]}
            onChange={(updated) => {
              setExercises(updated);
              // Sincronizza completed array per il save real-time
              setCompleted(updated.map(ex => ({
                exerciseId: ex.effectiveExerciseId ?? ex.exerciseId,
                sets: [],
              })));
            }}
            onConfirm={handleStartWorkout}
          />
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
                💾 Salva progresso nel diario
              </button>
              <button onClick={() => handleExitConfirm("pause")} style={{
                ...secondaryBtnStyle, color: "#0891B2", borderColor: "#0891B266",
              }}>
                ⏸ Pausa (riprendi dopo dal banner)
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
            <span style={{ fontSize: "12px", color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>
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
  catEx: Exercise;
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

// ─── PreflightEditor (Step E) ─────────────────────────────────────────────
// Editor inline per la scaletta esercizi prima di iniziare l'allenamento.
// Permette: modifica peso/sets/reps, reorder con ⬆/⬇, rimuovi, aggiungi
// nuovo esercizio dal catalog filtered per equipment+pattern.

function PreflightEditor({
  exercises, sessionType, userEquipment, onChange, onConfirm,
}: {
  exercises: PlannedExercise[];
  sessionType: string;
  userEquipment: EquipmentTag[];
  onChange: (updated: PlannedExercise[]) => void;
  onConfirm: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function update(idx: number, patch: Partial<PlannedExercise>) {
    onChange(exercises.map((ex, i) => i === idx ? { ...ex, ...patch } : ex));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= exercises.length) return;
    const next = [...exercises];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }
  function remove(idx: number) {
    onChange(exercises.filter((_, i) => i !== idx));
  }
  function add(newExId: string) {
    const catEx = EXERCISES_BY_ID[newExId];
    if (!catEx) return;
    const newEx: PlannedExercise = {
      exerciseId: newExId,
      plannedSets: 3,
      repsTarget: { min: 8, max: 12 },
      rpe_target: 7,
      rest_sec: 120,
    };
    onChange([...exercises, newEx]);
    setPickerOpen(false);
  }

  return (
    <>
      <div style={cardStyle}>
        <div style={{ fontSize: "22px", fontWeight: 800, color: "#22C55E", marginBottom: "10px" }}>
          ✓ Pronto per iniziare
        </div>
        <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5 }}>
          Rivedi la scaletta: puoi modificare peso/sets/reps, riordinare o aggiungere/rimuovere esercizi prima di partire.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {exercises.map((ex, i) => {
          const catEx = EXERCISES_BY_ID[ex.effectiveExerciseId ?? ex.exerciseId];
          return (
            <EditableExerciseRow
              key={i}
              idx={i}
              exercise={ex}
              catEx={catEx}
              canMoveUp={i > 0}
              canMoveDown={i < exercises.length - 1}
              onUpdate={(patch) => update(i, patch)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onRemove={() => remove(i)}
            />
          );
        })}
      </div>

      <button onClick={() => setPickerOpen(true)} style={secondaryBtnStyle}>
        + Aggiungi esercizio
      </button>

      <button
        onClick={onConfirm}
        disabled={exercises.length === 0}
        style={{
          ...ctaStyle,
          opacity: exercises.length === 0 ? 0.5 : 1,
          cursor: exercises.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        ▶ Inizia allenamento ({exercises.length} esercizi)
      </button>

      {pickerOpen && (
        <ExercisePickerModal
          sessionType={sessionType}
          userEquipment={userEquipment}
          excludeIds={exercises.map(e => e.exerciseId)}
          onPick={add}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

function EditableExerciseRow({
  idx, exercise, catEx, canMoveUp, canMoveDown,
  onUpdate, onMoveUp, onMoveDown, onRemove,
}: {
  idx: number;
  exercise: PlannedExercise;
  catEx: Exercise | undefined;
  canMoveUp: boolean; canMoveDown: boolean;
  onUpdate: (patch: Partial<PlannedExercise>) => void;
  onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void;
}) {
  const name = catEx?.name ?? exercise.exerciseId;
  const repsAvg = Math.round((exercise.repsTarget.min + exercise.repsTarget.max) / 2);
  const inputStyle: React.CSSProperties = {
    width: "60px", padding: "6px 8px",
    background: "#0B0F1A", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "6px", color: "#E2E8F0", fontSize: "13px",
    fontFamily: "'JetBrains Mono', monospace", textAlign: "center",
  };
  const iconBtn: React.CSSProperties = {
    padding: "6px 8px",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px",
    color: "#94A3B8", fontSize: "12px", cursor: "pointer", minWidth: "32px",
  };
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px", gap: "6px" }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", flex: 1 }}>
          {idx + 1}. {name}
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button onClick={onMoveUp} disabled={!canMoveUp} style={{ ...iconBtn, opacity: canMoveUp ? 1 : 0.3 }} aria-label="Sposta su">⬆</button>
          <button onClick={onMoveDown} disabled={!canMoveDown} style={{ ...iconBtn, opacity: canMoveDown ? 1 : 0.3 }} aria-label="Sposta giù">⬇</button>
          <button onClick={onRemove} style={{ ...iconBtn, color: "#EF4444" }} aria-label="Rimuovi">🗑</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "11px", color: "#94A3B8", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          Sets
          <input type="number" inputMode="numeric" min={1} max={10} value={exercise.plannedSets}
            onChange={e => onUpdate({ plannedSets: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })}
            style={inputStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          Reps
          <input type="number" inputMode="numeric" min={1} max={50} value={repsAvg}
            onChange={e => {
              const r = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1));
              onUpdate({ repsTarget: { min: r, max: r } });
            }}
            style={inputStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          Peso (kg)
          <input type="number" inputMode="decimal" min={0} max={500} step={0.5} value={exercise.weight_kg ?? ""}
            placeholder="—"
            onChange={e => {
              const v = parseFloat(e.target.value);
              onUpdate({ weight_kg: Number.isFinite(v) && v > 0 ? v : undefined });
            }}
            style={inputStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          Rest (s)
          <input type="number" inputMode="numeric" min={30} max={600} value={exercise.rest_sec}
            onChange={e => onUpdate({ rest_sec: Math.max(30, Math.min(600, parseInt(e.target.value, 10) || 60)) })}
            style={inputStyle} />
        </label>
      </div>
    </div>
  );
}

function ExercisePickerModal({
  sessionType, userEquipment, excludeIds, onPick, onClose,
}: {
  sessionType: string;
  userEquipment: EquipmentTag[];
  excludeIds: string[];
  onPick: (exerciseId: string) => void;
  onClose: () => void;
}) {
  // Filter del catalog: equipment compatibile + (se sessione forza_gambe/upper)
  // pattern coerente. Esclude esercizi già nella scaletta corrente.
  const filtered = useMemo(() => {
    const equipSet = new Set<EquipmentTag>([...userEquipment, "bodyweight"]);
    const isLower = sessionType === "forza_gambe";
    const isUpper = sessionType === "forza_upper";
    const allowedPatterns = isLower
      ? new Set(["squat", "hinge", "lunge", "core_antiext", "core_antirot"])
      : isUpper
        ? new Set(["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "carry", "core_antirot"])
        : null;
    const exSet = new Set(excludeIds);
    return EXERCISES.filter(ex => {
      if (exSet.has(ex.id)) return false;
      if (allowedPatterns && !allowedPatterns.has(ex.pattern)) return false;
      for (const tag of ex.equipment) {
        if (tag === "bodyweight") continue;
        if (!equipSet.has(tag)) return false;
      }
      return true;
    }).slice(0, 50);
  }, [sessionType, userEquipment, excludeIds]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 70,
      background: "rgba(11,15,26,0.92)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "20px 12px", overflowY: "auto",
    }}>
      <div style={{ ...cardStyle, maxWidth: "420px", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#E2E8F0" }}>
            Aggiungi esercizio
          </div>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: "12px" }}>✕</button>
        </div>
        {filtered.length === 0 ? (
          <div style={{ fontSize: "12px", color: "#94A3B8" }}>
            Nessun esercizio compatibile con il tuo equipment per questo tipo di sessione.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "60vh", overflowY: "auto" }}>
            {filtered.map(ex => (
              <button
                key={ex.id}
                onClick={() => onPick(ex.id)}
                style={{
                  textAlign: "left", padding: "10px 12px",
                  background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px", color: "#E2E8F0", cursor: "pointer",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 700 }}>{ex.name}</div>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>
                  {ex.pattern} · {ex.level} · {ex.equipment.join("/")}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
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
  nextCatEx: Exercise | null;
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
          fontSize: "64px", fontWeight: 800, color: secLeft <= 5 ? "#6366F1" : "#0891B2",
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
