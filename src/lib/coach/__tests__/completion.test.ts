// FASE 2 — Golden test per computeCompletion (lib/coach/completion.ts).
//
// Funzione PURA con `now` iniettato → test deterministici, niente skip per
// giorno della settimana (a differenza del vecchio test render-based che
// dipendeva dall'orologio reale). Pinnano il comportamento REALE estratto da
// TrainingPlanView, inclusi i quirk noti dell'audit (no cross-day, durata
// ignorata, dedup per id).

import { describe, it, expect } from "vitest";
import { computeCompletion, sessionCompletionKey, type RecentDay } from "../completion";
import { DAY_LABELS_MON } from "../../time";
import type { TrainingPlan, PlannedSession } from "../../types";

// Settimana di riferimento: lun 2026-06-08 … dom 2026-06-14.
const START = "2026-06-08";
// "Adesso" fisso: venerdì 2026-06-12 ore 10:00 locale → lun-gio passati,
// ven = oggi, sab-dom futuri.
const NOW = new Date(2026, 5, 12, 10, 0, 0);

function session(day: string, type: string, subtype?: string, duration_min = 45): PlannedSession {
  return { day, type, subtype, duration_min, details: "", rationale: "" };
}
function plan(sessions: PlannedSession[], startDate = START, weekNumber = 1): TrainingPlan {
  return {
    generatedAt: "2026-06-08T00:00:00.000Z",
    validUntil: "2026-06-22T00:00:00.000Z",
    startDate,
    weeks: [{ weekNumber, focus: "test", sessions }],
    rationale: "",
  };
}
function workout(id: string, type: string, sub?: string, durKey = "durata_totale", dur = 40) {
  const fields: Record<string, unknown> = { [durKey]: dur };
  // Per i tipi cardio/forza il sottotipo vive in "tipo"; per sport in "sport".
  if (sub !== undefined) fields[type === "sport" ? "sport" : "tipo"] = sub;
  return { id, type, fields, createdAt: "2026-06-08T08:00:00.000Z" };
}
// `any[]`: la shape reale del diario è eterogenea; i test costruiscono workout
// minimali, l'assegnabilità a DiaryWorkout è garantita a runtime non dai tipi.
function day(date: string, workouts: any[]): RecentDay {
  return { date, daily: null, workouts };
}
/** Ricostruisce la key di una sessione come fa la funzione (start + offset giorni). */
function keyOf(dayLabel: string, weekIdx = 0, weekNumber = 1, startISO = START): string {
  const [y, m, d] = startISO.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const planned = new Date(start);
  planned.setDate(start.getDate() + weekIdx * 7 + DAY_LABELS_MON.indexOf(dayLabel as never));
  return sessionCompletionKey(weekNumber, dayLabel, planned);
}

describe("computeCompletion — casi vuoti", () => {
  it("plan null / senza startDate / recentDays vuoto → tutto vuoto", () => {
    const empty = { completed: new Map(), extras: [], skipped: new Set() };
    expect(computeCompletion(null, [day("2026-06-08", [])], NOW)).toEqual(empty);
    expect(computeCompletion({ ...plan([]), startDate: undefined }, [day("2026-06-08", [])], NOW)).toEqual(empty);
    expect(computeCompletion(plan([session("lun", "corsa")]), [], NOW)).toEqual(empty);
  });
  it("startDate malformato → vuoto (parseISO null)", () => {
    expect(computeCompletion(plan([session("lun", "corsa")], "2026-6-8"), [day("2026-06-08", [])], NOW))
      .toEqual({ completed: new Map(), extras: [], skipped: new Set() });
  });
});

