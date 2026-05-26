// Golden test integration parseAndResolveMacroProgram (Sprint 3).
// Verifica: matcher applicato + Tier 3 auto-add + orphanExercises popolato.

import { describe, it, expect, beforeEach } from "vitest";
import { parseAndResolveMacroProgram } from "../parser";
import { clearCustomExercises, loadCustomExercises, refreshCustomCache, lookupExerciseHybrid } from "../customCatalog";

beforeEach(async () => {
  localStorage.clear();
  await clearCustomExercises();
  await refreshCustomCache();
});

const MIXED_PROGRAM_MD = `# Programma test mixed

\`\`\`json
{
  "metadata": {
    "title": "Test mixed",
    "goal": "test matcher integration",
    "sport": "calcio",
    "weeks_total": 1
  },
  "phases": [
    { "name": "Solo", "weeks": [1], "focus": "test" }
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
            { "id": "back-squat-barbell", "sets": 3, "reps_min": 8, "reps_max": 8, "rest_sec": 90 },
            { "id": "Goblet Squat", "sets": 3, "reps_min": 10, "reps_max": 10, "rest_sec": 90 },
            { "id": "RDL", "sets": 3, "reps_min": 8, "reps_max": 8, "rest_sec": 90 },
            {
              "id": "custom-prowler-push",
              "name": "Prowler Push",
              "pattern": "carry",
              "equipment": ["bodyweight"],
              "sets": 3,
              "reps_min": 1,
              "reps_max": 1,
              "rest_sec": 120,
              "technique": "Spingi il prowler in avanti su distanza fissa",
              "guidance": [
                "Setup: posizione bassa con corpo inclinato avanti, mani sul prowler",
                "Esecuzione: spingi con gambe + core, passi corti e potenti",
                "Respirazione: corta e potente",
                "Errori comuni: tronco verticale, passi lunghi",
                "Sicurezza: progressivo, NO se lombare dolente"
              ]
            },
            {
              "id": "orphan-no-metadata",
              "sets": 3,
              "reps_min": 5,
              "reps_max": 5,
              "rest_sec": 60
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

describe("parseAndResolveMacroProgram — integration mixed", () => {
  it("risolve Tier 1 (back-squat-barbell exact)", async () => {
    const r = await parseAndResolveMacroProgram(MIXED_PROGRAM_MD);
    const ids = r.program.weeks[0].sessions[0].exercises.map(e => e.id);
    expect(ids).toContain("back-squat-barbell");
  });

  it("risolve Tier 2 synonym ('Goblet Squat' → goblet-squat-kettlebell, 'RDL' → deadlift-romanian-barbell)", async () => {
    const r = await parseAndResolveMacroProgram(MIXED_PROGRAM_MD);
    const ids = r.program.weeks[0].sessions[0].exercises.map(e => e.id);
    expect(ids).toContain("goblet-squat-kettlebell");
    expect(ids).toContain("deadlift-romanian-barbell");
    expect(ids).not.toContain("Goblet Squat");
    expect(ids).not.toContain("RDL");
  });

  it("Tier 3: esercizio nuovo con metadata completi → auto-add a custom catalog", async () => {
    const r = await parseAndResolveMacroProgram(MIXED_PROGRAM_MD);
    expect(r.orphanExercises.some(o => o.exerciseId === "custom-prowler-push")).toBe(true);
    const customs = await loadCustomExercises();
    expect(customs.some(c => c.id === "custom-prowler-push")).toBe(true);
    // dopo refresh, lookup hybrid lo trova
    expect(lookupExerciseHybrid("custom-prowler-push")).toBeDefined();
  });

  it("Tier 3 incompleto: warning + NO auto-add", async () => {
    const r = await parseAndResolveMacroProgram(MIXED_PROGRAM_MD);
    expect(r.warnings.some(w => w.includes("orphan-no-metadata"))).toBe(true);
    const customs = await loadCustomExercises();
    expect(customs.some(c => c.id === "orphan-no-metadata")).toBe(false);
  });

  it("orphan: prima occorrenza VUOTA + seconda COMPLETA → usa la completa (robust dedup)", async () => {
    // Simula pattern Claude: prima occorrenza technique="" guidance=[], seconda piena.
    const md = `\`\`\`json
{
  "metadata": { "title": "t", "goal": "g", "sport": "x", "weeks_total": 2 },
  "phases": [{ "name": "p", "weeks": [1, 2], "focus": "f" }],
  "weeks": [
    {
      "week": 1,
      "sessions": [{ "day": "lun", "type": "forza_gambe", "duration_min": 60, "intervals": [], "exercises": [
        { "id": "cmj-bodyweight", "name": "CMJ", "pattern": "plyometric", "equipment": ["bodyweight"], "sets": 3, "reps_min": 5, "reps_max": 5, "rest_sec": 120, "technique": "", "guidance": [] }
      ] }]
    },
    {
      "week": 2,
      "sessions": [{ "day": "lun", "type": "forza_gambe", "duration_min": 60, "intervals": [], "exercises": [
        { "id": "cmj-bodyweight", "name": "CMJ Counter-Movement Jump", "pattern": "plyometric", "equipment": ["bodyweight"], "sets": 4, "reps_min": 5, "reps_max": 5, "rest_sec": 120, "technique": "Contromovimento rapido + swing braccia", "guidance": ["Setup: piedi spalla", "Esecuzione: scendi rapido + esplodi", "Respirazione: espira nell'esplosione", "Errori: salto lento", "Sicurezza: atterraggio morbido"] }
      ] }]
    }
  ]
}
\`\`\``;
    const r = await parseAndResolveMacroProgram(md);
    const customs = await loadCustomExercises();
    const cmj = customs.find(c => c.id === "cmj-bodyweight");
    expect(cmj).toBeDefined();
    // Deve aver usato la SECONDA occorrenza (con guidance + technique)
    expect(cmj!.technique).toContain("Contromovimento");
    expect(cmj!.guidance).toHaveLength(5);
    expect(cmj!.name).toBe("CMJ Counter-Movement Jump");
  });

  it("dedup orphan: stesso id in più sessioni → 1 sola entry in orphanExercises", async () => {
    const dupMd = MIXED_PROGRAM_MD.replace(
      '"intervals": []',
      `"intervals": [] },
        { "day": "mer", "type": "forza_gambe", "duration_min": 60, "intervals": [], "exercises": [
          { "id": "custom-prowler-push", "name": "Prowler Push", "pattern": "carry", "equipment": ["bodyweight"], "sets": 3, "reps_min": 1, "reps_max": 1, "rest_sec": 120, "technique": "t", "guidance": ["Setup","Esecuzione","Respirazione","Errori","Sicurezza"] }
        ]`,
    );
    const r = await parseAndResolveMacroProgram(dupMd);
    const prowlerCount = r.orphanExercises.filter(o => o.exerciseId === "custom-prowler-push").length;
    expect(prowlerCount).toBe(1);
  });
});
