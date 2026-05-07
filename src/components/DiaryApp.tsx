import { useState, useEffect, useCallback, useId, useRef } from "react";
import { storage, getJSON, setJSON, StorageQuotaError, StorageValueTooLargeError } from "../lib/storage";
import { events } from "../lib/events";
import type { TrainingPlan, PlannedSession } from "../lib/types";
import { stripInlineHRRange } from "../lib/coach/zones";

const WORKOUT_TYPES = [
  {
    id: "corsa", icon: "🏃", label: "Corsa", color: "#E8553A",
    fields: [
      { key: "tipo", label: "Tipo Sessione", type: "select", options: ["Fondo Lento","Fartlek","Ripetute","Progressione","Test Ritmo Gara","Test Finale","Corsa Intermittente"], required: true },
      { key: "durata_totale", label: "Durata Totale", unit: "min", type: "number", required: true },
      { key: "durata_corsa", label: "Tempo Corsa Effettivo", unit: "min", type: "number" },
      { key: "passo_medio", label: "Passo Medio", unit: "min/km", type: "text", placeholder: "es. 6:30" },
      { key: "passo_frazioni", label: "Passo Frazioni Veloci", unit: "min/km", type: "text", placeholder: "es. 5:05" },
      { key: "fc_media", label: "FC Media", unit: "bpm", type: "number", required: true },
      { key: "fc_max", label: "FC Max", unit: "bpm", type: "number" },
      { key: "cadenza", label: "Cadenza", unit: "ppm", type: "number" },
      { key: "scarpe", label: "Scarpe", type: "select", options: ["Nike Pegasus","ZoomX (Sospese)","Altre"] },
      { key: "superficie", label: "Superficie", type: "select", options: ["Asfalto","Sterrato","Erba","Pista","Tapis Roulant"] },
    ],
  },
  {
    id: "forza_gambe", icon: "🦵", label: "Forza Gambe", color: "#D97706",
    fields: [
      { key: "tipo", label: "Tipo Sessione", type: "select", options: ["HIIT Gambe","Forza Esplosiva","Forza Massimale","Circuito Misto"], required: true },
      { key: "durata", label: "Durata", unit: "min", type: "number", required: true },
      { key: "fc_media", label: "FC Media", unit: "bpm", type: "number" },
      { key: "fc_max", label: "FC Max", unit: "bpm", type: "number" },
      { key: "carico", label: "Carico (peso)", unit: "kg", type: "text", placeholder: "es. 11 kg/manubrio" },
      { key: "esercizi", label: "Esercizi Principali", type: "textarea", placeholder: "Squat 4×10, Bulgari 3×8..." },
      { key: "kcal", label: "Calorie", unit: "kcal", type: "number" },
    ],
  },
  {
    id: "forza_upper", icon: "💪", label: "Upper + Core", color: "#7C3AED",
    fields: [
      { key: "tipo", label: "Tipo", type: "select", options: ["Upper Body","Core Anti-Rotazione","Upper + Core Combo"], required: true },
      { key: "durata", label: "Durata", unit: "min", type: "number", required: true },
      { key: "fc_media", label: "FC Media", unit: "bpm", type: "number" },
      { key: "carico", label: "Carico (peso)", unit: "kg", type: "text", placeholder: "es. 8 kg/manubrio" },
      { key: "esercizi", label: "Esercizi Principali", type: "textarea" },
    ],
  },
  {
    id: "sport", icon: "🎾", label: "Sport", color: "#059669",
    fields: [
      { key: "sport", label: "Sport", type: "select", options: ["Tennis","Padel","Calcio (Allenamento)","Calcio (Partita)","Altro"], required: true },
      { key: "durata", label: "Durata", unit: "min", type: "number", required: true },
      { key: "match_type", label: "Tipo", type: "select", options: ["Palleggio / Tecnica","Partita","Torneo","Recupero Attivo"] },
      { key: "fc_media", label: "FC Media", unit: "bpm", type: "number" },
      { key: "fc_max", label: "FC Max", unit: "bpm", type: "number" },
      { key: "kcal", label: "Calorie", unit: "kcal", type: "number" },
    ],
  },
  {
    id: "mobilita", icon: "🧘", label: "Mobilità / Recovery", color: "#0891B2",
    fields: [
      { key: "tipo", label: "Tipo", type: "select", options: ["Stretching Statico","Mobilità Dinamica","Propriocezione","Camminata","Foam Rolling","Piscina / Recovery"], required: true },
      { key: "durata", label: "Durata", unit: "min", type: "number", required: true },
      { key: "focus", label: "Zone Lavorate", type: "text", placeholder: "es. Anche, Polpacci, Colonna" },
    ],
  },
] as const;

type WorkoutType = typeof WORKOUT_TYPES[number];
type Field = WorkoutType["fields"][number];

const PAIN_LEVELS = [
  { v: 0, label: "0", desc: "Nessun dolore", color: "#22C55E" },
  { v: 1, label: "1", desc: "Fastidio vago", color: "#84CC16" },
  { v: 2, label: "2", desc: "Avvertibile", color: "#EAB308" },
  { v: 3, label: "3", desc: "Localizzato → riduci", color: "#F97316" },
  { v: 4, label: "4+", desc: "A spillo → STOP", color: "#EF4444" },
];

