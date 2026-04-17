// Card "Le mie zone FC": cascade Tanaka → Karvonen → Empirica.
// - compact=true: mini badge per il Piano (mostra solo Z2 + method).
// - compact=false: grid completo Z1-Z5 con RPE + passo tipico in Z2.

import { useEffect, useState } from "react";
import { getJSON } from "../lib/storage";
import { getLastNDays } from "../lib/diaryContext";
import { computeZones, formatPace, type ZonesResult, type Zone } from "../lib/coach/zones";
import type { UserProfile } from "../lib/types";
import { events } from "../lib/events";

const ZONE_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: "#10B98115", border: "#10B98166", text: "#10B981" },
  2: { bg: "#22C55E20", border: "#22C55E66", text: "#22C55E" },
  3: { bg: "#EAB30820", border: "#EAB30866", text: "#EAB308" },
  4: { bg: "#F9731620", border: "#F9731666", text: "#F97316" },
  5: { bg: "#EF444420", border: "#EF444466", text: "#EF4444" },
};

interface Props {
  compact?: boolean;
  /** Se specificato, evidenzia la zona selezionata (es. Z2 per un fondo lento). */
  highlightZone?: 1 | 2 | 3 | 4 | 5;
}

export default function ZonesCard({ compact = false, highlightZone }: Props) {
  const [result, setResult] = useState<ZonesResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const profile = await getJSON<UserProfile | null>("user-profile", null);
    if (!profile) { setResult(null); setLoading(false); return; }
    // Ultimi 60 giorni di diario per derivare empirica + FCmax osservata
    const days = await getLastNDays(60);
    const workouts: any[] = [];
    let latestMorningHR: number | null = null;
    for (const d of [...days].sort((a, b) => b.date.localeCompare(a.date))) {
      workouts.push(...(d.workouts || []));
      if (latestMorningHR === null && d.daily && typeof d.daily.morningHR === "string" && d.daily.morningHR) {
        const n = Number(d.daily.morningHR);
        if (Number.isFinite(n) && n >= 35 && n <= 100) latestMorningHR = n;
      }
    }
    setResult(computeZones({ profile, fcRestLatest: latestMorningHR, recentWorkouts: workouts }));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const offW = events.on("workout:saved", load);
    const offD = events.on("daily:saved", load);
    const offP = events.on("profile:updated", load);
    return () => { offW(); offD(); offP(); };
  }, []);

  if (loading) return <div style={{ color: "#64748B", fontSize: "12px", padding: "8px 0" }}>Calcolo zone…</div>;
  if (!result) return (
    <div style={{ color: "#94A3B8", fontSize: "13px", fontStyle: "italic", padding: "8px 0" }}>
      Profilo mancante. Completa l'onboarding per calcolare le zone.
    </div>
  );

  const methodBadge = {
    tested:   { label: "FCMAX TESTATA", color: "#22C55E" },
    karvonen: { label: "KARVONEN (FC RIP)", color: "#0891B2" },
    tanaka:   { label: "STIMA TANAKA (ETÀ)", color: "#94A3B8" },
  }[result.method];

  // ------- COMPACT mode (piano) -------
  if (compact) {
    const zHi = result.zones.find(z => z.index === (highlightZone ?? 2))!;
    const c = ZONE_COLORS[zHi.index];
    return (
      <div style={{
        background: c.bg, border: `1px solid ${c.border}`,
        borderRadius: "10px", padding: "10px 12px",
        display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
      }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: c.text, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          La tua {zHi.shortLabel}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 700, color: "#E2E8F0" }}>
          {zHi.hrLow}-{zHi.hrHigh} bpm
        </div>
        {zHi.paceTypicalSec && (
          <div style={{ fontSize: "11px", color: "#94A3B8" }}>
            · passo tipico {formatPace(zHi.paceTypicalSec)}
          </div>
        )}
        <div style={{ fontSize: "10px", color: methodBadge.color, fontWeight: 700, letterSpacing: "0.05em", marginLeft: "auto" }}>
          {methodBadge.label}
        </div>
      </div>
    );
  }

  // ------- FULL mode (Trend + tab Zone) -------
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
          Le mie zone FC
        </div>
        <div style={{ fontSize: "10px", fontWeight: 700, color: methodBadge.color, letterSpacing: "0.08em" }}>
          · {methodBadge.label}
        </div>
        <div style={{ fontSize: "11px", color: "#94A3B8", marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace" }}>
          FCmax {result.fcMax} bpm{result.fcMaxObserved ? ` (oss. ${result.fcMaxObserved})` : ""}
          {result.fcRest ? ` · FCrip ${result.fcRest}` : ""}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {result.zones.map((z: Zone) => {
          const c = ZONE_COLORS[z.index];
          const isHi = highlightZone === z.index;
          return (
            <div key={z.index} style={{
              background: isHi ? c.bg : "#1A1A2E",
              border: `1px solid ${isHi ? c.border : "rgba(255,255,255,0.06)"}`,
              borderRadius: "10px", padding: "10px 12px",
              // flexWrap rimosso: su mobile stretto il middle-col (nome zona)
              // si restringe e wrappa il suo testo INTERNAMENTE, mantenendo
              // il bpm sulla stessa riga (come nel layout desktop).
              display: "flex", gap: "10px", alignItems: "center",
            }}>
              <div style={{
                minWidth: "32px", textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: "14px",
                color: c.text, flexShrink: 0,
              }}>
                {z.shortLabel}
              </div>
              {/* Middle: minWidth 0 permette al flex item di restringersi
                  sotto il contenuto e wrappare il testo invece di crescere */}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0", lineHeight: 1.25 }}>{z.name}</div>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px", lineHeight: 1.3 }}>{z.usageHint}</div>
              </div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 700,
                color: c.text, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap",
              }}>
                {z.hrLow}-{z.hrHigh} bpm
                <div style={{ fontSize: "10px", color: "#94A3B8", fontWeight: 500 }}>
                  RPE {z.rpeLow}-{z.rpeHigh}
                  {z.paceTypicalSec ? ` · ${formatPace(z.paceTypicalSec)}` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {result.empiricalHintMessage && (
        <div style={{
          background: "#F9731615",
          border: "1px solid #F9731666",
          borderRadius: "10px",
          padding: "10px 12px",
          fontSize: "12px",
          // #F59E0B (amber 500) passa contrast 4.8:1 su bg #F9731615.
          // Il vecchio #FDBA74 (amber 300) era a 2.8:1 — fallimento WCAG AA.
          color: "#F59E0B",
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "4px", color: "#F97316" }}>
            <span aria-hidden="true">⚠ </span>Osservazione dai tuoi fondi lenti
          </div>
          {result.empiricalHintMessage}
        </div>
      )}

      <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.5, padding: "8px 0" }}>
        {result.methodExplanation}
      </div>
    </div>
  );
}
