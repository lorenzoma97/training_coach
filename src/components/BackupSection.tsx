import { useEffect, useRef, useState } from "react";
import { buildBackup, downloadBackup, validateBackup, restoreBackup, type BackupPayload } from "../lib/backup";
import { getJSON, storage } from "../lib/storage";

const cardStyle: React.CSSProperties = {
  background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px", padding: "18px 20px",
};

interface CurrentStateSummary {
  diaryDays: number;
  hasPlan: boolean;
  goalsCount: number;
  chatMessages: number;
}

interface BackupSummary {
  diaryDays: number;
  hasPlan: boolean;
  goalsCount: number;
  chatMessages: number;
  exportedAt: string;
}

async function summarizeCurrentState(): Promise<CurrentStateSummary> {
  const dayKeys = await storage.keys("day:");
  const plan = await getJSON<unknown>("training-plan", null);
  const goals = await getJSON<unknown[]>("user-goals", []);
  const chat = await getJSON<unknown[]>("coach-chat-history", []);
  return {
    diaryDays: dayKeys.length,
    hasPlan: plan !== null && plan !== undefined,
    goalsCount: Array.isArray(goals) ? goals.length : 0,
    chatMessages: Array.isArray(chat) ? chat.length : 0,
  };
}

function summarizeBackup(payload: BackupPayload): BackupSummary {
  const goals = (payload.data as any)["user-goals"];
  const chat = (payload.data as any)["coach-chat-history"];
  return {
    diaryDays: Object.keys(payload.data.days || {}).length,
    hasPlan: (payload.data as any)["training-plan"] != null,
    goalsCount: Array.isArray(goals) ? goals.length : 0,
    chatMessages: Array.isArray(chat) ? chat.length : 0,
    exportedAt: payload.exportedAt,
  };
}

