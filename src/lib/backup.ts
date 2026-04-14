// Backup completo + restore di tutto lo stato dell'app.
// Include: diario (giorni + index), profilo, obiettivi, piano, feed coach,
// storia chat, stato onboarding, ultima data report settimanale.
// NON include la chiave API (va inserita manualmente, per sicurezza).
// NON include gli embeddings RAG (si possono rigenerare).

import { storage, getJSON, setJSON } from "./storage";

export interface BackupPayload {
  schema: "training-coach-backup";
  version: 1;
  exportedAt: string; // ISO datetime
  appVersion: string;
  data: {
    // Namespace generici
    "user-profile"?: unknown;
    "user-goals"?: unknown;
    "training-plan"?: unknown;
    "coach-feed"?: unknown;
    "coach-chat-history"?: unknown;
    "onboarding-completed"?: unknown;
    "last-weekly-report-date"?: unknown;
    "coach-feed-last-seen"?: unknown;
    // Diario
    "diary-index"?: string[];
    // Giorni indicizzati dal prefisso "day:"
    days: Record<string, unknown>; // key = "YYYY-MM-DD" (senza prefisso day:)
  };
}

const SIMPLE_KEYS = [
  "user-profile",
  "user-goals",
  "training-plan",
  "coach-feed",
  "coach-chat-history",
  "onboarding-completed",
  "last-weekly-report-date",
  "coach-feed-last-seen",
] as const;

export async function buildBackup(): Promise<BackupPayload> {
  const data: BackupPayload["data"] = { days: {} };

  for (const k of SIMPLE_KEYS) {
    const v = await getJSON<unknown>(k, undefined as unknown);
    if (v !== undefined) (data as any)[k] = v;
  }

  const idx = await getJSON<string[]>("diary-index", []);
  data["diary-index"] = idx;

  // Raccoglie ogni giorno
  const allKeys = await storage.keys("day:");
  for (const k of allKeys) {
    const date = k.slice(4); // rimuove "day:"
    const dayData = await getJSON<unknown>(k, null);
    if (dayData !== null) data.days[date] = dayData;
  }

  return {
    schema: "training-coach-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: "1.0",
    data,
  };
}

/** Valida la struttura base del payload e ne estrae una versione sicura. */
export function validateBackup(raw: unknown): { ok: true; payload: BackupPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "File non valido (non è un oggetto)" };
  const p = raw as any;
  if (p.schema !== "training-coach-backup") return { ok: false, error: "Schema non riconosciuto — non sembra un backup di Training Coach" };
  if (typeof p.version !== "number") return { ok: false, error: "Versione del backup mancante" };
  if (p.version > 1) return { ok: false, error: `Versione backup ${p.version} non supportata (app supporta max v1)` };
  if (!p.data || typeof p.data !== "object") return { ok: false, error: "Payload 'data' mancante" };
  if (!p.data.days || typeof p.data.days !== "object") return { ok: false, error: "Diario (days) mancante" };
  return { ok: true, payload: p as BackupPayload };
}

export interface RestoreOptions {
  /** Se true, cancella TUTTI i dati dell'app prima di ripristinare. Default: true. */
  wipeBefore?: boolean;
  /** Se false, non sovrascrive chiavi esistenti. Default: true (sovrascrive tutto). */
  overwrite?: boolean;
}

export interface RestoreReport {
  restoredDays: number;
  restoredKeys: string[];
  skippedKeys: string[];
}

export async function restoreBackup(payload: BackupPayload, opts: RestoreOptions = {}): Promise<RestoreReport> {
  const { wipeBefore = true, overwrite = true } = opts;
  const report: RestoreReport = { restoredDays: 0, restoredKeys: [], skippedKeys: [] };

  if (wipeBefore) {
    // Pulisci giorni, index, namespace app (NON tocca chiave API né embeddings)
    const dayKeys = await storage.keys("day:");
    for (const k of dayKeys) await storage.delete(k);
    for (const k of SIMPLE_KEYS) await storage.delete(k);
    await storage.delete("diary-index");
  }

  const d = payload.data;
  for (const k of SIMPLE_KEYS) {
    const val = (d as any)[k];
    if (val === undefined || val === null) continue;
    if (!overwrite && (await getJSON<unknown>(k, undefined as unknown)) !== undefined) {
      report.skippedKeys.push(k);
      continue;
    }
    await setJSON(k, val);
    report.restoredKeys.push(k);
  }

  if (Array.isArray(d["diary-index"])) {
    await setJSON("diary-index", d["diary-index"]);
    report.restoredKeys.push("diary-index");
  }

  for (const [date, dayData] of Object.entries(d.days)) {
    // sanity check: date come YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    await setJSON(`day:${date}`, dayData);
    report.restoredDays++;
  }

  return report;
}

/** Trigger download file JSON nel browser. */
export function downloadBackup(payload: BackupPayload, filename?: string): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().split("T")[0];
  a.href = url;
  a.download = filename || `training-coach-backup_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
