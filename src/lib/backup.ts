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
    "training-plan-next"?: unknown;
    "plan-history"?: unknown;
    "coach-feed"?: unknown;
    "coach-chat-history"?: unknown;
    "onboarding-completed"?: unknown;
    "last-weekly-report-date"?: unknown;
    "last-motivation-date"?: unknown;
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
  "training-plan-next",
  "plan-history",
  "coach-feed",
  "coach-chat-history",
  "onboarding-completed",
  "last-weekly-report-date",
  "last-motivation-date",
  "coach-feed-last-seen",
] as const;

/** Chiavi NON esportate intenzionalmente:
 *  - "llm-config" / "gemini-api-key": contengono apiKey → security se l'utente
 *    condivide il backup. L'utente reinserirà la chiave dopo il restore.
 *  - "pending-chat-prompt", "pending-diary-openAdd", "restore-in-progress":
 *    stati transitori, non utili nel backup.
 *  - "onboarding-draft": bozza in-progress, non rilevante post-restore.
 */

/** Chiave sentinel per rilevare restore interrotti a metà. */
export const RESTORE_IN_PROGRESS_KEY = "restore-in-progress";

export interface RestoreInProgressInfo {
  startedAt: string; // ISO
  keysToWipe: string[];
}

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
    // __APP_VERSION__ iniettato al build da vite.config.ts (da package.json).
    // In test/SSR senza Vite, fallback a "dev" per evitare crash.
    appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
    data,
  };
}

/**
 * Shape minima di un giorno: oggetto con almeno una tra { daily, workouts }.
 * Evita che un JSON malevolo scriva stringhe arbitrarie dentro `day:*`.
 */
function isValidDayShape(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  // Almeno uno dei due campi canonici deve essere un oggetto/array
  const dailyOk = d.daily === undefined || (typeof d.daily === "object" && d.daily !== null && !Array.isArray(d.daily));
  const workoutsOk = d.workouts === undefined || Array.isArray(d.workouts);
  const hasAtLeastOne = d.daily !== undefined || d.workouts !== undefined;
  return dailyOk && workoutsOk && hasAtLeastOne;
}

/**
 * Validazione profonda dei contratti base delle chiavi annidate.
 * Ritorna il primo errore incontrato oppure null se tutto ok.
 *
 * Nota: la validazione NON è un full-schema — si limita a garantire che
 * il payload non contenga tipi nativamente incompatibili (es. `user-goals`
 * che è una stringa invece che un array). Eventuali campi sconosciuti
 * dentro gli oggetti sono tollerati (forward compatibility).
 */
function validateNestedShape(payload: { data: Record<string, unknown> }): string | null {
  const d = payload.data;

  // days: ogni entry deve essere un oggetto con daily (oggetto) e/o workouts (array)
  const days = d.days;
  if (days && typeof days === "object" && !Array.isArray(days)) {
    for (const [date, dayData] of Object.entries(days as Record<string, unknown>)) {
      if (!dayData || typeof dayData !== "object" || Array.isArray(dayData)) {
        return `Giorno "${date}": non è un oggetto valido.`;
      }
      const day = dayData as Record<string, unknown>;
      if (day.workouts !== undefined && day.workouts !== null && !Array.isArray(day.workouts)) {
        return `Giorno "${date}": campo "workouts" deve essere un array.`;
      }
      // day.daily: null è SEMANTICAMENTE EQUIVALENTE a "non presente" (l'utente
      // non ha compilato il check giornaliero) — il codice dell'app produce
      // legittimamente `daily: null` quando si salva un workout su un giorno
      // senza check daily. Tolleriamo null/undefined indifferentemente;
      // rifiutiamo solo tipi realmente sbagliati (stringa, array, numero).
      if (
        day.daily !== undefined &&
        day.daily !== null &&
        (typeof day.daily !== "object" || Array.isArray(day.daily))
      ) {
        return `Giorno "${date}": campo "daily" deve essere un oggetto o null.`;
      }
    }
  }

  // user-profile: se presente → oggetto con age numerico 1-120
  const profile = d["user-profile"];
  if (profile !== undefined && profile !== null) {
    if (typeof profile !== "object" || Array.isArray(profile)) {
      return `"user-profile" deve essere un oggetto.`;
    }
    const age = (profile as Record<string, unknown>).age;
    if (typeof age !== "number" || !Number.isFinite(age) || age < 1 || age > 120) {
      return `"user-profile.age" deve essere un numero tra 1 e 120.`;
    }
  }

  // user-goals: se presente → array
  const goals = d["user-goals"];
  if (goals !== undefined && goals !== null && !Array.isArray(goals)) {
    return `"user-goals" deve essere un array.`;
  }

  // diary-index: se presente → array di stringhe
  const idx = d["diary-index"];
  if (idx !== undefined && idx !== null && !Array.isArray(idx)) {
    return `"diary-index" deve essere un array.`;
  }

  // coach-chat-history: se presente → array
  const chat = d["coach-chat-history"];
  if (chat !== undefined && chat !== null && !Array.isArray(chat)) {
    return `"coach-chat-history" deve essere un array.`;
  }

  // coach-feed: se presente → array
  const feed = d["coach-feed"];
  if (feed !== undefined && feed !== null && !Array.isArray(feed)) {
    return `"coach-feed" deve essere un array.`;
  }

  // training-plan: se presente → oggetto
  const plan = d["training-plan"];
  if (plan !== undefined && plan !== null && (typeof plan !== "object" || Array.isArray(plan))) {
    return `"training-plan" deve essere un oggetto.`;
  }

  return null;
}

