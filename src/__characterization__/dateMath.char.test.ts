// FASE 0 — Test di CARATTERIZZAZIONE: matematica date/settimana.
//
// Fotografa il comportamento ATTUALE di `mondayOf` e `computeMacroProgress`
// (lib/macroprogram/storage.ts) prima dell'unificazione in time.ts (Fase 2).
//
// BUG A1 documentato (audit 2026-06-12): computeMacroProgress confronta
// `Date.parse(monday)` (mezzanotte UTC) con `today.setHours(0,0,0,0)`
// (mezzanotte LOCALE) → in TZ Europe/Rome (UTC+1/+2) la settimana del macro
// avanza il MARTEDÌ: per tutto il lunedì `currentWeek` resta indietro di 1
// (e vale 0, "non iniziato", l'intero primo lunedì del programma).
//
// I test del blocco Rome girano solo con TZ=Europe/Rome (step CI dedicato);
// pinnano il comportamento corrente GIORNO-PER-GIORNO: di lunedì si aspettano
// il valore sbagliato. Quando il bug verrà fixato (Fase 2), questi test
// falliranno di lunedì in CI: aggiornarli togliendo il ramo `isMonday`.

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
  "computeMacroProgress in Europe/Rome (caratterizzazione BUG A1)",
  () => {
    const isMonday = new Date().getDay() === 1;

    it("start_date = lunedì della settimana corrente → currentWeek atteso 1 (oggi vale " +
      `${isMonday ? "0 per il BUG A1" : "1"})`, () => {
      const monday = mondayOf(localDate(0))!;
      const progress = computeMacroProgress(makeProgram(monday));
      expect(progress).not.toBeNull();
      // BUG A1: di lunedì days = floor(-2h/24h) = -1 → currentWeek 0 ("non
      // iniziato") per l'intero primo giorno del programma. Da martedì in poi
      // il valore è corretto. Col fix: sempre 1.
      expect(progress!.currentWeek).toBe(isMonday ? 0 : 1);
    });

    it("start_date = lunedì di 7 giorni fa → currentWeek atteso 2 (oggi vale " +
      `${isMonday ? "1 per il BUG A1" : "2"})`, () => {
      const mondayLastWeek = mondayOf(localDate(-7))!;
      const progress = computeMacroProgress(makeProgram(mondayLastWeek));
      expect(progress).not.toBeNull();
      // BUG A1: la settimana del macro "scatta" il martedì, non il lunedì.
      expect(progress!.currentWeek).toBe(isMonday ? 1 : 2);
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
