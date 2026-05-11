import { useEffect, useMemo, useRef, useState } from "react";
import { hasApiKey } from "../lib/gemini";
import {
  ADAPTERS, getLLMConfig, setLLMConfig, type LLMConfig, type LLMModel, type ProviderId,
} from "../lib/llm";
import { storage, getJSON } from "../lib/storage";
import { CHUNKS, clearEmbeddings, ensureEmbeddings, getCacheStatus, type CacheStatus, type EmbeddingCache } from "../lib/knowledge";
import { getRagCache } from "../lib/ragStorage";
import { translateGeminiError } from "../lib/geminiErrors";
import { events } from "../lib/events";
import BackupSection from "../components/BackupSection";
import GoalsEditor from "../components/GoalsEditor";
import ProfileEditor from "../components/ProfileEditor";
import {
  previewImport as samsungPreviewImport,
  commitImport as samsungCommitImport,
  type ImportPreview as SamsungImportPreview,
} from "../lib/integrations/samsungHealth";

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

  // Samsung Health import (Wave 3.2)
  const [importBusy, setImportBusy] = useState(false);
  const [importPhase, setImportPhase] = useState<"idle" | "parsing" | "committing">("idle");
  const [importPreview, setImportPreview] = useState<SamsungImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importToast, setImportToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const samsungFileRef = useRef<HTMLInputElement>(null);
  const importToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    if (importToastTimerRef.current) clearTimeout(importToastTimerRef.current);
  }, []);

  const adapter = useMemo(() => ADAPTERS[provider], [provider]);
  const providerSupportsEmbeddings = adapter.supportsEmbeddings;

  async function refreshKbStatus() {
    const s = await getCacheStatus();
    setKbStatus(s);
    const cache = await getRagCache<EmbeddingCache>();
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

  const loadConfig = async () => {
    const cfg = await getLLMConfig();
    if (cfg) {
      setProvider(cfg.provider);
      setApiKeyState(cfg.apiKey);
      setModelId(cfg.modelId);
    }
    refreshKbStatus();
  };

  useEffect(() => { loadConfig(); }, []);

  // Cross-tab sync. Nota: gli embeddings RAG sono in IndexedDB (vedi
  // ragStorage.ts) — IndexedDB NON emette storage events cross-tab. Se l'utente
  // rigenera la KB in un'altra tab, questa NON viene notificata. Trade-off
  // accettato: cambio raro e non critico per il consumer (status UI).
  // Manteniamo il listener per llm-config (chiave/modello) che resta in localStorage.
  useEffect(() => {
    const off = events.on("data:externalChange", ({ key }) => {
      if (key === "llm-config" || key === "gemini-api-key") loadConfig();
    });
    return off;
  }, []);

  // Refresh status KB ogni volta che il tab Settings torna in foreground —
  // così se l'utente ha rigenerato la KB in un'altra tab e torna qui, vede
  // lo stato aggiornato senza polling continuo.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refreshKbStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
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
        storage.delete("training-plan-next"),
        storage.delete("plan-history"),
        storage.delete("coach-feed"),
        storage.delete("coach-chat-history"),
        storage.delete("coach-feed-last-seen"),
        storage.delete("onboarding-completed"),
        storage.delete("onboarding-draft"),
        storage.delete("last-weekly-report-date"),
        storage.delete("last-motivation-date"),
        storage.delete("pending-diary-openAdd"),
        storage.delete("pending-chat-prompt"),
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
    // Typed-confirm: cancellazione totale è irreversibile. Prompt nativo non
    // basta (troppo facile click accidentale). Richiede digitazione esplicita.
    const dayKeys = await storage.keys("day:");
    const count = dayKeys.length;
    const input = prompt(
      `Stai per eliminare ${count} giorni di diario (sessioni + check). L'operazione è DEFINITIVA.\n\n` +
      `Per confermare, scrivi esattamente: CONFERMO`
    );
    if (input?.trim() !== "CONFERMO") return;
    for (const k of dayKeys) await storage.delete(k);
    await storage.delete("diary-index");
    alert(`✓ Diario cancellato (${count} giorni rimossi).`);
  };

  // ─── Samsung Health import handlers ──────────────────────────────────────
  const showImportToast = (toast: { type: "success" | "error"; text: string }) => {
    setImportToast(toast);
    if (importToastTimerRef.current) clearTimeout(importToastTimerRef.current);
    importToastTimerRef.current = setTimeout(() => setImportToast(null), 5000);
  };

  const resetImportState = () => {
    setImportPreview(null);
    setImportError(null);
    setImportPhase("idle");
    if (samsungFileRef.current) samsungFileRef.current.value = "";
  };

  const onSamsungFileSelected = async (file: File | null) => {
    if (!file || importBusy) return;
    setImportBusy(true);
    setImportPhase("parsing");
    setImportError(null);
    setImportPreview(null);
    try {
      const preview = await samsungPreviewImport(file);
      setImportPreview(preview);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
      setImportPhase("idle");
      // Reset input so re-selecting stesso file riemette change event.
      if (samsungFileRef.current) samsungFileRef.current.value = "";
    }
  };

  const onConfirmSamsungImport = async () => {
    if (!importPreview || importBusy) return;
    setImportBusy(true);
    setImportPhase("committing");
    setImportError(null);
    try {
      const result = await samsungCommitImport(importPreview);
      // Notifica diario per refresh elenco workout (l'evento usa il primo nuovo
      // workout come stub; non è strettamente "il" workout salvato ma serve a
      // triggerare i listener che ricaricano da storage).
      const firstNew = importPreview.newWorkouts[0];
      if (firstNew) {
        events.emit("workout:saved", {
          date: firstNew.startedAt.slice(0, 10),
          workout: { source: "samsung_health", batch: true },
        });
      }
      showImportToast({
        type: "success",
        text: `✓ Importati ${result.workoutsCreated} workout. ${result.duplicatesSkipped} duplicati saltati.`,
      });
      resetImportState();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportError(msg);
      showImportToast({ type: "error", text: `✗ Import fallito: ${msg}` });
    } finally {
      setImportBusy(false);
      setImportPhase("idle");
    }
  };

  const onCancelSamsungImport = () => {
    if (importBusy) return;
    resetImportState();
  };

  const formatSampleDate = (iso: string): string => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
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
                  {kbCreatedAt && (() => { const d = new Date(kbCreatedAt); return ` · ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; })()}
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

          <div style={{ background: "#16213E", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "20px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: "12px" }}>
              Profilo atleta
            </div>
            <div style={{ fontSize: "13px", color: "#94A3B8", marginBottom: "14px", lineHeight: 1.5 }}>
              Aggiorna lo stato di salute corrente: infortuni guariti, nuovi farmaci/integratori, zone di dolore da monitorare. Età/peso/altezza si modificano dal Reset coach.
            </div>
            <ProfileEditor />
          </div>

          <div style={{ background: "#16213E", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "20px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: "12px" }}>
              Obiettivi
            </div>
            <div style={{ fontSize: "13px", color: "#94A3B8", marginBottom: "14px", lineHeight: 1.5 }}>
              Gestisci i tuoi obiettivi attivi. Il coach dimensiona il piano su questi.
            </div>
            <GoalsEditor />
          </div>

          <BackupSection />

          {/* ───── Samsung Health import (Wave 3.2) ───── */}
          <div style={{
            padding: "16px 18px", background: "#1A1A2E",
            border: "1px solid #6366F144", borderRadius: "12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <span aria-hidden style={{ fontSize: "20px" }}>📥</span>
              <div style={{ color: "#A5B4FC", fontWeight: 700, fontSize: "14px" }}>
                Importa dati wearable (Samsung Health)
              </div>
            </div>
            <div id="samsung-import-help" style={{ color: "#94A3B8", fontSize: "12px", lineHeight: 1.5, marginBottom: "10px" }}>
              Importa workout, FC e dati registrati dal tuo Galaxy Watch / Samsung Health.
              Riceverai dati più precisi di quelli che inseresti a mano.
              <div style={{ marginTop: "6px", color: "#64748B", fontSize: "11px" }}>
                I dati restano sul tuo dispositivo, niente upload server.
              </div>
            </div>

            <a
              href="docs/guida-import-samsung-health.md"
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                color: "#A5B4FC", fontSize: "12px",
                textDecoration: "underline", marginBottom: "12px",
              }}
            >
              📖 Come esportare da Samsung Health
            </a>

            {/* File input nascosto + button label */}
            <input
              ref={samsungFileRef}
              type="file"
              accept=".zip"
              aria-describedby="samsung-import-help"
              aria-label="Carica file ZIP esportato da Samsung Health"
              onChange={(e) => onSamsungFileSelected(e.target.files?.[0] ?? null)}
              disabled={importBusy}
              style={{
                position: "absolute",
                width: 1, height: 1,
                padding: 0, margin: -1,
                overflow: "hidden", clip: "rect(0,0,0,0)",
                whiteSpace: "nowrap", border: 0,
              }}
            />

            {!importPreview && (
              <button
                onClick={() => samsungFileRef.current?.click()}
                disabled={importBusy}
                aria-busy={importBusy}
                style={{
                  display: "block", width: "100%",
                  minHeight: "44px", padding: "12px 16px",
                  background: importBusy
                    ? "#1E293B"
                    : "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                  border: "none", borderRadius: "10px",
                  color: "#FFF", fontWeight: 700, fontSize: "14px",
                  cursor: importBusy ? "wait" : "pointer",
                  opacity: importBusy ? 0.7 : 1,
                }}
              >
                {importBusy ? "🔄 In corso…" : "Carica file ZIP Samsung Health"}
              </button>
            )}

            {importPhase === "parsing" && (
              <div
                role="status"
                aria-live="polite"
                aria-busy="true"
                aria-label="Analisi file in corso"
                style={{
                  marginTop: "10px", padding: "10px 12px",
                  background: "#1E293B", borderRadius: "8px",
                  color: "#A5B4FC", fontSize: "12px", lineHeight: 1.5,
                }}
              >
                🔄 Analizzo il file… (può impiegare 30s-2min)
              </div>
            )}

            {importError && !importBusy && (
              <div
                role="alert"
                style={{
                  marginTop: "10px", padding: "10px 12px",
                  background: "#EF444415", border: "1px solid #EF444444",
                  borderRadius: "8px", color: "#EF4444", fontSize: "12px", lineHeight: 1.5,
                }}
              >
                ✗ Errore: {importError}
                <button
                  onClick={() => setImportError(null)}
                  style={{
                    display: "block", marginTop: "8px", minHeight: "36px",
                    padding: "6px 12px", background: "#1A1A2E",
                    border: "1px solid #EF444466", borderRadius: "8px",
                    color: "#EF4444", fontSize: "12px", fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Chiudi
                </button>
              </div>
            )}

            {importPreview && !importBusy && (
              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* Stats card */}
                <div style={{
                  padding: "12px", background: "#0F172A",
                  border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px",
                  fontSize: "13px", lineHeight: 1.7, color: "#E2E8F0",
                }}>
                  <div>📊 Trovati <b>{importPreview.totalSamples}</b> workout</div>
                  <div style={{ color: "#22C55E" }}>✅ <b>{importPreview.newWorkouts.length}</b> nuovi da importare</div>
                  <div style={{ color: "#94A3B8" }}>⏭ <b>{importPreview.matchedWorkouts.length}</b> già registrati (skip)</div>
                </div>

                {/* Warning tipi sconosciuti */}
                {importPreview.unrecognizedTypes.length > 0 && (
                  <div
                    role="alert"
                    style={{
                      padding: "10px 12px",
                      background: "#F59E0B15", border: "1px solid #F59E0B44",
                      borderRadius: "8px", color: "#F59E0B",
                      fontSize: "12px", lineHeight: 1.5,
                    }}
                  >
                    ⚠ Tipi sconosciuti: {importPreview.unrecognizedTypes.join(", ")} → mappati a "sport (Altro)"
                  </div>
                )}

                {/* Errori parsing */}
                {importPreview.parseErrors.length > 0 && (
                  <div
                    role="alert"
                    style={{
                      padding: "10px 12px",
                      background: "#EF444415", border: "1px solid #EF444444",
                      borderRadius: "8px", color: "#EF4444",
                      fontSize: "12px", lineHeight: 1.5,
                    }}
                  >
                    ❌ {importPreview.parseErrors.length} errori parsing → workout potenzialmente persi
                  </div>
                )}

                {/* Lista preview primi 10 */}
                {importPreview.newWorkouts.length > 0 && (
                  <div
                    role="list"
                    aria-label={`Anteprima primi ${Math.min(10, importPreview.newWorkouts.length)} workout da importare`}
                    style={{
                      padding: "10px 12px",
                      background: "#0F172A", borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.06)",
                      fontSize: "12px", lineHeight: 1.6,
                    }}
                  >
                    {importPreview.newWorkouts.slice(0, 10).map((s, i) => (
                      <div
                        key={i}
                        role="listitem"
                        style={{
                          display: "flex", flexWrap: "wrap", gap: "6px",
                          padding: "4px 0",
                          borderBottom: i < Math.min(9, importPreview.newWorkouts.length - 1)
                            ? "1px solid rgba(255,255,255,0.04)" : "none",
                          color: "#CBD5E1",
                        }}
                      >
                        <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
                          {formatSampleDate(s.startedAt)}
                        </span>
                        <span style={{ color: "#A5B4FC", fontWeight: 600 }}>{s.mappedType}</span>
                        <span style={{ color: "#94A3B8" }}>{s.duration_min}min</span>
                        {s.hrAvg !== undefined && (
                          <span style={{ color: "#F59E0B" }}>FC {s.hrAvg}</span>
                        )}
                      </div>
                    ))}
                    {importPreview.newWorkouts.length > 10 && (
                      <div style={{ color: "#64748B", marginTop: "6px", fontStyle: "italic" }}>
                        …e altri {importPreview.newWorkouts.length - 10}
                      </div>
                    )}
                  </div>
                )}

                {importPhase === "committing" && (
                  <div
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                    aria-label="Importazione in corso"
                    style={{
                      padding: "10px 12px", background: "#1E293B",
                      borderRadius: "8px", color: "#A5B4FC",
                      fontSize: "12px",
                    }}
                  >
                    🔄 Importo i workout…
                  </div>
                )}

                {/* Conferma / Annulla */}
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <button
                    onClick={onConfirmSamsungImport}
                    disabled={importBusy || importPreview.newWorkouts.length === 0}
                    style={{
                      flex: 1, minHeight: "44px", padding: "12px 16px",
                      background: (importBusy || importPreview.newWorkouts.length === 0)
                        ? "#1E293B"
                        : "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
                      border: "none", borderRadius: "10px",
                      color: "#FFF", fontWeight: 700, fontSize: "14px",
                      cursor: (importBusy || importPreview.newWorkouts.length === 0) ? "not-allowed" : "pointer",
                      opacity: (importBusy || importPreview.newWorkouts.length === 0) ? 0.5 : 1,
                    }}
                  >
                    {importPhase === "committing" ? "Importo…" : "Conferma import"}
                  </button>
                  <button
                    onClick={onCancelSamsungImport}
                    disabled={importBusy}
                    style={{
                      minHeight: "44px", padding: "12px 16px",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px",
                      color: "#CBD5E1", fontWeight: 600, fontSize: "14px",
                      cursor: importBusy ? "not-allowed" : "pointer",
                      opacity: importBusy ? 0.5 : 1,
                    }}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            {/* Toast post-conferma */}
            {importToast && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  marginTop: "10px", padding: "10px 12px",
                  background: importToast.type === "success" ? "#22C55E15" : "#EF444415",
                  border: `1px solid ${importToast.type === "success" ? "#22C55E44" : "#EF444444"}`,
                  borderRadius: "8px",
                  color: importToast.type === "success" ? "#22C55E" : "#EF4444",
                  fontSize: "13px", lineHeight: 1.5,
                }}
              >
                {importToast.text}
              </div>
            )}
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
          <b>Privacy</b>: questa app non ha backend. Tutti i dati restano nel tuo browser. Quando interagisci col coach, i dati necessari vengono inviati al provider LLM scelto (con la tua chiave). Nessuna telemetria, nessun tracking.
        </div>
      </div>
    </div>
  );
}
