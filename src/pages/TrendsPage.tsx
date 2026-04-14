import { useEffect, useMemo, useState } from "react";
import { getAllDays } from "../lib/diaryContext";
import Sparkline, { type SparklinePoint } from "../components/Sparkline";

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

  useEffect(() => {
    (async () => {
      setLoading(true);
      const days = await getAllDays();
      setAllDays(days);
      setLoading(false);
    })();
    const onResize = () => setWidth(Math.min(window.innerWidth - 56, 504));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Series calcolate in base al periodo
  const series = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const startTs = now.getTime() - (period - 1) * 24 * 3600 * 1000;

    // Costruisci un array continuo di N giorni (anche senza dati)
    const days: Array<{ date: string; data?: DayData }> = [];
    for (let i = 0; i < period; i++) {
      const d = new Date(startTs + i * 24 * 3600 * 1000);
      const key = d.toISOString().split("T")[0];
      const found = allDays.find(x => x.date === key);
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

    return {
      weight, sleep, fatigue,
      bodyFat, muscleMass, bodyWater,
      dailyVolume, dailyRpeAvg,
      painByArea,
      stats: { sessions, totalMin, checkins, periodDays: period, days: days.length },
      typeCount,
    };
  }, [allDays, period]);

  const cardStyle: React.CSSProperties = {
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

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#94A3B8" }}>Caricamento…</div>
      ) : !hasAnyData ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: "36px", marginBottom: "10px" }}>📈</div>
          <div style={{ color: "#CBD5E1", fontSize: "14px", marginBottom: "4px" }}>Nessun dato nel periodo</div>
          <div style={{ color: "#94A3B8", fontSize: "12px" }}>Registra allenamenti e check giornalieri per vedere i trend qui.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Stats summary */}
          <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            <Stat label="Sessioni" value={series.stats.sessions} />
            <Stat label="Minuti totali" value={series.stats.totalMin} />
            <Stat label="Check-in" value={`${series.stats.checkins}/${series.stats.days}`} />
          </div>

          {/* Volume allenamento */}
          <div style={cardStyle}>
            <SectionHeader title="Volume allenamento" hint="minuti/die" color="#E8553A" />
            <Sparkline points={series.dailyVolume} width={width - 32} color="#E8553A" unit="′" />
          </div>

          {/* RPE medio */}
          <div style={cardStyle}>
            <SectionHeader title="RPE medio sessioni" hint="sforzo percepito 1-10" color="#F59E0B" />
            <Sparkline points={series.dailyRpeAvg} width={width - 32} color="#F59E0B" yMin={0} yMax={10} />
          </div>

          {/* Peso */}
          <div style={cardStyle}>
            <SectionHeader title="Peso corporeo" hint="mattino a digiuno" color="#0891B2" />
            <Sparkline points={series.weight} width={width - 32} color="#0891B2" unit=" kg" />
          </div>

          {/* Sonno */}
          <div style={cardStyle}>
            <SectionHeader title="Ore di sonno" hint="più alto = meglio" color="#7C3AED" />
            <Sparkline points={series.sleep} width={width - 32} color="#7C3AED" yMin={0} yMax={12} unit="h" />
          </div>

          {/* Stanchezza */}
          <div style={cardStyle}>
            <SectionHeader title="Stanchezza generale" hint="1-10, più basso = meglio" color="#EF4444" />
            <Sparkline points={series.fatigue} width={width - 32} color="#EF4444" yMin={0} yMax={10} />
          </div>

          {/* Body comp (solo se dati) */}
          {series.bodyFat.some(p => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="Massa grassa" hint="da bilancia BIA" color="#059669" />
              <Sparkline points={series.bodyFat} width={width - 32} color="#059669" unit="%" />
            </div>
          )}
          {series.muscleMass.some(p => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="Massa muscolare" hint="da bilancia BIA" color="#10B981" />
              <Sparkline points={series.muscleMass} width={width - 32} color="#10B981" />
            </div>
          )}
          {series.bodyWater.some(p => p.value != null) && (
            <div style={cardStyle}>
              <SectionHeader title="Acqua corporea (TBW)" hint="% idratazione cronica" color="#06B6D4" />
              <Sparkline points={series.bodyWater} width={width - 32} color="#06B6D4" unit="%" />
            </div>
          )}

          {/* Pain per zona */}
          {series.painByArea.length > 0 && series.painByArea.map(p => (
            <div key={p.area} style={cardStyle}>
              <SectionHeader title={`Dolore ${p.area}`} hint="scala 0-4+ (max per sessione)" color="#EF4444" />
              <Sparkline points={p.series} width={width - 32} color="#EF4444" yMin={0} yMax={4} showDots />
            </div>
          ))}

          {/* Distribuzione tipi workout */}
          {Object.keys(series.typeCount).length > 0 && (
            <div style={cardStyle}>
              <SectionHeader title="Distribuzione sessioni" hint="per tipo" color="#94A3B8" />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                {Object.entries(series.typeCount)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, n]) => {
                    const maxN = Math.max(...Object.values(series.typeCount));
                    const pct = (n / maxN) * 100;
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

          <div style={{ fontSize: "11px", color: "#64748B", textAlign: "center", padding: "8px 0 20px" }}>
            Trend calcolati localmente dal diario. Periodo: ultimi {period} giorni.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "20px", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>{label}</div>
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
