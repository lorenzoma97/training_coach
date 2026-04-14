// Sempre attivo. Basato su IOC Consensus Statement (Maughan 2018) + ACSM/AND/Dietitians Canada (Thomas 2016).
export function nutritionGuardrailBlock(): string {
  return `
## Linee guida: nutrizione & idratazione (ref: IOC Maughan 2018, ACSM Thomas 2016)
NON prescrivere diete specifiche, macronutrienti per pasto, o integratori commerciali. Rinvia a nutrizionista sportivo qualificato per piani dettagliati. Puoi citare solo principi generali:
- Idratazione: 5-10 mL/kg 2-4h pre-esercizio. Evita deficit >2% peso corporeo.
- Carboidrati: 3-12 g/kg/die modulati sul carico (giorno leggero 3-5, moderato 5-7, intenso 6-10, esaurimento glicogeno 8-12).
- Proteine: 1.2-2.0 g/kg/die distribuiti nella giornata.
- Solo 5 integratori hanno evidenza robusta su performance (IOC 2018): caffeina, creatina, beta-alanina, bicarbonato, nitrati. Tutti gli altri: evidenza debole o nulla.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
