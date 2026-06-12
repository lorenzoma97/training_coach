// FASE 0 — Test di CARATTERIZZAZIONE: matching completion piano↔diario
// (TrainingPlanView.matchResult, oggi inline nel componente a 1.807 LOC,
// 0 test — finding A7 dell'audit 2026-06-12).
//
// Fotografa i 3 esiti del matching renderizzati come badge:
//   ✓ FATTA  = stesso giorno + stesso tipo + stesso subtype (strict)
//   VARIATA  = stesso giorno + stesso tipo, subtype diverso (non-strict)
//   SALTATA  = sessione passata senza workout corrispondente
// In Fase 2 questa logica sarà estratta in lib/coach/completion.ts: questi
// test sono il contratto che l'estrazione NON deve cambiare.
//
// NOTA date dinamiche: il piano è ancorato al lunedì della settimana di
// (oggi-2). Con oggi = lunedì o martedì le due date di test cadrebbero a
// cavallo di due settimane di piano → skip (il resto della suite copre quei
// giorni; questo file gira mer-dom).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TrainingPlanView from "../components/TrainingPlanView";
import { mondayOf } from "../lib/macroprogram/storage";
import type { TrainingPlan, UserProfile } from "../lib/types";

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
function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Label giorno it ("lun".."dom") per una data YYYY-MM-DD, coerente col piano. */
function dayLabel(dateISO: string): string {
  const LABELS = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
  const [y, m, d] = dateISO.split("-").map(Number);
  return LABELS[new Date(y, m - 1, d).getDay()];
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

const dow = new Date().getDay(); // 1 = lunedì, 2 = martedì

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new LocalStorageMock(),
    configurable: true,
    writable: true,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.skipIf(dow === 1 || dow === 2)(
  "TrainingPlanView matching completion (caratterizzazione)",
  () => {
    it("badge ✓ FATTA / VARIATA / SALTATA secondo le regole attuali", async () => {
      const dB = localDate(-2); // due giorni fa: FATTA (strict)
      const dA = localDate(-1); // ieri: VARIATA + SALTATA
      const monday = mondayOf(dB)!;

      const plan: TrainingPlan = {
        generatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
        startDate: monday,
        weeks: [{
          weekNumber: 1,
          focus: "test",
          sessions: [
            // 1) Pianificata corsa Fondo Lento il giorno dB; nel diario c'è
            //    una corsa Fondo Lento quel giorno → strict match → ✓ FATTA.
            { day: dayLabel(dB), type: "corsa", subtype: "Fondo Lento", duration_min: 40, details: "", rationale: "" },
            // 2) Pianificata corsa Ripetute il giorno dA; nel diario quel
            //    giorno c'è una corsa ma Fondo Lento → stesso tipo, subtype
            //    diverso → VARIATA. (Nota caratterizzante: la DURATA non entra
            //    mai nel matching.)
            { day: dayLabel(dA), type: "corsa", subtype: "Ripetute", duration_min: 50, details: "", rationale: "" },
            // 3) Pianificata forza_gambe il giorno dA, nessun workout forza
            //    nel diario → giorno passato → SALTATA.
            { day: dayLabel(dA), type: "forza_gambe", subtype: "Forza Massimale", duration_min: 45, details: "", rationale: "" },
          ],
        }],
        rationale: "piano di caratterizzazione",
      };

      seed("training-plan", plan);
      seed("user-profile", minimalProfile());
      seed("user-goals", []);
      seed("diary-index", [dB, dA]);
      seed(`day:${dB}`, {
        daily: null,
        workouts: [{
          id: "w-strict", type: "corsa",
          fields: { tipo: "Fondo Lento", durata_totale: 41, fc_media: 142 },
          createdAt: new Date().toISOString(),
        }],
      });
      seed(`day:${dA}`, {
        daily: null,
        workouts: [{
          id: "w-varied", type: "corsa",
          fields: { tipo: "Fondo Lento", durata_totale: 35 },
          createdAt: new Date().toISOString(),
        }],
      });

      render(<TrainingPlanView />);

      // I tre badge devono comparire esattamente una volta ciascuno.
      expect(await screen.findByText("✓ FATTA", undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(await screen.findByText("VARIATA")).toBeInTheDocument();
      expect(await screen.findByText("SALTATA")).toBeInTheDocument();
      expect(screen.getAllByText("✓ FATTA")).toHaveLength(1);
      expect(screen.getAllByText("VARIATA")).toHaveLength(1);
      expect(screen.getAllByText("SALTATA")).toHaveLength(1);
    });

    it("workout con data diversa dal pianificato: SALTATA (nessun matching cross-day)", async () => {
      const dB = localDate(-2);
      const dA = localDate(-1);
      const monday = mondayOf(dB)!;

      const plan: TrainingPlan = {
        generatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
        startDate: monday,
        weeks: [{
          weekNumber: 1,
          focus: "test",
          sessions: [
            // Pianificata il giorno dB, eseguita (identica) il giorno dA:
            // comportamento ATTUALE = SALTATA + workout AUTONOMO, nessun
            // riaggancio cross-day (TrainingPlanView.tsx:490-492).
            { day: dayLabel(dB), type: "corsa", subtype: "Fondo Lento", duration_min: 40, details: "", rationale: "" },
          ],
        }],
        rationale: "piano cross-day",
      };

      seed("training-plan", plan);
      seed("user-profile", minimalProfile());
      seed("user-goals", []);
      seed("diary-index", [dA]);
      seed(`day:${dA}`, {
        daily: null,
        workouts: [{
          id: "w-crossday", type: "corsa",
          fields: { tipo: "Fondo Lento", durata_totale: 40 },
          createdAt: new Date().toISOString(),
        }],
      });

      render(<TrainingPlanView />);

      expect(await screen.findByText("SALTATA", undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(screen.queryByText("✓ FATTA")).toBeNull();
      expect(screen.queryByText("VARIATA")).toBeNull();
    });
  },
);
