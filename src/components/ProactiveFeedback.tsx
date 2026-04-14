import { useEffect } from "react";
import { events } from "../lib/events";
import { hasApiKey } from "../lib/gemini";
import { analyzeSession } from "../lib/coach/sessionFeedback";
import { getJSON, setJSON } from "../lib/storage";
import type { CoachFeedItem } from "../lib/types";
import { checkLocalRedFlags } from "../lib/coach/safetyRules";
import { getLastNDays } from "../lib/diaryContext";

export default function ProactiveFeedback() {
  useEffect(() => {
    const off = events.on("workout:saved", async ({ date, workout }) => {
      // Alert locale immediato se red flag (indipendente dall'API)
      const profile = await getJSON<any>("user-profile", null);
      const last7 = await getLastNDays(7);
      const local = checkLocalRedFlags({ workout, last7Days: last7, profile: profile ? { age: profile.age } : null });
      if (local.level === "danger") {
        const alert: CoachFeedItem = {
          id: Date.now().toString(36) + "rf",
          date: new Date().toISOString(),
          type: "alert",
          title: "⚠ Red flag rilevato",
          severity: "danger",
          content: local.reasons.join("\n"),
          relatedWorkoutId: workout.id,
        };
        const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
        feed.unshift(alert);
        await setJSON("coach-feed", feed.slice(0, 200));
      }

      if (!hasApiKey()) return;
      try {
        const fb = await analyzeSession({ workoutDate: date, workout });
        const item: CoachFeedItem = {
          id: Date.now().toString(36) + "fb",
          date: new Date().toISOString(),
          type: "session-feedback",
          title: fb.severity === "danger" ? "⚠ Attenzione" : "Feedback sessione",
          severity: fb.severity,
          content: [
            fb.howItWent,
            "",
            `**Segnali**: ${fb.signalsToMonitor}`,
            `**Domani**: ${fb.whatToDoNext}`,
            fb.redFlags.length ? `\n**Red flag**:\n${fb.redFlags.map(r => `• ${r}`).join("\n")}` : "",
          ].filter(Boolean).join("\n"),
          relatedWorkoutId: workout.id,
        };
        const feed = await getJSON<CoachFeedItem[]>("coach-feed", []);
        feed.unshift(item);
        await setJSON("coach-feed", feed.slice(0, 200));
      } catch (e) {
        console.error("[proactive]", e);
      }
    });
    return off;
  }, []);

  return null;
}
