// FASE 2 — Fonte UNICA per la matematica delle date civili dell'app.
//
// PERCHÉ ESISTE (audit 2026-06-12): la matematica date era duplicata in ~5
// implementazioni di "lunedì della settimana", ~20 di "oggi YYYY-MM-DD" con
// DUE semantiche incompatibili (locale vs UTC), 4 pattern di "differenza in
// giorni" (solo 1 DST-safe), 5 varianti di parse. Conseguenze reali: la
// settimana del macro avanzava di martedì in Europe/Rome, readiness scartata
// tra mezzanotte e le 2, label sparkline sfasate di un giorno.
//
// REGOLA SEMANTICA UNICA: tutte le date "civili" (giorni del diario, del piano,
// gare) sono YYYY-MM-DD nel FUSO LOCALE dell'utente. Niente UTC nelle date
// civili. Vietato nei call-site:
//   - new Date("2026-06-15")            → interpreta UTC, off-by-one a est di UTC
//   - d.toISOString().slice(0, 10)      → restituisce il giorno UTC, non locale
// Usare invece parseISO / toISO di questo modulo.
//
// Le funzioni sono PURE tranne todayISO() (legge l'orologio). Zero I/O, zero
// dipendenze interne: è un modulo foglia.

/** Etichette giorni, lunedì-based (allineate a it-IT short e ai literal del repo). */
export const DAY_LABELS_MON = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;
export type DayLabel = typeof DAY_LABELS_MON[number];

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True se la stringa è un YYYY-MM-DD sintatticamente valido e indica una data reale. */
export function isValidISO(iso: unknown): iso is string {
  if (typeof iso !== "string" || !ISO_RE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  // Rifiuta overflow (es. 2026-02-30 → 2026-03-02): i componenti devono combaciare.
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** "YYYY-MM-DD" → Date a mezzanotte LOCALE. null se invalida. */
export function parseISO(iso: string): Date | null {
  if (!isValidISO(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date → "YYYY-MM-DD" LOCALE (usa i componenti locali, mai toISOString). */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Oggi in "YYYY-MM-DD" LOCALE. Unica funzione non pura del modulo. */
export function todayISO(): string {
  return toISO(new Date());
}

/**
 * Aggiunge (o sottrae) n giorni a una data civile, restituendo YYYY-MM-DD.
 * DST-safe: opera sui componenti calendariali, non sui millisecondi.
 * null se l'input non è valido.
 */
export function addDays(iso: string, n: number): string | null {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/**
 * Indice del giorno lunedì-based: lun=0, mar=1, ... dom=6.
 * -1 se la data non è valida.
 */
export function dayIndexMon(iso: string): number {
  const d = parseISO(iso);
  if (!d) return -1;
  return (d.getDay() + 6) % 7;
}

/** Etichetta giorno ("lun".."dom") per una data civile. null se invalida. */
export function dayLabel(iso: string): DayLabel | null {
  const idx = dayIndexMon(iso);
  return idx < 0 ? null : DAY_LABELS_MON[idx];
}

/**
 * Lunedì della settimana che contiene `iso` (settimane lun→dom).
 * null se invalida. Robusto anche se `iso` non è un lunedì.
 */
export function mondayOf(iso: string): string | null {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}

/** Alias semantico di mondayOf: inizio (lunedì) della settimana. */
export const weekStart = mondayOf;

/** Domenica della settimana che contiene `iso` (fine settimana lun→dom). */
export function weekEnd(iso: string): string | null {
  const monday = mondayOf(iso);
  return monday ? addDays(monday, 6) : null;
}

/**
 * Differenza in GIORNI INTERI civili: (b - a). Positivo se b è dopo a.
 * DST-safe per costruzione: confronta gli istanti UTC dei due giorni di
 * calendario (Date.UTC), quindi un cambio ora legale tra le due date non
 * introduce mai l'errore "6 giorni e 23 ore → floor 6". null se input invalido.
 */
export function daysBetween(aISO: string, bISO: string): number | null {
  if (!isValidISO(aISO) || !isValidISO(bISO)) return null;
  const [ay, am, ad] = aISO.split("-").map(Number);
  const [by, bm, bd] = bISO.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86_400_000);
}

/** Giorni da `iso` a oggi (positivo se nel passato). null se invalida. */
export function daysSinceToday(iso: string): number | null {
  return daysBetween(iso, todayISO());
}

/** True se `iso` è oggi (confronto su date civili locali). */
export function isToday(iso: string): boolean {
  return iso === todayISO();
}