describe("computeCompletion — match same-day a 3 tentativi", () => {
  it("FATTA: tipo + subtype identici (strict)", () => {
    const r = computeCompletion(
      plan([session("lun", "corsa", "Fondo Lento")]),
      [day(START, [workout("w1", "corsa", "Fondo Lento")])],
      NOW,
    );
    const info = r.completed.get(keyOf("lun"));
    expect(info).toBeTruthy();
    expect(info!.strictMatch).toBe(true);
    expect(info!.sameDay).toBe(true);
    expect(info!.actualType).toBeUndefined();
    expect(r.skipped.size).toBe(0);
    expect(r.extras).toHaveLength(0);
  });

  it("VARIATA: stesso tipo, subtype diverso (strict=false)", () => {
    const r = computeCompletion(
      plan([session("mar", "corsa", "Ripetute")]),
      [day("2026-06-09", [workout("w1", "corsa", "Fondo Lento")])],
      NOW,
    );
    const info = r.completed.get(keyOf("mar"))!;
    expect(info.strictMatch).toBe(false);
    expect(info.actualSubtype).toBe("Fondo Lento");
  });

  it("VARIATA family forza_gambe↔upper: actualType valorizzato", () => {
    const r = computeCompletion(
      plan([session("mer", "forza_upper", "Upper Body")]),
      [day("2026-06-10", [workout("w1", "forza_gambe", "HIIT Gambe")])],
      NOW,
    );
    const info = r.completed.get(keyOf("mer"))!;
    expect(info.strictMatch).toBe(false);
    expect(info.actualType).toBe("forza_gambe");
  });

  it("la DURATA non entra nel match: workout 5' marca FATTA una sessione 60'", () => {
    const r = computeCompletion(
      plan([session("lun", "corsa", "Fondo Lento", 60)]),
      [day(START, [workout("w1", "corsa", "Fondo Lento", "durata_totale", 5)])],
      NOW,
    );
    expect(r.completed.get(keyOf("lun"))!.strictMatch).toBe(true);
  });

  it("subtype via fields.sport per type=sport", () => {
    const r = computeCompletion(
      plan([session("lun", "sport", "Tennis")]),
      [day(START, [workout("w1", "sport", "Tennis", "durata")])],
      NOW,
    );
    expect(r.completed.get(keyOf("lun"))!.strictMatch).toBe(true);
  });
});

describe("computeCompletion — saltate / oggi / futuro", () => {
  it("SALTATA: sessione passata senza workout", () => {
    const r = computeCompletion(plan([session("lun", "corsa", "Fondo Lento")]), [day("2026-06-09", [])], NOW);
    expect(r.skipped.has(keyOf("lun"))).toBe(true);
    expect(r.completed.size).toBe(0);
  });
  it("OGGI senza match: né completata né saltata", () => {
    const r = computeCompletion(plan([session("ven", "corsa", "Fondo Lento")]), [day("2026-06-12", [])], NOW);
    expect(r.completed.size).toBe(0);
    expect(r.skipped.size).toBe(0);
  });
  it("FUTURO: sessione di domani ignorata", () => {
    const r = computeCompletion(plan([session("sab", "corsa", "Fondo Lento")]), [day("2026-06-12", [])], NOW);
    expect(r.completed.size).toBe(0);
    expect(r.skipped.size).toBe(0);
  });
});

describe("computeCompletion — no cross-day, dedup, extras", () => {
  it("nessun cross-day: workout in giorno diverso → SALTATA + AUTONOMO", () => {
    const r = computeCompletion(
      plan([session("lun", "corsa", "Fondo Lento")]),
      // workout eseguito martedì invece che lunedì
      [day("2026-06-09", [workout("w1", "corsa", "Fondo Lento")])],
      NOW,
    );
    expect(r.skipped.has(keyOf("lun"))).toBe(true);
    expect(r.completed.size).toBe(0);
    expect(r.extras).toHaveLength(1);
    expect(r.extras[0].workout.id).toBe("w1");
  });

  it("dedup: 2 sessioni stesso giorno stesso tipo, 1 workout → 1 FATTA + 1 SALTATA", () => {
    const r = computeCompletion(
      plan([session("lun", "corsa", "Fondo Lento"), session("lun", "corsa", "Ripetute")]),
      [day(START, [workout("w1", "corsa", "Fondo Lento")])],
      NOW,
    );
    expect(r.completed.size).toBe(1);
    expect(r.skipped.size).toBe(1);
    expect(r.extras).toHaveLength(0);
  });

  it("extra fuori dalla finestra del piano è escluso", () => {
    const r = computeCompletion(
      plan([session("lun", "corsa", "Fondo Lento")]),
      [
        day(START, [workout("w1", "corsa", "Fondo Lento")]),       // matcha
        day("2026-05-01", [workout("w2", "corsa", "Fondo Lento")]), // prima del piano → non extra
      ],
      NOW,
    );
    expect(r.completed.size).toBe(1);
    expect(r.extras).toHaveLength(0);
  });
});
