// FASE 2 — Golden test per src/lib/time.ts (fonte unica matematica date).
//
// Coprono i casi che in passato divergevano tra le ~5 implementazioni
// duplicate, inclusi i due boundary DST di Europe/Rome 2026:
//   - inizio ora legale: domenica 2026-03-29 (lancetta avanti 02→03)
//   - fine ora legale:   domenica 2026-10-25 (lancetta indietro 03→02)
// Questi test sono TZ-indipendenti (non leggono l'orologio salvo dove indicato)
// perché operano su componenti calendariali, non su millisecondi assoluti.

import { describe, it, expect } from "vitest";
import {
  isValidISO, parseISO, toISO, addDays, dayIndexMon, dayLabel,
  mondayOf, weekEnd, daysBetween, DAY_LABELS_MON,
} from "../time";

describe("isValidISO", () => {
  it.each(["2026-06-15", "2026-01-01", "2026-12-31", "2024-02-29"])(
    "accetta %s", (s) => expect(isValidISO(s)).toBe(true));
  it.each(["2026-6-1", "2026-13-01", "2026-02-30", "2026-00-10", "abc", "", "2026/06/15", "2026-06-15T00:00"])(
    "rifiuta %s", (s) => expect(isValidISO(s)).toBe(false));
  it("rifiuta non-stringhe", () => {
    expect(isValidISO(null)).toBe(false);
    expect(isValidISO(undefined)).toBe(false);
    expect(isValidISO(20260615 as unknown)).toBe(false);
  });
});

describe("parseISO / toISO round-trip (locale)", () => {
  it.each(["2026-06-15", "2026-01-01", "2026-12-31", "2026-03-29", "2026-10-25"])(
    "%s round-trip stabile", (s) => {
      const d = parseISO(s)!;
      expect(d).not.toBeNull();
      expect(toISO(d)).toBe(s);
    });
  it("parseISO è mezzanotte locale (ore 0)", () => {
    const d = parseISO("2026-06-15")!;
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(5);
  });
  it("parseISO invalida → null", () => {
    expect(parseISO("2026-02-30")).toBeNull();
    expect(parseISO("nope")).toBeNull();
  });
});

describe("addDays (DST-safe, componenti calendariali)", () => {
  it.each([
    ["2026-06-15", 1, "2026-06-16"],
    ["2026-06-15", -1, "2026-06-14"],
    ["2026-06-30", 1, "2026-07-01"],   // boundary mese
    ["2026-12-31", 1, "2027-01-01"],   // boundary anno
    ["2026-03-01", -1, "2026-02-28"],
    ["2024-02-28", 1, "2024-02-29"],   // bisestile
    ["2026-06-15", 7, "2026-06-22"],
  ])("addDays(%s, %d) = %s", (iso, n, exp) => expect(addDays(iso, n)).toBe(exp));

  it("attraversa l'inizio dell'ora legale senza perdere un giorno (2026-03-28 +1 = 2026-03-29)", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });
  it("attraversa la fine dell'ora legale (2026-10-24 +1 = 2026-10-25, +2 = 2026-10-26)", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
  it("invalida → null", () => expect(addDays("bad", 1)).toBeNull());
});

describe("dayIndexMon / dayLabel (lun=0)", () => {
  // Settimana di riferimento: lun 2026-06-08 … dom 2026-06-14.
  it.each([
    ["2026-06-08", 0, "lun"],
    ["2026-06-09", 1, "mar"],
    ["2026-06-10", 2, "mer"],
    ["2026-06-11", 3, "gio"],
    ["2026-06-12", 4, "ven"],
    ["2026-06-13", 5, "sab"],
    ["2026-06-14", 6, "dom"],
  ])("%s → idx %d, label %s", (iso, idx, label) => {
    expect(dayIndexMon(iso)).toBe(idx);
    expect(dayLabel(iso)).toBe(label);
  });
  it("DAY_LABELS_MON allineato all'indice", () => {
    expect(DAY_LABELS_MON).toEqual(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]);
    expect(DAY_LABELS_MON[dayIndexMon("2026-06-13")]).toBe("sab");
  });
  it("invalida → -1 / null", () => {
    expect(dayIndexMon("bad")).toBe(-1);
    expect(dayLabel("bad")).toBeNull();
  });
});

describe("mondayOf / weekEnd (settimana lun→dom)", () => {
  it.each([
    ["2026-06-08", "2026-06-08"], // lunedì → se stesso
    ["2026-06-10", "2026-06-08"], // mercoledì
    ["2026-06-14", "2026-06-08"], // domenica → lunedì della STESSA settimana
    ["2026-06-15", "2026-06-15"], // lunedì successivo
  ])("mondayOf(%s) = %s", (iso, exp) => expect(mondayOf(iso)).toBe(exp));

  it("weekEnd = domenica della stessa settimana", () => {
    expect(weekEnd("2026-06-08")).toBe("2026-06-14");
    expect(weekEnd("2026-06-10")).toBe("2026-06-14");
    expect(weekEnd("2026-06-14")).toBe("2026-06-14");
  });
  it("mondayOf attraverso il boundary DST di marzo resta corretto", () => {
    // 2026-03-29 (dom, inizio ora legale) → lunedì 2026-03-23.
    expect(mondayOf("2026-03-29")).toBe("2026-03-23");
    expect(mondayOf("2026-03-30")).toBe("2026-03-30"); // lunedì successivo
  });
  it("invalida → null", () => {
    expect(mondayOf("bad")).toBeNull();
    expect(weekEnd("bad")).toBeNull();
  });
});

describe("daysBetween (giorni interi, DST-safe)", () => {
  it.each([
    ["2026-06-15", "2026-06-15", 0],
    ["2026-06-15", "2026-06-16", 1],
    ["2026-06-16", "2026-06-15", -1],
    ["2026-06-08", "2026-06-15", 7],
    ["2026-06-01", "2026-07-01", 30],
    ["2026-12-31", "2027-01-01", 1],
  ])("daysBetween(%s, %s) = %d", (a, b, exp) => expect(daysBetween(a, b)).toBe(exp));

  it("DST marzo: 7 giorni civili restano 7 (no off-by-one da 23h)", () => {
    // Lun prima dell'ora legale → lun dopo: deve essere 7, non 6.
    expect(daysBetween("2026-03-23", "2026-03-30")).toBe(7);
  });
  it("DST ottobre: 7 giorni civili restano 7 (no off-by-one da 25h)", () => {
    expect(daysBetween("2026-10-19", "2026-10-26")).toBe(7);
  });
  it("attraversa entrambi i boundary su finestre lunghe", () => {
    // dal 2026-03-23 al 2026-10-26 = 217 giorni esatti.
    expect(daysBetween("2026-03-23", "2026-10-26")).toBe(217);
  });
  it("invalida → null", () => {
    expect(daysBetween("bad", "2026-06-15")).toBeNull();
    expect(daysBetween("2026-06-15", "bad")).toBeNull();
  });
});