const FATIGUE_COLORS = (n: number) => n <= 3 ? "#22C55E" : n <= 6 ? "#EAB308" : n <= 8 ? "#F97316" : "#EF4444";
const today = () => {
  // Local date (not UTC) to avoid cross-midnight logging bugs (Europe/Rome UTC+1/+2).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
// Date IT in formato gg/mm/aaaa (canonical) ovunque sia mostrata data piena.
// Fmt compatto omette l'anno (badge in lista); full include l'anno (detail header).
const fmtDate = (d: string) => {
  const dt = new Date(d + "T12:00:00");
  const wd = dt.toLocaleDateString("it-IT", { weekday: "short" });
  return `${wd} ${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const fmtDateFull = (d: string) => {
  const dt = new Date(d + "T12:00:00");
  const wd = dt.toLocaleDateString("it-IT", { weekday: "long" });
  return `${wd} ${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px", background: "#1A1A2E",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
  color: "#E2E8F0", fontSize: "15px", outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};

async function loadDay(date: string): Promise<any> {
  const r = await storage.get(`day:${date}`);
  return r ? JSON.parse(r.value) : null;
}
async function saveDay(date: string, data: any) {
  // Usa setJSON (non storage.set raw) per ereditare il quota/size handling:
  // - reject preventivo se payload > 1MB (StorageValueTooLargeError)
  // - retry automatico con pruneOldData() su QuotaExceededError
  // Errori propagati ai chiamanti (handleSaveWorkout/handleSaveDaily) che
  // mostrano un toast invece di fallire silenziosamente.
  await setJSON(`day:${date}`, data);
}
async function loadIndex(): Promise<string[]> {
  const r = await storage.get("diary-index");
  return r ? JSON.parse(r.value) : [];
}
async function saveIndex(dates: string[]) {
  await setJSON("diary-index", dates);
}

// Validazione range di base per input numerici dei workout (a11y: mostra errore accessibile)
function validateFieldValue(field: Field, v: string): string | null {
  if (field.type !== "number") return null;
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return "Valore non valido.";
  // Range prudenziali per i vari campi
  const key = (field as any).key as string;
  if (key === "fc_media" || key === "fc_max") {
    if (n < 30 || n > 230) return "Valore fuori range (30-230 bpm).";
  } else if (key === "cadenza") {
    if (n < 40 || n > 240) return "Valore fuori range (40-240 ppm).";
  } else if (key === "kcal") {
    if (n < 0 || n > 10000) return "Valore fuori range (0-10000 kcal).";
  } else if (key.startsWith("durata")) {
    if (n < 0 || n > 1440) return "Valore fuori range (0-1440 min).";
  } else if (n < 0) {
    return "Valore non può essere negativo.";
  }
  return null;
}

function FieldRow({ field, value, onChange, id }: { field: Field; value: any; onChange: (v: any) => void; id: string }) {
  const v = value || "";
  const errorId = `error-${id}`;
  const err = validateFieldValue(field, String(v));
  if (field.type === "select") return (
    <select id={id} style={inputStyle} value={v} onChange={e => onChange(e.target.value)}>
      <option value="">Seleziona...</option>
      {(field as any).options.map((o: string) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  if (field.type === "textarea") return (
    <textarea id={id} style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={v} placeholder={(field as any).placeholder || ""} onChange={e => onChange(e.target.value)} rows={2} />
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input id={id} style={{ ...inputStyle, flex: 1 }} type={field.type as string} value={v} placeholder={(field as any).placeholder || ""} onChange={e => onChange(e.target.value)}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? errorId : undefined} />
        {(field as any).unit && <span style={{ fontSize: "13px", color: "#64748B", minWidth: "36px" }}>{(field as any).unit}</span>}
      </div>
      {err && (
        <div id={errorId} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{err}</div>
      )}
    </div>
  );
}

function PainPicker({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  const groupRef = useRef<HTMLDivElement>(null);
  const focusByIndex = (i: number) => {
    const n = PAIN_LEVELS.length;
    const idx = ((i % n) + n) % n;
    const btn = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[idx];
    btn?.focus();
    onChange(PAIN_LEVELS[idx].v);
  };
  const onKeyDown = (e: React.KeyboardEvent, currentIdx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusByIndex(currentIdx + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusByIndex(currentIdx - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusByIndex(0); }
    else if (e.key === "End") { e.preventDefault(); focusByIndex(PAIN_LEVELS.length - 1); }
  };
  // Se nessun valore, il primo bottone è focusable (tabIndex=0) per entrare nel gruppo
  const selectedIdx = PAIN_LEVELS.findIndex(p => p.v === value);
  const firstFocusableIdx = selectedIdx >= 0 ? selectedIdx : 0;
  return (
    <div>
      <div style={{ fontSize: "12px", color: "#CBD5E1", fontWeight: 600, marginBottom: "8px", textAlign: "center" }}>{label}</div>
      <div ref={groupRef} role="radiogroup" aria-label={`Dolore ${label}`} style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
        {PAIN_LEVELS.map((p, i) => {
          const checked = value === p.v;
          return (
            <button key={p.v} type="button" role="radio" aria-checked={checked}
              tabIndex={i === firstFocusableIdx ? 0 : -1}
              onClick={() => onChange(p.v)}
              onKeyDown={e => onKeyDown(e, i)}
              aria-label={`${label}, livello ${p.v} su 4: ${p.desc}`}
              style={{
                width: "44px", height: "44px", borderRadius: "10px",
                border: checked ? `2px solid ${p.color}` : "1px solid rgba(255,255,255,0.08)",
                background: checked ? p.color + "30" : "#1A1A2E",
                color: p.color, fontSize: "16px", cursor: "pointer", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "'JetBrains Mono', monospace",
              }}>{p.v === 4 ? "4" : p.v}</button>
          );
        })}
      </div>
    </div>
  );
}

// Generic radio-group picker (RPE, freshness, fatigue) with arrow-key navigation.
function NumberRadioPicker({ values, value, onChange, ariaLabel, colorFor }: {
  values: number[];
  value: number | null;
  onChange: (v: number) => void;
  ariaLabel: string;
  colorFor: (n: number) => string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const focusByIndex = (i: number) => {
    const n = values.length;
    const idx = ((i % n) + n) % n;
    const btn = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[idx];
    btn?.focus();
    onChange(values[idx]);
  };
  const onKeyDown = (e: React.KeyboardEvent, currentIdx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusByIndex(currentIdx + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusByIndex(currentIdx - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusByIndex(0); }
    else if (e.key === "End") { e.preventDefault(); focusByIndex(values.length - 1); }
  };
  const selectedIdx = values.findIndex(v => v === value);
  const firstFocusableIdx = selectedIdx >= 0 ? selectedIdx : 0;
  return (
    <div ref={groupRef} role="radiogroup" aria-label={ariaLabel} style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {values.map((n, i) => {
        const checked = value === n;
        return (
          <button key={n} type="button" role="radio" aria-checked={checked}
            tabIndex={i === firstFocusableIdx ? 0 : -1}
            onClick={() => onChange(n)}
            onKeyDown={e => onKeyDown(e, i)}
            aria-label={`${ariaLabel}: ${n} su ${values[values.length - 1]}`}
            style={{
              width: "44px", height: "44px", borderRadius: "10px",
              background: checked ? colorFor(n) + "30" : "#1A1A2E",
              border: checked ? `2px solid ${colorFor(n)}` : "1px solid rgba(255,255,255,0.08)",
              color: colorFor(n), fontSize: "15px", fontWeight: 700, cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
            }}>{n}</button>
        );
      })}
    </div>
  );
}

export default function DiaryApp() {
  // Prefisso unico/stabile per gli id dei campi (accessibility: <label htmlFor>).
  // useId() assicura unicità tra istanze e stabilità tra render.
  const uidBase = useId();
  const fid = (name: string) => `${uidBase}-${name}`;
  const [screen, setScreen] = useState<"home" | "add" | "daily" | "detail">("home");
  const [index, setIndex] = useState<string[]>([]);
  const [todayData, setTodayData] = useState<any>(null);
  const [daySummaries, setDaySummaries] = useState<Map<string, { labels: string[]; icons: string[]; hasDaily: boolean; hasWorkouts: boolean }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any>(null);

  const [addType, setAddType] = useState<string | null>(null);
  const [addDate, setAddDate] = useState(today());
  const [addFields, setAddFields] = useState<Record<string, any>>({});
  // Mappa per zona: { [areaName]: { pre, during, post } }
  const [addPainByArea, setAddPainByArea] = useState<Record<string, { pre: number | null; during: number | null; post: number | null }>>({});
  const [addRpe, setAddRpe] = useState<number | null>(null);
  const [addNotes, setAddNotes] = useState("");
  // Se editingWorkoutId è settato, handleSaveWorkout sostituirà invece di creare.
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  // Data ORIGINALE del workout in editing (snapshot al momento dell'apertura).
  // Necessaria per gestire il caso in cui l'utente cambia la data del workout
  // durante l'editing: bisogna rimuoverlo dal day:OLD e reinserirlo in day:NEW.
  // Senza questo, findIndex falliva perché loadDay(addDate=NEW) non conteneva l'id.
  const [editingOriginalDate, setEditingOriginalDate] = useState<string | null>(null);
  // Flag edit per il check giornaliero: cambia header del form + forza reset
  // dei campi quando si torna a screen="home" (così un "nuovo daily" non
  // eredita valori dalla sessione precedente di editing).
  const [editingDaily, setEditingDaily] = useState<boolean>(false);

  // Zone di dolore da tracciare, lette dal profilo utente. Se vuote → pain picker nascosto.
  const [painAreas, setPainAreas] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("user-profile");
        if (r) {
          const p = JSON.parse(r.value);
          setPainAreas(Array.isArray(p?.painTrackingAreas) ? p.painTrackingAreas : []);
        }
      } catch { /* silent */ }
    })();
  }, []);

  const [dailyDate, setDailyDate] = useState(today());
  const [dailyFields, setDailyFields] = useState({
    weight: "", sleep: "", sleepQ: "", fatigue: null as number | null, meds: "",
    bodyFat: "", muscleMass: "", bodyWater: "",
    // FC a riposo mattutina (bpm) misurata prima di alzarsi. Usata da Karvonen
    // per calcolare zone personalizzate + indicatore recupero (trend ↑ cronico = stress).
    morningHR: "",
    // Freschezza percepita 1-10 (surrogato dell'HRV: Saw 2016 conferma validità
    // questionari soggettivi). 10 = lucido e pimpante, 1 = stanco/indolenzito.
    morningFreshness: null as number | null,
    cyclePhase: "" as "" | "mestruazione" | "follicolare" | "ovulatoria" | "luteinica" | "amenorrea" | "menopausa" | "contraccettivo",
  });

  // Profilo per sapere se mostrare il tracker ciclo (solo sex=f)
  const [profileSex, setProfileSex] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("user-profile");
        if (r) {
          const p = JSON.parse(r.value);
          setProfileSex(p?.sex || null);
        }
      } catch { /* silent */ }
    })();
  }, []);

  const [saveMsg, setSaveMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sessione del piano per oggi: integra Diario↔Piano. Mostra una card sopra
  // i bottoni Registra che dice "📋 Sessione di oggi: Fondo Lento, 45min" con
  // CTA "Registra dal piano" che pre-compila il form.
  // Stato: undefined = ancora da caricare, null = nessuna sessione oggi,
  // {session, weekNumber, done} = sessione trovata + stato done/todo.
  const [todayPlannedSession, setTodayPlannedSession] = useState<
    { session: PlannedSession; weekNumber: number; done: boolean } | null | undefined
  >(undefined);

  const refreshTodayPlanned = useCallback(async () => {
    const plan = await getJSON<TrainingPlan | null>("training-plan", null);
    if (!plan || !plan.startDate || !plan.weeks?.length) {
      setTodayPlannedSession(null);
      return;
    }
    // Calcola in che settimana del piano siamo oggi
    const [sy, sm, sd] = plan.startDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - start.getTime()) / (24 * 3600 * 1000));
    if (diffDays < 0) { setTodayPlannedSession(null); return; }
    const weekIdx = Math.floor(diffDays / 7);
    if (weekIdx >= plan.weeks.length) { setTodayPlannedSession(null); return; }
    const week = plan.weeks[weekIdx];
    const DAY_KEYS = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
    const todayKey = DAY_KEYS[now.getDay()];
    const session = week.sessions.find(s => s.day === todayKey);
    if (!session) { setTodayPlannedSession(null); return; }
    // Match con workout di oggi: se c'è stesso type (o family forza) → done.
    const todayDay = await loadDay(today());
    const workouts: any[] = todayDay?.workouts || [];
    const typeFamily = (t: string) => (t === "forza_gambe" || t === "forza_upper") ? "forza" : t;
    const done = workouts.some(w => typeFamily(w.type) === typeFamily(session.type));
    setTodayPlannedSession({ session, weekNumber: week.weekNumber, done });
  }, []);

  useEffect(() => {
    void refreshTodayPlanned();
    const off1 = events.on("plan:updated", () => void refreshTodayPlanned());
    const off2 = events.on("workout:saved", () => void refreshTodayPlanned());
    const off3 = events.on("data:externalChange", ({ key }) => {
      if (key === "training-plan" || key.startsWith("day:")) void refreshTodayPlanned();
    });
    return () => { off1(); off2(); off3(); };
  }, [refreshTodayPlanned]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const idx = await loadIndex();
    const sorted = idx.sort((a, b) => b.localeCompare(a));
    setIndex(sorted);
    setTodayData(await loadDay(today()));
    // Riassunti per storico: macro categoria + badge workout/daily (max 60 giorni)
    const summaries = new Map<string, { labels: string[]; icons: string[]; hasDaily: boolean; hasWorkouts: boolean }>();
    for (const date of sorted.slice(0, 60)) {
      try {
        const d = await loadDay(date);
        if (!d) continue;
        const workouts = d.workouts || [];
        const labels = workouts.map((w: any) => {
          const wtInfo = WORKOUT_TYPES.find(t => t.id === w.type);
          const sub = w.fields?.tipo || w.fields?.sport || "";
          return (wtInfo?.label || w.type) + (sub ? ` · ${sub}` : "");
        });
        const iconSet = new Set<string>();
        for (const w of workouts) {
          const wtInfo = WORKOUT_TYPES.find(t => t.id === (w as any).type);
          iconSet.add(wtInfo?.icon || "🏋️");
        }
        const icons: string[] = Array.from(iconSet);
        summaries.set(date, { labels, icons, hasDaily: !!d.daily, hasWorkouts: workouts.length > 0 });
      } catch { /* ignore */ }
    }
    setDaySummaries(summaries);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Cross-tab sync: se un'altra tab modifica diario o profilo, ricarica
  useEffect(() => {
    const off = events.on("data:externalChange", ({ key }) => {
      if (key.startsWith("day:") || key === "diary-index") {
        refresh();
      } else if (key === "user-profile") {
        (async () => {
          try {
            const r = await storage.get("user-profile");
            if (r) {
              const p = JSON.parse(r.value);
              setPainAreas(Array.isArray(p?.painTrackingAreas) ? p.painTrackingAreas : []);
              setProfileSex(p?.sex || null);
            }
          } catch { /* silent */ }
        })();
      }
    });
    return off;
  }, [refresh]);

  // Applica un payload di diary:openAdd allo stato del form. Estratto in funzione
  // così da essere chiamato sia dal listener event-bus (quando DiaryApp è già
  // montato) sia on-mount (quando proviene dal tab Coach e DiaryApp monta dopo
  // l'emit — payload persistito in pending-diary-openAdd).
  const applyOpenAddPayload = (p: { type?: string; date?: string; prefill?: Record<string, any>; notes?: string }) => {
    setAddDate(p.date || today());
    setAddType(p.type || null);
    const mapped: Record<string, any> = {};
    if (p.prefill && p.type) {
      const wt = WORKOUT_TYPES.find(w => w.id === p.type);
      for (const [k, v] of Object.entries(p.prefill)) {
        if (k === "subtype" && wt) {
          const tipoField = wt.fields.find((f: any) => f.key === "tipo" && "options" in f);
          if (tipoField && typeof v === "string") {
            const opts = (tipoField as any).options as string[];
            const match = opts.find(o => o.toLowerCase() === v.toLowerCase())
              || opts.find(o => o.toLowerCase().includes(v.toLowerCase()))
              || opts.find(o => v.toLowerCase().includes(o.toLowerCase()));
            if (match) mapped.tipo = match;
          }
        } else {
          mapped[k] = v;
        }
      }
    }
    setAddFields(mapped);
    setAddPainByArea({});
    setAddRpe(null);
    setAddNotes(p.notes || "");
    setEditingWorkoutId(null);
    setEditingOriginalDate(null);
    setScreen("add");
  };

  // Deep link dal Piano coach: apre lo schermo "Aggiungi" con tipo preselezionato.
  // Due percorsi:
  // (a) event bus: se DiaryApp è già montato quando parte l'emit
  // (b) storage: on-mount legge pending-diary-openAdd (caso tab Coach → Diary)
  useEffect(() => {
    // Consumo pending eventuale al mount
    (async () => {
      const pending = await getJSON<any>("pending-diary-openAdd", null);
      if (pending) {
        await setJSON("pending-diary-openAdd", null);
        applyOpenAddPayload(pending);
      }
    })();
    const off = events.on("diary:openAdd", applyOpenAddPayload);
    return off;
  }, []);

  const flash = (msg: string) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(""), 2200); };

  const handleSaveWorkout = async () => {
    if (saving || !addType) return;
    const wt = WORKOUT_TYPES.find(w => w.id === addType)!;
    const missing = wt.fields.filter((f: any) => f.required && !addFields[f.key]);
    if (missing.length) { flash("Compila i campi obbligatori"); return; }

    setSaving(true);
    let savedOk = false;
    try {
      const date = addDate;
      let dayData = (await loadDay(date)) || { daily: null, workouts: [] };
      if (editingWorkoutId) {
        // Modifica: sostituisce i campi del workout esistente, preservando id + createdAt.
        // Caso speciale: se l'utente ha cambiato la data, il workout è ancora salvato
        // sotto la data ORIGINALE (editingOriginalDate). Lo dobbiamo prima rimuovere
        // da lì, poi inserirlo nel giorno target.
        const sourceDate = editingOriginalDate || date;
        const sourceDay = sourceDate === date
          ? dayData
          : ((await loadDay(sourceDate)) || { daily: null, workouts: [] });
        const idx = sourceDay.workouts.findIndex((w: any) => w.id === editingWorkoutId);
        if (idx < 0) throw new Error("Workout non trovato (potrebbe essere stato eliminato).");
        const existing = sourceDay.workouts[idx];
        const updated = {
          ...existing,
          type: addType,
          fields: { ...addFields },
          pain: { ...addPainByArea },
          rpe: addRpe,
          notes: addNotes,
          updatedAt: new Date().toISOString(),
        };

        if (sourceDate === date) {
          // Stessa data: replace in-place
          sourceDay.workouts[idx] = updated;
          await saveDay(date, sourceDay);
        } else {
          // Data cambiata: rimuovi dalla data vecchia, inserisci nella nuova.
          sourceDay.workouts.splice(idx, 1);
          await saveDay(sourceDate, sourceDay);
          dayData.workouts.push(updated);
          await saveDay(date, dayData);
          // Aggiorna l'index: aggiungi nuova data se assente; togli vecchia se rimasta vuota.
          let idxAll = await loadIndex();
          let idxChanged = false;
          if (!idxAll.includes(date)) { idxAll.push(date); idxChanged = true; }
          if (!sourceDay.daily && sourceDay.workouts.length === 0) {
            idxAll = idxAll.filter(d => d !== sourceDate);
            idxChanged = true;
            // Cleanup: rimuovi del tutto il day:OLD vuoto (meno garbage in storage).
            try { await storage.delete(`day:${sourceDate}`); } catch { /* best-effort */ }
          }
          if (idxChanged) await saveIndex(idxAll);
        }
        events.emit("workout:saved", { date, workout: updated });
        savedOk = true;
        flash("Allenamento aggiornato ✓");
      } else {
        const newWorkout = {
          id: uid(), type: addType, fields: { ...addFields },
          pain: { ...addPainByArea }, rpe: addRpe, notes: addNotes,
          createdAt: new Date().toISOString(),
        };
        dayData.workouts.push(newWorkout);
        await saveDay(date, dayData);

        let idx = await loadIndex();
        if (!idx.includes(date)) { idx.push(date); await saveIndex(idx); }

        events.emit("workout:saved", { date, workout: newWorkout });
        savedOk = true;
        flash("Allenamento salvato ✓");
      }

      setAddType(null); setAddFields({}); setAddPainByArea({}); setAddRpe(null); setAddNotes("");
      setEditingWorkoutId(null);
      setEditingOriginalDate(null);
      await refresh();
      setScreen("home");
    } catch (e: any) {
      console.error("[handleSaveWorkout]", e);
      if (!savedOk) {
        const msg = (e instanceof StorageValueTooLargeError || e instanceof StorageQuotaError)
          ? (e.message || "Spazio locale esaurito ✗")
          : "Errore nel salvataggio ✗";
        flash(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  // Apre il form in modalità modifica: popola addFields/Pain/Rpe/Notes dal workout esistente.
  const openEditWorkout = (date: string, w: any) => {
    setAddDate(date);
    setEditingOriginalDate(date); // snapshot: serve a handleSaveWorkout per il move cross-day
    setAddType(w.type);
    setAddFields({ ...(w.fields || {}) });
    // Normalizza pain: se legacy {pre,during,post} (singola area = polpaccio),
    // espande a {polpaccio: {...}} SOLO se l'utente la sta ancora monitorando.
    // Altrimenti mantiene il dato originale ma NON lo mostra nel form
    // (l'utente che ha rimosso polpaccio da painTrackingAreas non vuole vedere
    // un campo "polpaccio" su un workout vecchio — confusione UI).
    const rawPain = w.pain && typeof w.pain === "object" ? w.pain : {};
    const isLegacy = "pre" in rawPain || "during" in rawPain || "post" in rawPain;
    if (isLegacy) {
      // Legacy = sempre polpaccio (era l'unica area trackata storicamente).
      // Mostra il campo solo se polpaccio è ancora in painTrackingAreas.
      if (painAreas.includes("polpaccio")) {
        setAddPainByArea({ polpaccio: { pre: rawPain.pre ?? null, during: rawPain.during ?? null, post: rawPain.post ?? null } });
      } else {
        setAddPainByArea({});
      }
    } else {
      const normalized: Record<string, { pre: number | null; during: number | null; post: number | null }> = {};
      for (const [area, v] of Object.entries(rawPain as Record<string, any>)) {
        // Mostra solo le aree ancora attivamente tracciate.
        if (!painAreas.includes(area)) continue;
        normalized[area] = { pre: v?.pre ?? null, during: v?.during ?? null, post: v?.post ?? null };
      }
      setAddPainByArea(normalized);
    }
    setAddRpe(w.rpe ?? null);
    setAddNotes(w.notes ?? "");
    setEditingWorkoutId(w.id);
    setScreen("add");
  };

  // Helper: reset dailyFields a valori vuoti. Usato dopo save o quando si apre
  // il form per un NUOVO check (così non si ereditano valori da un precedente edit).
  const resetDailyFields = () => {
    setDailyFields({
      weight: "", sleep: "", sleepQ: "", fatigue: null, meds: "",
      bodyFat: "", muscleMass: "", bodyWater: "",
      morningHR: "", morningFreshness: null, cyclePhase: "",
    });
  };

  // Apre il form check giornaliero in modalità modifica: pre-compila i campi
  // dal daily esistente di una specifica data. Garantisce che il save
  // sovrascriva il record esistente (stessa data, stessa chiave day:YYYY-MM-DD).
  const openEditDaily = (date: string, daily: any) => {
    setDailyDate(date);
    setDailyFields({
      weight: daily?.weight ?? "",
      sleep: daily?.sleep ?? "",
      sleepQ: daily?.sleepQ ?? "",
      fatigue: (typeof daily?.fatigue === "number" ? daily.fatigue : null) as number | null,
      meds: daily?.meds ?? "",
      bodyFat: daily?.bodyFat ?? "",
      muscleMass: daily?.muscleMass ?? "",
      bodyWater: daily?.bodyWater ?? "",
      morningHR: daily?.morningHR ?? "",
      morningFreshness: (typeof daily?.morningFreshness === "number" ? daily.morningFreshness : null) as number | null,
      cyclePhase: (daily?.cyclePhase ?? "") as ("" | "mestruazione" | "follicolare" | "ovulatoria" | "luteinica" | "amenorrea" | "menopausa" | "contraccettivo"),
    });
    setEditingDaily(true);
    setScreen("daily");
  };

  const handleSaveDaily = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const date = dailyDate;
      let dayData = (await loadDay(date)) || { daily: null, workouts: [] };
      // Filtra campi vuoti per non salvare "" in storage (più pulito per export/RAG)
      const cleanDaily: any = { savedAt: new Date().toISOString() };
      for (const [k, v] of Object.entries(dailyFields)) {
        if (v !== "" && v !== null && v !== undefined) cleanDaily[k] = v;
      }
      dayData.daily = cleanDaily;
      await saveDay(date, dayData);
      let idx = await loadIndex();
      if (!idx.includes(date)) { idx.push(date); await saveIndex(idx); }
      events.emit("daily:saved", { date, daily: dayData.daily });
      flash(editingDaily ? "Check giornaliero aggiornato ✓" : "Check giornaliero salvato ✓");
      await refresh();
      // Reset dei campi + flag di edit così un nuovo daily riparte pulito
      // (evita che un'apertura successiva veda valori stale dal precedente edit).
      resetDailyFields();
      setEditingDaily(false);
      setScreen("home");
    } catch (e: any) {
      console.error("[handleSaveDaily]", e);
      // instanceof check robusto (funziona anche se e.name viene modificato):
      // StorageQuotaError/ValueTooLargeError sono importati da storage.ts.
      const msg = (e instanceof StorageValueTooLargeError || e instanceof StorageQuotaError)
        ? (e.message || "Spazio locale esaurito ✗")
        : "Errore nel salvataggio ✗";
      flash(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWorkout = async (date: string, wid: string) => {
    // Conferma esplicita: eliminazione è irreversibile (nessun undo/trash).
    // I dati del workout non sono recuperabili senza un backup preesistente.
    if (!confirm("Eliminare questo allenamento? L'operazione è irreversibile e non include un ripristino.")) return;
    try {
      let dayData = await loadDay(date);
      if (!dayData) return;
      dayData.workouts = dayData.workouts.filter((w: any) => w.id !== wid);
      if (!dayData.workouts.length && !dayData.daily) {
        await storage.delete(`day:${date}`);
        let idx = await loadIndex();
        idx = idx.filter(d => d !== date);
        await saveIndex(idx);
      } else {
        await saveDay(date, dayData);
      }
      flash("Eliminato ✓");
      await refresh();
      const updated = await loadDay(date);
      if (updated && (updated.workouts.length || updated.daily)) { setDetailData(updated); }
      else { setScreen("home"); }
    } catch (e) {
      console.error("[handleDeleteWorkout]", e);
      flash("Errore nell'eliminazione ✗");
    }
  };

  const openDetail = async (date: string) => {
    const data = await loadDay(date);
    setDetailDate(date);
    setDetailData(data);
    setScreen("detail");
  };

  const downloadBlob = (content: string, filename: string, mime: string) => {
    const blob = new Blob(["\uFEFF" + content], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const gatherAllData = async () => {
    const idx = await loadIndex();
    const sorted = idx.sort((a, b) => a.localeCompare(b));
    const allDays = [];
    for (const date of sorted) {
      const data = await loadDay(date);
      if (data) allDays.push({ date, ...data });
    }
    return allDays;
  };

  const exportCSV = async () => {
    setExporting(true);
    try {
      const allDays = await gatherAllData();
      const headers = ["Data","Tipo","Sottotipo","Durata (min)","Passo Medio","Passo Frazioni","FC Media","FC Max","Cadenza","Carico","Scarpe","Superficie","Calorie","Esercizi","Dolore Pre","Dolore Durante","Dolore Post","RPE","Note","Peso (kg)","Sonno (h)","Qualità Sonno","Stanchezza","Farmaci"];
      const rows = [headers.join(";")];
      for (const day of allDays) {
        const d = day.daily || {};
        if (day.workouts?.length) {
          for (const w of day.workouts) {
            const f = w.fields || {};
            const row = [
              day.date, wType(w.type)?.label || w.type,
              f.tipo || f.sport || "", f.durata_totale || f.durata || "",
              f.passo_medio || "", f.passo_frazioni || "", f.fc_media || "", f.fc_max || "",
              f.cadenza || "", f.carico || "", f.scarpe || "", f.superficie || "",
              f.kcal || "", (f.esercizi || "").replace(/[\n\r;]/g, " | "),
              w.pain?.pre ?? "", w.pain?.during ?? "", w.pain?.post ?? "",
              w.rpe || "", (w.notes || "").replace(/[\n\r;]/g, " "),
              d.weight || "", d.sleep || "", d.sleepQ || "", d.fatigue || "", d.meds || "",
            ];
            rows.push(row.join(";"));
          }
        } else if (day.daily) {
          rows.push([day.date,"(Solo Check)","","","","","","","","","","","","","","","","","",d.weight||"",d.sleep||"",d.sleepQ||"",d.fatigue||"",d.meds||""].join(";"));
        }
      }
      downloadBlob(rows.join("\n"), `diario_${today()}.csv`, "text/csv");
      flash("CSV scaricato ✓");
    } catch (e) { console.error(e); flash("Errore nell'export"); }
    setExporting(false);
  };

  const wType = (id: string) => WORKOUT_TYPES.find(w => w.id === id);
  const painColor = (v: number) => PAIN_LEVELS.find(p => p.v === v)?.color || "#64748B";

  return (
    <div style={{ minHeight: "100vh", color: "#E2E8F0", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      {saveMsg && (() => {
        // Gli errori di salvataggio o validazione sono "alert/assertive" per leggere subito
        // il messaggio anche interrompendo eventuali altri annunci. I successi restano "status/polite".
        const isError = saveMsg.includes("Errore") || saveMsg.includes("✗") || saveMsg.includes("obbligatori") || saveMsg.includes("Spazio locale");
        return (
          <div
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            aria-atomic="true"
            style={{
              position: "fixed", top: "max(20px, calc(env(safe-area-inset-top, 0px) + 12px))",
              left: "50%", transform: "translateX(-50%)", zIndex: 999,
              background: isError ? "#7F1D1D" : "#14532D",
              color: "#FFF", padding: "12px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
              boxShadow: "0 8px 30px rgba(0,0,0,0.5)", animation: "fadeIn 0.2s ease",
              maxWidth: "90%", textAlign: "center",
            }}>{saveMsg}</div>
        );
      })()}

      {screen === "home" && (
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ padding: "24px 24px 16px", background: "linear-gradient(180deg, #16213E 0%, #0B0F1A 100%)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
              Diario Allenamento
            </div>
            <h1 style={{ fontSize: "24px", fontWeight: 900, margin: "6px 0 0", letterSpacing: "-0.04em", background: "linear-gradient(135deg, #E2E8F0 0%, #94A3B8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Oggi
            </h1>
            {todayData && (
              <div style={{ display: "flex", gap: "12px", marginTop: "12px", flexWrap: "wrap" }}>
                {todayData.daily?.weight && (
                  <div style={{ background: "#1A1A2E", borderRadius: "10px", padding: "8px 14px", fontSize: "13px" }}>
                    <span style={{ color: "#64748B" }}>Peso </span>
                    <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{todayData.daily.weight} kg</span>
                  </div>
                )}
                <div style={{ background: "#1A1A2E", borderRadius: "10px", padding: "8px 14px", fontSize: "13px" }}>
                  <span style={{ color: "#64748B" }}>Oggi </span>
                  <span style={{ fontWeight: 700 }}>{todayData.workouts?.length || 0} sessioni</span>
                </div>
              </div>
            )}
          </div>

          {todayPlannedSession && (
            <div style={{ padding: "12px 24px 0" }}>
              <div style={{
                background: todayPlannedSession.done
                  ? "linear-gradient(135deg, #14532D 0%, #166534 100%)"
                  : "linear-gradient(135deg, #1E3A5F 0%, #1E40AF 100%)",
                border: `1px solid ${todayPlannedSession.done ? "#22C55E66" : "#3B82F666"}`,
                borderRadius: "12px", padding: "12px 14px",
                display: "flex", alignItems: "center", gap: "12px",
              }}>
                <div aria-hidden="true" style={{
                  width: "36px", height: "36px", borderRadius: "10px",
                  background: "rgba(255,255,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "18px", flexShrink: 0,
                }}>{todayPlannedSession.done ? "✓" : "📋"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "11px", color: todayPlannedSession.done ? "#86EFAC" : "#93C5FD", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "2px" }}>
                    {todayPlannedSession.done ? "Sessione del piano fatta" : "Sessione di oggi (dal piano)"}
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#FFF", lineHeight: 1.3 }}>
                    {todayPlannedSession.session.type}{todayPlannedSession.session.subtype ? ` · ${todayPlannedSession.session.subtype}` : ""} · {todayPlannedSession.session.duration_min}min
                  </div>
                </div>
                {!todayPlannedSession.done && (
                  <button
                    onClick={() => {
                      const s = todayPlannedSession.session;
                      const durationField = s.type === "corsa" ? "durata_totale" : "durata";
                      const prefill: Record<string, any> = { [durationField]: s.duration_min };
                      if (s.subtype) prefill.subtype = s.subtype;
                      const notes = [
                        `📋 Dal piano del coach (settimana ${todayPlannedSession.weekNumber}):`,
                        stripInlineHRRange(s.details),
                        "",
                        `Razionale: ${s.rationale}`,
                      ].join("\n");
                      applyOpenAddPayload({ type: s.type, date: today(), prefill, notes });
                    }}
                    style={{
                      padding: "9px 13px",
                      background: "rgba(255,255,255,0.15)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: "9px", color: "#FFF",
                      fontSize: "12px", fontWeight: 700, cursor: "pointer",
                      whiteSpace: "nowrap", minHeight: "40px",
                    }}
                  >Registra</button>
                )}
              </div>
            </div>
          )}

          <div style={{ padding: "16px 24px 8px", display: "flex", gap: "10px" }}>
            <button onClick={() => { setAddDate(today()); setAddType(null); setEditingWorkoutId(null); setEditingOriginalDate(null); setScreen("add"); }} style={{
              flex: 1, padding: "16px", background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
              border: "none", borderRadius: "14px", color: "#FFF", fontSize: "15px", fontWeight: 700, cursor: "pointer",
            }}>🏋️ Registra allenamento</button>
            <button onClick={() => { setDailyDate(today()); resetDailyFields(); setEditingDaily(false); setScreen("daily"); }} style={{
              flex: 1, padding: "16px", background: "#16213E",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", color: "#E2E8F0",
              fontSize: "15px", fontWeight: 700, cursor: "pointer",
            }}>📊 Registra dati biometrici</button>
          </div>

          {index.length > 0 && (
            <div style={{ padding: "0 24px 8px", display: "flex", gap: "8px" }}>
              <button onClick={exportCSV} disabled={exporting} style={{
                flex: 1, padding: "10px", background: "#0F172A",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px",
                color: "#94A3B8", fontSize: "12px", fontWeight: 600,
                cursor: exporting ? "wait" : "pointer", opacity: exporting ? 0.5 : 1,
              }}>📊 Scarica CSV</button>
            </div>
          )}

          <div style={{ padding: "8px 24px 16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "#64748B", textTransform: "uppercase", marginBottom: "12px" }}>
              Storico ({index.length} giorni)
            </div>
            {loading ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#475569" }}>Caricamento...</div>
            ) : index.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 20px", color: "#475569" }}>
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>📓</div>
                <div style={{ fontSize: "15px", fontWeight: 600 }}>Nessun allenamento registrato</div>
                <div style={{ fontSize: "13px", marginTop: "6px" }}>Tocca "Registra allenamento" per iniziare</div>
              </div>
            ) : (() => {
              // Raggruppa date per settimana (lun-dom)
              const weekGroups: Array<{ label: string; dates: string[] }> = [];
              let currentWeekLabel = "";
              let currentDates: string[] = [];
              for (const date of index) {
                const [y, m, d] = date.split("-").map(Number);
                const dt = new Date(y, m - 1, d);
                // Lunedì della settimana di questa data
                const dow = dt.getDay();
                const mondayOffset = (dow + 6) % 7;
                const monday = new Date(dt); monday.setDate(dt.getDate() - mondayOffset);
                const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
                const fmtShort = (x: Date) => x.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
                const wLabel = `${fmtShort(monday)} - ${fmtShort(sunday)}`;
                if (wLabel !== currentWeekLabel) {
                  if (currentDates.length) weekGroups.push({ label: currentWeekLabel, dates: currentDates });
                  currentWeekLabel = wLabel;
                  currentDates = [];
                }
                currentDates.push(date);
              }
              if (currentDates.length) weekGroups.push({ label: currentWeekLabel, dates: currentDates });

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {weekGroups.map((wg) => (
                    <div key={wg.label}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px", paddingLeft: "4px" }}>
                        📅 {wg.label}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {wg.dates.map(date => {
                          const isToday = date === today();
                          const summary = daySummaries.get(date);
                          const badges: string[] = [];
                          if (summary?.icons?.length) badges.push(...summary.icons);
                          else if (summary?.hasWorkouts) badges.push("🏋️");
                          if (summary?.hasDaily) badges.push("📊");
                          return (
                            <button key={date} onClick={() => openDetail(date)} style={{
                              width: "100%", textAlign: "left", padding: "12px 14px",
                              background: isToday ? "#16213E" : "#111827",
                              border: isToday ? "1px solid #E8553A33" : "1px solid rgba(255,255,255,0.04)",
                              borderRadius: "12px", cursor: "pointer", color: "#E2E8F0",
                              display: "flex", alignItems: "center", gap: "10px",
                            }}>
                              <div style={{ fontSize: "13px", minWidth: "26px" }}>{badges.join("") || "📓"}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: "13px", fontWeight: 700, textTransform: "capitalize" }}>
                                  {isToday ? "Oggi" : fmtDate(date)}
                                </div>
                                {summary?.labels && summary.labels.length > 0 && (
                                  <div style={{ fontSize: "11px", color: "#CBD5E1", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {summary.labels.join(" + ")}
                                  </div>
                                )}
                                {summary?.hasDaily && !summary?.hasWorkouts && (
                                  <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>Solo dati biometrici</div>
                                )}
                              </div>
                              <div style={{ fontSize: "13px", color: "#64748B" }}>›</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {screen === "add" && (
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "20px 24px", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "15px", cursor: "pointer", padding: "8px" }}>← Indietro</button>
            <div style={{ flex: 1, fontWeight: 700, fontSize: "17px" }}>{addType ? "Compila Sessione" : "Nuova Sessione"}</div>
          </div>

          <div style={{ padding: "20px 24px" }}>
            <div style={{ marginBottom: "20px" }}>
              <label htmlFor={fid("addDate")} style={{ fontSize: "13px", fontWeight: 600, color: "#94A3B8", display: "block", marginBottom: "8px" }}>📅 Data della sessione</label>
              <input id={fid("addDate")} type="date" value={addDate} max={today()} onChange={e => setAddDate(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
              {addDate !== today() && (
                <div style={{ fontSize: "12px", color: "#D97706", marginTop: "6px", fontWeight: 600 }}>
                  ⚠ Stai inserendo una sessione passata ({fmtDate(addDate)})
                </div>
              )}
            </div>

            {!addType ? (
              <>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#94A3B8", marginBottom: "12px" }}>Che tipo di sessione hai fatto?</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {WORKOUT_TYPES.map(w => (
                    <button key={w.id} onClick={() => { setAddType(w.id); setAddFields({}); }} style={{
                      display: "flex", alignItems: "center", gap: "14px", padding: "16px 18px",
                      background: "#16213E", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "14px", cursor: "pointer", color: "#E2E8F0",
                      textAlign: "left", width: "100%",
                    }}>
                      <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: w.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>{w.icon}</div>
                      <div style={{ fontSize: "16px", fontWeight: 700 }}>{w.label}</div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {(() => { const w = wType(addType)!; return (
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", padding: "14px 16px", background: w.color + "12", borderRadius: "12px", border: `1px solid ${w.color}30` }}>
                    <span style={{ fontSize: "22px" }}>{w.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: "16px" }}>{w.label}</span>
                    <button onClick={() => setAddType(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: "13px" }}>Cambia ↺</button>
                  </div>
                ); })()}

                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {wType(addType)!.fields.map((f: any) => {
                    const inputId = fid(`workout-${f.key}`);
                    return (
                      <div key={f.key}>
                        <div style={{ display: "flex", gap: "6px", marginBottom: "6px", alignItems: "center" }}>
                          <label htmlFor={inputId} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1" }}>{f.label}</label>
                          {f.required && <span style={{ color: "#E8553A", fontSize: "10px" }} aria-label="obbligatorio">●</span>}
                        </div>
                        <FieldRow id={inputId} field={f} value={addFields[f.key]} onChange={v => setAddFields(p => ({ ...p, [f.key]: v }))} />
                      </div>
                    );
                  })}
                </div>

                {painAreas.length > 0 && painAreas.map(area => {
                  const p = addPainByArea[area] || { pre: null, during: null, post: null };
                  const updateArea = (phase: "pre" | "during" | "post", v: number) => {
                    setAddPainByArea(prev => ({ ...prev, [area]: { ...(prev[area] || { pre: null, during: null, post: null }), [phase]: v } }));
                  };
                  return (
                    <div key={area} style={{ marginTop: "24px", padding: "20px", background: "#16213E", borderRadius: "14px", border: "1px solid rgba(239,68,68,0.12)" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#EF4444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "16px" }}>
                        Dolore {area}
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                        <PainPicker label="Pre" value={p.pre} onChange={v => updateArea("pre", v)} />
                        <PainPicker label="Durante" value={p.during} onChange={v => updateArea("during", v)} />
                        <PainPicker label="Post" value={p.post} onChange={v => updateArea("post", v)} />
                      </div>
                    </div>
                  );
                })}

                <div style={{ marginTop: "16px" }}>
                  <div id={fid("rpe-label")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", marginBottom: "8px" }}>RPE — Sforzo Percepito</div>
                  <NumberRadioPicker
                    values={[1,2,3,4,5,6,7,8,9,10]}
                    value={addRpe}
                    onChange={setAddRpe}
                    ariaLabel="RPE — Sforzo Percepito"
                    colorFor={FATIGUE_COLORS}
                  />
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label htmlFor={fid("workout-notes")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Note & Sensazioni</label>
                  <textarea id={fid("workout-notes")} style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }} value={addNotes} onChange={e => setAddNotes(e.target.value)} placeholder="Come ti sei sentito? Sensazioni muscolari, energia..." />
                </div>

                <button onClick={handleSaveWorkout} disabled={saving} style={{
                  width: "100%", padding: "16px", marginTop: "24px",
                  background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
                  border: "none", borderRadius: "14px", color: "#FFF",
                  fontSize: "16px", fontWeight: 800,
                  cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1,
                }}>{saving ? "Salvataggio…" : editingWorkoutId ? "Aggiorna Sessione" : "Salva Sessione"}</button>
              </>
            )}
          </div>
        </div>
      )}

      {screen === "daily" && (
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "20px 24px", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button onClick={() => { setEditingDaily(false); resetDailyFields(); setScreen("home"); }} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "15px", cursor: "pointer", padding: "8px" }}>← Indietro</button>
            <div style={{ flex: 1, fontWeight: 700, fontSize: "17px" }}>
              📋 Check Giornaliero
              {editingDaily && (
                <span style={{
                  marginLeft: "10px", fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em",
                  color: "#F59E0B", background: "#F59E0B20",
                  padding: "3px 8px", borderRadius: "999px", verticalAlign: "middle",
                }}>MODIFICA</span>
              )}
            </div>
          </div>
          <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label htmlFor={fid("daily-date")} style={{ fontSize: "13px", fontWeight: 600, color: "#94A3B8", display: "block", marginBottom: "6px" }}>📅 Data</label>
              <input id={fid("daily-date")} type="date" value={dailyDate} max={today()} onChange={e => setDailyDate(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
            </div>
            <div>
              <label htmlFor={fid("daily-weight")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Peso Mattutino (a digiuno)</label>
              {(() => {
                const val = dailyFields.weight;
                const err = val !== "" ? ((): string | null => {
                  const n = Number(val);
                  if (!Number.isFinite(n)) return "Valore non valido.";
                  if (n < 25 || n > 300) return "Valore fuori range (25-300 kg).";
                  return null;
                })() : null;
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input id={fid("daily-weight")} type="number" step="0.1" value={val}
                        onChange={e => setDailyFields(p => ({ ...p, weight: e.target.value }))}
                        placeholder="es. 82.3" style={{ ...inputStyle, flex: 1 }}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? fid("error-daily-weight") : undefined}
                      />
                      <span style={{ fontSize: "13px", color: "#64748B" }}>kg</span>
                    </div>
                    {err && <div id={fid("error-daily-weight")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{err}</div>}
                  </>
                );
              })()}
            </div>
            <div>
              <label htmlFor={fid("daily-sleep")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Ore di Sonno</label>
              {(() => {
                const val = dailyFields.sleep;
                const err = val !== "" ? ((): string | null => {
                  const n = Number(val);
                  if (!Number.isFinite(n)) return "Valore non valido.";
                  if (n < 0 || n > 24) return "Valore fuori range (0-24 ore).";
                  return null;
                })() : null;
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input id={fid("daily-sleep")} type="number" step="0.5" value={val}
                        onChange={e => setDailyFields(p => ({ ...p, sleep: e.target.value }))}
                        placeholder="es. 7.5" style={{ ...inputStyle, flex: 1 }}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? fid("error-daily-sleep") : undefined}
                      />
                      <span style={{ fontSize: "13px", color: "#64748B" }}>h</span>
                    </div>
                    {err && <div id={fid("error-daily-sleep")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{err}</div>}
                  </>
                );
              })()}
            </div>
            <div>
              <label htmlFor={fid("daily-sleepQ")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Qualità Sonno</label>
              <select id={fid("daily-sleepQ")} value={dailyFields.sleepQ} onChange={e => setDailyFields(p => ({ ...p, sleepQ: e.target.value }))} style={inputStyle}>
                <option value="">Seleziona...</option>
                <option value="ottima">Ottima — riposato</option>
                <option value="buona">Buona — nella norma</option>
                <option value="sufficiente">Sufficiente — qualche risveglio</option>
                <option value="scarsa">Scarsa — stanco al risveglio</option>
              </select>
            </div>
            <div>
              <label htmlFor={fid("daily-morningHR")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>FC a riposo mattutina</label>
              <div id={fid("daily-morningHR-hint")} style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "6px" }}>
                Misurata al risveglio prima di alzarti (da smartwatch/fascia o manualmente contando 60 sec). Abilita il calcolo zone Karvonen personalizzato + indicatore di recupero.
              </div>
              {(() => {
                const val = dailyFields.morningHR;
                const err = val !== "" ? ((): string | null => {
                  const n = Number(val);
                  if (!Number.isFinite(n)) return "Valore non valido.";
                  if (n < 35 || n > 100) return "Valore fuori range (35-100 bpm).";
                  return null;
                })() : null;
                const describedBy = [fid("daily-morningHR-hint"), err ? fid("error-daily-morningHR") : null].filter(Boolean).join(" ");
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input id={fid("daily-morningHR")} type="number" min={35} max={100} value={val}
                        onChange={e => setDailyFields(p => ({ ...p, morningHR: e.target.value }))}
                        placeholder="es. 52" style={{ ...inputStyle, flex: 1 }}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={describedBy || undefined}
                      />
                      <span style={{ fontSize: "13px", color: "#64748B" }}>bpm</span>
                    </div>
                    {err && <div id={fid("error-daily-morningHR")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{err}</div>}
                  </>
                );
              })()}
            </div>
            <div>
              <div id={fid("daily-freshness-label")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "8px" }}>Freschezza percepita al risveglio</div>
              <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "6px" }}>
                1 = molto stanco/indolenzito · 10 = lucido e pimpante. Usato dal coach come indicatore di recupero (Saw 2016).
              </div>
              <NumberRadioPicker
                values={[1,2,3,4,5,6,7,8,9,10]}
                value={dailyFields.morningFreshness}
                onChange={n => setDailyFields(p => ({ ...p, morningFreshness: n }))}
                ariaLabel="Freschezza percepita al risveglio"
                colorFor={() => "#22C55E"}
              />
            </div>
            <div>
              <div id={fid("daily-fatigue-label")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "8px" }}>Stanchezza Generale</div>
              <NumberRadioPicker
                values={[1,2,3,4,5,6,7,8,9,10]}
                value={dailyFields.fatigue}
                onChange={n => setDailyFields(p => ({ ...p, fatigue: n }))}
                ariaLabel="Stanchezza Generale"
                colorFor={FATIGUE_COLORS}
              />
            </div>
            <div>
              <label htmlFor={fid("daily-meds")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Farmaci / Integratori</label>
              <input id={fid("daily-meds")} type="text" value={dailyFields.meds} onChange={e => setDailyFields(p => ({ ...p, meds: e.target.value }))} placeholder="es. Antistaminico, Magnesio..." style={inputStyle} />
            </div>

            <details style={{ background: "#16213E", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "12px 14px" }}>
              <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#CBD5E1", listStyle: "none" }}>
                📊 Composizione corporea (da bilancia smart, opzionale)
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}>
                <div>
                  <label htmlFor={fid("daily-bodyFat")} style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>Massa grassa (% BF)</label>
                  {(() => {
                    const val = dailyFields.bodyFat;
                    const err = val !== "" ? ((): string | null => {
                      const n = Number(val);
                      if (!Number.isFinite(n)) return "Valore non valido.";
                      if (n < 3 || n > 60) return "Valore fuori range (3-60 %).";
                      return null;
                    })() : null;
                    return (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <input id={fid("daily-bodyFat")} type="number" step="0.1" min={3} max={60} value={val}
                            onChange={e => setDailyFields(p => ({ ...p, bodyFat: e.target.value }))}
                            placeholder="es. 18.5" style={{ ...inputStyle, flex: 1 }}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? fid("error-daily-bodyFat") : undefined}
                          />
                          <span style={{ fontSize: "13px", color: "#94A3B8" }}>%</span>
                        </div>
                        {err && <div id={fid("error-daily-bodyFat")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{err}</div>}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <label htmlFor={fid("daily-muscleMass")} style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>Massa muscolare</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input id={fid("daily-muscleMass")} type="number" step="0.1" value={dailyFields.muscleMass} onChange={e => setDailyFields(p => ({ ...p, muscleMass: e.target.value }))} placeholder="es. 34.2 (kg) o 41.5 (%)" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: "13px", color: "#94A3B8" }}>kg / %</span>
                  </div>
                </div>
                <div>
                  <label htmlFor={fid("daily-bodyWater")} style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>Acqua corporea (% TBW)</label>
                  {(() => {
                    const val = dailyFields.bodyWater;
                    const err = val !== "" ? ((): string | null => {
                      const n = Number(val);
                      if (!Number.isFinite(n)) return "Valore non valido.";
                      if (n < 30 || n > 75) return "Valore fuori range (30-75 %).";
                      return null;
                    })() : null;
                    return (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <input id={fid("daily-bodyWater")} type="number" step="0.1" min={30} max={75} value={val}
                            onChange={e => setDailyFields(p => ({ ...p, bodyWater: e.target.value }))}
                            placeholder="es. 55.0" style={{ ...inputStyle, flex: 1 }}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? fid("error-daily-bodyWater") : undefined}
                          />
                          <span style={{ fontSize: "13px", color: "#94A3B8" }}>%</span>
                        </div>
                        {err && <div id={fid("error-daily-bodyWater")} role="alert" style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px" }}>{err}</div>}
                      </>
                    );
                  })()}
                </div>
                <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.4 }}>
                  Valori da bilancia BIA (impedenziometria). Hanno errore ~±3-8% ma utili per trend.
                </div>
              </div>
            </details>

            {profileSex === "f" && (
              <div>
                <label htmlFor={fid("daily-cyclePhase")} style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>
                  🌸 Fase ciclo (opzionale)
                </label>
                <select
                  id={fid("daily-cyclePhase")}
                  value={dailyFields.cyclePhase}
                  onChange={e => setDailyFields(p => ({ ...p, cyclePhase: e.target.value as typeof p.cyclePhase }))}
                  style={inputStyle}
                >
                  <option value="">Non tracciato</option>
                  <option value="mestruazione">Mestruazione</option>
                  <option value="follicolare">Follicolare (dopo flusso, ovulazione vicina)</option>
                  <option value="ovulatoria">Ovulatoria</option>
                  <option value="luteinica">Luteinica (seconda metà)</option>
                  <option value="amenorrea">⚠ Amenorrea (flusso saltato)</option>
                  <option value="menopausa">Menopausa</option>
                  <option value="contraccettivo">Contraccettivo ormonale</option>
                </select>
                <div style={{ fontSize: "11px", color: "#64748B", marginTop: "4px", lineHeight: 1.4 }}>
                  Il coach considera la fase per adattare suggerimenti. "Amenorrea" ripetuto triggers alert RED-S.
                </div>
              </div>
            )}

            <button onClick={handleSaveDaily} disabled={saving} style={{
              width: "100%", padding: "16px", marginTop: "12px",
              background: "linear-gradient(135deg, #0891B2 0%, #0E7490 100%)",
              border: "none", borderRadius: "14px", color: "#FFF",
              fontSize: "16px", fontWeight: 800,
              cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1,
            }}>{saving ? "Salvataggio…" : "Salva Check Giornaliero"}</button>
          </div>
        </div>
      )}

      {screen === "detail" && detailData && detailDate && (
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "20px 24px", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "15px", cursor: "pointer", padding: "8px" }}>← Indietro</button>
            <div style={{ flex: 1, fontWeight: 700, fontSize: "17px", textTransform: "capitalize" }}>{fmtDateFull(detailDate)}</div>
          </div>

          <div style={{ padding: "20px 24px" }}>
            {detailData.daily && (
              <div style={{ background: "#16213E", borderRadius: "14px", padding: "18px 20px", marginBottom: "16px", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#0891B2", letterSpacing: "0.1em", textTransform: "uppercase", flex: 1 }}>Check Giornaliero</div>
                  <button onClick={() => openEditDaily(detailDate, detailData.daily)} style={{
                    background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
                    color: "#CBD5E1", fontSize: "12px", padding: "6px 12px", cursor: "pointer", fontWeight: 600, minHeight: "32px",
                  }}>Modifica</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "14px" }}>
                  {detailData.daily.weight && <div><span style={{ color: "#64748B" }}>Peso </span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{detailData.daily.weight} kg</span></div>}
                  {detailData.daily.sleep && <div><span style={{ color: "#64748B" }}>Sonno </span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{detailData.daily.sleep}h</span></div>}
                  {detailData.daily.sleepQ && <div><span style={{ color: "#64748B" }}>Qualità </span><span style={{ fontWeight: 600 }}>{detailData.daily.sleepQ}</span></div>}
                  {detailData.daily.fatigue && <div><span style={{ color: "#64748B" }}>Stanchezza </span><span style={{ fontWeight: 700, color: FATIGUE_COLORS(detailData.daily.fatigue), fontFamily: "'JetBrains Mono', monospace" }}>{detailData.daily.fatigue}/10</span></div>}
                  {detailData.daily.meds && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "#64748B" }}>Farmaci </span><span style={{ fontWeight: 600 }}>{detailData.daily.meds}</span></div>}
                  {detailData.daily.bodyFat && <div><span style={{ color: "#64748B" }}>BF% </span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{detailData.daily.bodyFat}%</span></div>}
                  {detailData.daily.muscleMass && <div><span style={{ color: "#64748B" }}>Massa musc </span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{detailData.daily.muscleMass}</span></div>}
                  {detailData.daily.bodyWater && <div><span style={{ color: "#64748B" }}>TBW% </span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{detailData.daily.bodyWater}%</span></div>}
                </div>
              </div>
            )}

            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748B", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>
              Sessioni ({detailData.workouts?.length || 0})
            </div>

            {(!detailData.workouts || detailData.workouts.length === 0) ? (
              <div style={{ textAlign: "center", padding: "30px", color: "#475569", fontSize: "14px" }}>Nessuna sessione registrata</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {detailData.workouts.map((w: any) => {
                  const wt = wType(w.type);
                  return (
                    <div key={w.id} style={{ background: "#16213E", borderRadius: "14px", padding: "18px 20px", border: `1px solid ${wt?.color || "#333"}22` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                        <span style={{ fontSize: "20px" }}>{wt?.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: "15px", flex: 1 }}>{wt?.label}{w.fields?.tipo ? ` — ${w.fields.tipo}` : ""}</span>
                        <button onClick={() => openEditWorkout(detailDate, w)} aria-label="Modifica allenamento" style={{
                          background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
                          color: "#CBD5E1", fontSize: "13px", padding: "10px 14px", cursor: "pointer", fontWeight: 600,
                          minHeight: "44px", minWidth: "44px",
                        }}>Modifica</button>
                        <button onClick={() => handleDeleteWorkout(detailDate, w.id)} aria-label="Elimina allenamento" style={{
                          background: "#7F1D1D30", border: "1px solid #7F1D1D50", borderRadius: "8px",
                          color: "#EF4444", fontSize: "13px", padding: "10px 14px", cursor: "pointer", fontWeight: 600,
                          minHeight: "44px", minWidth: "44px",
                        }}>Elimina</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "13px" }}>
                        {wt?.fields.filter((f: any) => w.fields?.[f.key]).map((f: any) => (
                          <div key={f.key} style={f.type === "textarea" ? { gridColumn: "1 / -1" } : {}}>
                            <span style={{ color: "#64748B" }}>{f.label} </span>
                            <span style={{ fontWeight: 600 }}>{w.fields[f.key]}{f.unit ? ` ${f.unit}` : ""}</span>
                          </div>
                        ))}
                      </div>
                      {(() => {
                        // Supporta 2 formati: legacy { pre, during, post } e nuovo { [area]: { pre, during, post } }
                        if (!w.pain || typeof w.pain !== "object") return null;
                        const isLegacy = "pre" in w.pain || "during" in w.pain || "post" in w.pain;
                        const byArea: Array<{ area: string; pre: any; during: any; post: any }> = isLegacy
                          ? [{ area: "polpaccio", pre: w.pain.pre, during: w.pain.during, post: w.pain.post }]
                          : Object.entries(w.pain).map(([area, v]: [string, any]) => ({ area, pre: v?.pre, during: v?.during, post: v?.post }));
                        const hasAny = byArea.some(a => a.pre != null || a.during != null || a.post != null);
                        if (!hasAny) return null;
                        return (
                          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "6px" }}>
                            {byArea.map(a => {
                              if (a.pre == null && a.during == null && a.post == null) return null;
                              return (
                                <div key={a.area} style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ fontSize: "11px", color: "#94A3B8", textTransform: "capitalize", fontWeight: 600 }}>{a.area}:</span>
                                  {(["pre","during","post"] as const).map(k => a[k] != null ? (
                                    <div key={k} style={{ fontSize: "12px" }}>
                                      <span style={{ color: "#64748B" }}>{k === "pre" ? "Pre" : k === "during" ? "Durante" : "Post"} </span>
                                      <span style={{ fontWeight: 700, color: painColor(a[k]), fontFamily: "'JetBrains Mono', monospace" }}>{a[k]}</span>
                                    </div>
                                  ) : null)}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {(w.rpe || w.notes) && (
                        <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "13px" }}>
                          {w.rpe && <div><span style={{ color: "#64748B" }}>RPE </span><span style={{ fontWeight: 700, color: FATIGUE_COLORS(w.rpe), fontFamily: "'JetBrains Mono', monospace" }}>{w.rpe}/10</span></div>}
                          {w.notes && <div style={{ color: "#94A3B8", marginTop: "6px", fontStyle: "italic", lineHeight: 1.5 }}>{w.notes}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={() => { setAddDate(detailDate); setAddType(null); setAddFields({}); setAddPainByArea({}); setAddRpe(null); setAddNotes(""); setEditingWorkoutId(null); setEditingOriginalDate(null); setScreen("add"); }} style={{
              width: "100%", padding: "14px", marginTop: "16px",
              background: "#1A1A2E", border: "1px dashed rgba(255,255,255,0.15)",
              borderRadius: "14px", color: "#94A3B8", fontSize: "14px", fontWeight: 600, cursor: "pointer",
            }}>+ Aggiungi altra sessione a questa giornata</button>
          </div>
        </div>
      )}
    </div>
  );
}
