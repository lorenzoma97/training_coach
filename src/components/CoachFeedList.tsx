import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { CoachFeedItem } from "../lib/types";
import { events } from "../lib/events";
import { colors, touch } from "../lib/designTokens";
import RichText from "./RichText";

// Colori dei border-left che indicano severity: derivati da design tokens
// (prima vita: hardcoded #0891B2/#F59E0B/#EF4444 — ora unica fonte).
const SEVERITY_STYLE: Record<string, React.CSSProperties> = {
  info: { borderLeft: `3px solid ${colors.info}` },
  warn: { borderLeft: `3px solid ${colors.warning}`, background: colors.warningFaint },
  danger: { borderLeft: `3px solid ${colors.danger}`, background: "#EF444418" },
};

const TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  "session-feedback": { label: "Feedback sessione", emoji: "🎯" },
  "weekly-report": { label: "Report settimanale", emoji: "📊" },
  "alert": { label: "Alert", emoji: "⚠" },
  "motivation": { label: "Check-in", emoji: "💬" },
  "plan-update": { label: "Piano aggiornato", emoji: "🗺" },
};

export default function CoachFeedList() {
  const [items, setItems] = useState<CoachFeedItem[]>([]);

  const load = async () => setItems(await getJSON<CoachFeedItem[]>("coach-feed", []));

  useEffect(() => {
    load();
    // Polling rimosso: gli eventi `data:externalChange` (per cross-tab) e
    // `plan:updated` coprono tutti i casi di variazione del feed. Il
    // precedente setInterval(load, 3000) era ridondante e causava fetch
    // periodici inutili dello storage.
    const off = events.on("plan:updated", load);
    const offExt = events.on("data:externalChange", ({ key }) => {
      if (key === "coach-feed") load();
    });
    return () => { off(); offExt(); };
  }, []);

  const dismiss = async (id: string) => {
    // Re-leggi dallo storage per evitare sovrascrittura di item aggiunti nel frattempo
    const current = await getJSON<CoachFeedItem[]>("coach-feed", []);
    const updated = current.filter(x => x.id !== id);
    await setJSON("coach-feed", updated);
    setItems(updated);
  };

  if (items.length === 0) {
    return (
      <div style={{
        background: "#16213E", border: "1px dashed rgba(255,255,255,0.10)",
        borderRadius: "12px", padding: "16px",
        textAlign: "center", color: "#CBD5E1", fontSize: "13px", lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>Nessun feedback del coach.</div>
        <div style={{ fontSize: "12px", color: "#94A3B8" }}>
          Il coach reagisce ai workout salvati e al check giornaliero. Qui troverai feedback post-sessione, report e alert.
        </div>
      </div>
    );
  }

  // Sintesi short = prima riga utile del content (max 80 char) per il summary collapsato.
  const summarize = (text: string): string => {
    const firstLine = (text || "").split("\n").map(s => s.trim()).find(Boolean) || "";
    // Strip markdown bold/italic minimo per leggibilità
    const clean = firstLine.replace(/\*\*/g, "").replace(/\*/g, "");
    return clean.length > 80 ? clean.slice(0, 77) + "…" : clean;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {items.map(item => {
        const t = TYPE_LABELS[item.type] || { label: item.type, emoji: "•" };
        const sev = item.severity ?? "info";
        const d = new Date(item.date);
        const timeLabel = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const summary = summarize(item.content);
        return (
          <details key={item.id} role="article" style={{
            background: "#16213E", borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.06)",
            ...SEVERITY_STYLE[sev], animation: "slideUp 0.2s ease",
          }}>
            <summary
              aria-label={`${item.title || t.label} · ${timeLabel}`}
              style={{
                listStyle: "none", cursor: "pointer",
                padding: "10px 12px",
                display: "flex", alignItems: "center", gap: "8px",
                minHeight: touch.min, boxSizing: "border-box",
              }}
            >
              <span style={{ fontSize: "16px", lineHeight: 1, flexShrink: 0 }} aria-hidden>{t.emoji}</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{
                    fontSize: "11px", fontWeight: 700, color: "#CBD5E1",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{item.title || t.label}</span>
                  <span style={{ marginLeft: "auto", fontSize: "11px", color: "#94A3B8", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {timeLabel}
                  </span>
                </div>
                {summary && (
                  <div style={{
                    fontSize: "13px", color: "#E2E8F0", lineHeight: 1.35,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{summary}</div>
                )}
              </div>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(item.id); }}
                aria-label="Rimuovi feedback"
                style={{
                  background: "transparent", border: "none", color: colors.textMuted,
                  cursor: "pointer", fontSize: "20px", lineHeight: 1,
                  minWidth: touch.min, minHeight: touch.min,
                  borderRadius: "8px", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >×</button>
            </summary>
            <div style={{ padding: "0 12px 12px 12px", fontSize: "14px", lineHeight: 1.55, color: "#E2E8F0" }}>
              <RichText text={item.content} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
