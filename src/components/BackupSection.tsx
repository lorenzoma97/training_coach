import { useRef, useState } from "react";
import { buildBackup, downloadBackup, validateBackup, restoreBackup, type BackupPayload } from "../lib/backup";

const cardStyle: React.CSSProperties = {
  background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px", padding: "18px 20px",
};

export default function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "info" | "error" | "success"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const show = (type: "info" | "error" | "success", text: string) => {
    setMessage({ type, text });
    if (type === "success") setTimeout(() => setMessage(null), 5000);
  };

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await buildBackup();
      downloadBackup(payload);
      const dayCount = Object.keys(payload.data.days).length;
      show("success", `✓ Backup scaricato (${dayCount} giorni + profilo + coach).`);
    } catch (e) {
      show("error", (e as Error)?.message || "Errore durante l'export");
    }
    setBusy(false);
  };

  const handleImport = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        show("error", "Il file non contiene JSON valido.");
        setBusy(false);
        return;
      }
      const v = validateBackup(parsed);
      if (!v.ok) {
        show("error", v.error);
        setBusy(false);
        return;
      }
      const payload = v.payload;
      const dayCount = Object.keys(payload.data.days || {}).length;
      const ok = confirm(
        `Ripristino backup del ${new Date(payload.exportedAt).toLocaleDateString("it-IT")}:\n` +
        `- ${dayCount} giorni di diario\n` +
        `- profilo/obiettivi/piano/feed coach\n\n` +
        `Tutti i dati attuali verranno SOSTITUITI.\n(La chiave API e la knowledge base RAG non sono toccate.)\n\nContinuare?`
      );
      if (!ok) { setBusy(false); return; }

      const report = await restoreBackup(payload, { wipeBefore: true, overwrite: true });
      show("success",
        `✓ Ripristinato: ${report.restoredDays} giorni + ${report.restoredKeys.length} chiavi. Ricarico l'app tra 2s.`);
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      show("error", (e as Error)?.message || "Errore durante il ripristino");
    }
    setBusy(false);
  };

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px", color: "#CBD5E1" }}>
        📦 Backup & Ripristino
      </div>
      <div style={{ color: "#94A3B8", fontSize: "12px", lineHeight: 1.5, marginBottom: "14px" }}>
        Esporta un file JSON con <b>tutti</b> i tuoi dati (diario, profilo, obiettivi, piano, feed e chat coach).
        Puoi re-importarlo per ripristinare tutto — utile per cambiare dispositivo o prima di pulire il browser.
        <br />
        <span style={{ color: "#64748B", fontSize: "11px" }}>
          Nota: la chiave API e gli embeddings RAG non sono inclusi per sicurezza e ricreabilità.
        </span>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button
          onClick={handleExport}
          disabled={busy}
          style={{
            padding: "10px 14px",
            background: busy ? "#1E293B" : "linear-gradient(135deg, #059669 0%, #047857 100%)",
            border: "none", borderRadius: "10px",
            color: "#FFF", fontWeight: 700, fontSize: "13px",
            cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1,
          }}
        >
          ⬇ Esporta backup JSON
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          style={{
            padding: "10px 14px",
            background: "#1A1A2E",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "10px",
            color: "#E2E8F0", fontWeight: 700, fontSize: "13px",
            cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1,
          }}
        >
          ⬆ Importa backup JSON
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
            e.target.value = ""; // reset per permettere re-upload dello stesso file
          }}
        />
      </div>

      {message && (
        <div style={{
          marginTop: "12px", fontSize: "13px",
          color: message.type === "error" ? "#EF4444" : message.type === "success" ? "#22C55E" : "#94A3B8",
          padding: "8px 10px",
          background: message.type === "error" ? "#7F1D1D22" : message.type === "success" ? "#14532D22" : "transparent",
          borderRadius: "8px",
          border: message.type !== "info" ? `1px solid ${message.type === "error" ? "#7F1D1D" : "#14532D"}` : "none",
        }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
