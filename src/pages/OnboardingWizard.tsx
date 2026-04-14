import { useState, useEffect, useMemo, useRef } from "react";
import { setJSON, getJSON } from "../lib/storage";
import type { UserProfile, UserGoal, TrainingPlan, FeasibilityCheck, Experience } from "../lib/types";
import { hasApiKey } from "../lib/gemini";
import { ADAPTERS, getLLMConfig, setLLMConfig, type LLMConfig, type LLMModel, type ProviderId } from "../lib/llm";
import { checkGoalFeasibility } from "../lib/coach/feasibility";
import { generateInitialPlan } from "../lib/coach/planGenerator";
import { events } from "../lib/events";
import { translateGeminiError } from "../lib/geminiErrors";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini (consigliato, gratis)",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
};
const PROVIDER_HELP: Record<ProviderId, { url: string; label: string }> = {
  gemini: { url: "https://aistudio.google.com/apikey", label: "aistudio.google.com/apikey" },
  openai: { url: "https://platform.openai.com/api-keys", label: "platform.openai.com/api-keys" },
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "console.anthropic.com/settings/keys" },
};
const PROVIDER_PLACEHOLDER: Record<ProviderId, string> = {
  gemini: "AIza...", openai: "sk-...", anthropic: "sk-ant-...",
};

type Step = "intro" | "apiKey" | "profile" | "goals" | "disclaimer" | "plan";
const STEPS: Step[] = ["intro", "apiKey", "profile", "goals", "disclaimer", "plan"];

const cardStyle: React.CSSProperties = {
  background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "16px", padding: "20px",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px", background: "#1A1A2E",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
  color: "#E2E8F0", fontSize: "15px", outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" };
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "16px",
  background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
  border: "none", borderRadius: "14px", color: "#FFF",
  fontSize: "16px", fontWeight: 800, cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "10px 16px", background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px",
  color: "#94A3B8", fontSize: "14px", fontWeight: 600, cursor: "pointer",
};

const EXP_OPTIONS: Array<{ v: Experience; label: string; hint: string }> = [
  { v: "sedentary", label: "Sedentario", hint: "Non mi alleno da mesi/anni" },
  { v: "occasional", label: "Occasionale", hint: "1-2 volte a settimana saltuariamente" },
  { v: "regular", label: "Amatoriale regolare", hint: "3-5 volte/sett da tempo" },
  { v: "competitive", label: "Agonista", hint: "Gare, programmazione strutturata" },
];

