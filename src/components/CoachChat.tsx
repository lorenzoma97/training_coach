import { useEffect, useRef, useState } from "react";
import { streamChat, hasApiKey } from "../lib/gemini";
import { PROMPTS } from "../lib/coach/systemPrompts";
import { buildCoachContext, profileAsPrompt, goalsAsPrompt, planAsPrompt } from "../lib/diaryContext";
import { getJSON, setJSON } from "../lib/storage";

type Msg = { role: "user" | "model"; content: string };

const QUICK_PROMPTS = [
  "Come sta andando la mia settimana?",
  "Devo riposare domani?",
  "Analizza la mia corsa di oggi",
  "Come sta andando il polpaccio?",
  "Proponimi la sessione di domani",
];

export default function CoachChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const saved = await getJSON<Msg[]>("coach-chat-history", []);
      setMessages(saved);
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    if (!hasApiKey()) { setError("Configura la chiave Gemini in Impostazioni"); return; }
    setError("");

    const userMsg: Msg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const ctx = await buildCoachContext({ daysBack: 14 });
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

      setMessages(m => [...m, { role: "model", content: "" }]);
      let acc = "";
      const history = newMessages.slice(0, -1).map(m => ({ role: m.role, parts: m.content }));
      for await (const chunk of streamChat({
        systemInstruction: PROMPTS.chat(),
        history,
        userMessage: contextBlock,
      })) {
        acc += chunk;
        setMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "model", content: acc };
          return copy;
        });
      }

      const final = [...newMessages, { role: "model" as const, content: acc }];
      await setJSON("coach-chat-history", final.slice(-50));
    } catch (e: any) {
      setError(e?.message || "Errore");
      setMessages(m => m.slice(0, -1));
    }
    setLoading(false);
  };

  const clearChat = async () => {
    setMessages([]);
    await setJSON("coach-chat-history", []);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "60vh" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", display: "flex", flexDirection: "column", gap: "10px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#64748B", padding: "30px 20px" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>💬</div>
            <div style={{ fontSize: "14px" }}>Fai una domanda al coach. Ha accesso ai tuoi dati.</div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%",
            background: m.role === "user" ? "linear-gradient(135deg, #E8553A 0%, #D44429 100%)" : "#16213E",
            color: m.role === "user" ? "#FFF" : "#E2E8F0",
            padding: "12px 14px", borderRadius: "14px",
            fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap",
            border: m.role === "model" ? "1px solid rgba(255,255,255,0.06)" : "none",
          }}>
            {m.content || <span className="spinner" />}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && <div style={{ color: "#EF4444", fontSize: "13px", padding: "8px 0" }}>{error}</div>}

      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
          {QUICK_PROMPTS.map(p => (
            <button key={p} onClick={() => send(p)} style={{
              background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "999px", padding: "8px 12px", fontSize: "12px",
              color: "#CBD5E1", cursor: "pointer",
            }}>{p}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", padding: "8px 0" }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(input); }}
          placeholder="Scrivi al coach…"
          disabled={loading}
          style={{
            flex: 1, padding: "12px 14px", background: "#1A1A2E",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px",
            color: "#E2E8F0", fontSize: "15px", outline: "none", fontFamily: "inherit",
          }}
        />
        <button onClick={() => send(input)} disabled={loading || !input.trim()} style={{
          padding: "12px 18px", background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
          border: "none", borderRadius: "12px", color: "#FFF",
          fontWeight: 700, cursor: loading ? "wait" : "pointer", opacity: (!input.trim() || loading) ? 0.5 : 1,
        }}>{loading ? "…" : "→"}</button>
      </div>
      {messages.length > 0 && (
        <button onClick={clearChat} style={{ background: "none", border: "none", color: "#64748B", fontSize: "12px", cursor: "pointer", alignSelf: "flex-end", padding: "4px 8px" }}>
          Pulisci chat
        </button>
      )}
    </div>
  );
}
