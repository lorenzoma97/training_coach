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
  ariaLabel,
  showValueLabels = "auto",
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
  /** Etichetta accessibile per screen reader (es. "Trend peso ultimi 30 giorni"). */
  ariaLabel?: string;
  /**
   * Label valore disegnata sopra i pallini (2026-05-18 — UX request Lorenzo).
   *  - "auto": ≤14 punti validi → "all", 15-30 → "endpoints" (max/min/last), >30 → "none"
   *  - "all": label su OGNI punto valido (rischio overlap se molti)
   *  - "endpoints": solo max, min, ultimo punto valido
   *  - "none": nessuna label (solo tooltip hover, comportamento legacy)
   */
  showValueLabels?: "auto" | "all" | "endpoints" | "none";
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { path, area, lastValue, dots, axisMin, axisMax, allCoords } = useMemo(() => {
    // Difensivo: se points non è array (shouldn't happen ma protegge contro edge case)
    if (!Array.isArray(points) || points.length === 0) return {
      path: "", area: "", lastValue: null,
      dots: [] as { x: number; y: number }[], axisMin: 0, axisMax: 1,
      allCoords: [] as Array<{ x: number; y: number; idx: number } | null>,
    };
    const nums = points.map(p => p?.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (nums.length === 0) return {
      path: "", area: "", lastValue: null,
      dots: [] as { x: number; y: number }[], axisMin: 0, axisMax: 1,
      allCoords: points.map(() => null) as Array<{ x: number; y: number; idx: number } | null>,
    };
    // Calcola min/max con un loop (evita spread su array grandi)
    let mn = nums[0], mx = nums[0];
    for (const n of nums) { if (n < mn) mn = n; if (n > mx) mx = n; }
    const min: number = yMin !== undefined ? yMin : mn;
    const max: number = yMax !== undefined ? yMax : mx;
    const range = max - min || 1;
    const pad = 6;
    const w = width - pad * 2;
    const h = height - pad * 2;

    const toXY = (i: number, v: number) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * w;
      const ratio = invertY ? (max - v) / range : (v - min) / range;
      const y = pad + h - ratio * h;
      return { x, y };
    };

    let pathStr = "";
    const ds: { x: number; y: number }[] = [];
    const coords: Array<{ x: number; y: number; idx: number } | null> = [];

    // Connette tutti i punti validi con una linea continua, saltando i null
    // (dati sparsi tipici: 1 corsa ogni 3-5 giorni). Area fill rimosso:
    // con dati sparsi creava forme poligonali confuse senza valore informativo.
    let isFirst = true;
    points.forEach((p, i) => {
      if (p.value == null || !Number.isFinite(p.value)) {
        coords.push(null);
        return;
      }
      const { x, y } = toXY(i, p.value);
      pathStr += isFirst ? ` M ${x} ${y}` : ` L ${x} ${y}`;
      isFirst = false;
      ds.push({ x, y });
      coords.push({ x, y, idx: i });
    });

    const last = nums[nums.length - 1];
    return { path: pathStr, area: "", lastValue: last, dots: ds, axisMin: min, axisMax: max, allCoords: coords };
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

  // Asse X: max 5 date distribuite uniformemente, format "dd mmm"
  // IMPORTANTE: questo useMemo DEVE stare PRIMA dell'early return "if (!path)"
  // altrimenti React crasha per hooks call-order mismatch quando period cambia.
  const xLabels = useMemo(() => {
    if (!Array.isArray(points) || points.length < 2) return [];
    const n = points.length;
    const maxLabels = Math.min(5, Math.max(2, Math.floor(width / 70)));
    // Indici EQUISPAZIATI (primo→ultimo). Niente più dedup-splice che lasciava
    // le ultime due label adiacenti → overlap "7 giu / 9 giu" (Sprint N fix).
    const raw: number[] = [];
    for (let k = 0; k < maxLabels; k++) raw.push(Math.round((k / (maxLabels - 1)) * (n - 1)));
    const uniq = Array.from(new Set(raw)).sort((a, b) => a - b);
    // Spaziatura minima in %: scarta label troppo vicine (tenendo sempre l'ultima).
    const minGapPct = 16;
    const out: Array<{ pct: number; label: string }> = [];
    uniq.forEach((i, idx) => {
      const pct = (i / (n - 1)) * 100;
      const isLast = idx === uniq.length - 1;
      const prev = out[out.length - 1];
      if (!isLast && prev && pct - prev.pct < minGapPct) return;
      if (isLast && prev && pct - prev.pct < minGapPct) out.pop(); // l'ultima ha priorità
      out.push({ pct, label: points[i]?.date ? fmtDate(points[i].date) : "" });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width]);

  if (!path) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "#94A3B8" }}>
        Nessun dato nel periodo
      </div>
    );
  }

  // Auto-dots: se pochi punti validi (≤ 8), mostra sempre i dot per non avere linee
  // invisibili con 2-3 punti su un grafico largo.
  const validCount = allCoords.filter(c => c !== null).length;
  const autoShowDots = showDots || validCount <= 8;

  const hoverCoord = hoverIdx != null ? allCoords[hoverIdx] : null;
  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  // Value labels (2026-05-18 — UX request Lorenzo): pallino + valore sopra.
  // Auto-detect basato su conteggio punti validi per evitare collision.
  const effectiveLabels: "all" | "endpoints" | "none" = showValueLabels === "auto"
    ? (validCount <= 14 ? "all" : validCount <= 30 ? "endpoints" : "none")
    : showValueLabels;

  // Pre-calcola gli indici "interessanti" per modalità endpoints (max, min, last).
  const endpointIndices = (() => {
    if (effectiveLabels !== "endpoints") return new Set<number>();
    const indices = new Set<number>();
    let maxV = -Infinity, maxI = -1, minV = Infinity, minI = -1, lastI = -1;
    for (const c of allCoords) {
      if (!c) continue;
      const v = points[c.idx]?.value;
      if (typeof v !== "number") continue;
      if (v > maxV) { maxV = v; maxI = c.idx; }
      if (v < minV) { minV = v; minI = c.idx; }
      lastI = c.idx;
    }
    if (maxI >= 0) indices.add(maxI);
    if (minI >= 0) indices.add(minI);
    if (lastI >= 0) indices.add(lastI);
    return indices;
  })();

  // Quali punti mostrano la value-label sopra il pallino: "endpoints" → max/min/
  // last; "all" → con THINNING per distanza-x minima (evita l'overlap orizzontale
  // "8 5 5" quando i punti sono ravvicinati); "none" → nessuno. (Sprint N)
  const valueLabelIndices = (() => {
    if (effectiveLabels === "none") return new Set<number>();
    if (effectiveLabels === "endpoints") return endpointIndices;
    const show = new Set<number>();
    let lastX = -Infinity;
    const minGapPx = 24;
    for (const c of allCoords) {
      if (!c) continue;
      if (c.x - lastX >= minGapPx) { show.add(c.idx); lastX = c.x; }
    }
    return show;
  })();

  return (
    <div style={{ position: "relative", width }}>
      <svg
        ref={svgRef}
        width={width} height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel || `Grafico trend ${points.length} valori${lastValue != null ? `, ultimo ${lastValue}` : ""}`}
        style={{ display: "block", touchAction: "pan-y" }}
        onMouseMove={e => handleMove(e.clientX)}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={e => { const t = e.touches[0]; if (t) handleMove(t.clientX); }}
        onTouchMove={e => { const t = e.touches[0]; if (t) handleMove(t.clientX); }}
        onTouchEnd={() => setHoverIdx(null)}
      >
        <title>{ariaLabel || `Trend ${points.length} valori${lastValue != null ? `, ultimo ${lastValue}` : ""}`}</title>
        <path d={area} fill={color} opacity={0.12} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Pallini: forziamo sempre se ci sono label (servono come anchor visivo). */}
        {(autoShowDots || effectiveLabels !== "none") && dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x} cy={d.y}
            r={effectiveLabels === "all" ? 3 : validCount <= 3 ? 4 : 2.5}
            fill={color}
          />
        ))}
        {/* Value labels sopra i pallini (auto-detect su validCount). */}
        {effectiveLabels !== "none" && allCoords.map((c, ci) => {
          if (!c) return null;
          const v = points[c.idx]?.value;
          if (typeof v !== "number") return null;
          if (!valueLabelIndices.has(c.idx)) return null;
          // Posiziona sopra il pallino. Se troppo vicino al top (y<14), flip sotto.
          const aboveY = c.y - 8;
          const isFlipped = aboveY < 12;
          const labelY = isFlipped ? c.y + 16 : aboveY;
          return (
            <text
              key={`l-${ci}`}
              x={c.x} y={labelY}
              fontSize="10"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight="700"
              fill={color}
              textAnchor="middle"
              style={{ pointerEvents: "none" }}
            >
              {fmt(v)}
            </text>
          );
        })}
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
        position: "absolute", bottom: 20, left: 6,
        fontSize: "11px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace",
        background: "#0B0F1ACC", padding: "2px 5px", borderRadius: "4px",
      }}>
        {invertY ? fmt(axisMax) : fmt(axisMin)}{unit || ""}
      </div>
      <div style={{
        position: "absolute", top: 4, left: 6,
        fontSize: "11px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace",
        background: "#0B0F1ACC", padding: "2px 5px", borderRadius: "4px",
      }}>
        {invertY ? fmt(axisMin) : fmt(axisMax)}{unit || ""}
      </div>
      {/* Asse X: date distribuite uniformemente. 11px/#94A3B8 per WCAG AA. */}
      {xLabels.length >= 2 && (
        <div style={{ position: "relative", height: "16px", marginTop: "4px" }}>
          {xLabels.map((xl, i) => (
            <span key={i} style={{
              position: "absolute",
              left: `${xl.pct}%`,
              transform: i === xLabels.length - 1 ? "translateX(-100%)" : i === 0 ? "none" : "translateX(-50%)",
              fontSize: "11px",
              color: "#94A3B8",
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: "nowrap",
            }}>{xl.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
