// Wave 3.3 — Helper di lookup per il MacroCycle attivo.
//
// Dato un UserProfile, carica il MacroCycle attivo da storage e computa il
// `BuildContextMacroCtx` da iniettare nel prompt Pass 1 (vedi
// promptBuilder.ts + macroPhaseBlock).
//
// Storage layout (vedi ARCHITECTURE.md §2.3):
//   - "user-races" → RaceEvent[]
//   - "macro-cycle:<id>" → MacroCycle (un record per macro)
//   - profile.activeMacroCycleId → id del macro attivo (priority="A" più imminente)
//
// Backward compat: se profile.activeMacroCycleId è assente o il macro non è
// in storage, ritorna null. Il prompt cade sul fallback storico
// (taperingBlock se daysToNearestRace ≤21).

import { getJSON } from "../storage";
import type { MacroCycle, RaceEvent, UserProfile } from "../types";
import { currentMacroContext } from "./macroPlanner";
import type { BuildContextMacroCtx } from "./promptBuilder";

/**
 * Risultato della lookup. Include il context per BuildContext + la race
 * (utile per UI badge / logging diagnostico).
 */
export interface ActiveMacroLookupResult {
  macroContext: BuildContextMacroCtx;
  race: RaceEvent;
  macro: MacroCycle;
}

/**
 * Carica il MacroCycle attivo + race + computa il context corrente.
 *
 * Ritorna `null` se:
 *  - profile è null/undefined
 *  - profile.activeMacroCycleId non è settato (utente non ha race "A")
 *  - macro non trovato in storage (orfano / cleared)
 *  - race referenced dal macro non trovata in user-races
 *  - currentMacroContext ritorna null (oggi fuori range macro)
 *
 * Tutti gli errori storage sono gestiti silenziosamente con `getJSON`
 * (che ritorna fallback su JSON corrotto). NON propaga eccezioni: il
 * coach deve degradare con grazia se il macro non è disponibile.
 */
export async function loadActiveMacroContext(
  profile: UserProfile | null,
  today?: Date,
): Promise<ActiveMacroLookupResult | null> {
  if (!profile) return null;
  const activeId = profile.activeMacroCycleId;
  if (!activeId || typeof activeId !== "string") return null;

  // Carica il macro attivo. Storage key pattern: "macro-cycle:<id>".
  const macroKey = `macro-cycle:${activeId}`;
  const macro = await getJSON<MacroCycle | null>(macroKey, null);
  if (!macro) return null;

  // Carica la race referenziata (per name + sport nel block).
  const races = await getJSON<RaceEvent[]>("user-races", []);
  const race = Array.isArray(races) ? races.find(r => r?.id === macro.raceId) ?? null : null;
  if (!race) return null;

  // Computa context corrente via macroPlanner helper.
  const ctx = currentMacroContext(macro, today);
  if (!ctx) return null;

  // Lookup nel MesoCycle corrente per volumeMultiplier + intensityHighPct.
  // Schema Specialist's currentMacroContext non li include nel return type
  // (ritorna solo phase/week/weeksToRace/totalWeeks); li leggiamo direttamente
  // dalle phases[] che sono la sorgente di verità.
  const meso = macro.phases.find(p => p.weekNumber === ctx.weekNumber)
    ?? macro.phases[ctx.weekNumber - 1]
    ?? null;
  if (!meso) return null;

  const macroContext: BuildContextMacroCtx = {
    phase: ctx.phase,
    weekNumber: ctx.weekNumber,
    totalWeeks: ctx.totalWeeks,
    weeksToRace: ctx.weeksToRace,
    volumeMultiplier: meso.volumeMultiplier,
    intensityHighPct: meso.intensityHighPct,
    race: { name: race.name, sport: race.sport },
  };

  return { macroContext, race, macro };
}
