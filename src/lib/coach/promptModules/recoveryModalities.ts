// Basato su Dupuy 2018 (meta-analysis) + Wiewelhove 2019 + Leeder 2012.
export function recoveryBlock(intensity: "light" | "moderate" | "hard"): string {
  let body = "";
  if (intensity === "hard") {
    body = `Sessione PRECEDENTE intensa. Proponi modalità di recupero con evidenza:
- **Massaggio** (modalità più efficace in meta-analisi Dupuy 2018).
- **Recupero attivo** 10-20 min a FC bassa (camminata, pedalata leggera).
- **Compression garments** per 12-48h post-sessione.
- **CWI (immersione fredda)** 11-15 °C per 11-15 min (Wiewelhove 2019).
- Evita stretching statico passivo intenso subito dopo (non accelera il recupero).`;
  } else if (intensity === "moderate") {
    body = `Sessione PRECEDENTE moderata. Suggerisci:
- **Recupero attivo** leggero (camminata 15-20 min, mobility).
- **Foam rolling** 8-10 min sui gruppi coinvolti.`;
  } else {
    body = `Sessione PRECEDENTE leggera. Sufficienti:
- Mobility articolare di routine (10 min).
- Idratazione e pasto bilanciato.`;
  }
  return `
## Linee guida: recovery (ref: Dupuy 2018, Wiewelhove 2019)
${body}

WARNING: **CWI sistematico post-forza attenua adattamenti di ipertrofia e forza** (Leeder 2012). Limita l'uso a post-corsa intensa o giorni pre-gara, non usarlo routinariamente dopo sessioni di forza.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
