// Formatter date condivisi. Evita la duplicazione tra Sparkline/DiaryApp/TrendsPage.
// TUTTI i parse di stringhe "YYYY-MM-DD" sono LOCALI (no new Date(iso)
// che le interpreta come UTC → off-by-one in TZ est di UTC).

/** Split sicuro "YYYY-MM-DD" → Date locale. */
export function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Oggi in "YYYY-MM-DD" locale (non UTC). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-04-17" → "17 apr". */
export function formatDayMonth(iso: string): string {
  try {
    return parseISODateLocal(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  } catch { return iso; }
}

/** "2026-04-17" → "17 apr 2026". */
export function formatDayMonthYear(iso: string): string {
  try {
    return parseISODateLocal(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

/** "2026-04-17" → "ven 17 apr". */
export function formatWeekdayDayMonth(iso: string): string {
  try {
    return parseISODateLocal(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
  } catch { return iso; }
}

/** Mesi tra una ISO date e oggi (approssimazione 30gg/mese). */
export function monthsSince(iso: string): number {
  try {
    const ms = Date.now() - parseISODateLocal(iso).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24 * 30));
  } catch { return 0; }
}

/** Giorni tra una ISO date e oggi (positivo se nel passato). */
export function daysSince(iso: string): number {
  try {
    const ms = Date.now() - parseISODateLocal(iso).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  } catch { return 0; }
}
