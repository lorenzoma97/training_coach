import { useState, useEffect, useCallback } from "react";
import { storage } from "../lib/storage";
import { events } from "../lib/events";

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
      { key: "carico", label: "Carico", unit: "kg", type: "text", placeholder: "es. 11 kg/manubrio" },
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
      { key: "carico", label: "Carico", unit: "kg", type: "text" },
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
const today = () => new Date().toISOString().split("T")[0];
const fmtDate = (d: string) => { const dt = new Date(d + "T12:00:00"); return dt.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }); };
const fmtDateFull = (d: string) => { const dt = new Date(d + "T12:00:00"); return dt.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }); };
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
  await storage.set(`day:${date}`, JSON.stringify(data));
}
async function loadIndex(): Promise<string[]> {
  const r = await storage.get("diary-index");
  return r ? JSON.parse(r.value) : [];
}
async function saveIndex(dates: string[]) {
  await storage.set("diary-index", JSON.stringify(dates));
}

function FieldRow({ field, value, onChange }: { field: Field; value: any; onChange: (v: any) => void }) {
  const v = value || "";
  if (field.type === "select") return (
    <select style={inputStyle} value={v} onChange={e => onChange(e.target.value)}>
      <option value="">Seleziona...</option>
      {(field as any).options.map((o: string) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  if (field.type === "textarea") return (
    <textarea style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }} value={v} placeholder={(field as any).placeholder || ""} onChange={e => onChange(e.target.value)} rows={2} />
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <input style={{ ...inputStyle, flex: 1 }} type={field.type as string} value={v} placeholder={(field as any).placeholder || ""} onChange={e => onChange(e.target.value)} />
      {(field as any).unit && <span style={{ fontSize: "13px", color: "#64748B", minWidth: "36px" }}>{(field as any).unit}</span>}
    </div>
  );
}

function PainPicker({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ fontSize: "12px", color: "#CBD5E1", fontWeight: 600, marginBottom: "8px", textAlign: "center" }}>{label}</div>
      <div role="radiogroup" aria-label={`Dolore ${label}`} style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
        {PAIN_LEVELS.map(p => (
          <button key={p.v} onClick={() => onChange(p.v)} aria-label={`${p.v}: ${p.desc}`} aria-pressed={value === p.v} style={{
            width: "44px", height: "44px", borderRadius: "10px",
            border: value === p.v ? `2px solid ${p.color}` : "1px solid rgba(255,255,255,0.08)",
            background: value === p.v ? p.color + "30" : "#1A1A2E",
            color: p.color, fontSize: "16px", cursor: "pointer", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace",
          }}>{p.v === 4 ? "4" : p.v}</button>
        ))}
      </div>
    </div>
  );
}

