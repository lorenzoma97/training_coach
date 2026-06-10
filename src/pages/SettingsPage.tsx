import { useEffect, useMemo, useRef, useState } from "react";
import { hasApiKey } from "../lib/gemini";
import {
  ADAPTERS, getLLMConfig, setLLMConfig, type LLMConfig, type LLMModel, type ProviderId,
  getOllamaBaseUrl, setOllamaBaseUrl, ollamaHealthCheck, invalidateOllamaHealthCache,
} from "../lib/llm";
import { storage, getJSON } from "../lib/storage";
import { CHUNKS, clearEmbeddings, ensureEmbeddings, getCacheStatus, type CacheStatus, type EmbeddingCache } from "../lib/knowledge";
import { getRagCache } from "../lib/ragStorage";
import { translateGeminiError } from "../lib/geminiErrors";
import { events } from "../lib/events";
import BackupSection from "../components/BackupSection";
import PlanDiagnosticPanel from "../components/PlanDiagnosticPanel";
import GoalsEditor from "../components/GoalsEditor";
import ProfileEditor from "../components/ProfileEditor";
import RaceCalendarSection from "../components/races/RaceCalendarSection";
import {
  previewImport as samsungPreviewImport,
  commitImport as samsungCommitImport,
  fileListToZipBlob as samsungFileListToZipBlob,
  type ImportPreview as SamsungImportPreview,
  type SampleDecision as SamsungSampleDecision,
  DEFAULT_IMPORT_WINDOW_DAYS as SAMSUNG_DEFAULT_WINDOW,
} from "../lib/integrations/samsungHealth";

