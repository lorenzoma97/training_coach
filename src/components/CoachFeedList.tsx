import { useEffect, useState } from "react";
import { getJSON, setJSON } from "../lib/storage";
import type { CoachFeedItem } from "../lib/types";
import { events } from "../lib/events";

const SEVERITY_STYLE: Record<string, React.CSSProperties> = {
  info: { borderLeft: "3px solid #0891B2" },
  warn: { borderLeft: "3px solid #F59E0B", background: "#F59E0B10" },
  danger: { borderLeft: "3px solid #EF4444", background: "#EF444415" },
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
    const updated = items.filter(x => x.id !== id);
    setItems(updated);
    await setJSON("coach-feed", updated);
  };

  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", color: "#64748B", padding: "30px 20px", fontSize: "13px" }}>
        Nessun feedback del coach per ora. Salva un allenamento e il coach reagirà.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {items.map(item => {
        const t = TYPE_LABELS[item.type] || { label: item.type, emoji: "•" };
        const sev = item.severity ?? "info";
        return (
          <div key={item.id} style={{
            background: "#16213E", borderRadius: "12px", padding: "14px 16px",
            border: "1px solid rgba(255,255,255,0.06)",
            ...SEVERITY_STYLE[sev], animation: "slideUp 0.2s ease",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "14px" }}>{t.emoji}</span>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase" }}>{item.title || t.label}</div>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "#64748B" }}>
                {new Date(item.date).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <button onClick={() => dismiss(item.id)} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: "13px", padding: "0 4px" }}>×</button>
            </div>
            <div style={{ fontSize: "14px", lineHeight: 1.5, color: "#E2E8F0", whiteSpace: "pre-wrap" }}>{item.content}</div>
          </div>
        );
      })}
    </div>
  );
}