export default function DiaryApp() {
  const [screen, setScreen] = useState<"home" | "add" | "daily" | "detail">("home");
  const [index, setIndex] = useState<string[]>([]);
  const [todayData, setTodayData] = useState<any>(null);
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

  const refresh = useCallback(async () => {
    setLoading(true);
    const idx = await loadIndex();
    setIndex(idx.sort((a, b) => b.localeCompare(a)));
    setTodayData(await loadDay(today()));
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

  // Deep link dal Piano coach: apre lo schermo "Aggiungi" con tipo preselezionato
  useEffect(() => {
    const off = events.on("diary:openAdd", ({ type, date }) => {
      setAddDate(date || today());
      setAddType(type || null);
      setAddFields({});
      setAddPainByArea({});
      setAddRpe(null);
      setAddNotes("");
      setScreen("add");
    });
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
      setAddType(null); setAddFields({}); setAddPainByArea({}); setAddRpe(null); setAddNotes("");
      flash("Allenamento salvato ✓");
      await refresh();
      setScreen("home");
    } catch (e) {
      console.error("[handleSaveWorkout]", e);
      if (!savedOk) flash("Errore nel salvataggio ✗");
    } finally {
      setSaving(false);
    }
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
      flash("Check giornaliero salvato ✓");
      await refresh();
      setScreen("home");
    } catch (e) {
      console.error("[handleSaveDaily]", e);
      flash("Errore nel salvataggio ✗");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWorkout = async (date: string, wid: string) => {
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
      {saveMsg && (
        <div role="status" aria-live="polite" style={{
          position: "fixed", top: "max(20px, calc(env(safe-area-inset-top, 0px) + 12px))",
          left: "50%", transform: "translateX(-50%)", zIndex: 999,
          background: saveMsg.includes("obbligatori") ? "#7F1D1D" : "#14532D",
          color: "#FFF", padding: "12px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
          boxShadow: "0 8px 30px rgba(0,0,0,0.5)", animation: "fadeIn 0.2s ease",
          maxWidth: "90%", textAlign: "center",
        }}>{saveMsg}</div>
      )}

      {screen === "home" && (
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ padding: "24px 24px 16px", background: "linear-gradient(180deg, #16213E 0%, #0B0F1A 100%)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#E8553A", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
              Diario Allenamento
            </div>
            <h1 style={{ fontSize: "24px", fontWeight: 900, margin: "6px 0 0", letterSpacing: "-0.04em", background: "linear-gradient(135deg, #FFF 0%, #94A3B8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
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

          <div style={{ padding: "16px 24px 8px", display: "flex", gap: "10px" }}>
            <button onClick={() => { setAddDate(today()); setAddType(null); setScreen("add"); }} style={{
              flex: 1, padding: "16px", background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
              border: "none", borderRadius: "14px", color: "#FFF", fontSize: "15px", fontWeight: 700, cursor: "pointer",
            }}>+ Allenamento</button>
            <button onClick={() => { setDailyDate(today()); setDailyFields({ weight: "", sleep: "", sleepQ: "", fatigue: null, meds: "", bodyFat: "", muscleMass: "", bodyWater: "", cyclePhase: "" }); setScreen("daily"); }} style={{
              flex: 1, padding: "16px", background: "#16213E",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", color: "#E2E8F0",
              fontSize: "15px", fontWeight: 700, cursor: "pointer",
            }}>📋 Check</button>
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
                <div style={{ fontSize: "13px", marginTop: "6px" }}>Tocca "+ Allenamento" per iniziare</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {index.map(date => {
                  const isToday = date === today();
                  return (
                    <button key={date} onClick={() => openDetail(date)} style={{
                      width: "100%", textAlign: "left", padding: "16px 18px",
                      background: isToday ? "#16213E" : "#111827",
                      border: isToday ? "1px solid #E8553A33" : "1px solid rgba(255,255,255,0.04)",
                      borderRadius: "14px", cursor: "pointer", color: "#E2E8F0",
                      display: "flex", alignItems: "center", gap: "14px",
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "15px", fontWeight: 700, textTransform: "capitalize" }}>
                          {isToday ? "Oggi" : fmtDate(date)}
                        </div>
                        <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "3px" }}>
                          Tocca per dettagli
                        </div>
                      </div>
                      <div style={{ fontSize: "12px", color: "#94A3B8" }}>›</div>
                    </button>
                  );
                })}
              </div>
            )}
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
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#94A3B8", display: "block", marginBottom: "8px" }}>📅 Data della sessione</label>
              <input type="date" value={addDate} max={today()} onChange={e => setAddDate(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
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
                  {wType(addType)!.fields.map((f: any) => (
                    <div key={f.key}>
                      <div style={{ display: "flex", gap: "6px", marginBottom: "6px", alignItems: "center" }}>
                        <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1" }}>{f.label}</label>
                        {f.required && <span style={{ color: "#E8553A", fontSize: "10px" }}>●</span>}
                      </div>
                      <FieldRow field={f} value={addFields[f.key]} onChange={v => setAddFields(p => ({ ...p, [f.key]: v }))} />
                    </div>
                  ))}
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
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", marginBottom: "8px" }}>RPE — Sforzo Percepito</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {[1,2,3,4,5,6,7,8,9,10].map(n => (
                      <button key={n} onClick={() => setAddRpe(n)} aria-label={`RPE ${n}`} aria-pressed={addRpe === n} style={{
                        width: "44px", height: "44px", borderRadius: "10px",
                        background: addRpe === n ? FATIGUE_COLORS(n) + "30" : "#1A1A2E",
                        border: addRpe === n ? `2px solid ${FATIGUE_COLORS(n)}` : "1px solid rgba(255,255,255,0.08)",
                        color: FATIGUE_COLORS(n), fontSize: "15px", fontWeight: 700, cursor: "pointer",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>{n}</button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Note & Sensazioni</label>
                  <textarea style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }} value={addNotes} onChange={e => setAddNotes(e.target.value)} placeholder="Come ti sei sentito? Sensazioni muscolari, energia..." />
                </div>

                <button onClick={handleSaveWorkout} disabled={saving} style={{
                  width: "100%", padding: "16px", marginTop: "24px",
                  background: "linear-gradient(135deg, #E8553A 0%, #D44429 100%)",
                  border: "none", borderRadius: "14px", color: "#FFF",
                  fontSize: "16px", fontWeight: 800,
                  cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1,
                }}>{saving ? "Salvataggio…" : "Salva Sessione"}</button>
              </>
            )}
          </div>
        </div>
      )}

      {screen === "daily" && (
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "20px 24px", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "15px", cursor: "pointer", padding: "8px" }}>← Indietro</button>
            <div style={{ flex: 1, fontWeight: 700, fontSize: "17px" }}>📋 Check Giornaliero</div>
          </div>
          <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#94A3B8", display: "block", marginBottom: "6px" }}>📅 Data</label>
              <input type="date" value={dailyDate} max={today()} onChange={e => setDailyDate(e.target.value)} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Peso Mattutino (a digiuno)</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input type="number" step="0.1" value={dailyFields.weight} onChange={e => setDailyFields(p => ({ ...p, weight: e.target.value }))} placeholder="es. 82.3" style={{ ...inputStyle, flex: 1 }} />
                <span style={{ fontSize: "13px", color: "#64748B" }}>kg</span>
              </div>
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Ore di Sonno</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input type="number" step="0.5" value={dailyFields.sleep} onChange={e => setDailyFields(p => ({ ...p, sleep: e.target.value }))} placeholder="es. 7.5" style={{ ...inputStyle, flex: 1 }} />
                <span style={{ fontSize: "13px", color: "#64748B" }}>h</span>
              </div>
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Qualità Sonno</label>
              <select value={dailyFields.sleepQ} onChange={e => setDailyFields(p => ({ ...p, sleepQ: e.target.value }))} style={inputStyle}>
                <option value="">Seleziona...</option>
                <option value="ottima">Ottima — riposato</option>
                <option value="buona">Buona — nella norma</option>
                <option value="sufficiente">Sufficiente — qualche risveglio</option>
                <option value="scarsa">Scarsa — stanco al risveglio</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "8px" }}>Stanchezza Generale</label>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <button key={n} onClick={() => setDailyFields(p => ({ ...p, fatigue: n }))} aria-label={`Stanchezza ${n}`} aria-pressed={dailyFields.fatigue === n} style={{
                    width: "44px", height: "44px", borderRadius: "10px",
                    background: dailyFields.fatigue === n ? FATIGUE_COLORS(n) + "30" : "#1A1A2E",
                    border: dailyFields.fatigue === n ? `2px solid ${FATIGUE_COLORS(n)}` : "1px solid rgba(255,255,255,0.08)",
                    color: FATIGUE_COLORS(n), fontSize: "15px", fontWeight: 700, cursor: "pointer",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>{n}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>Farmaci / Integratori</label>
              <input type="text" value={dailyFields.meds} onChange={e => setDailyFields(p => ({ ...p, meds: e.target.value }))} placeholder="es. Antistaminico, Magnesio..." style={inputStyle} />
            </div>

            <details style={{ background: "#16213E", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "12px 14px" }}>
              <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#CBD5E1", listStyle: "none" }}>
                📊 Composizione corporea (da bilancia smart, opzionale)
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}>
                <div>
                  <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>Massa grassa (% BF)</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="number" step="0.1" min={3} max={60} value={dailyFields.bodyFat} onChange={e => setDailyFields(p => ({ ...p, bodyFat: e.target.value }))} placeholder="es. 18.5" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: "13px", color: "#94A3B8" }}>%</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>Massa muscolare</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="number" step="0.1" value={dailyFields.muscleMass} onChange={e => setDailyFields(p => ({ ...p, muscleMass: e.target.value }))} placeholder="es. 34.2 (kg) o 41.5 (%)" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: "13px", color: "#94A3B8" }}>kg / %</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>Acqua corporea (% TBW)</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="number" step="0.1" min={30} max={75} value={dailyFields.bodyWater} onChange={e => setDailyFields(p => ({ ...p, bodyWater: e.target.value }))} placeholder="es. 55.0" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: "13px", color: "#94A3B8" }}>%</span>
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.4 }}>
                  Valori da bilancia BIA (impedenziometria). Hanno errore ~±3-8% ma utili per trend.
                </div>
              </div>
            </details>

            {profileSex === "f" && (
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1", display: "block", marginBottom: "6px" }}>
                  🌸 Fase ciclo (opzionale)
                </label>
                <select
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
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#0891B2", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>Check Giornaliero</div>
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
                        <button onClick={() => handleDeleteWorkout(detailDate, w.id)} style={{
                          background: "#7F1D1D30", border: "1px solid #7F1D1D50", borderRadius: "8px",
                          color: "#EF4444", fontSize: "12px", padding: "5px 10px", cursor: "pointer", fontWeight: 600,
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

            <button onClick={() => { setAddDate(detailDate); setAddType(null); setAddFields({}); setAddPainByArea({}); setAddRpe(null); setAddNotes(""); setScreen("add"); }} style={{
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
