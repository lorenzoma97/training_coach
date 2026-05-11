// Test golden cases per equipmentSubstitutor (Wave 3.5, G8).
//
// Coverage attesa:
//   - Hop 0 (utente ha tutto)
//   - Hop 1 (barbell mancante → dumbbell)
//   - Hop 2 (dumbbell mancante → kettlebell)
//   - Hop 3 (kettlebell mancante → bodyweight, max hop)
//   - Unresolved (chain finisce senza match)
//   - Cycle detection (A → B → A → null)
//   - Catalog miss (id non in catalog → null)
//   - Bodyweight always available (anche se non in availableEquipment)
//   - Batch resolveSubstitutionsForSession
//   - Reason text contiene tag mancante
//
// Catalog mock COMPLETO (id + name + equipment + pattern + level + alternatives + ...
// — tutti i campi required di Exercise) per evitare TS errors.

import { describe, it, expect } from "vitest";
import {
  resolveSubstitution,
  resolveSubstitutionsForSession,
  walkAlternativeChain,
} from "../equipmentSubstitutor";
import type { Exercise, EquipmentTag } from "../../types/exercise";

// ────────────────────────────────────────────────────────────────────────────
// Fixture: catalog mock 5 esercizi con chain barbell → dumbbell → kettlebell → bodyweight
// ────────────────────────────────────────────────────────────────────────────

function makeEx(p: Partial<Exercise> & Pick<Exercise, "id" | "equipment" | "alternatives">): Exercise {
  return {
    id: p.id,
    name: p.name ?? `Mock ${p.id}`,
    pattern: p.pattern ?? "squat",
    primaryMuscles: p.primaryMuscles ?? ["quadricipiti"],
    secondaryMuscles: p.secondaryMuscles ?? [],
    equipment: p.equipment,
    level: p.level ?? "beginner",
    unilateral: p.unilateral ?? false,
    technique: p.technique ?? "Mock cue",
    cautions: p.cautions,
    alternatives: p.alternatives,
    loadable: p.loadable ?? true,
  };
}

// Catalog "lineare strict": ogni esercizio ha 1 sola alternative (la successiva
// nel degrade). Permette di testare hop progression deterministica.
const catalog: Exercise[] = [
  // Chain "squat": barbell → dumbbell → kettlebell → bodyweight (3 hop max)
  makeEx({
    id: "back-squat-barbell",
    equipment: ["barbell"],
    alternatives: ["dumbbell-squat"],
  }),
  makeEx({
    id: "dumbbell-squat",
    equipment: ["dumbbell"],
    alternatives: ["goblet-squat-kb"],
  }),
  makeEx({
    id: "goblet-squat-kb",
    equipment: ["kettlebell"],
    alternatives: ["bodyweight-squat"],
  }),
  makeEx({
    id: "bodyweight-squat",
    equipment: ["bodyweight"],
    alternatives: [],
  }),
  // Esercizio "isolato" senza alternative — usato per test unresolved
  makeEx({
    id: "machine-only-exercise",
    equipment: ["machine"],
    alternatives: [],
  }),
];

// Catalog "bidirezionale" replicante il pattern catalog reale (Reviewer Wave 3.5):
// back-squat-bb ↔ goblet-kb, ognuno con bodyweight come alt[2]. Un walker
// head-only cadrebbe in cycle al hop 2 invece di trovare bodyweight-squat
// via alt[2] di back-squat-bb. BFS lo deve risolvere correttamente.
const bidirectionalCatalog: Exercise[] = [
  makeEx({
    id: "back-squat-bb",
    equipment: ["barbell"],
    alternatives: ["goblet-squat-kb", "dumbbell-squat-bd", "bodyweight-squat-bd"],
  }),
  makeEx({
    id: "goblet-squat-kb",
    equipment: ["kettlebell"],
    alternatives: ["back-squat-bb", "dumbbell-squat-bd", "bodyweight-squat-bd"],
  }),
  makeEx({
    id: "dumbbell-squat-bd",
    equipment: ["dumbbell"],
    alternatives: ["back-squat-bb", "goblet-squat-kb", "bodyweight-squat-bd"],
  }),
  makeEx({
    id: "bodyweight-squat-bd",
    equipment: ["bodyweight"],
    alternatives: [],
  }),
];

// Catalog "multi-equipment AND": esercizi che richiedono 2+ tag (es. bench
// press richiede barbell + bench, pull-up richiede pullup_bar + bodyweight).
const multiEquipCatalog: Exercise[] = [
  makeEx({
    id: "bench-press-bb",
    equipment: ["barbell", "bench"],
    alternatives: ["push-up-bw"],
  }),
  makeEx({
    id: "push-up-bw",
    equipment: ["bodyweight"],
    alternatives: [],
  }),
  makeEx({
    id: "pull-up-bw",
    equipment: ["bodyweight", "pullup_bar"],
    alternatives: ["inverted-row-bw"],
  }),
  makeEx({
    id: "inverted-row-bw",
    equipment: ["bodyweight"],
    alternatives: [],
  }),
];

