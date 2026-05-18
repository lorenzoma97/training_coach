import { getJSON, setJSON, storage } from "./storage";
import { generateWeeklyReport } from "./coach/weeklyReport";
import { regenerateNextWeek } from "./coach/planGenerator";
import { savePlanWithHistory } from "./coach/planHistory";
import { generateText } from "./llm";
import { PROMPTS } from "./coach/systemPrompts";
import { profileAsPrompt, goalsAsPrompt, getLastNDays } from "./diaryContext";
import type { CoachFeedItem, TrainingPlan, UserProfile, UserGoal, WeeklyReportSummary } from "./types";
import { buildCoachContext } from "./diaryContext";
import { hasApiKey } from "./gemini";
import { events } from "./events";

const LAST_REPORT_KEY = "last-weekly-report-date"; // YYYY-MM-DD
const LAST_MOTIVATION_KEY = "last-motivation-date"; // YYYY-MM-DD
const MOTIVATION_MIN_IDLE_DAYS = 3; // giorni senza workout prima di triggerare check-in
const MOTIVATION_MIN_GAP_DAYS = 4;  // intervallo minimo tra due check-in motivazionali

// Soft-mutex cross-tab per il weekly report: il lock in-memory copre solo lo
// stesso mount; con più tab aperte entrambe possono passare il check sulla data
// e lanciare in parallelo (LLM + scrittura feed duplicata). Scriviamo una flag
// con timestamp e UUID tab: se un altro tab l'ha scritta da <60s, skippiamo.
const WEEKLY_LOCK_KEY = "weekly-report-running";
const WEEKLY_LOCK_TTL_MS = 60_000;

interface WeeklyLock { ts: number; tabId: string }

