// Wave 3.3 — Modulo per direttive di periodizzazione (macrocycle phase + taper).
//
// Due block esposti:
//
//  1. taperingBlock(daysToRace) — block storico, attivato a ≤21 giorni dalla
//     race quando NON c'è un MacroCycle attivo (utente con race "B"/"C" o
//     senza priority="A"). Mantenuto come "safety net" per backward compat.
//     Basato su Bosquet 2007 (meta-analysis) + Spilsbury 2023.
//
//  2. macroPhaseBlock(ctx) — block NUOVO, iniettato SEMPRE che il piano ha
//     un MacroCycle attivo (qualsiasi fase). Più ricco e specifico per fase
//     (base/build/peak/taper), include direttive numeriche concrete (volume
//     multiplier, intensità target). Per la fase "taper" copre già le stesse
//     direttive del taperingBlock storico (Mujika 2003) con specificità
//     migliore — vedi nota in promptBuilder.ts su deduplicazione.
//
// Riferimenti:
//  - Bompa T. "Periodization: Theory and Methodology of Training" (1999)
//  - Mujika I. & Padilla S. "Scientific bases for precompetition tapering
//    strategies" Med Sci Sports Exerc 2003
//  - Bosquet L. et al. "Effects of tapering on performance: a meta-analysis"
//    Med Sci Sports Exerc 2007
//  - Seiler S. "Polarized training intensity distribution" Int J Sports
//    Physiol Perform 2010

import type { MacroPhase } from "../../types";

/** Block storico per countdown taper senza MacroCycle (legacy + safety net). */
export function taperingBlock(daysToRace: number): string {
  return `
## Linee guida: tapering pre-gara (ref: Bosquet 2007, Spilsbury 2023)
Gara fra **${daysToRace} giorni**. Applica tapering corretto:
- **Riduci volume del 41-60%** con decremento esponenziale (taglio maggiore nell'ultima settimana).
- **Intensità invariata**: mantieni stimoli di qualità (ripetute brevi a ritmo gara, allunghi). Tagliare l'intensità fa perdere adattamenti.
- **Frequenza invariata**: stesso numero di sessioni/settimana, più corte.
- **Finestra ottimale 8-14 giorni**; tapering più brevi (7 gg) o più lunghi (15-21 gg) funzionano ma con effetto minore.
- Effect size maggiore per **eventi endurance** (+0.5-6% performance al traguardo).
- Ultima sessione dura 48-72h prima della gara; poi scarico completo + mobility.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}

/**
 * Direttive specifiche per fase del macrociclo. Iniettate nel block
 * `macroPhaseBlock` qui sotto. Fonte: Bompa 1999 + Seiler 2010 (polarizzato)
 * + Mujika 2003 (taper).
 *
 * NB: questi testi sono tarati per essere CITABILI dal modello nel
 * "rationale" del piano (es. "siamo in build, +20% volume vs base, introduco
 * 1 sessione di soglia"). Cambiarli rompe i golden test.
 */
const PHASE_DIRECTIVE: Record<MacroPhase, string> = {
  base:
    "Costruisci aerobic base. Distribuzione **polarizzata 80/20** (Seiler 2010): " +
    "≥80% sessioni cardio in Z2 dominante, ≤20% in Z3+. **NO race-pace specifico ancora**. " +
    "Privilegia volume (long run, easy runs lunghi) su qualità.",
  build:
    "Aumenta volume **+10-20% vs fase base**. Introduci **1-2 sessioni di qualità/settimana** " +
    "(soglia/ripetute medie). Distribuzione vira verso 70/30 (più Z3-Z4). " +
    "**Ogni 4 settimane di build → settimana di deload (-30/40% volume)** per overreach controllato (Bompa 1999).",
  peak:
    "Sessioni **race-pace specifiche** (intensità di gara). Riduci volume **-10% vs build** " +
    "per privilegiare qualità neuromuscolare. Max **1-2 long key sessions/settimana** " +
    "(es. tempo run + ripetute lunghe a ritmo gara). 60/40 polarizzazione (più Z4-Z5).",
  taper:
    "**Volume -40/-50% vs peak** (Mujika 2003: 41-60%). " +
    "**Intensità mantenuta** — stimoli brevi a ritmo gara, no nuovi stimoli, no PR test. " +
    "Frequenza invariata: stesso numero di sessioni, più corte. " +
    "**Recovery prioritaria**: sonno, idratazione, stretching dolce. " +
    "Ultima sessione 48-72h prima della gara, poi solo mobility leggera.",
  transition:
    "Recovery attivo post-gara. Volume **-50% vs baseline**, intensità Z1-Z2 conversazionale. " +
    "Sessioni brevi (≤45min), focus mobilità + cross-training a basso impatto. " +
    "Durata 1-2 settimane prima di iniziare un nuovo macrociclo.",
};

/**
 * Block "FASE MACROCICLO ATTIVA" — iniettato in Pass 1 quando il piano ha
 * un macroCycleId attivo. Pattern atteso nel rationale: l'LLM deve
 * esplicitamente citare la fase corrente per giustificare le scelte
 * ("siamo in build, aumento intervalli di soglia").
 *
 * Token budget: ~300-400 token (verifica con tiktoken/preview se cambi).
 */
export function macroPhaseBlock(ctx: {
  phase: MacroPhase;
  weekNumber: number;
  totalWeeks: number;
  weeksToRace: number;
  raceName: string;
  raceSport: string;
  volumeMultiplier: number;
  intensityHighPct: number;
}): string {
  const volPct = Math.round((ctx.volumeMultiplier - 1) * 100);
  const volSign = volPct >= 0 ? "+" : "";
  const volLabel =
    Math.abs(volPct) < 5
      ? "≈ baseline (volume normale)"
      : `${volSign}${volPct}% rispetto a settimana media baseline`;
  const daysToRace = ctx.weeksToRace * 7;
  const directive = PHASE_DIRECTIVE[ctx.phase];

  return `
## FASE MACROCICLO ATTIVA (ref: Bompa 1999, Mujika 2003, Seiler 2010)
**Race target**: ${ctx.raceName} (${ctx.raceSport}) — fra **${ctx.weeksToRace} settimane** (~${daysToRace} giorni).
**Settimana corrente**: ${ctx.weekNumber}/${ctx.totalWeeks} del macrociclo.
**Fase corrente**: \`${ctx.phase}\`.

**Volume target**: ${ctx.volumeMultiplier.toFixed(2)}x baseline (${volLabel}).
**Intensità target**: ~${ctx.intensityHighPct}% delle sessioni cardio in Z3+ (modello polarizzato Seiler).

**Direttive per fase \`${ctx.phase}\`**:
${directive}

**Obbligo nel rationale**: cita esplicitamente la fase corrente (\`${ctx.phase}\`) e come la stai applicando (es. "siamo in ${ctx.phase}, ${ctx.phase === "base" ? "tengo Z2 dominante" : ctx.phase === "build" ? "introduco una sessione di soglia" : ctx.phase === "peak" ? "metto race-pace work" : ctx.phase === "taper" ? "taglio volume mantenendo intensità" : "scarico aerobico"}"). NON deviare dalle direttive sopra senza giustificazione esplicita nel rationale.`.trim();
}
