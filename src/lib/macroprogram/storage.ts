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
  const startTs = Date.parse(program.metadata.start_date);
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
