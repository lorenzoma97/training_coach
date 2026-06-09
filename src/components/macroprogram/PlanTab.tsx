// PlanTab (Sprint B → L, 2026-06-09) — il tab "Piano" del Coach.
//
// UN SOLO posto per "cosa alleno", con gerarchia visiva pulita:
//   1. ProgramHeader: UNA card identità programma (titolo + "Settimana N/M ·
//      Fase" UNA volta + timeline navigabile + link narrativa). Sfogliando una
//      settimana diversa dalla corrente ne mostra l'anteprima inline.
//   2. TrainingPlanView: la settimana CORRENTE viva (proiettata + adattabile).
//
// Sprint L: prima c'erano DUE blocchi (banner strategia + timeline) che
// ripetevano "Settimana N · Fase"; ora fusi in ProgramHeader → una sola fonte.
// La concordanza/adattamenti restano dentro TrainingPlanView (stato settimana).

import { useEffect, useMemo, useState } from "react";
import TrainingPlanView from "../TrainingPlanView";
import ProgramView from "./ProgramView";
import MacroProgramUploadSection from "./MacroProgramUploadSection";
import { loadActiveMacroProgram, computeMacroProgress, setMacroStartDate, mondayOf } from "../../lib/macroprogram/storage";
import { lookupExerciseHybrid } from "../../lib/macroprogram/customCatalog";
import type { MacroProgram, MacroProgramSession } from "../../lib/types/macroprogram";
import { events } from "../../lib/events";
import { TOKENS, TYPE, SPACE, RADIUS } from "../../lib/theme";

const DAY_ORDER = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;

const cardStyle: React.CSSProperties = {
  background: "#16213E",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px",
  padding: "14px 16px",
};

export default function PlanTab() {
  const [macro, setMacro] = useState<MacroProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [narrativeOpen, setNarrativeOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const m = await loadActiveMacroProgram();
      setMacro(m);
      setLoaded(true);
    })();
  }, [refreshKey]);

  // Re-check macro quando il piano viene aggiornato (es. dopo import o rigenera)
  useEffect(() => {
    const off = events.on("plan:updated", () => setRefreshKey(k => k + 1));
    return () => { off(); };
  }, []);

  const progress = macro ? computeMacroProgress(macro) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Header programma unico (identità + timeline) */}
      {macro && (
        <>
          <ProgramHeader
            program={macro}
            progress={progress}
            currentWeek={progress?.currentWeek ?? 0}
            onOpenNarrative={() => setNarrativeOpen(true)}
          />
          <button
            onClick={() => setManageOpen(v => !v)}
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px", background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
              color: "#94A3B8", fontSize: "11px", fontWeight: 600, cursor: "pointer",
            }}
          >
            {manageOpen ? "Chiudi gestione" : "⚙ Gestisci / sostituisci programma"}
          </button>
          {manageOpen && (
            <>
              <div style={cardStyle}>
                <StartDateEditor program={macro} onChanged={() => setRefreshKey(k => k + 1)} />
              </div>
              <div style={cardStyle}>
                <MacroProgramUploadSection />
              </div>
            </>
          )}
        </>
      )}

      {/* Entry-point import (se NESSUN macro) — discovery fuori da Settings */}
      {loaded && !macro && (
        <div style={{ ...cardStyle, borderStyle: "dashed", borderColor: "rgba(232,85,58,0.3)" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
            📋 Hai un programma multi-settimana?
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginBottom: "10px" }}>
            Genera un programma su Claude col template e caricalo qui: il piano settimanale lo seguirà fedelmente.
          </div>
          <button
            onClick={() => setUploadOpen(v => !v)}
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: "1px solid #E8553A66", borderRadius: "10px",
              color: "#E8553A", fontSize: "13px", fontWeight: 700, cursor: "pointer",
            }}
          >
            {uploadOpen ? "Chiudi" : "Carica programma"}
          </button>
          {uploadOpen && (
            <div style={{ marginTop: "12px" }}>
              <MacroProgramUploadSection />
            </div>
          )}
        </div>
      )}

      {/* Settimana corrente (proiettata dal macro se attivo, adattabile) */}
      <TrainingPlanView />

      {/* Narrativa completa + riferimenti (testo lungo): unico uso del modale. */}
      {macro && narrativeOpen && (
        <ProgramView program={macro} onClose={() => setNarrativeOpen(false)} />
      )}
    </div>
  );
}

// ─── Header programma: identità + timeline navigabile (Sprint L: fuso) ────────

function phaseForWeek(program: MacroProgram, week: number): string | undefined {
  for (const p of program.phases) {
    const isRange = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1];
    const inPhase = isRange ? (week >= p.weeks[0] && week <= p.weeks[1]) : p.weeks.includes(week);
    if (inPhase) return p.name;
  }
  return undefined;
}

