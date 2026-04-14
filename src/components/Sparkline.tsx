// Mini chart SVG a line-path, zero dipendenze.
// Gestisce gap (valori null/undefined).
import { useMemo } from "react";

export interface SparklinePoint {
  date: string;  // YYYY-MM-DD
  value: number | null;
}

export default function Sparkline({
  points,
  width = 320,
  height = 80,
  color = "#E8553A",
  yMin,
  yMax,
  showDots = false,
  unit,
  formatValue,
  invertY = false,
}: {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  color?: string;
  yMin?: number;
  yMax?: number;
  showDots?: boolean;
  unit?: string;
  /** Trasforma il valore per la label (es. secondi → "5:30"). Default: toFixed. */
  formatValue?: (v: number) => string;
  /** Se true, valori minori = più alti sul grafico (utile per passo: più basso = migliore). */
  invertY?: boolean;
}) {
  const { path, area, lastValue, dots, axisMin, axisMax } = useMemo(() => {
    const nums = points.map(p => p.value).filter((v): v is number => v != null && Number.isFinite(v));
    if (nums.length === 0) return { path: "", area: "", lastValue: null, dots: [] as { x: number; y: number }[], axisMin: 0, axisMax: 1 };
    const min = yMin ?? Math.min(...nums);
    const max = yMax ?? Math.max(...nums);
    const range = max - min || 1;
    const pad = 4;
    const w = width - pad * 2;
    const h = height - pad * 2;

    const toXY = (i: number, v: number) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * w;
      // invertY: valori minori appaiono in alto (utile per passo)
      const ratio = invertY ? (max - v) / range : (v - min) / range;
      const y = pad + h - ratio * h;
      return { x, y };
    };

    let pathStr = "";
    let areaStr = "";
    const ds: { x: number; y: number }[] = [];
    let inSegment = false;
    let firstX = 0, lastX = 0, lastY = 0;

    points.forEach((p, i) => {
      if (p.value == null || !Number.isFinite(p.value)) {
        inSegment = false;
        return;
      }
      const { x, y } = toXY(i, p.value);
      if (!inSegment) {
        pathStr += ` M ${x} ${y}`;
        if (areaStr === "") firstX = x;
        inSegment = true;
      } else {
        pathStr += ` L ${x} ${y}`;
      }
      lastX = x; lastY = y;
      ds.push({ x, y });
    });

    if (ds.length > 0) {
      areaStr = `M ${firstX} ${pad + h} ${pathStr} L ${lastX} ${pad + h} Z`;
    }

    const last = nums[nums.length - 1];
    return { path: pathStr, area: areaStr, lastValue: last, dots: ds, axisMin: min, axisMax: max };
  }, [points, width, height, yMin, yMax, invertY]);

  const fmt = (v: number) => formatValue ? formatValue(v) : (Number.isInteger(v) ? String(v) : v.toFixed(1));

  if (!path) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#64748B" }}>
        Nessun dato nel periodo
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
        <path d={area} fill={color} opacity={0.12} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {showDots && dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={2.5} fill={color} />
        ))}
      </svg>
      {lastValue != null && (
        <div style={{
          position: "absolute", top: 4, right: 6,
          fontSize: "11px", fontWeight: 700, color,
          fontFamily: "'JetBrains Mono', monospace",
          background: "#0B0F1ACC", padding: "2px 6px", borderRadius: "4px",
        }}>
          {fmt(lastValue)}{unit || ""}
        </div>
      )}
      <div style={{
        position: "absolute", bottom: 2, left: 6,
        fontSize: "10px", color: "#64748B", fontFamily: "'JetBrains Mono', monospace",
      }}>
        {invertY ? fmt(axisMax) : fmt(axisMin)}{unit || ""}
      </div>
      <div style={{
        position: "absolute", top: 2, left: 6,
        fontSize: "10px", color: "#64748B", fontFamily: "'JetBrains Mono', monospace",
      }}>
        {invertY ? fmt(axisMin) : fmt(axisMax)}{unit || ""}
      </div>
    </div>
  );
}
