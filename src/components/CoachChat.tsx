import { useEffect, useRef, useState } from "react";
import { streamChat, hasApiKey } from "../lib/gemini";
import { PROMPTS } from "../lib/coach/systemPrompts";
import { buildCoachContext, profileAsPrompt, goalsAsPrompt, planAsPrompt } from "../lib/diaryContext";
import { getJSON, setJSON } from "../lib/storage";
import { translateGeminiError } from "../lib/geminiErrors";
import { retrieveRelevantChunks, chunksAsPromptBlock } from "../lib/knowledge";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "../lib/coach/promptBuilder";
import { computeZonesContext } from "../lib/coach/zones";
import { events } from "../lib/events";
import RichText from "./RichText";

type Msg = { id: string; role: "user" | "model"; content: string };
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const HISTORY_KEY = "coach-chat-history";

const QUICK_PROMPTS = [
  "Come sta andando la settimana?",
  "Devo riposare domani?",
  "Analizza la corsa di oggi",
  "Come sta il polpaccio?",
  "Proponimi la sessione di domani",
];

export default function CoachChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [waitingFirstToken, setWaitingFirstToken] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const waitingRef = useRef(false); // closure-safe per evitare stale read nel loop streaming
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persiste lo snapshot corrente dei messaggi (anche parziale su abort/unmount).
  const persistRef = useRef<() => void>(() => {});
  // Cache 1-slot per computeZonesContext: evita ricalcolo ad ogni send()
  // quando profilo e count giorni non sono cambiati. Invalidato implicitamente
  // dalla variazione della chiave (profileAge + recentDaysRaw.length).
  const zonesCtxCacheRef = useRef<{ key: string; result: ReturnType<typeof computeZonesContext> } | null>(null);
  const loadHistory = async () => {
    const raw = await getJSON<unknown>(HISTORY_KEY, []);
    // Schema validation: filtriamo solo record con shape Msg valida.
    // Storage può essere manomesso (altra tab, extension, debug console).
    // Un payload malformato non deve crashare il render.
    if (!Array.isArray(raw)) {
      console.warn("[CoachChat] history non è array — reset.");
      setMessages([]);
      return;
    }
    const validated: Msg[] = raw
      .filter((m): m is Partial<Msg> => m !== null && typeof m === "object")
      .filter(m => (m.role === "user" || m.role === "model") && typeof m.content === "string")
      .map(m => ({
        id: typeof m.id === "string" && m.id ? m.id : genId(),
        role: m.role as "user" | "model",
        content: m.content as string,
      }));
    setMessages(validated);
  };

  useEffect(() => {
    void loadHistory();
    // Cross-tab + cross-component sync: ricarica quando un'altra tab/mano modifica la history.
    const offExt = events.on("data:externalChange", e => { if (e.key === HISTORY_KEY) void loadHistory(); });
    const offChat = events.on("chat:historyChanged", () => { void loadHistory(); });
    // Notifica fallback LLM (es. Gemini 3.1-preview 503 → 2.5-flash-lite)
    const offFb = events.on("llm:fallbackActivated", p => {
      setFallbackNotice(`Modello primario ${p.primary} momentaneamente occupato — sto usando ${p.fallback}.`);
    });
    // Persist su chiusura pagina: garantisce che eventuali token parziali non vadano persi.
    const onBeforeUnload = () => { try { persistRef.current(); } catch { /* ignore */ } };
    window.addEventListener("beforeunload", onBeforeUnload);
    // Connettività: auto-clear dell'error "Offline" quando si torna online;
    // set dell'error se si va offline durante una sessione (non interrompe
    // stream in corso, solo blocca i prossimi send).
    const onOnline = () => {
      setError(prev => (prev === "Offline. Riconnettiti per parlare con il coach." ? "" : prev));
    };
    const onOffline = () => {
      if (!abortRef.current) setError("Offline. Riconnettiti per parlare con il coach.");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      offExt();
      offChat();
      offFb();
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      // Se lo stream è in corso quando il componente viene smontato, fermalo e persist
      abortRef.current?.abort();
      try { persistRef.current(); } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // Auto-resize textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    if (!hasApiKey()) { setError("Chiave Gemini non configurata. Vai in Impostazioni."); return; }
    // Guard offline: evita tentativi di streamChat se navigator.onLine=false.
    // Il listener `online` in useEffect auto-pulisce l'errore al ritorno online.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("Offline. Riconnettiti per parlare con il coach.");
      return;
    }
    // Hard limit sul singolo messaggio: 20 KB. Previene paste accidentali
    // e soprattutto l'esaurimento quota iOS Safari private mode (~2.5MB totali).
    // Con 50 messaggi × 20KB max = 1MB chat history, margine safe.
    const MAX_MESSAGE_CHARS = 20_000;
    if (text.length > MAX_MESSAGE_CHARS) {
      setError(`Messaggio troppo lungo (${Math.round(text.length / 1000)}KB). Massimo ${MAX_MESSAGE_CHARS / 1000}KB — accorcia e riprova.`);
      return;
    }
    setError("");
    setFallbackNotice(null);

    const userMsg: Msg = { id: genId(), role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setWaitingFirstToken(true);
    waitingRef.current = true;

    // Abort controller per questo stream (permette Stop + persist parziale)
    const abort = new AbortController();
    abortRef.current = abort;

    const modelMsgId = genId();
    let acc = "";
    // Setter snapshot-based per persist (anche su abort/unmount).
    // Errori storage: ignoriamo silenziosamente (la chat è best-effort, non critical).
    // Quota/size errors: storage.ts già logga warning + tenta pruning automatico.
    persistRef.current = () => {
      if (!acc && !newMessages.length) return;
      const snapshot: Msg[] = acc
        ? [...newMessages, { id: modelMsgId, role: "model" as const, content: acc }]
        : newMessages;
      void setJSON(HISTORY_KEY, snapshot.slice(-50)).catch(err => {
        console.warn("[CoachChat] persist failed (chat storage non critico):", err?.name || err?.message);
      });
    };

    try {
      const ctx = await buildCoachContext({ daysBack: 14 });

      // RAG: recupera evidenza scientifica pertinente alla domanda (non blocca se fallisce/offline)
      const ragResults = await retrieveRelevantChunks({ query: text, topK: 3, minScore: 0.55 });
      const ragBlock = chunksAsPromptBlock(ragResults);

      // Injection condizionale: moduli basati sul profilo/contesto utente.
      // Cache 1-slot: ricalcola solo se profilo (età) o numero giorni variano
      // rispetto all'ultimo send. Evita ricomputo costoso su ogni messaggio.
      const recentDaysRaw = ctx.recentDaysRaw || [];
      const zonesCacheKey = `${ctx.profile?.age ?? "-"}:${recentDaysRaw.length}`;
      let zonesCtxChat: ReturnType<typeof computeZonesContext>;
      if (zonesCtxCacheRef.current && zonesCtxCacheRef.current.key === zonesCacheKey) {
        zonesCtxChat = zonesCtxCacheRef.current.result;
      } else {
        zonesCtxChat = computeZonesContext(ctx.profile, recentDaysRaw);
        zonesCtxCacheRef.current = { key: zonesCacheKey, result: zonesCtxChat };
      }
      const bCtx: BuildContext = {
        profile: ctx.profile,
        hasRunningGoal: ctx.goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription || "")),
        hasStrengthInPlan: !!ctx.plan?.weeks.some(w => w.sessions.some(s => s.type.startsWith("forza"))),
        detectedConditions: extractConditionsFromProfile(ctx.profile),
        zones: zonesCtxChat?.zones ?? undefined,
        zonesTimeInZone: zonesCtxChat?.timeInZone,
        zonesPolar: zonesCtxChat?.polar,
        zonesTotalSessions: zonesCtxChat?.totalSessions,
      };
      const conditionalBlock = buildConditionalPrompt(bCtx);

      const systemInstruction = [
        PROMPTS.chat({ age: ctx.profile?.age }),
        conditionalBlock,
        ragBlock,
      ].filter(Boolean).join("\n\n");

      const contextBlock = `
[CONTESTO — non rispondere a questo blocco, usa come informazione]
PROFILO: ${profileAsPrompt(ctx.profile)}
OBIETTIVI: ${goalsAsPrompt(ctx.goals)}
PIANO ATTIVO: ${planAsPrompt(ctx.plan)}
ULTIMI GIORNI:
${ctx.recentDaysText}
[FINE CONTESTO]

DOMANDA UTENTE: ${text}
`.trim();

      setMessages(m => [...m, { id: modelMsgId, role: "model", content: "" }]);
      const history = newMessages.slice(0, -1).map(m => ({ role: m.role, parts: m.content }));
      for await (const chunk of streamChat({
        systemInstruction,
        history,
        userMessage: contextBlock,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        acc += chunk;
        if (waitingRef.current) {
          waitingRef.current = false;
          setWaitingFirstToken(false);
        }
        setMessages(m => m.map(x => x.id === modelMsgId ? { ...x, content: acc } : x));
      }

      // Salva sempre (anche se abortito: preserva il parziale)
      const final: Msg[] = acc
        ? [...newMessages, { id: modelMsgId, role: "model" as const, content: acc }]
        : newMessages;
      await setJSON(HISTORY_KEY, final.slice(-50));
      events.emit("chat:historyChanged", { length: final.length });
    } catch (e: any) {
      if (abort.signal.aborted && acc) {
        // Stream interrotto dall'utente ma abbiamo ricevuto qualcosa → salva parziale.
        const final: Msg[] = [...newMessages, { id: modelMsgId, role: "model" as const, content: acc + "\n\n_(risposta interrotta)_" }];
        await setJSON(HISTORY_KEY, final.slice(-50)).catch(() => { /* ignore */ });
        events.emit("chat:historyChanged", { length: final.length });
      } else {
        setError(translateGeminiError(e));
        setMessages(m => m.slice(0, -1));
      }
    }
    setLoading(false);
    setWaitingFirstToken(false);
    waitingRef.current = false;
    abortRef.current = null;
    persistRef.current = () => {};
  };

  const stopStream = () => {
    abortRef.current?.abort();
  };

  const clearChat = async () => {
    if (!confirm("Eliminare tutta la conversazione? L'operazione è definitiva.")) return;
    abortRef.current?.abort();
    setMessages([]);
    await setJSON(HISTORY_KEY, []);
    events.emit("chat:historyChanged", { length: 0 });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "60vh" }}>
      <div
        className="scroll-area"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Conversazione con il coach"
        style={{ flex: 1, overflowY: "auto", padding: "8px 0", display: "flex", flexDirection: "column", gap: "10px", minHeight: "300px" }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#94A3B8", padding: "30px 20px" }}>
            <div style={{ fontSize: "40px", marginBottom: "10px" }}>💬</div>
            <div style={{ fontSize: "14px" }}>Fai una domanda al coach. Ha accesso ai tuoi dati.</div>
          </div>
        )}

        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          return (
            <div key={m.id} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "linear-gradient(135deg, #E8553A 0%, #D44429 100%)" : "#16213E",
              color: m.role === "user" ? "#FFF" : "#E2E8F0",
              padding: "12px 14px", borderRadius: "14px",
              fontSize: "14px", lineHeight: 1.55, whiteSpace: "pre-wrap", wordWrap: "break-word",
              border: m.role === "model" ? "1px solid rgba(255,255,255,0.06)" : "none",
              animation: "slideUp 0.15s ease",
            }}>
              {m.role === "model" && m.content === "" && isLast && waitingFirstToken ? (
                <span className="typing-dots" aria-label="Il coach sta scrivendo">Coach sta scrivendo</span>
              ) : m.role === "model" ? <RichText text={m.content} /> : m.content}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && (
        <div role="alert" style={{ color: "#FCA5A5", fontSize: "13px", padding: "8px 12px", background: "#7F1D1D30", border: "1px solid #7F1D1D", borderRadius: "10px", marginBottom: "8px" }}>
          {error}
        </div>
      )}

      {fallbackNotice && (
        <div style={{ color: "#FCD34D", fontSize: "12px", padding: "6px 10px", background: "#78350F30", border: "1px solid #78350F", borderRadius: "8px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>⚠ {fallbackNotice}</span>
          <button onClick={() => setFallbackNotice(null)} aria-label="Chiudi" style={{ marginLeft: "auto", background: "none", border: "none", color: "#FCD34D", fontSize: "14px", cursor: "pointer" }}>×</button>
        </div>
      )}

      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
          {QUICK_PROMPTS.map(p => (
            <button key={p} onClick={() => send(p)} style={{
              background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "999px", padding: "8px 14px", fontSize: "12px",
              color: "#CBD5E1", cursor: "pointer", minHeight: "36px",
            }}>{p}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", padding: "8px 0", alignItems: "flex-end" }}>
        <textarea
          ref={taRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            // iOS keyboard copre ~40% dello schermo: scroll textarea in view
            // con lieve delay (setTimeout 300ms) dopo che la tastiera è salita.
            setTimeout(() => { taRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 300);
          }}
          placeholder="Scrivi al coach…  (Enter per inviare, Shift+Enter per andare a capo)"
          disabled={loading}
          rows={1}
          aria-label="Messaggio per il coach"
          style={{
            flex: 1, padding: "12px 14px", background: "#1A1A2E",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px",
            color: "#E2E8F0", fontSize: "15px", outline: "none",
            resize: "none", lineHeight: 1.4, maxHeight: "140px", minHeight: "44px",
          }}
        />
        {loading ? (
          <button onClick={stopStream} aria-label="Interrompi risposta" title="Interrompi (il parziale viene salvato)" style={{
            padding: "12px 18px", minWidth: "56px", minHeight: "44px",
            background: "#7F1D1D",
            border: "1px solid #EF4444", borderRadius: "12px", color: "#FCA5A5",
            fontWeight: 700, fontSize: "16px",
            cursor: "pointer",
          }}>■</button>
        ) : (
          <button onClick={() => send(input)} disabled={!input.trim()} aria-label="Invia messaggio" style={{
            padding: "12px 18px", minWidth: "56px", minHeight: "44px",
            background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
            border: "none", borderRadius: "12px", color: "#FFF",
            fontWeight: 700, fontSize: "18px",
            cursor: "pointer", opacity: !input.trim() ? 0.5 : 1,
          }}>→</button>
        )}
      </div>

      <div style={{ fontSize: "11px", color: "#94A3B8", textAlign: "center", marginTop: "4px" }}>
        Il coach può sbagliare. Le decisioni cliniche sono responsabilità tua.
      </div>

      {messages.length > 0 && (
        <button onClick={clearChat} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "12px", cursor: "pointer", alignSelf: "flex-end", padding: "8px 12px", marginTop: "4px" }}>
          Pulisci chat
        </button>
      )}
    </div>
  );
}