export default function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "info" | "error" | "success"; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<
    | null
    | {
        payload: BackupPayload;
        before: CurrentStateSummary;
        after: BackupSummary;
      }
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  const show = (type: "info" | "error" | "success", text: string) => {
    setMessage({ type, text });
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    if (type === "success") msgTimerRef.current = setTimeout(() => setMessage(null), 8000);
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
      const [before, after] = await Promise.all([
        summarizeCurrentState(),
        Promise.resolve(summarizeBackup(payload)),
      ]);
      // Apre dialog inline con summary esplicito before/after
      setConfirmState({ payload, before, after });
    } catch (e) {
      show("error", (e as Error)?.message || "Errore durante il ripristino");
    }
    setBusy(false);
  };

  const performRestore = async () => {
    if (!confirmState) return;
    const { payload } = confirmState;
    setConfirmState(null);
    setBusy(true);
    try {
      const report = await restoreBackup(payload, { wipeBefore: true, overwrite: true });
      show(
        "success",
        `✓ Ripristinato: ${report.restoredDays} giorni + ${report.restoredKeys.length} chiavi. ` +
        `Ricarico l'app tra 2s. Ricordati di reinserire la chiave API.`,
      );
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      show(
        "error",
        `Ripristino fallito: ${(e as Error)?.message || "errore sconosciuto"}. ` +
        `Lo stato potrebbe essere parzialmente corrotto: esporta un nuovo backup e controlla i dati.`,
      );
    }
    setBusy(false);
  };

  const cancelRestore = () => {
    setConfirmState(null);
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
        <span style={{ color: "#FCA5A5", fontSize: "11px" }}>
          ⚠ La chiave API <b>NON</b> è nel backup (è un segreto: reinseriscila dopo il restore).
        </span>
        <br />
        <span style={{ color: "#64748B", fontSize: "11px" }}>
          Gli embeddings RAG saranno ricreati automaticamente al primo uso.
        </span>
      </div>

      {/* Warning PII sempre visibile sopra le azioni export/import. */}
      <div
        role="note"
        aria-label="Avviso privacy dati sensibili"
        style={{
          marginBottom: "14px",
          padding: "10px 12px",
          background: "#78350F22",
          border: "1px solid #F59E0B",
          borderRadius: "10px",
          color: "#FDE68A",
          fontSize: "12px",
          lineHeight: 1.5,
          fontWeight: 600,
        }}
      >
        ⚠ <b>Privacy:</b> il backup contiene dati personali sensibili (peso, sonno,
        infortuni, ciclo mestruale, FC, chat con il coach). <b>Non condividere</b>
        {" "}questo file via chat/forum/email. Usalo solo per backup personale o
        trasferimento dispositivo.
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

      {confirmState && (
        <div
          style={{
            marginTop: "14px",
            padding: "14px",
            background: "#0F172A",
            border: "1px solid #7F1D1D",
            borderRadius: "10px",
            color: "#E2E8F0",
            fontSize: "13px",
            lineHeight: 1.55,
          }}
          role="dialog"
          aria-label="Conferma ripristino backup"
        >
          <div style={{ fontWeight: 700, marginBottom: "8px", color: "#FCA5A5" }}>
            ⚠ Confermare il ripristino?
          </div>
          <div style={{ marginBottom: "10px", color: "#CBD5E1" }}>
            Backup del{" "}
            <b>{new Date(confirmState.after.exportedAt).toLocaleString("it-IT")}</b>.
            <br />
            Tutti i dati attuali verranno <b>sostituiti</b> in modo atomico.
          </div>
          {/* Warning PII ripetuto nel dialog di conferma (contesto: l'utente sta per
              ripristinare un file che potrebbe provenire da canali diversi). */}
          <div
            style={{
              marginBottom: "10px",
              padding: "8px 10px",
              background: "#78350F22",
              border: "1px solid #F59E0B",
              borderRadius: "8px",
              color: "#FDE68A",
              fontSize: "11px",
              lineHeight: 1.5,
              fontWeight: 600,
            }}
          >
            ⚠ <b>Privacy:</b> il backup contiene dati personali sensibili
            (peso, sonno, infortuni, ciclo mestruale, FC, chat con il coach).
            <b> Non condividere</b> questo file via chat/forum/email. Usalo
            solo per backup personale o trasferimento dispositivo.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
            <div style={{ padding: "8px 10px", background: "#1E293B", borderRadius: "8px" }}>
              <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Stato attuale (verrà cancellato)</div>
              <div>• {confirmState.before.diaryDays} giorni diario</div>
              <div>• Piano: {confirmState.before.hasPlan ? "presente" : "assente"}</div>
              <div>• {confirmState.before.goalsCount} obiettivi</div>
              <div>• {confirmState.before.chatMessages} messaggi chat</div>
            </div>
            <div style={{ padding: "8px 10px", background: "#14532D22", borderRadius: "8px", border: "1px solid #14532D" }}>
              <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Dal backup (verrà ripristinato)</div>
              <div>• {confirmState.after.diaryDays} giorni diario</div>
              <div>• Piano: {confirmState.after.hasPlan ? "presente" : "assente"}</div>
              <div>• {confirmState.after.goalsCount} obiettivi</div>
              <div>• {confirmState.after.chatMessages} messaggi chat</div>
            </div>
          </div>
          <div style={{ fontSize: "11px", color: "#FCA5A5", marginBottom: "10px" }}>
            La chiave API <b>NON</b> è nel backup (è un segreto, reinseriscila dopo il restore).
            Gli embeddings RAG saranno ricreati automaticamente al primo uso.
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={performRestore}
              disabled={busy}
              style={{
                padding: "8px 14px",
                background: "linear-gradient(135deg, #B91C1C 0%, #7F1D1D 100%)",
                border: "none", borderRadius: "8px",
                color: "#FFF", fontWeight: 700, fontSize: "12px",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Sì, ripristina
            </button>
            <button
              onClick={cancelRestore}
              disabled={busy}
              style={{
                padding: "8px 14px",
                background: "#1A1A2E",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "8px",
                color: "#E2E8F0", fontWeight: 700, fontSize: "12px",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}

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
