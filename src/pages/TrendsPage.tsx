import { useEffect, useMemo, useState } from "react";
import { getAllDays } from "../lib/diaryContext";
import { events } from "../lib/events";
import Sparkline, { type SparklinePoint } from "../components/Sparkline";
import LoadingSpinner from "../components/LoadingSpinner";

type Period = 7 | 14 | 30 | 90;

const PERIOD_LABELS: Record<Period, string> = {
  7: "7 giorni",
  14: "2 settimane",
  30: "30 giorni",
  90: "90 giorni",
};

interface DayData {
  date: string;
  daily?: any;
  workouts?: any[];
}

export default function TrendsPage() {
  const [period, setPeriod] = useState<Period>(30);
  const [allDays, setAllDays] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(Math.min(window.innerWidth - 56, 504));

  const loadDays = async () => {
    setLoading(true);
    const days = await getAllDays();
    setAllDays(days);
    setLoading(false);
  };

  useEffect(() => {
    loadDays();
    const onResize = () => setWidth(Math.min(window.innerWidth - 56, 504));
    window.addEventListener("resize", onResize);

    // Reagisce a salvataggi live nello STESSO tab (via event bus)
    const offLocal1 = events.on("workout:saved", loadDays);
    const offLocal2 = events.on("daily:saved", loadDays);
    // + cross-tab (altri dispositivi/finestre)
    const offExt = events.on("data:externalChange", ({ key }) => {
      if (key.startsWith("day:") || key === "diary-index") loadDays();
    });

    return () => {
      window.removeEventListener("resize", onResize);
      offLocal1();
      offLocal2();
      offExt();
    };
  }, []);

  // Series calcolate in base al periodo
  const seriesResult = useMemo(() => { try {
    // Aritmetica sulle date LOCALI: setDate(-N) è immune al DST
    // (il vecchio startTs + i*86400000 saltava il 29 marzo per il cambio CET→CEST)
    const today = new Date();
    today.setHours(12, 0, 0, 0); // mezzogiorno per evitare edge DST

    const days: Array<{ date: string; data?: DayData }> = [];
    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${dd}`;
      const found = allDays.find((x: DayData) => x.date === key);
      days.push({ date: key, data: found });
    }

    const toNum = (v: any): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const fieldSeries = (getter: (d: DayData | undefined) => number | null): SparklinePoint[] =>
      days.map(d => ({ date: d.date, value: getter(d.data) }));

    const weight = fieldSeries(d => toNum(d?.daily?.weight));
    const sleep = fieldSeries(d => toNum(d?.daily?.sleep));
    const fatigue = fieldSeries(d => toNum(d?.daily?.fatigue));
    const bodyFat = fieldSeries(d => toNum(d?.daily?.bodyFat));
    const muscleMass = fieldSeries(d => toNum(d?.daily?.muscleMass));
    const bodyWater = fieldSeries(d => toNum(d?.daily?.bodyWater));
    // Recovery markers: FC mattino + freschezza percepita (Saw 2016: questionari
    // soggettivi validi quanto HRV per overtraining detection).
    const morningHR = fieldSeries(d => toNum(d?.daily?.morningHR));
    const morningFreshness = fieldSeries(d => toNum(d?.daily?.morningFreshness));

    // FC mattino baseline: media degli ultimi 30 giorni (full window). Alert se
    // la media degli ultimi 7gg supera baseline +5bpm cronicamente (Plews 2014:
    // segnale di accumulo fatigue / overreaching). Solo se ≥10 punti baseline.
    let morningHRAlert: { baseline: number; recent: number; deltaBpm: number } | null = null;
    {
      const allHR = morningHR.map(p => p.value).filter((v): v is number => v != null);
      const recentHR = morningHR.slice(-7).map(p => p.value).filter((v): v is number => v != null);
      if (allHR.length >= 10 && recentHR.length >= 4) {
        const baseline = allHR.reduce((a, b) => a + b, 0) / allHR.length;
        const recent = recentHR.reduce((a, b) => a + b, 0) / recentHR.length;
        const deltaBpm = recent - baseline;
        if (deltaBpm >= 5) morningHRAlert = { baseline: Math.round(baseline), recent: Math.round(recent), deltaBpm: Math.round(deltaBpm * 10) / 10 };
      }
    }

    // Volume per giorno (totale minuti di tutti i workouts)
    const dailyVolume = fieldSeries(d => {
      if (!d?.workouts?.length) return 0;
      const tot = d.workouts.reduce((sum, w) => {
        const m = Number(w.fields?.durata_totale || w.fields?.durata || 0);
        return sum + (Number.isFinite(m) ? m : 0);
      }, 0);
      return tot > 0 ? tot : null;
    });

    // RPE medio per giorno
    const dailyRpeAvg = fieldSeries(d => {
      if (!d?.workouts?.length) return null;
      const rpes = d.workouts.map(w => toNum(w.rpe)).filter((v): v is number => v != null);
      if (!rpes.length) return null;
      return rpes.reduce((a, b) => a + b, 0) / rpes.length;
    });

    // Dolore max per zona (se qualsiasi workout ne ha)
    const painAreaDetector = new Set<string>();
    for (const d of days) {
      for (const w of d.data?.workouts || []) {
        if (!w.pain || typeof w.pain !== "object") continue;
        const isLegacy = "pre" in w.pain || "during" in w.pain || "post" in w.pain;
        if (isLegacy) painAreaDetector.add("polpaccio");
        else Object.keys(w.pain).forEach(k => painAreaDetector.add(k));
      }
    }
    const painByArea = Array.from(painAreaDetector).map(area => ({
      area,
      series: days.map(d => {
        let maxPain: number | null = null;
        for (const w of d.data?.workouts || []) {
          if (!w.pain) continue;
          const isLegacy = "pre" in w.pain || "during" in w.pain || "post" in w.pain;
          const src = isLegacy && area === "polpaccio" ? w.pain : w.pain[area];
          if (!src || typeof src !== "object") continue;
          const vals = [toNum(src.pre), toNum(src.during), toNum(src.post)].filter((v): v is number => v != null);
          if (vals.length) {
            const m = Math.max(...vals);
            if (maxPain === null || m > maxPain) maxPain = m;
          }
        }
        return { date: d.date, value: maxPain };
      }),
    }));

    // === Metriche corsa ===
    // Parser passo "6:30" o "6:30/km" → secondi per km
    const parsePace = (p: any): number | null => {
      if (!p) return null;
      const s = String(p).trim();
      const m = s.match(/^(\d+):(\d{1,2})/);
      if (!m) return null;
      const sec = Number(m[1]) * 60 + Number(m[2]);
      return sec > 0 ? sec : null;
    };

    const runPaceSeries: SparklinePoint[] = [];
    const runHRSeries: SparklinePoint[] = [];
    const runCadenceSeries: SparklinePoint[] = [];
    const runEfSeries: SparklinePoint[] = [];
    const runDurationSeries: SparklinePoint[] = [];

    for (const d of days) {
      const runs = (d.data?.workouts || []).filter((w: any) => w.type === "corsa");
      if (!runs.length) {
        runPaceSeries.push({ date: d.date, value: null });
        runHRSeries.push({ date: d.date, value: null });
        runCadenceSeries.push({ date: d.date, value: null });
        runEfSeries.push({ date: d.date, value: null });
        runDurationSeries.push({ date: d.date, value: null });
        continue;
      }
      const paces = runs.map((r: any) => parsePace(r.fields?.passo_medio)).filter((v: any): v is number => v != null);
      const hrs = runs.map((r: any) => toNum(r.fields?.fc_media)).filter((v): v is number => v != null);
      const cads = runs.map((r: any) => toNum(r.fields?.cadenza)).filter((v): v is number => v != null);
      const durs = runs.map((r: any) => toNum(r.fields?.durata_totale) ?? toNum(r.fields?.durata)).filter((v): v is number => v != null);

      const avgPace = paces.length ? paces.reduce((a: number, b: number) => a + b, 0) / paces.length : null;
      const avgHR = hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null;
      const avgCad = cads.length ? cads.reduce((a, b) => a + b, 0) / cads.length : null;
      const totDur = durs.length ? durs.reduce((a, b) => a + b, 0) : null;

      // Efficiency Factor (EF) = m/min / bpm = metri per battito. Più alto = più efficiente.
      let ef: number | null = null;
      if (avgPace != null && avgPace > 0 && avgHR != null && avgHR > 0) {
        const mPerMin = 60000 / avgPace;
        const efRaw = mPerMin / avgHR;
        ef = Number.isFinite(efRaw) ? Math.round(efRaw * 100) / 100 : null;
      }

      runPaceSeries.push({ date: d.date, value: avgPace });
      runHRSeries.push({ date: d.date, value: avgHR });
      runCadenceSeries.push({ date: d.date, value: avgCad });
      runEfSeries.push({ date: d.date, value: ef });
      runDurationSeries.push({ date: d.date, value: totDur });
    }

    const hasRunningData = runPaceSeries.some(p => p.value != null) || runHRSeries.some(p => p.value != null);

    // Stats aggregate
    const sessions = days.reduce((n, d) => n + (d.data?.workouts?.length || 0), 0);
    const totalMin = dailyVolume.reduce((s, p) => s + (p.value || 0), 0);
    const checkins = days.filter(d => d.data?.daily).length;

    // Tipi workout conteggio
    const typeCount: Record<string, number> = {};
    for (const d of days) {
      for (const w of d.data?.workouts || []) {
        typeCount[w.type || "altro"] = (typeCount[w.type || "altro"] || 0) + 1;
      }
    }

    // Delta vs periodo precedente: confronta gli ultimi N gg con i precedenti N gg.
    // Aiuta l'utente a vedere "sto migliorando o peggiorando vs prima?".
    // Skip se non ci sono dati nel periodo precedente (delta = null → no badge).
    const prevPeriodStart = new Date(today);
    prevPeriodStart.setDate(today.getDate() - period * 2 + 1);
    const prevPeriodEnd = new Date(today);
    prevPeriodEnd.setDate(today.getDate() - period);
    const fmtKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const prevStartKey = fmtKey(prevPeriodStart);
    const prevEndKey = fmtKey(prevPeriodEnd);
    const prevDays = allDays.filter(d => d.date >= prevStartKey && d.date <= prevEndKey);
    let prevSessions = 0, prevTotalMin = 0;
    for (const d of prevDays) {
      prevSessions += d.workouts?.length || 0;
      for (const w of d.workouts || []) {
        const m = Number(w.fields?.durata_totale || w.fields?.durata || 0);
        if (Number.isFinite(m)) prevTotalMin += m;
      }
    }
    const computeDelta = (cur: number, prev: number): number | null => {
      if (prev <= 0) return null; // niente baseline → no badge
      return Math.round(((cur - prev) / prev) * 100);
    };
    const deltas = {
      sessions: computeDelta(sessions, prevSessions),
      totalMin: computeDelta(totalMin, prevTotalMin),
    };

    return {
      weight, sleep, fatigue,
      bodyFat, muscleMass, bodyWater,
      morningHR, morningFreshness, morningHRAlert,
      dailyVolume, dailyRpeAvg,
      painByArea,
      runPaceSeries, runHRSeries, runCadenceSeries, runEfSeries, runDurationSeries,
      hasRunningData,
      stats: { sessions, totalMin, checkins, periodDays: period, days: days.length },
      deltas,
      typeCount,
      error: null as string | null,
    };
  } catch (e: any) {
    console.error("[TrendsPage] Errore calcolo series:", e);
    const empty: SparklinePoint[] = [];
    return {
      weight: empty, sleep: empty, fatigue: empty,
      bodyFat: empty, muscleMass: empty, bodyWater: empty,
      morningHR: empty, morningFreshness: empty, morningHRAlert: null as null | { baseline: number; recent: number; deltaBpm: number },
      dailyVolume: empty, dailyRpeAvg: empty,
      painByArea: [] as Array<{ area: string; series: SparklinePoint[] }>,
      runPaceSeries: empty, runHRSeries: empty, runCadenceSeries: empty,
      runEfSeries: empty, runDurationSeries: empty,
      hasRunningData: false,
      stats: { sessions: 0, totalMin: 0, checkins: 0, periodDays: period, days: 0 },
      deltas: { sessions: null as number | null, totalMin: null as number | null },
      typeCount: {} as Record<string, number>,
      error: String(e?.message || e),
    };
  }
  }, [allDays, period]);

  const series = seriesResult;
  const seriesError = seriesResult.error;

  const cardStyle: Record<string, any> = {
    background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "14px", padding: "14px 16px",
  };

  const hasAnyData = series.stats.sessions > 0 || series.stats.checkins > 0;

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px" }}>
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Trend</div>
        <h1 style={{ fontSize: "26px", fontWeight: 900, margin: "4px 0 0", letterSpacing: "-0.03em" }}>Andamento nel tempo</h1>
      </div>

      {/* Period selector */}
      <div style={{ display: "flex", gap: "6px", background: "#1A1A2E", padding: "4px", borderRadius: "12px", marginBottom: "16px" }}>
        {(Object.keys(PERIOD_LABELS) as unknown as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(Number(p) as Period)} style={{
            flex: 1, padding: "10px", borderRadius: "8px",
            background: period === Number(p) ? "#16213E" : "transparent",
            border: "none", color: period === Number(p) ? "#E2E8F0" : "#94A3B8",
            fontSize: "12px", fontWeight: 700, cursor: "pointer",
            minHeight: "38px",
          }}>{PERIOD_LABELS[Number(p) as Period]}</button>
        ))}
      </div>

      {seriesError && (
        <div style={{ padding: "16px", background: "#7F1D1D30", border: "1px solid #7F1D1D", borderRadius: "12px", marginBottom: "12px" }}>
          <div style={{ fontSize: "13px", color: "#EF4444", fontWeight: 700, marginBottom: "4px" }}>Errore nel calcolo dei trend</div>
          <div style={{ fontSize: "12px", color: "#FCA5A5" }}>{seriesError}</div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner variant="block" label="Caricamento…" data-testid="trends-loading" />
      ) : !hasAnyData ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: "36px", marginBottom: "10px" }}>📈</div>
          <div style={{ color: "#CBD5E1", fontSize: "14px", marginBottom: "4px" }}>Nessun dato nel periodo</div>
          <div style={{ color: "#94A3B8", fontSize: "12px" }}>Registra allenamenti e check giornalieri per vedere i trend qui.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Stats summary con delta vs periodo precedente (stessa lunghezza). */}
          <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            <Stat label="Sessioni" value={series.stats.sessions} delta={series.deltas.sessions} />
            <Stat label="Minuti totali" value={series.stats.totalMin} delta={series.deltas.totalMin} />
            <Stat label="Dati biometrici" value={`${series.stats.checkins}/${series.stats.days}`} />
          </div>

          {/* ═══ SEZIONE ALLENAMENTI ═══ */}
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#E8553A", textTransform: "uppercase", marginTop: "8px", paddingLeft: "4px" }}>
            🏋️ Dati Allenamenti
          </div>

          <div style={cardStyle}>
            <SectionHeader title="Volume allenamento" hint="minuti/die" color="#E8553A" />
            <Sparkline points={series.dailyVolume} width={width - 32} color="#E8553A" unit="′" />
          </div>

          <div style={cardStyle}>
            <SectionHeader title="RPE medio sessioni" hint="sforzo percepito 1-10" color="#F59E0B" />
            <Sparkline points={series.dailyRpeAvg} width={width - 32} color="#F59E0B" yMin={0} yMax={10} />
          </div>

          {/* Corsa — metriche di progressione (solo se almeno una corsa nel periodo) */}
          {series.hasRunningData && (
            <>
              <div style={{ ...cardStyle, background: "#1A1A2E", borderLeft: "3px solid #E8553A" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  🏃 Corsa — progressione
                </div>
                <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.5 }}>
                  Trend dei parametri chiave per vedere se stai migliorando. Confronta sessioni simili (es. fondo lento) per comparabilità.
                </div>
              </div>

              <div style={cardStyle}>
                <SectionHeader title="Passo medio" hint="min:sec/km — basso = veloce, alto = lento" color="#E8553A" />
                <Sparkline
                  points={series.runPaceSeries}
                  width={width - 32}
                  color="#E8553A"
                  formatValue={v => {
                    if (!Number.isFinite(v) || v <= 0) return "—";
                    const m = Math.floor(v / 60);
                    const s = Math.round(v - m * 60);
                    return `${m}:${s.toString().padStart(2, "0")}`;
                  }}
                />
              </div>

              <div style={cardStyle}>
                <SectionHeader title="FC media corsa" hint="bpm — a parità di passo, più bassa = più fit" color="#DC2626" />
                <Sparkline points={series.runHRSeries} width={width - 32} color="#DC2626" unit=" bpm" />
              </div>

              <div style={cardStyle}>
                <SectionHeader title="Efficienza aerobica (EF)" hint="metri per battito — più alto = più economico" color="#22C55E" />
                <Sparkline
                  points={series.runEfSeries}
                  width={width - 32}
                  color="#22C55E"
                  unit=" m/btt"
                  showDots
                />
                <div style={{ fontSize: "10px", color: "#64748B", marginTop: "6px", lineHeight: 1.4 }}>
                  EF = velocità (m/min) / FC media. A parità di intensità, salita dell'EF = economia di corsa migliorata.
                </div>
              </div>

              {series.runCadenceSeries.some(p => p.value != null) && (
                <div style={cardStyle}>
                  <SectionHeader title="Cadenza" hint="passi/min — target ≥165 riduce carico articolare" color="#8B5CF6" />
                  <Sparkline points={series.runCadenceSeries} width={width - 32} color="#8B5CF6" unit=" spm" />
                </div>
              )}
            </>
          )}

          {/* Pain per zona */}
          {series.painByArea.length > 0 && series.painByArea.map(p => (
            <div key={p.area} style={cardStyle}>
              <SectionHeader title={`Dolore ${p.area}`} hint="scala 0-4+ (max per sessione)" color="#EF4444" />
              <Sparkline points={p.series} width={width - 32} color="#EF4444" yMin={0} yMax={4} showDots />
            </div>
          ))}

          {/* Distribuzione tipi workout — ancora in sezione allenamenti */}
          {Object.keys(series.typeCount).length > 0 && (
            <div style={cardStyle}>
              <SectionHeader title="Distribuzione sessioni" hint="per tipo" color="#94A3B8" />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                {Object.entries(series.typeCount)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, n]) => {
                    const values = Object.values(series.typeCount);
                    const maxN = values.length ? Math.max(...values) : 0;
                    const pct = maxN > 0 ? (n / maxN) * 100 : 0;
                    return (
                      <div key={type} style={{ fontSize: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                          <span style={{ color: "#CBD5E1" }}>{type}</span>
                          <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>{n}</span>
                        </div>
                        <div style={{ height: "6px", background: "#0F172A", borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: "#E8553A", transition: "width 0.3s ease" }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ═══ SEZIONE BIOMETRICI ═══ */}
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#0891B2", textTransform: "uppercase", marginTop: "8px", paddingLeft: "4px" }}>
            📊 Dati Biometrici
          </div>

          <div style={cardStyle}>
            <SectionHeader title="Peso corporeo" hint="mattino a digiuno" color="#0891B2" />
            <Sparkline points={series.weight} width={width - 32} color="#0891B2" unit=" kg" />
          </div>

          <div style={cardStyle}>
            <SectionHeader title="Ore di sonno" hint="più alto = meglio" color="#7C3AED" />
            <Sparkline points={series.sleep} width={width - 32} color="#7C3AED" yMin={0} yMax={12} unit="h" />
          </div>

          <div style={cardStyle}>
            <SectionHeader title="Stanchezza generale" hint="1-10, più basso = meglio" color="#EF4444" />
            <Sparkline points={series.fatigue} width={width - 32} color="#EF4444" yMin={0} yMax={10} />
          </div>

          {/* FC mattino + alert overreaching: Plews 2014 (HRV/RHR markers).
              Nascondi card se zero punti (campo opzionale, non tutti lo registrano). */}
          {series.morningHR.some(p => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="FC mattino (a riposo)" hint="bpm — più bassa = miglior recovery" color="#DC2626" />
              <Sparkline points={series.morningHR} width={width - 32} color="#DC2626" unit=" bpm" />
              {series.morningHRAlert && (
                <div role="alert" style={{
                  marginTop: "10px", padding: "10px 12px",
                  background: "#7F1D1D40", border: "1px solid #EF444466",
                  borderRadius: "8px", fontSize: "12px", color: "#FCA5A5", lineHeight: 1.5,
                }}>
                  ⚠ <b>FC riposo elevata</b> — media ultimi 7gg {series.morningHRAlert.recent} bpm vs baseline {series.morningHRAlert.baseline} bpm (+{series.morningHRAlert.deltaBpm}). Possibile accumulo di fatica o stress: valuta una settimana di scarico, sonno e idratazione.
                </div>
              )}
            </div>
          )}

          {series.morningFreshness.some(p => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="Freschezza percepita al risveglio" hint="1-10, più alta = meglio" color="#22C55E" />
              <Sparkline points={series.morningFreshness} width={width - 32} color="#22C55E" yMin={0} yMax={10} />
            </div>
          )}

          {/* Body comp (solo se dati) */}
          {series.bodyFat.some((p: any) => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="Massa grassa" hint="da bilancia BIA" color="#059669" />
              <Sparkline points={series.bodyFat} width={width - 32} color="#059669" unit="%" />
            </div>
          )}
          {series.muscleMass.some((p: any) => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="Massa muscolare" hint="da bilancia BIA" color="#10B981" />
              <Sparkline points={series.muscleMass} width={width - 32} color="#10B981" />
            </div>
          )}
          {series.bodyWater.some((p: any) => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="Acqua corporea (TBW)" hint="% idratazione cronica" color="#06B6D4" />
              <Sparkline points={series.bodyWater} width={width - 32} color="#06B6D4" unit="%" />
            </div>
          )}

          <div style={{ fontSize: "11px", color: "#64748B", textAlign: "center", padding: "8px 0 20px" }}>
            Trend calcolati localmente dal diario. Periodo: ultimi {period} giorni.
            <br />
            Le tue Zone FC sono nel tab <b>Coach → Zone FC</b>.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: number | string; delta?: number | null }) {
  // Delta badge: ↑ verde se positivo, ↓ rosso se negativo, nascosto se null o 0.
  // Soglia ±2% per evitare jitter su micro-variazioni (es. 30 → 31 sessioni = 3.3%).
  const showDelta = delta !== undefined && delta !== null && Math.abs(delta) >= 2;
  const isPositive = (delta ?? 0) > 0;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "20px", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>{label}</div>
      {showDelta && (
        <div title="Variazione vs periodo precedente di pari durata" style={{
          fontSize: "10px", marginTop: "3px",
          color: isPositive ? "#22C55E" : "#F87171",
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
        }}>
          {isPositive ? "↑" : "↓"} {Math.abs(delta!)}%
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, hint, color }: { title: string; hint: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "8px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color }}>{title}</div>
      <div style={{ fontSize: "11px", color: "#64748B" }}>{hint}</div>
    </div>
  );
}