export default function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("intro");

  // Provider/modello/chiave (multi-LLM)
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelId, setModelId] = useState<string>(ADAPTERS.gemini.defaultChatModel);
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyOk, setKeyOk] = useState<null | boolean>(null);
  const [keyError, setKeyError] = useState("");

  const adapter = useMemo(() => ADAPTERS[provider], [provider]);

  useEffect(() => {
    (async () => {
      const cfg = await getLLMConfig();
      if (cfg) {
        setProvider(cfg.provider);
        setApiKeyInput(cfg.apiKey);
        setModelId(cfg.modelId);
        if (hasApiKey()) setKeyOk(true);
      }
      // Se l'utente sta riprendendo l'onboarding, precarico il profilo esistente
      const existing = await getJSON<UserProfile | null>("user-profile", null);
      if (existing) {
        setProfile(existing);
        setInjuriesRaw((existing.injuries || []).join(", "));
        setEquipmentRaw((existing.equipment || []).join(", "));
        setPainAreasRaw((existing.painTrackingAreas || []).join(", "));
      }
    })();
  }, []);

  const onProviderChange = (p: ProviderId) => {
    setProvider(p);
    setModels([]);
    setKeyOk(null);
    setKeyError("");
    setModelId(ADAPTERS[p].defaultChatModel);
  };

  const discoverModels = async () => {
    if (!apiKeyInput.trim()) return;
    setLoadingModels(true);
    setKeyError("");
    try {
      const list = await adapter.listModels(apiKeyInput.trim());
      setModels(list);
      const def = list.find(m => m.id === adapter.defaultChatModel)
        || list.find(m => m.id.includes(adapter.defaultChatModel))
        || list[0];
      if (def) setModelId(def.id);
    } catch (e: any) {
      setKeyError(translateGeminiError(e?.message || e));
    } finally {
      setLoadingModels(false);
    }
  };

  const saveAndTestKey = async () => {
    if (!apiKeyInput.trim() || !modelId.trim()) return;
    setTestingKey(true); setKeyError(""); setKeyOk(null);
    const config: LLMConfig = { provider, apiKey: apiKeyInput.trim(), modelId: modelId.trim() };
    try {
      await setLLMConfig(config);
      const r = await adapter.ping(config.apiKey, config.modelId);
      if (r.ok) setKeyOk(true);
      else { setKeyOk(false); setKeyError(translateGeminiError(r.error || "Errore")); }
    } catch (e: any) {
      setKeyOk(false);
      setKeyError(translateGeminiError(e?.message || e));
    }
    setTestingKey(false);
  };

  const [profile, setProfile] = useState<Partial<UserProfile>>({
    age: undefined, sex: "m", weight_kg: undefined, height_cm: undefined,
    experience: "sedentary", injuries: [], meds: "",
    weekly_availability: { days: 3, hoursPerSession: 1 },
    equipment: [], notes: "",
  });

  // Input raw per liste comma-separated: NON parsiamo ad ogni keystroke
  // (altrimenti lo spazio dopo una parola viene rimosso dal trim).
  const [injuriesRaw, setInjuriesRaw] = useState("");
  const [equipmentRaw, setEquipmentRaw] = useState("");
  const [painAreasRaw, setPainAreasRaw] = useState("");

  const parseCSV = (s: string): string[] =>
    s.split(",").map(x => x.trim()).filter(Boolean);

  const [goalText, setGoalText] = useState("");
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [checking, setChecking] = useState(false);
  const [pendingCheck, setPendingCheck] = useState<FeasibilityCheck | null>(null);
  const [checkError, setCheckError] = useState("");

  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [planError, setPlanError] = useState("");

  const parseNum = (v: string): number | undefined => {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const canProceedProfile = !!(
    profile.age && profile.age >= 10 &&
    profile.weight_kg && profile.weight_kg >= 25 &&
    profile.height_cm && profile.height_cm >= 100 &&
    profile.experience
  );

  const saveProfileAndNext = async () => {
    const now = new Date().toISOString();
    // Forza parse dei raw input CSV anche se l'utente non ha mai fatto blur
    const injuriesFinal = parseCSV(injuriesRaw || (profile.injuries || []).join(", "));
    const equipmentFinal = parseCSV(equipmentRaw || (profile.equipment || []).join(", "));
    const painAreasFinal = parseCSV(painAreasRaw || (profile.painTrackingAreas || []).join(", "));

    const full: UserProfile = {
      age: profile.age!, sex: profile.sex!, weight_kg: profile.weight_kg!, height_cm: profile.height_cm!,
      experience: profile.experience!, injuries: injuriesFinal, meds: profile.meds || "",
      weekly_availability: profile.weekly_availability || { days: 3, hoursPerSession: 1 },
      equipment: equipmentFinal, notes: profile.notes,
      painTrackingAreas: painAreasFinal,
      createdAt: now, updatedAt: now,
    };
    await setJSON("user-profile", full);
    events.emit("profile:updated", { at: now });
    setStep("goals");
  };

  const feasibilityReqIdRef = useRef(0);
  const runFeasibility = async () => {
    if (!goalText.trim()) return;
    const myReqId = ++feasibilityReqIdRef.current;
    setChecking(true); setCheckError("");
    try {
      const savedProfile = await getJSON<UserProfile | null>("user-profile", null);
      if (!savedProfile) throw new Error("Profilo mancante");
      const res = await checkGoalFeasibility(savedProfile, goalText.trim());
      // Scarta la risposta se nel frattempo è stato avviato un nuovo check
      if (myReqId !== feasibilityReqIdRef.current) return;
      setPendingCheck(res);
    } catch (e: any) {
      if (myReqId !== feasibilityReqIdRef.current) return;
      setCheckError(translateGeminiError(e));
    }
    if (myReqId === feasibilityReqIdRef.current) setChecking(false);
  };

  const editGoal = (g: UserGoal) => {
    setGoalText(g.originalDescription);
    setGoals(gs => gs.filter(x => x.id !== g.id));
    setPendingCheck(null);
  };

  const acceptProposal = () => {
    if (!pendingCheck) return;
    const goal: UserGoal = {
      id: Date.now().toString(36),
      originalDescription: goalText.trim(),
      smartDescription: pendingCheck.counterProposal.description,
      kpi: pendingCheck.counterProposal.kpi,
      realistic: pendingCheck.realistic,
      coachReasoning: pendingCheck.reasoning,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    setGoals(g => [...g, goal]);
    setGoalText(""); setPendingCheck(null);
  };

  const saveGoalsAndNext = async () => {
    await setJSON("user-goals", goals);
    events.emit("goals:updated", { at: new Date().toISOString() });
    setStep("disclaimer");
  };

  const generatePlan = async () => {
    setGenerating(true); setPlanError("");
    try {
      const p = await getJSON<UserProfile | null>("user-profile", null);
      const gs = await getJSON<UserGoal[]>("user-goals", []);
      if (!p) throw new Error("Profilo mancante");
      const tp = await generateInitialPlan(p, gs);
      setPlan(tp);
      await setJSON("training-plan", tp);
      events.emit("plan:updated", { at: new Date().toISOString() });
    } catch (e: any) {
      setPlanError(translateGeminiError(e));
    }
    setGenerating(false);
  };

  const finish = async () => {
    await setJSON("onboarding-completed", true);
    onDone();
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px 120px" }}>
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }} aria-label="Progresso setup">
        {STEPS.map((s, i) => (
          <div key={s} style={{
            flex: 1, height: "4px", borderRadius: "2px",
            background: step === s ? "#E8553A" : stepIndex > i ? "#E8553A88" : "#1A1A2E",
          }} />
        ))}
      </div>

      {step === "intro" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Benvenuto</div>
            <h2 style={{ fontSize: "28px", fontWeight: 900, margin: "6px 0 8px", letterSpacing: "-0.03em" }}>Diario & Coach</h2>
            <p style={{ color: "#94A3B8", fontSize: "15px", margin: 0, lineHeight: 1.5 }}>
              Traccia i tuoi allenamenti, ricevi un coach AI che ti guida. In 4 step definiamo profilo, obiettivi e primo piano.
            </p>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {[
                { emoji: "📓", title: "Diario completo", desc: "Corsa, forza, sport, mobilità — con dolore, RPE, note." },
                { emoji: "🎯", title: "Coach che costruisce il piano", desc: "Ti intervista, verifica gli obiettivi, ti propone sessioni realistiche." },
                { emoji: "⚡", title: "Feedback immediato", desc: "Dopo ogni sessione il coach analizza i tuoi dati e suggerisce cosa fare domani." },
              ].map(f => (
                <div key={f.title} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                  <div style={{ fontSize: "26px", lineHeight: 1 }}>{f.emoji}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "15px" }}>{f.title}</div>
                    <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "3px" }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...cardStyle, background: "#1A1A2E", fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 }}>
            <b style={{ color: "#CBD5E1" }}>Privacy</b>: i tuoi dati restano sul tuo dispositivo. Il coach usa la <b>tua</b> chiave Gemini (gratuita), inviata direttamente a Google.
          </div>

          <button onClick={() => setStep("apiKey")} style={primaryBtn}>Iniziamo →</button>
        </div>
      )}

      {step === "apiKey" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 1 · Coach AI</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Scegli il tuo provider</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0, lineHeight: 1.5 }}>
              Il coach funziona con <b>Google Gemini</b> (consigliato, gratis), <b>OpenAI</b> o <b>Anthropic</b>. Puoi cambiare dopo in Impostazioni.
            </p>
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>Provider LLM</label>
            <select style={{ ...inputStyle, fontFamily: "inherit" }} value={provider} onChange={e => onProviderChange(e.target.value as ProviderId)}>
              {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>

            <div style={{ marginTop: "12px", fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 }}>
              Ottieni la chiave gratis su <a href={PROVIDER_HELP[provider].url} target="_blank" rel="noreferrer" style={{ color: "#E8553A" }}>{PROVIDER_HELP[provider].label}</a>
            </div>

            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>
                Chiave API <span style={{ color: "#E8553A" }} aria-label="obbligatoria">*</span>
              </label>
              <input type="password" style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
                value={apiKeyInput}
                onChange={e => { setApiKeyInput(e.target.value); setKeyOk(null); setModels([]); }}
                placeholder={PROVIDER_PLACEHOLDER[provider]} autoComplete="off" />
            </div>

            <button onClick={discoverModels}
              disabled={loadingModels || apiKeyInput.trim().length < 20}
              style={{
                ...primaryBtn, marginTop: "12px", padding: "12px",
                background: "#16213E", border: "1px solid rgba(255,255,255,0.12)",
                opacity: (loadingModels || apiKeyInput.trim().length < 20) ? 0.5 : 1,
              }}>
              {loadingModels ? <><span className="spinner" /> Scopro modelli…</> : "🔎 Scopri modelli disponibili"}
            </button>

            {models.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <label style={labelStyle}>Modello</label>
                <select style={{ ...inputStyle, fontFamily: "inherit" }} value={modelId} onChange={e => { setModelId(e.target.value); setKeyOk(null); }}>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.displayName ? `${m.displayName} (${m.id})` : m.id}</option>
                  ))}
                </select>
              </div>
            )}

            <button onClick={saveAndTestKey}
              disabled={testingKey || !apiKeyInput.trim() || !modelId.trim()}
              style={{
                ...primaryBtn, marginTop: "12px",
                opacity: (testingKey || !apiKeyInput.trim() || !modelId.trim()) ? 0.5 : 1,
              }}>
              {testingKey ? <><span className="spinner" /> Verifico…</> : keyOk ? "✓ Valida — ri-testa" : "Salva e testa"}
            </button>

            {keyOk === true && (
              <div style={{ marginTop: "10px", fontSize: "13px", color: "#22C55E", fontWeight: 600 }}>
                ✓ Connessione OK con {PROVIDER_LABELS[provider]} · {modelId}
              </div>
            )}
            {keyOk === false && (
              <div style={{ marginTop: "10px", fontSize: "13px", color: "#EF4444" }}>{keyError}</div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep("intro")} style={ghostBtn}>← Indietro</button>
            <button onClick={() => setStep("profile")} disabled={!keyOk} style={{
              ...primaryBtn, flex: 1, opacity: keyOk ? 1 : 0.5,
              cursor: keyOk ? "pointer" : "not-allowed",
            }}>Continua →</button>
          </div>
          <button onClick={() => setStep("profile")} style={{
            ...ghostBtn, alignSelf: "center", fontSize: "12px",
          }}>Salta: userò solo il diario</button>
        </div>
      )}

      {step === "profile" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 2 · Profilo</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Chi sei</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>Mi servono alcuni dati per costruire un piano realistico. I campi con <span style={{ color: "#E8553A" }}>*</span> sono obbligatori.</p>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              <div>
                <label style={labelStyle}>Età <span style={{ color: "#E8553A" }} aria-label="obbligatorio">*</span></label>
                <input type="number" min={10} max={100} style={inputStyle} value={profile.age ?? ""} onChange={e => setProfile(p => ({ ...p, age: parseNum(e.target.value) }))} />
              </div>
              <div>
                <label style={labelStyle}>Sesso</label>
                <select style={inputStyle} value={profile.sex} onChange={e => setProfile(p => ({ ...p, sex: e.target.value as any }))}>
                  <option value="m">Maschile</option>
                  <option value="f">Femminile</option>
                  <option value="other">Altro / Preferisco non dirlo</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Peso (kg) <span style={{ color: "#E8553A" }} aria-label="obbligatorio">*</span></label>
                <input type="number" step="0.1" style={inputStyle} value={profile.weight_kg ?? ""} onChange={e => setProfile(p => ({ ...p, weight_kg: parseNum(e.target.value) }))} />
              </div>
              <div>
                <label style={labelStyle}>Altezza (cm) <span style={{ color: "#E8553A" }} aria-label="obbligatorio">*</span></label>
                <input type="number" style={inputStyle} value={profile.height_cm ?? ""} onChange={e => setProfile(p => ({ ...p, height_cm: parseNum(e.target.value) }))} />
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>Livello di esperienza</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {EXP_OPTIONS.map(o => (
                <button key={o.v} onClick={() => setProfile(p => ({ ...p, experience: o.v }))} style={{
                  textAlign: "left", padding: "12px 14px",
                  background: profile.experience === o.v ? "#E8553A22" : "#1A1A2E",
                  border: profile.experience === o.v ? "1px solid #E8553A" : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "10px", color: "#E2E8F0", cursor: "pointer",
                }}>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>{o.label}</div>
                  <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "2px" }}>{o.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>Disponibilità settimanale</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "4px" }}>Giorni</div>
                <input type="number" min={1} max={7} style={inputStyle} value={profile.weekly_availability?.days ?? 3}
                  onChange={e => setProfile(p => ({ ...p, weekly_availability: { ...p.weekly_availability!, days: parseNum(e.target.value) ?? 3 } }))} />
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "4px" }}>Ore/sessione</div>
                <input type="number" step="0.5" min={0.25} max={3} style={inputStyle} value={profile.weekly_availability?.hoursPerSession ?? 1}
                  onChange={e => setProfile(p => ({ ...p, weekly_availability: { ...p.weekly_availability!, hoursPerSession: parseNum(e.target.value) ?? 1 } }))} />
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>Infortuni o condizioni (opzionale)</label>
            <input type="text" style={inputStyle} placeholder="es. tendinopatia polpaccio sx, ernia L5"
              value={injuriesRaw}
              onChange={e => setInjuriesRaw(e.target.value)}
              onBlur={e => setProfile(p => ({ ...p, injuries: parseCSV(e.target.value) }))} />
            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>Farmaci / integratori (opzionale)</label>
              <input type="text" style={inputStyle} value={profile.meds || ""} onChange={e => setProfile(p => ({ ...p, meds: e.target.value }))} />
            </div>
            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>Attrezzatura disponibile (opzionale)</label>
              <input type="text" style={inputStyle} placeholder="es. tapis roulant, manubri 10kg, palestra"
                value={equipmentRaw}
                onChange={e => setEquipmentRaw(e.target.value)}
                onBlur={e => setProfile(p => ({ ...p, equipment: parseCSV(e.target.value) }))} />
            </div>

            {(profile.injuries || []).length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <label style={labelStyle}>Zone di dolore da monitorare nel diario (opzionale)</label>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "6px" }}>
                  Se ti alleni con un'area dolorante, il diario mostrerà una scala 0-4 pre/durante/post per ciascuna zona. Lasciare vuoto per nessun tracking.
                </div>
                <input type="text" style={inputStyle} placeholder="es. polpaccio sx, ginocchio, tendine achille"
                  value={painAreasRaw}
                  onChange={e => setPainAreasRaw(e.target.value)}
                  onBlur={e => setProfile(p => ({ ...p, painTrackingAreas: parseCSV(e.target.value) }))} />
              </div>
            )}
          </div>

          <button disabled={!canProceedProfile} onClick={saveProfileAndNext} style={{ ...primaryBtn, opacity: canProceedProfile ? 1 : 0.5, cursor: canProceedProfile ? "pointer" : "not-allowed" }}>
            Continua →
          </button>
        </div>
      )}

      {step === "goals" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 3 · Obiettivi</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Obiettivi</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0, lineHeight: 1.5 }}>
              Scrivi 1-3 obiettivi. Il coach li valuterà e proporrà una versione realistica se servono aggiustamenti.
            </p>
          </div>

          {!hasApiKey() && (
            <div style={{ ...cardStyle, border: "1px solid #F59E0B66", background: "#F59E0B15" }}>
              <div style={{ fontWeight: 700, marginBottom: "6px", color: "#F59E0B" }}>⚠ Chiave Gemini mancante</div>
              <div style={{ fontSize: "13px", color: "#CBD5E1", marginBottom: "10px" }}>Torna allo step precedente per configurarla, oppure salta: potrai aggiungere obiettivi dopo.</div>
              <button onClick={() => setStep("apiKey")} style={{ ...ghostBtn, fontSize: "13px", padding: "8px 14px" }}>← Configura chiave</button>
            </div>
          )}

          {goals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {goals.map((g, i) => (
                <div key={g.id} style={cardStyle}>
                  <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px", fontWeight: 600, letterSpacing: "0.08em" }}>OBIETTIVO {i + 1}</div>
                  <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "6px" }}>{g.smartDescription}</div>
                  <div style={{ fontSize: "13px", color: "#94A3B8" }}>KPI: <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E2E8F0" }}>{g.kpi.metric} {g.kpi.target}</span> entro {g.kpi.deadline}</div>
                  {g.originalDescription !== g.smartDescription && (
                    <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px", fontStyle: "italic" }}>
                      Originale: "{g.originalDescription}"
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                    <button onClick={() => editGoal(g)} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px" }}>Modifica</button>
                    <button onClick={() => setGoals(gs => gs.filter(x => x.id !== g.id))} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px", borderColor: "#EF444444", color: "#EF4444" }}>Rimuovi</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {goals.length >= 3 && !pendingCheck && (
            <div style={{ ...cardStyle, background: "#1A1A2E", fontSize: "13px", color: "#94A3B8" }}>
              Hai raggiunto il massimo di 3 obiettivi. Rimuovine uno per aggiungerne un altro.
            </div>
          )}

          {goals.length < 3 && !pendingCheck && (
            <div style={cardStyle}>
              <label style={labelStyle}>Qual è il tuo prossimo obiettivo?</label>
              <textarea style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }} placeholder="es. correre 10 km sotto 55 minuti entro 8 settimane"
                value={goalText} onChange={e => setGoalText(e.target.value)} />
              <button onClick={runFeasibility} disabled={checking || !goalText.trim() || !hasApiKey()} style={{ ...primaryBtn, marginTop: "12px", opacity: (checking || !goalText.trim() || !hasApiKey()) ? 0.5 : 1 }}>
                {checking ? <><span className="spinner" /> Verifico con il coach…</> : "Verifica con il coach"}
              </button>
              {checkError && (
                <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: "#EF4444", fontSize: "13px", flex: 1, minWidth: "200px" }}>{checkError}</span>
                  <button onClick={runFeasibility} style={{ ...ghostBtn, fontSize: "12px", padding: "6px 12px" }}>Riprova</button>
                </div>
              )}
            </div>
          )}

          {pendingCheck && (
            <div style={{ ...cardStyle, border: pendingCheck.realistic ? "1px solid #22C55E66" : "1px solid #F59E0B66" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: pendingCheck.realistic ? "#22C55E" : "#F59E0B", textTransform: "uppercase", marginBottom: "8px" }}>
                {pendingCheck.realistic ? "✓ Obiettivo ben definito" : "Controproposta del coach"}
              </div>
              <div style={{ fontSize: "14px", color: "#E2E8F0", marginBottom: "12px", lineHeight: 1.5 }}>{pendingCheck.reasoning}</div>
              <div style={{ background: "#1A1A2E", padding: "12px 14px", borderRadius: "10px", marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px", fontWeight: 600, letterSpacing: "0.08em" }}>
                  {pendingCheck.realistic ? "VERSIONE FINALE" : "VERSIONE PROPOSTA"}
                </div>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>{pendingCheck.counterProposal.description}</div>
                <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "4px", fontFamily: "'JetBrains Mono', monospace" }}>
                  {pendingCheck.counterProposal.kpi.metric}: {pendingCheck.counterProposal.kpi.target} — {pendingCheck.counterProposal.kpi.deadline}
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={acceptProposal} style={{ ...primaryBtn, flex: 1, padding: "12px" }}>
                  {pendingCheck.realistic ? "Conferma" : "Accetta"}
                </button>
                <button onClick={() => setPendingCheck(null)} style={{ ...ghostBtn, flex: 1 }}>Modifica</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep("profile")} style={ghostBtn}>← Indietro</button>
            <button onClick={saveGoalsAndNext} style={{ ...primaryBtn, flex: 1 }}>
              {goals.length ? "Continua →" : "Salta per ora →"}
            </button>
          </div>
        </div>
      )}

      {step === "disclaimer" && (() => {
        // Disclaimer personalizzato in base a profilo + condizioni rilevate
        const age = profile.age || 0;
        const injuriesText = (profile.injuries || []).join(" ").toLowerCase() + " " + (profile.meds || "").toLowerCase() + " " + (profile.notes || "").toLowerCase();
        const hasHypertension = /iperten|hypertens|pressione alt/.test(injuriesText);
        const hasCardiac = /cardio|cardiac|cuore|coronari|scompenso|aritmia/.test(injuriesText);
        const hasDiabetes = /diabet/.test(injuriesText);
        const hasPostPartum = /post.?parto|pelvic|cesareo|puerperio/.test(injuriesText);
        const hasREDS = /red.?s|amenorre|lea\b|low.energy/.test(injuriesText);
        const hasTendinopathy = /tendinopat|achillea|fascite/.test(injuriesText);
        const isSenior = age >= 65;
        const isMidAge = age >= 50 && age < 65;
        const hasAnyPersonalized = isSenior || isMidAge || hasHypertension || hasCardiac || hasDiabetes || hasPostPartum || hasREDS || hasTendinopathy;

        return (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 4 · Sicurezza</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Regole di sicurezza</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>Il coach si basa su queste regole per ogni consiglio. Leggile bene.</p>
          </div>

          <div style={cardStyle}>
            <ul style={{ paddingLeft: "18px", lineHeight: 1.7, color: "#E2E8F0", fontSize: "14px", margin: 0 }}>
              <li><b>Non sostituisce</b> medico, fisioterapista o preparatore. Dubbi clinici → specialista.</li>
              <li><b>Dolore ≥ 3</b> (scala 0-4+) nelle zone monitorate = <b>stop immediato</b>, consulta specialista.</li>
              <li><b>Progressione volume max +10% a settimana</b>. Nessuna scorciatoia.</li>
              <li><b>Almeno 2 giorni di riposo</b> o recovery a settimana.</li>
              <li>Combo <b>sonno ≤6h + stanchezza ≥8/10 per 2 giorni</b> = deload obbligatorio.</li>
              <li>Il coach può sbagliare. <b>La decisione finale è sempre tua</b>.</li>
            </ul>
          </div>

          {hasAnyPersonalized && (
            <div style={{ ...cardStyle, border: "1px solid #EF444466", background: "#EF444410" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#EF4444", marginBottom: "10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                ⚠ Avvertenze specifiche per il tuo profilo
              </div>
              <ul style={{ paddingLeft: "18px", lineHeight: 1.7, color: "#FCA5A5", fontSize: "13px", margin: 0 }}>
                {isSenior && (
                  <li><b>Età ≥ 65 anni</b>: chiedi OK al medico curante/cardiologo prima di iniziare attività aerobiche vigorose o forza massimale.</li>
                )}
                {isMidAge && !isSenior && (
                  <li><b>Età 50-64</b>: se hai fattori di rischio cardiovascolare non controllati, valuta un test da sforzo cardiologico prima di attività intense.</li>
                )}
                {(hasHypertension || hasCardiac) && (
                  <li><b>Condizione cardiovascolare dichiarata</b>: <u>richiedi clearance scritta dal cardiologo</u> prima di intensificare corsa o forza. Evita Valsalva (respirazione bloccata) e 1RM veri. Stop se: dolore toracico, dispnea sproporzionata, vertigini.</li>
                )}
                {hasDiabetes && (
                  <li><b>Diabete</b>: monitora glicemia pre/post esercizio. Porta con te glucosio veloce. Coordina dosi insulinica con il tuo diabetologo.</li>
                )}
                {hasPostPartum && (
                  <li><b>Post-parto / pelvic floor</b>: prima di high-impact (corsa, salti), fai valutazione con fisioterapista ostetrico. Nei primi 3-6 mesi post-parto, preferisci low-impact + rinforzo core/pelvic.</li>
                )}
                {hasREDS && (
                  <li><b>Storia di RED-S / amenorrea</b>: NON ridurre kcal. Monitoraggio ciclo obbligatorio (campo nel diario). Se amenorrea torna: stop intensità e consulta endocrinologo/medico sportivo.</li>
                )}
                {hasTendinopathy && (
                  <li><b>Tendinopatie</b>: usa il modello Silbernagel — dolore ≤ 2/4 OK proseguire, 3/4 ridurre, 4+ stop. Sessioni ogni 48-72h nella zona interessata.</li>
                )}
              </ul>
              <div style={{ marginTop: "10px", fontSize: "11px", color: "#94A3B8", fontStyle: "italic", lineHeight: 1.4 }}>
                Queste indicazioni derivano da ACSM/IOC/ECSS (vedi scientific-foundations nel repo). Il coach le applicherà automaticamente ai suoi consigli.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep("goals")} style={ghostBtn}>← Indietro</button>
            <button onClick={() => setStep("plan")} style={{ ...primaryBtn, flex: 1 }}>Ho capito →</button>
          </div>
        </div>
        );
      })()}

      {step === "plan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 5 · Piano</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Il tuo piano</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>Microciclo di 2 settimane costruito sul tuo profilo.</p>
          </div>

          {!plan && !generating && (
            <button onClick={generatePlan} disabled={!hasApiKey()} style={{ ...primaryBtn, opacity: hasApiKey() ? 1 : 0.5 }}>
              {hasApiKey() ? "Genera piano iniziale" : "Chiave Gemini richiesta (torna allo Step 1)"}
            </button>
          )}
          {generating && (
            <div style={{ ...cardStyle, textAlign: "center" }}>
              <span className="spinner" /> Sto costruendo il piano…
            </div>
          )}
          {planError && (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#EF4444", fontSize: "13px", flex: 1 }}>{planError}</span>
              <button onClick={generatePlan} style={{ ...ghostBtn, fontSize: "12px", padding: "6px 12px" }}>Riprova</button>
            </div>
          )}

          {plan && (
            <>
              <div style={{ ...cardStyle, borderLeft: "3px solid #E8553A" }}>
                <div style={{ fontSize: "11px", color: "#64748B", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Razionale</div>
                <div style={{ fontSize: "14px", lineHeight: 1.5 }}>{plan.rationale}</div>
              </div>
              {plan.weeks.map(w => (
                <div key={w.weekNumber} style={cardStyle}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#E8553A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>Settimana {w.weekNumber}</div>
                  <div style={{ fontSize: "14px", color: "#CBD5E1", marginBottom: "12px", fontWeight: 600 }}>{w.focus}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {w.sessions.map((s, i) => (
                      <div key={i} style={{ padding: "10px 12px", background: "#1A1A2E", borderRadius: "10px", fontSize: "13px" }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "4px" }}>
                          <span style={{ fontWeight: 700, textTransform: "uppercase", color: "#E8553A", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "32px" }}>{s.day}</span>
                          <span style={{ fontWeight: 600 }}>{s.type}</span>
                          <span style={{ color: "#64748B", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>{s.duration_min}min</span>
                        </div>
                        <div style={{ color: "#CBD5E1" }}>{s.details}</div>
                        <div style={{ color: "#64748B", fontSize: "12px", fontStyle: "italic", marginTop: "4px" }}>{s.rationale}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={finish} style={primaryBtn}>Inizia ad allenarti</button>
            </>
          )}

          {!plan && (
            <button onClick={finish} style={ghostBtn}>Salta: userò solo il diario</button>
          )}
        </div>
      )}
    </div>
  );
}
