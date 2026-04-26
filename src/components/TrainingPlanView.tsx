import { useEffect, useMemo, useRef, useState } from "react";
import { getJSON } from "../lib/storage";
import type { TrainingPlan, UserProfile, UserGoal } from "../lib/types";
import { events } from "../lib/events";
import { setJSON } from "../lib/storage";
import { planStateHash } from "../lib/coach/planValidator";
import { buildCoachContext, getLastNDays } from "../lib/diaryContext";
import { regenerateNextWeek, generateInitialPlan, adaptPlan } from "../lib/coach/planGenerator";
import { translateGeminiError } from "../lib/geminiErrors";
import { savePlanWithHistory, getPlanHistory } from "../lib/coach/planHistory";
import ZonesCard from "./ZonesCard";
import { computeZonesContext, inferSessionZone, stripInlineHRRange, type ZonesResult } from "../lib/coach/zones";
import type { PlannedSession } from "../lib/types";
import { useNotify } from "./Notification";

const ADAPT_QUICK_PROMPTS = [
  "Più intenso",
  "Più leggero",
  "Settimana di deload",
  "Aggiungi più forza",
  "Non posso allenarmi giovedì",
];

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
    const byNewline = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (byNewline.length > 1) return byNewline;
    const bySentence = text.split(/(?<=[.!?])\s+(?=[A-ZÀÈÉÌÒÙ])/).map(s => s.trim()).filter(Boolean);
    return bySentence.length > 1 ? bySentence : [text];
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

  const load = async () => {
    const [p, profile, goals, days, hist, daysForZones] = await Promise.all([
      getJSON<TrainingPlan | null>("training-plan", null),
      getJSON<UserProfile | null>("user-profile", null),
      getJSON<UserGoal[]>("user-goals", []),
      getLastNDays(14),
      getPlanHistory(),
      // Zone FC: servono 60gg per il calcolo empirico (stesso scope di ZonesCard).
      // Indipendente dai 14gg usati per il matching piano↔diario.
      getLastNDays(60).catch(() => [] as Array<{ date: string; daily: any; workouts: any[] }>),
    ]);
    if (!mountedRef.current) return;
    setPlan(p);
    setCurrentProfile(profile);
    setCurrentGoals(goals);
    setRecentDays(days);
    setHistory(hist);
    // Ricalcola le zone dal profilo corrente + storico recente.
    // Unica fonte di verità per i range bpm renderizzati nei chip delle sessioni.
    const ctx = profile ? computeZonesContext(profile, daysForZones) : null;
    setZonesCtx(ctx?.zones ?? null);
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

  // Picker stato: null = chiuso, "show" = aperto in attesa di scelta utente.
  // Le 2 modalità vengono passate a regenerateNextWeek.
  const [regenPickerOpen, setRegenPickerOpen] = useState(false);

  const handleRegenerate = async (mode: "rest-of-week" | "next-week" = "next-week") => {
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
      let next: TrainingPlan;
      let title: string;
      if (plan) {
        const ctx = await buildCoachContext({ daysBack: 14 });
        next = await regenerateNextWeek(profile, goals, plan, ctx.recentDaysText, mode);
        title = mode === "rest-of-week"
          ? "✓ Piano riavviato dai giorni rimanenti di questa settimana"
          : "✓ Piano per la prossima settimana generato";
      } else {
        next = await generateInitialPlan(profile, goals);
        title = "✓ Piano iniziale generato";
      }
      // Archivia il piano corrente nello storico prima di sovrascrivere (se esiste)
      await savePlanWithHistory(next);
      events.emit("plan:updated", { at: new Date().toISOString() });
      // mountedRef guard: generazione piano può durare 20-30s. Se l'utente
      // ha cambiato tab nel frattempo il componente è smontato — non fare setState.
      if (!mountedRef.current) return;
      setPlan(next);
      showSuccess(title, next.rationale);
    } catch (e) {
      if (!mountedRef.current) return;
      setRegenError(translateGeminiError(e));
    }
    if (!mountedRef.current) return;
    setRegenerating(false);
  };

  const handleAdapt = async (requestText?: string) => {
    const req = (requestText ?? adaptRequest).trim();
    if (!req || adapting || !plan) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setAdaptError("Offline. Riconnettiti per adattare il piano.");
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
        ? <span role="progressbar" aria-label={`Rigenerazione in corso — ${llmElapsedSec} secondi`} aria-busy="true">⏳ Rigenerazione… {llmElapsedSec}s</span>
        : (plan ? "🔁 Rigenera piano (integra dati recenti)" : "🎯 Genera piano")}
    </button>
  );

  if (!plan) {
    return (
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "24px 20px", border: "1px dashed rgba(255,255,255,0.1)", textAlign: "center", color: "#94A3B8" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }}>🗺</div>
        <div style={{ fontSize: "14px", marginBottom: "4px" }}>Nessun piano attivo</div>
        <div style={{ fontSize: "12px", marginBottom: "16px" }}>Genera un piano personalizzato dal tuo profilo + obiettivi.</div>
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

  // "Chiedi al coach": emette chat:openWith con un prompt contestuale e naviga
  // al tab Coach. Il listener in CoachChat precompila l'input (non auto-invia:
  // l'utente può ancora editare).
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

  const rationaleBullets = rationaleToBullets(plan.rationale);
  const isMultiBullet = rationaleBullets.length > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Banner success → ora via NotificationHost popup (vedi showSuccess) */}

      {/* Z2 in cima per avere il range bpm sempre visibile */}
      <ZonesCard compact highlightZone={2} />

      {/* Razionale piano: graphic distinta (icon + bullet list) vs prima (blob testo).
          Ogni frase diventa un bullet con check-dot — più scannable in 2s. */}
      <div style={{ background: "linear-gradient(135deg, #16213E 0%, #1A2B4E 100%)", borderRadius: "14px", padding: "18px 20px", border: "1px solid rgba(232, 85, 58, 0.25)", boxShadow: "0 4px 14px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <div aria-hidden="true" style={{
            width: "28px", height: "28px", borderRadius: "8px",
            background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "15px", flexShrink: 0, boxShadow: "0 2px 6px rgba(232, 85, 58, 0.3)",
          }}>🎯</div>
          <div style={{ fontSize: "11px", color: "#E8553A", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 800 }}>Razionale del piano</div>
        </div>
        {isMultiBullet ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
            {rationaleBullets.map((b, i) => (
              <li key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "14px", lineHeight: 1.5, color: "#E2E8F0" }}>
                <span aria-hidden="true" style={{
                  width: "6px", height: "6px", borderRadius: "999px",
                  background: "#E8553A", marginTop: "8px", flexShrink: 0,
                }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: "14px", lineHeight: 1.55, color: "#E2E8F0" }}>{plan.rationale}</div>
        )}
      </div>

      {(isExpiringSoon || isExpired) && (
        <div style={{
          background: isExpired ? "#EF444415" : "#F59E0B15",
          border: `1px solid ${isExpired ? "#EF444466" : "#F59E0B66"}`,
          borderRadius: "12px", padding: "12px 14px",
        }}>
          <div style={{ fontSize: "12px", color: isExpired ? "#EF4444" : "#F59E0B", fontWeight: 700, marginBottom: "4px" }}>
            {isExpired ? "⚠ Piano scaduto" : `⏰ Piano in scadenza (${daysLeft} giorni)`}
          </div>
          <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5, marginBottom: isExpired ? "10px" : 0 }}>
            {isExpired ? "Il piano sottostante non viene più mostrato per evitare confusione. Rigenera o adatta per riceverne uno aggiornato." : "Presto il coach dovrà produrre il microciclo successivo."}
          </div>
          {isExpired && (
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
              }}
            >
              {regenerating ? `⏳ Rigenerazione… ${llmElapsedSec}s` : "🔁 Rigenera ora"}
            </button>
          )}
        </div>
      )}

      {profileDrift && !isExpired && (
        <div style={{
          background: "#F59E0B15", border: "1px solid #F59E0B66",
          borderRadius: "12px", padding: "12px 14px",
        }}>
          <div style={{ fontSize: "12px", color: "#F59E0B", fontWeight: 700, marginBottom: "4px" }}>
            ⚠ Profilo o obiettivi cambiati dopo la generazione
          </div>
          <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>
            Profilo (età, esperienza, infortuni, disponibilità, aree dolore) oppure obiettivi sono stati modificati dopo la generazione del piano. Il piano corrente potrebbe non essere più ottimale — considera una rigenerazione.
          </div>
        </div>
      )}

      {/* Sezione modifica piano — in alto, prima delle sessioni.
          Contiene: Adatta con richiesta, Rigenera piano, e (se ci sono deviazioni)
          CTA "Adatta alle deviazioni" integrato nella stessa card (prima era
          una card separata → audit UI: duplicazione concetto "modifica piano"). */}
      <div style={{ background: "#16213E", borderRadius: "14px", padding: "16px 18px", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ fontSize: "11px", color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
          Modifica piano
        </div>

        {/* CTA deviazioni: solo se ce ne sono. Integrato qui (prima era card esterna). */}
        {!isExpired && hasDeviations && (
          <div style={{
            background: "#78350F20", border: "1px solid #F59E0B66",
            borderRadius: "10px", padding: "10px 12px",
            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#F59E0B", marginBottom: "3px" }}>
                Il piano si è discostato dalla realtà
              </div>
              <div style={{ fontSize: "11px", color: "#CBD5E1", lineHeight: 1.4 }}>
                {[
                  deviationCount.skipped > 0 ? `${deviationCount.skipped} sessioni saltate` : "",
                  deviationCount.partial > 0 ? `${deviationCount.partial} con variazione` : "",
                  deviationCount.extras > 0 ? `${deviationCount.extras} allenamenti autonomi` : "",
                ].filter(Boolean).join(" · ")}. Riallinea il resto del piano a ciò che hai fatto.
              </div>
            </div>
            <button
              onClick={() => handleAdapt(buildDeviationRequest())}
              disabled={adapting || regenerating}
              style={{
                padding: "9px 13px",
                background: adapting ? "#1E293B" : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                border: "none", borderRadius: "9px", color: "#FFF",
                fontSize: "12px", fontWeight: 700,
                cursor: adapting ? "wait" : "pointer",
                opacity: (adapting || regenerating) ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {adapting ? `⏳ Adatto… ${llmElapsedSec}s` : "🔁 Adatta alle deviazioni"}
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => { setAdaptOpen(o => !o); setAdaptError(null); setRegenPickerOpen(false); }} disabled={adapting || regenerating} style={{ flex: "1 1 140px", padding: "10px 14px", background: adaptOpen ? "#E8553A22" : "#1A1A2E", border: adaptOpen ? "1px solid #E8553A" : "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: adaptOpen ? "#E8553A" : "#E2E8F0", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
            ✏ Adatta con richiesta
          </button>
          <button onClick={() => { setRegenPickerOpen(o => !o); setAdaptOpen(false); }} disabled={regenerating || adapting} aria-busy={regenerating || undefined} role={regenerating ? "status" : undefined} aria-label={regenerating ? "Rigenerazione piano in corso" : undefined} style={{ flex: "1 1 140px", padding: "10px 14px", background: regenerating ? "#1E293B" : regenPickerOpen ? "#0891B222" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)", border: regenPickerOpen ? "1px solid #0891B2" : "none", borderRadius: "10px", color: regenPickerOpen ? "#0891B2" : "#FFF", fontSize: "13px", fontWeight: 700, cursor: regenerating ? "wait" : "pointer", opacity: regenerating ? 0.5 : 1 }}>
            {regenerating
              ? <span role="progressbar" aria-label={`Rigenerazione in corso — ${llmElapsedSec} secondi`} aria-busy="true">⏳ Rigenerazione… {llmElapsedSec}s</span>
              : "🔁 Rigenera piano"}
          </button>
        </div>

        {regenPickerOpen && !regenerating && (() => {
          const today = new Date();
          const dow = today.getDay(); // 0=dom..6=sab
          const todayIdx = (dow + 6) % 7; // 0=lun..6=dom
          const labels = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
          const todayLabel = labels[todayIdx];
          const remaining = labels.slice(todayIdx);
          // Mostra "rest-of-week" solo da martedì a sabato (esclude lun che copre già
          // tutta la settimana, esclude domenica che lascerebbe solo 1 giorno).
          const showRestOfWeek = todayIdx >= 1 && todayIdx <= 5;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: "12px", color: "#CBD5E1", fontWeight: 600 }}>Come vuoi rigenerare?</div>
              {showRestOfWeek && (
                <button
                  onClick={() => handleRegenerate("rest-of-week")}
                  style={{
                    textAlign: "left", padding: "12px 14px",
                    background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "10px", color: "#E2E8F0", cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "#0891B2", marginBottom: "3px" }}>
                    ▶ Riparti da oggi
                  </div>
                  <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.4 }}>
                    Genera {remaining.length} sessioni per {remaining.join(", ")}. I giorni passati restano chiusi.
                  </div>
                </button>
              )}
              <button
                onClick={() => handleRegenerate("next-week")}
                style={{
                  textAlign: "left", padding: "12px 14px",
                  background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "10px", color: "#E2E8F0", cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#0891B2", marginBottom: "3px" }}>
                  ▶ Pianifica settimana prossima
                </div>
                <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.4 }}>
                  Genera 7 giorni lun–dom prossimi.{!showRestOfWeek ? ` (Oggi è ${todayLabel}, l'opzione "riparti" non è disponibile.)` : ""}
                </div>
              </button>
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
        {adaptOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>Dimmi cosa vuoi cambiare. Il coach rispetterà comunque le regole di sicurezza.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {ADAPT_QUICK_PROMPTS.map(p => (<button key={p} onClick={() => setAdaptRequest(p)} disabled={adapting} style={{ padding: "6px 12px", fontSize: "12px", background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px", color: "#CBD5E1", cursor: "pointer" }}>{p}</button>))}
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
        {regenError && <div style={{ color: "#EF4444", fontSize: "12px" }}>{regenError}</div>}
      </div>

      {!isExpired && plan.weeks.map((w: TrainingPlan["weeks"][number]) => (
        <div key={w.weekNumber} style={{ background: "#16213E", borderRadius: "14px", padding: "18px 20px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase" }}>Settimana {w.weekNumber}</div>
            <div style={{ fontSize: "13px", color: "#CBD5E1", fontWeight: 600 }}>{w.focus}</div>
          </div>
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

              return unified.map((entry) => {
                if (entry.kind === "extra") {
                  const e = entry.e;
                  const dayKey = DAY_ORDER[entry.dayIdx] || "";
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
                        <span style={{ fontWeight: 700, textTransform: "uppercase", color: "#60A5FA", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "32px" }}>{dayKey}</span>
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
                    <span style={{ fontWeight: 700, textTransform: "uppercase", color: dayLabelColor, fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "32px" }}>{s.day}</span>
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
                  <div style={{ color: "#94A3B8", fontSize: "12px", fontStyle: "italic", marginTop: "6px", lineHeight: 1.5 }}>{s.rationale}</div>
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
                  </div>
                </div>
              );
              });
            })()}
          </div>
        </div>
      ))}


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
