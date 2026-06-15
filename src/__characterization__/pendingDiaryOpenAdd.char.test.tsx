// FASE 0 — Test di CARATTERIZZAZIONE: contratto `pending-diary-openAdd` → DiaryApp.
//
// Il deep-link Piano→Diario attraversa un cambio tab (componenti a mount
// esclusivo): l'emettitore DEVE scrivere `pending-diary-openAdd` PRIMA di
// emettere `diary:openAdd`, perché DiaryApp consuma la chiave al mount
// (DiaryApp.tsx:527-536). Questi test fotografano il lato consumer.
//
// Storia: in Fase 0 questo file pinnava due bug (C1 lato producer: CoachPageV2
// emetteva senza scrivere il pending → payload perso; C1-bis: subtype per
// type="sport" scartato). Entrambi fixati in Fase 1: i 3 emettitori di
// CoachPageV2 ora scrivono il pending prima dell'emit e applyOpenAddPayload
// mappa il subtype anche sul campo `sport`.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DiaryApp from "../components/DiaryApp";
import type { UserProfile } from "../lib/types";

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

function seed(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function minimalProfile(): UserProfile {
  return {
    age: 28, sex: "m", weight_kg: 81, height_cm: 178,
    experience: "regular", injuries: [], meds: "",
    weekly_availability: { days: 4, hoursPerSession: 1 },
    equipment: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as UserProfile;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new LocalStorageMock(),
    configurable: true,
    writable: true,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed("diary-index", []);
  seed("user-profile", minimalProfile());
});

describe("DiaryApp consumo pending-diary-openAdd al mount (caratterizzazione)", () => {
  it("corsa: apre il form con tipo/durata/note prefillati e azzera la chiave", async () => {
    seed("pending-diary-openAdd", {
      type: "corsa",
      date: "2026-06-10",
      prefill: { subtype: "Fondo Lento", durata_totale: 30 },
      notes: "Sessione dal piano",
    });

    render(<DiaryApp />);

    // Il pending viene consumato (azzerato a null) una volta sola.
    await waitFor(() => {
      expect(localStorage.getItem("pending-diary-openAdd")).toBe("null");
    });
    // Form "aggiungi" aperto con i valori del payload.
    expect(await screen.findByDisplayValue("Fondo Lento")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("30")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Sessione dal piano")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("2026-06-10")).toBeInTheDocument();
  });

  it("senza pending: nessun form aperto, chiave intatta (assente)", async () => {
    render(<DiaryApp />);
    await waitFor(() => {
      // refresh() iniziale completato: l'app è montata e il pending resta assente.
      expect(localStorage.getItem("pending-diary-openAdd")).toBeNull();
    });
    expect(screen.queryByDisplayValue("Fondo Lento")).toBeNull();
  });

  it("type='sport': subtype prefillato nel select 'sport' (fix C1-bis, Fase 1)", async () => {
    seed("pending-diary-openAdd", {
      type: "sport",
      prefill: { subtype: "Tennis", durata: 60 },
    });

    render(<DiaryApp />);

    await waitFor(() => {
      expect(localStorage.getItem("pending-diary-openAdd")).toBe("null");
    });
    expect(await screen.findByDisplayValue("60")).toBeInTheDocument();
    // Fase 0 pinnava la perdita del subtype (mappato solo su "tipo");
    // dal fix C1-bis applyOpenAddPayload mappa anche il campo "sport".
    expect(await screen.findByDisplayValue("Tennis")).toBeInTheDocument();
  });
});
