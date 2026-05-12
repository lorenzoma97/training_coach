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
// NB jsdom + vitest: generateAsync({type:"blob"}) con file content Uint8Array
// produce Blob malformato (file._data non riconosciuto da JSZip.loadAsync).
// Workaround: generateAsync({type:"uint8array"}) + new Blob([u8]) per ottenere
// Blob standard con arrayBuffer() funzionante. In prod l'utente carica File
// reali dal disco, niente bug.
async function buildExerciseZip(csv: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file("com.samsung.shealth.exercise.20260508.csv", new TextEncoder().encode(csv));
  const u8 = await zip.generateAsync({ type: "uint8array" });
  return new Blob([u8], { type: "application/zip" });
}

async function buildEmptyZip(): Promise<Blob> {
  const zip = new JSZip();
  zip.file("readme.txt", "no exercise here");
  const u8 = await zip.generateAsync({ type: "uint8array" });
  return new Blob([u8], { type: "application/zip" });
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
    expect(preview.matchedWorkouts).toEqual([]);
    // L'assenza di exercise CSV è segnalata in parseErrors, NON come crash.
    expect(preview.parseErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("previewImport con dati → mostra stats + bottone Conferma abilitabile", async () => {
    const csv = [
      "exercise_type,start_time,end_time,mean_heart_rate,distance,calorie",
      "Running,2026-05-08 07:00:00,2026-05-08 07:45:00,145,8500,480",
      "Yoga,2026-05-09 18:00:00,2026-05-09 18:30:00,,,150",
    ].join("\n");
    const zip = await buildExerciseZip(csv);

    const preview = await previewImport(zip);
    expect(preview.totalSamples).toBe(2);
    expect(preview.newWorkouts.length).toBe(2);
    expect(preview.matchedWorkouts.length).toBe(0);
    // Stats che la UI mostra: totale, nuovi, matched, unrecognized, parseErrors
    expect(preview.unrecognizedTypes).toEqual([]);
    expect(preview.parseErrors).toEqual([]);
    // Sample shape minimo per il rendering della lista preview UI:
    for (const s of preview.newWorkouts) {
      expect(typeof s.startedAt).toBe("string");
      expect(typeof s.duration_min).toBe("number");
      expect(typeof s.mappedType).toBe("string");
    }
    // Bottone Conferma è abilitabile sse newWorkouts.length > 0
    expect(preview.newWorkouts.length > 0).toBe(true);
  });

  it("Click Conferma → commitImport chiamato e ritorna CommitResult", async () => {
    const csv = [
      "exercise_type,start_time,end_time,mean_heart_rate",
      "Running,2026-05-08 07:00:00,2026-05-08 07:45:00,145",
    ].join("\n");
    const zip = await buildExerciseZip(csv);
    const preview = await previewImport(zip);

    // Simuliamo il click "Conferma": handler chiama commitImport(preview)
    const result = await commitImport(preview);
    expect(result.workoutsCreated).toBe(1);
    expect(result.duplicatesSkipped).toBe(0);
    expect(typeof result.importLogId).toBe("string");
    expect(result.importLogId.length).toBeGreaterThan(0);

    // Verifica side-effect: workout scritto in storage (letto dal Diario via
    // events emit "workout:saved" → reload day:YYYY-MM-DD)
    const dayRaw = localStorage.getItem("day:2026-05-08");
    expect(dayRaw).not.toBeNull();
    const day = JSON.parse(dayRaw!);
    expect(day.workouts.length).toBe(1);
    expect(day.workouts[0].fields.source).toBe("samsung_health");
  });

  it("Bottone Conferma disabled se preview.newWorkouts.length === 0", async () => {
    // Caso: tutti i sample sono già registrati → matchedWorkouts > 0, newWorkouts = 0.
    const csv = [
      "exercise_type,start_time,end_time,mean_heart_rate",
      "Running,2026-05-08 07:00:00,2026-05-08 07:45:00,145",
    ].join("\n");
    const zip = await buildExerciseZip(csv);

    // Pre-popola storage con un workout che matcha
    localStorage.setItem("day:2026-05-08", JSON.stringify({
      daily: null,
      workouts: [{
        id: "w-existing",
        type: "corsa",
        fields: { durata_totale: 45 },
        createdAt: "2026-05-08T07:30:00Z",
      }],
    }));
    localStorage.setItem("diary-index", JSON.stringify(["2026-05-08"]));

    const preview = await previewImport(zip);
    expect(preview.newWorkouts.length).toBe(0);
    expect(preview.matchedWorkouts.length).toBe(1);
    // Logica UI: il bottone Conferma è disabled se newWorkouts === 0
    const confirmDisabled = preview.newWorkouts.length === 0;
    expect(confirmDisabled).toBe(true);
  });
});