// Flag UI: nasconde il selettore provider e mostra solo Gemini.
// L'infrastruttura multi-provider (ADAPTERS, ProviderId, openai/anthropic/ollama
// adapter) resta nel codebase per riabilitazione futura. Per riattivare:
// metti `MULTI_PROVIDER_UI = true` e rimuovi il banner "Provider: Gemini".
const MULTI_PROVIDER_UI = false;

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini (consigliato)",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  ollama: "Ollama (locale, zero cloud)",
};
const PROVIDER_HELP: Record<ProviderId, { url: string; label: string }> = {
  gemini: { url: "https://aistudio.google.com/apikey", label: "aistudio.google.com/apikey" },
  openai: { url: "https://platform.openai.com/api-keys", label: "platform.openai.com/api-keys" },
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "console.anthropic.com/settings/keys" },
  ollama: { url: "https://ollama.com/download", label: "ollama.com/download" },
};
const PROVIDER_PLACEHOLDER: Record<ProviderId, string> = {
  gemini: "AIza...",
  openai: "sk-...",
  anthropic: "sk-ant-...",
  ollama: "(non richiesta — locale)",
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

  // Ollama-specific: base URL configurabile (default http://localhost:11434).
  // Salvato in localStorage chiave dedicata via setOllamaBaseUrl (non LLMConfig).
  const [ollamaBaseUrl, setOllamaBaseUrlState] = useState<string>(getOllamaBaseUrl());

  const [resetting, setResetting] = useState(false);
  const [kbStatus, setKbStatus] = useState<CacheStatus>("missing");
  const [kbCreatedAt, setKbCreatedAt] = useState<string | null>(null);
  const [kbCount, setKbCount] = useState<number>(0);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbProgress, setKbProgress] = useState<{ done: number; total: number } | null>(null);
  const [kbError, setKbError] = useState<string | null>(null);
  const [kbFailures, setKbFailures] = useState<number>(0);
  const [kbLastFailureMsg, setKbLastFailureMsg] = useState<string | null>(null);

  // Samsung Health import (Wave 3.2 + 3.5 enrichment)
  const [importBusy, setImportBusy] = useState(false);
  const [importPhase, setImportPhase] = useState<"idle" | "parsing" | "committing">("idle");
  const [importPreview, setImportPreview] = useState<SamsungImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importToast, setImportToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // Wave 3.5: finestra temporale PRE-upload (default 14gg = 2 settimane)
  const [importWindowDays, setImportWindowDays] = useState<number>(SAMSUNG_DEFAULT_WINDOW);
  // Wave 3.5: decisioni utente per match ambigui (sampleDedupKey → decision)
  const [pendingDecisions, setPendingDecisions] = useState<Map<string, SamsungSampleDecision>>(new Map());
  // 2-step import (feedback Lorenzo): step 1 = seleziona file/cartella → state.
  // Step 2 = bottone "Avvia import" parte il previewImport vero.
  // Senza, l'utente clicca seleziona, niente succede (10s indicizzazione browser),
  // partono cose async senza feedback chiaro.
  const [selectedSource, setSelectedSource] = useState<
    | { kind: "file"; file: File }
    | { kind: "folder"; files: FileList; relevantCount: number }
    | null
  >(null);
  const samsungFileRef = useRef<HTMLInputElement>(null);
  // Fix 2 — ref separato per il picker cartella estratta (Android Samsung Health
  // esporta in /Documents/Samsung Health/<ts>/ come cartella non zippata).
  const samsungFolderRef = useRef<HTMLInputElement>(null);
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
    // Ollama non richiede apiKey: svuota il campo per chiarezza UI.
    if (p === "ollama") setApiKeyState("");
  };

  const discoverModels = async () => {
    // Ollama: bypass apiKey check (locale). Per gli altri: serve apiKey.
    if (provider !== "ollama" && !apiKey.trim()) return;
    setLoadingModels(true);
    setModelsError(null);
    try {
      // Per Ollama applichiamo prima l'eventuale baseUrl modificato (sync via storage).
      if (provider === "ollama") setOllamaBaseUrl(ollamaBaseUrl);
      const list = await adapter.listModels(apiKey.trim() || "local");
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
    // Ollama: apiKey opzionale. Per gli altri serve obbligatoria.
    const needsKey = provider !== "ollama";
    if ((needsKey && !apiKey.trim()) || !modelId.trim()) return;
    setSaving(true);
    setTestResult(null);
    setSaved(false);
    const effectiveKey = provider === "ollama" ? "local" : apiKey.trim();
    const config: LLMConfig = { provider, apiKey: effectiveKey, modelId: modelId.trim() };
    try {
      // Per Ollama, persist baseUrl prima del save+ping (ping legge da storage).
      if (provider === "ollama") {
        setOllamaBaseUrl(ollamaBaseUrl);
        invalidateOllamaHealthCache();
      }
      await setLLMConfig(config);
      setSaved(true);
      const r = await adapter.ping(config.apiKey, config.modelId);
      setTestResult(r.ok
        ? (provider === "ollama" ? "OK Ollama raggiungibile e modello installato" : "OK Chiave valida, connessione OK")
        : `Errore: ${r.error || "Errore"}`);
      await refreshKbStatus();
    } catch (e: any) {
      setTestResult(`Errore: ${e?.message || String(e)}`);
    } finally {
      setSaving(false);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
    }
  };

  // Test connessione Ollama dedicato (read-only, non salva config).
  const testOllamaConnection = async () => {
    setTestResult("Test in corso...");
    invalidateOllamaHealthCache();
    setOllamaBaseUrl(ollamaBaseUrl);
    const h = await ollamaHealthCheck(ollamaBaseUrl);
    if (h.ok) {
      const count = h.models?.length ?? 0;
      setTestResult(`OK Ollama raggiungibile. Modelli installati: ${count}`);
    } else {
      setTestResult(`Errore: ${h.error || "Ollama non raggiungibile"}`);
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
    alert(`Diario cancellato (${count} giorni rimossi).`);
  };

  // --- Samsung Health import handlers --------------------------------------
  const showImportToast = (toast: { type: "success" | "error"; text: string }) => {
    setImportToast(toast);
    if (importToastTimerRef.current) clearTimeout(importToastTimerRef.current);
    importToastTimerRef.current = setTimeout(() => setImportToast(null), 5000);
  };

  const resetImportState = () => {
    setImportPreview(null);
    setImportError(null);
    setImportPhase("idle");
    setPendingDecisions(new Map());
    if (samsungFileRef.current) samsungFileRef.current.value = "";
    if (samsungFolderRef.current) samsungFolderRef.current.value = "";
  };

  // Step 1: solo salva la selezione, NON parte ancora l'import.
  // L'utente vedra' un riepilogo + bottone "Avvia import" (step 2).
  const onSamsungFileSelected = (file: File | null) => {
    if (!file || importBusy) return;
    setImportError(null);
    setImportPreview(null);
    setPendingDecisions(new Map());
    setSelectedSource({ kind: "file", file });
  };

  // Fix 2 — Handler upload cartella estratta (Android). Samsung Health Android
  // esporta in /Documents/Samsung Health/<timestamp>/ come cartella, non zip.
  // Costruiamo uno ZIP in-memory e lo passiamo al pipeline esistente
  // `previewImport(blob)` senza modificare il parser.
  // NB iOS Safari ignora `webkitdirectory` → il picker mostra file singoli; in
  // quel caso l'utente vedrà la nota sotto il bottone con istruzioni alternative.
  // Step 1: solo salva la selezione cartella, NON parte l'import.
  // Conta i file rilevanti (matching pattern) per dare feedback immediato.
  const onSamsungFolderSelected = (files: FileList | null) => {
    if (!files || files.length === 0 || importBusy) return;
    setImportError(null);
    setImportPreview(null);
    setPendingDecisions(new Map());
    // Count rilevanti senza leggerli (pattern check su nome)
    const RELEVANT_PATTERNS = [
      /com\.samsung\.shealth\.exercise\.\d+\.csv$/i,
      /com\.samsung\.(?:shealth|health)\.hrv\.\d+\.csv$/i,
      /com\.samsung\.shealth\.sleep\.\d+\.csv$/i,
    ];
    let relevantCount = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      if (RELEVANT_PATTERNS.some(re => re.test(relPath))) relevantCount++;
    }
    setSelectedSource({ kind: "folder", files, relevantCount });
  };

  // Step 2: parte il previewImport vero, con overlay full-screen.
  const startImport = async () => {
    if (!selectedSource || importBusy) return;
    setImportBusy(true);
    setImportPhase("parsing");
    setImportError(null);
    try {
      let preview: SamsungImportPreview;
      if (selectedSource.kind === "file") {
        preview = await samsungPreviewImport(selectedSource.file, { windowDays: importWindowDays });
      } else {
        const blob = await samsungFileListToZipBlob(selectedSource.files);
        preview = await samsungPreviewImport(blob, { windowDays: importWindowDays });
      }
      setImportPreview(preview);
      const totalActionable = preview.newWorkouts.length + preview.autoEnrichments.length + preview.ambiguousMatches.length;
      showImportToast({
        type: "success",
        text: totalActionable > 0
          ? `Preview pronta: ${preview.newWorkouts.length} nuovi, ${preview.autoEnrichments.length} da arricchire, ${preview.ambiguousMatches.length} da confermare`
          : "Caricamento OK: nessun nuovo workout nella finestra selezionata",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportError(msg);
      showImportToast({ type: "error", text: `Lettura fallita: ${msg}` });
    } finally {
      setImportBusy(false);
      setImportPhase("idle");
      // Reset input + selectedSource per permettere nuovo upload pulito
      if (samsungFileRef.current) samsungFileRef.current.value = "";
      if (samsungFolderRef.current) samsungFolderRef.current.value = "";
      setSelectedSource(null);
    }
  };

  const onConfirmSamsungImport = async () => {
    if (!importPreview || importBusy) return;
    setImportBusy(true);
    setImportPhase("committing");
    setImportError(null);
    try {
      const result = await samsungCommitImport(importPreview, pendingDecisions);
      // Notifica diario per refresh elenco workout
      const firstAffected = importPreview.newWorkouts[0]
        ?? importPreview.autoEnrichments[0]?.sample
        ?? importPreview.ambiguousMatches[0]?.sample;
      if (firstAffected) {
        events.emit("workout:saved", {
          date: firstAffected.startedAt.slice(0, 10),
          workout: { source: "samsung_health", batch: true },
        });
      }
      const parts: string[] = [];
      if (result.workoutsCreated > 0) parts.push(`${result.workoutsCreated} nuovi`);
      if (result.workoutsEnriched > 0) parts.push(`${result.workoutsEnriched} arricchiti`);
      if (result.duplicatesSkipped > 0) parts.push(`${result.duplicatesSkipped} skip`);
      showImportToast({
        type: "success",
        text: `Import completato: ${parts.join(" - ") || "nessuna modifica"}`,
      });
      resetImportState();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportError(msg);
      showImportToast({ type: "error", text: `Import fallito: ${msg}` });
    } finally {
      setImportBusy(false);
      setImportPhase("idle");
    }
  };

  const onCancelSamsungImport = () => {
    if (importBusy) return;
    resetImportState();
  };

  // Aggiorna decisione utente per un sample ambiguo
  const setSampleDecision = (sampleKey: string, decision: SamsungSampleDecision) => {
    setPendingDecisions(prev => {
      const next = new Map(prev);
      next.set(sampleKey, decision);
      return next;
    });
  };

  // Etichetta human-readable dei field arricchiti
  const formatFieldsAdded = (fields: string[]): string => {
    if (fields.length === 0) return "(nessun campo nuovo)";
    const labels: Record<string, string> = {
      fc_media: "FC media",
      fc_max: "FC max",
      kcal: "kcal",
      distance_km: "distanza",
      passo_medio: "passo",
    };
    return fields.map(f => `+${labels[f] ?? f}`).join(" ");
  };

  const formatSampleDate = (iso: string): string => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const labelStyle: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: "#94A3B8", display: "block", marginBottom: "4px" };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", background: "#1A1A2E",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
    color: "#E2E8F0", fontSize: "14px", outline: "none", boxSizing: "border-box",
    fontFamily: "'JetBrains Mono', monospace",
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: "inherit",
  };
  const cardStyle: React.CSSProperties = {
    background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "14px", padding: "16px 18px",
  };
  // Stile uniforme accordion top-level (sezioni intere collapsibili).
  const sectionDetailsStyle: React.CSSProperties = {
    ...cardStyle,
    padding: 0,
    overflow: "hidden",
  };
  const sectionSummaryStyle: React.CSSProperties = {
    cursor: "pointer",
    padding: "14px 18px",
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#E2E8F0",
    userSelect: "none",
    listStyle: "revert",
  };
  const sectionBodyStyle: React.CSSProperties = {
    padding: "4px 18px 18px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };

  const help = PROVIDER_HELP[provider];

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Overlay full-screen visibile durante import Samsung Health.
          Senza, l'utente in scroll non vede il bottone "In corso..." dentro
          la sezione collapsable e pensa che l'app sia bloccata. */}
      {importBusy && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Importazione Samsung Health in corso"
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: "16px",
          }}
        >
          <div style={{
            width: "56px", height: "56px",
            border: "5px solid rgba(165, 180, 252, 0.25)",
            borderTopColor: "#A5B4FC",
            borderRadius: "50%",
            animation: "spin 0.9s linear infinite",
          }} />
          <div style={{ color: "#E2E8F0", fontWeight: 700, fontSize: "16px", textAlign: "center" }}>
            {importPhase === "committing" ? "Conferma import in corso..." : "Lettura dati Samsung Health..."}
          </div>
          <div style={{ color: "#94A3B8", fontSize: "13px", textAlign: "center", maxWidth: "320px", padding: "0 16px" }}>
            {importPhase === "parsing"
              ? "Sto leggendo i file dell'export. Può richiedere qualche secondo per cartelle grandi."
              : "Sto salvando i workout nel diario."}
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <div>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#14B8A6", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Impostazioni</div>
        <h1 style={{ fontSize: "24px", fontWeight: 900, margin: "4px 0 0", letterSpacing: "-0.03em" }}>Configurazione</h1>
      </div>

      {/* ─── Provider LLM ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>Provider LLM</div>

        {MULTI_PROVIDER_UI ? (
          <>
            <label style={labelStyle}>Provider</label>
            <select style={selectStyle} value={provider} onChange={e => onProviderChange(e.target.value as ProviderId)}>
              {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </>
        ) : (
          <div style={{
            padding: "10px 12px",
            background: "#1A1A2E",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            fontSize: "12px", color: "#94A3B8",
          }}>
            Provider: <b style={{ color: "#E2E8F0" }}>Google Gemini</b>
          </div>
        )}

        {provider === "ollama" && (
          <div style={{
            marginTop: "10px", padding: "10px 12px",
            background: "#1A1A2E", border: "1px solid #F59E0B44",
            borderRadius: "10px",
            fontSize: "11px", color: "#FCD34D", lineHeight: 1.5,
          }}>
            <b style={{ color: "#F59E0B" }}>Modalità Ollama (locale)</b> — RAG paper disabilitato (no embeddings). Solo desktop con demone su {ollamaBaseUrl}. Fallback automatico a Gemini su mobile / offline.
          </div>
        )}

        {provider === "ollama" ? (
          <div style={{ marginTop: "10px" }}>
            <label style={labelStyle}>URL Ollama</label>
            <input
              type="text" style={inputStyle}
              value={ollamaBaseUrl}
              onChange={e => { setOllamaBaseUrlState(e.target.value); setTestResult(null); }}
              placeholder="http://localhost:11434"
              autoComplete="off"
              spellCheck={false}
            />
            <div style={{ fontSize: "11px", color: "#64748B", marginTop: "6px", lineHeight: 1.4 }}>
              Installa da <a href={help.url} target="_blank" rel="noreferrer" style={{ color: "#14B8A6" }}>{help.label}</a>, avvia <code>ollama serve</code>, scarica un modello: <code>ollama pull qwen2.5:7b-instruct</code>.
            </div>
            <button
              onClick={testOllamaConnection}
              style={{
                marginTop: "6px", minHeight: "36px",
                padding: "8px 12px", background: "#1A1A2E",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
                color: "#E2E8F0", fontSize: "12px", fontWeight: 600, cursor: "pointer",
              }}
            >
              Testa connessione
            </button>
          </div>
        ) : (
          <div style={{ marginTop: "10px" }}>
            <label style={labelStyle}>Chiave API</label>
            <input
              type="password" style={inputStyle}
              value={apiKey}
              onChange={e => { setApiKeyState(e.target.value); setTestResult(null); }}
              placeholder={PROVIDER_PLACEHOLDER[provider]}
              autoComplete="off"
            />
            <div style={{ fontSize: "11px", color: "#64748B", marginTop: "6px", lineHeight: 1.4 }}>
              Chiave su <a href={help.url} target="_blank" rel="noreferrer" style={{ color: "#14B8A6" }}>{help.label}</a>. Resta sul dispositivo (localStorage).
              {!providerSupportsEmbeddings && (
                <span style={{ color: "#F59E0B" }}>{" "}Nota: provider senza embeddings nativi → RAG disabilitato.</span>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: "10px" }}>
          <label style={labelStyle}>Modello</label>
          <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
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
              disabled={loadingModels || (provider !== "ollama" && !apiKey.trim())}
              style={{
                padding: "10px 12px", minHeight: "44px",
                background: "#1A1A2E",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px",
                color: "#E2E8F0", fontWeight: 600, fontSize: "12px", cursor: "pointer",
                whiteSpace: "nowrap",
                opacity: (loadingModels || (provider !== "ollama" && !apiKey.trim())) ? 0.5 : 1,
              }}
            >
              {loadingModels ? "..." : "Scopri"}
            </button>
          </div>
          {modelsError && (
            <div style={{ color: "#EF4444", fontSize: "11px", marginTop: "6px" }}>{modelsError}</div>
          )}
          {models.length > 0 && (
            <div style={{ fontSize: "11px", color: "#64748B", marginTop: "4px" }}>
              {models.length} modelli compatibili.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "12px", alignItems: "center" }}>
          <button
            onClick={saveAndTest}
            disabled={saving || (provider !== "ollama" && !apiKey.trim()) || !modelId.trim()}
            style={{
              padding: "10px 16px", minHeight: "44px",
              background: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
              border: "none", borderRadius: "10px", color: "#FFF",
              fontWeight: 700, fontSize: "13px", cursor: "pointer",
              opacity: (saving || (provider !== "ollama" && !apiKey.trim()) || !modelId.trim()) ? 0.5 : 1,
            }}
          >
            {saving ? "Testo..." : saved ? "Salvata" : "Salva e testa"}
          </button>
          {testResult && (
            <div style={{
              fontSize: "12px", flex: 1,
              color: testResult.startsWith("OK") ? "#22C55E" : "#EF4444",
            }}>{testResult}</div>
          )}
        </div>
      </div>

      {/* ─── Profilo atleta ───────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#14B8A6", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: "10px" }}>
          Profilo atleta
        </div>
        <div style={{ fontSize: "12px", color: "#64748B", marginBottom: "12px", lineHeight: 1.4 }}>
          Aggiorna stato di salute corrente. Età/peso/altezza si modificano dal Reset coach.
        </div>
        <ProfileEditor />
      </div>

      {/* ─── Obiettivi ────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#14B8A6", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: "10px" }}>
          Obiettivi
        </div>
        <GoalsEditor variant="compact" />
      </div>

      {/* ─── Calendario gare (componente separato) ───────────────────── */}
      <RaceCalendarSection />

      {/* Sprint D: il Macroprogramma è un'azione operativa, non una
          impostazione → spostato nel Coach (tab Piano). Non più qui. */}

      {/* ─── Knowledge base RAG (collapsible) ─────────────────────────── */}
      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle} aria-label="Knowledge base scientifica">
          <span style={{ flex: 1 }}>Knowledge base scientifica</span>
          <span style={{
            padding: "3px 9px", borderRadius: "999px",
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em",
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
            {kbStatus === "no-key" && "Chiave richiesta"}
            {kbStatus === "unsupported" && "Non supportato"}
          </span>
        </summary>
        <div style={sectionBodyStyle}>
          <div style={{ color: "#94A3B8", fontSize: "12px", lineHeight: 1.5 }}>
            Indice embeddings su fondamenti scientifici (24 aree) usato dal coach per citare evidenze pertinenti.
          </div>

          {(kbStatus === "ready" || kbStatus === "stale") && kbCount > 0 && (
            <div style={{ color: "#94A3B8", fontSize: "12px" }}>
              {kbCount}/{CHUNKS.length} chunks
              {kbCreatedAt && (() => { const d = new Date(kbCreatedAt); return ` - ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; })()}
            </div>
          )}

          {kbFailures > 0 && !kbBusy && (
            <div style={{ color: "#F59E0B", fontSize: "12px", padding: "8px 10px", background: "#F59E0B15", borderRadius: "8px" }}>
              Ultima generazione: {kbFailures} chunk falliti su {CHUNKS.length}.
              {kbLastFailureMsg && <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic", color: "#FCD34D" }}>Causa: {kbLastFailureMsg.slice(0, 160)}</div>}
            </div>
          )}

          {kbBusy && kbProgress && (
            <div>
              <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "4px" }}>
                Generazione embeddings... {kbProgress.done}/{kbProgress.total}
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
            <div style={{ color: "#EF4444", fontSize: "12px" }}>
              {kbError}
            </div>
          )}

          <button
            onClick={regenerateKnowledgeBase}
            disabled={kbBusy || !hasApiKey() || !providerSupportsEmbeddings}
            style={{
              alignSelf: "flex-start",
              padding: "10px 14px", minHeight: "44px",
              background: (kbBusy || !hasApiKey() || !providerSupportsEmbeddings) ? "#1E293B" : "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
              border: "none", borderRadius: "10px",
              color: "#FFF", fontWeight: 700, fontSize: "13px",
              cursor: (kbBusy || !hasApiKey() || !providerSupportsEmbeddings) ? "not-allowed" : "pointer",
              opacity: (kbBusy || !hasApiKey() || !providerSupportsEmbeddings) ? 0.5 : 1,
            }}
          >
            {kbBusy ? "Rigenerazione..." : "Rigenera knowledge base"}
          </button>
        </div>
      </details>

      {/* ─── Diagnostica piano (collapsible) ─────────────────────────── */}
      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle} aria-label="Diagnostica ultima rigenerazione piano">
          <span style={{ flex: 1 }}>Diagnostica ultima rigenerazione</span>
        </summary>
        <div style={{ padding: "12px 16px 16px" }}>
          <PlanDiagnosticPanel />
        </div>
      </details>

      {/* ─── Backup / restore (componente separato) ──────────────────── */}
      <BackupSection />

      {/* ─── Samsung Health import (collapsible) ──────────────────────── */}
      <details style={sectionDetailsStyle}>
        <summary style={sectionSummaryStyle} aria-label="Importa dati Samsung Health">
          <span style={{ flex: 1 }}>Importa Samsung Health</span>
          <span style={{ fontSize: "11px", color: "#A5B4FC", fontWeight: 700 }}>wearable</span>
        </summary>
        <div style={sectionBodyStyle}>
          <div id="samsung-import-help" style={{ color: "#94A3B8", fontSize: "12px", lineHeight: 1.5 }}>
            Importa workout, FC e dati dal Galaxy Watch / Samsung Health. Dati restano sul dispositivo.{" "}
            <a
              href="docs/guida-import-samsung-health.md"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#A5B4FC", textDecoration: "underline" }}
            >
              Come esportare
            </a>.
          </div>

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
          <input
            ref={samsungFolderRef}
            type="file"
            multiple
            // Attributi non standard: spread cast as any per evitare
            // sia errori TS quando i types React non li conoscono, sia
            // "unused @ts-expect-error" se i types vengono aggiornati.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            aria-describedby="samsung-folder-help"
            aria-label="Carica cartella estratta Samsung Health (Android)"
            onChange={(e) => onSamsungFolderSelected(e.target.files)}
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
            <>
              {/* Wave 3.5: selettore finestra PRE-upload — dropdown invece di 2 radio verbose */}
              <div>
                <label style={labelStyle} htmlFor="samsung-window">Finestra import</label>
                <select
                  id="samsung-window"
                  value={importWindowDays >= 365 ? "all" : "recent"}
                  onChange={(e) => setImportWindowDays(e.target.value === "all" ? 3650 : SAMSUNG_DEFAULT_WINDOW)}
                  disabled={importBusy}
                  style={selectStyle}
                >
                  <option value="recent">Ultime 2 settimane (raccomandato)</option>
                  <option value="all">Tutto lo storico</option>
                </select>
              </div>

              {/* I 2 bottoni in row compatta su desktop, stack su mobile via flex-wrap. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button
                  onClick={() => samsungFileRef.current?.click()}
                  disabled={importBusy}
                  aria-busy={importBusy}
                  style={{
                    flex: "1 1 200px",
                    minHeight: "44px", padding: "12px 14px",
                    background: importBusy
                      ? "#1E293B"
                      : "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
                    border: "none", borderRadius: "10px",
                    color: "#FFF", fontWeight: 700, fontSize: "13px",
                    cursor: importBusy ? "wait" : "pointer",
                    opacity: importBusy ? 0.7 : 1,
                  }}
                >
                  {importBusy ? "In corso..." : "Carica file ZIP"}
                </button>
                <button
                  onClick={() => samsungFolderRef.current?.click()}
                  disabled={importBusy}
                  aria-busy={importBusy}
                  style={{
                    flex: "1 1 200px",
                    minHeight: "44px", padding: "12px 14px",
                    background: "transparent",
                    border: "1px solid rgba(99, 102, 241, 0.5)",
                    borderRadius: "10px",
                    color: "#A5B4FC", fontWeight: 700, fontSize: "13px",
                    cursor: importBusy ? "wait" : "pointer",
                    opacity: importBusy ? 0.7 : 1,
                  }}
                >
                  {importBusy ? "In corso..." : "Cartella Android"}
                </button>
              </div>
              <div
                id="samsung-folder-help"
                style={{
                  fontSize: "11px", color: "#64748B", lineHeight: 1.5,
                }}
              >
                <b>Cartella Android</b>: Chrome chiederà conferma "carica tutti i file" — è normale,
                conferma. L'app filtra automaticamente i 3 file rilevanti (exercise + HRV + sleep)
                ignorando le migliaia di file satellite. La finestra "ultime 2 settimane" filtra i
                workout per data DOPO la lettura (Samsung mette tutti gli allenamenti in un unico
                CSV). Su iOS comprimi prima in zip e usa il primo bottone.
              </div>

              {/* Step 2: riepilogo selezione + bottone "Avvia import".
                  Si attiva solo se l'utente ha selezionato qualcosa (selectedSource).
                  Flow 2-step richiesto da Lorenzo: prima vedi cosa hai caricato,
                  poi confermi per partire con l'import vero (overlay loading). */}
              {selectedSource && (
                <div style={{
                  marginTop: "10px",
                  background: "#22C55E15",
                  border: "1px solid #22C55E66",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  display: "flex", flexDirection: "column", gap: "10px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: "13px", color: "#22C55E" }}>
                      Selezione pronta
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.4 }}>
                    {selectedSource.kind === "file"
                      ? <>File: <b>{selectedSource.file.name}</b> ({Math.round(selectedSource.file.size / 1024)} KB)</>
                      : <>Cartella: <b>{selectedSource.relevantCount}</b> file rilevanti su {selectedSource.files.length} totali (gli altri verranno scartati automaticamente)</>}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      onClick={startImport}
                      disabled={importBusy}
                      style={{
                        flex: "1 1 200px",
                        minHeight: "44px", padding: "12px 14px",
                        background: "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
                        border: "none", borderRadius: "10px",
                        color: "#FFF", fontWeight: 800, fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      Avvia import
                    </button>
                    <button
                      onClick={() => setSelectedSource(null)}
                      disabled={importBusy}
                      style={{
                        minHeight: "44px", padding: "12px 16px",
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px",
                        color: "#CBD5E1", fontWeight: 600, fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {importPhase === "parsing" && (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              aria-label="Analisi file in corso"
              style={{
                padding: "10px 12px",
                background: "#1E293B", borderRadius: "8px",
                color: "#A5B4FC", fontSize: "12px", lineHeight: 1.5,
              }}
            >
              Analizzo il file... (può impiegare 30s-2min)
            </div>
          )}

          {importError && !importBusy && (
            <div
              role="alert"
              style={{
                padding: "10px 12px",
                background: "#EF444415", border: "1px solid #EF444444",
                borderRadius: "8px", color: "#EF4444", fontSize: "12px", lineHeight: 1.5,
              }}
            >
              Errore: {importError}
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
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* Stats card riassunto + finestra applicata */}
              <div style={{
                padding: "12px", background: "#0F172A",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px",
                fontSize: "13px", lineHeight: 1.7, color: "#E2E8F0",
              }}>
                <div style={{ color: "#94A3B8", fontSize: "11px", marginBottom: "4px" }}>
                  Finestra: ultime {importPreview.windowDays} giorni - totale {importPreview.totalSamples} sample
                </div>
                <div style={{ color: "#22C55E" }}>
                  Nuovi allenamenti: <b>{importPreview.newWorkouts.length}</b>
                </div>
                <div style={{ color: "#A5B4FC" }}>
                  Arricchimenti automatici: <b>{importPreview.autoEnrichments.length}</b>
                </div>
                <div style={{ color: "#F59E0B" }}>
                  Da confermare: <b>{importPreview.ambiguousMatches.length}</b>
                </div>
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
                  Tipi sconosciuti: {importPreview.unrecognizedTypes.join(", ")} - mappati a "sport (Altro)"
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
                  {importPreview.parseErrors.length} errori parsing - workout potenzialmente persi
                </div>
              )}

              {/* SEZIONE 1: Nuovi allenamenti (max 10 in preview) */}
              {importPreview.newWorkouts.length > 0 && (
                <div style={{
                  padding: "10px 12px",
                  background: "#0F172A", borderRadius: "8px",
                  border: "1px solid rgba(34,197,94,0.18)",
                  fontSize: "12px", lineHeight: 1.6,
                }}>
                  <div style={{ color: "#22C55E", fontWeight: 700, fontSize: "12px", marginBottom: "8px" }}>
                    Nuovi allenamenti ({importPreview.newWorkouts.length})
                  </div>
                  {importPreview.newWorkouts.slice(0, 10).map((s, i) => (
                    <div
                      key={`new-${i}`}
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
                      ...e altri {importPreview.newWorkouts.length - 10}
                    </div>
                  )}
                </div>
              )}

              {/* SEZIONE 2: Arricchimenti automatici (match certo, score >= 80) */}
              {importPreview.autoEnrichments.length > 0 && (
                <div style={{
                  padding: "10px 12px",
                  background: "#0F172A", borderRadius: "8px",
                  border: "1px solid rgba(165,180,252,0.25)",
                  fontSize: "12px", lineHeight: 1.6,
                }}>
                  <div style={{ color: "#A5B4FC", fontWeight: 700, fontSize: "12px", marginBottom: "8px" }}>
                    Arricchimenti automatici ({importPreview.autoEnrichments.length})
                  </div>
                  {importPreview.autoEnrichments.slice(0, 10).map((e, i) => (
                    <div
                      key={`enrich-${i}`}
                      style={{
                        display: "flex", flexWrap: "wrap", gap: "6px",
                        padding: "4px 0",
                        borderBottom: i < Math.min(9, importPreview.autoEnrichments.length - 1)
                          ? "1px solid rgba(255,255,255,0.04)" : "none",
                        color: "#CBD5E1",
                      }}
                    >
                      <span style={{ color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatSampleDate(e.sample.startedAt)}
                      </span>
                      <span style={{ color: "#A5B4FC", fontWeight: 600 }}>
                        {e.sample.mappedType} {e.sample.duration_min}min
                      </span>
                      <span style={{ color: "#22C55E" }}>{formatFieldsAdded(e.fieldsAdded)}</span>
                      <span style={{ color: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}>
                        score {e.score}
                      </span>
                    </div>
                  ))}
                  {importPreview.autoEnrichments.length > 10 && (
                    <div style={{ color: "#64748B", marginTop: "6px", fontStyle: "italic" }}>
                      ...e altri {importPreview.autoEnrichments.length - 10}
                    </div>
                  )}
                </div>
              )}

              {/* SEZIONE 3: Da confermare (ambigui o no-match con candidati) */}
              {importPreview.ambiguousMatches.length > 0 && (
                <div style={{
                  padding: "10px 12px",
                  background: "#0F172A", borderRadius: "8px",
                  border: "1px solid rgba(245,158,11,0.25)",
                  fontSize: "12px", lineHeight: 1.6,
                }}>
                  <div style={{ color: "#F59E0B", fontWeight: 700, fontSize: "12px", marginBottom: "8px" }}>
                    Da confermare ({importPreview.ambiguousMatches.length})
                  </div>
                  <div style={{ color: "#94A3B8", fontSize: "11px", marginBottom: "10px", lineHeight: 1.4 }}>
                    Sample senza match certo. Scegli per ognuno: associa, crea nuovo, o salta.
                  </div>
                  {importPreview.ambiguousMatches.map((amb, i) => {
                    const sampleKey = amb.sample.dedupKey;
                    const decision = pendingDecisions.get(sampleKey);
                    return (
                      <fieldset
                        key={`amb-${i}`}
                        style={{
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: "8px",
                          padding: "8px 10px",
                          marginBottom: "8px",
                          background: "rgba(15,23,42,0.6)",
                        }}
                      >
                        <legend style={{
                          fontSize: "11px", padding: "0 4px",
                          color: "#CBD5E1", fontWeight: 600,
                        }}>
                          {formatSampleDate(amb.sample.startedAt)} {" "}
                          <span style={{ color: "#A5B4FC" }}>
                            Samsung {amb.sample.mappedType} {amb.sample.duration_min}min
                          </span>
                        </legend>
                        {amb.candidates.map((c) => (
                          <label
                            key={c.workoutId}
                            style={{
                              display: "flex", alignItems: "center", gap: "8px",
                              padding: "4px 0", color: "#CBD5E1", fontSize: "12px",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="radio"
                              name={`amb-${sampleKey}`}
                              checked={decision?.kind === "enrich" && decision.workoutId === c.workoutId}
                              onChange={() => setSampleDecision(sampleKey, { kind: "enrich", workoutId: c.workoutId })}
                            />
                            <span>
                              Associa a "{c.preview}"
                              <span style={{ color: "#64748B", marginLeft: "6px", fontFamily: "'JetBrains Mono', monospace" }}>
                                (score {c.score})
                              </span>
                            </span>
                          </label>
                        ))}
                        <label style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "4px 0", color: "#22C55E", fontSize: "12px",
                          cursor: "pointer",
                        }}>
                          <input
                            type="radio"
                            name={`amb-${sampleKey}`}
                            checked={decision?.kind === "new"}
                            onChange={() => setSampleDecision(sampleKey, { kind: "new" })}
                          />
                          <span>Crea nuovo</span>
                        </label>
                        <label style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "4px 0", color: "#94A3B8", fontSize: "12px",
                          cursor: "pointer",
                        }}>
                          <input
                            type="radio"
                            name={`amb-${sampleKey}`}
                            checked={!decision || decision.kind === "skip"}
                            onChange={() => setSampleDecision(sampleKey, { kind: "skip" })}
                          />
                          <span>Skip (non importare)</span>
                        </label>
                      </fieldset>
                    );
                  })}
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
                  Importo i workout...
                </div>
              )}

              {/* Conferma / Annulla */}
              {(() => {
                // Conferma abilitabile se almeno 1 azione disponibile
                const hasActionable =
                  importPreview.newWorkouts.length > 0 ||
                  importPreview.autoEnrichments.length > 0 ||
                  Array.from(pendingDecisions.values()).some(d => d.kind !== "skip");
                return (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={onConfirmSamsungImport}
                      disabled={importBusy || !hasActionable}
                      style={{
                        flex: 1, minHeight: "44px", padding: "12px 16px",
                        background: (importBusy || !hasActionable)
                          ? "#1E293B"
                          : "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
                        border: "none", borderRadius: "10px",
                        color: "#FFF", fontWeight: 700, fontSize: "14px",
                        cursor: (importBusy || !hasActionable) ? "not-allowed" : "pointer",
                        opacity: (importBusy || !hasActionable) ? 0.5 : 1,
                      }}
                    >
                      {importPhase === "committing" ? "Importo..." : "Conferma import"}
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
                );
              })()}
            </div>
          )}

          {/* Toast post-conferma */}
          {importToast && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                padding: "10px 12px",
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
      </details>

      {/* ─── Zona pericolosa: reset coach + cancella diario ──────────── */}
      <details style={{ ...sectionDetailsStyle, border: "1px solid #EF444422" }}>
        <summary
          style={{ ...sectionSummaryStyle, color: "#EF4444" }}
          aria-label="Zona pericolosa: reset coach e cancella diario"
        >
          <span style={{ flex: 1 }}>Zona pericolosa</span>
          <span style={{ fontSize: "10px", color: "#EF4444", fontWeight: 700, letterSpacing: "0.04em" }}>
            IRREVERSIBILE
          </span>
        </summary>
        <div style={sectionBodyStyle}>
          <button onClick={resetAll} disabled={resetting} style={{
            padding: "12px", minHeight: "44px",
            background: "#1A1A2E",
            border: "1px solid #F59E0B44", borderRadius: "10px",
            cursor: resetting ? "wait" : "pointer", textAlign: "left",
          }}>
            <div style={{ color: "#F59E0B", fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>
              Reset coach (mantieni diario)
            </div>
            <div style={{ color: "#94A3B8", fontSize: "11px", lineHeight: 1.4 }}>
              Cancella profilo, obiettivi, piano, chat, feed. <b>Diario resta.</b>
            </div>
          </button>
          <button onClick={wipeDiary} style={{
            padding: "12px", minHeight: "44px",
            background: "#1A1A2E",
            border: "1px solid #EF444444", borderRadius: "10px",
            cursor: "pointer", textAlign: "left",
          }}>
            <div style={{ color: "#EF4444", fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>
              Cancella tutto il diario
            </div>
            <div style={{ color: "#94A3B8", fontSize: "11px", lineHeight: 1.4 }}>
              Elimina TUTTE le sessioni e i check. <b>Coach e profilo restano.</b>
            </div>
          </button>
        </div>
      </details>

      <div style={{ ...cardStyle, background: "#1A1A2E" }}>
        <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.5 }}>
          <b>Privacy</b>: nessun backend. Dati nel browser. Le interazioni col coach inviano dati al provider LLM (con tua chiave). Nessuna telemetria.
        </div>
      </div>
    </div>
  );
}
