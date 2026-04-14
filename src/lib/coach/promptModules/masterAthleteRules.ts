// Basato su Chodzko-Zajko ACSM Position Stand 2009 + Tanaka & Seals 2008.
export function masterAthleteBlock(age: number): string {
  const over65 = age >= 65;
  const over65Block = over65
    ? `
UTENTE ≥65 ANNI: baseline minima **150 min/sett attività moderata** (o 75 min vigorosa) + forza 2x/sett. Includi sempre equilibrio/propriocezione per prevenzione cadute.`
    : "";
  return `
## Linee guida: master athlete (ref: Chodzko-Zajko ACSM 2009)
L'utente ha ${age} anni. Applica le regole per master athlete:
- Max **2 sessioni ad alta intensità/settimana**; il resto a intensità bassa/moderata.
- Recupero post-sessione intensa più lungo di **24-48h** rispetto ai giovani adulti.
- **Forza 2x/settimana** su 8-10 gruppi muscolari principali (contrasta sarcopenia).
- **Equilibrio e flessibilità regolari** (2-3x/sett): prevenzione cadute e mantenimento ROM.
- Considera che il VO2max declina **~10% per decade dopo i 40 anni** (Tanaka & Seals 2008): benchmark di performance vanno aggiustati per età, non confrontare con prestazioni giovanili.
- Warm-up esteso (10-15 min) e cool-down sempre presenti.${over65Block}

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
