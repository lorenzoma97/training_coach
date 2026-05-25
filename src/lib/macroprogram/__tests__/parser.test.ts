// Golden tests per parseMacroProgramMarkdown (Sprint 2, 2026-05-25).
// Coprono:
// 1. Parse minimale (programma 1-week, 1 esercizio forza)
// 2. Parse completo (5-week multi-fase, mix forza/cardio/sport)
// 3. Estrazione narrative (preservazione markdown libero pre-JSON block)
// 4. Tolleranza Claude-style: null per campi opzionali, numeri come stringhe (coerce)
// 5. Errori: blocco JSON mancante, JSON non valido, schema invalido
// 6. Warning non-bloccanti: settimana mancante, phase non copre tutte le weeks

import { describe, it, expect } from "vitest";
import { parseMacroProgramMarkdown, MacroProgramParseError } from "../parser";

const MINIMAL_VALID_MD = `# Programma Test

Narrative libera qui.

## ⚙ Programma strutturato

\`\`\`json
{
  "metadata": {
    "title": "Test Minimal",
    "goal": "test parsing",
    "sport": "calcio",
    "weeks_total": 1
  },
  "phases": [
    { "name": "Solo", "weeks": [1, 1], "focus": "test" }
  ],
  "weeks": [
    {
      "week": 1,
      "sessions": [
        {
          "day": "lun",
          "type": "forza_gambe",
          "duration_min": 60,
          "exercises": [
            {
              "id": "back-squat-barbell",
              "sets": 3,
              "reps_min": 8,
              "reps_max": 8,
              "rest_sec": 90
            }
          ],
          "intervals": []
        }
      ]
    }
  ]
}
\`\`\`
`;

describe("parseMacroProgramMarkdown — minimal valid", () => {
  it("estrae metadata + 1 fase + 1 week + 1 sessione + 1 esercizio", () => {
    const r = parseMacroProgramMarkdown(MINIMAL_VALID_MD);
    expect(r.program.metadata.title).toBe("Test Minimal");
    expect(r.program.metadata.weeks_total).toBe(1);
    expect(r.program.phases).toHaveLength(1);
    expect(r.program.weeks).toHaveLength(1);
    expect(r.program.weeks[0].sessions).toHaveLength(1);
    expect(r.program.weeks[0].sessions[0].exercises).toHaveLength(1);
    expect(r.program.weeks[0].sessions[0].exercises[0].id).toBe("back-squat-barbell");
  });

  it("preserva narrative markdown pre-marker", () => {
    const r = parseMacroProgramMarkdown(MINIMAL_VALID_MD);
    expect(r.program.narrative_markdown).toContain("# Programma Test");
    expect(r.program.narrative_markdown).toContain("Narrative libera qui.");
    // Non deve includere il blocco JSON
    expect(r.program.narrative_markdown).not.toContain('"title": "Test Minimal"');
  });

  it("popola imported_at con ISO datetime corrente", () => {
    const r = parseMacroProgramMarkdown(MINIMAL_VALID_MD);
    const importedTs = new Date(r.program.imported_at).getTime();
    expect(Date.now() - importedTs).toBeLessThan(5000); // entro 5 secondi
  });

  it("orphanExercises è vuoto (Sprint 2 non checka catalog)", () => {
    const r = parseMacroProgramMarkdown(MINIMAL_VALID_MD);
    expect(r.orphanExercises).toEqual([]);
  });
});

