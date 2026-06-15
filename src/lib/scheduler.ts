import { getJSON, setJSON, storage } from "./storage";
import { todayISO, mondayOf } from "./time";
import { generateWeeklyReport } from "./coach/weeklyReport";
import { regenerateNextWeek } from "./coach/planGenerator";
import { savePlanWithHistory, saveNextPlan } from "./coach/planHistory";
import type { CoachFeedItem, TrainingPlan, UserProfile, UserGoal, WeeklyReportSummary } from "./types";
import { buildCoachContext } from "./diaryContext";
import { hasApiKey } from "./gemini";
import { events } from "./events";

const LAST_REPORT_KEY = "last-weekly-report-date"; // YYYY-MM-DD

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
  return todayISO(); // fonte unica time.ts (era impl. locale duplicata)
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
    const profile = await getJSON<UserProfile | null>("user-profile", null);
    if (!profile) return null;

    const report = await generateWeeklyReport();
    // Fix A3 (Fase 1): la data è marcata DOPO il successo della generazione.
    // Prima era scritta in anticipo "per evitare duplicati", ma i duplicati
    // sono già coperti dal lock in-memory + soft-mutex cross-tab (TTL 60s);
    // il costo reale era che un errore LLM il lunedì consumava il giorno:
    // niente report né piano fino al retry retroattivo (>=7 giorni).
    await setJSON(LAST_REPORT_KEY, todayStr);
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
      // Fix C2 (Fase 1): stesso routing dello slot del path manuale
      // (TrainingPlanView.handleRegenerate). Prima la regen "next-week" — che
      // in mode next-week ha startDate = lunedì PROSSIMO anche quando gira di
      // lunedì — finiva SEMPRE nello slot corrente: ogni lunedì il piano
      // appena iniziato veniva archiviato e sostituito da quello della
      // settimana dopo (nessuna riga OGGI per tutta la settimana).
      const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
      const newPlanStart = nextPlan.startDate ? new Date(`${nextPlan.startDate}T00:00:00`) : todayMid;
      const currentStillActive = !!currentPlan && !!currentPlan.validUntil && new Date(currentPlan.validUntil) > todayMid;
      const currentIsStale = (() => {
        if (!currentPlan?.startDate) return false;
        const planStart = new Date(`${currentPlan.startDate}T00:00:00`);
        return Math.floor((todayMid.getTime() - planStart.getTime()) / 86400000) > 7;
      })();
      const saveAsPreview = currentStillActive && newPlanStart > todayMid && !currentIsStale;
      if (saveAsPreview) {
        // Piano corrente ancora attivo: la nuova settimana va in anteprima.
        // maybePromoteNextPlan la attiverà al lunedì (App mount / load Piano).
        await saveNextPlan(nextPlan);
      } else {
        // Slot corrente: o non c'è un piano valido per questa settimana, o è
        // stale/scaduto. La regen "next-week" ha startDate = lunedì PROSSIMO:
        // metterla così nello slot corrente lascerebbe todayPlanWeekNumber=0
        // per tutta la settimana (il bug C2, nel caso stale/bootstrap). Ri-
        // ancoriamo startDate al lunedì CORRENTE — il piano è di fatto quello
        // di questa settimana. validUntil (now+14gg) la copre comunque.
        const currentMonday = mondayOf(todayISO()) ?? todayISO();
        await savePlanWithHistory({ ...nextPlan, startDate: currentMonday });
      }
      events.emit("plan:updated", { at: new Date().toISOString() });

      const planUpdate: CoachFeedItem = {
        id: Date.now().toString(36) + "p",
        date: new Date().toISOString(),
        type: "plan-update",
        title: saveAsPreview ? "Prossima settimana in anteprima" : "Piano aggiornato",
        severity: "info",
        content: saveAsPreview
          ? `La settimana corrente resta attiva; la prossima è pronta e si attiverà lunedì.\n\n${nextPlan.rationale}`
          : nextPlan.rationale,
      };
      const f2 = await getJSON<CoachFeedItem[]>("coach-feed", []);
      f2.unshift(planUpdate);
      await setJSON("coach-feed", f2.slice(0, 200));
    } catch (e) {
      console.error("[scheduler] plan regen failed", e);
      // Fix A3-bis (Fase 1): prima il fallimento era solo un console.error e
      // l'utente restava col piano vecchio senza saperlo. Ora lo dice il feed.
      try {
        const ferr = await getJSON<CoachFeedItem[]>("coach-feed", []);
        ferr.unshift({
          id: Date.now().toString(36) + "e",
          date: new Date().toISOString(),
          type: "alert",
          title: "Aggiornamento piano non riuscito",
          severity: "warn",
          content: "Il report settimanale è pronto, ma la rigenerazione del piano è fallita (problema temporaneo del modello o di rete). Il piano attuale resta attivo: puoi riprovare con \"Aggiorna piano\" dal tab Piano.",
        });
        await setJSON("coach-feed", ferr.slice(0, 200));
      } catch { /* best-effort */ }
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

// Motivation check-in: feature rimossa (dead code — `maybeRunMotivationCheckIn`
// non era chiamata da nessun punto dell'app; vedi audit Fase 3).
