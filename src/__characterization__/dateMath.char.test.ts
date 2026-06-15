// FASE 0 — Test di CARATTERIZZAZIONE: matematica date/settimana.
//
// Fotografa il comportamento ATTUALE di `mondayOf` e `computeMacroProgress`
// (lib/macroprogram/storage.ts) prima dell'unificazione in time.ts (Fase 2).
//
// Storia: in Fase 0 questo file pinnava il BUG A1 (computeMacroProgress
// confrontava `Date.parse(monday)` UTC con mezzanotte LOCALE → in Europe/Rome
// la settimana del macro avanzava il MARTEDÌ e il primo lunedì risultava
// "non iniziato"). Fixato in Fase 1: parse locale coerente, currentWeek
// corretto anche di lunedì. Il blocco Rome gira solo con TZ=Europe/Rome
// (step CI dedicato) e verifica il comportamento corretto in ogni giorno.

import { describe, it, expect } from "vitest";
import { mondayOf, computeMacroProgress } from "../lib/macroprogram/storage";
import type { MacroProgram } from "../lib/types/macroprogram";

function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("mondayOf (caratterizzazione, TZ-indipendente: parse e format entrambi locali)", () => {
  // Settimana di riferimento fissa: lun 2026-06-08 … dom 2026-06-14.
  it.each([
    ["2026-06-08", "2026-06-08"], // lunedì → se stesso
    ["2026-06-10", "2026-06-08"], // mercoledì
    ["2026-06-13", "2026-06-08"], // sabato
    ["2026-06-14", "2026-06-08"], // domenica → lunedì della STESSA settimana (lun-dom)
    ["2026-06-15", "2026-06-15"], // lunedì successivo
  ])("mondayOf(%s) → %s", (input, expected) => {
    expect(mondayOf(input)).toBe(expected);
  });

  it("input invalido → null", () => {
    expect(mondayOf("abc")).toBeNull();
    expect(mondayOf("2026-13-45")).toBeNull();
    expect(mondayOf("")).toBeNull();
  });
});

function makeProgram(startDate: string, weeksTotal = 12): MacroProgram {
  return {
    metadata: {
      title: "Programma test",
      start_date: startDate,
      weeks_total: weeksTotal,
    },
    phases: [{ name: "Base", weeks: [1, weeksTotal] }],
    weeks: [],
    narrative_markdown: "",
  } as unknown as MacroProgram;
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe.skipIf(tz !== "Europe/Rome")(
  "computeMacroProgress in Europe/Rome (fix A1, Fase 1)",
  () => {
    it("start_date = lunedì della settimana corrente → currentWeek 1, anche di lunedì", () => {
      const monday = mondayOf(localDate(0))!;
      const progress = computeMacroProgress(makeProgram(monday));
      expect(progress).not.toBeNull();
      // Fase 0 pinnava il BUG A1: di lunedì usciva 0 ("non iniziato") per il
      // mix UTC/locale. Dal fix il parse è locale coerente: sempre 1.
      expect(progress!.currentWeek).toBe(1);
    });

    it("start_date = lunedì di 7 giorni fa → currentWeek 2, anche di lunedì", () => {
      const mondayLastWeek = mondayOf(localDate(-7))!;
      const progress = computeMacroProgress(makeProgram(mondayLastWeek));
      expect(progress).not.toBeNull();
      // Fase 0 pinnava lo scatto di settimana al martedì; ora scatta al lunedì.
      expect(progress!.currentWeek).toBe(2);
    });

    it("start_date futura (lunedì prossimo) → currentWeek 0, pre-start", () => {
      const nextMonday = mondayOf(localDate(+7))!;
      const progress = computeMacroProgress(makeProgram(nextMonday));
      expect(progress).not.toBeNull();
      expect(progress!.currentWeek).toBe(0);
    });
  },
);

describe("computeMacroProgress invarianti TZ-indipendenti", () => {
  it("start_date assente → null", () => {
    const p = makeProgram("");
    (p.metadata as { start_date?: string }).start_date = undefined;
    expect(computeMacroProgress(p)).toBeNull();
  });

  it("oltre weeks_total → currentWeek = weeks_total + 1", () => {
    // 13 settimane fa (91 giorni): programma da 12 settimane → "completato".
    const longAgo = mondayOf(localDate(-91))!;
    const progress = computeMacroProgress(makeProgram(longAgo, 12));
    expect(progress).not.toBeNull();
    expect(progress!.currentWeek).toBe(13);
  });
});
