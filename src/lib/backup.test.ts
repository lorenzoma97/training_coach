import { describe, it, expect } from "vitest";
import { validateBackup, type BackupPayload } from "./backup";

/**
 * Test della migration v1 → v2 (Wave 2.1, Personal Trainer Pro).
 * Non testiamo restoreBackup (richiede mock localStorage); copriamo il
 * comportamento della validazione + migration che è puro e in-memory.
 */

function makeV1Backup(overrides: Partial<BackupPayload["data"]> = {}): unknown {
  return {
    schema: "training-coach-backup",
    version: 1,
    exportedAt: "2026-04-01T00:00:00Z",
    appVersion: "0.1.0",
    data: {
      "user-profile": {
        age: 28,
        sex: "m",
        weight_kg: 81,
        height_cm: 180,
        experience: "regular",
        injuries: [],
        meds: "",
        weekly_availability: { days: 4, hoursPerSession: 1 },
        equipment: ["manubri"],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      days: {},
      ...overrides,
    },
  };
}

describe("validateBackup base", () => {
  it("rejects null/undefined", () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup(undefined).ok).toBe(false);
  });

  it("rejects wrong schema marker", () => {
    const r = validateBackup({ schema: "wrong", version: 1, data: { days: {} } });
    expect(r.ok).toBe(false);
  });

  it("rejects payload without data", () => {
    const r = validateBackup({ schema: "training-coach-backup", version: 1 });
    expect(r.ok).toBe(false);
  });

  it("accepts a minimal v1 backup", () => {
    const r = validateBackup(makeV1Backup());
    expect(r.ok).toBe(true);
  });

  it("accepts a minimal v2 backup", () => {
    const r = validateBackup({
      schema: "training-coach-backup",
      version: 2,
      exportedAt: "2026-05-09T00:00:00Z",
      appVersion: "0.2.0",
      data: { days: {} },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a future schema version (v99)", () => {
    const r = validateBackup({
      schema: "training-coach-backup",
      version: 99,
      data: { days: {} },
    });
    expect(r.ok).toBe(false);
  });
});

describe("migrateToLatest v1 → v2", () => {
  it("promotes version field 1 → 2", () => {
    const r = validateBackup(makeV1Backup());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.version).toBe(2);
  });

  it("hydrates user-1rm-history with empty array", () => {
    const r = validateBackup(makeV1Backup());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.data["user-1rm-history"]).toEqual([]);
  });

  it("hydrates user-races with empty array", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) expect(r.payload.data["user-races"]).toEqual([]);
  });

  it("hydrates wearable-import-log with empty array", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) expect(r.payload.data["wearable-import-log"]).toEqual([]);
  });

  it("hydrates wearable-samples-v1 with empty array", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) expect(r.payload.data["wearable-samples-v1"]).toEqual([]);
  });

  it("hydrates readiness-history with empty array", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) expect(r.payload.data["readiness-history"]).toEqual([]);
  });

  it("hydrates macro-cycles with empty object", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) expect(r.payload.data["macro-cycles"]).toEqual({});
  });

  it("leaves exercise-db-version undefined (catalog version is bundled)", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) expect(r.payload.data["exercise-db-version"]).toBeUndefined();
  });

  it("leaves mobility-routines-version undefined (catalog version is bundled)", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) expect(r.payload.data["mobility-routines-version"]).toBeUndefined();
  });

  it("preserves existing v1 user data unchanged", () => {
    const r = validateBackup(makeV1Backup());
    if (r.ok) {
      const profile = r.payload.data["user-profile"] as { age: number };
      expect(profile.age).toBe(28);
    }
  });

  it("does NOT overwrite v2 fields if a v1 payload accidentally has them", () => {
    const v1WithRace = makeV1Backup({
      "user-races": [
        {
          id: "r1",
          name: "X",
          sport: "corsa",
          date: "2026-09-15",
          priority: "A",
          createdAt: "2026-05-09T10:00:00Z",
        },
      ],
    });
    const r = validateBackup(v1WithRace);
    if (r.ok) {
      const races = r.payload.data["user-races"] as unknown[];
      expect(races.length).toBe(1);
    }
  });

  it("v2 backup is not migrated again (idempotent on v2 input)", () => {
    const r = validateBackup({
      schema: "training-coach-backup",
      version: 2,
      exportedAt: "2026-05-09T00:00:00Z",
      appVersion: "0.2.0",
      data: { days: {}, "user-races": [] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.version).toBe(2);
      // user-races resta esattamente l'array passato (non sovrascritto da [] migration)
      expect(r.payload.data["user-races"]).toEqual([]);
    }
  });

  // Test 2 — chiavi extra non-v2 nel payload v1 devono essere preservate.
  // Scenario: una vecchia versione (o un fork) ha salvato chiavi custom dentro
  // `data`. La migration v1 → v2 NON deve cancellarle: data-loss inaccettabile
  // anche se la chiave non è nella shape ufficiale.
  it("preserves non-v2 extra keys in v1 payload (no data loss)", () => {
    const v1WithExtras = {
      schema: "training-coach-backup",
      version: 1,
      exportedAt: "2026-04-01T00:00:00Z",
      appVersion: "0.1.0",
      data: {
        "user-profile": {
          age: 28,
          sex: "m",
          weight_kg: 81,
          height_cm: 180,
          experience: "regular",
          injuries: [],
          meds: "",
          weekly_availability: { days: 4, hoursPerSession: 1 },
          equipment: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        days: {},
        // Chiavi non previste dallo schema v1 né v2 — fork/sperimentazioni.
        "custom-fork-key": { foo: "bar" },
        "legacy-experiment-flag": true,
      },
    };
    const r = validateBackup(v1WithExtras);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Le chiavi extra sopravvivono alla migration.
      const data = r.payload.data as Record<string, unknown>;
      expect(data["custom-fork-key"]).toEqual({ foo: "bar" });
      expect(data["legacy-experiment-flag"]).toBe(true);
      // I default v2 sono comunque applicati.
      expect(data["user-1rm-history"]).toEqual([]);
      expect(data["macro-cycles"]).toEqual({});
    }
  });

  // Test 4 — backup v3 (future schema) → reject con messaggio chiaro.
  // Contratto pubblico verso l'utente: deve includere la stringa
  // "Versione backup <N> più recente di quella supportata" così l'utente
  // capisce che deve aggiornare l'app prima di importare.
  it("rejects future schema version with explicit error message", () => {
    const r = validateBackup({
      schema: "training-coach-backup",
      version: 3,
      exportedAt: "2027-01-01T00:00:00Z",
      appVersion: "0.9.0",
      data: { days: {} },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Messaggio deve menzionare la versione ricevuta + quella supportata.
      expect(r.error).toContain("Versione backup 3");
      expect(r.error).toContain("più recente di quella supportata");
      expect(r.error).toContain("v2");
    }
  });
});
