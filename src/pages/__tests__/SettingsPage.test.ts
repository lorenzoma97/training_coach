// Wave 3.2 — Smoke + integrazione minima per SettingsPage Samsung Health import.
// Pattern test puro Node (no RTL/jsdom — segui pattern esistente del progetto).
//
// Cosa testiamo:
//  - Smoke import: SettingsPage si importa senza crash (verifica che la nuova
//    sezione Samsung Health non rompa il modulo).
//  - Integrazione boundary lib/integrations/samsungHealth: previewImport /
//    commitImport sono funzioni callabili e producono shape attesa quando
//    invocate con uno ZIP buildato in-memory (smoke contract con Data Int).
//  - previewImport vuoto (ZIP senza CSV) → preview valida con totalSamples=0.
//  - previewImport con dati → preview con stats coerenti e bottone Conferma
//    abilitabile (verificato via shape preview.newWorkouts.length).
//  - commitImport viene chiamato dopo preview e ritorna CommitResult.
//
// Nota: SettingsPage usa React + DOM API per il render, ma vitest gira in
// Node senza jsdom in questo progetto. I test renderizzanti vanno rinviati
// a un eventuale setup RTL futuro (tech-debt v3).

import { describe, it, expect, beforeEach, vi } from "vitest";
import JSZip from "jszip";
import SettingsPage from "../SettingsPage";
import RaceCalendarSection from "../../components/races/RaceCalendarSection";
import {
  previewImport,
  commitImport,
  type ImportPreview,
} from "../../lib/integrations/samsungHealth";

// ─── localStorage mock (shared con samsungHealth.test.ts) ───────────────────
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new LocalStorageMock(),
    configurable: true,
    writable: true,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ─── Helper: build minimal Samsung Health ZIP in-memory ─────────────────────
// Bug JSZip 3.10.x in jsdom: zip.file(name, Uint8Array) → generateAsync →
// loadAsync → file.async() fallisce con "Can't read the data of '<file>'".
// Workaround: passa STRING a zip.file() — JSZip eager-decodifica in UTF-8.
// In prod l'utente carica File reali dal disco, niente bug.
async function buildExerciseZip(csv: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file("com.samsung.shealth.exercise.20260508.csv", csv);
  return await zip.generateAsync({ type: "blob" });
}

async function buildEmptyZip(): Promise<Blob> {
  const zip = new JSZip();
  zip.file("readme.txt", "no exercise here");
  return await zip.generateAsync({ type: "blob" });
}

// ─── Smoke ──────────────────────────────────────────────────────────────────
describe("SettingsPage (smoke)", () => {
  it("imports without throwing", () => {
    expect(SettingsPage).toBeDefined();
    expect(typeof SettingsPage).toBe("function");
  });

  it("RaceCalendarSection è importabile (Wave 3.3 wiring)", () => {
    // Smoke contract: il SettingsPage rende RaceCalendarSection nella sezione
    // "Gestione dati". Senza RTL non possiamo asserire il render, ma
    // l'import side-by-side garantisce che il modulo sia risolvibile dal
    // bundler (stesso path che usa SettingsPage internamente).
    expect(RaceCalendarSection).toBeDefined();
    expect(typeof RaceCalendarSection).toBe("function");
  });
});

