// FASE 2 — Golden test per computeCompletion (lib/coach/completion.ts).
//
// Funzione PURA con `now` iniettato → test deterministici, niente skip per
// giorno della settimana (a differenza del vecchio test render-based che
// dipendeva dall'orologio reale). Pinnano il comportamento REALE estratto da
// TrainingPlanView, inclusi i quirk noti dell'audit (no cross-day, durata
// ignorata, dedup per id).

import { describe, it, expect } from "vitest";
import { computeCompletion, todayPlannedSession, sessionCompletionKey, type RecentDay } from "../completion";
import { DAY_LABELS_MON } from "../../time";
import type { TrainingPlan, PlannedSession } from "../../types";
import type { getLastNDays } from "../../diaryContext";

// Guardia a COMPILE-TIME (regressione CI 2026-06-15): l'output di getLastNDays
// DEVE essere assegnabile a RecentDay[], altrimenti i consumer (DiaryApp/
// TodayTab) che passano getLastNDays(...) a computeCompletion/todayPlannedSession
// non compilano. Questo assert fallisce a `tsc`, non a runtime (i golden test
// non lo intercetterebbero). Se RecentDay viene ristretto in modo incompatibile,
// `tsc` qui dà errore invece di scoprirlo solo in CI dopo il merge.
type _RecentDayAcceptsGetLastNDays =
  Awaited<ReturnType<typeof getLastNDays>> extends RecentDay[] ? true : never;
const _recentDayGuard: _RecentDayAcceptsGetLastNDays = true;
void _recentDayGuard;

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

describe("todayPlannedSession — fonte unica Diario/Oggi (C3)", () => {
  // Mercoledì 2026-06-17 ore 10:00 (2026-06-15 è lunedì).
  const NOW_WED = new Date(2026, 5, 17, 10, 0, 0);

  function multiWeekPlan(startDate: string, weeks: { weekNumber: number; sessions: PlannedSession[] }[]): TrainingPlan {
    return {
      generatedAt: "2026-06-08T00:00:00.000Z",
      validUntil: "2026-07-01T00:00:00.000Z",
      startDate,
      weeks: weeks.map(w => ({ ...w, focus: "test" })),
      rationale: "",
    };
  }

  it("null se manca plan / startDate / weeks", () => {
    expect(todayPlannedSession(null, [], NOW_WED)).toBeNull();
    expect(todayPlannedSession({ ...plan([]), startDate: undefined }, [], NOW_WED)).toBeNull();
    expect(todayPlannedSession({ ...plan([]), weeks: [] }, [], NOW_WED)).toBeNull();
  });

  it("null se oggi è riposo (nessuna sessione con data odierna)", () => {
    // settimana lun 06-15: solo lun e mar pianificati, mer (oggi) riposo.
    const p = plan([session("lun", "corsa"), session("mar", "forza_gambe")], "2026-06-15");
    expect(todayPlannedSession(p, [], NOW_WED)).toBeNull();
  });

  it("null se pre-start (startDate futura)", () => {
    const p = plan([session("mer", "corsa")], "2026-06-22");
    expect(todayPlannedSession(p, [], NOW_WED)).toBeNull();
  });

  it("status 'todo' quando oggi è pianificato ma non ancora fatto", () => {
    const p = plan([session("mer", "corsa", "Fondo Lento")], "2026-06-15");
    const t = todayPlannedSession(p, [], NOW_WED)!;
    expect(t).toBeTruthy();
    expect(t.session.day).toBe("mer");
    expect(t.weekNumber).toBe(1);
    expect(t.status).toBe("todo");
    expect(t.completion).toBeNull();
  });

  it("status 'done' (strict) quando oggi è fatto col subtype giusto", () => {
    const p = plan([session("mer", "corsa", "Fondo Lento")], "2026-06-15");
    const t = todayPlannedSession(p, [day("2026-06-17", [workout("w1", "corsa", "Fondo Lento")])], NOW_WED)!;
    expect(t.status).toBe("done");
    expect(t.completion?.strictMatch).toBe(true);
  });

  it("status 'variata' quando oggi è fatto con subtype diverso", () => {
    const p = plan([session("mer", "corsa", "Ripetute")], "2026-06-15");
    const t = todayPlannedSession(p, [day("2026-06-17", [workout("w1", "corsa", "Fondo Lento")])], NOW_WED)!;
    expect(t.status).toBe("variata");
    expect(t.completion?.strictMatch).toBe(false);
  });

  it("PIANO STALE: con startDate di 9 giorni fa restituisce la settimana CORRETTA (non weeks[0])", () => {
    // startDate lun 06-08; oggi mer 06-17 → settimana 2 (indice 1).
    // Il vecchio TodayTab usava weeks[0] → mostrava la sessione della settimana 1.
    const p = multiWeekPlan("2026-06-08", [
      { weekNumber: 1, sessions: [session("mer", "corsa", "Settimana1 Fondo")] },
      { weekNumber: 2, sessions: [session("mer", "corsa", "Settimana2 Ripetute")] },
    ]);
    const t = todayPlannedSession(p, [], NOW_WED)!;
    expect(t.weekNumber).toBe(2);
    expect(t.session.subtype).toBe("Settimana2 Ripetute");
  });
});
