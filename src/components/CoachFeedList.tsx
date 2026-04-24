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
      <div style={{ textAlign: "center", color: "#CBD5E1", padding: "40px 20px", fontSize: "13px" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }} aria-hidden="true">📮</div>
        <div style={{ fontWeight: 600 }}>Nessun feedback del coach per ora.</div>
        <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.5 }}>
          Il coach reagisce automaticamente ai tuoi allenamenti salvati nel Diario e al check giornaliero. Qui trovi feedback post-sessione, report settimanali e alert.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {items.map(item => {
        const t = TYPE_LABELS[item.type] || { label: item.type, emoji: "•" };
        const sev = item.severity ?? "info";
        return (
          <div key={item.id} role="article" style={{
            background: "#16213E", borderRadius: "12px", padding: "14px 16px",
            border: "1px solid rgba(255,255,255,0.06)",
            ...SEVERITY_STYLE[sev], animation: "slideUp 0.2s ease",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span style={{ fontSize: "16px", lineHeight: 1 }}>{t.emoji}</span>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#CBD5E1", letterSpacing: "0.1em", textTransform: "uppercase" }}>{item.title || t.label}</div>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "#94A3B8", whiteSpace: "nowrap" }}>
                {(() => { const d = new Date(item.date); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })()}
              </span>
              <button
                onClick={() => dismiss(item.id)}
                aria-label="Rimuovi feedback"
                style={{
                  background: "transparent", border: "none", color: colors.textMuted,
                  cursor: "pointer", fontSize: "20px", lineHeight: 1,
                  minWidth: touch.min, minHeight: touch.min,
                  borderRadius: "8px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >×</button>
            </div>
            <div style={{ fontSize: "14px", lineHeight: 1.55, color: "#E2E8F0" }}>
              <RichText text={item.content} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