// ID persistente per tab. sessionStorage è scoped per tab, quindi due tab hanno
// ID diversi (ok per lock cross-tab); localStorage NO, sarebbe condiviso.
function getTabId(): string {
  try {
    let id = sessionStorage.getItem("tab-id");
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("tab-id", id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Lock in-memory per evitare run concorrenti nello stesso mount
let weeklyRunInFlight: Promise<CoachFeedItem | null> | null = null;

export async function maybeRunWeeklyReport(force = false): Promise<CoachFeedItem | null> {
  if (weeklyRunInFlight) return weeklyRunInFlight;
  weeklyRunInFlight = (async () => {
    try { return await _runWeekly(force); }
    finally { weeklyRunInFlight = null; }
  })();
  return weeklyRunInFlight;
}

async function _runWeekly(force: boolean): Promise<CoachFeedItem | null> {
  if (!hasApiKey()) return null;
  const today = new Date();
  const todayStr = todayLocal();
  const last = (await getJSON<string | null>(LAST_REPORT_KEY, null)) || "";
  // Logica trigger:
  //  - force=true: sempre (manual trigger da CoachPage)
  //  - lunedì + non già fatto oggi: trigger normale
  //  - giorni rimanenti settimanale (mar-dom): RETROATTIVO se sono passati
  //    ≥7 giorni dall'ultimo report. Risolve il caso "utente skip lunedì →
  //    mai report" — meglio averlo in ritardo che non averlo affatto.
  const isMonday = today.getDay() === 1;
  let shouldRun = force || (isMonday && last !== todayStr);
  if (!shouldRun && last) {
    const [ly, lm, ld] = last.split("-").map(Number);
    const lastD = new Date(ly, lm - 1, ld);
    const daysSinceLast = Math.floor((today.getTime() - lastD.getTime()) / (24 * 3600 * 1000));
    if (daysSinceLast >= 7) shouldRun = true; // retroattivo
  } else if (!shouldRun && !last) {
    // Mai eseguito — corre subito se profilo + diario presenti.
    shouldRun = true;
  }
  if (!shouldRun) return null;
  if (last === todayStr && !force) return null;

  // Soft-mutex cross-tab: se un altro tab ha iniziato da <60s, skippa.
  // La flag stale (>60s) è considerata abbandonata (crash/reload) e sovrascritta.
  const tabId = getTabId();
  const existingLock = await getJSON<WeeklyLock | null>(WEEKLY_LOCK_KEY, null);
  if (existingLock && existingLock.tabId !== tabId) {
    const age = Date.now() - existingLock.ts;
    if (age >= 0 && age < WEEKLY_LOCK_TTL_MS) {
      console.info(
        `[scheduler] weekly: skip, altro tab in esecuzione (tab=${existingLock.tabId}, age=${age}ms)`,
      );
      return null;
    }
  }
  await setJSON(WEEKLY_LOCK_KEY, { ts: Date.now(), tabId } satisfies WeeklyLock);

  try {
    // Marca subito la data per evitare duplicati se più tab aperte
    await setJSON(LAST_REPORT_KEY, todayStr);

    const profile = await getJSON<UserProfile | null>("user-profile", null);
    if (!profile) return null;

    const report = await generateWeeklyReport();
    const item: CoachFeedItem = {
      id: Date.now().toString(36),
      date: today.toISOString(),
      type: "weekly-report",
      title: "Report settimanale",
      severity: "info",
      content: [
        report.summary,
        "",
        `**Aderenza**: ${Math.round(report.adherencePct)}%`,
        `**Volume**: ${Object.entries(report.volumeByDiscipline).map(([k, v]) => `${k} ${v.actual_min}/${v.planned_min}min`).join(" · ")}`,
        `**Dolore**: ${report.painTrend}`,
        `**Sonno/Stanchezza**: ${report.sleepFatigueTrend}`,
        "",
        `**Settimana prossima**: ${report.adjustments}`,
      ].join("\n"),
    };

    const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
    feed.unshift(item);
    await setJSON("coach-feed", feed.slice(0, 200));

    // Rigenera piano prossime 2 settimane
    try {
      const goals = await getJSON<UserGoal[]>("user-goals", []);
      const ctx = await buildCoachContext({ daysBack: 14 });
      const currentPlan = await getJSON<TrainingPlan | null>("training-plan", null);
      // Sprint 1 fix #1: closed-loop weeklyReport → regen. Costruiamo lo
      // struct WeeklyReportSummary dal report LLM appena prodotto, così la
      // regen riceve adherencePct, volume reale, pain trend, hint testuali
      // → applica adherence cap deterministico + iniezione prompt.
      const previousReport: WeeklyReportSummary = {
        adherencePct: report.adherencePct,
        volumeByDiscipline: report.volumeByDiscipline,
        painTrend: report.painTrend,
        adjustmentsHints: report.adjustments,
      };
      const nextPlan = await regenerateNextWeek(profile, goals, currentPlan, ctx.recentDaysText, "next-week", undefined, previousReport);
      // Archivia il piano precedente nello storico prima di sovrascrivere.
      await savePlanWithHistory(nextPlan);
      events.emit("plan:updated", { at: new Date().toISOString() });

      const planUpdate: CoachFeedItem = {
        id: Date.now().toString(36) + "p",
        date: new Date().toISOString(),
        type: "plan-update",
        title: "Piano aggiornato",
        severity: "info",
        content: nextPlan.rationale,
      };
      const f2 = await getJSON<CoachFeedItem[]>("coach-feed", []);
      f2.unshift(planUpdate);
      await setJSON("coach-feed", f2.slice(0, 200));
    } catch (e) {
      console.error("[scheduler] plan regen failed", e);
    }

    return item;
  } finally {
    // Rilascia il lock a prescindere dall'esito (success/error): una flag stale
    // bloccherebbe altre esecuzioni fino alla scadenza TTL.
    try {
      await storage.delete(WEEKLY_LOCK_KEY);
    } catch (e) {
      console.warn("[scheduler] weekly: failed to clear lock", e);
    }
  }
}

// ---------- Motivation check-in ----------
// Si attiva quando l'utente non registra workout da MOTIVATION_MIN_IDLE_DAYS giorni.
// Rispetta un cooldown di MOTIVATION_MIN_GAP_DAYS tra messaggi per non risultare invadente.

let motivationRunInFlight: Promise<CoachFeedItem | null> | null = null;

export async function maybeRunMotivationCheckIn(force = false): Promise<CoachFeedItem | null> {
  if (motivationRunInFlight) return motivationRunInFlight;
  motivationRunInFlight = (async () => {
    try { return await _runMotivation(force); }
    finally { motivationRunInFlight = null; }
  })();
  return motivationRunInFlight;
}

async function _runMotivation(force: boolean): Promise<CoachFeedItem | null> {
  if (!hasApiKey()) return null;
  const profile = await getJSON<UserProfile | null>("user-profile", null);
  const goals = await getJSON<UserGoal[]>("user-goals", []);
  if (!profile || !goals.length) return null;

  const todayStr = todayLocal();
  const last = (await getJSON<string | null>(LAST_MOTIVATION_KEY, null)) || "";
  if (!force && last) {
    const [ly, lm, ld] = last.split("-").map(Number);
    const [ty, tm, td] = todayStr.split("-").map(Number);
    const lastDate = new Date(ly, lm - 1, ld);
    const todayDate = new Date(ty, tm - 1, td);
    const gap = Math.floor((todayDate.getTime() - lastDate.getTime()) / (24 * 3600 * 1000));
    if (gap < MOTIVATION_MIN_GAP_DAYS) return null;
  }

  // Rileva inattività: quanti giorni consecutivi SENZA workout a partire da oggi indietro.
  const days = await getLastNDays(14);
  // Ordina decrescente per data
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
  let idleDays = 0;
  for (const d of sorted) {
    if ((d.workouts || []).length === 0) idleDays++;
    else break;
  }
  if (!force && idleDays < MOTIVATION_MIN_IDLE_DAYS) return null;

  await setJSON(LAST_MOTIVATION_KEY, todayStr);

  let content: string;
  try {
    const userPrompt = `
PROFILO: ${profileAsPrompt(profile)}
OBIETTIVI: ${goalsAsPrompt(goals)}
CONTESTO: L'utente non registra allenamenti da ${idleDays} giorni consecutivi.
Scrivi un check-in motivazionale breve (60-100 parole) senza colpevolizzare. Riconosci la difficoltà (vita, lavoro, stanchezza), proponi UNA piccola azione recuperabile, e richiama il "perché" originale citando uno degli obiettivi.
`.trim();
    content = await generateText({
      systemInstruction: PROMPTS.motivation({ age: profile.age }),
      userPrompt,
      maxTokens: 200,
    });
  } catch (e) {
    console.warn("[scheduler] motivation LLM failed, using fallback", e);
    const goalSnippet = goals[0]?.smartDescription || "il tuo obiettivo";
    content = `Bentornato. Sono ${idleDays} giorni che non registri una sessione — nessun giudizio, solo una nota. Se oggi non senti energia per qualcosa di strutturato, una camminata di 20 minuti è un ottimo modo di rimettere il corpo in movimento senza stress. Ricorda perché hai iniziato: ${goalSnippet}. I dati suggeriscono che ripartire in piccolo è più efficace di aspettare la motivazione perfetta.`;
  }

  const item: CoachFeedItem = {
    id: Date.now().toString(36) + "m",
    date: new Date().toISOString(),
    type: "motivation",
    title: idleDays >= 7 ? "Bentornato — riprendiamo piano" : "Check-in",
    severity: "info",
    content,
  };
  const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
  feed.unshift(item);
  await setJSON("coach-feed", feed.slice(0, 200));
  return item;
}
