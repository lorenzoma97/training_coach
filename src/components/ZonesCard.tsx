// Card "Le mie zone FC": cascade Tanaka → Karvonen → Empirica.
// - compact=true: mini badge per il Piano (mostra solo Z2 + method).
// - compact=false: grid completo Z1-Z5 con RPE + passo tipico in Z2.

import { useEffect, useState } from "react";
import { getJSON } from "../lib/storage";
import { getLastNDays } from "../lib/diaryContext";
import { computeZones, formatPace, type ZonesResult, type Zone } from "../lib/coach/zones";
import type { UserProfile } from "../lib/types";
import { events } from "../lib/events";
import { colors, fonts, fontSize, radius, ZONE_COLORS } from "../lib/designTokens";

// Cache module-level 1-slot per computeZones: quando ZonesCard è montato più
// volte nella stessa pagina (es. compact + full, o più highlightZone diversi
// nel piano), evita di ricalcolare le zone N volte. Key = hash del profilo
// stringificato + workoutCount + fcRest. Invalidazione esplicita via listener
// sugli stessi eventi che triggerano reload (`workout:saved`, `daily:saved`,
// `profile:updated`).
let zonesCacheKey: string | null = null;
let zonesCacheResult: ZonesResult | null = null;
const invalidateZonesCache = () => { zonesCacheKey = null; zonesCacheResult = null; };
// Attach listener a livello modulo: una sola iscrizione per l'intera app,
// non per-instance (idempotente — events.on ritorna offFn, mai richiamato).
let invalidationAttached = false;
function ensureInvalidationListeners() {
  if (invalidationAttached) return;
  invalidationAttached = true;
  events.on("workout:saved", invalidateZonesCache);
  events.on("daily:saved", invalidateZonesCache);
  events.on("profile:updated", invalidateZonesCache);
}
function computeZonesCached(
  profile: UserProfile,
  fcRestLatest: number | null,
  workouts: any[],
): ZonesResult {
  ensureInvalidationListeners();
  const key = `${JSON.stringify(profile)}|${workouts.length}|${fcRestLatest ?? "-"}`;
  if (key === zonesCacheKey && zonesCacheResult) return zonesCacheResult;
  const r = computeZones({ profile, fcRestLatest, recentWorkouts: workouts });
  zonesCacheKey = key;
  zonesCacheResult = r;
  return r;
}

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
    setResult(computeZonesCached(profile, latestMorningHR, workouts));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const offW = events.on("workout:saved", load);
    const offD = events.on("daily:saved", load);
    const offP = events.on("profile:updated", load);
    return () => { offW(); offD(); offP(); };
  }, []);

  if (loading) return <div style={{ color: colors.textDim, fontSize: fontSize.sm, padding: "8px 0" }}>Calcolo zone…</div>;
  if (!result) return (
    <div style={{ textAlign: "center", color: colors.textSecondary, padding: "40px 20px", fontSize: fontSize.base }}>
      <div style={{ fontSize: "40px", marginBottom: "10px" }} aria-hidden="true">👤</div>
      <div style={{ fontWeight: 600 }}>Profilo mancante.</div>
      <div style={{ fontSize: fontSize.sm, color: colors.textMuted, marginTop: "6px", lineHeight: 1.5 }}>
        Completa l'onboarding con età, FCrest e (se disponibile) FCmax testata per calcolare le tue 5 zone FC personalizzate.
      </div>
    </div>
  );

  const methodBadge = {
    lthr:     { label: "LTHR FRIEL", color: colors.success },
    tested:   { label: "FCMAX TESTATA", color: colors.success },
    karvonen: { label: "KARVONEN (FC RIP)", color: colors.info },
    tanaka:   { label: "STIMA TANAKA (ETÀ)", color: colors.textMuted },
  }[result.method];

  // ------- COMPACT mode (piano) -------
  if (compact) {
    const zHi = result.zones.find(z => z.index === (highlightZone ?? 2))!;
    const c = ZONE_COLORS[zHi.index];
    return (
      <div style={{
        background: c.bg, border: `1px solid ${c.border}`,
        borderRadius: radius.lg, padding: "10px 12px",
        display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
      }}>
        <div style={{ fontSize: fontSize.xs, fontWeight: 700, color: c.text, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          La tua {zHi.shortLabel}
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: fontSize.base, fontWeight: 700, color: colors.textPrimary }}>
          {zHi.hrLow}-{zHi.hrHigh} bpm
        </div>
        {zHi.paceTypicalSec && (
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
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
        <div style={{ fontSize: fontSize.xs, fontWeight: 700, color: colors.accent, letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: fonts.mono }}>
          Le mie zone FC
        </div>
        <div style={{ fontSize: "10px", fontWeight: 700, color: methodBadge.color, letterSpacing: "0.08em" }}>
          · {methodBadge.label}
        </div>
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginLeft: "auto", fontFamily: fonts.mono }}>
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
              background: isHi ? c.bg : colors.bgElevated,
              border: `1px solid ${isHi ? c.border : colors.border}`,
              borderRadius: radius.lg, padding: "10px 12px",
              // flexWrap rimosso: su mobile stretto il middle-col (nome zona)
              // si restringe e wrappa il suo testo INTERNAMENTE, mantenendo
              // il bpm sulla stessa riga (come nel layout desktop).
              display: "flex", gap: "10px", alignItems: "center",
            }}>
              <div style={{
                minWidth: "32px", textAlign: "center",
                fontFamily: fonts.mono, fontWeight: 800, fontSize: fontSize.md,
                color: c.text, flexShrink: 0,
              }}>
                {z.shortLabel}
              </div>
              {/* Middle: minWidth 0 permette al flex item di restringersi
                  sotto il contenuto e wrappare il testo invece di crescere */}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ fontSize: fontSize.base, fontWeight: 700, color: colors.textPrimary, lineHeight: 1.25 }}>{z.name}</div>
                <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: "2px", lineHeight: 1.3 }}>{z.usageHint}</div>
              </div>
              <div style={{
                fontFamily: fonts.mono, fontSize: fontSize.base, fontWeight: 700,
                color: c.text, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap",
              }}>
                {z.hrLow}-{z.hrHigh} bpm
                <div style={{ fontSize: "10px", color: colors.textMuted, fontWeight: 500 }}>
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
          borderRadius: radius.lg,
          padding: "10px 12px",
          fontSize: fontSize.sm,
          // #F59E0B (amber 500) passa contrast 4.8:1 su bg #F9731615.
          // Il vecchio #FDBA74 (amber 300) era a 2.8:1 — fallimento WCAG AA.
          color: colors.warning,
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, fontSize: fontSize.xs, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "4px", color: "#F97316" }}>
            <span aria-hidden="true">⚠ </span>Osservazione dai tuoi fondi lenti
          </div>
          {result.empiricalHintMessage}
        </div>
      )}

      <details style={{ fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        <summary style={{ cursor: "pointer", padding: "6px 0", listStyle: "none", color: colors.textMuted, fontWeight: 600 }}>
          Come sono calcolate le zone ›
        </summary>
        <div style={{ padding: "4px 0 8px" }}>{result.methodExplanation}</div>
      </details>
    </div>
  );
}
