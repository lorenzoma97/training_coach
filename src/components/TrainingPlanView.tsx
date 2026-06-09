import { useEffect, useMemo, useRef, useState } from "react";
import { getJSON } from "../lib/storage";
import type { TrainingPlan, UserProfile, UserGoal } from "../lib/types";
import { events } from "../lib/events";
import { setJSON } from "../lib/storage";
import { planStateHash } from "../lib/coach/planValidator";
import { buildCoachContext, getLastNDays } from "../lib/diaryContext";
import { regenerateNextWeek, generateInitialPlan, adaptPlan } from "../lib/coach/planGenerator";
import { tryProjectMacroPlan, adaptMacroWeek } from "../lib/coach/macroWeekPlan";
import {
  gatherWeekEvents, applyAdaptationDiff, generateAdaptationDiff, sessionAlternatives,
  type WeekEvent, type AdaptationOp, type AdaptContext, type ApplyResult,
} from "../lib/coach/macroAdapter";
import { getCurrentReadiness } from "../lib/coach/readinessScoring";
import { loadActiveMacroProgram } from "../lib/macroprogram/storage";
import { TOKENS } from "../lib/theme";
import { translateGeminiError } from "../lib/geminiErrors";
import { savePlanWithHistory, getPlanHistory, getNextPlan, saveNextPlan, clearNextPlan, maybePromoteNextPlan } from "../lib/coach/planHistory";
import { computeZonesContext, inferSessionZone, stripInlineHRRange, type ZonesResult } from "../lib/coach/zones";
import type { PlannedSession, PlannedExercise } from "../lib/types";
import { useNotify } from "./Notification";
import ReadinessBanner from "./coach/ReadinessBanner";
import MacroUpdatedBanner from "./coach/MacroUpdatedBanner";
import SubstitutionBadge from "./coach/SubstitutionBadge";
import { parseISODateLocal } from "../lib/dateFormatters";
import { resolveSubstitution } from "../lib/coach/equipmentSubstitutor";
import { normalizeEquipmentTags } from "../lib/equipment/equipmentNormalizer";
import { EXERCISES } from "../lib/catalog/exercises";
import { lookupExerciseHybrid } from "../lib/macroprogram/customCatalog";

const ADAPT_QUICK_PROMPTS = [
  "Più intenso",
  "Più leggero",
  "Settimana di deload",
  "Aggiungi più forza",
  "Non posso allenarmi giovedì",
];

/** Nome leggibile di un esercizio dal catalog (hardcoded + custom). Fallback id. */
function exerciseName(id: string): string {
  return lookupExerciseHybrid(id)?.name ?? EXERCISES.find(e => e.id === id)?.name ?? id;
}

/** Formatta il recupero: 120s → "2'", 90s → "1'30\"", 45s → "45\"". */
function formatRest(sec: number | undefined): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}"`;
  return s === 0 ? `${m}'` : `${m}'${s}"`;
}

/** Intensità prescritta: RPE / carico / %1RM / RIR. "—" se nessuna. */
function intensityLabel(ex: PlannedExercise): string {
  if (typeof ex.weight_kg === "number") return `${ex.weight_kg}kg`;
  if (typeof ex.pct1RM === "number") return `${ex.pct1RM}%1RM`;
  if (typeof ex.rpe_target === "number") return `RPE ${ex.rpe_target}`;
  if (typeof ex.rir_target === "number") return `RIR ${ex.rir_target}`;
  return "—";
}

const METRIC_CHIP: React.CSSProperties = {
  fontSize: "11px", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
  padding: "3px 8px", borderRadius: "6px",
  background: "#0F172A", border: "1px solid rgba(255,255,255,0.08)", color: "#CBD5E1",
};

const ALT_BTN_STYLE: React.CSSProperties = {
  textAlign: "left", padding: "10px 12px", background: "#16213E",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
  color: "#E2E8F0", fontSize: "12px", fontWeight: 600, cursor: "pointer",
};

/**
 * StatoBanner (Sprint N) — banner di STATO PIANO unico, a priorità. Sostituisce
 * i 3 banner amber sparsi (stale / in scadenza / profilo cambiato) che potevano
 * impilarsi. tone=danger (critico) o attention (da aggiornare). CTA opzionale.
 */
function StatoBanner({ tone, title, body, cta, onCta, disabled, busyLabel }: {
  tone: "danger" | "attention";
  title: string;
  body: string;
  cta?: string;
  onCta?: () => void;
  disabled?: boolean;
  busyLabel?: string;
}) {
  const c = tone === "danger" ? TOKENS.danger : TOKENS.attention;
  return (
    <div style={{ background: `${c}15`, border: `1px solid ${c}66`, borderRadius: "12px", padding: "12px 14px" }}>
      <div style={{ fontSize: "12px", color: c, fontWeight: 700, marginBottom: "4px" }}>
        {tone === "danger" ? "⚠ " : "⏰ "}{title}
      </div>
      <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5, marginBottom: cta ? "10px" : 0 }}>{body}</div>
      {cta && onCta && (
        <button
          onClick={onCta}
          disabled={disabled}
          aria-busy={disabled || undefined}
          style={{
            padding: "10px 14px",
            background: disabled ? "#1E293B" : `linear-gradient(135deg, ${TOKENS.primary} 0%, #D4452F 100%)`,
            border: "none", borderRadius: "10px", color: "#FFF",
            fontSize: "13px", fontWeight: 700,
            cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.5 : 1,
          }}
        >
          {disabled && busyLabel ? busyLabel : cta}
        </button>
      )}
    </div>
  );
}

/**
 * Wave 4.3 → Sprint J (2026-06-09) — render esercizi forza STILE SCHEDA DA
 * PALESTRA: una riga-card per esercizio con numero, nome leggibile (non l'id),
 * chip Serie×Reps / Recupero / Intensità, e una riga nota tecnica (cue, es.
 * tempo eccentrico dal macro). Mantiene SubstitutionBadge (equipment) + il
 * badge rosso "non eseguibile".
 *
 * resolveSubstitution è pure: hop=0 esegui com'è, hop>0 nome sostituito + badge,
 * null = equipment insufficiente anche dopo 3 sostituzioni.
 */
