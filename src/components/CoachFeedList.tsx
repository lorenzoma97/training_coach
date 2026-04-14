import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { CoachFeedItem } from "../lib/types";
import { events } from "../lib/events";
import RichText from "./RichText";

const SEVERITY_STYLE: Record<string, React.CSSProperties> = {
  info: { borderLeft: "3px solid #0891B2" },
  warn: { borderLeft: "3px solid #F59E0B", background: "#F59E0B10" },
  danger: { borderLeft: "3px solid #EF4444", background: "#EF444418" },
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
    const id = setInterval(load, 3000);
    const off = events.on("plan:updated", load);
    return () => { clearInterval(id); off(); };
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
      <div style={{ textAlign: "center", color: "#94A3B8", padding: "40px 20px", fontSize: "13px" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }}>📮</div>
        Nessun feedback del coach per ora.
        <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "4px" }}>
          Salva un allenamento nel Diario e il coach reagirà qui.
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
                {new Date(item.date).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <button
                onClick={() => dismiss(item.id)}
                aria-label="Rimuovi feedback"
                style={{
                  background: "transparent", border: "none", color: "#94A3B8",
                  cursor: "pointer", fontSize: "18px", lineHeight: 1,
                  minWidth: "36px", minHeight: "36px",
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