function ProgramHeader({
  program, currentWeek, progress, onOpenNarrative,
}: {
  program: MacroProgram;
  currentWeek: number;
  progress: ReturnType<typeof computeMacroProgress>;
  onOpenNarrative: () => void;
}) {
  const total = program.metadata.weeks_total;
  const weeks = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  // Default: settimana corrente (o la 1 se il programma non è iniziato).
  const [selected, setSelected] = useState(currentWeek >= 1 && currentWeek <= total ? currentWeek : 1);

  const weekData = useMemo(
    () => program.weeks.find(w => w.week === selected) ?? null,
    [program, selected],
  );
  const phaseName = phaseForWeek(program, selected);
  const isCurrent = selected === currentWeek;
  const currentPhase = progress?.currentPhase;

  const sortedSessions = useMemo(() => {
    if (!weekData) return [];
    return [...weekData.sessions].sort(
      (a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day),
    );
  }, [weekData]);

  // UNICA fonte di "Settimana N/M · Fase" in tutta la schermata.
  const statusLine = currentWeek === 0
    ? `Inizia tra ${Math.abs(progress?.daysFromStart ?? 0)} giorni · ${total} settimane`
    : currentWeek > total
      ? "Programma concluso"
      : `Settimana ${currentWeek}/${total}${currentPhase ? ` · ${currentPhase}` : ""}`;

  return (
    <div style={{
      background: "linear-gradient(135deg, #16213E 0%, #1E2746 100%)",
      border: `1px solid ${TOKENS.primary}55`,
      borderRadius: `${RADIUS.card}px`, padding: `${SPACE.lg}px`,
      display: "flex", flexDirection: "column", gap: `${SPACE.md}px`,
    }}>
      {/* Identità — niente emoji come icona (skill product-ui-system), titolo
          alla scala TYPE.title per gerarchia chiara invece dei 15px densi. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: `${SPACE.sm}px` }}>
        <div style={{ ...TYPE.label, color: TOKENS.primary }}>
          Programma
        </div>
        <button
          onClick={onOpenNarrative}
          style={{
            padding: `${SPACE.xs}px ${SPACE.sm}px`, background: "transparent", border: "none",
            ...TYPE.secondary, color: TOKENS.neutral, cursor: "pointer",
            textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "3px",
          }}
        >Narrativa →</button>
      </div>
      <div style={{ ...TYPE.title, color: TOKENS.text }}>
        {program.metadata.title}
      </div>
      <div style={{ ...TYPE.secondary, color: TOKENS.info, fontWeight: 600 }}>{statusLine}</div>

      {/* Timeline chip navigabili */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {weeks.map(w => {
          const sel = w === selected;
          const cur = w === currentWeek;
          const past = currentWeek > 0 && w < currentWeek;
          return (
            <button
              key={w}
              onClick={() => setSelected(w)}
              aria-pressed={sel}
              title={`Settimana ${w}${cur ? " (corrente)" : ""}`}
              style={{
                minWidth: "36px", padding: "6px 9px",
                background: sel ? "#E8553A" : cur ? "#E8553A22" : past ? "#0891B218" : "#1A1A2E",
                border: sel ? "1px solid #E8553A" : cur ? "1px solid #E8553A66" : "1px solid rgba(255,255,255,0.1)",
                borderRadius: "9px",
                color: sel ? "#FFF" : cur ? "#E8553A" : past ? "#0891B2" : "#94A3B8",
                fontSize: "12px", fontWeight: 700, cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {w}
            </button>
          );
        })}
      </div>

      {/* Anteprima SOLO se sfogli una settimana diversa dalla corrente.
          (La corrente è già viva e dettagliata sotto: niente doppione.) */}
      {!isCurrent && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#E2E8F0" }}>Anteprima settimana {selected}</span>
            {phaseName && <span style={{ fontSize: "12px", color: "#0891B2", fontWeight: 600 }}>· {phaseName}</span>}
          </div>
          {weekData?.notes && (
            <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 }}>{weekData.notes}</div>
          )}
          {sortedSessions.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#64748B" }}>Nessuna sessione in questa settimana.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {sortedSessions.map((s, i) => <SessionPreviewLine key={i} session={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Editor data di inizio (Sprint, 2026-06-09) ───────────────────────────────

function StartDateEditor({ program, onChanged }: { program: MacroProgram; onChanged: () => void }) {
  const [val, setVal] = useState(program.metadata.start_date ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const progress = computeMacroProgress(program);
  const total = program.metadata.weeks_total;

  const fmtIT = (iso?: string) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y) return iso;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  };

  const apply = async (dateISO: string) => {
    if (!dateISO || saving) return;
    setSaving(true); setMsg(null);
    const updated = await setMacroStartDate(dateISO);
    setSaving(false);
    if (updated) {
      setVal(updated.metadata.start_date ?? dateISO);
      // plan:updated → TrainingPlanView riproietta sulla nuova settimana corrente.
      events.emit("plan:updated", { at: new Date().toISOString() });
      setMsg(`Inizio impostato a lun ${fmtIT(updated.metadata.start_date)}.`);
      onChanged();
    } else {
      setMsg("Data non valida.");
    }
  };

  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const thisMonday = mondayOf(todayISO);

  const statusLine = !progress
    ? "—"
    : progress.currentWeek === 0
      ? `inizia tra ${Math.abs(progress.daysFromStart)} giorni`
      : progress.currentWeek > total
        ? "concluso"
        : `oggi: settimana ${progress.currentWeek}/${total}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#E2E8F0" }}>📅 Data di inizio</div>
      <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.5 }}>
        Le settimane vanno lun→dom: la settimana 1 parte dal lunedì scelto (la data viene riportata al lunedì della sua settimana). Cambiala per ricominciare dopo uno stop, o per far partire il piano questa settimana.
      </div>
      <div style={{ fontSize: "12px", color: "#CBD5E1" }}>
        Attuale: <b>lun {fmtIT(program.metadata.start_date)}</b> · {statusLine}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="date"
          value={val}
          onChange={e => setVal(e.target.value)}
          style={{
            padding: "8px 10px", background: "#0F172A",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px",
            color: "#E2E8F0", fontSize: "13px",
          }}
        />
        <button
          onClick={() => apply(val)}
          disabled={saving || !val}
          style={{
            padding: "8px 14px", background: "linear-gradient(135deg, #E8553A 0%, #D4452F 100%)",
            border: "none", borderRadius: "8px", color: "#FFF", fontSize: "13px", fontWeight: 700,
            cursor: saving ? "wait" : "pointer", opacity: saving || !val ? 0.6 : 1,
          }}
        >Applica</button>
      </div>
      {thisMonday && (
        <button
          onClick={() => apply(thisMonday)}
          disabled={saving}
          style={{
            alignSelf: "flex-start", padding: "8px 12px", background: "transparent",
            border: "1px solid #0891B266", borderRadius: "8px",
            color: "#0891B2", fontSize: "12px", fontWeight: 700, cursor: saving ? "wait" : "pointer",
          }}
        >↻ Ricomincia da questa settimana (lun {fmtIT(thisMonday)})</button>
      )}
      {msg && <div style={{ fontSize: "11px", color: "#22C55E" }}>{msg}</div>}
    </div>
  );
}

/** Riga compatta read-only di una sessione del macro (per la timeline). */
function SessionPreviewLine({ session: s }: { session: MacroProgramSession }) {
  const mainIv = s.intervals.find(iv => iv.kind === "main") ?? s.intervals[0];
  const zone = mainIv?.zone;

  let summary = "";
  if (s.exercises.length > 0) {
    const top = s.exercises.slice(0, 3).map(ex => {
      const name = ex.name ?? lookupExerciseHybrid(ex.id)?.name ?? ex.id;
      const reps = ex.reps_min === ex.reps_max ? `${ex.reps_min}` : `${ex.reps_min}-${ex.reps_max}`;
      return `${name} ${ex.sets}×${reps}`;
    }).join(" · ");
    summary = top + (s.exercises.length > 3 ? ` +${s.exercises.length - 3}` : "");
  } else if (s.intervals.length > 0) {
    summary = s.intervals
      .map(iv => iv.kind === "main" && iv.reps ? `${iv.reps}×${iv.duration_min ?? "?"}min` : (iv.duration_min ? `${iv.kind} ${iv.duration_min}min` : iv.kind))
      .join(" + ");
  }

  return (
    <div style={{
      padding: "8px 10px", background: "#0F172A",
      border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px",
      display: "flex", flexDirection: "column", gap: "3px",
    }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", minWidth: "34px" }}>
          {s.day}
        </span>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#E2E8F0" }}>{s.type}</span>
        <span style={{ fontSize: "11px", color: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}>{s.duration_min}min</span>
        {typeof zone === "number" && (
          <span style={{ fontSize: "10px", color: "#38BDF8", fontWeight: 700 }}>Z{zone}</span>
        )}
      </div>
      {summary && (
        <div style={{ fontSize: "11px", color: "#94A3B8", lineHeight: 1.4 }}>{summary}</div>
      )}
    </div>
  );
}
