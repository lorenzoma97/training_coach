// Wave 3.1 — Smoke + unit test per StrengthExercisesForm.
// (NO React DOM perché in questo progetto vitest gira in Node senza jsdom).
//
// Cosa testiamo:
//  - import del componente non lancia errori (smoke)
//  - filterAvailableExercises esclude esercizi che richiedono attrezzi assenti
//  - filterAvailableExercises include sempre bodyweight-only
//  - addExerciseToList aggiunge entry con 1 set vuoto
//  - addSetToExercise copia ultimo set come template (reps/kg/rpe/rir)
//  - addSetToExercise NON copia rest_sec/tut_sec
//  - removeExerciseFromList rimuove entry corretta
//  - removeSetFromExercise rimuove set corretto
//  - updateSetField gestisce sia numeri che undefined (clear)
//  - updateSetField NON sovrascrive reps con undefined (reps obbligatorio)
//  - updateExerciseNotes pulisce il campo se stringa vuota

import { describe, it, expect } from "vitest";
import StrengthExercisesForm, {
  filterAvailableExercises,
  groupExercisesByPattern,
  emptySet,
  cloneSetAsTemplate,
  addExerciseToList,
  removeExerciseFromList,
  addSetToExercise,
  removeSetFromExercise,
  updateSetField,
  updateExerciseNotes,
} from "../StrengthExercisesForm";
import type { ExercisePerformance } from "../../../lib/types/strength";

describe("StrengthExercisesForm (smoke)", () => {
  it("imports without throwing", () => {
    expect(StrengthExercisesForm).toBeDefined();
    expect(typeof StrengthExercisesForm).toBe("function");
  });
});

describe("filterAvailableExercises", () => {
  it("include sempre esercizi a corpo libero anche con equipment vuoto", () => {
    const out = filterAvailableExercises([]);
    // Almeno un esercizio bodyweight-only nel catalog
    expect(out.length).toBeGreaterThan(0);
    for (const ex of out) {
      // Tutti gli esercizi tornati devono essere eseguibili con il solo bodyweight
      expect(ex.equipment.every(tag => tag === "bodyweight")).toBe(true);
    }
  });

  it("esclude esercizi che richiedono barbell se utente ha solo bodyweight", () => {
    const out = filterAvailableExercises(["bodyweight"]);
    const hasBarbell = out.some(ex => ex.equipment.includes("barbell"));
    expect(hasBarbell).toBe(false);
  });

  it("include esercizi barbell quando utente dichiara barbell", () => {
    const out = filterAvailableExercises(["barbell", "bench"]);
    // back-squat-barbell richiede solo "barbell" → deve esserci
    expect(out.find(ex => ex.id === "back-squat-barbell")).toBeDefined();
  });

  it("normalizza case + trim su equipment input", () => {
    const a = filterAvailableExercises(["  BARBELL  "]);
    const b = filterAvailableExercises(["barbell"]);
    expect(a.length).toBe(b.length);
  });

  it("filtra AND (tutti i tag richiesti devono esserci)", () => {
    // bulgarian-split-squat-dumbbell richiede dumbbell + bench
    const onlyDumbbell = filterAvailableExercises(["dumbbell"]);
    expect(onlyDumbbell.find(ex => ex.id === "bulgarian-split-squat-dumbbell")).toBeUndefined();
    const both = filterAvailableExercises(["dumbbell", "bench"]);
    expect(both.find(ex => ex.id === "bulgarian-split-squat-dumbbell")).toBeDefined();
  });
});

describe("groupExercisesByPattern", () => {
  it("raggruppa per pattern e ordina per nome it", () => {
    const all = filterAvailableExercises(["barbell", "dumbbell", "kettlebell", "bench", "box", "machine", "cable", "band", "trx", "pullup_bar"]);
    const grouped = groupExercisesByPattern(all);
    // squat è uno dei pattern principali
    expect(grouped.squat).toBeDefined();
    expect(grouped.squat.length).toBeGreaterThan(0);
    // verifica ordinamento
    const names = grouped.squat.map(e => e.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "it"));
    expect(names).toEqual(sorted);
  });

  it("non crea chiavi vuote", () => {
    const grouped = groupExercisesByPattern([]);
    expect(Object.keys(grouped).length).toBe(0);
  });
});

describe("emptySet / cloneSetAsTemplate", () => {
  it("emptySet ha solo reps=0", () => {
    const s = emptySet();
    expect(s.reps).toBe(0);
    expect(s.weight_kg).toBeUndefined();
    expect(s.rpe).toBeUndefined();
    expect(s.rir).toBeUndefined();
  });

  it("cloneSetAsTemplate copia reps/weight/rpe/rir ma NON rest_sec/tut_sec", () => {
    const prev = { reps: 8, weight_kg: 60, rpe: 8, rir: 2, rest_sec: 90, tut_sec: 30 };
    const next = cloneSetAsTemplate(prev);
    expect(next.reps).toBe(8);
    expect(next.weight_kg).toBe(60);
    expect(next.rpe).toBe(8);
    expect(next.rir).toBe(2);
    expect(next.rest_sec).toBeUndefined();
    expect(next.tut_sec).toBeUndefined();
  });

  it("cloneSetAsTemplate omette campi opzionali undefined", () => {
    const prev = { reps: 5 };
    const next = cloneSetAsTemplate(prev);
    expect(next.reps).toBe(5);
    expect(next.weight_kg).toBeUndefined();
    expect("weight_kg" in next).toBe(false);
  });
});

