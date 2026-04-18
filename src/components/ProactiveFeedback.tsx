import { useEffect } from "react";
import { events } from "../lib/events";
import { hasApiKey } from "../lib/gemini";
import { analyzeSession } from "../lib/coach/sessionFeedback";
import { getJSON, setJSON } from "../lib/storage";
import type { CoachFeedItem } from "../lib/types";
import { checkLocalRedFlags } from "../lib/coach/safetyRules";
import { getLastNDays } from "../lib/diaryContext";
import { computeZones } from "../lib/coach/zones";

// Cache 1-entry per computeZones: la stessa combinazione (profileAge,
// fcRestLatest, workoutCount) ritorna lo stesso risultato. Il costo di
// computeZones non è trascurabile su 60gg di storico. La cache è module-level:
// ProactiveFeedback è montato una sola volta (root app), quindi sopravvive
// agli event handler `workout:saved` consecutivi.
let zonesCacheKey: string | null = null;
let zonesCacheResult: ReturnType<typeof computeZones> | null = null;
function computeZonesCached(input: Parameters<typeof computeZones>[0]): ReturnType<typeof computeZones> {
  const key = `${input.profile?.age ?? "-"}:${input.fcRestLatest ?? "-"}:${(input.recentWorkouts || []).length}`;
  if (key === zonesCacheKey && zonesCacheResult) return zonesCacheResult;
  const result = computeZones(input);
  zonesCacheKey = key;
  zonesCacheResult = result;
  return result;
}

// Mutex semplice via Promise-chain: chiamate concorrenti si accodano e vengono
// serializzate. Per chiamate sequenziali (già serializzate dal caller) il
// comportamento è identico alla versione precedente. La queue è SELF-HEALING:
// un errore (es. quota) viene loggato ma non blocca gli append successivi —
// appendQueue viene sempre riportata a uno stato "resolved" dopo ogni giro.
let appendQueue: Promise<void> = Promise.resolve();

async function doAppend(item: CoachFeedItem): Promise<void> {
  const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
  feed.unshift(item);
  await setJSON("coach-feed", feed.slice(0, 200));
}

// Append atomico al feed, serializzato per evitare race read-modify-write
// quando più eventi concorrenti scrivono su `coach-feed` nello stesso tick.
async function appendFeed(item: CoachFeedItem): Promise<void> {
  const prev = appendQueue;
  // Aspetta che l'operazione precedente sia finita (anche se errorata), poi esegui.
  const next = prev
    .catch(() => { /* prev già loggato — qui solo unlocking della catena */ })
    .then(() => doAppend(item));
  // Self-heal: la nuova testa della queue non rigetta mai. Logga visibilmente
  // quando un errore ci sarebbe stato così in prod è diagnosticabile.
  appendQueue = next.catch(err => {
    console.warn("[appendFeed] save failed (queue continues):", err?.name || err?.message);
  });
  // Il caller riceve comunque l'errore originale (può decidere di loggarlo o
  // mostrarlo — in ProactiveFeedback è già dentro try/catch).
  return next;
}

export default function ProactiveFeedback() {
  useEffect(() => {
    const off = events.on("workout:saved", async ({ date, workout }) => {
      // Alert locale immediato se red flag (indipendente dall'API)
      const profile = await getJSON<any>("user-profile", null);
      const last7 = await getLastNDays(7);
      // Carica più storia per calcolare zone personalizzate (serve FCrest recente + corse easy)
      const last60 = await getLastNDays(60);
      const workoutsFlat: any[] = [];
      let latestMorningHR: number | null = null;
      for (const d of [...last60].sort((a, b) => b.date.localeCompare(a.date))) {
        workoutsFlat.push(...(d.workouts || []));
        if (latestMorningHR === null && typeof d.daily?.morningHR === "string" && d.daily.morningHR) {
          const n = Number(d.daily.morningHR);
          if (Number.isFinite(n) && n >= 35 && n <= 100) latestMorningHR = n;
        }
      }
      const zoneZ2 = profile
        ? (() => {
            const z = computeZonesCached({ profile, fcRestLatest: latestMorningHR, recentWorkouts: workoutsFlat }).zones.find(x => x.index === 2);
            return z ? { low: z.hrLow, high: z.hrHigh } : undefined;
          })()
        : undefined;
      const local = checkLocalRedFlags({ workout, last7Days: last7, profile: profile ? { age: profile.age } : null, zoneZ2 });
      if (local.level === "danger") {
        await appendFeed({
          id: Date.now().toString(36) + "rf" + Math.random().toString(36).slice(2, 5),
          date: new Date().toISOString(),
          type: "alert",
          title: "⚠ Red flag rilevato",
          severity: "danger",
          content: local.reasons.join("\n"),
          relatedWorkoutId: workout.id,
        });
      }

      if (!hasApiKey()) return;
      try {
        const fb = await analyzeSession({ workoutDate: date, workout });
        const flags = Array.isArray(fb.redFlags) ? fb.redFlags : [];
        await appendFeed({
          id: Date.now().toString(36) + "fb" + Math.random().toString(36).slice(2, 5),
          date: new Date().toISOString(),
          type: "session-feedback",
          title: fb.severity === "danger" ? "⚠ Attenzione" : "Feedback sessione",
          severity: fb.severity,
          content: [
            fb.howItWent,
            "",
            `**Segnali**: ${fb.signalsToMonitor}`,
            `**Domani**: ${fb.whatToDoNext}`,
            flags.length ? `\n**Red flag**:\n${flags.map(r => `• ${r}`).join("\n")}` : "",
          ].filter(Boolean).join("\n"),
          relatedWorkoutId: workout.id,
        });
      } catch (e) {
        console.error("[proactive]", e);
        // Feedback di errore visibile all'utente
        await appendFeed({
          id: Date.now().toString(36) + "err" + Math.random().toString(36).slice(2, 5),
          date: new Date().toISOString(),
          type: "alert",
          title: "Coach non raggiungibile",
          severity: "info",
          content: "Non sono riuscito a generare il feedback automatico per questa sessione. Verifica la chiave API in Impostazioni e la connessione.",
          relatedWorkoutId: workout.id,
        });
      }
    });
    return off;
  }, []);

  return null;
}