describe("parseMacroProgramMarkdown — Claude-style tolerance", () => {
  it("tollera null per campi opzionali", () => {
    const md = `## ⚙ Programma strutturato
\`\`\`json
{
  "metadata": { "title": "t", "goal": "g", "sport": "calcio", "weeks_total": 1, "start_date": null, "generated_at": null, "generated_by": null },
  "phases": [{ "name": "p", "weeks": [1], "focus": "f", "rpe_target_min": null, "rpe_target_max": null, "notes": null }],
  "weeks": [{ "week": 1, "notes": null, "sessions": [{ "day": "lun", "type": "corsa", "duration_min": 45, "notes_text": null, "setup_spatial": null, "exercises": [], "intervals": [{ "kind": "main", "duration_min": 45, "zone": 2, "cue": null, "reps": null, "recovery_sec": null, "distance_km": null }] }] }]
}
\`\`\``;
    const r = parseMacroProgramMarkdown(md);
    expect(r.program.metadata.start_date).toBeUndefined();
    expect(r.program.phases[0].notes).toBeUndefined();
    expect(r.program.weeks[0].sessions[0].intervals[0].zone).toBe(2);
    expect(r.program.weeks[0].sessions[0].intervals[0].cue).toBeUndefined();
  });

  it("coerce numeri come stringhe (sets: \"3\")", () => {
    const md = `\`\`\`json
{
  "metadata": { "title": "t", "goal": "g", "sport": "x", "weeks_total": 1 },
  "phases": [{ "name": "p", "weeks": [1], "focus": "f" }],
  "weeks": [{ "week": 1, "sessions": [{ "day": "lun", "type": "forza_gambe", "duration_min": 60, "exercises": [{ "id": "x", "sets": "3", "reps_min": "8", "reps_max": "8", "rest_sec": "90" }], "intervals": [] }] }]
}
\`\`\``;
    const r = parseMacroProgramMarkdown(md);
    expect(r.program.weeks[0].sessions[0].exercises[0].sets).toBe(3);
    expect(r.program.weeks[0].sessions[0].exercises[0].rest_sec).toBe(90);
  });

  it("tollera blocco ```JSON in uppercase", () => {
    const md = `\`\`\`JSON
{
  "metadata": { "title": "t", "goal": "g", "sport": "x", "weeks_total": 1 },
  "phases": [{ "name": "p", "weeks": [1], "focus": "f" }],
  "weeks": [{ "week": 1, "sessions": [{ "day": "lun", "type": "corsa", "duration_min": 30, "exercises": [], "intervals": [{ "kind": "main", "duration_min": 30, "zone": 2 }] }] }]
}
\`\`\``;
    const r = parseMacroProgramMarkdown(md);
    expect(r.program.metadata.title).toBe("t");
  });
});

describe("parseMacroProgramMarkdown — errori bloccanti", () => {
  it("throw se blocco JSON mancante", () => {
    expect(() => parseMacroProgramMarkdown("# Solo narrative, niente json")).toThrow(MacroProgramParseError);
    expect(() => parseMacroProgramMarkdown("# Solo narrative, niente json")).toThrow(/Blocco JSON non trovato/);
  });

  it("throw se JSON syntax invalido", () => {
    const bad = `\`\`\`json
{ "metadata": { "title": ... }, INVALID JSON
\`\`\``;
    expect(() => parseMacroProgramMarkdown(bad)).toThrow(/JSON non valido/);
  });

  it("throw se schema fallisce (metadata.weeks_total mancante)", () => {
    const bad = `\`\`\`json
{ "metadata": { "title": "t", "goal": "g", "sport": "x" }, "phases": [], "weeks": [] }
\`\`\``;
    expect(() => parseMacroProgramMarkdown(bad)).toThrow(/Schema JSON non valido/);
  });

  it("error include dettagli Zod nei primi 10 issue", () => {
    const bad = `\`\`\`json
{ "metadata": {}, "phases": [], "weeks": [] }
\`\`\``;
    try {
      parseMacroProgramMarkdown(bad);
      expect.fail("dovrebbe throw");
    } catch (e) {
      expect(e).toBeInstanceOf(MacroProgramParseError);
      const err = e as MacroProgramParseError;
      expect(err.details.length).toBeGreaterThan(0);
      expect(err.details.some(d => d.includes("title"))).toBe(true);
    }
  });
});

