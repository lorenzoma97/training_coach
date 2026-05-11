// ReadinessBanner — Wave 4.3 (UI rinnovata).
//
// Mostra un banner in cima al tab "Plan" basato sulla snapshot di readiness
// di OGGI (G7). Tre stati di rendering:
//   - band="low"  + date=oggi → banner amber con score, rationale, CTA dettagli
//   - band="high" + date=oggi → banner verde motivazionale (opzionale)
//   - band="moderate" o nessuna snapshot → no render (banner presente solo per
//     edge utili — "moderate" = stato tipico, niente segnale visivo)
//
// Side-effects:
//   - all'mount carica `getCurrentReadiness()` (async, lazy compute)
//   - listener su `data:externalChange` con key === "readiness-history" per
//     re-leggere quando la snapshot viene aggiornata (es. import wearable).
//
// Stile: Tailwind utility-first, niente nuovi CSS files. Italiano.

import { useEffect, useState } from "react";
import { events } from "../../lib/events";
import {
  getCurrentReadiness,
  READINESS_HISTORY_KEY,
} from "../../lib/coach/readinessScoring";
import type { ReadinessSnapshot } from "../../lib/types/readiness";

/** Trim del rationale completo a max N chars (UI compact). */
function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/** YYYY-MM-DD locale-agnostic (UTC slice). Usato per match snapshot.date. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface ReadinessBannerProps {
  /**
   * Override per test (DI). In produzione è undefined → usa
   * `getCurrentReadiness` reale.
   */
  loader?: () => Promise<ReadinessSnapshot | null>;
}

export function ReadinessBanner({ loader }: ReadinessBannerProps = {}) {
  const [snap, setSnap] = useState<ReadinessSnapshot | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const fn = loader ?? getCurrentReadiness;
        const s = await fn();
        if (!cancelled) setSnap(s);
      } catch {
        if (!cancelled) setSnap(null);
      }
    };
    load();
    const off = events.on("data:externalChange", ({ key }) => {
      if (key === READINESS_HISTORY_KEY) load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [loader]);

  if (!snap) return null;
  const today = todayIso();
  if (snap.date !== today) return null;

  // Rationale compatto da components: ricostruiamo bullet brevi (lo
  // ReadinessSnapshot persistito non porta `rationale` field, lo deriviamo
  // dai components per coerenza con il calcolo originale).
  const bullets: string[] = [];
  const c = snap.components ?? {};
  if (typeof c.hrvDelta === "number") {
    const sign = c.hrvDelta >= 0 ? "+" : "";
    bullets.push(`HRV ${sign}${c.hrvDelta}ms vs baseline`);
  }
  if (typeof c.sleepScore === "number") {
    bullets.push(`sleep score ${c.sleepScore}/100`);
  }
  if (typeof c.subjectiveScore === "number") {
    bullets.push(`freschezza ${c.subjectiveScore}/100`);
  }
  if (typeof c.soreness === "number") {
    bullets.push(`DOMS ${c.soreness}/100`);
  }
  const compactRationale = truncate(bullets.slice(0, 2).join(" · "), 100);

  if (snap.band === "low") {
    return (
      <div
        role="alert"
        aria-label="Readiness bassa"
        style={{
          backgroundColor: "#fef3c7", // amber-100
          color: "#78350f",           // amber-900
          border: "1px solid #fcd34d", // amber-300
          borderRadius: "12px",
          padding: "12px 16px",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Readiness bassa
          </span>
          <span style={{ fontFamily: "monospace", fontSize: "13px" }}>
            {snap.score}/100 · {snap.band}
          </span>
        </div>
        {compactRationale && (
          <div style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.35 }}>{compactRationale}</div>
        )}
        <div style={{ fontSize: "12px", marginTop: "8px", fontStyle: "italic" }}>
          Le sessioni Z4-5 di oggi sono state abbassate a Z3 automaticamente.
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(s => !s)}
          aria-expanded={showDetails}
          style={{
            marginTop: "8px",
            fontSize: "12px",
            fontWeight: 700,
            textDecoration: "underline",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            color: "inherit",
            padding: 0,
          }}
        >
          {showDetails ? "Nascondi dettagli" : "Vedi dettagli"}
        </button>
        {showDetails && (
          <div style={{
            marginTop: "8px",
            fontSize: "12px",
            borderTop: "1px solid #fcd34d",
            paddingTop: "8px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}>
            {typeof c.hrvDelta === "number" && (
              <div>HRV delta: {c.hrvDelta >= 0 ? "+" : ""}{c.hrvDelta} ms</div>
            )}
            {typeof c.sleepScore === "number" && (
              <div>Sleep score: {c.sleepScore}/100</div>
            )}
            {typeof c.subjectiveScore === "number" && (
              <div>Freschezza soggettiva: {c.subjectiveScore}/100</div>
            )}
            {typeof c.soreness === "number" && (
              <div>Soreness/DOMS: {c.soreness}/100</div>
            )}
            {snap.appliedAdjustment && snap.appliedAdjustment !== "none" && (
              <div>Aggiustamento applicato: {snap.appliedAdjustment}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (snap.band === "high") {
    return (
      <div
        role="status"
        aria-label="Readiness alta"
        style={{
          backgroundColor: "#d1fae5", // emerald-100
          color: "#064e3b",           // emerald-900
          border: "1px solid #6ee7b7", // emerald-300
          borderRadius: "12px",
          padding: "8px 16px",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Pronto a spingere
          </span>
          <span style={{ fontFamily: "monospace", fontSize: "13px" }}>
            {snap.score}/100 · {snap.band}
          </span>
        </div>
      </div>
    );
  }

  // band === "moderate" → no render
  return null;
}

export default ReadinessBanner;
