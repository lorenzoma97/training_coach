import { useEffect, useRef, useState } from "react";
import { streamChat, hasApiKey } from "../lib/gemini";
import { PROMPTS } from "../lib/coach/systemPrompts";
import { buildCoachContext, profileAsPrompt, goalsAsPrompt, planAsPrompt } from "../lib/diaryContext";
import { getJSON, setJSON } from "../lib/storage";
import { translateGeminiError } from "../lib/geminiErrors";
import { retrieveRelevantChunks, chunksAsPromptBlock } from "../lib/knowledge";
import { buildConditionalPrompt, extractConditionsFromProfile, RUNNING_GOAL_RE, type BuildContext } from "../lib/coach/promptBuilder";
import RichText from "./RichText";

type Msg = { id: string; role: "user" | "model"; content: string };
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
  const waitingRef = useRef(false); // closure-safe per evitare stale read nel loop streaming
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      const saved = await getJSON<Msg[]>("coach-chat-history", []);
      // Migration: aggiungi id ai messaggi legacy senza id
      setMessages(saved.map(m => m.id ? m : { ...m, id: genId() }));
    })();
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
    setError("");

    const userMsg: Msg = { id: genId(), role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setWaitingFirstToken(true);
    waitingRef.current = true;

    try {
      const ctx = await buildCoachContext({ daysBack: 14 });

      // RAG: recupera evidenza scientifica pertinente alla domanda (non blocca se fallisce/offline)
      const ragResults = await retrieveRelevantChunks({ query: text, topK: 3, minScore: 0.55 });
      const ragBlock = chunksAsPromptBlock(ragResults);

      // Injection condizionale: moduli basati sul profilo/contesto utente
      const bCtx: BuildContext = {
        profile: ctx.profile,
        hasRunningGoal: ctx.goals.some(g => RUNNING_GOAL_RE.test(g.smartDescription || "")),
        hasStrengthInPlan: !!ctx.plan?.weeks.some(w => w.sessions.some(s => s.type.startsWith("forza"))),
        detectedConditions: extractConditionsFromProfile(ctx.profile),
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

      const modelMsgId = genId();
      setMessages(m => [...m, { id: modelMsgId, role: "model", content: "" }]);
      let acc = "";
      const history = newMessages.slice(0, -1).map(m => ({ role: m.role, parts: m.content }));
      for await (const chunk of streamChat({
        systemInstruction,
        history,
        userMessage: contextBlock,
      })) {
        acc += chunk;
        if (waitingRef.current) {
          waitingRef.current = false;
          setWaitingFirstToken(false);
        }
        setMessages(m => m.map(x => x.id === modelMsgId ? { ...x, content: acc } : x));
      }

      const final = [...newMessages, { id: modelMsgId, role: "model" as const, content: acc }];
      await setJSON("coach-chat-history", final.slice(-50));
    } catch (e: any) {
      setError(translateGeminiError(e));
      setMessages(m => m.slice(0, -1));
    }
    setLoading(false);
    setWaitingFirstToken(false);
    waitingRef.current = false;
  };

  const clearChat = async () => {
    if (!confirm("Cancellare tutta la conversazione? Non è reversibile.")) return;
    setMessages([]);
    await setJSON("coach-chat-history", []);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "60vh" }}>
      <div className="scroll-area" style={{ flex: 1, overflowY: "auto", padding: "8px 0", display: "flex", flexDirection: "column", gap: "10px", minHeight: "300px" }}>
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
        <button onClick={() => send(input)} disabled={loading || !input.trim()} aria-label="Invia messaggio" style={{
          padding: "12px 18px", minWidth: "56px", minHeight: "44px",
          background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
          border: "none", borderRadius: "12px", color: "#FFF",
          fontWeight: 700, fontSize: "18px",
          cursor: loading ? "wait" : "pointer", opacity: (!input.trim() || loading) ? 0.5 : 1,
        }}>{loading ? "…" : "→"}</button>
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
