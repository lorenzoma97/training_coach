import { useEffect } from "react";
import { events } from "../lib/events";
import { hasApiKey } from "../lib/gemini";
import { analyzeSession } from "../lib/coach/sessionFeedback";
import { getJSON, setJSON } from "../lib/storage";
import type { CoachFeedItem } from "../lib/types";
import { checkLocalRedFlags } from "../lib/coach/safetyRules";
import { getLastNDays } from "../lib/diaryContext";
import { computeZones } from "../lib/coach/zones";

// Append atomico al feed (re-legge prima di scrivere per minimizzare race)
async function appendFeed(item: CoachFeedItem): Promise<void> {
  const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
  feed.unshift(item);
  await setJSON("coach-feed", feed.slice(0, 200));
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
            const z = computeZones({ profile, fcRestLatest: latestMorningHR, recentWorkouts: workoutsFlat }).zones.find(x => x.index === 2);
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
