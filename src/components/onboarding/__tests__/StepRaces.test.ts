// Wave 2.2 — Smoke + unit test per la logica di StepRaces (NO React DOM perché
// in questo progetto vitest gira in Node senza jsdom). Testiamo:
//  - import del componente non lancia errori (smoke)
//  - EMPTY_RACES_DRAFT esposto correttamente

import { describe, it, expect } from "vitest";
import StepRaces, { EMPTY_RACES_DRAFT } from "../StepRaces";

describe("StepRaces (smoke)", () => {
  it("imports without throwing", () => {
    expect(StepRaces).toBeDefined();
    expect(typeof StepRaces).toBe("function");
  });

  it("EMPTY_RACES_DRAFT esposto con form vuoto e races []", () => {
    expect(EMPTY_RACES_DRAFT.races).toEqual([]);
    expect(EMPTY_RACES_DRAFT.form.name).toBe("");
    expect(EMPTY_RACES_DRAFT.form.sport).toBe("corsa");
    expect(EMPTY_RACES_DRAFT.form.priority).toBe("A");
    expect(EMPTY_RACES_DRAFT.form.date).toBe("");
    expect(EMPTY_RACES_DRAFT.form.distance_km).toBe("");
    expect(EMPTY_RACES_DRAFT.form.targetTime).toBe("");
    expect(EMPTY_RACES_DRAFT.form.notes).toBe("");
  });

  it("EMPTY_RACES_DRAFT è strutturalmente RaceEvent-compatibile per persistence skip", () => {
    // Skip path: l'utente non aggiunge nulla → onSave([]) → array vuoto valido.
    expect(Array.isArray(EMPTY_RACES_DRAFT.races)).toBe(true);
    expect(EMPTY_RACES_DRAFT.races.length).toBe(0);
  });
});