// ─── Boundary contract con samsungHealth lib ────────────────────────────────
describe("SettingsPage ↔ samsungHealth integration", () => {
  it("previewImport esposto come funzione (wiring intatto)", () => {
    expect(typeof previewImport).toBe("function");
    expect(typeof commitImport).toBe("function");
  });

  it("previewImport ritorna preview vuota se ZIP senza exercise CSV → 0 workout trovati", async () => {
    const zip = await buildEmptyZip();
    const preview: ImportPreview = await previewImport(zip);
    expect(preview.totalSamples).toBe(0);
    expect(preview.newWorkouts).toEqual([]);
    expect(preview.autoEnrichments).toEqual([]);
    expect(preview.ambiguousMatches).toEqual([]);
    expect(preview.windowDays).toBe(14);
    // L'assenza di exercise CSV è segnalata in parseErrors, NON come crash.
    expect(preview.parseErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("previewImport con dati → mostra stats + bottone Conferma abilitabile", async () => {
    // Date relative ad oggi per stare in finestra default 14gg
    const csv = [
      "exercise_type,start_time,end_time,mean_heart_rate,distance,calorie",
      `Running,${isoMinusDaysLocal(3, "07:00:00")},${isoMinusDaysLocal(3, "07:45:00")},145,8500,480`,
      `Yoga,${isoMinusDaysLocal(2, "18:00:00")},${isoMinusDaysLocal(2, "18:30:00")},,,150`,
    ].join("\n");
    const zip = await buildExerciseZip(csv);

    const preview = await previewImport(zip);
    expect(preview.totalSamples).toBe(2);
    expect(preview.newWorkouts.length).toBe(2);
    expect(preview.autoEnrichments.length).toBe(0);
    expect(preview.ambiguousMatches.length).toBe(0);
    // Stats che la UI mostra
    expect(preview.unrecognizedTypes).toEqual([]);
    expect(preview.parseErrors).toEqual([]);
    // Sample shape minimo per il rendering della lista preview UI:
    for (const s of preview.newWorkouts) {
      expect(typeof s.startedAt).toBe("string");
      expect(typeof s.duration_min).toBe("number");
      expect(typeof s.mappedType).toBe("string");
    }
    // Bottone Conferma abilitabile sse newWorkouts > 0 OR autoEnrichments > 0
    const totalActionable = preview.newWorkouts.length + preview.autoEnrichments.length;
    expect(totalActionable > 0).toBe(true);
  });

  it("Click Conferma → commitImport chiamato e ritorna CommitResult", async () => {
    const date3 = dateMinusDaysLocal(3);
    const csv = [
      "exercise_type,start_time,end_time,mean_heart_rate",
      `Running,${isoMinusDaysLocal(3, "07:00:00")},${isoMinusDaysLocal(3, "07:45:00")},145`,
    ].join("\n");
    const zip = await buildExerciseZip(csv);
    const preview = await previewImport(zip);

    const result = await commitImport(preview);
    expect(result.workoutsCreated).toBe(1);
    expect(result.workoutsEnriched).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.ambiguousResolved).toBe(0);
    expect(typeof result.importLogId).toBe("string");
    expect(result.importLogId.length).toBeGreaterThan(0);

    // Verifica side-effect
    const dayRaw = localStorage.getItem(`day:${date3}`);
    expect(dayRaw).not.toBeNull();
    const day = JSON.parse(dayRaw!);
    expect(day.workouts.length).toBe(1);
    expect(day.workouts[0].fields.source).toBe("samsung_health");
  });

  it("Bottone Conferma comunque attivo se solo autoEnrichments > 0", async () => {
    // Caso: workout manuale già registrato → sample arricchisce, no nuovi
    const date3 = dateMinusDaysLocal(3);
    const csv = [
      "exercise_type,start_time,end_time,mean_heart_rate",
      `Running,${isoMinusDaysLocal(3, "07:00:00")},${isoMinusDaysLocal(3, "07:45:00")},145`,
    ].join("\n");
    const zip = await buildExerciseZip(csv);

    // Workout manuale stesso giorno + stessa ora + stessa durata → certo
    localStorage.setItem(`day:${date3}`, JSON.stringify({
      daily: null,
      workouts: [{
        id: "w-existing",
        type: "corsa",
        fields: { durata_totale: 45 },
        createdAt: `${date3}T07:00:00Z`,
      }],
    }));
    localStorage.setItem("diary-index", JSON.stringify([date3]));

    const preview = await previewImport(zip);
    expect(preview.newWorkouts.length).toBe(0);
    expect(preview.autoEnrichments.length).toBe(1);
    // Bottone Conferma abilitato perché c'è qualcosa da fare (enrichment)
    const totalActionable = preview.newWorkouts.length + preview.autoEnrichments.length;
    expect(totalActionable).toBe(1);
  });
});

// Helper locali per generare date relative a oggi (in finestra default 14gg)
function isoMinusDaysLocal(daysAgo: number, time = "07:00:00"): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${time}`;
}
function dateMinusDaysLocal(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
