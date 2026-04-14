import { useEffect, useMemo, useState } from "react";
import { hasApiKey } from "../lib/gemini";
import {
  ADAPTERS, getLLMConfig, setLLMConfig, type LLMConfig, type LLMModel, type ProviderId,
} from "../lib/llm";
import { storage, getJSON } from "../lib/storage";
import { CHUNKS, clearEmbeddings, ensureEmbeddings, getCacheStatus, CACHE_KEY, type CacheStatus, type EmbeddingCache } from "../lib/knowledge";
import { translateGeminiError } from "../lib/geminiErrors";
import BackupSection from "../components/BackupSection";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini (consigliato)",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
};
const PROVIDER_HELP: Record<ProviderId, { url: string; label: string }> = {
  gemini: { url: "https://aistudio.google.com/apikey", label: "aistudio.google.com/apikey" },
  openai: { url: "https://platform.openai.com/api-keys", label: "platform.openai.com/api-keys" },
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "console.anthropic.com/settings/keys" },
};
const PROVIDER_PLACEHOLDER: Record<ProviderId, string> = {
  gemini: "AIza...",
  openai: "sk-...",
  anthropic: "sk-ant-...",
};

export default function SettingsPage({ onResetOnboarding }: { onResetOnboarding: () => void }) {
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [apiKey, setApiKeyState] = useState("");
  const [modelId, setModelId] = useState<string>("");
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [resetting, setResetting] = useState(false);
  const [kbStatus, setKbStatus] = useState<CacheStatus>("missing");
  const [kbCreatedAt, setKbCreatedAt] = useState<string | null>(null);
  const [kbCount, setKbCount] = useState<number>(0);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbProgress, setKbProgress] = useState<{ done: number; total: number } | null>(null);
  const [kbError, setKbError] = useState<string | null>(null);
  const [kbFailures, setKbFailures] = useState<number>(0);
  const [kbLastFailureMsg, setKbLastFailureMsg] = useState<string | null>(null);

  const adapter = useMemo(() => ADAPTERS[provider], [provider]);
  const providerSupportsEmbeddings = adapter.supportsEmbeddings;

  async function refreshKbStatus() {
    const s = await getCacheStatus();
    setKbStatus(s);
    const cache = await getJSON<EmbeddingCache | null>(CACHE_KEY, null);
    if (cache) {
      setKbCreatedAt(cache.createdAt);
      setKbCount(Object.keys(cache.vectors || {}).length);
      setKbFailures(cache.lastFailures ?? 0);
      setKbLastFailureMsg(cache.lastFailureMessage ?? null);
    } else {
      setKbCreatedAt(null);
      setKbCount(0);
      setKbFailures(0);
      setKbLastFailureMsg(null);
    }
  }

  useEffect(() => {
    (async () => {
      const cfg = await getLLMConfig();
      if (cfg) {
        setProvider(cfg.provider);
        setApiKeyState(cfg.apiKey);
        setModelId(cfg.modelId);
      }
      refreshKbStatus();
    })();
  }, []);

  // Se cambio provider, azzero modello e lista (andrà ri-scoperta).
  const onProviderChange = (p: ProviderId) => {
    setProvider(p);
    setModels([]);
    setModelsError(null);
    setTestResult(null);
    setModelId(ADAPTERS[p].defaultChatModel);
  };

  const discoverModels = async () => {
    if (!apiKey.trim()) return;
    setLoadingModels(true);
    setModelsError(null);
    try {
      const list = await adapter.listModels(apiKey.trim());
      setModels(list);
      // Preseleziona default se presente, altrimenti il primo.
      const def = list.find(m => m.id === adapter.defaultChatModel)
        || list.find(m => m.id.includes(adapter.defaultChatModel))
        || list[0];
      if (def) setModelId(def.id);
    } catch (e: any) {
      setModelsError(e?.message || String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  const saveAndTest = async () => {
    if (!apiKey.trim() || !modelId.trim()) return;
    setSaving(true);
    setTestResult(null);
    setSaved(false);
    const config: LLMConfig = { provider, apiKey: apiKey.trim(), modelId: modelId.trim() };
    try {
      await setLLMConfig(config);
      setSaved(true);
      const r = await adapter.ping(config.apiKey, config.modelId);
      setTestResult(r.ok ? "✓ Chiave valida, connessione OK" : `✗ ${r.error || "Errore"}`);
      await refreshKbStatus();
    } catch (e: any) {
      setTestResult(`✗ ${e?.message || String(e)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(false), 1500);
    }
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
    if (!providerSupportsEmbeddings) {
      setKbError("Il provider corrente non supporta embeddings. Usa Gemini o OpenAI per la knowledge base.");
      return;
    }
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
  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: "inherit",
  };
  const cardStyle: React.CSSProperties = {
    background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "14px", padding: "18px 20px",
  };

  const help = PROVIDER_HELP[provider];

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px 120px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Impostazioni</div>
        <h1 style={{ fontSize: "26px", fontWeight: 900, margin: "4px 0 0", letterSpacing: "-0.03em" }}>Configurazione</h1>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "14px" }}>Provider LLM</div>

        <label style={labelStyle}>Provider</label>
        <select style={selectStyle} value={provider} onChange={e => onProviderChange(e.target.value as ProviderId)}>
          {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map(p => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </select>

        <div style={{ marginTop: "14px" }}>
          <label style={labelStyle}>Chiave API</label>
          <input
            type="password" style={inputStyle}
            value={apiKey}
            onChange={e => { setApiKeyState(e.target.value); setTestResult(null); }}
            placeholder={PROVIDER_PLACEHOLDER[provider]}
            autoComplete="off"
          />
          <div style={{ fontSize: "12px", color: "#64748B", marginTop: "8px", lineHeight: 1.5 }}>
            Ottieni la chiave su <a href={help.url} target="_blank" rel="noreferrer" style={{ color: "#E8553A" }}>{help.label}</a>.
            La chiave resta sul tuo dispositivo (localStorage), mai inviata a server terzi.
            {!providerSupportsEmbeddings && (
              <div style={{ marginTop: "6px", color: "#F59E0B" }}>
                Nota: {PROVIDER_LABELS[provider].replace(" (consigliato)", "")} non fornisce embeddings nativi. La knowledge base RAG sarà disabilitata.
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: "14px" }}>
          <label style={labelStyle}>Modello</label>
          <div style={{ display: "flex", gap: "8px", alignItems: "stretch" }}>
            <select
              style={{ ...selectStyle, flex: 1 }}
              value={modelId}
              onChange={e => setModelId(e.target.value)}
              disabled={loadingModels}
            >
              {models.length === 0 && (
                <option value={modelId || adapter.defaultChatModel}>
                  {modelId || adapter.defaultChatModel} (default)
                </option>
              )}
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.displayName && m.displayName !== m.id ? `${m.displayName} — ${m.id}` : m.id}
                </option>
              ))}
            </select>
            <button
              onClick={discoverModels}
              disabled={loadingModels || !apiKey.trim()}
              style={{
                padding: "10px 14px", background: "#1A1A2E",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px",
                color: "#E2E8F0", fontWeight: 600, cursor: "pointer",
                whiteSpace: "nowrap",
                opacity: (loadingModels || !apiKey.trim()) ? 0.5 : 1,
              }}
            >
              {loadingModels ? "Carico…" : "Scopri modelli"}
            </button>
          </div>
          {modelsError && (
            <div style={{ color: "#EF4444", fontSize: "12px", marginTop: "8px" }}>{modelsError}</div>
          )}
          {models.length > 0 && (
            <div style={{ fontSize: "11px", color: "#64748B", marginTop: "6px" }}>
              {models.length} modelli compatibili trovati.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
          <button
            onClick={saveAndTest}
            disabled={saving || !apiKey.trim() || !modelId.trim()}
            style={{
              padding: "10px 16px",
              background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
              border: "none", borderRadius: "10px", color: "#FFF",
              fontWeight: 700, cursor: "pointer",
              opacity: (saving || !apiKey.trim() || !modelId.trim()) ? 0.5 : 1,
            }}
          >
            {saving ? "Testo…" : saved ? "✓ Salvata" : "Salva e testa"}
          </button>
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
                  kbStatus === "no-key" ? "#EF444422" :
                  kbStatus === "unsupported" ? "#F59E0B22" : "#64748B22",
                color:
                  kbStatus === "ready" ? "#22C55E" :
                  kbStatus === "stale" ? "#F59E0B" :
                  kbStatus === "no-key" ? "#EF4444" :
                  kbStatus === "unsupported" ? "#F59E0B" : "#94A3B8",
              }}>
                {kbStatus === "ready" && "Pronta"}
                {kbStatus === "stale" && "Da rigenerare"}
                {kbStatus === "missing" && "Non creata"}
                {kbStatus === "no-key" && "Chiave API richiesta"}
                {kbStatus === "unsupported" && "Provider non supportato"}
              </span>
              {(kbStatus === "ready" || kbStatus === "stale") && kbCount > 0 && (
                <span style={{ color: "#94A3B8", fontSize: "12px" }}>
                  {kbCount}/{CHUNKS.length} chunks
                  {kbCreatedAt && ` · ${new Date(kbCreatedAt).toLocaleDateString("it-IT")}`}
                </span>
              )}
            </div>

            {kbFailures > 0 && !kbBusy && (
              <div style={{ color: "#F59E0B", fontSize: "12px", marginBottom: "8px", padding: "6px 10px", background: "#F59E0B15", borderRadius: "6px" }}>
                ⚠ Ultima generazione: {kbFailures} chunk falliti su {CHUNKS.length}.
                {kbLastFailureMsg && <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic", color: "#FCD34D" }}>Causa: {kbLastFailureMsg.slice(0, 160)}</div>}
                <div style={{ fontSize: "11px", marginTop: "4px" }}>Rigenera per completare i mancanti.</div>
              </div>
            )}

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
              disabled={kbBusy || !hasApiKey() || !providerSupportsEmbeddings}
              style={{
                padding: "9px 14px",
                background: (kbBusy || !hasApiKey() || !providerSupportsEmbeddings) ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
                border: "none",
                borderRadius: "8px",
                color: "#FFF",
                fontWeight: 700,
                fontSize: "13px",
                cursor: (kbBusy || !hasApiKey() || !providerSupportsEmbeddings) ? "not-allowed" : "pointer",
                opacity: (kbBusy || !hasApiKey() || !providerSupportsEmbeddings) ? 0.5 : 1,
              }}
            >
              {kbBusy ? "Rigenerazione in corso…" : "Rigenera knowledge base"}
            </button>
          </div>

          <BackupSection />

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
          <b>Privacy</b>: questa app non ha backend. Tutti i dati restano nel tuo browser. Quando interagisci col coach, i dati necessari vengono inviati al provider LLM scelto (con la tua chiave). Nessuna telemetria, nessun tracking.
        </div>
      </div>
    </div>
  );
}