/**
 * Versione schema corrente. Se in futuro cambieremo la shape in modo breaking
 * (es. rename chiavi, nuovi campi REQUIRED), incrementiamo a 2 e aggiungiamo
 * un ramo in `migrateToLatest` per leggere v1 e trasformarla in v2.
 */
const CURRENT_SCHEMA_VERSION = 1;

/**
 * Migrator per backup più vecchi della versione corrente.
 * Accetta un payload VALIDATO a livello base (schema, version, data) e lo
 * promuove alla shape attesa dall'app. Per v1 è identità (no-op).
 *
 * Per futura v2: assumere che i nuovi campi opzionali (zone, fcMaxTested,
 * painTrackingAreas) possano mancare da v1 → inizializzare a default.
 * Esempio (non ancora necessario):
 *   if (payload.version === 1) {
 *     // Aggiungi defaults per campi v2 assenti...
 *     payload.version = 2;
 *   }
 */
function migrateToLatest(payload: BackupPayload): BackupPayload {
  // v1 → v1: identity. Nessuna migration necessaria al momento.
  // I campi recentemente aggiunti (zone in PlannedSession, fcMaxTested in
  // UserProfile, painTrackingAreas) sono tutti OPTIONAL, quindi payload
  // v1 storici continuano a funzionare senza trasformazione.
  return payload;
}

/** Valida la struttura base del payload e ne estrae una versione sicura. */
export function validateBackup(raw: unknown): { ok: true; payload: BackupPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "File non valido (non è un oggetto)" };
  const p = raw as { schema?: unknown; version?: unknown; data?: unknown };
  if (p.schema !== "training-coach-backup") return { ok: false, error: "Schema non riconosciuto — non sembra un backup di Training Coach" };
  if (typeof p.version !== "number") return { ok: false, error: "Versione del backup mancante" };
  if (p.version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: `Versione backup ${p.version} più recente di quella supportata (max v${CURRENT_SCHEMA_VERSION}). Aggiorna l'app prima di ripristinare.` };
  }
  if (!p.data || typeof p.data !== "object") return { ok: false, error: "Payload 'data' mancante" };
  const data = p.data as Record<string, unknown>;
  if (!data.days || typeof data.days !== "object" || Array.isArray(data.days)) {
    return { ok: false, error: "Diario (days) mancante o malformato" };
  }

  // Validazione profonda dei contratti base delle chiavi annidate.
  const nestedErr = validateNestedShape({ data });
  if (nestedErr) return { ok: false, error: `Struttura backup non valida: ${nestedErr}` };

  // Migration hook: eventuali backup v1 in futuro verrebbero promossi qui.
  const migrated = migrateToLatest(p as unknown as BackupPayload);
  return { ok: true, payload: migrated };
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

/**
 * Ripristina un backup in modo atomico rispetto alla rilevazione di interruzioni.
 *
 * Protocollo anti-data-loss:
 * 1. PRIMA del wipe, scrive `restore-in-progress` con { startedAt, keysToWipe }.
 * 2. Esegue wipe + restore.
 * 3. SE tutto va a buon fine, cancella `restore-in-progress`.
 * 4. SE una scrittura fallisce (quota, payload-too-large, ecc.), la sentinel resta
 *    in localStorage e verrà rilevata al prossimo avvio via `checkPendingRestore`.
 *
 * @throws Qualsiasi errore di storage (quota, value-too-large). In tal caso la
 * sentinel `restore-in-progress` NON viene rimossa.
 */