describe("parseMacroProgramMarkdown — warnings non-bloccanti", () => {
  it("warning se settimana mancante (weeks_total=3 ma weeks=[1,3])", () => {
    const md = `\`\`\`json
{
  "metadata": { "title": "t", "goal": "g", "sport": "x", "weeks_total": 3 },
  "phases": [{ "name": "p", "weeks": [1, 3], "focus": "f" }],
  "weeks": [
    { "week": 1, "sessions": [{ "day": "lun", "type": "corsa", "duration_min": 30, "exercises": [], "intervals": [{"kind":"main","duration_min":30,"zone":2}] }] },
    { "week": 3, "sessions": [{ "day": "lun", "type": "corsa", "duration_min": 30, "exercises": [], "intervals": [{"kind":"main","duration_min":30,"zone":2}] }] }
  ]
}
\`\`\``;
    const r = parseMacroProgramMarkdown(md);
    expect(r.warnings.some(w => w.includes("Settimana 2 mancante"))).toBe(true);
  });

  it("warning se phase non copre settimana", () => {
    const md = `\`\`\`json
{
  "metadata": { "title": "t", "goal": "g", "sport": "x", "weeks_total": 2 },
  "phases": [{ "name": "p", "weeks": [1, 1], "focus": "f" }],
  "weeks": [
    { "week": 1, "sessions": [{"day":"lun","type":"corsa","duration_min":30,"exercises":[],"intervals":[{"kind":"main","duration_min":30,"zone":2}]}] },
    { "week": 2, "sessions": [{"day":"lun","type":"corsa","duration_min":30,"exercises":[],"intervals":[{"kind":"main","duration_min":30,"zone":2}]}] }
  ]
}
\`\`\``;
    const r = parseMacroProgramMarkdown(md);
    expect(r.warnings.some(w => w.includes("Settimana 2 non coperta"))).toBe(true);
  });

  it("warning se start_date >1 settimana fa", () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const md = `\`\`\`json
{
  "metadata": { "title": "t", "goal": "g", "sport": "x", "weeks_total": 1, "start_date": "${oldDate}" },
  "phases": [{ "name": "p", "weeks": [1], "focus": "f" }],
  "weeks": [{ "week": 1, "sessions": [{"day":"lun","type":"corsa","duration_min":30,"exercises":[],"intervals":[{"kind":"main","duration_min":30,"zone":2}]}] }]
}
\`\`\``;
    const r = parseMacroProgramMarkdown(md);
    expect(r.warnings.some(w => w.includes("start_date"))).toBe(true);
  });
});

describe("parseMacroProgramMarkdown — integration realistic Claude output", () => {
  it("parsa programma calcio 2-week multi-session", () => {
    const md = `# Ritorno Calcio - 2 settimane sample

Glossario:
- CMJ = Counter-Movement Jump
- RSA = Repeated Sprint Ability

## ⚙ Programma strutturato (machine-readable, NON modificare)

\`\`\`json
{
  "metadata": {
    "title": "Ritorno Calcio Sample",
    "goal": "test integration",
    "sport": "calcio",
    "weeks_total": 2,
    "start_date": "2030-01-01"
  },
  "phases": [
    { "name": "Attivazione", "weeks": [1, 2], "focus": "base + tecnica", "rpe_target_min": 6, "rpe_target_max": 7.5 }
  ],
  "weeks": [
    {
      "week": 1,
      "notes": "Adattamento",
      "sessions": [
        {
          "day": "lun",
          "type": "forza_gambe",
          "duration_min": 60,
          "notes_text": "Tecnica palla 20 min in coda",
          "exercises": [
            { "id": "goblet-squat-kettlebell", "sets": 3, "reps_min": 10, "reps_max": 10, "rpe_target": 6, "rest_sec": 90 },
            { "id": "deadlift-romanian-dumbbell", "sets": 3, "reps_min": 8, "reps_max": 8, "rpe_target": 7, "rest_sec": 90, "tempo_eccentrico_sec": 3 }
          ],
          "intervals": []
        },
        {
          "day": "mer",
          "type": "corsa",
          "duration_min": 45,
          "exercises": [],
          "intervals": [
            { "kind": "warmup", "duration_min": 10, "zone": 2 },
            { "kind": "main", "reps": 3, "duration_min": 4, "zone": 4, "recovery_sec": 180 },
            { "kind": "cooldown", "duration_min": 5, "zone": 1 }
          ]
        }
      ]
    },
    {
      "week": 2,
      "sessions": [
        {
          "day": "lun",
          "type": "forza_gambe",
          "duration_min": 65,
          "exercises": [
            { "id": "back-squat-barbell", "sets": 4, "reps_min": 8, "reps_max": 8, "rpe_target": 7, "rest_sec": 90 }
          ],
          "intervals": []
        }
      ]
    }
  ],
  "tracking_metrics": [
    { "id": "cmj_height_cm", "name": "CMJ altezza", "unit": "cm", "frequency": "weekly" }
  ]
}
\`\`\`
`;
    const r = parseMacroProgramMarkdown(md);
    expect(r.program.weeks).toHaveLength(2);
    expect(r.program.weeks[0].sessions).toHaveLength(2);
    expect(r.program.weeks[0].sessions[0].exercises[1].tempo_eccentrico_sec).toBe(3);
    expect(r.program.weeks[0].sessions[1].intervals[1].reps).toBe(3);
    expect(r.program.tracking_metrics).toHaveLength(1);
    expect(r.program.narrative_markdown).toContain("Glossario");
    expect(r.warnings).toEqual([]); // No issue su questo programma
  });
});
