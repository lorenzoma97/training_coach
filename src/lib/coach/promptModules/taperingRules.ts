// Basato su Bosquet 2007 (meta-analysis) + Spilsbury 2023.
export function taperingBlock(daysToRace: number): string {
  return `
## Linee guida: tapering pre-gara (ref: Bosquet 2007, Spilsbury 2023)
Gara fra **${daysToRace} giorni**. Applica tapering corretto:
- **Riduci volume del 41-60%** con decremento esponenziale (taglio maggiore nell'ultima settimana).
- **Intensità invariata**: mantieni stimoli di qualità (ripetute brevi a ritmo gara, allunghi). Tagliare l'intensità fa perdere adattamenti.
- **Frequenza invariata**: stesso numero di sessioni/settimana, più corte.
- **Finestra ottimale 8-14 giorni**; tapering più brevi (7 gg) o più lunghi (15-21 gg) funzionano ma con effetto minore.
- Effect size maggiore per **eventi endurance** (+0.5-6% performance al traguardo).
- Ultima sessione dura 48-72h prima della gara; poi scarico completo + mobility.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
