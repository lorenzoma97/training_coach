import { useState, useEffect, useMemo, useRef, useId } from "react";
import { setJSON, getJSON } from "../lib/storage";
import type { UserProfile, UserGoal, TrainingPlan, FeasibilityCheck, Experience } from "../lib/types";
import { hasApiKey } from "../lib/gemini";
import { ADAPTERS, getLLMConfig, setLLMConfig, type LLMConfig, type LLMModel, type ProviderId } from "../lib/llm";

// Flag UI: vedi src/pages/SettingsPage.tsx per il pattern. Riabilitazione
// multi-provider richiede flip in entrambi i file.
const MULTI_PROVIDER_UI = false;
import { checkGoalFeasibility } from "../lib/coach/feasibility";
import { generateInitialPlan } from "../lib/coach/planGenerator";
import { events } from "../lib/events";
import { translateGeminiError } from "../lib/geminiErrors";
import StepStrength1RM, { EMPTY_1RM_DRAFT, type Step1RMDraft } from "../components/onboarding/StepStrength1RM";
import StepRaces, { EMPTY_RACES_DRAFT, type StepRacesDraft } from "../components/onboarding/StepRaces";
import type { OneRepMax } from "../lib/types/strength";
import type { RaceEvent } from "../lib/types/periodization";

// Wave 5 fix: ProviderId include "ollama" → Record<ProviderId,...> richiede
// tutte le chiavi. Aggiungiamo entry ollama per completezza tipo (l'onboarding
// non lo offre nella UI ma il typecheck è esaustivo).
const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini (consigliato, gratis)",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  ollama: "Ollama (locale)",
};
const PROVIDER_HELP: Record<ProviderId, { url: string; label: string }> = {
  gemini: { url: "https://aistudio.google.com/apikey", label: "aistudio.google.com/apikey" },
  openai: { url: "https://platform.openai.com/api-keys", label: "platform.openai.com/api-keys" },
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "console.anthropic.com/settings/keys" },
  ollama: { url: "https://ollama.com/download", label: "ollama.com/download" },
};
const PROVIDER_PLACEHOLDER: Record<ProviderId, string> = {
  gemini: "AIza...", openai: "sk-...", anthropic: "sk-ant-...", ollama: "(non richiesta — locale)",
};

type Step = "intro" | "apiKey" | "profile" | "strength-1rm" | "races" | "goals" | "disclaimer" | "plan";
// Wave 2.2: nuovi step "strength-1rm" e "races" inseriti tra "profile" e "goals"
// (entrambi opzionali, sempre skippabili). Aggiornato anche aria-valuemax sotto.
const STEPS: Step[] = ["intro", "apiKey", "profile", "strength-1rm", "races", "goals", "disclaimer", "plan"];

interface OnboardingDraft {
  step?: Step;
  goalsCount?: 1 | 2 | 3;
  goalTexts?: string[];
  acceptedDisclaimer?: boolean;
  goalsNeedRecheck?: boolean;
  // Wave 2.2: persistenza dei due nuovi step opzionali per idempotenza F5/reload.
  strength1RMDraft?: Step1RMDraft;
  racesDraft?: StepRacesDraft;
  // ISO timestamp ultimo salvataggio — usato per scartare draft più vecchi di 30 giorni.
  savedAt?: string;
}

