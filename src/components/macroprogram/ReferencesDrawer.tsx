// Drawer Riferimenti macroprogramma (Sprint 4.3, 2026-05-26).
// Slide-up modale con tabs interni: Glossario · Warm-up · Tabelle · Tracking · Sorgente.
// Estrae sezioni dalla narrative markdown via regex sezione "## ..." → next "## ".

import { useEffect, useMemo, useState } from "react";
import type { MacroProgram, MacroProgramTrackingMetric } from "../../lib/types/macroprogram";
import MarkdownLite from "./MarkdownLite";
import { getJSON, setJSON } from "../../lib/storage";
import { useModalBackButton } from "../../lib/useModalBackButton";

interface ReferencesDrawerProps {
  program: MacroProgram;
  open: boolean;
  onClose: () => void;
}

type TabId = "glossary" | "warmup" | "tables" | "tracking" | "source";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "glossary", label: "Glossario" },
  { id: "warmup", label: "Warm-up" },
  { id: "tables", label: "Tabelle" },
  { id: "tracking", label: "Tracking" },
  { id: "source", label: "Sorgente" },
];

/**
 * Estrae una sezione markdown identificata da heading "## Pattern" (o anche
 * subheading "### Pattern" se topLevelOnly=false). Si ferma alla prossima sezione
 * con livello uguale o superiore. Ritorna null se non trovata.
 *
 * @param md narrative markdown completo
 * @param patternRe regex case-insensitive per il titolo della sezione (parte dopo i ##)
 * @param level "##" o "###"
 */
function extractSection(md: string, patternRe: RegExp, level: "##" | "###" = "##"): string | null {
  const escapedLevel = level === "##" ? "##" : "###";
  // Match: heading + content fino a next heading di pari/maggior livello
  const lines = md.split(/\r?\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(new RegExp(`^${escapedLevel}\\s+(.+)$`));
    if (m && patternRe.test(m[1])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  // Find next heading at same or higher level (## or single #)
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
      // single # (top) or ## stops here for level ##
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

/**
 * Estrae più sezioni "tabella-tipo" da accorpare nel tab Tabelle.
 * Pattern: cerca heading che matchano qualsiasi regex in `patternsList`.
 */
function extractMultipleSections(md: string, patterns: RegExp[]): string {
  const out: string[] = [];
  for (const p of patterns) {
    const sec = extractSection(md, p);
    if (sec) out.push(sec);
  }
  return out.join("\n\n");
}

// ─── Tracking metrics storage ────────────────────────────────────────────

const TRACKING_KEY = "user-macroprogram-tracking";

interface TrackingEntry {
  metricId: string;
  value: number;
  date: string; // ISO yyyy-mm-dd
}

async function loadTrackingEntries(): Promise<TrackingEntry[]> {
  return getJSON<TrackingEntry[]>(TRACKING_KEY, []);
}

async function saveTrackingEntry(entry: TrackingEntry): Promise<void> {
  const all = await loadTrackingEntries();
  all.push(entry);
  await setJSON(TRACKING_KEY, all);
}

// ─── Styles ───────────────────────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 60,
  background: "rgba(11,15,26,0.85)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
  animation: "fadeIn 200ms ease-out",
};

const drawerStyle: React.CSSProperties = {
  width: "100%", maxWidth: "480px", maxHeight: "92vh",
  background: "#16213E",
  borderTopLeftRadius: "16px", borderTopRightRadius: "16px",
  display: "flex", flexDirection: "column",
  animation: "slideUp 250ms ease-out",
};

const tabBtnStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "transparent", border: "none",
  color: "#94A3B8", fontSize: "12px", fontWeight: 600,
  cursor: "pointer", borderBottom: "2px solid transparent",
  whiteSpace: "nowrap",
};

const tabBtnActiveStyle: React.CSSProperties = {
  ...tabBtnStyle,
  color: "#14B8A6", borderBottomColor: "#14B8A6",
};

// ─── MAIN ──────────────────────────────────────────────────────────────────

export default function ReferencesDrawer({ program, open, onClose }: ReferencesDrawerProps) {
  const [tab, setTab] = useState<TabId>("glossary");
  const [trackingEntries, setTrackingEntries] = useState<TrackingEntry[]>([]);
  useModalBackButton(open, onClose);
  useEffect(() => {
    if (!open) return;
    loadTrackingEntries().then(setTrackingEntries);
  }, [open]);

  const glossarySection = useMemo(
    () => extractSection(program.narrative_markdown, /gloss/i) ?? "Sezione Glossario non trovata nella narrative.",
    [program.narrative_markdown],
  );
  const warmupSection = useMemo(
    () => extractSection(program.narrative_markdown, /warm.?up|riscaldamento/i) ?? "Sezione Warm-up non trovata nella narrative.",
    [program.narrative_markdown],
  );
  const tablesSection = useMemo(
    () => extractMultipleSections(program.narrative_markdown, [
      /tabell|riepilog|riassunt/i,
      /volume.*intensit|intensit.*volume/i,
      /segnal|stop|riduzion|carico/i,
      /attrezzatur|equipment/i,
      /fonti|references|bibliograf/i,
    ]) || "Sezioni tabellari non trovate nella narrative.",
    [program.narrative_markdown],
  );

  if (!open) return null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={drawerStyle} onClick={e => e.stopPropagation()}>
        {/* Drag handle cosmetic */}
        <div style={{
          width: "40px", height: "4px", borderRadius: "2px",
          background: "rgba(255,255,255,0.15)",
          margin: "10px auto",
        }} />

        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "0 16px 8px",
        }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0" }}>
            Riferimenti programma
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none",
            color: "#94A3B8", fontSize: "16px", cursor: "pointer",
            padding: "4px 8px",
          }} aria-label="Chiudi">✕</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: "2px",
          padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          overflowX: "auto",
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={tab === t.id ? tabBtnActiveStyle : tabBtnStyle}
            >{t.label}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "12px 16px 20px",
        }}>
          {tab === "glossary" && <MarkdownLite text={glossarySection} />}
          {tab === "warmup" && <MarkdownLite text={warmupSection} />}
          {tab === "tables" && <MarkdownLite text={tablesSection} />}
          {tab === "tracking" && (
            <TrackingTab
              metrics={program.tracking_metrics ?? []}
              entries={trackingEntries}
              onAddEntry={async (entry) => {
                await saveTrackingEntry(entry);
                setTrackingEntries(await loadTrackingEntries());
              }}
            />
          )}
          {tab === "source" && (
            <pre style={{
              fontSize: "10px", lineHeight: 1.5,
              fontFamily: "'JetBrains Mono', monospace", color: "#94A3B8",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              margin: 0,
            }}>{program.narrative_markdown}</pre>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </div>
  );
}