// Cataloghi specifici per test cycle / chain rotta
const cycleCatalog: Exercise[] = [
  makeEx({
    id: "ex-A",
    equipment: ["barbell"],
    alternatives: ["ex-B"],
  }),
  makeEx({
    id: "ex-B",
    equipment: ["barbell"],
    alternatives: ["ex-A"],
  }),
];

const brokenChainCatalog: Exercise[] = [
  makeEx({
    id: "starts-here",
    equipment: ["barbell"],
    alternatives: ["does-not-exist"],
  }),
];

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("resolveSubstitution — hop 0", () => {
  it("ritorna originalId quando l'utente ha tutto l'equipment richiesto", () => {
    const r = resolveSubstitution(
      "back-squat-barbell",
      ["barbell", "dumbbell", "kettlebell"] as EquipmentTag[],
      catalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(0);
    expect(r!.originalId).toBe("back-squat-barbell");
    expect(r!.resolvedId).toBe("back-squat-barbell");
    expect(r!.reason).toBeUndefined(); // no swap → no reason
  });
});

describe("resolveSubstitution — hop progression", () => {
  it("hop 1: barbell mancante → dumbbell-squat", () => {
    const r = resolveSubstitution(
      "back-squat-barbell",
      ["dumbbell", "kettlebell"] as EquipmentTag[],
      catalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(1);
    expect(r!.resolvedId).toBe("dumbbell-squat");
    expect(r!.reason).toContain("no barbell");
  });

  it("hop 2: barbell e dumbbell mancanti → goblet-squat-kb", () => {
    const r = resolveSubstitution(
      "back-squat-barbell",
      ["kettlebell"] as EquipmentTag[],
      catalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(2);
    expect(r!.resolvedId).toBe("goblet-squat-kb");
    expect(r!.reason).toContain("no barbell");
  });

  it("hop 3: solo bodyweight disponibile → bodyweight-squat", () => {
    const r = resolveSubstitution(
      "back-squat-barbell",
      [] as EquipmentTag[],
      catalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(3);
    expect(r!.resolvedId).toBe("bodyweight-squat");
    expect(r!.reason).toContain("no barbell");
  });
});

describe("resolveSubstitution — unresolved", () => {
  it("ritorna null quando la chain finisce senza match (no alternatives + equipment mancante)", () => {
    const r = resolveSubstitution(
      "machine-only-exercise",
      [] as EquipmentTag[],
      catalog,
    );
    expect(r).toBeNull();
  });

  it("ritorna null per catalog miss (id non in catalog)", () => {
    const r = resolveSubstitution(
      "non-esistente",
      ["barbell", "dumbbell"] as EquipmentTag[],
      catalog,
    );
    expect(r).toBeNull();
  });

  it("ritorna null se chain rotta (alt id non esiste in catalog)", () => {
    const r = resolveSubstitution(
      "starts-here",
      [] as EquipmentTag[],
      brokenChainCatalog,
    );
    expect(r).toBeNull();
  });
});

describe("resolveSubstitution — cycle detection", () => {
  it("non va in loop infinito su A → B → A: ritorna null", () => {
    const r = resolveSubstitution(
      "ex-A",
      [] as EquipmentTag[],
      cycleCatalog,
    );
    expect(r).toBeNull();
  });
});

describe("resolveSubstitution — bodyweight always available", () => {
  it("bodyweight-squat è eseguibile anche con availableEquipment=[]", () => {
    const r = resolveSubstitution(
      "bodyweight-squat",
      [] as EquipmentTag[],
      catalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(0);
    expect(r!.resolvedId).toBe("bodyweight-squat");
  });
});

describe("walkAlternativeChain — maxHop custom", () => {
  it("rispetta maxHop=1: barbell mancante → dumbbell OK (hop 1)", () => {
    const r = walkAlternativeChain(
      "back-squat-barbell",
      ["dumbbell"] as EquipmentTag[],
      catalog,
      1,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(1);
  });

  it("rispetta maxHop=1: barbell+dumbbell mancanti → null (kb fuori da maxHop)", () => {
    const r = walkAlternativeChain(
      "back-squat-barbell",
      ["kettlebell"] as EquipmentTag[],
      catalog,
      1,
    );
    expect(r).toBeNull();
  });
});

describe("resolveSubstitutionsForSession — batch", () => {
  it("3 esercizi: 1 hop 0, 1 hop 2, 1 unresolved", () => {
    const result = resolveSubstitutionsForSession(
      ["bodyweight-squat", "back-squat-barbell", "machine-only-exercise"],
      ["kettlebell"] as EquipmentTag[],
      catalog,
    );
    expect(result.resolved.length).toBe(2);
    expect(result.unresolved).toEqual(["machine-only-exercise"]);

    const hop0 = result.resolved.find(r => r.originalId === "bodyweight-squat");
    expect(hop0?.hop).toBe(0);
    expect(hop0?.resolvedId).toBe("bodyweight-squat");

    const hop2 = result.resolved.find(r => r.originalId === "back-squat-barbell");
    expect(hop2?.hop).toBe(2);
    expect(hop2?.resolvedId).toBe("goblet-squat-kb");
  });

  it("array vuoto → resolved e unresolved entrambi vuoti", () => {
    const result = resolveSubstitutionsForSession(
      [],
      ["barbell"] as EquipmentTag[],
      catalog,
    );
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});

describe("resolveSubstitution — equipment AND semantics", () => {
  it("esercizio con MULTI-equipment richiede TUTTI i tag (AND)", () => {
    const multiEquipCatalog: Exercise[] = [
      makeEx({
        id: "bench-press",
        equipment: ["barbell", "bench"], // entrambi richiesti
        alternatives: ["pushup"],
      }),
      makeEx({
        id: "pushup",
        equipment: ["bodyweight"],
        alternatives: [],
      }),
    ];
    // Solo barbell, no bench → deve fallire e degradare a pushup
    const r = resolveSubstitution(
      "bench-press",
      ["barbell"] as EquipmentTag[],
      multiEquipCatalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(1);
    expect(r!.resolvedId).toBe("pushup");
    expect(r!.reason).toContain("bench");
  });

  it("esercizio con MULTI-equipment è OK se TUTTI i tag presenti", () => {
    const localCatalog: Exercise[] = [
      makeEx({
        id: "bench-press",
        equipment: ["barbell", "bench"],
        alternatives: ["pushup"],
      }),
      makeEx({
        id: "pushup",
        equipment: ["bodyweight"],
        alternatives: [],
      }),
    ];
    const r = resolveSubstitution(
      "bench-press",
      ["barbell", "bench"] as EquipmentTag[],
      localCatalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(0);
    expect(r!.resolvedId).toBe("bench-press");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test BFS contract (Reviewer Wave 3.5 BLOCKER fix): catalog reale ha
// bidirezionalità intenzionale (back-squat-bb ↔ goblet-squat-kb). Walker
// head-only cadeva in cycle al hop 2; BFS deve trovare bodyweight via alt[2].
// ────────────────────────────────────────────────────────────────────────────

describe("walkAlternativeChain — BFS su catalog bidirezionale (Reviewer fix)", () => {
  it("utente bodyweight-only su back-squat-bb → risolve a bodyweight-squat (alt[2]), non null per cycle", () => {
    const r = resolveSubstitution(
      "back-squat-bb",
      [] as EquipmentTag[],
      bidirectionalCatalog,
    );
    expect(r).not.toBeNull();
    expect(r!.resolvedId).toBe("bodyweight-squat-bd");
    expect(r!.hop).toBe(1); // BFS lo trova al primo livello (è alt[2] del start)
    expect(r!.reason).toContain("no barbell");
  });

  it("utente solo dumbbell su back-squat-bb → BFS preferisce dumbbell-squat (alt[1]) a hop 1", () => {
    const r = resolveSubstitution(
      "back-squat-bb",
      ["dumbbell"] as EquipmentTag[],
      bidirectionalCatalog,
    );
    expect(r).not.toBeNull();
    expect(r!.resolvedId).toBe("dumbbell-squat-bd");
    expect(r!.hop).toBe(1);
  });

  it("utente solo kettlebell su back-squat-bb → BFS preferisce goblet-squat-kb (alt[0]) a hop 1", () => {
    const r = resolveSubstitution(
      "back-squat-bb",
      ["kettlebell"] as EquipmentTag[],
      bidirectionalCatalog,
    );
    expect(r).not.toBeNull();
    expect(r!.resolvedId).toBe("goblet-squat-kb");
    expect(r!.hop).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test AND multi-equipment (pull-up: bodyweight + pullup_bar)
// ────────────────────────────────────────────────────────────────────────────

describe("resolveSubstitution — pull-up scenario (bodyweight + pullup_bar)", () => {
  it("utente bodyweight-only (no pullup_bar) su pull-up → sostituisce a inverted-row-bw", () => {
    const r = resolveSubstitution(
      "pull-up-bw",
      [] as EquipmentTag[],
      multiEquipCatalog,
    );
    expect(r).not.toBeNull();
    expect(r!.resolvedId).toBe("inverted-row-bw");
    expect(r!.hop).toBe(1);
    expect(r!.reason).toContain("pullup_bar");
  });

  it("utente con pullup_bar su pull-up → hop 0, no substitution", () => {
    const r = resolveSubstitution(
      "pull-up-bw",
      ["pullup_bar"] as EquipmentTag[],
      multiEquipCatalog,
    );
    expect(r).not.toBeNull();
    expect(r!.hop).toBe(0);
    expect(r!.resolvedId).toBe("pull-up-bw");
  });
});
