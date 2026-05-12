// Wave 3.4 — Test suite per samsungHealthJson parser (HRV, Sleep, HR live_data).
//
// Coverage:
//  - parseHrvCsv / aggregateHrvByDay / parseSamsungHrvFromZip
//  - parseSleepCsv / aggregateSleepByDay / parseSamsungSleepFromZip
//  - parseHrLiveDataJson / parseHrLiveDataForWorkout

import { describe, it, expect, beforeEach, vi } from "vitest";
import JSZip from "jszip";
import {
  parseHrvCsv,
  aggregateHrvByDay,
  parseSamsungHrvFromZip,
  parseSleepCsv,
  aggregateSleepByDay,
  parseSamsungSleepFromZip,
  parseHrLiveDataJson,
  parseHrLiveDataForWorkout,
  loadSamsungZipOnce,
} from "../samsungHealthJson";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// HRV
// ─────────────────────────────────────────────────────────────────────────────

describe("parseHrvCsv", () => {
  it("estrae sample da CSV minimal con rmssd colonna", () => {
    const csv = [
      "start_time,rmssd,sdnn",
      "2026-05-08 07:00:00,42.5,55.0",
      "2026-05-09 07:00:00,38.0,",
    ].join("\n");
    const samples = parseHrvCsv(csv);
    expect(samples.length).toBe(2);
    expect(samples[0].rmssd_ms).toBe(42.5);
    expect(samples[0].sdnn_ms).toBe(55);
    expect(samples[1].rmssd_ms).toBe(38);
    expect(samples[1].sdnn_ms).toBeUndefined();
  });

  it("fallback su 'heart_rate_variability' se 'rmssd' assente", () => {
    const csv = [
      "start_time,heart_rate_variability",
      "2026-05-08 07:00:00,45",
    ].join("\n");
    const samples = parseHrvCsv(csv);
    expect(samples.length).toBe(1);
    expect(samples[0].rmssd_ms).toBe(45);
  });

  it("skip header com.samsung prefix", () => {
    const csv = [
      "com.samsung.shealth.hrv,1234,17",
      "com.samsung.health.hrv.start_time,com.samsung.health.hrv.rmssd",
      "2026-05-08 07:00:00,40",
    ].join("\n");
    const samples = parseHrvCsv(csv);
    expect(samples.length).toBe(1);
    expect(samples[0].rmssd_ms).toBe(40);
  });

  it("filtra valori fuori range (< 5 o > 200 ms)", () => {
    const csv = [
      "start_time,rmssd",
      "2026-05-08 07:00:00,3",     // troppo basso
      "2026-05-08 08:00:00,250",   // troppo alto
      "2026-05-08 09:00:00,40",    // valido
    ].join("\n");
    const samples = parseHrvCsv(csv);
    expect(samples.length).toBe(1);
    expect(samples[0].rmssd_ms).toBe(40);
  });

  it("CSV vuoto → array vuoto", () => {
    expect(parseHrvCsv("")).toEqual([]);
    expect(parseHrvCsv("solo,header,senza,dati")).toEqual([]);
  });
});

describe("aggregateHrvByDay", () => {
  it("media RMSSD per giorno", () => {
    const samples = [
      { startTimestamp: new Date("2026-05-08T07:00:00Z").getTime(), rmssd_ms: 40 },
      { startTimestamp: new Date("2026-05-08T08:00:00Z").getTime(), rmssd_ms: 50 },
      { startTimestamp: new Date("2026-05-09T07:00:00Z").getTime(), rmssd_ms: 60 },
    ];
    const agg = aggregateHrvByDay(samples);
    expect(agg.length).toBe(2);
    expect(agg[0]).toEqual({ date: "2026-05-08", rmssd_ms: 45 });
    expect(agg[1]).toEqual({ date: "2026-05-09", rmssd_ms: 60 });
  });

  it("output ordinato cronologicamente", () => {
    const samples = [
      { startTimestamp: new Date("2026-05-10T07:00:00Z").getTime(), rmssd_ms: 50 },
      { startTimestamp: new Date("2026-05-08T07:00:00Z").getTime(), rmssd_ms: 40 },
      { startTimestamp: new Date("2026-05-09T07:00:00Z").getTime(), rmssd_ms: 45 },
    ];
    const agg = aggregateHrvByDay(samples);
    expect(agg.map(a => a.date)).toEqual(["2026-05-08", "2026-05-09", "2026-05-10"]);
  });
});