export async function restoreBackup(payload: BackupPayload, opts: RestoreOptions = {}): Promise<RestoreReport> {
  const { wipeBefore = true, overwrite = true } = opts;
  const report: RestoreReport = { restoredDays: 0, restoredKeys: [], skippedKeys: [] };

  // --- 1) Scrivi sentinel PRIMA di qualunque modifica distruttiva ---
  const existingDayKeys = await storage.keys("day:");
  const keysToWipe: string[] = wipeBefore
    ? [...existingDayKeys, ...SIMPLE_KEYS, "diary-index"]
    : [];
  const sentinel: RestoreInProgressInfo = {
    startedAt: new Date().toISOString(),
    keysToWipe,
  };
  try {
    await storage.set(RESTORE_IN_PROGRESS_KEY, JSON.stringify(sentinel));
  } catch (e) {
    // Se non possiamo nemmeno scrivere la sentinel, meglio NON iniziare il wipe.
    console.error("[restoreBackup] Impossibile scrivere sentinel restore-in-progress:", e);
    throw e;
  }

  try {
    // --- 2) Wipe ---
    if (wipeBefore) {
      for (const k of existingDayKeys) await storage.delete(k);
      for (const k of SIMPLE_KEYS) await storage.delete(k);
      await storage.delete("diary-index");
    }

    // --- 3) Restore ---
    const d = payload.data;
    for (const k of SIMPLE_KEYS) {
      const val = (d as any)[k];
      if (val === undefined || val === null) continue;
      if (!overwrite && (await getJSON<unknown>(k, undefined as unknown)) !== undefined) {
        report.skippedKeys.push(k);
        continue;
      }
      try {
        await setJSON(k, val);
        report.restoredKeys.push(k);
      } catch (e) {
        console.error(`[restoreBackup] setJSON fallito per chiave "${k}":`, e);
        throw e;
      }
    }

    if (Array.isArray(d["diary-index"])) {
      try {
        await setJSON("diary-index", d["diary-index"]);
        report.restoredKeys.push("diary-index");
      } catch (e) {
        console.error(`[restoreBackup] setJSON fallito per "diary-index":`, e);
        throw e;
      }
    }

    for (const [date, dayData] of Object.entries(d.days)) {
      // sanity check: date come YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!isValidDayShape(dayData)) {
        report.skippedKeys.push(`day:${date} (shape non valida)`);
        continue;
      }
      try {
        await setJSON(`day:${date}`, dayData);
        report.restoredDays++;
      } catch (e) {
        console.error(`[restoreBackup] setJSON fallito per "day:${date}":`, e);
        throw e;
      }
    }

    // --- 4) Tutto ok: rimuovi sentinel ---
    await storage.delete(RESTORE_IN_PROGRESS_KEY);
    return report;
  } catch (e) {
    // Lascia DELIBERATAMENTE la sentinel in localStorage come segnale di corruzione.
    console.error(
      "[restoreBackup] Restore interrotto a metà. Sentinel restore-in-progress lasciata in localStorage " +
      "così il prossimo avvio potrà avvisare l'utente. Errore originale:",
      e,
    );
    throw e;
  }
}

/**
 * Da chiamare all'avvio dell'app per rilevare un restore interrotto.
 *
 * ATTENZIONE (per il consumer, tipicamente App.tsx):
 * - Se ritorna `{ status: "interrupted", info }`, lo stato di localStorage potrebbe
 *   essere parzialmente corrotto (wipe avvenuto ma restore non concluso).
 * - Il consumer DOVREBBE mostrare un avviso all'utente e proporre di ri-importare
 *   il backup originale oppure di cancellare la sentinel (`clearPendingRestoreFlag`)
 *   se conferma di aver gestito manualmente la situazione.
 * - Questa funzione NON modifica lo stato: è di sola lettura.
 *
 * @returns `{ status: "clean" }` se nessun restore è pendente, altrimenti
 * `{ status: "interrupted", info }` con i dati della sentinel.
 */
export async function checkPendingRestore(): Promise<
  { status: "clean" } | { status: "interrupted"; info: RestoreInProgressInfo }
> {
  const r = await storage.get(RESTORE_IN_PROGRESS_KEY);
  if (!r) return { status: "clean" };
  try {
    const info = JSON.parse(r.value) as RestoreInProgressInfo;
    if (!info || typeof info.startedAt !== "string") {
      // Sentinel malformata: trattala come interrotto ma con info vuote
      return { status: "interrupted", info: { startedAt: "", keysToWipe: [] } };
    }
    return { status: "interrupted", info };
  } catch {
    return { status: "interrupted", info: { startedAt: "", keysToWipe: [] } };
  }
}

/**
 * Cancella la sentinel `restore-in-progress` senza modificare altro.
 * Da chiamare SOLO se l'utente ha confermato di aver risolto manualmente.
 */
export async function clearPendingRestoreFlag(): Promise<void> {
  await storage.delete(RESTORE_IN_PROGRESS_KEY);
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
