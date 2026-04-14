import { useEffect, useState } from "react";
import { pingApiKey, getApiKey, setApiKey, hasApiKey } from "../lib/gemini";
import { storage, getJSON } from "../lib/storage";
import { CHUNKS, clearEmbeddings, ensureEmbeddings, getCacheStatus, CACHE_KEY, type CacheStatus, type EmbeddingCache } from "../lib/knowledge";
import { translateGeminiError } from "../lib/geminiErrors";

export default function SettingsPage({ onResetOnboarding }: { onResetOnboarding: () => void }) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [kbStatus, setKbStatus] = useState<CacheStatus>("missing");
  const [kbCreatedAt, setKbCreatedAt] = useState<string | null>(null);
  const [kbCount, setKbCount] = useState<number>(0);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbProgress, setKbProgress] = useState<{ done: number; total: number } | null>(null);
  const [kbError, setKbError] = useState<string | null>(null);

  async function refreshKbStatus() {
    const s = await getCacheStatus();
    setKbStatus(s);
    const cache = await getJSON<EmbeddingCache | null>(CACHE_KEY, null);
    if (cache) {
      setKbCreatedAt(cache.createdAt);
      setKbCount(Object.keys(cache.vectors || {}).length);
    } else {
      setKbCreatedAt(null);
      setKbCount(0);
    }
  }

  useEffect(() => {
    setKey(getApiKey());
    refreshKbStatus();
  }, []);

  const save = () => {
    setApiKey(key);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    setApiKey(key);
    const r = await pingApiKey();
    setTestResult(r.ok ? "✓ Chiave valida, connessione OK" : `✗ ${r.error || "Errore"}`);
    setTesting(false);
  };

  const resetAll = async () => {
    if (resetting) return;
    if (!confirm("Cancellare profilo, obiettivi, piano, chat e feed coach? (Il diario resta.)")) return;
    setResetting(true);
    try {
      await Promise.all([
        storage.delete("user-profile"),
        storage.delete("user-goals"),
        storage.delete("training-plan"),
        storage.delete("coach-feed"),
        storage.delete("coach-chat-history"),
        storage.delete("onboarding-completed"),
        storage.delete("last-weekly-report-date"),
      ]);
      onResetOnboarding();
    } finally {
      setResetting(false);
    }
  };

  const regenerateKnowledgeBase = async () => {
    if (kbBusy) return;
    if (!hasApiKey()) return;
    setKbBusy(true);
    setKbError(null);
    setKbProgress({ done: 0, total: CHUNKS.length });
    try {
      await clearEmbeddings();
      await ensureEmbeddings((done, total) => setKbProgress({ done, total }));
    } catch (e) {
      setKbError(translateGeminiError(e));
    } finally {
      setKbBusy(false);
      setKbProgress(null);
      await refreshKbStatus();
    }
  };

  const wipeDiary = async () => {
    if (!confirm("Cancellare TUTTI i dati del diario (sessioni + check giornalieri)? Operazione irreversibile.")) return;
    const keys = await storage.keys("day:");
    for (const k of keys) await storage.delete(k);
    await storage.delete("diary-index");
    alert("Diario cancellato.");
  };

  const labelStyle: React.CSSProperties = { fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 14px", background: "#1A1A2E",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
    color: "#E2E8F0", fontSize: "15px", outline: "none", boxSizing: "border-box",
    fontFamily: "'JetBrains Mono', monospace",
  };
  const cardStyle: React.CSSProperties = {
    background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "14px", padding: "18px 20px",
  };

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px 120px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Impostazioni</div>
        <h1 style={{ fontSize: "26px", fontWeight: 900, margin: "4px 0 0", letterSpacing: "-0.03em" }}>Configurazione</h1>
      </div>

      <div style={cardStyle}>
        <label style={labelStyle}>Chiave API Gemini</label>
        <input type="password" style={inputStyle} value={key} onChange={e => setKey(e.target.value)} placeholder="AIza..." />
        <div style={{ fontSize: "12px", color: "#64748B", marginTop: "8px", lineHeight: 1.5 }}>
          Ottieni una chiave gratuita su <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "#E8553A" }}>aistudio.google.com/apikey</a>.
          La chiave resta sul tuo dispositivo (localStorage), mai inviata a server terzi.
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button onClick={save} style={{
            padding: "10px 16px", background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
            border: "none", borderRadius: "10px", color: "#FFF", fontWeight: 700, cursor: "pointer",
          }}>{saved ? "✓ Salvata" : "Salva"}</button>
          <button onClick={test} disabled={testing || !key} style={{
            padding: "10px 16px", background: "#1A1A2E",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px",
            color: "#E2E8F0", fontWeight: 600, cursor: "pointer", opacity: (testing || !key) ? 0.5 : 1,
          }}>{testing ? "Test…" : "Testa"}</button>
        </div>
        {testResult && (
          <div style={{
            marginTop: "10px", fontSize: "13px",
            color: testResult.startsWith("✓") ? "#22C55E" : "#EF4444",
          }}>{testResult}</div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>Gestione dati</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            padding: "14px", background: "#1A1A2E",
            border: "1px solid #0891B244", borderRadius: "10px",
          }}>
            <div style={{ color: "#0891B2", fontWeight: 700, fontSize: "13px", marginBottom: "6px" }}>
              Knowledge base scientifica
            </div>
            <div style={{ color: "#94A3B8", fontSize: "12px", lineHeight: 1.5, marginBottom: "10px" }}>
              Indice di embeddings sui fondamenti scientifici (24 aree) usato dal coach per citare evidenze pertinenti.
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
              <span style={{
                display: "inline-block",
                padding: "3px 9px",
                borderRadius: "999px",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                background:
                  kbStatus === "ready" ? "#16A34A22" :
                  kbStatus === "stale" ? "#F59E0B22" :
                  kbStatus === "no-key" ? "#EF444422" : "#64748B22",
                color:
                  kbStatus === "ready" ? "#22C55E" :
                  kbStatus === "stale" ? "#F59E0B" :
                  kbStatus === "no-key" ? "#EF4444" : "#94A3B8",
              }}>
                {kbStatus === "ready" && "Pronta"}
                {kbStatus === "stale" && "Da rigenerare"}
                {kbStatus === "missing" && "Non creata"}
                {kbStatus === "no-key" && "Chiave API richiesta"}
              </span>
              {kbStatus === "ready" && (
                <span style={{ color: "#64748B", fontSize: "12px" }}>
                  {kbCount}/{CHUNKS.length} chunks
                  {kbCreatedAt && ` · ${new Date(kbCreatedAt).toLocaleDateString("it-IT")}`}
                </span>
              )}
            </div>

            {kbBusy && kbProgress && (
              <div style={{ marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "4px" }}>
                  Generazione embeddings… {kbProgress.done}/{kbProgress.total}
                </div>
                <div style={{ height: "6px", background: "#0F172A", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${(kbProgress.done / kbProgress.total) * 100}%`,
                    background: "#0891B2",
                    transition: "width 0.2s ease",
                  }} />
                </div>
              </div>
            )}

            {kbError && (
              <div style={{ color: "#EF4444", fontSize: "12px", marginBottom: "8px" }}>
                {kbError}
              </div>
            )}

            <button
              onClick={regenerateKnowledgeBase}
              disabled={kbBusy || !hasApiKey()}
              style={{
                padding: "9px 14px",
                background: (kbBusy || !hasApiKey()) ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
                border: "none",
                borderRadius: "8px",
                color: "#FFF",
                fontWeight: 700,
                fontSize: "13px",
                cursor: (kbBusy || !hasApiKey()) ? "not-allowed" : "pointer",
                opacity: (kbBusy || !hasApiKey()) ? 0.5 : 1,
              }}
            >
              {kbBusy ? "Rigenerazione in corso…" : "Rigenera knowledge base"}
            </button>
          </div>
          <button onClick={resetAll} disabled={resetting} style={{
            padding: "14px", background: "#1A1A2E",
            border: "1px solid #F59E0B44", borderRadius: "10px",
            cursor: resetting ? "wait" : "pointer", textAlign: "left",
          }}>
            <div style={{ color: "#F59E0B", fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>
              🔄 Reset coach (mantieni diario)
            </div>
            <div style={{ color: "#94A3B8", fontSize: "12px", lineHeight: 1.4 }}>
              Cancella: profilo, obiettivi, piano, chat e feed. <b>Diario e sessioni restano.</b>
            </div>
          </button>
          <button onClick={wipeDiary} style={{
            padding: "14px", background: "#1A1A2E",
            border: "1px solid #EF444444", borderRadius: "10px",
            cursor: "pointer", textAlign: "left",
          }}>
            <div style={{ color: "#EF4444", fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>
              🗑 Cancella tutto il diario
            </div>
            <div style={{ color: "#94A3B8", fontSize: "12px", lineHeight: 1.4 }}>
              Cancella TUTTE le sessioni e i check giornalieri. <b>Coach e profilo restano.</b>
            </div>
          </button>
        </div>
      </div>

      <div style={{ ...cardStyle, background: "#1A1A2E" }}>
        <div style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.6 }}>
          <b>Privacy</b>: questa app non ha backend. Tutti i dati restano nel tuo browser. Quando interagisci col coach, i dati necessari vengono inviati ai server Google Gemini (con la tua chiave). Nessuna telemetria, nessun tracking.
        </div>
      </div>
    </div>
  );
}
