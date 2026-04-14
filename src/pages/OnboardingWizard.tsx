import { useState, useEffect } from "react";
import { setJSON, getJSON } from "../lib/storage";
import type { UserProfile, UserGoal, TrainingPlan, FeasibilityCheck, Experience } from "../lib/types";
import { hasApiKey, setApiKey, getApiKey, pingApiKey } from "../lib/gemini";
import { checkGoalFeasibility } from "../lib/coach/feasibility";
import { generateInitialPlan } from "../lib/coach/planGenerator";
import { events } from "../lib/events";
import { translateGeminiError } from "../lib/geminiErrors";

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

  // API key step
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [testingKey, setTestingKey] = useState(false);
  const [keyOk, setKeyOk] = useState<null | boolean>(null);
  const [keyError, setKeyError] = useState("");

  useEffect(() => {
    setApiKeyInput(getApiKey());
    if (hasApiKey()) setKeyOk(true);
  }, []);

  const saveAndTestKey = async () => {
    setTestingKey(true); setKeyError(""); setKeyOk(null);
    setApiKey(apiKeyInput);
    const r = await pingApiKey();
    if (r.ok) { setKeyOk(true); }
    else { setKeyOk(false); setKeyError(translateGeminiError(r.error || "Errore")); }
    setTestingKey(false);
  };

  const [profile, setProfile] = useState<Partial<UserProfile>>({
    age: undefined, sex: "m", weight_kg: undefined, height_cm: undefined,
    experience: "sedentary", injuries: [], meds: "",
    weekly_availability: { days: 3, hoursPerSession: 1 },
    equipment: [], notes: "",
  });

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
    const full: UserProfile = {
      age: profile.age!, sex: profile.sex!, weight_kg: profile.weight_kg!, height_cm: profile.height_cm!,
      experience: profile.experience!, injuries: profile.injuries || [], meds: profile.meds || "",
      weekly_availability: profile.weekly_availability || { days: 3, hoursPerSession: 1 },
      equipment: profile.equipment || [], notes: profile.notes,
      createdAt: now, updatedAt: now,
    };
    await setJSON("user-profile", full);
    events.emit("profile:updated", { at: now });
    setStep("goals");
  };

  const runFeasibility = async () => {
    if (!goalText.trim()) return;
    setChecking(true); setCheckError("");
    try {
      const savedProfile = await getJSON<UserProfile | null>("user-profile", null);
      if (!savedProfile) throw new Error("Profilo mancante");
      const res = await checkGoalFeasibility(savedProfile, goalText.trim());
      setPendingCheck(res);
    } catch (e: any) {
      setCheckError(translateGeminiError(e));
    }
    setChecking(false);
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
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 1 · Coach</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Chiave Gemini</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0, lineHeight: 1.5 }}>
              Il coach usa Gemini 2.0 Flash di Google. La chiave è <b>gratuita</b> e si ottiene in 30 secondi.
            </p>
          </div>

          <div style={cardStyle}>
            <ol style={{ paddingLeft: "20px", margin: 0, lineHeight: 1.8, color: "#CBD5E1", fontSize: "14px" }}>
              <li>Vai su <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "#E8553A" }}>aistudio.google.com/apikey</a></li>
              <li>Accedi con un account Google</li>
              <li>Clicca <b>"Create API key"</b> e copiala</li>
              <li>Incollala qui sotto</li>
            </ol>
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>
              Chiave API <span style={{ color: "#E8553A" }} aria-label="obbligatoria">*</span>
            </label>
            <input type="password" style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
              value={apiKeyInput} onChange={e => { setApiKeyInput(e.target.value); setKeyOk(null); }}
              placeholder="AIza..." autoComplete="off" />
            <button onClick={saveAndTestKey} disabled={testingKey || apiKeyInput.trim().length < 20} style={{
              ...primaryBtn, marginTop: "12px",
              opacity: (testingKey || apiKeyInput.trim().length < 20) ? 0.5 : 1,
            }}>
              {testingKey ? <><span className="spinner" /> Verifico…</> : keyOk ? "✓ Chiave valida — ri-testa" : "Salva e testa"}
            </button>
            {keyOk === true && (
              <div style={{ marginTop: "10px", fontSize: "13px", color: "#22C55E", fontWeight: 600 }}>
                ✓ Connessione a Gemini OK. Puoi proseguire.
              </div>
            )}
            {keyOk === false && (
              <div style={{ marginTop: "10px", fontSize: "13px", color: "#EF4444" }}>
                {keyError}
              </div>
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
              value={(profile.injuries || []).join(", ")}
              onChange={e => setProfile(p => ({ ...p, injuries: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} />
            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>Farmaci / integratori (opzionale)</label>
              <input type="text" style={inputStyle} value={profile.meds || ""} onChange={e => setProfile(p => ({ ...p, meds: e.target.value }))} />
            </div>
            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>Attrezzatura disponibile (opzionale)</label>
              <input type="text" style={inputStyle} placeholder="es. tapis roulant, manubri 10kg, palestra"
                value={(profile.equipment || []).join(", ")}
                onChange={e => setProfile(p => ({ ...p, equipment: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} />
            </div>
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

      {step === "disclaimer" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 4 · Sicurezza</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Regole di sicurezza</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>Il coach si basa su queste regole per ogni consiglio. Leggile bene.</p>
          </div>

          <div style={cardStyle}>
            <ul style={{ paddingLeft: "18px", lineHeight: 1.7, color: "#E2E8F0", fontSize: "14px", margin: 0 }}>
              <li><b>Non sostituisce</b> medico, fisioterapista o preparatore. Dubbi clinici → specialista.</li>
              <li><b>Dolore polpaccio ≥ 3</b> (scala 0-4+) = <b>stop immediato</b>, consulta uno specialista.</li>
              <li><b>Progressione volume max +10% a settimana</b>. Nessuna scorciatoia.</li>
              <li><b>Almeno 2 giorni di riposo</b> o recovery a settimana.</li>
              <li>Combo <b>sonno ≤6h + stanchezza ≥8/10 per 2 giorni</b> = deload obbligatorio.</li>
              <li>Il coach può sbagliare. <b>La decisione finale è sempre tua</b>.</li>
            </ul>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep("goals")} style={ghostBtn}>← Indietro</button>
            <button onClick={() => setStep("plan")} style={{ ...primaryBtn, flex: 1 }}>Ho capito →</button>
          </div>
        </div>
      )}

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
