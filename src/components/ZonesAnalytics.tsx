// Analytics di tempo trascorso in ciascuna zona FC, su un periodo selezionabile.
// Include check 80/20 polarizzato (Seiler 2010, Stöggl/Sperlich 2014).

import { useEffect, useMemo, useState } from "react";
import { getJSON } from "../lib/storage";
import { getLastNDays } from "../lib/diaryContext";
import { computeZones, timeInZones, polarizationCheck, type ZonesResult, type TimeInZone } from "../lib/coach/zones";
import type { UserProfile } from "../lib/types";
import { events } from "../lib/events";

const ZONE_COLORS: Record<number, string> = {
  1: "#10B981", 2: "#22C55E", 3: "#EAB308", 4: "#F97316", 5: "#EF4444",
};

type Period = 7 | 14 | 30 | 90;

export default function ZonesAnalytics() {
  const [period, setPeriod] = useState<Period>(30);
  const [zones, setZones] = useState<ZonesResult | null>(null);
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const profile = await getJSON<UserProfile | null>("user-profile", null);
    if (!profile) { setZones(null); setLoading(false); return; }
    const days = await getLastNDays(Math.max(period, 60));
    const allWorkouts: any[] = [];
    let latestMorningHR: number | null = null;
    for (const d of [...days].sort((a, b) => b.date.localeCompare(a.date))) {
      allWorkouts.push(...((d.workouts || []).map((w: any) => ({ ...w, _date: d.date }))));
      if (latestMorningHR === null && d.daily && typeof d.daily.morningHR === "string" && d.daily.morningHR) {
        const n = Number(d.daily.morningHR);
        if (Number.isFinite(n) && n >= 35 && n <= 100) latestMorningHR = n;
      }
    }
    setZones(computeZones({ profile, fcRestLatest: latestMorningHR, recentWorkouts: allWorkouts }));
    setWorkouts(allWorkouts);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const offW = events.on("workout:saved", load);
    const offD = events.on("daily:saved", load);
    const offP = events.on("profile:updated", load);
    return () => { offW(); offD(); offP(); };
  }, [period]);

  const { tiz, totalMin, polar, totalSessions } = useMemo(() => {
    if (!zones) return { tiz: [] as TimeInZone[], totalMin: 0, polar: { lowPct: 0, highPct: 0, isPolarized: false }, totalSessions: 0 };
    // Filtra workout nell'intervallo selezionato
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    const y = cutoff.getFullYear();
    const m = String(cutoff.getMonth() + 1).padStart(2, "0");
    const d = String(cutoff.getDate()).padStart(2, "0");
    const cutoffKey = `${y}-${m}-${d}`;
    const filtered = workouts.filter(w => w._date >= cutoffKey);
    const tiz = timeInZones(filtered, zones.zones);
    const totalMin = tiz.reduce((a, z) => a + z.minutes, 0);
    const totalSessions = tiz.reduce((a, z) => a + z.sessionCount, 0);
    const polar = polarizationCheck(tiz);
    return { tiz, totalMin, polar, totalSessions };
  }, [zones, workouts, period]);

  // Soglia minima per mostrare il check 80/20: con meno di 4 sessioni di corsa
  // la distribuzione è statisticamente rumorosa (una singola corsa pesa 100%).
  const MIN_SESSIONS_FOR_POLAR = 4;
  const enoughForPolar = totalSessions >= MIN_SESSIONS_FOR_POLAR;

  if (loading) return <div style={{ color: "#64748B", fontSize: "12px", padding: "8px 0" }}>Calcolo analytics…</div>;
  if (!zones) return null;

  const maxMin = Math.max(1, ...tiz.map(z => z.minutes));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "6px", background: "#1A1A2E", padding: "4px", borderRadius: "10px" }}>
        {([7, 14, 30, 90] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            flex: 1, padding: "8px", borderRadius: "8px",
            background: period === p ? "#16213E" : "transparent",
            border: "none", color: period === p ? "#E2E8F0" : "#94A3B8",
            fontSize: "12px", fontWeight: 700, cursor: "pointer",
          }}>{p}gg</button>
        ))}
      </div>

      {totalMin === 0 ? (
        <div style={{ color: "#94A3B8", fontSize: "13px", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
          Nessuna corsa con FC registrata negli ultimi {period} giorni. Registra le sessioni con fc_media per vedere il tempo per zona.
        </div>
      ) : (
        <>
          <div style={{ background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "14px" }}>
            <div style={{ fontSize: "11px", color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px", fontWeight: 600 }}>
              Tempo per zona — ultimi {period} giorni ({totalMin} min totali)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {tiz.map(t => {
                const pct = totalMin ? Math.round((t.minutes / totalMin) * 100) : 0;
                const barW = maxMin ? (t.minutes / maxMin) * 100 : 0;
                const color = ZONE_COLORS[t.zoneIndex];
                return (
                  <div key={t.zoneIndex} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ minWidth: "28px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color, fontSize: "13px" }}>
                      Z{t.zoneIndex}
                    </div>
                    <div style={{ flex: 1, background: "#0F172A", borderRadius: "6px", height: "22px", position: "relative", overflow: "hidden" }}>
                      <div style={{
                        width: `${barW}%`, height: "100%",
                        background: color, opacity: 0.7,
                        transition: "width 0.2s ease",
                      }} />
                      <div style={{
                        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                        display: "flex", alignItems: "center", padding: "0 10px",
                        fontSize: "11px", fontWeight: 700, color: "#E2E8F0",
                      }}>
                        <span>{t.minutes} min</span>
                        <span style={{ marginLeft: "auto", color: "#94A3B8" }}>{pct}% · {t.sessionCount} sess.</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {enoughForPolar ? (
            <div style={{
              background: polar.isPolarized ? "#14532D20" : "#78350F20",
              border: `1px solid ${polar.isPolarized ? "#22C55E66" : "#F59E0B66"}`,
              borderRadius: "12px", padding: "14px",
            }}>
              <div style={{ fontSize: "11px", color: polar.isPolarized ? "#22C55E" : "#F59E0B", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px", fontWeight: 700 }}>
                Distribuzione polarizzata (Seiler 80/20)
              </div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#E2E8F0", fontFamily: "'JetBrains Mono', monospace", marginBottom: "6px" }}>
                {polar.lowPct}% / {polar.highPct}%
              </div>
              <div style={{ fontSize: "12px", color: "#CBD5E1", lineHeight: 1.5 }}>
                {polar.isPolarized
                  ? `✓ Distribuzione polarizzata ok. Passi ${polar.lowPct}% del tempo in Z1+Z2 (bassa intensità) e ${polar.highPct}% in Z3+Z4+Z5 (alta intensità). Il modello 80/20 è quello che massimizza i guadagni endurance (Seiler 2010, Stöggl/Sperlich 2014).`
                  : `⚠ Distribuzione sbilanciata: solo ${polar.lowPct}% in bassa intensità (target ≥75%). Probabilmente stai correndo troppo forte le sessioni "easy". Rallenta i fondi lenti: più volume a bassa intensità produce più miglioramento VO2max.`}
              </div>
            </div>
          ) : (
            <div style={{
              background: "#1E293B40", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px", padding: "12px 14px",
              fontSize: "12px", color: "#94A3B8", lineHeight: 1.5,
            }}>
              Distribuzione polarizzata non ancora calcolabile: servono almeno {MIN_SESSIONS_FOR_POLAR} sessioni di corsa con FC nell'intervallo (hai {totalSessions}). Con pochi campioni il rapporto Z1+Z2 vs Z3+Z4+Z5 è dominato da una singola corsa e non è indicativo.
            </div>
          )}
        </>
      )}

      <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.5, fontStyle: "italic" }}>
        Limite noto: senza sample HR granulari (solo fc_media per sessione), ogni corsa è assegnata a UNA zona. Una Fartlek o interval session con FC media 145 bpm viene bucket in Z2/Z3 anche se i picchi erano in Z5 — leggi il dato come approssimazione.
      </div>
    </div>
  );
}