// Soglia in ms oltre la quale un draft viene considerato stantio e scartato (30 giorni).
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
  background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
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
  // Prefisso stabile per id dei campi (a11y: label htmlFor).
  const uidBase = useId();
  const fid = (name: string) => `${uidBase}-${name}`;

  const [step, setStep] = useState<Step>("intro");
  const [goalsNeedRecheck, setGoalsNeedRecheck] = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const draftLoadedRef = useRef(false);
  // Draft in attesa di essere ripreso/ricominciato. Se != null, mostra banner in testa.
  const [pendingDraft, setPendingDraft] = useState<OnboardingDraft | null>(null);

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
        const days = existing.weekly_availability?.days;
        setDaysRaw(days != null ? String(days) : "");
        const hrs = existing.weekly_availability?.hoursPerSession ?? 1;
        const hInt = Math.floor(hrs);
        const mInt = Math.round((hrs - hInt) * 60);
        setSessionHours(String(hInt));
        setSessionMinutes(String(mInt));
        // Wave 2.2 — Backward compat: se profile ha già oneRepMaxes/races
        // (utente sta riprendendo dopo aver completato gli step opzionali una
        // prima volta), pre-popola i draft per non far perdere il lavoro.
        if (existing.oneRepMaxes && existing.oneRepMaxes.length > 0) {
          setStrength1RMDraft({
            entries: existing.oneRepMaxes.map(o => ({
              exerciseId: o.exerciseId,
              valueKg: String(o.value_kg),
              source: o.source,
              acquiredAt: o.acquiredAt,
            })),
          });
        }
        if (existing.races && existing.races.length > 0) {
          setRacesDraft({
            form: { ...EMPTY_RACES_DRAFT.form },
            races: existing.races,
          });
        }
      }
      // Carica goal già accettati
      const existingGoals = await getJSON<UserGoal[]>("user-goals", []);
      if (existingGoals.length) setGoals(existingGoals);
      // Ripristina draft: se presente e recente (<=30gg) lo espone come banner "Riprendi?".
      // Se più vecchio, lo scarta silenziosamente così l'onboarding parte pulito.
      const draft = await getJSON<OnboardingDraft | null>("onboarding-draft", null);
      if (draft) {
        const savedAtMs = draft.savedAt ? new Date(draft.savedAt).getTime() : 0;
        const isStale = savedAtMs > 0 && (Date.now() - savedAtMs) > DRAFT_MAX_AGE_MS;
        const hasContent = !!(draft.step && draft.step !== "intro")
          || !!(draft.goalTexts && draft.goalTexts.some(t => t && t.trim()))
          || !!draft.acceptedDisclaimer;
        if (isStale) {
          try { await setJSON("onboarding-draft", null); } catch { /* ignore */ }
        } else if (hasContent) {
          setPendingDraft(draft);
        }
      }
      draftLoadedRef.current = true;
    })();
  }, []);

  // Applica il draft in stato e nasconde il banner
  const resumeDraft = () => {
    const draft = pendingDraft;
    if (!draft) return;
    if (draft.step && STEPS.includes(draft.step)) setStep(draft.step);
    if (draft.goalsCount) setGoalsCount(draft.goalsCount);
    if (Array.isArray(draft.goalTexts) && draft.goalTexts.length === 3) setGoalTexts(draft.goalTexts);
    if (draft.acceptedDisclaimer) setAcceptedDisclaimer(true);
    if (draft.goalsNeedRecheck) setGoalsNeedRecheck(true);
    if (draft.strength1RMDraft && Array.isArray(draft.strength1RMDraft.entries)) {
      setStrength1RMDraft(draft.strength1RMDraft);
    }
    if (draft.racesDraft && Array.isArray(draft.racesDraft.races)) {
      setRacesDraft(draft.racesDraft);
    }
    setPendingDraft(null);
  };

  // Cancella il draft dallo storage e riparte da intro
  const discardDraft = async () => {
    try { await setJSON("onboarding-draft", null); } catch { /* ignore */ }
    setPendingDraft(null);
  };

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
    // Retry network: 3 tentativi con backoff lineare 1s/2s. Risolve fail
    // intermittenti su rete instabile (mobile data, 4G→5G handoff). Non
    // ritenta su errori "veri" (401/403/quota), solo errori di trasporto.
    const isTransient = (msg: string): boolean => {
      const m = msg.toLowerCase();
      return /network|fetch failed|timeout|econn|abort|503|502|504/.test(m);
    };
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await setLLMConfig(config);
        const r = await adapter.ping(config.apiKey, config.modelId);
        if (r.ok) {
          setKeyOk(true);
          setKeyError("");
          setTestingKey(false);
          return;
        }
        lastError = r.error || "Errore";
        if (!isTransient(lastError)) break; // errore "vero" → no retry
      } catch (e: any) {
        lastError = e?.message || String(e);
        if (lastError && !isTransient(lastError)) break;
      }
      // Backoff prima del prossimo tentativo (1s, 2s)
      if (attempt < 2) await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
    }
    setKeyOk(false);
    setKeyError(translateGeminiError(lastError || "Errore sconosciuto"));
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

  // Disponibilità settimanale: giorni come raw string (permette campo vuoto),
  // ore + minuti selezionabili separatamente.
  const [daysRaw, setDaysRaw] = useState("");
  const [sessionHours, setSessionHours] = useState("1");
  const [sessionMinutes, setSessionMinutes] = useState("0");

  const parseCSV = (s: string): string[] =>
    s.split(",").map(x => x.trim()).filter(Boolean);

  const [goals, setGoals] = useState<UserGoal[]>([]);
  // Batch goals: l'utente sceglie quanti (1-3) e compila ciascuno separatamente.
  // Il coach verifica tutti in parallelo e mostra una card proposta per ogni obiettivo.
  const [goalsCount, setGoalsCount] = useState<1 | 2 | 3>(1);
  const [goalTexts, setGoalTexts] = useState<string[]>(["", "", ""]);
  const [pendingChecks, setPendingChecks] = useState<Array<FeasibilityCheck | null>>([null, null, null]);
  const [checkErrors, setCheckErrors] = useState<string[]>(["", "", ""]);
  const [checkingAny, setCheckingAny] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [planError, setPlanError] = useState("");

  // Wave 2.2 — Draft per gli step opzionali "strength-1rm" e "races". Persistiti
  // in `onboarding-draft` insieme agli altri campi per idempotenza F5/reload.
  // Inizializzazione lazy (vedi useEffect più sotto) per riprendere dai dati
  // già su `user-profile.oneRepMaxes/races` se l'utente sta riprendendo.
  const [strength1RMDraft, setStrength1RMDraft] = useState<Step1RMDraft>(EMPTY_1RM_DRAFT);
  const [racesDraft, setRacesDraft] = useState<StepRacesDraft>(EMPTY_RACES_DRAFT);

  // Persistenza draft: salva ad ogni cambio di step/goalTexts/goalsCount/acceptedDisclaimer/goalsNeedRecheck.
  // Non partire prima del caricamento iniziale per evitare di sovrascrivere il draft esistente.
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    // Non sovrascrivere il draft mentre il banner di resume è ancora in attesa di risposta utente.
    if (pendingDraft) return;
    const draft: OnboardingDraft = {
      step,
      goalsCount,
      goalTexts,
      acceptedDisclaimer,
      goalsNeedRecheck,
      strength1RMDraft,
      racesDraft,
      savedAt: new Date().toISOString(),
    };
    setJSON("onboarding-draft", draft).catch(() => { /* ignore quota here, non-critical */ });
  }, [step, goalsCount, goalTexts, acceptedDisclaimer, goalsNeedRecheck, strength1RMDraft, racesDraft, pendingDraft]);

  const parseNum = (v: string): number | undefined => {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  // Validazione range realistici. Età 10-100 (minori non sono target; >100 è dato errato).
  // Peso 25-300 kg, altezza 100-250 cm: coprono la popolazione adulta senza bypass tastiera.
  // Giorni disponibili 1-7 (già enforced). Ore/sessione <= 4.
  const profileValidationError = (() => {
    if (!profile.age || profile.age < 10) return "Età minima 10 anni.";
    if (profile.age > 100) return "Età massima 100 anni.";
    if (!profile.weight_kg || profile.weight_kg < 25) return "Peso minimo 25 kg.";
    if (profile.weight_kg > 300) return "Peso massimo 300 kg.";
    if (!profile.height_cm || profile.height_cm < 100) return "Altezza minima 100 cm.";
    if (profile.height_cm > 250) return "Altezza massima 250 cm.";
    if (!profile.experience) return "Seleziona un livello di esperienza.";
    const daysN = parseInt(daysRaw, 10);
    if (!daysN || daysN < 1 || daysN > 7) return "Indica giorni/settimana tra 1 e 7.";
    return null;
  })();
  const canProceedProfile = profileValidationError === null;

  const saveProfileAndNext = async () => {
    const now = new Date().toISOString();
    // Parse dei raw input CSV. Se l'utente ha svuotato volutamente il campo (raw === ""),
    // rispetta la sua scelta: NON ripristinare il valore precedente.
    const injuriesFinal = parseCSV(injuriesRaw);
    const equipmentFinal = parseCSV(equipmentRaw);
    const painAreasFinal = parseCSV(painAreasRaw);

    // Disponibilità: giorni raw + ore/minuti → weekly_availability
    const daysFinal = Math.max(1, Math.min(7, parseInt(daysRaw, 10) || 3));
    const hrsInt = Math.max(0, Math.min(4, parseInt(sessionHours, 10) || 0));
    const minsInt = Math.max(0, Math.min(59, parseInt(sessionMinutes, 10) || 0));
    const hoursPerSessionFinal = hrsInt + minsInt / 60 || 1;

    const menstrualFinal: UserProfile["menstrualCycle"] =
      profile.sex === "f" ? profile.menstrualCycle : undefined;

    // Rileva modifiche rilevanti vs. profilo salvato → invalida i goal esistenti.
    const prev = await getJSON<UserProfile | null>("user-profile", null);
    const relevantChanged = prev ? (
      prev.age !== profile.age ||
      prev.sex !== profile.sex ||
      prev.experience !== profile.experience ||
      JSON.stringify(prev.injuries || []) !== JSON.stringify(injuriesFinal) ||
      JSON.stringify(prev.painTrackingAreas || []) !== JSON.stringify(painAreasFinal) ||
      prev.weekly_availability?.days !== daysFinal
    ) : false;

    const full: UserProfile = {
      age: profile.age!, sex: profile.sex!, weight_kg: profile.weight_kg!, height_cm: profile.height_cm!,
      experience: profile.experience!, injuries: injuriesFinal, meds: profile.meds || "",
      weekly_availability: { days: daysFinal, hoursPerSession: hoursPerSessionFinal },
      equipment: equipmentFinal, notes: profile.notes,
      painTrackingAreas: painAreasFinal,
      menstrualCycle: menstrualFinal,
      createdAt: prev?.createdAt ?? now, updatedAt: now,
    };
    await setJSON("user-profile", full);
    events.emit("profile:updated", { at: now });
    if (relevantChanged && goals.length > 0) {
      setGoalsNeedRecheck(true);
    }
    // Wave 2.2: dopo il profilo, mostriamo gli step opzionali 1RM → races prima
    // dei goal. Sono entrambi skippabili.
    setStep("strength-1rm");
  };

  // Wave 2.2 — Save handlers per i due nuovi step opzionali. Idempotenti.
  // Salvano sul `user-profile` esistente (oneRepMaxes / races sono campi
  // optional di UserProfile estesi in Wave 2.1).
  const saveStrength1RMAndNext = async (oneRepMaxes: OneRepMax[]) => {
    const now = new Date().toISOString();
    const prev = await getJSON<UserProfile | null>("user-profile", null);
    if (prev) {
      const next: UserProfile = { ...prev, oneRepMaxes, updatedAt: now };
      await setJSON("user-profile", next);
      events.emit("profile:updated", { at: now });
    }
    setStep("races");
  };

  const skipStrength1RM = () => {
    setStep("races");
  };

  const saveRacesAndNext = async (races: RaceEvent[]) => {
    const now = new Date().toISOString();
    const prev = await getJSON<UserProfile | null>("user-profile", null);
    if (prev) {
      const next: UserProfile = { ...prev, races, updatedAt: now };
      await setJSON("user-profile", next);
      events.emit("profile:updated", { at: now });
    }
    setStep("goals");
  };

  const skipRaces = () => {
    setStep("goals");
  };

  const feasibilityReqIdRef = useRef(0);

  const runFeasibilityBatch = async () => {
    // Raccoglie gli indici degli obiettivi compilati (fino a goalsCount)
    const idxToRun: number[] = [];
    for (let i = 0; i < goalsCount; i++) {
      if (goalTexts[i] && goalTexts[i].trim()) idxToRun.push(i);
    }
    if (!idxToRun.length) return;

    const myReqId = ++feasibilityReqIdRef.current;
    setCheckingAny(true);
    // Reset errori ma mantieni vecchie risposte finché non arrivano le nuove
    setCheckErrors(prev => prev.map((_, i) => idxToRun.includes(i) ? "" : prev[i]));

    try {
      const savedProfile = await getJSON<UserProfile | null>("user-profile", null);
      if (!savedProfile) throw new Error("Profilo mancante");

      // Verifica tutti i goal in parallelo. Se uno fallisce, altri proseguono.
      const results = await Promise.allSettled(
        idxToRun.map(i => checkGoalFeasibility(savedProfile, goalTexts[i].trim()))
      );

      if (myReqId !== feasibilityReqIdRef.current) return;

      setPendingChecks(prev => {
        const next = [...prev];
        results.forEach((r, k) => {
          const i = idxToRun[k];
          next[i] = r.status === "fulfilled" ? r.value : null;
        });
        return next;
      });
      setCheckErrors(prev => {
        const next = [...prev];
        results.forEach((r, k) => {
          const i = idxToRun[k];
          next[i] = r.status === "rejected" ? translateGeminiError((r as any).reason) : "";
        });
        return next;
      });
    } catch (e: any) {
      if (myReqId !== feasibilityReqIdRef.current) return;
      const msg = translateGeminiError(e);
      setCheckErrors(prev => prev.map((v, i) => idxToRun.includes(i) ? msg : v));
    }
    if (myReqId === feasibilityReqIdRef.current) setCheckingAny(false);
  };

  // Helper condiviso: crea un goal a partire da descrizione/kpi/reasoning forniti
  const addGoalAndClearSlot = (idx: number, original: string, smart: string, kpi: UserGoal["kpi"], realistic: boolean, reasoning: string) => {
    const goal: UserGoal = {
      id: Date.now().toString(36) + "-" + idx,
      originalDescription: original,
      smartDescription: smart,
      kpi,
      realistic,
      coachReasoning: reasoning,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    setGoals(g => [...g, goal]);
    setGoalTexts(prev => prev.map((v, i) => i === idx ? "" : v));
    setPendingChecks(prev => prev.map((v, i) => i === idx ? null : v));
    setCheckErrors(prev => prev.map((v, i) => i === idx ? "" : v));
    const remaining = goalTexts.filter((t, i) => i !== idx && t.trim()).length;
    const needed = Math.max(1, remaining);
    if (needed < goalsCount) setGoalsCount(needed as 1 | 2 | 3);
  };

  const acceptProposalAt = (idx: number) => {
    const check = pendingChecks[idx];
    if (!check) return;
    addGoalAndClearSlot(
      idx,
      goalTexts[idx].trim(),
      check.counterProposal.description,
      check.counterProposal.kpi,
      check.realistic,
      check.reasoning,
    );
  };

  // Accetta l'obiettivo ORIGINALE dell'utente ignorando la controproposta del coach.
  // Utile quando l'utente vuole fare uno sforzo extra / target ambizioso consapevolmente.
  const keepOriginalAt = (idx: number) => {
    const check = pendingChecks[idx];
    const original = goalTexts[idx].trim();
    if (!original) return;
    if (!check?.realistic) {
      if (!confirm(
        `Il coach consiglia una versione meno ambiziosa. Se vuoi comunque tenere '${original}', il piano sarà dimensionato sul tuo target originale.\n\nATTENZIONE: accetti il rischio di un carico superiore a quello raccomandato. Procedere?`
      )) return;
    }
    addGoalAndClearSlot(
      idx,
      original,
      original, // originale diventa la versione "definitiva"
      check?.counterProposal.kpi ?? { metric: "obiettivo utente", target: "—", deadline: "—" },
      false, // segnala nel dato che non è stato "validato realistic" dal coach
      check ? `Utente ha scelto di mantenere il goal originale, preferendo un carico più ambizioso. Ragionamento originale del coach: ${check.reasoning}` : "Utente ha scelto il goal originale senza verifica coach.",
    );
  };

  const discardProposalAt = (idx: number) => {
    setPendingChecks(prev => prev.map((v, i) => i === idx ? null : v));
    setCheckErrors(prev => prev.map((v, i) => i === idx ? "" : v));
  };

  const editExistingGoal = (g: UserGoal) => {
    // Rimette il goal già accettato come testo modificabile nel primo slot vuoto
    const emptyIdx = goalTexts.findIndex(t => !t.trim());
    const targetIdx = emptyIdx >= 0 ? emptyIdx : 0;
    setGoalTexts(prev => prev.map((v, i) => i === targetIdx ? g.originalDescription : v));
    setPendingChecks(prev => prev.map((v, i) => i === targetIdx ? null : v));
    setGoals(gs => gs.filter(x => x.id !== g.id));
    if (targetIdx + 1 > goalsCount) setGoalsCount((targetIdx + 1) as 1 | 2 | 3);
  };

  const saveGoalsAndNext = async () => {
    // Warning UX se nessun obiettivo definito: il piano generato è generico
    // ("base aerobica + forza funzionale") senza target specifici. L'utente
    // beneficia molto di più con almeno 1 goal — confirm prima di procedere.
    if (goals.length === 0) {
      const ok = confirm(
        "Non hai definito alcun obiettivo. Il coach genererà un piano generico " +
        "(base aerobica + forza funzionale) senza target specifici.\n\n" +
        "Vuoi continuare lo stesso? Potrai aggiungere obiettivi più tardi da Coach → Obiettivi."
      );
      if (!ok) return;
    }
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

  // Guard contro double-call cross-tab/double-click: se 2 tab eseguono finish()
  // in parallelo, il secondo deve essere idempotente. useRef per evitare race
  // anche all'interno della stessa tab (doppio click su Continua).
  const finishingRef = useRef(false);
  const finish = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      // Re-check storage prima di scrivere: se un'altra tab ha già completato,
      // skippa il setJSON ridondante (evita storage event chain).
      const already = await getJSON<boolean>("onboarding-completed", false);
      if (!already) {
        await setJSON("onboarding-completed", true);
      }
      try { await setJSON("onboarding-draft", null); } catch { /* ignore */ }
      onDone();
    } finally {
      // NON resettiamo finishingRef: dopo onDone() il componente si smonta;
      // se per qualche motivo non si smonta (test/dev), un secondo finish è
      // comunque NoOp grazie alla check `already`.
    }
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px 20px 120px" }}>
      <div
        style={{ display: "flex", gap: "4px", marginBottom: "20px" }}
        role="progressbar"
        aria-label={`Progresso setup: step ${stepIndex + 1} di ${STEPS.length}`}
        aria-valuenow={stepIndex + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
      >
        {STEPS.map((s, i) => (
          <div key={s} style={{
            flex: 1, height: "4px", borderRadius: "2px",
            background: step === s ? "#6366F1" : stepIndex > i ? "#6366F188" : "#1A1A2E",
          }} />
        ))}
      </div>

      {pendingDraft && (
        <div role="region" aria-label="Riprendi onboarding" style={{
          ...cardStyle, marginBottom: "16px",
          border: "1px solid #F59E0B66", background: "#F59E0B15",
        }}>
          <div style={{ fontWeight: 700, color: "#F59E0B", marginBottom: "6px" }}>
            Riprendi onboarding da dove l'hai lasciato?
          </div>
          <div style={{ fontSize: "13px", color: "#CBD5E1", marginBottom: "12px", lineHeight: 1.5 }}>
            Abbiamo trovato un setup incompleto salvato in precedenza. Puoi riprenderlo o ricominciare da zero (i dati del draft verranno cancellati).
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button onClick={resumeDraft} style={{ ...primaryBtn, flex: "1 1 140px", padding: "10px", fontSize: "14px" }}>Riprendi</button>
            <button onClick={discardDraft} style={{ ...ghostBtn, flex: "1 1 140px" }}>Ricomincia da zero</button>
          </div>
        </div>
      )}

      {step === "intro" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#6366F1", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Benvenuto</div>
            <h2 style={{ fontSize: "28px", fontWeight: 900, margin: "6px 0 8px", letterSpacing: "-0.03em" }}>Diario & Coach</h2>
            <p style={{ color: "#94A3B8", fontSize: "15px", margin: 0, lineHeight: 1.5 }}>
              Traccia i tuoi allenamenti, ricevi un coach AI che ti guida. In pochi step definiamo provider AI, profilo, obiettivi, regole di sicurezza e primo piano.
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
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#6366F1", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 1 · Coach AI</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Configura il coach AI</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0, lineHeight: 1.5 }}>
              Il coach usa <b>Google Gemini</b> (gratis con tua chiave API). La chiave resta sul tuo dispositivo.
            </p>
          </div>

          <div style={cardStyle}>
            {MULTI_PROVIDER_UI ? (
              <>
                <label htmlFor={fid("provider")} style={labelStyle}>Provider LLM</label>
                <select id={fid("provider")} style={{ ...inputStyle, fontFamily: "inherit" }} value={provider} onChange={e => onProviderChange(e.target.value as ProviderId)}>
                  {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map(p => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                  ))}
                </select>
                {provider === "anthropic" && (
                  <div role="note" style={{
                    marginTop: "10px", padding: "10px 12px",
                    background: "#78350F25", border: "1px solid #F59E0B66",
                    borderRadius: "8px", fontSize: "12px", color: "#FDE68A", lineHeight: 1.5,
                  }}>
                    ⚠ Anthropic non fornisce embeddings nativi: la knowledge base scientifica (RAG) sarà <b>disabilitata</b> con questo provider. Per le risposte del coach, considera Gemini o OpenAI.
                  </div>
                )}
              </>
            ) : null}

            <div style={{ marginTop: MULTI_PROVIDER_UI ? "12px" : "0", fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 }}>
              Ottieni la chiave gratis su <a href={PROVIDER_HELP[provider].url} target="_blank" rel="noreferrer" style={{ color: "#6366F1" }}>{PROVIDER_HELP[provider].label}</a>
            </div>

            <div style={{ marginTop: "12px" }}>
              <label htmlFor={fid("apiKey")} style={labelStyle}>
                Chiave API <span style={{ color: "#6366F1" }} aria-label="obbligatoria">*</span>
              </label>
              <input id={fid("apiKey")} type="password" style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
                value={apiKeyInput}
                onChange={e => { setApiKeyInput(e.target.value); setKeyOk(null); setModels([]); }}
                placeholder={PROVIDER_PLACEHOLDER[provider]} autoComplete="off"
                aria-invalid={keyOk === false ? true : undefined}
                aria-describedby={keyOk === false ? fid("error-apiKey") : undefined}
              />
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
                <label htmlFor={fid("model")} style={labelStyle}>Modello</label>
                <select id={fid("model")} style={{ ...inputStyle, fontFamily: "inherit" }} value={modelId} onChange={e => { setModelId(e.target.value); setKeyOk(null); }}>
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
              <div id={fid("error-apiKey")} role="alert" style={{ marginTop: "10px", fontSize: "13px", color: "#EF4444" }}>{keyError}</div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep("intro")} style={ghostBtn}>← Indietro</button>
            <button onClick={() => setStep("profile")} disabled={!keyOk} style={{
              ...primaryBtn, flex: 1, opacity: keyOk ? 1 : 0.5,
              cursor: keyOk ? "pointer" : "not-allowed",
            }}>Continua →</button>
          </div>
          <button
            onClick={() => setStep("profile")}
            title="Puoi configurare il coach AI in qualsiasi momento da Impostazioni"
            style={{
              ...ghostBtn, alignSelf: "center", fontSize: "12px",
              color: "#94A3B8", background: "transparent",
              border: "1px dashed rgba(148, 163, 184, 0.3)",
            }}
          >Salta per ora — userò solo il diario</button>
        </div>
      )}

      {step === "profile" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#6366F1", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 2 · Profilo</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Chi sei</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>Mi servono alcuni dati per costruire un piano realistico. I campi con <span style={{ color: "#6366F1" }}>*</span> sono obbligatori.</p>
          </div>

          <div style={cardStyle}>
            {(() => {
              // Per associare aria-describedby in modo granulare, calcoliamo errori per ciascun campo.
              // Riusa i limiti di profileValidationError ma mirato sul singolo input.
              const ageErr = profile.age == null ? null : (profile.age < 10 ? "Età minima 10 anni." : profile.age > 100 ? "Età massima 100 anni." : null);
              const weightErr = profile.weight_kg == null ? null : (profile.weight_kg < 25 ? "Peso minimo 25 kg." : profile.weight_kg > 300 ? "Peso massimo 300 kg." : null);
              const heightErr = profile.height_cm == null ? null : (profile.height_cm < 100 ? "Altezza minima 100 cm." : profile.height_cm > 250 ? "Altezza massima 250 cm." : null);
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div>
                    <label htmlFor={fid("age")} style={labelStyle}>Età <span style={{ color: "#6366F1" }} aria-label="obbligatorio">*</span></label>
                    <input id={fid("age")} type="number" min={10} max={100} style={inputStyle} value={profile.age ?? ""}
                      onChange={e => setProfile(p => ({ ...p, age: parseNum(e.target.value) }))}
                      aria-invalid={ageErr ? true : undefined}
                      aria-describedby={ageErr ? fid("error-age") : undefined} />
                    {ageErr && <div id={fid("error-age")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{ageErr}</div>}
                  </div>
                  <div>
                    <label htmlFor={fid("sex")} style={labelStyle}>Sesso</label>
                    <select id={fid("sex")} style={inputStyle} value={profile.sex} onChange={e => setProfile(p => ({ ...p, sex: e.target.value as any }))}>
                      <option value="m">Maschile</option>
                      <option value="f">Femminile</option>
                      <option value="other">Altro / Preferisco non dirlo</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={fid("weight")} style={labelStyle}>Peso (kg) <span style={{ color: "#6366F1" }} aria-label="obbligatorio">*</span></label>
                    <input id={fid("weight")} type="number" step="0.1" style={inputStyle} value={profile.weight_kg ?? ""}
                      onChange={e => setProfile(p => ({ ...p, weight_kg: parseNum(e.target.value) }))}
                      aria-invalid={weightErr ? true : undefined}
                      aria-describedby={weightErr ? fid("error-weight") : undefined} />
                    {weightErr && <div id={fid("error-weight")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{weightErr}</div>}
                  </div>
                  <div>
                    <label htmlFor={fid("height")} style={labelStyle}>Altezza (cm) <span style={{ color: "#6366F1" }} aria-label="obbligatorio">*</span></label>
                    <input id={fid("height")} type="number" style={inputStyle} value={profile.height_cm ?? ""}
                      onChange={e => setProfile(p => ({ ...p, height_cm: parseNum(e.target.value) }))}
                      aria-invalid={heightErr ? true : undefined}
                      aria-describedby={heightErr ? fid("error-height") : undefined} />
                    {heightErr && <div id={fid("error-height")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{heightErr}</div>}
                  </div>
                </div>
              );
            })()}
          </div>

          {profile.sex === "f" && (
            <div style={cardStyle}>
              <label style={labelStyle}>Tracking ciclo mestruale (opzionale)</label>
              <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "10px", lineHeight: 1.5 }}>
                Attivare permette al coach di rilevare amenorrea persistente (red flag RED-S, Mountjoy IOC 2023) dal diario daily. I sintomi vengono tracciati nel check giornaliero.
              </div>
              {/* 2026-05-18 data cleanup: rimossi contraception, lastPeriodStart,
                  avgCycleLengthDays — raccolti ma mai usati. Solo `enabled` ha
                  consumer effettivo (RED-S detection via amenorrhea). Profili
                  esistenti con valori restano backward-compat (campi extra ignorati). */}
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "#CBD5E1" }}>
                <input
                  type="checkbox"
                  checked={!!profile.menstrualCycle?.enabled}
                  onChange={e => setProfile(p => ({
                    ...p,
                    menstrualCycle: { enabled: e.target.checked },
                  }))}
                />
                Traccia ciclo mestruale (RED-S detection)
              </label>
            </div>
          )}

          <div style={cardStyle}>
            <label style={labelStyle}>Livello di esperienza</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {EXP_OPTIONS.map(o => (
                <button key={o.v} onClick={() => setProfile(p => ({ ...p, experience: o.v }))} style={{
                  textAlign: "left", padding: "12px 14px",
                  background: profile.experience === o.v ? "#6366F122" : "#1A1A2E",
                  border: profile.experience === o.v ? "1px solid #6366F1" : "1px solid rgba(255,255,255,0.06)",
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Giorni/sett</div>
                <input
                  type="number" min={1} max={7} style={inputStyle}
                  value={daysRaw}
                  onChange={e => setDaysRaw(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="es. 3"
                />
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Ore/sessione</div>
                <select value={sessionHours} onChange={e => setSessionHours(e.target.value)} style={{ ...inputStyle, fontFamily: "inherit" }}>
                  <option value="0">0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>Minuti</div>
                <select value={sessionMinutes} onChange={e => setSessionMinutes(e.target.value)} style={{ ...inputStyle, fontFamily: "inherit" }}>
                  <option value="0">0</option>
                  <option value="15">15</option>
                  <option value="30">30</option>
                  <option value="45">45</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: "11px", color: "#64748B", marginTop: "6px" }}>
              Durata tipica di una tua sessione (es. 1h 30min). Serve al coach per dimensionare il piano.
            </div>
          </div>

          <div style={cardStyle}>
            <label htmlFor="ob-injuries" style={labelStyle}>Infortuni o condizioni (opzionale)</label>
            <input id="ob-injuries" type="text" style={inputStyle} placeholder="es. tendinopatia rotulea, ernia L5"
              value={injuriesRaw}
              onChange={e => setInjuriesRaw(e.target.value)}
              onBlur={e => setProfile(p => ({ ...p, injuries: parseCSV(e.target.value) }))} />
            <div style={{ marginTop: "12px" }}>
              <label htmlFor="ob-meds" style={labelStyle}>Farmaci / integratori (opzionale)</label>
              <input id="ob-meds" type="text" style={inputStyle} value={profile.meds || ""} onChange={e => setProfile(p => ({ ...p, meds: e.target.value }))} />
            </div>
            <div style={{ marginTop: "12px" }}>
              <label htmlFor="ob-equipment" style={labelStyle}>Attrezzatura disponibile (opzionale)</label>
              <input id="ob-equipment" type="text" style={inputStyle} placeholder="es. tapis roulant, manubri 10kg, palestra"
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
                <input type="text" style={inputStyle} placeholder="es. ginocchio dx, schiena lombare, spalla"
                  value={painAreasRaw}
                  onChange={e => setPainAreasRaw(e.target.value)}
                  onBlur={e => setProfile(p => ({ ...p, painTrackingAreas: parseCSV(e.target.value) }))} />
              </div>
            )}
          </div>

          {profileValidationError && (
            <div style={{ fontSize: "13px", color: "#F59E0B", padding: "10px 12px", background: "#F59E0B15", borderRadius: "8px", border: "1px solid #F59E0B33" }}>
              {profileValidationError}
            </div>
          )}

          <button disabled={!canProceedProfile} onClick={saveProfileAndNext} style={{ ...primaryBtn, opacity: canProceedProfile ? 1 : 0.5, cursor: canProceedProfile ? "pointer" : "not-allowed" }}>
            Continua →
          </button>
        </div>
      )}

      {step === "strength-1rm" && (
        <StepStrength1RM
          draft={strength1RMDraft}
          onDraftChange={setStrength1RMDraft}
          onSave={saveStrength1RMAndNext}
          onSkip={skipStrength1RM}
          onBack={() => setStep("profile")}
        />
      )}

      {step === "races" && (
        <StepRaces
          draft={racesDraft}
          onDraftChange={setRacesDraft}
          onSave={saveRacesAndNext}
          onSkip={skipRaces}
          onBack={() => setStep("strength-1rm")}
        />
      )}

      {step === "goals" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#6366F1", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 5 · Obiettivi</div>
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

          {goalsNeedRecheck && goals.length > 0 && (
            <div style={{ ...cardStyle, border: "1px solid #F59E0B66", background: "#F59E0B15" }}>
              <div style={{ fontWeight: 700, marginBottom: "6px", color: "#F59E0B" }}>⚠ Profilo modificato dopo la verifica obiettivi</div>
              <div style={{ fontSize: "13px", color: "#CBD5E1", marginBottom: "10px", lineHeight: 1.5 }}>
                Hai cambiato età, esperienza, infortuni o disponibilità dopo aver confermato i goal. La controproposta del coach potrebbe non essere più ottimale. Puoi ri-verificare un goal cliccando "Modifica" e "Verifica" di nuovo, oppure procedere comunque.
              </div>
              <button onClick={() => setGoalsNeedRecheck(false)} style={{ ...ghostBtn, fontSize: "13px", padding: "8px 14px" }}>Ho capito, procedo</button>
            </div>
          )}

          {/* Obiettivi già accettati */}
          {goals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {goals.map((g, i) => (
                <div key={g.id} style={{ ...cardStyle, borderLeft: "3px solid #22C55E" }}>
                  <div style={{ fontSize: "11px", color: "#22C55E", marginBottom: "4px", fontWeight: 700, letterSpacing: "0.08em" }}>✓ OBIETTIVO {i + 1} CONFERMATO</div>
                  <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "6px" }}>{g.smartDescription}</div>
                  <div style={{ fontSize: "13px", color: "#94A3B8" }}>KPI: <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E2E8F0" }}>{g.kpi.metric} {g.kpi.target}</span> entro {g.kpi.deadline}</div>
                  {g.originalDescription !== g.smartDescription && (
                    <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px", fontStyle: "italic" }}>
                      Originale: "{g.originalDescription}"
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                    <button onClick={() => editExistingGoal(g)} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px" }}>Modifica</button>
                    <button onClick={() => setGoals(gs => gs.filter(x => x.id !== g.id))} style={{ ...ghostBtn, padding: "6px 12px", fontSize: "12px", borderColor: "#EF444444", color: "#EF4444" }}>Rimuovi</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {goals.length >= 3 && (
            <div style={{ ...cardStyle, background: "#1A1A2E", fontSize: "13px", color: "#94A3B8" }}>
              Hai raggiunto il massimo di 3 obiettivi. Rimuovine uno per aggiungerne un altro.
            </div>
          )}

          {goals.length < 3 && (
            <div style={cardStyle}>
              <label style={labelStyle}>Quanti obiettivi vuoi aggiungere?</label>
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                {([1, 2, 3] as const).filter(n => n <= 3 - goals.length).map(n => {
                  const tryChangeCount = () => {
                    // Se stiamo RIDUCENDO e ci sono testi compilati negli slot che scomparirebbero,
                    // chiedi conferma invece di perderli silenziosamente.
                    if (n < goalsCount) {
                      const willHideTexts = goalTexts.slice(n, goalsCount).some(t => t.trim());
                      if (willHideTexts) {
                        if (!confirm(`Stai riducendo a ${n} obiettivi. I testi che hai scritto negli altri slot verranno nascosti (ma non cancellati, tornano se rialzi il numero). Procedere?`)) return;
                      }
                    }
                    setGoalsCount(n);
                  };
                  return (
                    <button key={n} onClick={tryChangeCount} style={{
                      flex: 1, padding: "10px",
                      background: goalsCount === n ? "#6366F122" : "#1A1A2E",
                      border: goalsCount === n ? "1px solid #6366F1" : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "10px", color: goalsCount === n ? "#6366F1" : "#CBD5E1",
                      fontWeight: 700, fontSize: "14px", cursor: "pointer",
                    }}>{n}</button>
                  );
                })}
              </div>

              {Array.from({ length: goalsCount }).map((_, i) => {
                const check = pendingChecks[i];
                const err = checkErrors[i];
                return (
                  <div key={i} style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: i < goalsCount - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                    <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "6px", fontWeight: 600 }}>Obiettivo {goals.length + i + 1}</div>
                    <textarea
                      style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
                      placeholder="es. correre 10 km sotto 55 minuti entro 8 settimane"
                      value={goalTexts[i]}
                      onChange={e => setGoalTexts(prev => prev.map((v, k) => k === i ? e.target.value : v))}
                    />
                    {err && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "#EF4444", padding: "8px", background: "#7F1D1D22", borderRadius: "8px" }}>{err}</div>
                    )}
                    {check && (
                      <div style={{ marginTop: "10px", padding: "12px", borderRadius: "10px", background: "#1A1A2E", border: check.realistic ? "1px solid #22C55E66" : "1px solid #F59E0B66" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: check.realistic ? "#22C55E" : "#F59E0B", textTransform: "uppercase", marginBottom: "6px" }}>
                          {check.realistic ? "✓ Ben definito" : "Controproposta del coach"}
                        </div>
                        <div style={{ fontSize: "13px", color: "#CBD5E1", marginBottom: "10px", lineHeight: 1.5 }}>{check.reasoning}</div>
                        <div style={{ background: "#0F172A", padding: "10px 12px", borderRadius: "8px", marginBottom: "10px" }}>
                          <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "3px" }}>{check.counterProposal.description}</div>
                          <div style={{ fontSize: "12px", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>
                            {check.counterProposal.kpi.metric}: {check.counterProposal.kpi.target} — {check.counterProposal.kpi.deadline}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button onClick={() => acceptProposalAt(i)} style={{ ...primaryBtn, flex: "1 1 140px", padding: "10px", fontSize: "13px" }}>
                            {check.realistic ? "Conferma" : "Accetta proposta"}
                          </button>
                          {!check.realistic && (
                            <button
                              onClick={() => keepOriginalAt(i)}
                              title="Tieni l'obiettivo originale, accettando un carico più ambizioso di quello raccomandato"
                              style={{
                                flex: "1 1 140px", padding: "10px",
                                background: "transparent",
                                border: "1px solid #F59E0B66",
                                borderRadius: "10px",
                                color: "#F59E0B", fontWeight: 700, fontSize: "13px",
                                cursor: "pointer",
                              }}
                            >
                              💪 Tengo il mio
                            </button>
                          )}
                          <button onClick={() => discardProposalAt(i)} style={{ ...ghostBtn, flex: "1 1 100px", fontSize: "13px", padding: "8px 12px" }}>Modifica</button>
                        </div>
                        {!check.realistic && (
                          <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "8px", lineHeight: 1.4 }}>
                            <b style={{ color: "#F59E0B" }}>"Tengo il mio"</b> mantiene l'obiettivo che hai scritto. Il coach dimensionerà comunque il piano sul tuo target — accetti un carico superiore a quello raccomandato.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={runFeasibilityBatch}
                disabled={checkingAny || !hasApiKey() || !goalTexts.slice(0, goalsCount).some(t => t.trim())}
                style={{
                  ...primaryBtn, marginTop: "4px",
                  opacity: (checkingAny || !hasApiKey() || !goalTexts.slice(0, goalsCount).some(t => t.trim())) ? 0.5 : 1,
                }}
              >
                {checkingAny
                  ? <><span className="spinner" /> Verifico con il coach…</>
                  : goalsCount === 1 ? "Verifica con il coach" : `Verifica ${goalsCount} obiettivi`}
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep("races")} style={ghostBtn}>← Indietro</button>
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
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#6366F1", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 6 · Sicurezza</div>
            <h2 style={{ fontSize: "26px", fontWeight: 900, margin: "6px 0 4px", letterSpacing: "-0.03em" }}>Regole di sicurezza</h2>
            <p style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>Il coach si basa su queste regole per ogni consiglio. Leggile bene.</p>
          </div>

          <div style={cardStyle}>
            <ul style={{ paddingLeft: "18px", lineHeight: 1.7, color: "#E2E8F0", fontSize: "14px", margin: 0 }}>
              <li><b>Non sostituisce</b> medico, fisioterapista o preparatore. Dubbi clinici → specialista.</li>
              <li><b>Dolore ≥ 4</b> (a spillo, scala 0-4+) nelle zone monitorate = <b>stop immediato</b>, consulta specialista. Dolore 3 = riduci intensità. Dolore 2 = monitora trend.</li>
              <li><b>Spike singola sessione max +20%</b> vs. la più lunga recente (Johansen 2025). Cap +10%/settimana come safeguard prudenziale per neofiti.</li>
              <li><b>Almeno {isSenior ? 3 : isMidAge ? 3 : 2} giorni di riposo</b> o recovery a settimana{isSenior ? " (e max 2 giorni consecutivi di allenamento)" : ""}.</li>
              <li>Combo <b>sonno &lt;7h + stanchezza ≥8/10 per 3 giorni consecutivi</b> = deload obbligatorio (Walsh 2021).</li>
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

          <div style={{ ...cardStyle, background: "#1A1A2E", borderColor: acceptedDisclaimer ? "#22C55E66" : "rgba(255,255,255,0.06)" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "13px", lineHeight: 1.5, color: "#CBD5E1" }}>
              <input
                type="checkbox"
                checked={acceptedDisclaimer}
                onChange={e => setAcceptedDisclaimer(e.target.checked)}
                style={{ marginTop: "3px" }}
              />
              <span>
                Ho letto le regole di sicurezza, capisco che questa app <b>non è un dispositivo medico</b> e non sostituisce il parere di professionisti sanitari qualificati. Accetto di usarla come strumento di supporto sotto la mia responsabilità.
              </span>
            </label>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep("goals")} style={ghostBtn}>← Indietro</button>
            <button
              onClick={() => setStep("plan")}
              disabled={!acceptedDisclaimer}
              style={{
                ...primaryBtn, flex: 1,
                opacity: acceptedDisclaimer ? 1 : 0.5,
                cursor: acceptedDisclaimer ? "pointer" : "not-allowed",
              }}
            >
              Continua →
            </button>
          </div>
        </div>
        );
      })()}

      {step === "plan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#6366F1", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>Step 7 · Piano</div>
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
              <div style={{ ...cardStyle, borderLeft: "3px solid #6366F1" }}>
                <div style={{ fontSize: "11px", color: "#64748B", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Razionale</div>
                <div style={{ fontSize: "14px", lineHeight: 1.5 }}>{plan.rationale}</div>
              </div>
              {plan.weeks.map(w => (
                <div key={w.weekNumber} style={cardStyle}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#6366F1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>Settimana {w.weekNumber}</div>
                  <div style={{ fontSize: "14px", color: "#CBD5E1", marginBottom: "12px", fontWeight: 600 }}>{w.focus}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {w.sessions.map((s, i) => (
                      <div key={i} style={{ padding: "10px 12px", background: "#1A1A2E", borderRadius: "10px", fontSize: "13px" }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "4px" }}>
                          <span style={{ fontWeight: 700, textTransform: "uppercase", color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", minWidth: "32px" }}>{s.day}</span>
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
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <button onClick={finish} style={ghostBtn}>Salta: userò solo il diario</button>
              <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.5 }}>
                Se salti, il coach non genererà un piano ora. Potrai sempre chiederlo in un secondo momento dal tab Coach.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
