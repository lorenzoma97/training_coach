// Wave 3.3 — Test per macroPhaseBlock + taperingBlock (legacy).
//
// Coverage:
//  - macroPhaseBlock(base) include la direttiva "polarizzato 80/20"
//  - macroPhaseBlock(build) include la direttiva "deload"
//  - macroPhaseBlock(peak) include la direttiva "race-pace"
//  - macroPhaseBlock(taper) include il riferimento "Mujika"
//  - Il block contiene volume + intensity numerici nel testo
//  - taperingBlock storico ancora funziona (regression / safety net)

import { describe, it, expect } from "vitest";
import { taperingBlock, macroPhaseBlock } from "../taperingRules";

function baseCtx() {
  return {
    weekNumber: 3,
    totalWeeks: 12,
    weeksToRace: 9,
    raceName: "Maratona di Bologna 2026",
    raceSport: "corsa",
    volumeMultiplier: 1.0,
    intensityHighPct: 12,
  };
}

describe("macroPhaseBlock — fase base", () => {
  it("include direttiva polarizzata 80/20", () => {
    const block = macroPhaseBlock({ ...baseCtx(), phase: "base" });
    // "polarizzato" (masc) o "polarizzata" (femm) + "80/20" — case insensitive.
    expect(block.toLowerCase()).toMatch(/polarizzat[oa]\s+80\/20/);
  });

  it("vieta race-pace specifico in base", () => {
    const block = macroPhaseBlock({ ...baseCtx(), phase: "base" });
    expect(block.toLowerCase()).toMatch(/no race-pace|niente race-pace/);
  });
});

describe("macroPhaseBlock — fase build", () => {
  it("menziona esplicitamente deload ogni 4 settimane", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "build",
      weekNumber: 5,
      volumeMultiplier: 1.2,
      intensityHighPct: 22,
    });
    expect(block.toLowerCase()).toContain("deload");
  });

  it("menziona introduzione sessioni di qualità", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "build",
      volumeMultiplier: 1.2,
      intensityHighPct: 22,
    });
    expect(block.toLowerCase()).toMatch(/qualit[àa]|soglia|ripetut/);
  });
});

describe("macroPhaseBlock — fase peak", () => {
  it("menziona race-pace specifico", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "peak",
      weekNumber: 9,
      volumeMultiplier: 0.9,
      intensityHighPct: 32,
    });
    expect(block.toLowerCase()).toContain("race-pace");
  });
});

describe("macroPhaseBlock — fase taper", () => {
  it("cita Mujika 2003 (riferimento scientifico)", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "taper",
      weekNumber: 11,
      weeksToRace: 1,
      volumeMultiplier: 0.5,
      intensityHighPct: 20,
    });
    expect(block).toMatch(/Mujika/);
  });

  it("specifica volume -40/-50% e intensità mantenuta", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "taper",
      weeksToRace: 1,
      volumeMultiplier: 0.5,
      intensityHighPct: 20,
    });
    // Riduzione volume + intensità mantenuta
    expect(block.toLowerCase()).toMatch(/-?40|-?50|41-60/);
    expect(block.toLowerCase()).toContain("intensit");
  });
});

describe("macroPhaseBlock — header e info race", () => {
  it("include nome race + sport + settimane mancanti", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "build",
      weeksToRace: 6,
      raceName: "Mezza di Treviso",
      raceSport: "corsa",
      volumeMultiplier: 1.2,
      intensityHighPct: 22,
    });
    expect(block).toContain("Mezza di Treviso");
    expect(block).toContain("corsa");
    expect(block).toContain("6");
  });

  it("include numero settimana e totale (es. 3/12)", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "base",
      weekNumber: 3,
      totalWeeks: 12,
    });
    expect(block).toMatch(/3\s*\/\s*12/);
  });
});

describe("macroPhaseBlock — direttive numeriche obbligatorie", () => {
  it("contiene il volume multiplier numerico (es. 1.20x)", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "build",
      volumeMultiplier: 1.2,
      intensityHighPct: 22,
    });
    // Il volume è formattato con .toFixed(2): "1.20x baseline"
    expect(block).toContain("1.20");
    expect(block.toLowerCase()).toContain("baseline");
  });

  it("contiene l'intensità high target (es. 22%)", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "build",
      volumeMultiplier: 1.2,
      intensityHighPct: 22,
    });
    expect(block).toMatch(/22\s*%/);
  });

  it("formatta volume +20% per build (1.2x baseline)", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "build",
      volumeMultiplier: 1.2,
      intensityHighPct: 22,
    });
    expect(block).toContain("+20%");
  });

  it("formatta volume -50% per taper (0.5x baseline)", () => {
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "taper",
      volumeMultiplier: 0.5,
      intensityHighPct: 20,
      weeksToRace: 1,
    });
    expect(block).toContain("-50%");
  });
});

describe("macroPhaseBlock — token budget", () => {
  it("è entro ~400 token (~1600 caratteri stima conservativa)", () => {
    // Token budget proxy: ~4 char/token (italiano), 400 token ≈ 1600 char.
    // Test conservativo: ammettiamo fino a 2400 char (600 token) per
    // non flaggare false positive su frasi leggermente più lunghe.
    const block = macroPhaseBlock({
      ...baseCtx(),
      phase: "build",
      volumeMultiplier: 1.2,
      intensityHighPct: 22,
    });
    expect(block.length).toBeLessThan(2400);
  });
});

describe("macroPhaseBlock — obbligo citazione fase nel rationale", () => {
  it("istruisce esplicitamente l'LLM a citare la fase corrente", () => {
    const block = macroPhaseBlock({ ...baseCtx(), phase: "base" });
    expect(block.toLowerCase()).toContain("rationale");
    expect(block.toLowerCase()).toMatch(/cita|citare|esplicitamente/);
  });
});

describe("taperingBlock (legacy / safety net)", () => {
  it("cita Bosquet 2007 e specifica giorni", () => {
    const block = taperingBlock(10);
    expect(block).toContain("Bosquet 2007");
    expect(block).toContain("10 giorni");
  });
});