describe("addExerciseToList / removeExerciseFromList", () => {
  it("aggiunge esercizio con 1 set vuoto", () => {
    const initial: ExercisePerformance[] = [];
    const out = addExerciseToList(initial, "back-squat-barbell");
    expect(out).toHaveLength(1);
    expect(out[0].exerciseId).toBe("back-squat-barbell");
    expect(out[0].sets).toHaveLength(1);
    expect(out[0].sets[0].reps).toBe(0);
  });

  it("non muta input", () => {
    const initial: ExercisePerformance[] = [];
    addExerciseToList(initial, "back-squat-barbell");
    expect(initial).toHaveLength(0);
  });

  it("rimuove esercizio per indice", () => {
    const list: ExercisePerformance[] = [
      { exerciseId: "back-squat-barbell", sets: [{ reps: 5 }] },
      { exerciseId: "deadlift-conventional-barbell", sets: [{ reps: 3 }] },
    ];
    const out = removeExerciseFromList(list, 0);
    expect(out).toHaveLength(1);
    expect(out[0].exerciseId).toBe("deadlift-conventional-barbell");
  });

  it("removeExerciseFromList con indice fuori range no-op", () => {
    const list: ExercisePerformance[] = [{ exerciseId: "back-squat-barbell", sets: [{ reps: 5 }] }];
    expect(removeExerciseFromList(list, 99)).toBe(list);
    expect(removeExerciseFromList(list, -1)).toBe(list);
  });
});

describe("addSetToExercise / removeSetFromExercise", () => {
  it("aggiunge set copiando l'ultimo come template", () => {
    const list: ExercisePerformance[] = [
      { exerciseId: "back-squat-barbell", sets: [{ reps: 8, weight_kg: 60, rpe: 7 }] },
    ];
    const out = addSetToExercise(list, 0);
    expect(out[0].sets).toHaveLength(2);
    expect(out[0].sets[1].reps).toBe(8);
    expect(out[0].sets[1].weight_kg).toBe(60);
    expect(out[0].sets[1].rpe).toBe(7);
  });

  it("rimuove set per indice", () => {
    const list: ExercisePerformance[] = [
      { exerciseId: "back-squat-barbell", sets: [{ reps: 8 }, { reps: 7 }, { reps: 6 }] },
    ];
    const out = removeSetFromExercise(list, 0, 1);
    expect(out[0].sets).toHaveLength(2);
    expect(out[0].sets[0].reps).toBe(8);
    expect(out[0].sets[1].reps).toBe(6);
  });

  it("addSetToExercise con esercizio senza set ricade su emptySet", () => {
    const list: ExercisePerformance[] = [{ exerciseId: "back-squat-barbell", sets: [] }];
    const out = addSetToExercise(list, 0);
    expect(out[0].sets).toHaveLength(1);
    expect(out[0].sets[0].reps).toBe(0);
  });
});

describe("updateSetField", () => {
  const base: ExercisePerformance[] = [
    { exerciseId: "back-squat-barbell", sets: [{ reps: 8, weight_kg: 60, rpe: 7 }] },
  ];

  it("aggiorna reps con valore numerico", () => {
    const out = updateSetField(base, 0, 0, "reps", 10);
    expect(out[0].sets[0].reps).toBe(10);
  });

  it("reps undefined ricade a 0 (reps è obbligatorio nel type)", () => {
    const out = updateSetField(base, 0, 0, "reps", undefined);
    expect(out[0].sets[0].reps).toBe(0);
  });

  it("setta weight_kg con numero", () => {
    const out = updateSetField(base, 0, 0, "weight_kg", 75);
    expect(out[0].sets[0].weight_kg).toBe(75);
  });

  it("clear weight_kg con undefined rimuove la chiave", () => {
    const out = updateSetField(base, 0, 0, "weight_kg", undefined);
    expect(out[0].sets[0].weight_kg).toBeUndefined();
    expect("weight_kg" in out[0].sets[0]).toBe(false);
  });

  it("aggiorna rpe e rir indipendentemente", () => {
    const a = updateSetField(base, 0, 0, "rpe", 9);
    expect(a[0].sets[0].rpe).toBe(9);
    const b = updateSetField(a, 0, 0, "rir", 1);
    expect(b[0].sets[0].rir).toBe(1);
    expect(b[0].sets[0].rpe).toBe(9);
  });

  it("indici fuori range no-op", () => {
    // No-op semantico: deep equality (toStrictEqual) — l'impl può tornare un
    // clone shallow per uniformità con il path "modify". Il contratto è "no
    // mutation di base + nessun cambio osservabile", non identità referenziale.
    expect(updateSetField(base, 99, 0, "reps", 5)).toStrictEqual(base);
    expect(updateSetField(base, 0, 99, "reps", 5)).toStrictEqual(base);
  });
});

describe("updateExerciseNotes", () => {
  const base: ExercisePerformance[] = [
    { exerciseId: "back-squat-barbell", sets: [{ reps: 5 }], notes: "vecchia nota" },
  ];

  it("aggiorna note con stringa", () => {
    const out = updateExerciseNotes(base, 0, "tecnica buona");
    expect(out[0].notes).toBe("tecnica buona");
  });

  it("rimuove note se stringa vuota o whitespace-only", () => {
    const out = updateExerciseNotes(base, 0, "   ");
    expect(out[0].notes).toBeUndefined();
    expect("notes" in out[0]).toBe(false);
  });
});
