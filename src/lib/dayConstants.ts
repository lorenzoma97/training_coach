// Costanti per i giorni della settimana, centralizzate per evitare:
// - Duplicazione (l'array era ripetuto 13 volte nel codebase)
// - Inconsistenza ordine (alcuni file usavano lun-based, altri dom-based)
// - Bug subtili di off-by-one nel matching piano↔diario

/** Ordine canonico lun-dom usato dal piano coach (ISO 8601 week). */
export const DAYS_LUN_DOM = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const;
export type DayKey = typeof DAYS_LUN_DOM[number];

/** Ordine getDay()-aligned: indice 0=dom, 1=lun, ..., 6=sab.
 *  Usato SOLO per mappare l'output di Date.prototype.getDay() a un day label. */
export const DAYS_DOM_FIRST: ReadonlyArray<DayKey> = [
  "dom", "lun", "mar", "mer", "gio", "ven", "sab",
];

/** Da Date locale → label canonica lun-dom. */
export function dayLabelFromDate(d: Date): DayKey {
  return DAYS_DOM_FIRST[d.getDay()];
}

/** Indice 0-6 lun-based per una Date locale. lun=0, dom=6. */
export function dayIdxLunBased(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Trova l'indice 0-6 di un day label nell'array lun-dom. -1 se non valido. */
export function dayIdxFromLabel(label: string): number {
  return (DAYS_LUN_DOM as ReadonlyArray<string>).indexOf(label);
}