describe("parseSamsungHrvFromZip", () => {
  it("end-to-end: ZIP con HRV CSV → aggregato per giorno", async () => {
    const csv = [
      "start_time,rmssd",
      "2026-05-08 07:00:00,40",
      "2026-05-08 08:00:00,50",
      "2026-05-09 07:00:00,55",
    ].join("\n");
    const zip = new JSZip();
    zip.file("com.samsung.shealth.hrv.20260510.csv", csv);
    const blob = await zip.generateAsync({ type: "blob" });

    const result = await parseSamsungHrvFromZip(blob);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ date: "2026-05-08", rmssd_ms: 45 });
    expect(result[1]).toEqual({ date: "2026-05-09", rmssd_ms: 55 });
  });

  it("ZIP senza HRV CSV → array vuoto", async () => {
    const zip = new JSZip();
    zip.file("other-file.csv", "foo,bar\n1,2");
    const blob = await zip.generateAsync({ type: "blob" });
    const result = await parseSamsungHrvFromZip(blob);
    expect(result).toEqual([]);
  });

  it("ZIP corrotto → array vuoto", async () => {
    const blob = new Blob([new Uint8Array([0xde, 0xad, 0xbe, 0xef])], { type: "application/zip" });
    const result = await parseSamsungHrvFromZip(blob);
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sleep
// ─────────────────────────────────────────────────────────────────────────────

describe("parseSleepCsv", () => {
  it("estrae sample con durata e efficiency", () => {
    const csv = [
      "start_time,end_time,efficiency,deep_sleep_minutes,rem_sleep_minutes,light_sleep_minutes",
      "2026-05-07 23:00:00,2026-05-08 07:00:00,88,90,120,250",
      "2026-05-08 23:30:00,2026-05-09 06:30:00,82,,,",
    ].join("\n");
    const samples = parseSleepCsv(csv);
    expect(samples.length).toBe(2);
    expect(samples[0].durationMinutes).toBe(480); // 8h
    expect(samples[0].efficiency).toBe(88);
    expect(samples[0].deepMinutes).toBe(90);
    expect(samples[0].remMinutes).toBe(120);
    expect(samples[0].lightMinutes).toBe(250);
    expect(samples[1].durationMinutes).toBe(420); // 7h
    expect(samples[1].efficiency).toBe(82);
    expect(samples[1].deepMinutes).toBeUndefined();
  });

  it("skip sleep < 30min o > 24h (sanity)", () => {
    const csv = [
      "start_time,end_time",
      "2026-05-08 07:00:00,2026-05-08 07:10:00",  // 10 min → skip
      "2026-05-08 23:00:00,2026-05-09 06:00:00",  // 7h → ok
    ].join("\n");
    const samples = parseSleepCsv(csv);
    expect(samples.length).toBe(1);
    expect(samples[0].durationMinutes).toBe(420);
  });

  it("skip se end_time ≤ start_time (corrotto)", () => {
    const csv = [
      "start_time,end_time",
      "2026-05-08 23:00:00,2026-05-08 22:00:00",
    ].join("\n");
    expect(parseSleepCsv(csv)).toEqual([]);
  });
});

describe("aggregateSleepByDay", () => {
  it("attribuisce sleep al giorno del WAKE-UP", () => {
    const samples = [
      {
        startTimestamp: new Date("2026-05-07T23:00:00Z").getTime(),
        endTimestamp: new Date("2026-05-08T07:00:00Z").getTime(),
        durationMinutes: 480,
        efficiency: 90,
      },
    ];
    const agg = aggregateSleepByDay(samples);
    expect(agg.length).toBe(1);
    expect(agg[0].date).toBe("2026-05-08"); // wake-up day
    expect(agg[0].durationMinutes).toBe(480);
    expect(agg[0].efficiency).toBe(90);
  });

  it("multiple sleep nello stesso giorno → somma + efficiency media pesata", () => {
    const samples = [
      // Notte: 6h efficiency 80
      {
        startTimestamp: new Date("2026-05-07T22:00:00Z").getTime(),
        endTimestamp: new Date("2026-05-08T04:00:00Z").getTime(),
        durationMinutes: 360,
        efficiency: 80,
      },
      // Pisolino mattutino: 1h efficiency 95
      {
        startTimestamp: new Date("2026-05-08T05:00:00Z").getTime(),
        endTimestamp: new Date("2026-05-08T06:00:00Z").getTime(),
        durationMinutes: 60,
        efficiency: 95,
      },
    ];
    const agg = aggregateSleepByDay(samples);
    expect(agg.length).toBe(1);
    expect(agg[0].durationMinutes).toBe(420);
    // Media pesata: (80*360 + 95*60) / 420 = (28800+5700)/420 ≈ 82.1
    expect(agg[0].efficiency).toBeCloseTo(82.1, 1);
  });
});

describe("parseSamsungSleepFromZip", () => {
  it("end-to-end: ZIP con sleep CSV → aggregato", async () => {
    const csv = [
      "start_time,end_time,efficiency",
      "2026-05-07 23:00:00,2026-05-08 07:00:00,88",
      "2026-05-08 23:30:00,2026-05-09 06:30:00,82",
    ].join("\n");
    const zip = new JSZip();
    zip.file("com.samsung.shealth.sleep.20260510.csv", csv);
    const blob = await zip.generateAsync({ type: "blob" });

    const result = await parseSamsungSleepFromZip(blob);
    expect(result.length).toBe(2);
    expect(result[0]).toMatchObject({ date: "2026-05-08", durationMinutes: 480 });
    expect(result[1]).toMatchObject({ date: "2026-05-09", durationMinutes: 420 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HR live_data
// ─────────────────────────────────────────────────────────────────────────────

describe("parseHrLiveDataJson", () => {
  it("estrae HR samples da array JSON diretto", () => {
    const text = JSON.stringify([
      { heart_rate: 142, start_time: "2026-05-08 07:00:01.000" },
      { heart_rate: 150, start_time: "2026-05-08 07:00:02.000" },
      { heart_rate: 138, start_time: "2026-05-08 07:00:03.000" },
    ]);
    const samples = parseHrLiveDataJson(text);
    expect(samples).toEqual([142, 150, 138]);
  });

  it("supporta wrapper {live_data: [...]}", () => {
    const text = JSON.stringify({
      live_data: [
        { heart_rate: 130 },
        { heart_rate: 135 },
      ],
    });
    const samples = parseHrLiveDataJson(text);
    expect(samples).toEqual([130, 135]);
  });

  it("supporta nomi alternativi (heartRate, hr, bpm)", () => {
    const text = JSON.stringify([
      { heartRate: 120 },
      { hr: 125 },
      { bpm: 130 },
    ]);
    const samples = parseHrLiveDataJson(text);
    expect(samples).toEqual([120, 125, 130]);
  });

  it("filtra HR fuori range (< 30 o > 230)", () => {
    const text = JSON.stringify([
      { heart_rate: 25 },   // troppo basso
      { heart_rate: 250 },  // troppo alto
      { heart_rate: 140 },  // ok
    ]);
    const samples = parseHrLiveDataJson(text);
    expect(samples).toEqual([140]);
  });

  it("JSON corrotto → array vuoto", () => {
    expect(parseHrLiveDataJson("not-json")).toEqual([]);
    expect(parseHrLiveDataJson("{")).toEqual([]);
  });
});

describe("parseHrLiveDataForWorkout", () => {
  it("trova file uuid + calcola avg/max", async () => {
    const uuid = "abc-123-def";
    const liveData = JSON.stringify([
      { heart_rate: 140, start_time: "2026-05-08 07:00:01.000" },
      { heart_rate: 150, start_time: "2026-05-08 07:00:02.000" },
      { heart_rate: 160, start_time: "2026-05-08 07:00:03.000" },
    ]);

    const zip = new JSZip();
    zip.file(
      `jsons/com.samsung.shealth.exercise/00/${uuid}.com.samsung.health.exercise.live_data.json`,
      liveData,
    );
    const blob = await zip.generateAsync({ type: "blob" });

    const result = await parseHrLiveDataForWorkout(blob, uuid);
    expect(result).not.toBeNull();
    expect(result!.samples.length).toBe(3);
    expect(result!.avg).toBe(150);
    expect(result!.max).toBe(160);
  });

  it("uuid non presente nel ZIP → null", async () => {
    const zip = new JSZip();
    zip.file("jsons/com.samsung.shealth.exercise/00/other-uuid.com.samsung.health.exercise.live_data.json", "[]");
    const blob = await zip.generateAsync({ type: "blob" });
    const result = await parseHrLiveDataForWorkout(blob, "non-existent");
    expect(result).toBeNull();
  });

  it("file presente ma vuoto/no valid samples → null", async () => {
    const uuid = "empty-uuid";
    const zip = new JSZip();
    zip.file(
      `jsons/com.samsung.shealth.exercise/00/${uuid}.com.samsung.health.exercise.live_data.json`,
      "[]",
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const result = await parseHrLiveDataForWorkout(blob, uuid);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reviewer 3.4 — Single-load ZIP optimization
//
// Verifica che passando un'istanza JSZip precaricata via `loadSamsungZipOnce`,
// i parser non chiamino di nuovo `JSZip.loadAsync` (3x → 1x decompression).
// ─────────────────────────────────────────────────────────────────────────────

describe("loadSamsungZipOnce + single-load refactor (Reviewer 3.4)", () => {
  it("loadSamsungZipOnce ritorna un'istanza JSZip riusabile", async () => {
    const zip = new JSZip();
    zip.file("com.samsung.shealth.hrv.20260510.csv", "start_time,rmssd\n2026-05-08 07:00:00,40");
    const blob = await zip.generateAsync({ type: "blob" });

    const loaded = await loadSamsungZipOnce(blob);
    expect(loaded).toBeDefined();
    // L'istanza deve permettere di iterare i file (proprietà di JSZip)
    let foundHrv = false;
    loaded.forEach((path) => {
      if (path.includes("hrv")) foundHrv = true;
    });
    expect(foundHrv).toBe(true);
  });

  it("parseSamsungHrvFromZip con preloadedZip NON chiama loadAsync di nuovo", async () => {
    const csv = "start_time,rmssd\n2026-05-08 07:00:00,40\n2026-05-08 08:00:00,50";
    const zip = new JSZip();
    zip.file("com.samsung.shealth.hrv.20260510.csv", csv);
    const blob = await zip.generateAsync({ type: "blob" });

    // Spy: dopo il loadSamsungZipOnce iniziale, nessun ulteriore loadAsync
    const loaded = await loadSamsungZipOnce(blob);
    const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync");

    const result = await parseSamsungHrvFromZip(blob, loaded);
    expect(loadAsyncSpy).not.toHaveBeenCalled();
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({ date: "2026-05-08", rmssd_ms: 45 });

    loadAsyncSpy.mockRestore();
  });

  it("parseSamsungSleepFromZip con preloadedZip NON chiama loadAsync di nuovo", async () => {
    const csv = "start_time,end_time,efficiency\n2026-05-07 23:00:00,2026-05-08 07:00:00,88";
    const zip = new JSZip();
    zip.file("com.samsung.shealth.sleep.20260510.csv", csv);
    const blob = await zip.generateAsync({ type: "blob" });

    const loaded = await loadSamsungZipOnce(blob);
    const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync");

    const result = await parseSamsungSleepFromZip(blob, loaded);
    expect(loadAsyncSpy).not.toHaveBeenCalled();
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({ date: "2026-05-08", durationMinutes: 480 });

    loadAsyncSpy.mockRestore();
  });

  it("parseHrLiveDataForWorkout con preloadedZip NON chiama loadAsync di nuovo", async () => {
    const uuid = "abc-123";
    const liveData = JSON.stringify([{ heart_rate: 140 }, { heart_rate: 160 }]);
    const zip = new JSZip();
    zip.file(
      `jsons/com.samsung.shealth.exercise/00/${uuid}.com.samsung.health.exercise.live_data.json`,
      liveData,
    );
    const blob = await zip.generateAsync({ type: "blob" });

    const loaded = await loadSamsungZipOnce(blob);
    const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync");

    const result = await parseHrLiveDataForWorkout(blob, uuid, loaded);
    expect(loadAsyncSpy).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.avg).toBe(150);

    loadAsyncSpy.mockRestore();
  });

  it("3 parser sequenziali su STESSO preloadedZip → totale 0 loadAsync extra", async () => {
    // Scenario reale: previewImport apre lo ZIP una volta e lo passa ai 3 parser.
    // Prima del refactor: 3 chiamate JSZip.loadAsync (oltre a quella di
    // parseSamsungHealthZipDetailed). Dopo: 0 chiamate extra.
    const uuid = "workout-uuid-1";
    const zip = new JSZip();
    zip.file(
      "com.samsung.shealth.hrv.20260510.csv",
      "start_time,rmssd\n2026-05-08 07:00:00,42",
    );
    zip.file(
      "com.samsung.shealth.sleep.20260510.csv",
      "start_time,end_time\n2026-05-07 23:00:00,2026-05-08 07:00:00",
    );
    zip.file(
      `jsons/com.samsung.shealth.exercise/00/${uuid}.com.samsung.health.exercise.live_data.json`,
      JSON.stringify([{ heart_rate: 145 }]),
    );
    const blob = await zip.generateAsync({ type: "blob" });

    const loaded = await loadSamsungZipOnce(blob);
    const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync");

    await parseSamsungHrvFromZip(blob, loaded);
    await parseSamsungSleepFromZip(blob, loaded);
    await parseHrLiveDataForWorkout(blob, uuid, loaded);

    // Reviewer 3.4 hard assert: 3 parser → 0 nuove loadAsync (era 3 prima)
    expect(loadAsyncSpy).toHaveBeenCalledTimes(0);

    loadAsyncSpy.mockRestore();
  });

  // ─── Backward compat ──────────────────────────────────────────────────────
  // Le firme dei 3 parser sono additive: chiamate senza `preloadedZip`
  // devono continuare a funzionare aprendo lo ZIP internamente.

  it("backward compat: parseSamsungHrvFromZip senza preloadedZip apre lo ZIP", async () => {
    const csv = "start_time,rmssd\n2026-05-08 07:00:00,40";
    const zip = new JSZip();
    zip.file("com.samsung.shealth.hrv.20260510.csv", csv);
    const blob = await zip.generateAsync({ type: "blob" });

    const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync");
    const result = await parseSamsungHrvFromZip(blob);
    // Legacy: 1 loadAsync chiamato internamente
    expect(loadAsyncSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(1);

    loadAsyncSpy.mockRestore();
  });

  it("backward compat: parseSamsungSleepFromZip senza preloadedZip apre lo ZIP", async () => {
    const csv = "start_time,end_time\n2026-05-07 23:00:00,2026-05-08 07:00:00";
    const zip = new JSZip();
    zip.file("com.samsung.shealth.sleep.20260510.csv", csv);
    const blob = await zip.generateAsync({ type: "blob" });

    const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync");
    const result = await parseSamsungSleepFromZip(blob);
    expect(loadAsyncSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(1);

    loadAsyncSpy.mockRestore();
  });

  it("backward compat: parseHrLiveDataForWorkout senza preloadedZip apre lo ZIP", async () => {
    const uuid = "abc-xyz";
    const zip = new JSZip();
    zip.file(
      `jsons/com.samsung.shealth.exercise/00/${uuid}.com.samsung.health.exercise.live_data.json`,
      JSON.stringify([{ heart_rate: 140 }]),
    );
    const blob = await zip.generateAsync({ type: "blob" });

    const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync");
    const result = await parseHrLiveDataForWorkout(blob, uuid);
    expect(loadAsyncSpy).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();

    loadAsyncSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real-format regex validation (verificato su export Samsung 2026-05-09)
//
// Il parser usa regex stretti per:
//   - HRV: accetta `com.samsung.{shealth|health}.hrv.<digit>.csv` (export reale
//     usa `health` SENZA `s`, bug fix post-test reale)
//   - SLEEP: SOLO `com.samsung.shealth.sleep.<digit>.csv` (esclude
//     sleep_goal/sleep_combined/sleep_raw_data che sono satellite)
// ─────────────────────────────────────────────────────────────────────────────

describe("Real Samsung export format compatibility", () => {
  it("HRV regex matcha sia 'shealth.hrv' che 'health.hrv' (export reale usa 'health')", async () => {
    const csv = "start_time,rmssd\n2026-05-08 07:00:00,40";
    const zip = new JSZip();
    // File con namespace `com.samsung.HEALTH.hrv` (senza 's' — formato reale 2026)
    zip.file("Samsung Health/samsunghealth_xxx/com.samsung.health.hrv.20260509111782.csv", csv);
    const blob = await zip.generateAsync({ type: "blob" });
    const result = await parseSamsungHrvFromZip(blob);
    expect(result.length).toBe(1);
    expect(result[0].rmssd_ms).toBe(40);
  });

  it("SLEEP regex IGNORA sleep_goal/sleep_combined/sleep_raw_data (file satellite)", async () => {
    const sleepCsv = "start_time,end_time,efficiency\n2026-05-07 23:00:00,2026-05-08 07:00:00,88";
    const garbageCsv = "irrelevant,schema\nfoo,bar";
    const zip = new JSZip();
    // SOLO il summary deve essere parsato.
    zip.file("Samsung Health/samsunghealth_xxx/com.samsung.shealth.sleep.20260509111782.csv", sleepCsv);
    zip.file("Samsung Health/samsunghealth_xxx/com.samsung.shealth.sleep_goal.20260509111782.csv", garbageCsv);
    zip.file("Samsung Health/samsunghealth_xxx/com.samsung.shealth.sleep_combined.20260509111782.csv", garbageCsv);
    zip.file("Samsung Health/samsunghealth_xxx/com.samsung.shealth.sleep_raw_data.20260509111782.csv", garbageCsv);
    const blob = await zip.generateAsync({ type: "blob" });
    const result = await parseSamsungSleepFromZip(blob);
    expect(result.length).toBe(1);
    expect(result[0].date).toBe("2026-05-08");
  });
});
