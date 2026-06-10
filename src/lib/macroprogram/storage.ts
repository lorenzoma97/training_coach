// Storage active macroprogramma (Sprint 4, 2026-05-26).
//
// Strategia: 1 macroprogramma attivo per volta (chiave `user-macroprogram`).
// Sostituire = upload nuovo file = il vecchio viene archiviato in
// `user-macroprogram-history` (max 5 entries, lifo) per recupero.
//
// Vincoli:
// - Schema validato via Zod prima di save (MacroProgramJsonSchema)
// - narrative_markdown preservato as-is per render UI

import { getJSON, setJSON } from "../storage";
import type { MacroProgram } from "../types/macroprogram";

const ACTIVE_KEY = "user-macroprogram";
const HISTORY_KEY = "user-macroprogram-history";
const HISTORY_CAP = 5;

export async function loadActiveMacroProgram(): Promise<MacroProgram | null> {
  return getJSON<MacroProgram | null>(ACTIVE_KEY, null);
}

export async function saveActiveMacroProgram(program: MacroProgram): Promise<void> {
  // Archivia il programma attivo corrente in history (se esiste)
  const current = await loadActiveMacroProgram();
  if (current) {
    const history = await getJSON<MacroProgram[]>(HISTORY_KEY, []);
    const updated = [current, ...history].slice(0, HISTORY_CAP);
    await setJSON(HISTORY_KEY, updated);
  }
  await setJSON(ACTIVE_KEY, program);
}

/** Normalizza una data (YYYY-MM-DD) al LUNEDÌ della sua settimana. null se invalida. */
export function mondayOf(dateISO: string): string | null {
  const parts = dateISO.split("-").map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  const dow = (dt.getDay() + 6) % 7; // 0=lun ... 6=dom
  dt.setDate(dt.getDate() - dow);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Aggiorna SOLO la data di inizio del macro attivo, normalizzata al lunedì
 * (le settimane sono lun→dom: start_date non-lunedì romperebbe il mapping
 * giorno→data). NON archivia in history: è una modifica di setting, non una
 * sostituzione del programma. Ritorna il programma aggiornato o null.
 */
export async function setMacroStartDate(dateISO: string): Promise<MacroProgram | null> {
  const program = await loadActiveMacroProgram();
  if (!program) return null;
  const monday = mondayOf(dateISO);
  if (!monday) return null;
  const updated: MacroProgram = {
    ...program,
    metadata: { ...program.metadata, start_date: monday },
  };
  await setJSON(ACTIVE_KEY, updated);
  return updated;
}

export async function clearActiveMacroProgram(): Promise<void> {
  const current = await loadActiveMacroProgram();
  if (current) {
    const history = await getJSON<MacroProgram[]>(HISTORY_KEY, []);
    const updated = [current, ...history].slice(0, HISTORY_CAP);
    await setJSON(HISTORY_KEY, updated);
  }
  await setJSON(ACTIVE_KEY, null);
}

export async function loadMacroProgramHistory(): Promise<MacroProgram[]> {
  return getJSON<MacroProgram[]>(HISTORY_KEY, []);
}

/**
 * Ritorna info derivate dal programma attivo: in quale settimana e fase
 * siamo OGGI, basato su `metadata.start_date`. Utile per banner TodayTab
 * e tab Programma per evidenziare la settimana corrente.
 *
 * Se start_date non è settato o invalido → ritorna null.
 * Se today < start_date → currentWeek = 0 (programma futuro).
 * Se today > end del programma → currentWeek = weeks_total + 1 (concluso).
 */
export interface MacroProgressInfo {
  currentWeek: number;        // 1..weeks_total; 0=pre-start; weeks_total+1=conclusa
  currentPhase: string | null; // nome fase corrispondente alla currentWeek, null se non in range
  daysFromStart: number;      // giorni dall'inizio del programma
}

export function computeMacroProgress(program: MacroProgram): MacroProgressInfo | null {
  if (!program.metadata.start_date) return null;
  // Ancora al LUNEDÌ della settimana di start_date (le settimane sono lun→dom).
  // Robusto anche se l'.md ha una data non-lunedì (es. sabato) → niente settimane
  // sfasate "sab-ven".
  const monday = mondayOf(program.metadata.start_date);
  if (!monday) return null;
  const startTs = Date.parse(monday);
  if (!Number.isFinite(startTs)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - startTs) / (24 * 3600 * 1000));
  if (days < 0) {
    return { currentWeek: 0, currentPhase: null, daysFromStart: days };
  }
  const week = Math.floor(days / 7) + 1;
  if (week > program.metadata.weeks_total) {
    return { currentWeek: program.metadata.weeks_total + 1, currentPhase: null, daysFromStart: days };
  }
  // Trova fase che copre questa settimana
  let currentPhase: string | null = null;
  for (const p of program.phases) {
    // weeks può essere range [start, end] oppure lista esplicita [w1, w2, w3]
    const isRange = p.weeks.length === 2 && p.weeks[0] <= p.weeks[1];
    if (isRange && week >= p.weeks[0] && week <= p.weeks[1]) {
      currentPhase = p.name;
      break;
    }
    if (!isRange && p.weeks.includes(week)) {
      currentPhase = p.name;
      break;
    }
  }
  return { currentWeek: week, currentPhase, daysFromStart: days };
}
