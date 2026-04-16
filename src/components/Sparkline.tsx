// Mini chart SVG a line-path, zero dipendenze.
// Gestisce gap (valori null/undefined) e tooltip hover/tap interattivo.
import { useMemo, useRef, useState } from "react";

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
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { path, area, lastValue, dots, axisMin, axisMax, allCoords } = useMemo(() => {
    const nums = points.map(p => p.value).filter((v): v is number => v != null && Number.isFinite(v));
    if (nums.length === 0) return {
      path: "", area: "", lastValue: null,
      dots: [] as { x: number; y: number }[], axisMin: 0, axisMax: 1,
      allCoords: [] as Array<{ x: number; y: number; idx: number } | null>,
    };
    const min = yMin ?? Math.min(...nums);
    const max = yMax ?? Math.max(...nums);
    const range = max - min || 1;
    const pad = 4;
    const w = width - pad * 2;
    const h = height - pad * 2;

    const toXY = (i: number, v: number) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * w;
      const ratio = invertY ? (max - v) / range : (v - min) / range;
      const y = pad + h - ratio * h;
      return { x, y };
    };

    let pathStr = "";
    let areaStr = "";
    const ds: { x: number; y: number }[] = [];
    const coords: Array<{ x: number; y: number; idx: number } | null> = [];
    let firstX = 0, lastX = 0;

    // Connette tutti i punti validi con una linea continua, saltando i null
    // (dati sparsi tipici: 1 corsa ogni 3-5 giorni). Prima versione spezzava
    // il segmento su ogni null, creando frammenti invisibili con pochi dati.
    let isFirst = true;
    points.forEach((p, i) => {
      if (p.value == null || !Number.isFinite(p.value)) {
        coords.push(null);
        return;
      }
      const { x, y } = toXY(i, p.value);
      if (isFirst) {
        pathStr += ` M ${x} ${y}`;
        firstX = x;
        isFirst = false;
      } else {
        pathStr += ` L ${x} ${y}`;
      }
      lastX = x;
      ds.push({ x, y });
      coords.push({ x, y, idx: i });
    });

    if (ds.length > 0) {
      areaStr = `M ${firstX} ${pad + h} ${pathStr} L ${lastX} ${pad + h} Z`;
    }

    const last = nums[nums.length - 1];
    return { path: pathStr, area: areaStr, lastValue: last, dots: ds, axisMin: min, axisMax: max, allCoords: coords };
  }, [points, width, height, yMin, yMax, invertY]);

  const fmt = (v: number) => formatValue ? formatValue(v) : (Number.isInteger(v) ? String(v) : v.toFixed(1));

  // Converte coordinate pixel → indice punto più vicino (lineare per layout orizzontale)
  const handleMove = (clientX: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    // Cerca il punto più vicino con dato valido
    let bestIdx: number | null = null;
    let bestDist = Infinity;
    for (const c of allCoords) {
      if (!c) continue;
      const d = Math.abs(c.x - relX);
      if (d < bestDist) { bestDist = d; bestIdx = c.idx; }
    }
    setHoverIdx(bestIdx);
  };

  const fmtDate = (iso: string) => {
    try {
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
    } catch { return iso; }
  };

  if (!path) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#64748B" }}>
        Nessun dato nel periodo
      </div>
    );
  }

  // Asse X: max 5 date distribuite uniformemente, format "dd mmm"
  const xLabels = useMemo(() => {
    if (points.length < 2) return [];
    const maxLabels = Math.min(5, Math.max(2, Math.floor(width / 70)));
    const step = Math.max(1, Math.floor((points.length - 1) / (maxLabels - 1)));
    const indices: number[] = [];
    for (let i = 0; i < points.length; i += step) indices.push(i);
    if (indices[indices.length - 1] !== points.length - 1) indices.push(points.length - 1);
    // Riduci se troppi vicini
    while (indices.length > maxLabels) indices.splice(1, 1);
    return indices.map(i => {
      const p = points[i];
      const pct = points.length > 1 ? (i / (points.length - 1)) * 100 : 50;
      return { pct, label: fmtDate(p.date) };
    });
  }, [points, width]);

  const hoverCoord = hoverIdx != null ? allCoords[hoverIdx] : null;
  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div style={{ position: "relative", width }}>
      <svg
        ref={svgRef}
        width={width} height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block", touchAction: "pan-y" }}
        onMouseMove={e => handleMove(e.clientX)}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={e => { const t = e.touches[0]; if (t) handleMove(t.clientX); }}
        onTouchMove={e => { const t = e.touches[0]; if (t) handleMove(t.clientX); }}
        onTouchEnd={() => setHoverIdx(null)}
      >
        <path d={area} fill={color} opacity={0.12} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {showDots && dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={2.5} fill={color} />
        ))}
        {hoverCoord && (
          <>
            <line x1={hoverCoord.x} x2={hoverCoord.x} y1={0} y2={height} stroke={color} strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
            <circle cx={hoverCoord.x} cy={hoverCoord.y} r={4} fill={color} stroke="#0B0F1A" strokeWidth={1.5} />
          </>
        )}
      </svg>
      {hoverPoint && hoverPoint.value != null ? (
        <div role="tooltip" style={{
          position: "absolute", top: 2, right: 6,
          fontSize: "11px", fontWeight: 700, color,
          fontFamily: "'JetBrains Mono', monospace",
          background: "#0B0F1ACC", padding: "4px 8px", borderRadius: "6px",
          border: `1px solid ${color}40`,
          pointerEvents: "none",
        }}>
          <div style={{ color: "#94A3B8", fontSize: "9px", fontWeight: 600, letterSpacing: "0.05em" }}>{fmtDate(hoverPoint.date)}</div>
          <div>{fmt(hoverPoint.value)}{unit || ""}</div>
        </div>
      ) : lastValue != null && (
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
      {/* Asse X: date distribuite uniformemente */}
      {xLabels.length >= 2 && (
        <div style={{ position: "relative", height: "14px", marginTop: "2px" }}>
          {xLabels.map((xl, i) => (
            <span key={i} style={{
              position: "absolute",
              left: `${xl.pct}%`,
              transform: i === xLabels.length - 1 ? "translateX(-100%)" : i === 0 ? "none" : "translateX(-50%)",
              fontSize: "9px",
              color: "#64748B",
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: "nowrap",
            }}>{xl.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