function ExercisesList({
  exercises,
  availableEquipment,
}: {
  exercises: PlannedExercise[];
  availableEquipment: ReturnType<typeof normalizeEquipmentTags>;
}) {
  // Aperta di default: in palestra serve vederla subito. Touch target garantito.
  return (
    <details open style={{ marginTop: "8px" }}>
      <summary
        style={{
          cursor: "pointer", fontSize: "11px", fontWeight: 800,
          color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "6px 0", minHeight: "32px",
          display: "flex", alignItems: "center", gap: "6px",
          listStyle: "none", userSelect: "none",
        }}
      >
        <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', monospace" }}>▾</span>
        Scheda esercizi ({exercises.length})
      </summary>
      <div style={{ margin: "8px 0 0", display: "flex", flexDirection: "column", gap: "8px" }}>
        {exercises.map((ex, exIdx) => {
          const result = resolveSubstitution(ex.exerciseId, availableEquipment, EXERCISES);
          const displayId = result && result.hop > 0 ? result.resolvedId : ex.exerciseId;
          const name = exerciseName(displayId);
          const repsLabel = ex.repsTarget.min === ex.repsTarget.max
            ? `${ex.repsTarget.min}`
            : `${ex.repsTarget.min}-${ex.repsTarget.max}`;
          const intensity = intensityLabel(ex);
          return (
            <div
              key={`${ex.exerciseId}-${exIdx}`}
              style={{
                background: "#13203B", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "10px", padding: "10px 12px",
                display: "flex", flexDirection: "column", gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span style={{
                  fontSize: "11px", fontWeight: 800, color: "#64748B",
                  fontFamily: "'JetBrains Mono', monospace", minWidth: "16px",
                }}>{exIdx + 1}</span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0", lineHeight: 1.3, flex: 1 }}>
                  {name}
                </span>
                {result && result.hop > 0 && (
                  <SubstitutionBadge
                    original={result.originalId}
                    resolved={result.resolvedId}
                    reason={result.reason}
                  />
                )}
              </div>

              {/* Chip metriche stile scheda */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", paddingLeft: "24px" }}>
                <span style={{ ...METRIC_CHIP, color: "#38BDF8", borderColor: "#38BDF833" }}>
                  {ex.plannedSets}×{repsLabel}
                </span>
                <span style={METRIC_CHIP} title="Recupero tra le serie">rec {formatRest(ex.rest_sec)}</span>
                {intensity !== "—" && (
                  <span style={{ ...METRIC_CHIP, color: "#F59E0B", borderColor: "#F59E0B33" }} title="Intensità target">
                    {intensity}
                  </span>
                )}
              </div>

              {/* Nota tecnica (cue): tempo eccentrico / pausa dal macro, ecc. */}
              {ex.cue && (
                <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.4, paddingLeft: "24px" }}>
                  {ex.cue}
                </div>
              )}

              {result === null && (
                <div
                  role="alert"
                  title="Esercizio non eseguibile: il tuo profilo equipment non e' sufficiente nemmeno dopo 3 sostituzioni."
                  style={{
                    marginLeft: "24px",
                    backgroundColor: "#fee2e2", color: "#7f1d1d", border: "1px solid #fca5a5",
                    padding: "4px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                  }}
                >
                  esercizio non eseguibile, profilo equipment insufficiente
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export default function TrainingPlanView() {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);
  const [currentGoals, setCurrentGoals] = useState<UserGoal[]>([]);
  const [recentDays, setRecentDays] = useState<Array<{ date: string; workouts: any[] }>>([]);
  const [zonesCtx, setZonesCtx] = useState<ZonesResult | null>(null);
  const [history, setHistory] = useState<TrainingPlan[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Adatta piano
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptRequest, setAdaptRequest] = useState("");
  const [adapting, setAdapting] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);

  // Timer elapsed per generazione/adapt: mostra all'utente un countdown reale
  // durante l'attesa LLM (tipicamente 10-30s). Evita la sensazione di freeze.
  const [llmElapsedSec, setLlmElapsedSec] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const busy = regenerating || adapting;
    if (busy) {
      setLlmElapsedSec(0);
      elapsedTimerRef.current = setInterval(() => setLlmElapsedSec((s: number) => s + 1), 1000);
    } else {
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
      setLlmElapsedSec(0);
    }
    return () => {
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    };
  }, [regenerating, adapting]);

  // Notifica successo post-update: popup modale persistente (X + click-outside + Esc).
  // Scartato l'auto-dismiss banner: l'utente non ha tempo di leggere il rationale
  // (spesso 2-3 frasi) prima che scompaia. Popup forza dismiss esplicito.
  const { notify } = useNotify();

  // Split il rationale in bullet per la UI. L'LLM spesso produce paragrafi
  // densi; spezzettare per frase aumenta scanability (audit UI: rationale
  // era un blob di testo difficile da leggere a colpo d'occhio).
  // 1° tentativo: split su newline (LLM recenti usano newline esplicite).
  // 2° tentativo: split su periodo + spazio (rationale tradizionali).
  const rationaleToBullets = (text: string): string[] => {
    if (!text) return [];
    // Strip markdown bullet leading ("- ", "* ", "• ") che il modello include
    // talvolta nella stringa rationale → evita doppio bullet "• - testo".
    const stripBullet = (s: string) => s.trim().replace(/^[-*•]\s+/, "");
    const byNewline = text.split(/\n+/).map(stripBullet).filter(Boolean);
    if (byNewline.length > 1) return byNewline;
    const bySentence = text.split(/(?<=[.!?])\s+(?=[A-ZÀÈÉÌÒÙ])/).map(stripBullet).filter(Boolean);
    return bySentence.length > 1 ? bySentence : [stripBullet(text)];
  };

  const showSuccess = (title: string, rationale: string) => {
    const bullets = rationaleToBullets(rationale);
    // Popup message con bullet visuali ("• ") — PopupCard renderizza con pre-wrap.
    const formattedMessage = bullets.length > 1
      ? bullets.map(b => `• ${b}`).join("\n")
      : rationale;
    notify({
      mode: "popup",
      tone: "success",
      title,
      message: formattedMessage,
      duration: null, // persistente, dismiss manuale
    });
  };

  // isMounted guard: protegge da setState dopo unmount (tab switch veloce,
  // navigate, o plan generation lunga che completa dopo che l'utente ha lasciato).
  const mountedRef = useRef(true);

  // Piano "preview" per la settimana prossima (slot training-plan-next).
  // Visibile come banner sopra il piano corrente quando entrambi esistono.
  const [nextPlan, setNextPlan] = useState<TrainingPlan | null>(null);
  // Toggle visualizzazione: quando true mostra il preview invece del corrente.
  const [viewingNext, setViewingNext] = useState(false);

  // Sprint H (2026-06-09): readiness band di oggi (per gli eventi adattamento)
  // + dismiss del banner "eventi rilevati". Il banner ricompare al cambio piano.
  const [readinessBand, setReadinessBand] = useState<"low" | "moderate" | "high" | undefined>(undefined);
  const [eventsBannerDismissed, setEventsBannerDismissed] = useState(false);

  // Sprint K (2026-06-09): menu "sostituisci sessione" per-sessione (quale è
  // aperto) + stato del path "Altro" (LLM con guardrail).
  const [subMenuKey, setSubMenuKey] = useState<string | null>(null);
  const [subAltroOpen, setSubAltroOpen] = useState(false);
  const [subAltroText, setSubAltroText] = useState("");

  const load = async () => {
    // Auto-promote prima di caricare: se la settimana del preview è iniziata,
    // il preview diventa "corrente" e quello vecchio finisce in history.
    await maybePromoteNextPlan().catch(() => false);
    const [p, profile, goals, days, hist, daysForZones, np] = await Promise.all([
      getJSON<TrainingPlan | null>("training-plan", null),
      getJSON<UserProfile | null>("user-profile", null),
      getJSON<UserGoal[]>("user-goals", []),
      getLastNDays(14),
      getPlanHistory(),
      // Zone FC: servono 60gg per il calcolo empirico (stesso scope di ZonesCard).
      // Indipendente dai 14gg usati per il matching piano↔diario.
      getLastNDays(60).catch(() => [] as Array<{ date: string; daily: any; workouts: any[] }>),
      getNextPlan(),
    ]);
    if (!mountedRef.current) return;

    // Sprint M (2026-06-09): AUTO-PROIEZIONE nel load path — il fix-radice del
    // disallineamento header↔piano. Se c'è un macro attivo e il piano salvato
    // NON è della settimana corrente del macro (stale), riproietta
    // deterministicamente (no LLM): header (settimana corrente) e piano
    // combaciano SEMPRE → niente falso "PIANO SCADUTO" né banner stale/drift
    // che ne derivavano. Se la settimana combacia, si tiene il piano salvato
    // (preserva gli adattamenti utente già applicati questa settimana).
    let effectivePlan = p;
    if (profile) {
      const projected = await tryProjectMacroPlan(profile).catch(() => null);
      if (projected && p?.sourceMacro?.weekNumber !== projected.sourceMacro?.weekNumber) {
        effectivePlan = projected;
        await savePlanWithHistory(projected).catch(() => { /* best-effort */ });
      }
    }

    if (!mountedRef.current) return;
    setPlan(effectivePlan);
    setCurrentProfile(profile);
    setCurrentGoals(goals);
    setRecentDays(days);
    setHistory(hist);
    setNextPlan(np);
    // Ricalcola le zone dal profilo corrente + storico recente.
    // Unica fonte di verità per i range bpm renderizzati nei chip delle sessioni.
    const ctx = profile ? computeZonesContext(profile, daysForZones) : null;
    setZonesCtx(ctx?.zones ?? null);
    // Readiness di oggi: alimenta gli eventi dell'adattatore vincolato.
    const readiness = await getCurrentReadiness().catch(() => null);
    if (!mountedRef.current) return;
    setReadinessBand(readiness?.band);
    // Nuovo caricamento piano → riarma il banner eventi.
    setEventsBannerDismissed(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    const offPlan = events.on("plan:updated", load);
    const offProfile = events.on("profile:updated", load);
    const offGoals = events.on("goals:updated", load);
    const offWorkout = events.on("workout:saved", load);
    return () => {
      mountedRef.current = false;
      offPlan(); offProfile(); offGoals(); offWorkout();
    };
  }, []);

  // State hash check: se profilo O goal sono cambiati rispetto al piano, segnala obsolescenza.
  const profileDrift = useMemo(() => {
    if (!plan || !currentProfile || !plan.profileHash) return false;
    return plan.profileHash !== planStateHash(currentProfile, currentGoals);
  }, [plan, currentProfile, currentGoals]);

  // Wave 4.3 — Equipment dell'utente normalizzato per il SubstitutionBadge
  // wiring. Pure derivation, ricomputo solo se cambia profile.equipment.
  // bodyweight è SEMPRE incluso (vedi normalizeEquipmentTags).
  const availableEquipmentForRender = useMemo(
    () => normalizeEquipmentTags(currentProfile?.equipment ?? []),
    [currentProfile?.equipment],
  );

  // Stesso check ma sul nextPlan: se l'utente ha modificato profilo dopo aver
  // generato la preview prossima settimana, anche quella diventa obsoleta.
  const nextPlanDrift = useMemo(() => {
    if (!nextPlan || !currentProfile || !nextPlan.profileHash) return false;
    return nextPlan.profileHash !== planStateHash(currentProfile, currentGoals);
  }, [nextPlan, currentProfile, currentGoals]);

  // Matching intelligente piano↔diario.
  // Per ogni sessione pianificata, cerca un workout del MEDESIMO TIPO nella settimana
  // del piano (non solo nel giorno esatto). Tiene anche traccia dei workout EXTRA
  // (fatti ma non pianificati) e delle sessioni SALTATE (pianificate ma non fatte).
  const matchResult = useMemo(() => {
    const sessionKey = (week: number, day: string, date: number) => `${week}-${day}-${date}`;
    const isoLocal = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    };
    if (!plan || !plan.startDate || !recentDays.length) {
      return {
        completed: new Map<string, { date: string; sameDay: boolean; strictMatch: boolean; actualSubtype?: string; actualType?: string }>(),
        extras: [] as Array<{ date: string; workout: any }>,
        skipped: new Set<string>(),
      };
    }
    // Family matching: forza_gambe e forza_upper sono interscambiabili per
    // pianificazione. Se pianifico upper ma faccio gambe lo stesso giorno,
    // conta come VARIAZIONE (non SALTATA + AUTONOMO duplicati).
    // cardio (corsa/sport) resta distinto — un utente che pianifica corsa
    // e fa tennis ha davvero saltato la corsa.
    const typeFamily = (type: string): string => {
      if (type === "forza_gambe" || type === "forza_upper") return "forza";
      return type;
    };
    const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
    const [sy, sm, sd] = plan.startDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);

    // Oggi (fine giornata) — non matchare sessioni PIANIFICATE nel FUTURO:
    // l'utente potrebbe ancora farle. Es. mer Fondo Lento non deve essere
    // associato al sab Fondo Lento ancora in programma.
    // Inoltre: non contare come "saltata" una sessione di OGGI (giornata in
    // corso, l'utente può ancora allenarsi).
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Set di ID workout già matchati a una sessione del piano (evita doppi match)
    const usedWorkoutIds = new Set<string>();
    const completed = new Map<string, { date: string; sameDay: boolean; strictMatch: boolean; actualSubtype?: string; actualType?: string }>();
    const skipped = new Set<string>();

    for (let w = 0; w < plan.weeks.length; w++) {
      const week = plan.weeks[w];
      // Calcola intervallo date della settimana del piano
      const weekStart = new Date(start);
      weekStart.setDate(start.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const weekStartKey = isoLocal(weekStart);
      const weekEndKey = isoLocal(weekEnd);

      // Workout di questa settimana nel diario
      const weekDays = recentDays.filter((rd: { date: string }) => rd.date >= weekStartKey && rd.date <= weekEndKey);

      for (const s of week.sessions) {
        const dayIdx = DAY_KEYS.indexOf(s.day);
        if (dayIdx < 0) continue;
        const plannedDate = new Date(start);
        plannedDate.setDate(start.getDate() + w * 7 + dayIdx);
        const plannedKey = isoLocal(plannedDate);
        const key = sessionKey(week.weekNumber, s.day, plannedDate.getTime());

        // Sessione nel FUTURO: non matchare (l'utente potrebbe ancora farla)
        // e non contarla come saltata. Stato = "futura" (non marcato né fatta
        // né saltata, il render mostra OGGI/futuro normalmente).
        if (plannedDate > todayEnd) continue;

        // Cerca workout dello stesso GIORNO + tipo (+ subtipo se specificato).
        // Match stretto = stesso giorno + stesso tipo + stesso subtype.
        // Match parziale = stesso giorno + stesso tipo ma subtype diverso.
        // NO fallback cross-day: se il mar fondo non è stato fatto e mer ne ho
        // fatto uno, il piano segna mar come SALTATA e il mer come AUTONOMO.
        // L'utente può poi cliccare "Adatta alle deviazioni" per riallineare.
        const plannedSub = (s.subtype || "").toLowerCase().trim();
        const matchWorkoutSub = (w: any) => {
          const sub = (w.fields?.tipo || w.fields?.sport || "").toLowerCase().trim();
          return sub;
        };
        const plannedDayEntry = weekDays.find((d: any) => d.date === plannedKey);
        let match: { dateKey: string; workout: any; strictMatch: boolean } | null = null;
        if (plannedDayEntry) {
          // 1° tentativo stesso-giorno: tipo + subtipo identici
          if (plannedSub) {
            for (const w of (plannedDayEntry.workouts || [])) {
              if (usedWorkoutIds.has(w.id)) continue;
              if (w.type === s.type && matchWorkoutSub(w) === plannedSub) {
                match = { dateKey: plannedDayEntry.date, workout: w, strictMatch: true };
                break;
              }
            }
          }
          // 2° tentativo stesso-giorno: solo tipo (subtype diverso)
          if (!match) {
            for (const w of (plannedDayEntry.workouts || [])) {
              if (usedWorkoutIds.has(w.id)) continue;
              if (w.type === s.type) {
                match = { dateKey: plannedDayEntry.date, workout: w, strictMatch: !plannedSub };
                break;
              }
            }
          }
          // 3° tentativo stesso-giorno: stessa family (forza_gambe ↔ forza_upper).
          // Se il piano dice forza upper ma l'utente ha fatto forza gambe, è
          // comunque una sessione di forza sullo stesso giorno — conta come
          // VARIAZIONE (not SALTATA + AUTONOMO duplicati).
          if (!match) {
            const plannedFamily = typeFamily(s.type);
            for (const w of (plannedDayEntry.workouts || [])) {
              if (usedWorkoutIds.has(w.id)) continue;
              if (typeFamily(w.type) === plannedFamily && w.type !== s.type) {
                match = { dateKey: plannedDayEntry.date, workout: w, strictMatch: false };
                break;
              }
            }
          }
        }

        if (match) {
          usedWorkoutIds.add(match.workout.id);
          completed.set(key, {
            date: match.dateKey,
            sameDay: match.dateKey === plannedKey,
            strictMatch: match.strictMatch,
            actualSubtype: match.workout.fields?.tipo || match.workout.fields?.sport || undefined,
            // Se il tipo registrato differisce da quello pianificato (family match
            // forza_gambe↔forza_upper), il render lo mostra per trasparenza.
            actualType: match.workout.type !== s.type ? match.workout.type : undefined,
          });
        } else if (plannedDate < todayStart) {
          // SALTATA solo se nel passato (giorni precedenti). Oggi senza match
          // resta "OGGI" nel render (l'utente può ancora allenarsi).
          skipped.add(key);
        }
      }
    }

    // Workout EXTRA: tutti quelli non matchati con nessuna sessione del piano
    const extras: Array<{ date: string; workout: any }> = [];
    for (const rd of recentDays as Array<{ date: string; workouts: any[] }>) {
      for (const w of (rd.workouts || [])) {
        if (!usedWorkoutIds.has(w.id)) extras.push({ date: rd.date, workout: w });
      }
    }
    // Limita extras a quelli nelle settimane del piano
    const planStartKey = isoLocal(start);
    const planEnd = new Date(start);
    planEnd.setDate(start.getDate() + plan.weeks.length * 7 - 1);
    const planEndKey = isoLocal(planEnd);
    const extrasInPlanWindow = extras.filter(e => e.date >= planStartKey && e.date <= planEndKey);

    return { completed, extras: extrasInPlanWindow, skipped };
    // currentGoals incluso nelle deps: anche se il body del memo non ne legge
    // direttamente, un cambio di goals (reorder, priority) può invalidare il
    // matching logico visto a livello utente (es. priorità modifica quali
    // sessioni vengono considerate "rilevanti" nelle viste derivate).
  }, [plan, recentDays, currentGoals]);

  const completedSessions = matchResult.completed;
  const extraWorkouts = matchResult.extras;
  const skippedSessions = matchResult.skipped;

  // Conta deviazioni: sessioni pianificate ma saltate/variate + workout non pianificati.
  // Usato per mostrare il CTA "Adatta piano alle deviazioni".
  const deviationCount = useMemo(() => {
    let partial = 0;
    completedSessions.forEach((c: { strictMatch: boolean }) => { if (!c.strictMatch) partial++; });
    return { skipped: skippedSessions.size, partial, extras: extraWorkouts.length };
  }, [completedSessions, extraWorkouts, skippedSessions]);

  const hasDeviations = deviationCount.skipped > 0 || deviationCount.partial > 0 || deviationCount.extras > 0;

  // Ritorna il chip zona per una sessione: indice Z1-5 + range bpm calcolato
  // dalle zone personalizzate correnti (unica fonte di verità). Preferisce il
  // campo `session.zone` esplicito (piani nuovi), altrimenti infer da
  // subtype/details (piani legacy). Null se non è una sessione cardio.
  const zoneChipFor = (s: PlannedSession): { idx: 1 | 2 | 3 | 4 | 5; low: number; high: number } | null => {
    if (!zonesCtx) return null;
    const idx = (s.zone as 1 | 2 | 3 | 4 | 5 | undefined) ?? inferSessionZone(s.type, s.subtype, s.details);
    if (!idx) return null;
    const z = zonesCtx.zones.find((zz: { index: number }) => zz.index === idx);
    if (!z) return null;
    return { idx, low: z.hrLow, high: z.hrHigh };
  };

  const ZONE_CHIP_COLORS: Record<number, { bg: string; border: string; text: string }> = {
    1: { bg: "#10B98120", border: "#10B98166", text: "#10B981" },
    2: { bg: "#22C55E20", border: "#22C55E66", text: "#22C55E" },
    3: { bg: "#EAB30820", border: "#EAB30866", text: "#EAB308" },
    4: { bg: "#F9731620", border: "#F9731666", text: "#F97316" },
    5: { bg: "#EF444420", border: "#EF444466", text: "#EF4444" },
  };

  // Costruisce il messaggio per l'LLM quando l'utente clicca "Adatta alle deviazioni".
  const buildDeviationRequest = (): string => {
    if (!plan) return "";
    const parts: string[] = [];
    const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
    if (!plan.startDate) return "";
    const [sy, sm, sd] = plan.startDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    for (const week of plan.weeks) {
      for (const s of week.sessions) {
        const dayIdx = DAY_KEYS.indexOf(s.day);
        if (dayIdx < 0) continue;
        const sessionDate = new Date(start);
        sessionDate.setDate(start.getDate() + (week.weekNumber - 1) * 7 + dayIdx);
        const key = `${week.weekNumber}-${s.day}-${sessionDate.getTime()}`;
        const c = completedSessions.get(key);
        if (skippedSessions.has(key)) {
          parts.push(`- SALTATA: ${s.day} ${s.type}${s.subtype ? ` (${s.subtype})` : ""}, ${s.duration_min}min pianificata`);
        } else if (c && !c.strictMatch) {
          const actualTypeHint = c.actualType ? `${c.actualType}${c.actualSubtype ? ` (${c.actualSubtype})` : ""}` : (c.actualSubtype || "variante dello stesso tipo");
          parts.push(`- VARIAZIONE ${s.day}: pianificato ${s.type}${s.subtype ? ` (${s.subtype})` : ""}, fatto invece ${actualTypeHint}${!c.sameDay ? ` il ${c.date}` : ""}`);
        }
      }
    }
    for (const e of extraWorkouts) {
      const sub = e.workout.fields?.tipo || e.workout.fields?.sport || "";
      const dur = e.workout.fields?.durata_totale || e.workout.fields?.durata || "";
      parts.push(`- AUTONOMO: ${e.date} ${e.workout.type}${sub ? ` (${sub})` : ""}${dur ? `, ${dur}min` : ""} (non pianificato)`);
    }
    return `Il piano ha avuto le seguenti deviazioni:\n${parts.join("\n")}\n\nAdatta le sessioni future del piano in base a ciò che è stato realmente fatto (evita carichi duplicati, aggiungi recovery se sessioni autonome erano intense, mantieni il percorso verso gli obiettivi).`;
  };

  // Sprint H: versione STRUTTURATA delle deviazioni → WeekEvent[] per
  // l'adattatore vincolato (quando c'è un macroprogramma attivo). Specchio di
  // buildDeviationRequest ma tipizzato (l'LLM riceve eventi discreti, non testo).
  const buildDeviationEvents = (): WeekEvent[] => {
    if (!plan?.startDate) return [];
    const out: WeekEvent[] = [];
    const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
    const [sy, sm, sd] = plan.startDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const asDay = (d: string): WeekEvent["day"] =>
      (DAY_KEYS.includes(d) ? d : undefined) as WeekEvent["day"];
    for (const week of plan.weeks) {
      for (const s of week.sessions) {
        const dayIdx = DAY_KEYS.indexOf(s.day);
        if (dayIdx < 0) continue;
        const sessionDate = new Date(start);
        sessionDate.setDate(start.getDate() + (week.weekNumber - 1) * 7 + dayIdx);
        const key = `${week.weekNumber}-${s.day}-${sessionDate.getTime()}`;
        if (skippedSessions.has(key)) {
          out.push({ kind: "skipped", day: asDay(s.day), detail: `Saltata ${s.day} ${s.type}${s.subtype ? ` (${s.subtype})` : ""}, ${s.duration_min}min` });
        } else {
          const c = completedSessions.get(key);
          if (c && !c.strictMatch) {
            const actual = c.actualType ? `${c.actualType}${c.actualSubtype ? ` (${c.actualSubtype})` : ""}` : (c.actualSubtype || "variante");
            out.push({ kind: "variation", day: asDay(s.day), detail: `${s.day}: pianificato ${s.type}, fatto ${actual}` });
          }
        }
      }
    }
    for (const e of extraWorkouts) {
      const sub = e.workout.fields?.tipo || e.workout.fields?.sport || "";
      out.push({ kind: "extra", detail: `Autonomo ${e.date} ${e.workout.type}${sub ? ` (${sub})` : ""} (non pianificato)` });
    }
    return out;
  };

  // Sprint H: eventi della settimana rilevati AUTOMATICAMENTE (puro, no LLM).
  // Solo se c'è un macroprogramma attivo (sourceMacro): per il banner proattivo
  // "N eventi rilevati → Adatta / Mantieni fedele". L'LLM scatta solo su conferma.
  const pendingEvents = useMemo<WeekEvent[]>(() => {
    if (!plan?.sourceMacro) return [];
    return gatherWeekEvents({ recentDays, readinessBand, deviationEvents: buildDeviationEvents() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, recentDays, readinessBand, completedSessions, extraWorkouts, skippedSessions]);

  // Picker stato: null = chiuso, "show" = aperto in attesa di scelta utente.
  // Le 2 modalità vengono passate a regenerateNextWeek.
  const [regenPickerOpen, setRegenPickerOpen] = useState(false);
  // Override giorni allenabili per QUESTA generazione. undefined = usa profilo
  // (default routine). Inizializzato dal profilo all'apertura del picker.
  const [pickerDays, setPickerDays] = useState<string[] | undefined>(undefined);

  // Quando il picker si apre, sincronizza con il default del profilo. Se profilo
  // ha availableDays popolato, parte da quello. Altrimenti seleziona TUTTI i giorni
  // (più friendly del vuoto = "blocca tutto"). L'utente può deselezionare a piacere.
  useEffect(() => {
    if (!regenPickerOpen) return;
    const def = currentProfile?.availableDays;
    if (def && def.length > 0) setPickerDays([...def]);
    else setPickerDays(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]);
  }, [regenPickerOpen, currentProfile]);

  const handleRegenerate = async (
    mode: "rest-of-week" | "next-week" = "next-week",
    daysOverride?: string[],
  ) => {
    if (regenerating) return;
    // Guard offline: la generazione richiede LLM cloud. Evita errore network
    // criptico dopo 10s di loading — messaggio immediato.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setRegenError("Offline. Riconnettiti per rigenerare il piano.");
      return;
    }
    setRegenPickerOpen(false);
    setRegenerating(true);
    setRegenError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      if (!profile) throw new Error("Profilo mancante. Completa l'onboarding.");
      // Pass override SOLO se l'utente ha modificato il default profilo.
      // Confronto JSON: ordinato per essere insensibile a permutazioni.
      const profileDefault = (profile.availableDays || []).slice().sort().join(",");
      const overrideSorted = daysOverride ? daysOverride.slice().sort().join(",") : null;
      const allDaysSorted = ["dom","gio","lun","mar","mer","sab","ven"].join(",");
      const effectiveOverride: string[] | undefined = (() => {
        if (!daysOverride) return undefined;
        // Se l'override coincide col default profilo → niente override (passa undefined)
        if (overrideSorted === profileDefault && profileDefault.length > 0) return undefined;
        // Se profilo è vuoto E override = tutti i 7 giorni → niente override (= scelta libera LLM)
        if (profileDefault === "" && overrideSorted === allDaysSorted) return undefined;
        return daysOverride;
      })();
      const opts = effectiveOverride ? { availableDaysOverride: effectiveOverride } : undefined;
      let next: TrainingPlan;
      let title: string;
      // Sprint A (2026-05-27): se c'è un macroprogramma attivo che copre la
      // settimana corrente, il piano è una PROIEZIONE deterministica del macro
      // (+ adattamento readiness), NON una rigenerazione LLM. Garantisce
      // concordanza piano↔macro per costruzione.
      const macroPlan = await tryProjectMacroPlan(profile);
      if (macroPlan) {
        next = macroPlan;
        const adaptN = macroPlan.sourceMacro?.adaptations.length ?? 0;
        title = adaptN > 0
          ? `✓ Settimana ${macroPlan.sourceMacro?.weekNumber} proiettata dal programma (${adaptN} adattamenti per readiness)`
          : `✓ Settimana ${macroPlan.sourceMacro?.weekNumber} proiettata dal programma`;
      } else if (plan) {
        const ctx = await buildCoachContext({ daysBack: 14 });
        next = await regenerateNextWeek(profile, goals, plan, ctx.recentDaysText, mode, opts);
        title = mode === "rest-of-week"
          ? "✓ Piano riavviato dai giorni rimanenti di questa settimana"
          : "✓ Piano per la prossima settimana generato";
      } else {
        next = await generateInitialPlan(profile, goals, opts);
        title = "✓ Piano iniziale generato";
      }
      // Routing storage: NEXT slot vs CURRENT slot.
      // - rest-of-week: sempre training-plan (è la settimana che inizia oggi/lun)
      // - next-week + piano corrente attivo (con startDate <= oggi e validUntil futuro):
      //     salva in training-plan-next (preview), il corrente resta visibile
      // - next-week senza piano attivo o startDate generato già passato:
      //     salva in training-plan corrente
      const today = new Date(); today.setHours(0,0,0,0);
      const newPlanStart = next.startDate ? new Date(`${next.startDate}T00:00:00`) : today;
      const currentStillActive = !!plan && !!plan.validUntil && new Date(plan.validUntil) > today;
      // Fix bug "rigenera lascia settimana vecchia": se il piano corrente è
      // STALE (>7gg dalla startDate originale), il next-week DEVE sostituirlo
      // direttamente nello slot corrente. Senza questo, finiva in
      // training-plan-next (preview) e l'UI mostrava ancora il vecchio.
      const currentIsStale = (() => {
        if (!plan?.startDate) return false;
        const planStart = new Date(`${plan.startDate}T00:00:00`);
        const ageDays = Math.floor((today.getTime() - planStart.getTime()) / 86400000);
        return ageDays > 7;
      })();
      const shouldSaveAsNext = mode === "next-week" && currentStillActive && newPlanStart > today && !currentIsStale;
      // Log diagnostico (F12 console) per debug se ancora "rigenera lascia
      // piano vecchio" — Lorenzo può mandarmi questi output.
      console.log("[handleRegenerate] mode=%s shouldSaveAsNext=%s currentIsStale=%s currentStartDate=%s currentValidUntil=%s newPlanStartDate=%s",
        mode, shouldSaveAsNext, currentIsStale,
        plan?.startDate ?? "-", plan?.validUntil ?? "-", next.startDate ?? "-");
      if (shouldSaveAsNext) {
        await saveNextPlan(next);
        title = "✓ Prossima settimana pianificata in anteprima — il piano corrente resta attivo";
      } else {
        // rest-of-week (o next-week che sostituisce il corrente): se esiste un
        // nextPlan pendente, lo invalidiamo. Il rest-of-week ridefinisce la
        // settimana corrente e il next preview è basato su premesse pre-rest
        // ormai sorpassate. L'utente potrà rigenerarlo se vuole.
        if (mode === "rest-of-week") {
          await clearNextPlan().catch(() => { /* best-effort */ });
        }
        await savePlanWithHistory(next);
      }
      events.emit("plan:updated", { at: new Date().toISOString() });
      // mountedRef guard: generazione piano può durare 20-30s. Se l'utente
      // ha cambiato tab nel frattempo il componente è smontato — non fare setState.
      if (!mountedRef.current) return;
      if (shouldSaveAsNext) {
        setNextPlan(next);
      } else {
        setPlan(next);
        setNextPlan(null);
      }
      showSuccess(title, next.rationale);
    } catch (e) {
      if (!mountedRef.current) return;
      setRegenError(translateGeminiError(e));
    }
    if (!mountedRef.current) return;
    setRegenerating(false);
  };

  // Sprint H (2026-06-09): adattamento VINCOLATO al macroprogramma. Riparte
  // dalla proiezione FEDELE, chiede a Gemini un diff limitato e lo valida contro
  // lo scheletro del macro. Usato dal banner eventi e dal path "Adatta" quando
  // c'è un macro attivo. A differenza di adaptPlan, NON può divergere dal macro.
  const handleAdaptMacro = async (opts: { userRequest?: string; includeDeviations?: boolean }) => {
    if (adapting || regenerating || !plan) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setAdaptError("Offline. Riconnettiti per adattare il piano.");
      return;
    }
    setAdapting(true);
    setAdaptError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      if (!profile) throw new Error("Profilo mancante.");
      const weekEvents = gatherWeekEvents({
        recentDays,
        readinessBand,
        deviationEvents: opts.includeDeviations ? buildDeviationEvents() : undefined,
        userRequest: opts.userRequest,
      });
      const res = await adaptMacroWeek(profile, weekEvents);
      if (!res) { setAdaptError("Programma non disponibile per l'adattamento."); return; }
      await savePlanWithHistory(res.plan);
      events.emit("plan:updated", { at: new Date().toISOString() });
      if (!mountedRef.current) return;
      setPlan(res.plan);
      setAdaptRequest("");
      setAdaptOpen(false);
      setEventsBannerDismissed(true);
      const n = res.applied.length;
      const title = n > 0
        ? `✓ Settimana adattata al programma — ${n} modific${n === 1 ? "a" : "he"}`
        : "✓ Settimana già fedele al programma — nessuna modifica necessaria";
      showSuccess(title, res.plan.rationale);
    } catch (e) {
      if (!mountedRef.current) return;
      setAdaptError(translateGeminiError(e));
    }
    if (!mountedRef.current) return;
    setAdapting(false);
  };

  const handleAdapt = async (requestText?: string) => {
    const req = (requestText ?? adaptRequest).trim();
    if (!req || adapting || !plan) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setAdaptError("Offline. Riconnettiti per adattare il piano.");
      return;
    }
    // Macro attivo → adattatore vincolato (diff sul macro). Altrimenti adaptPlan legacy.
    if (plan.sourceMacro) {
      void handleAdaptMacro({ userRequest: req });
      return;
    }
    setAdapting(true);
    setAdaptError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      if (!profile) throw new Error("Profilo mancante.");
      const ctx = await buildCoachContext({ daysBack: 14 });
      const next = await adaptPlan(profile, goals, plan, ctx.recentDaysText, req);
      await savePlanWithHistory(next);
      events.emit("plan:updated", { at: new Date().toISOString() });
      // Stesso guard di handleRegenerate: adapt può durare 15-30s.
      if (!mountedRef.current) return;
      setPlan(next);
      setAdaptRequest("");
      setAdaptOpen(false);
      showSuccess(`✓ Piano adattato — "${req}"`, next.rationale);
    } catch (e) {
      if (!mountedRef.current) return;
      setAdaptError(translateGeminiError(e));
    }
    if (!mountedRef.current) return;
    setAdapting(false);
  };

  // Sprint K (2026-06-09): sostituzione di una SINGOLA sessione (es. partita che
  // non puoi fare). Applica le op al piano CORRENTE (no re-proiezione → preserva
  // gli altri adattamenti della settimana). Deterministico per il menu curato.
  const persistAdapted = async (res: ApplyResult): Promise<boolean> => {
    if (!plan?.weeks[0]) return false;
    if (res.applied.length === 0) {
      setAdaptError("Nessuna modifica applicata" + (res.rejected[0] ? `: ${res.rejected[0].reason}` : "."));
      return false;
    }
    const next: TrainingPlan = {
      ...plan,
      weeks: [{ ...plan.weeks[0], sessions: res.sessions }],
      sourceMacro: plan.sourceMacro
        ? { ...plan.sourceMacro, adaptations: [...plan.sourceMacro.adaptations, ...res.applied] }
        : plan.sourceMacro,
    };
    await savePlanWithHistory(next);
    events.emit("plan:updated", { at: new Date().toISOString() });
    if (!mountedRef.current) return true;
    setPlan(next);
    setSubMenuKey(null); setSubAltroOpen(false); setSubAltroText("");
    showSuccess("✓ Sessione sostituita", res.applied.join(" "));
    return true;
  };

  // Menu curato (deterministico, no LLM): applica un'alternativa pre-vetted.
  const handleSubstitute = async (ops: AdaptationOp[]) => {
    if (!plan?.weeks[0] || adapting || regenerating) return;
    setAdapting(true); setAdaptError(null);
    try {
      const ctx: AdaptContext = { program: null, weekNumber: plan.sourceMacro?.weekNumber ?? 1, readinessBand };
      const res = applyAdaptationDiff(plan.weeks[0].sessions, { ops, summary: "" }, ctx);
      await persistAdapted(res);
    } catch (e) {
      if (mountedRef.current) setAdaptError(translateGeminiError(e));
    }
    if (mountedRef.current) setAdapting(false);
  };

  // "Altro": Gemini propone una substituteSession con guardrail (stesso stimolo
  // della fase, durata simile), validata da applyAdaptationDiff.
  const handleSubstituteAltro = async (s: PlannedSession) => {
    if (!plan?.weeks[0] || adapting || regenerating) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setAdaptError("Offline. Riconnettiti per chiedere un'alternativa."); return;
    }
    setAdapting(true); setAdaptError(null);
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const program = await loadActiveMacroProgram().catch(() => null);
      if (!program) throw new Error("Programma non disponibile.");
      const weekNumber = plan.sourceMacro?.weekNumber ?? 1;
      const note = subAltroText.trim();
      const evt: WeekEvent = {
        kind: "user_request",
        day: s.day as WeekEvent["day"],
        detail: `Non posso fare la sessione di ${s.day} (${s.type}${s.subtype ? ` ${s.subtype}` : ""}). ${note || "Proponi un'alternativa equivalente."} Usa substituteSession con lo stesso stimolo della fase e durata simile.`,
      };
      const diff = await generateAdaptationDiff({ sessions: plan.weeks[0].sessions, events: [evt], program, weekNumber, profile, readinessBand });
      const ops = (diff.ops as AdaptationOp[]).filter(o => o.day === s.day);
      if (ops.length === 0) throw new Error("Il coach non ha proposto un'alternativa applicabile. Riprova con piu' dettagli.");
      const ctx: AdaptContext = { program, weekNumber, readinessBand };
      const res = applyAdaptationDiff(plan.weeks[0].sessions, { ops, summary: "" }, ctx);
      await persistAdapted(res);
    } catch (e) {
      if (mountedRef.current) setAdaptError(translateGeminiError(e));
    }
    if (mountedRef.current) setAdapting(false);
  };

  const regenerateBtn = (
    <button
      onClick={() => handleRegenerate("next-week")}
      disabled={regenerating}
      aria-busy={regenerating || undefined}
      role={regenerating ? "status" : undefined}
      aria-label={regenerating ? "Rigenerazione piano in corso" : undefined}
      style={{
        padding: "10px 14px",
        background: regenerating ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
        border: "none", borderRadius: "10px", color: "#FFF",
        fontSize: "13px", fontWeight: 700,
        cursor: regenerating ? "wait" : "pointer",
        opacity: regenerating ? 0.5 : 1,
        width: "100%",
      }}
    >
      {regenerating
        ? <span role="progressbar" aria-label={`Generazione in corso — ${llmElapsedSec} secondi`} aria-busy="true">⏳ Generazione… {llmElapsedSec}s</span>
        : "🎯 Genera piano"}
    </button>
  );

  if (!plan) {
    // Empty state "no plan": preserva il regenerateBtn esistente (che gestisce
    // generazione + label dinamica "Genera piano") wrappato in card dashed
    // coerente con EmptyState helper. Non usiamo <EmptyState> diretto perché
    // il bottone CTA qui ha logica complessa (busy state, error inline) che
    // non è generalizzabile a prop semplici.
    return (
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "24px 20px", border: "1px dashed rgba(255,255,255,0.12)", textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }} aria-hidden>🗺</div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "#CBD5E1", marginBottom: "6px" }}>Nessun piano attivo</div>
        <div style={{ fontSize: "13px", color: "#94A3B8", marginBottom: "16px", lineHeight: 1.5 }}>
          Genera il primo piano: il coach lo costruisce sul tuo profilo, equipment e obiettivi.
        </div>
        {regenerateBtn}
        {regenError && <div style={{ color: "#EF4444", fontSize: "12px", marginTop: "10px" }}>{regenError}</div>}
      </div>
    );
  }

  const todayDate = new Date();
  const DAY_MAP = ["dom","lun","mar","mer","gio","ven","sab"];
  const todayKey = DAY_MAP[todayDate.getDay()];

  // Formatta il range "start - start+6gg" in italiano. Gestisce cross-month/year.
  const formatWeekRange = (startISO: string | undefined): string => {
    if (!startISO) return "";
    try {
      const [y, m, d] = startISO.split("-").map(Number);
      const start = new Date(y, m - 1, d);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
      const sameYear = start.getFullYear() === end.getFullYear();
      const monthFmt = (dt: Date) => dt.toLocaleDateString("it-IT", { month: "long" });
      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      if (sameMonth) {
        return `${start.getDate()}-${end.getDate()} ${capitalize(monthFmt(start))} ${start.getFullYear()}`;
      }
      if (sameYear) {
        return `${start.getDate()} ${capitalize(monthFmt(start))} - ${end.getDate()} ${capitalize(monthFmt(end))} ${end.getFullYear()}`;
      }
      return `${start.getDate()} ${capitalize(monthFmt(start))} ${start.getFullYear()} - ${end.getDate()} ${capitalize(monthFmt(end))} ${end.getFullYear()}`;
    } catch { return ""; }
  };

  // Se il piano ha startDate, calcoliamo in quale settimana siamo "oggi" rispetto al piano.
  // Altrimenti fallback legacy: week 1 == settimana corrente.
  const todayPlanWeekNumber = (() => {
    if (!plan.startDate) return 1;
    const [y, m, d] = plan.startDate.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const diffDays = Math.floor((todayDate.getTime() - start.getTime()) / (24 * 3600 * 1000));
    if (diffDays < 0) return 0; // piano non ancora iniziato
    return Math.floor(diffDays / 7) + 1; // 1-based
  })();

  // "Chiedi al coach": persiste il prompt in storage + emette eventi.
  // Storage prima di event: CoachChat al mount legge "pending-chat-prompt"
  // (stesso pattern di diary:openAdd), evita race con sub-tab switch in CoachPage.
  const askCoachAboutSession = (s: PlannedSession, weekNumber: number) => {
    const zoneStr = (() => {
      const chip = zoneChipFor(s);
      return chip ? ` (Z${chip.idx}, ${chip.low}-${chip.high} bpm)` : "";
    })();
    const prompt = [
      `Parlami della sessione pianificata per ${s.day} (settimana ${weekNumber}):`,
      `${s.type}${s.subtype ? ` · ${s.subtype}` : ""}, ${s.duration_min} minuti${zoneStr}.`,
      s.details ? `Dettagli: ${stripInlineHRRange(s.details)}` : "",
      `Cosa mi stai chiedendo esattamente? Come dovrei sentirmi durante/dopo? Come si collega ai miei obiettivi?`,
    ].filter(Boolean).join("\n");
    void setJSON("pending-chat-prompt", { prompt });
    events.emit("chat:openWith", { prompt });
    events.emit("nav:goto", { tab: "coach" });
  };

  // Apre il diario in modalità "nuovo allenamento" pre-compilato con durata,
  // subtype (mappato al campo "tipo" del workout type) e note dal coach.
  // La data è calcolata dal piano (startDate + weekOffset + dayIndex).
  const registerFromPlan = (session: TrainingPlan["weeks"][number]["sessions"][number], weekNumber: number) => {
    const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
    let targetDate: string | undefined;
    if (plan?.startDate) {
      const dayIdx = DAY_KEYS.indexOf(session.day);
      if (dayIdx >= 0) {
        const [sy, sm, sd] = plan.startDate.split("-").map(Number);
        const d = new Date(sy, sm - 1, sd);
        d.setDate(d.getDate() + (weekNumber - 1) * 7 + dayIdx);
        const y = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        targetDate = `${y}-${mm}-${dd}`;
      }
    }
    // corsa usa durata_totale, altri tipi usano durata
    const durationField = session.type === "corsa" ? "durata_totale" : "durata";
    const prefill: Record<string, any> = { [durationField]: session.duration_min };
    if (session.subtype) prefill.subtype = session.subtype;
    const notes = [
      `📋 Dal piano del coach:`,
      stripInlineHRRange(session.details),
      "",
      `Razionale: ${session.rationale}`,
    ].join("\n");
    const payload = { type: session.type, date: targetDate, prefill, notes };
    // Persisti il payload PRIMA di emettere l'evento: se l'utente è sul tab Coach
    // e il DiaryApp non è ancora montato, l'evento si perderebbe. DiaryApp legge
    // pending-diary-openAdd al mount e consuma il payload.
    void setJSON("pending-diary-openAdd", payload);
    events.emit("diary:openAdd", payload);
  };

  // Calcola giorni rimanenti al piano
  const validUntilDate = new Date(plan.validUntil);
  const daysLeft = Math.max(0, Math.round((validUntilDate.getTime() - Date.now()) / (24 * 3600 * 1000)));
  const isExpiringSoon = daysLeft <= 3;
  const isExpired = daysLeft === 0;

  // Fix 1 — Banner "piano scaduto" + render grigio.
  // Se l'utente non apre l'app da >7gg, plan.startDate è la settimana già
  // passata: parsing locale (no UTC off-by-one), confronto a mezzanotte
  // locale per evitare flicker durante il giorno.
  const isPlanStale = (() => {
    if (!plan?.startDate) return false;
    const start = parseISODateLocal(plan.startDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
    return now.getTime() > start.getTime() + SEVEN_DAYS_MS;
  })();
  // Stile "grigio" applicato al wrapper delle settimane quando stale:
  // opacity 0.55 + grayscale 0.4 → visivamente chiaro che è "vecchio".
  const staleWeeksStyle = isPlanStale
    ? { opacity: 0.55, filter: "grayscale(0.4)" }
    : undefined;

  const rationaleBullets = rationaleToBullets(plan.rationale);
  const isMultiBullet = rationaleBullets.length > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Banner success → ora via NotificationHost popup (vedi showSuccess) */}

      {/* Wave 4.3 — Banner readiness (low/high di oggi) + macro updated.
          Stanno IN CIMA al tab Plan: top-of-funnel awareness prima dei dettagli
          settimana. ReadinessBanner si auto-mute per band="moderate" o assenza
          snapshot. MacroUpdatedBanner è dismissibile per macroId. */}
      <ReadinessBanner />
      <MacroUpdatedBanner onRegenerate={() => handleRegenerate("next-week")} />
      {/* Sprint N: StatoPiano — UN solo banner di stato a priorità (danger >
          attention). Con l'auto-proiezione macro (Sprint M) gli stati da drift
          settimanale non scattano se c'è un programma attivo → con macro il
          banner resta assente. Resta per piani senza macro o realmente scaduti.
          CTA unica → apre il picker di aggiornamento. */}
      {(() => {
        if (isExpired) {
          return (
            <StatoBanner
              tone="danger"
              title="Piano scaduto"
              body="Il microciclo è terminato: rigenera per riallinearti alla settimana corrente."
              cta="Rigenera ora"
              busyLabel={`⏳ Rigenerazione… ${llmElapsedSec}s`}
              onCta={() => { setRegenPickerOpen(true); setAdaptOpen(false); }}
              disabled={regenerating}
            />
          );
        }
        const reasons: string[] = [];
        if (isPlanStale && plan.startDate) reasons.push("piano di una settimana passata");
        if (isExpiringSoon) reasons.push(`in scadenza tra ${daysLeft} giorni`);
        if (profileDrift) reasons.push("profilo/obiettivi cambiati dopo la generazione");
        if (reasons.length === 0) return null;
        const body = `${reasons[0].charAt(0).toUpperCase()}${reasons[0].slice(1)}${reasons.length > 1 ? ` (+${reasons.length - 1})` : ""}. Aggiorna per riallinearti.`;
        return (
          <StatoBanner
            tone="attention"
            title="Piano da aggiornare"
            body={body}
            cta="Aggiorna piano"
            onCta={() => { setRegenPickerOpen(true); setAdaptOpen(false); }}
            disabled={regenerating}
          />
        );
      })()}

      {/* Sprint B (2026-05-27): indicatore concordanza col macroprogramma.
          Se il piano è proiettato dal macro (sourceMacro), mostralo esplicito:
          "Da programma · Settimana N · Fase X" + eventuali adattamenti daily.
          Risolve "il piano non concorda col .md": la provenienza è visibile. */}
      {/* Sprint L: "Settimana N · Fase" vive SOLO nell'header programma (PlanTab).
          Qui resta solo lo STATO settimana: gli adattamenti, e solo se ce ne sono
          (collassati). Se la settimana è fedele, nessuna card → meno rumore. */}
      {plan.sourceMacro && plan.sourceMacro.adaptations.length > 0 && (
        <details style={{
          background: "#F59E0B12", border: "1px solid #F59E0B44",
          borderRadius: "12px", padding: "10px 14px",
        }}>
          <summary style={{
            cursor: "pointer", listStyle: "none",
            fontSize: "12px", color: "#F59E0B", fontWeight: 700,
            display: "flex", alignItems: "center", gap: "6px", userSelect: "none",
          }}>
            <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', monospace" }}>▸</span>
            ⚙ {plan.sourceMacro.adaptations.length} adattament{plan.sourceMacro.adaptations.length === 1 ? "o" : "i"} alla settimana
          </summary>
          <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: "11px", color: "#CBD5E1", lineHeight: 1.6 }}>
            {plan.sourceMacro.adaptations.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>
      )}

      {/* Sprint H (2026-06-09): banner PROATTIVO eventi. Quando c'è un macro
          attivo e si rilevano eventi (sessioni saltate, dolore, readiness,
          variazioni), proponiamo l'adattamento VINCOLATO. L'LLM scatta solo se
          l'utente conferma ("Entrambi": auto-rileva + segnala, applica su OK). */}
      {plan.sourceMacro && pendingEvents.length > 0 && !eventsBannerDismissed && !adapting && (
        <div style={{
          background: "linear-gradient(135deg, #F59E0B18 0%, #E8553A12 100%)",
          border: "1px solid #F59E0B66",
          borderRadius: "12px", padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: "10px",
        }}>
          <div style={{ fontSize: "12px", color: "#F59E0B", fontWeight: 700 }}>
            ⚡ {pendingEvents.length} evento{pendingEvents.length === 1 ? "" : " (i)"} nella settimana
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>
            {pendingEvents.slice(0, 4).map((e, i) => <li key={i}>{e.detail}</li>)}
            {pendingEvents.length > 4 && <li>+{pendingEvents.length - 4} altri</li>}
          </ul>
          <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.5 }}>
            Il coach può adattare la settimana restando fedele al programma (sposta / scala / sostituisce, senza stravolgere lo scheletro).
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={() => void handleAdaptMacro({ includeDeviations: true })}
              disabled={adapting || regenerating}
              style={{
                padding: "9px 14px",
                background: "linear-gradient(135deg, #E8553A 0%, #D4452F 100%)",
                border: "none", borderRadius: "9px", color: "#FFF",
                fontSize: "13px", fontWeight: 700, cursor: "pointer", flex: 1, minWidth: "140px",
              }}
            >🔧 Adatta al programma</button>
            <button
              onClick={() => setEventsBannerDismissed(true)}
              disabled={adapting || regenerating}
              style={{
                padding: "9px 14px", background: "transparent",
                border: "1px solid rgba(255,255,255,0.15)", borderRadius: "9px",
                color: "#94A3B8", fontSize: "13px", fontWeight: 600, cursor: "pointer",
              }}
            >Mantieni fedele</button>
          </div>
        </div>
      )}

      {/* Sprint M: ZonesCard Z2 rimossa dal tab Piano — le zone-target sono già
          nei chip inline di ogni sessione cardio, e la reference Z1-Z5 completa
          vive in Coach → Tools → Zone FC. Una sola fonte, meno doppioni. */}

      {/* Razionale piano — collassato di default (Sprint L: riduce l'altezza
          prima delle sessioni; chi vuole il dettaglio lo apre). */}
      <details
        style={{
          background: "#16213E", borderRadius: "12px",
          border: "1px solid rgba(232, 85, 58, 0.2)",
          padding: "12px 16px",
        }}
      >
        <summary
          style={{
            cursor: "pointer", listStyle: "none",
            fontSize: "11px", color: "#E8553A",
            letterSpacing: "0.12em", textTransform: "uppercase",
            fontWeight: 800, minHeight: "24px",
            display: "flex", alignItems: "center", gap: "6px",
            userSelect: "none",
          }}
        >
          <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', monospace" }}>▸</span>
          Razionale del piano
        </summary>
        <div style={{ marginTop: "10px" }}>
          {isMultiBullet ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
              {rationaleBullets.map((b, i) => (
                <li key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "13px", lineHeight: 1.5, color: "#E2E8F0" }}>
                  <span aria-hidden="true" style={{
                    width: "5px", height: "5px", borderRadius: "999px",
                    background: "#E8553A", marginTop: "8px", flexShrink: 0,
                  }} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: "13px", lineHeight: 1.5, color: "#E2E8F0" }}>{plan.rationale}</div>
          )}
        </div>
      </details>

      {/* (Banner scaduto/in-scadenza consolidato in StatoPiano, in cima.) */}

      {/* Banner anteprima prossima settimana — visibile se nextPlan esiste */}
      {nextPlan && (
        <div style={{
          background: "linear-gradient(135deg, #1E3A8A30 0%, #1E40AF20 100%)",
          border: "1px solid #3B82F666",
          borderRadius: "12px", padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div aria-hidden="true" style={{
              width: "32px", height: "32px", borderRadius: "8px",
              background: "rgba(59, 130, 246, 0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "16px", flexShrink: 0,
            }}>📅</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "11px", color: "#93C5FD", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "2px" }}>
                Anteprima prossima settimana
              </div>
              <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.4 }}>
                {formatWeekRange(nextPlan.startDate)} · {nextPlan.weeks?.[0]?.sessions?.length || 0} sessioni pianificate
              </div>
              {nextPlanDrift && (
                <div style={{ fontSize: "11px", color: "#F59E0B", marginTop: "4px", fontWeight: 600 }}>
                  ⚠ Profilo cambiato dopo la generazione — rigenera per aggiornare
                </div>
              )}
            </div>
            <button
              onClick={() => setViewingNext((v: boolean) => !v)}
              style={{
                padding: "7px 12px",
                background: viewingNext ? "#3B82F640" : "transparent",
                border: "1px solid #3B82F666",
                borderRadius: "8px",
                color: "#93C5FD", fontSize: "12px", fontWeight: 700,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >{viewingNext ? "Nascondi" : "Mostra"}</button>
          </div>
          {viewingNext && (
            <>
              {/* Render compatto sessioni del preview, riusa lo stile del piano principale */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingTop: "4px" }}>
                {nextPlan.weeks?.[0]?.sessions?.map((s: PlannedSession, i: number) => {
                  const dayIdx = ["lun","mar","mer","gio","ven","sab","dom"].indexOf(s.day);
                  let dateLabel = "";
                  if (nextPlan.startDate && dayIdx >= 0) {
                    const [y, m, d] = nextPlan.startDate.split("-").map(Number);
                    const dt = new Date(y, m-1, d);
                    dt.setDate(dt.getDate() + dayIdx);
                    dateLabel = `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}`;
                  }
                  return (
                    <div key={i} style={{
                      padding: "8px 10px", background: "#0F172A",
                      border: "1px solid rgba(59, 130, 246, 0.2)",
                      borderRadius: "8px", fontSize: "12px",
                      display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap",
                    }}>
                      <span style={{ fontWeight: 700, textTransform: "uppercase", color: "#93C5FD", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "62px" }}>
                        {s.day}{dateLabel ? ` ${dateLabel}` : ""}
                      </span>
                      <span style={{ fontWeight: 600, color: "#E2E8F0" }}>{s.type}{s.subtype ? ` · ${s.subtype}` : ""}</span>
                      <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>{s.duration_min}min</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                <button
                  onClick={async () => {
                    if (confirm("Eliminare la pianificazione della prossima settimana? Potrai rigenerarla in qualsiasi momento.")) {
                      await clearNextPlan();
                      setNextPlan(null);
                      setViewingNext(false);
                    }
                  }}
                  style={{
                    padding: "7px 12px", background: "transparent",
                    border: "1px solid rgba(239, 68, 68, 0.4)", borderRadius: "8px",
                    color: "#FCA5A5", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                  }}
                >🗑 Scarta preview</button>
                <div style={{ flex: 1, fontSize: "11px", color: "#94A3B8", lineHeight: 1.4, alignSelf: "center" }}>
                  Diventerà il piano corrente automaticamente lun {formatWeekRange(nextPlan.startDate).split(" ")[0]}.
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* (Banner "profilo cambiato" consolidato in StatoPiano, in cima.) */}

      {/* UX redesign #4 (2026-05-14) — Bottone smart con dettaglio + link
          "Altre opzioni" che apre il picker tradizionale.
          Principio: focalizza SEMPRE sulla settimana in corso. Il bottone
          primario è sempre `rest-of-week` (anche al sabato/domenica con
          pochi giorni rimasti). "Pianifica prossima settimana" sta solo
          nelle "Altre opzioni" (tendina chiusa) — l'utente la cerca solo
          in casi specifici, non vale la pena offrirla come default.
          Se rest-of-week + ci sono deviazioni → useAdapt=true, va via
          handleAdapt(buildDeviationRequest). 'Adatta alle deviazioni' non
          è più una scelta separata, è integrata nel default smart. */}
      {!isExpired && (() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayIdx = (today.getDay() + 6) % 7;
        const labels = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
        const formatDay = (d: Date) => `${labels[(d.getDay() + 6) % 7]} ${d.getDate()}`;
        const totalDev = deviationCount.skipped + deviationCount.partial + deviationCount.extras;
        const restEnd = new Date(today); restEnd.setDate(today.getDate() + (6 - todayIdx));
        const remainLabels = labels.slice(todayIdx);
        const remainSessions = plan.weeks[0]?.sessions.filter(s => remainLabels.includes(s.day)) ?? [];
        // Sprint L: se il banner eventi è visibile (macro + eventi pendenti), è
        // LUI l'entry-point per adattare → il bottone smart resta "rigenera" per
        // non duplicare la stessa azione.
        const eventsBannerVisible = !!plan.sourceMacro && pendingEvents.length > 0 && !eventsBannerDismissed;
        const useAdapt = totalDev > 0 && !eventsBannerVisible;
        const smartRegen = {
          mode: "rest-of-week" as const,
          useAdapt,
          icon: useAdapt ? "🔧" : "🔁",
          label: useAdapt ? "Adatta piano alle deviazioni" : "Aggiorna giorni rimanenti",
          sub1: todayIdx === 6
            ? `solo ${formatDay(today)} (settimana quasi conclusa)`
            : `${formatDay(today)} → ${formatDay(restEnd)} (${remainSessions.length} session${remainSessions.length === 1 ? "e" : "i"})`,
          sub2: useAdapt ? `integra ${totalDev} deviazion${totalDev === 1 ? "e" : "i"}` : null,
        };
        const doSmartAction = () => {
          if (regenerating || adapting) return;
          setAdaptOpen(false);
          if (smartRegen.useAdapt) {
            // Macro attivo → adattatore vincolato (deviazioni strutturate).
            if (plan.sourceMacro) void handleAdaptMacro({ includeDeviations: true });
            else void handleAdapt(buildDeviationRequest());
          } else {
            void handleRegenerate(smartRegen.mode);
          }
        };
        return (
        <div style={{ background: "#16213E", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.06)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {!regenPickerOpen ? (
            <>
              <button
                onClick={doSmartAction}
                disabled={regenerating || adapting}
                aria-busy={regenerating || adapting || undefined}
                role={regenerating || adapting ? "status" : undefined}
                aria-label={regenerating ? "Rigenerazione piano in corso" : adapting ? "Adattamento piano in corso" : `${smartRegen.label} — ${smartRegen.sub1}${smartRegen.sub2 ? ` · ${smartRegen.sub2}` : ""}`}
                style={{
                  padding: "14px 18px", minHeight: "48px",
                  background: (regenerating || adapting) ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
                  border: "none", borderRadius: "10px",
                  color: "#FFF", fontSize: "14px", fontWeight: 700,
                  cursor: (regenerating || adapting) ? "wait" : "pointer",
                  opacity: (regenerating || adapting) ? 0.5 : 1,
                  width: "100%", textAlign: "left",
                  display: "flex", flexDirection: "column", gap: "2px",
                }}
              >
                {(regenerating || adapting) ? (
                  <span role="progressbar" aria-busy="true">⏳ {regenerating ? "Rigenerazione" : "Adatto piano"}… {llmElapsedSec}s</span>
                ) : (
                  <>
                    <span style={{ fontSize: "14px", fontWeight: 700 }}>{smartRegen.icon} {smartRegen.label}</span>
                    <span style={{ fontSize: "12px", fontWeight: 500, opacity: 0.92 }}>{smartRegen.sub1}</span>
                    {smartRegen.sub2 && (
                      <span style={{ fontSize: "11px", fontWeight: 500, opacity: 0.85 }}>{smartRegen.sub2}</span>
                    )}
                  </>
                )}
              </button>
              <button
                onClick={() => { setRegenPickerOpen(true); setAdaptOpen(false); }}
                disabled={regenerating || adapting}
                style={{
                  alignSelf: "flex-end", padding: "6px 10px",
                  background: "transparent", border: "none",
                  color: "#94A3B8", fontSize: "12px", fontWeight: 600,
                  cursor: (regenerating || adapting) ? "wait" : "pointer",
                  textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "3px",
                }}
                aria-label="Mostra altre opzioni di rigenerazione"
              >
                Altre opzioni →
              </button>
            </>
          ) : (
            <button
              onClick={() => setRegenPickerOpen(false)}
              disabled={regenerating || adapting}
              style={{
                padding: "10px 14px", minHeight: "44px",
                background: "#0891B222", border: "1px solid #0891B2",
                borderRadius: "10px", color: "#0891B2",
                fontSize: "13px", fontWeight: 700, cursor: "pointer",
                width: "100%",
              }}
            >✕ Chiudi opzioni</button>
          )}

          {regenPickerOpen && !regenerating && (() => {
            const today = new Date();
            const dow = today.getDay(); // 0=dom..6=sab
            const todayIdx = (dow + 6) % 7; // 0=lun..6=dom
            const labels = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
            const todayLabel = labels[todayIdx];
            const remaining = labels.slice(todayIdx);
            // Mostra "rest-of-week" lun-sab. Su lunedì copre l'intera settimana
            // corrente (lun→dom). Su domenica non ha senso (solo 1 giorno).
            const showRestOfWeek = todayIdx >= 0 && todayIdx <= 5;
            // Toggle giorno nel picker. Stato locale, non persiste — è override
            // SOLO per la prossima generazione.
            const togglePickerDay = (d: string) => {
              setPickerDays(prev => {
                const cur = prev || [];
                return cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d];
              });
            };
            // Reset al default profilo (utility quando l'utente ha smanettato troppo).
            const resetToProfile = () => {
              const def = currentProfile?.availableDays;
              if (def && def.length > 0) setPickerDays([...def]);
              else setPickerDays(["lun","mar","mer","gio","ven","sab","dom"]);
            };
            // Per "Riparti da oggi" mostra in evidenza i giorni rimanenti che
            // rientrano nella selezione (intersezione).
            const remainingActive = (pickerDays || []).filter(d => remaining.includes(d));
            const noDaysSelected = !pickerDays || pickerDays.length === 0;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "6px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "12px", color: "#CBD5E1", fontWeight: 600 }}>Giorni allenabili questa settimana</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {labels.map(d => {
                    const active = (pickerDays || []).includes(d);
                    return (
                      <button
                        key={d}
                        onClick={() => togglePickerDay(d)}
                        aria-pressed={active}
                        style={{
                          padding: "8px 12px", minWidth: "44px",
                          background: active ? "#0891B225" : "#1A1A2E",
                          border: active ? "1px solid #0891B266" : "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "999px",
                          color: active ? "#38BDF8" : "#94A3B8",
                          fontSize: "12px", fontWeight: 700, cursor: "pointer",
                          fontFamily: "'JetBrains Mono', monospace",
                          textTransform: "uppercase",
                        }}
                      >{d}</button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.4 }}>
                    {currentProfile?.availableDays && currentProfile.availableDays.length > 0
                      ? <>Default profilo: <b>{currentProfile.availableDays.join(", ")}</b>. Questa scelta è solo per la prossima generazione.</>
                      : "Nessun default impostato. Configurarlo in Impostazioni → Profilo per pre-selezione automatica."}
                  </div>
                  <button
                    onClick={resetToProfile}
                    style={{
                      padding: "5px 10px", background: "transparent",
                      border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
                      color: "#94A3B8", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                    }}
                  >↺ Reset</button>
                </div>

                <div style={{ fontSize: "12px", color: "#CBD5E1", fontWeight: 600, marginTop: "4px" }}>Come vuoi rigenerare?</div>
                {showRestOfWeek && (
                  <button
                    onClick={() => handleRegenerate("rest-of-week", pickerDays)}
                    disabled={noDaysSelected || remainingActive.length === 0}
                    style={{
                      textAlign: "left", padding: "12px 14px",
                      background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "10px", color: "#E2E8F0",
                      cursor: (noDaysSelected || remainingActive.length === 0) ? "not-allowed" : "pointer",
                      opacity: (noDaysSelected || remainingActive.length === 0) ? 0.5 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: "13px", color: "#0891B2", marginBottom: "3px" }}>
                      ▶ Riparti da oggi
                    </div>
                    <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.4 }}>
                      {remainingActive.length === 0
                        ? `Nessuno dei giorni selezionati rientra nei rimanenti (${remaining.join(", ")}).`
                        : `Genera fino a ${remainingActive.length} sessione/i in ${remainingActive.join(", ")}. I giorni passati restano chiusi.`}
                    </div>
                  </button>
                )}
                <button
                  onClick={() => handleRegenerate("next-week", pickerDays)}
                  disabled={noDaysSelected}
                  style={{
                    textAlign: "left", padding: "12px 14px",
                    background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "10px", color: "#E2E8F0",
                    cursor: noDaysSelected ? "not-allowed" : "pointer",
                    opacity: noDaysSelected ? 0.5 : 1,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "#0891B2", marginBottom: "3px" }}>
                    ▶ Pianifica settimana prossima
                  </div>
                  <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.4 }}>
                    {noDaysSelected
                      ? "Seleziona almeno un giorno sopra."
                      : `Genera fino a ${(pickerDays || []).length} sessione/i tra: ${(pickerDays || []).join(", ")}.`}
                    {!showRestOfWeek && ` (Oggi è ${todayLabel}, l'opzione "riparti" non è disponibile.)`}
                  </div>
                </button>
                {/* UX redesign #3 — terza opzione nel picker: "Adatta alle
                    deviazioni". Mostrata solo se hasDeviations, scorciatoia
                    al flusso adapt con buildDeviationRequest. Coerente con il
                    pattern degli altri item (titolo amber + dettaglio sub).
                    Non passa per il day picker (le deviazioni hanno già scope
                    di settimana corrente). */}
                {hasDeviations && (
                  <button
                    onClick={() => { setRegenPickerOpen(false); void handleAdapt(buildDeviationRequest()); }}
                    disabled={adapting || regenerating}
                    style={{
                      textAlign: "left", padding: "12px 14px",
                      background: "#1A1A2E", border: "1px solid rgba(245, 158, 11, 0.35)",
                      borderRadius: "10px", color: "#E2E8F0",
                      cursor: (adapting || regenerating) ? "wait" : "pointer",
                      opacity: (adapting || regenerating) ? 0.5 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: "13px", color: "#F59E0B", marginBottom: "3px" }}>
                      ▶ Adatta alle deviazioni
                    </div>
                    <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.4 }}>
                      Riallinea le sessioni future a quello che hai realmente fatto: {[
                        deviationCount.skipped > 0 ? `${deviationCount.skipped} saltate` : "",
                        deviationCount.partial > 0 ? `${deviationCount.partial} variate` : "",
                        deviationCount.extras > 0 ? `${deviationCount.extras} autonomi` : "",
                      ].filter(Boolean).join(" · ")}.
                    </div>
                  </button>
                )}
                <button
                  onClick={() => setRegenPickerOpen(false)}
                  style={{
                    alignSelf: "flex-start", padding: "8px 14px",
                    background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "10px", color: "#94A3B8", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                  }}
                >Annulla</button>
              </div>
            );
          })()}
          {regenError && <div style={{ color: "#EF4444", fontSize: "12px" }}>{regenError}</div>}
        </div>
        );
      })()}

      {/* UX redesign #3 — Opzioni avanzate: "Adatta con richiesta" free-text
          spostato qui in <details> chiuso di default. L'utente principale
          orienta a picker primario; questo resta accessibile come escape
          hatch per modifiche puntuali (es. "settimana di deload"). */}
      {!isExpired && (
        <details style={{ background: "#16213E", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <summary
            style={{
              cursor: "pointer", listStyle: "none",
              padding: "14px 18px", minHeight: "44px",
              fontSize: "12px", color: "#94A3B8",
              letterSpacing: "0.1em", textTransform: "uppercase",
              fontWeight: 700,
              display: "flex", alignItems: "center", gap: "8px",
              userSelect: "none",
            }}
          >
            <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "14px" }}>▸</span>
            Opzioni avanzate (adatta con richiesta)
          </summary>
          <div style={{ padding: "0 18px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <button onClick={() => { setAdaptOpen(o => !o); setAdaptError(null); }} disabled={adapting || regenerating} style={{ padding: "10px 14px", background: adaptOpen ? "#E8553A22" : "#1A1A2E", border: adaptOpen ? "1px solid #E8553A" : "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: adaptOpen ? "#E8553A" : "#E2E8F0", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
              ✏ Adatta con richiesta
            </button>
            {adaptOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>Dimmi cosa vuoi cambiare. Il coach rispetterà comunque le regole di sicurezza.</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {ADAPT_QUICK_PROMPTS.map(p => (<button key={p} onClick={() => setAdaptRequest(p)} disabled={adapting} style={{ padding: "10px 14px", minHeight: "40px", fontSize: "12px", background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px", color: "#CBD5E1", cursor: "pointer" }}>{p}</button>))}
                </div>
                <textarea value={adaptRequest} onChange={e => setAdaptRequest(e.target.value)} placeholder="es. 'settimana più leggera perché ho un viaggio' o 'aumenta le ripetute'" disabled={adapting} rows={2} style={{ width: "100%", padding: "10px 12px", background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", color: "#E2E8F0", fontSize: "14px", fontFamily: "inherit", resize: "vertical", minHeight: "60px", outline: "none", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => handleAdapt()} disabled={adapting || !adaptRequest.trim()} aria-busy={adapting || undefined} role={adapting ? "status" : undefined} aria-label={adapting ? "Adattamento piano in corso" : undefined} style={{ flex: 1, padding: "10px", background: adapting ? "#1E293B" : "linear-gradient(135deg, #E8553A 0%, #D44429 100%)", border: "none", borderRadius: "10px", color: "#FFF", fontSize: "13px", fontWeight: 700, cursor: adapting ? "wait" : "pointer", opacity: (adapting || !adaptRequest.trim()) ? 0.5 : 1 }}>
                    {adapting ? `⏳ Adatto il piano… ${llmElapsedSec}s` : "Applica modifica"}
                  </button>
                  <button onClick={() => { setAdaptOpen(false); setAdaptRequest(""); setAdaptError(null); }} disabled={adapting} style={{ padding: "10px 14px", background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "#94A3B8", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>Annulla</button>
                </div>
                {adaptError && <div style={{ color: "#EF4444", fontSize: "12px" }}>{adaptError}</div>}
              </div>
            )}
          </div>
        </details>
      )}

      {/* Fix 1 — Wrapper "grigio" delle sessioni della settimana quando il
          piano è stale (>7gg dal startDate). Visivamente chiaro che la
          settimana mostrata non è più quella corrente. */}
      <div style={staleWeeksStyle}>
      {!isExpired && plan.weeks.map((w: TrainingPlan["weeks"][number]) => {
        // Calcola la data di inizio della settimana (Mon) per il range header
        // e per le date assolute delle sessioni. plan.startDate è il lun della
        // weekNumber=1; +(weekNumber-1)*7 → lun della week corrente.
        let weekStartDate: Date | null = null;
        let weekRangeLabel = "";
        if (plan.startDate) {
          const [sy, sm, sd] = plan.startDate.split("-").map(Number);
          weekStartDate = new Date(sy, sm - 1, sd);
          weekStartDate.setDate(weekStartDate.getDate() + (w.weekNumber - 1) * 7);
          // formatWeekRange si aspetta ISO yyyy-mm-dd
          const iso = `${weekStartDate.getFullYear()}-${String(weekStartDate.getMonth()+1).padStart(2,"0")}-${String(weekStartDate.getDate()).padStart(2,"0")}`;
          weekRangeLabel = formatWeekRange(iso);
        }
        return (
        <div key={w.weekNumber} style={{ background: "#16213E", borderRadius: "14px", padding: "18px 20px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase" }}>Settimana {w.weekNumber}</div>
            {weekRangeLabel && (
              <div style={{ fontSize: "12px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                {weekRangeLabel}
              </div>
            )}
          </div>
          {w.focus && (
            <div style={{ fontSize: "13px", color: "#CBD5E1", fontWeight: 600, marginBottom: "12px" }}>{w.focus}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(() => {
              // Costruisce entries ordinate per giorno (lun-dom): sessioni pianificate
              // + allenamenti autonomi intervallati nel posto giusto.
              const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
              type PlannedEntry = { kind: "planned"; dayIdx: number; s: TrainingPlan["weeks"][number]["sessions"][number]; i: number };
              type ExtraEntry = { kind: "extra"; dayIdx: number; e: { date: string; workout: any }; i: number };
              const plannedEntries: PlannedEntry[] = w.sessions.map((s: TrainingPlan["weeks"][number]["sessions"][number], i: number) => ({
                kind: "planned", dayIdx: DAY_ORDER.indexOf(s.day), s, i,
              }));
              let extraEntries: ExtraEntry[] = [];
              if (plan.startDate) {
                const [sy, sm, sd] = plan.startDate.split("-").map(Number);
                const weekStart = new Date(sy, sm - 1, sd);
                weekStart.setDate(weekStart.getDate() + (w.weekNumber - 1) * 7);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                const fmtLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                const wkStartKey = fmtLocal(weekStart);
                const wkEndKey = fmtLocal(weekEnd);
                const weekExtras = extraWorkouts.filter((e: { date: string; workout: any }) => e.date >= wkStartKey && e.date <= wkEndKey);
                extraEntries = weekExtras.map((e: { date: string; workout: any }, i: number) => {
                  const [ey, em, ed] = e.date.split("-").map(Number);
                  const dt = new Date(ey, em - 1, ed);
                  const DAY_LABELS_IT = ["dom","lun","mar","mer","gio","ven","sab"];
                  return { kind: "extra" as const, dayIdx: DAY_ORDER.indexOf(DAY_LABELS_IT[dt.getDay()]), e, i };
                });
              }
              const unified: Array<PlannedEntry | ExtraEntry> = [...plannedEntries, ...extraEntries]
                .sort((a, b) => a.dayIdx - b.dayIdx);

              // Helper: data assoluta dal dayIdx (0=lun..6=dom) usando weekStartDate.
              // Ritorna formato "28/04" (gg/mm). Vuoto se weekStartDate non disponibile.
              const dateForDayIdx = (dayIdx: number): string => {
                if (!weekStartDate || dayIdx < 0) return "";
                const d = new Date(weekStartDate);
                d.setDate(d.getDate() + dayIdx);
                return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
              };

              return unified.map((entry) => {
                if (entry.kind === "extra") {
                  const e = entry.e;
                  const dayKey = DAY_ORDER[entry.dayIdx] || "";
                  const dayDateLabel = dateForDayIdx(entry.dayIdx);
                  const wtSubtype = e.workout.fields?.tipo || e.workout.fields?.sport || "";
                  const wtDur = e.workout.fields?.durata_totale || e.workout.fields?.durata || "";
                  return (
                    <div key={`extra-${e.date}-${entry.i}`} style={{
                      padding: "12px 14px",
                      background: "#1E3A8A20",
                      border: "1px solid #3B82F666",
                      borderRadius: "10px", fontSize: "13px",
                    }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "3px" }}>
                        <span style={{ fontWeight: 700, textTransform: "uppercase", color: "#60A5FA", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "62px" }}>
                          {dayKey}{dayDateLabel ? ` ${dayDateLabel}` : ""}
                        </span>
                        <span style={{ fontWeight: 600 }}>{e.workout.type}{wtSubtype ? ` · ${wtSubtype}` : ""}</span>
                        {wtDur && <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>{wtDur}min</span>}
                        <span style={{ color: "#60A5FA", fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>🔸 AUTONOMO</span>
                      </div>
                      <div style={{ color: "#CBD5E1", fontSize: "12px", marginTop: "2px", lineHeight: 1.4 }}>
                        Allenamento non pianificato — registrato il {(() => { const d = new Date(e.date + "T12:00:00"); const w = d.toLocaleDateString("it-IT", { weekday: "short" }); return `${w} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; })()}
                      </div>
                      {e.workout.notes && (
                        <div style={{ color: "#94A3B8", fontSize: "11px", fontStyle: "italic", marginTop: "4px", lineHeight: 1.4 }}>
                          {e.workout.notes}
                        </div>
                      )}
                    </div>
                  );
                }
                // Planned session
                const s = entry.s;
                const i = entry.i;
                const dayDateLabelP = dateForDayIdx(entry.dayIdx);
              // "Oggi" = il giorno della settimana corrente del piano (non hardcoded week 1)
              const isToday = w.weekNumber === todayPlanWeekNumber && s.day === todayKey;
              // È nel passato (già dovrebbe essere stata fatta)?
              const isPast = w.weekNumber < todayPlanWeekNumber ||
                (w.weekNumber === todayPlanWeekNumber && ["lun","mar","mer","gio","ven","sab","dom"].indexOf(s.day) < ["lun","mar","mer","gio","ven","sab","dom"].indexOf(todayKey));
              // Matching piano↔diario: FATTA perfetta (verde), FATTA parziale (giallo), SALTATA (grigia)
              let completion: { date: string; sameDay: boolean; strictMatch: boolean; actualSubtype?: string; actualType?: string } | null = null;
              if (plan.startDate) {
                const DAY_KEYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
                const dayIdx = DAY_KEYS.indexOf(s.day);
                if (dayIdx >= 0) {
                  const [sy, sm, sd] = plan.startDate.split("-").map(Number);
                  const start = new Date(sy, sm - 1, sd);
                  const sessionDate = new Date(start);
                  sessionDate.setDate(start.getDate() + (w.weekNumber - 1) * 7 + dayIdx);
                  completion = completedSessions.get(`${w.weekNumber}-${s.day}-${sessionDate.getTime()}`) || null;
                }
              }
              const isCompleted = completion !== null;
              const isPartial = completion !== null && !completion.strictMatch;
              const isPerfect = completion !== null && completion.strictMatch;
              const bg = isPerfect ? "#14532D40" : isPartial ? "#78350F30" : isToday ? "#E8553A15" : isPast ? "#1A1A2E80" : "#1A1A2E";
              const borderColor = isPerfect ? "#22C55E66" : isPartial ? "#F59E0B66" : isToday ? "#E8553A66" : "transparent";
              const dayLabelColor = isPerfect ? "#22C55E" : isPartial ? "#F59E0B" : isToday ? "#E8553A" : "#94A3B8";
              return (
                <div key={`${w.weekNumber}-${s.day}-${i}`} style={{
                  padding: "12px 14px",
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: "10px", fontSize: "13px",
                  opacity: isPast && !isCompleted ? 0.55 : 1,
                }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "3px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, textTransform: "uppercase", color: dayLabelColor, fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "62px" }}>
                      {s.day}{dayDateLabelP ? ` ${dayDateLabelP}` : ""}
                    </span>
                    <span style={{ fontWeight: 600 }}>{s.type}{s.subtype ? ` · ${s.subtype}` : ""}</span>
                    <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>{s.duration_min}min</span>
                    {(() => {
                      const chip = zoneChipFor(s);
                      if (!chip) return null;
                      const c = ZONE_CHIP_COLORS[chip.idx];
                      return (
                        <span
                          title="Range bpm calcolato dalle tue zone FC correnti"
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "11px", fontWeight: 700,
                            color: c.text, background: c.bg,
                            border: `1px solid ${c.border}`,
                            padding: "2px 7px", borderRadius: "999px",
                            letterSpacing: "0.04em",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Z{chip.idx} · {chip.low}-{chip.high} bpm
                        </span>
                      );
                    })()}
                    {isPerfect && <span aria-label="Sessione completata" style={{ color: "#22C55E", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>✓ FATTA</span>}
                    {isPartial && <span aria-label="Sessione con variazione" style={{ color: "#F59E0B", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>⚠ VARIAZIONE</span>}
                    {!isCompleted && isToday && <span aria-label="Sessione di oggi (ancora da fare)" style={{ color: "#E8553A", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>OGGI</span>}
                    {!isCompleted && !isToday && isPast && <span aria-label="Sessione saltata" style={{ color: "#94A3B8", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", marginLeft: "auto" }}>SALTATA</span>}
                  </div>
                  {isPartial && completion && (
                    <div style={{ color: "#F59E0B", fontSize: "11px", marginBottom: "6px", fontWeight: 600 }}>
                      {completion.actualType
                        ? <>Hai fatto <b>{completion.actualType}</b>{completion.actualSubtype ? ` · ${completion.actualSubtype}` : ""} invece di <b>{s.type}</b>{s.subtype ? ` · ${s.subtype}` : ""}</>
                        : <>Hai fatto {completion.actualSubtype ? `"${completion.actualSubtype}"` : "una variazione"} invece di "{s.subtype || s.type}"</>}
                      {!completion.sameDay && ` · il ${(() => { const d = new Date(completion.date + "T12:00:00"); const w = d.toLocaleDateString("it-IT", { weekday: "short" }); return `${w} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; })()}`}
                    </div>
                  )}
                  {isPerfect && completion && !completion.sameDay && (
                    <div style={{ color: "#22C55E", fontSize: "11px", marginBottom: "6px", fontWeight: 600 }}>
                      Fatto il {(() => { const d = new Date(completion.date + "T12:00:00"); const w = d.toLocaleDateString("it-IT", { weekday: "short" }); return `${w} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; })()} invece del giorno pianificato
                    </div>
                  )}
                  <div style={{ color: "#CBD5E1", lineHeight: 1.5 }}>{stripInlineHRRange(s.details)}</div>
                  {/* Wave 4.3 — Render esercizi forza con SubstitutionBadge.
                      Per ogni PlannedExercise.exerciseId, calcoliamo a render-time
                      la sostituzione equipment-aware (pure, no async). hop>0 →
                      badge ambra; null → badge errore rosso. Backward compat:
                      se exercises è undefined o vuoto, niente render extra. */}
                  {Array.isArray(s.exercises) && s.exercises.length > 0 && (
                    <ExercisesList
                      exercises={s.exercises}
                      availableEquipment={availableEquipmentForRender}
                    />
                  )}
                  {s.rationale && (
                    <details style={{ marginTop: "6px" }}>
                      <summary
                        style={{
                          cursor: "pointer", listStyle: "none",
                          fontSize: "11px", color: "#94A3B8",
                          fontWeight: 600, padding: "4px 0", minHeight: "24px",
                          display: "flex", alignItems: "center", gap: "5px",
                          userSelect: "none",
                        }}
                      >
                        <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', monospace" }}>▸</span>
                        Razionale coach
                      </summary>
                      <div style={{ color: "#94A3B8", fontSize: "12px", fontStyle: "italic", marginTop: "4px", lineHeight: 1.5 }}>{s.rationale}</div>
                    </details>
                  )}
                  {/* Action row: Registra (se non completata) + Chiedi al coach (sempre).
                      SALTATA actionable: anche se isPast && !isCompleted, l'utente può
                      ancora registrare retroattivamente o chiedere al coach come recuperarla. */}
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                    {!isCompleted && (
                      <button
                        onClick={() => registerFromPlan(s, w.weekNumber)}
                        title={isPast
                          ? "Registra questa sessione retrodatata (campi pre-compilati dal piano, modificabili)"
                          : isToday
                            ? "Registra questa sessione (campi pre-compilati dal piano, modificabili)"
                            : "Registra in anticipo questa sessione (campi pre-compilati dal piano, modificabili)"
                        }
                        style={{
                          padding: "9px 14px",
                          background: isToday
                            ? "linear-gradient(135deg, #E8553A 0%, #D44429 100%)"
                            : isPast
                              ? "#1E293B"
                              : "transparent",
                          border: isToday ? "none" : isPast ? "1px solid rgba(255,255,255,0.12)" : "1px solid #E8553A66",
                          borderRadius: "10px",
                          color: isToday ? "#FFF" : isPast ? "#CBD5E1" : "#E8553A",
                          fontSize: "13px", fontWeight: 700, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: "6px",
                          minHeight: "40px",
                        }}
                      >
                        <span>+</span> Registra allenamento
                      </button>
                    )}
                    <button
                      onClick={() => askCoachAboutSession(s, w.weekNumber)}
                      title="Apri la chat Coach con un prompt contestuale su questa sessione"
                      style={{
                        padding: "9px 14px",
                        background: "transparent",
                        border: "1px solid rgba(14, 165, 233, 0.5)",
                        borderRadius: "10px",
                        color: "#38BDF8",
                        fontSize: "13px", fontWeight: 700, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: "6px",
                        minHeight: "40px",
                      }}
                    >
                      💬 Chiedi al coach
                    </button>
                    {plan.sourceMacro && !isCompleted && (
                      <button
                        onClick={() => { const k = `${w.weekNumber}-${s.day}`; setSubMenuKey(subMenuKey === k ? null : k); setSubAltroOpen(false); }}
                        title="Non puoi farla? Sostituiscila con un'alternativa equivalente"
                        style={{
                          padding: "9px 14px", background: "transparent",
                          border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px",
                          color: "#94A3B8", fontSize: "13px", fontWeight: 700, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: "6px", minHeight: "40px",
                        }}
                      >
                        🔁 Non posso / sostituisci
                      </button>
                    )}
                  </div>
                  {plan.sourceMacro && subMenuKey === `${w.weekNumber}-${s.day}` && (
                    <div style={{ marginTop: "10px", padding: "12px", background: "#0F172A", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ fontSize: "11px", color: "#F59E0B", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Sostituisci con un'alternativa equivalente
                      </div>
                      {sessionAlternatives(s).map((alt, ai) => (
                        <button key={ai} onClick={() => void handleSubstitute([alt.op])} disabled={adapting} style={ALT_BTN_STYLE}>
                          {alt.label}
                        </button>
                      ))}
                      <button onClick={() => void handleSubstitute([{ op: "dropSession", day: s.day as AdaptationOp["day"], reason: "non disponibile" }])} disabled={adapting} style={ALT_BTN_STYLE}>
                        Riposo (togli la sessione)
                      </button>
                      <button onClick={() => setSubAltroOpen(v => !v)} disabled={adapting} style={{ ...ALT_BTN_STYLE, borderStyle: "dashed" }}>
                        ✦ Altro (chiedi al coach)
                      </button>
                      {subAltroOpen && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <input
                            value={subAltroText}
                            onChange={e => setSubAltroText(e.target.value)}
                            placeholder="Opzionale: es. ho solo la palestra, niente campo"
                            style={{ padding: "8px 10px", background: "#16213E", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", color: "#E2E8F0", fontSize: "12px" }}
                          />
                          <button
                            onClick={() => void handleSubstituteAltro(s)}
                            disabled={adapting}
                            style={{ padding: "9px 12px", background: "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)", border: "none", borderRadius: "8px", color: "#FFF", fontSize: "12px", fontWeight: 700, cursor: adapting ? "wait" : "pointer" }}
                          >
                            {adapting ? `⏳ Il coach propone… ${llmElapsedSec}s` : "Proponi alternativa"}
                          </button>
                        </div>
                      )}
                      {adaptError && (
                        <div style={{ fontSize: "11px", color: "#EF4444" }}>{adaptError}</div>
                      )}
                    </div>
                  )}
                </div>
              );
              });
            })()}
          </div>
        </div>
        );
      })}
      </div>
      {/* /Fix 1 wrapper grigio */}


      {!isExpired && (
        <div style={{
          background: "#1A1A2E", borderRadius: "10px",
          padding: "10px 14px", fontSize: "12px", color: "#94A3B8",
          display: "flex", alignItems: "center", gap: "8px",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <span>📅</span>
          <span style={{ lineHeight: 1.5 }}>
            La settimana prossima verrà rigenerata automaticamente lunedì sui tuoi dati reali, oppure puoi farlo ora con "Rigenera piano".
          </span>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ background: "#16213E", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <button
            onClick={() => setHistoryOpen(o => !o)}
            aria-expanded={historyOpen}
            style={{
              width: "100%", padding: "14px 18px",
              background: "transparent", border: "none",
              color: "#CBD5E1", fontSize: "13px", fontWeight: 700,
              display: "flex", alignItems: "center", gap: "10px",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ fontSize: "16px", transform: historyOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▸</span>
            <span style={{ flex: 1 }}>Settimane precedenti</span>
            <span style={{ fontSize: "11px", color: "#94A3B8", fontWeight: 500 }}>{history.length} piani archiviati</span>
          </button>

          {historyOpen && (
            <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {history.map((h: TrainingPlan, hi: number) => {
                // La history è newest-first. Numeriamo dal più vecchio: oldest = Settimana 1.
                const dateRange = formatWeekRange(h.startDate) || new Date(h.generatedAt).toLocaleDateString("it-IT");
                return (
                <div key={h.generatedAt + hi} style={{ background: "#1A1A2E", borderRadius: "10px", padding: "12px 14px", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.08em" }}>
                      📅 {dateRange}
                    </div>
                  </div>
                  {h.rationale && (
                    <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "8px", lineHeight: 1.5, fontStyle: "italic" }}>
                      {h.rationale}
                    </div>
                  )}
                  {h.weeks.map((w: TrainingPlan["weeks"][number], wi: number) => (
                    <div key={wi} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {w.sessions.map((s: TrainingPlan["weeks"][number]["sessions"][number], si: number) => (
                        <div key={si} style={{ fontSize: "12px", padding: "6px 8px", background: "#0F172A", borderRadius: "6px", display: "flex", gap: "8px", alignItems: "baseline" }}>
                          <span style={{ fontWeight: 700, textTransform: "uppercase", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", minWidth: "28px" }}>{s.day}</span>
                          <span style={{ fontWeight: 600, color: "#CBD5E1" }}>{s.type}{s.subtype ? ` · ${s.subtype}` : ""}</span>
                          <span style={{ color: "#64748B", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px" }}>{s.duration_min}min</span>
                          <span style={{ color: "#64748B", fontSize: "11px", flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stripInlineHRRange(s.details)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: "11px", color: "#94A3B8", textAlign: "center" }}>
        Generato {(() => { const d = new Date(plan.generatedAt); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; })()} — Valido fino al {(() => { const d = new Date(plan.validUntil); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; })()}
      </div>
    </div>
  );
}