// ─── TrackingTab ─────────────────────────────────────────────────────────

function TrackingTab({
  metrics, entries, onAddEntry,
}: {
  metrics: MacroProgramTrackingMetric[];
  entries: TrackingEntry[];
  onAddEntry: (entry: TrackingEntry) => Promise<void>;
}) {
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (metrics.length === 0) {
    return (
      <div style={{ fontSize: "13px", color: "#94A3B8", textAlign: "center", padding: "40px 16px" }}>
        Nessuna metrica di tracking definita nel programma.
      </div>
    );
  }

  async function handleSubmit(metricId: string) {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return;
    setSubmitting(true);
    try {
      await onAddEntry({
        metricId,
        value: v,
        date: new Date().toISOString().slice(0, 10),
      });
      setValue("");
      setActiveMetric(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "4px" }}>
        Registra le metriche atletiche definite nel programma. I dati vengono salvati nel diario per consultazione futura.
      </div>
      {metrics.map(m => {
        const recent = entries.filter(e => e.metricId === m.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
        const isActive = activeMetric === m.id;
        return (
          <div key={m.id} style={{
            background: "#0B0F1A", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "10px", padding: "12px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0" }}>{m.name}</div>
                <div style={{ fontSize: "10px", color: "#64748B", marginTop: "2px" }}>
                  Frequenza: {m.frequency} · Unità: {m.unit}
                </div>
              </div>
              <button
                onClick={() => { setActiveMetric(isActive ? null : m.id); setValue(""); }}
                style={{
                  padding: "5px 10px",
                  background: isActive ? "#0891B2" : "transparent",
                  border: "1px solid #0891B266", borderRadius: "6px",
                  color: isActive ? "#FFF" : "#0891B2",
                  fontSize: "11px", fontWeight: 600, cursor: "pointer",
                }}
              >{isActive ? "✕" : "+ Registra"}</button>
            </div>
            {m.notes && (
              <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "6px", fontStyle: "italic" }}>
                {m.notes}
              </div>
            )}
            {isActive && (
              <div style={{ marginTop: "10px", display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="number" inputMode="decimal" step="0.1"
                  value={value} onChange={e => setValue(e.target.value)}
                  placeholder={`Valore (${m.unit})`}
                  style={{
                    flex: 1, padding: "8px 10px",
                    background: "#16213E", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "6px", color: "#E2E8F0", fontSize: "13px",
                  }}
                />
                <button
                  onClick={() => handleSubmit(m.id)}
                  disabled={submitting || !value}
                  style={{
                    padding: "8px 14px",
                    background: "#22C55E", border: "none", borderRadius: "6px",
                    color: "#FFF", fontSize: "12px", fontWeight: 700,
                    cursor: submitting || !value ? "not-allowed" : "pointer",
                    opacity: submitting || !value ? 0.5 : 1,
                  }}
                >Salva</button>
              </div>
            )}
            {recent.length > 0 && (
              <div style={{ marginTop: "10px", fontSize: "11px", color: "#94A3B8" }}>
                Ultimi 3: {recent.map(e => `${e.value}${m.unit === "%" ? "%" : ""} (${e.date.slice(5)})`).join(" · ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
