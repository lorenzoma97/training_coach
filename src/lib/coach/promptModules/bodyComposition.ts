// Basato su: Silva et al. 2023 (Olympic athletes body comp reference),
// Ackland IOC 2012 (body comp assessment consensus), Campa 2021 (BIA in athletes),
// Lukaski 2015, Kasper 2021 (BIA limiti individuali),
// Sun 2025 (cold-water/sprint performance e TBW).
export interface BodyCompSummary {
  bodyFat?: number;      // %
  muscleMass?: number;   // kg OR % — valore grezzo come inserito da bilancia BIA
  bodyWater?: number;    // %TBW
}

export function bodyCompositionBlock(latest: BodyCompSummary, trend7d?: BodyCompSummary): string {
  const has = (n: number | undefined) => typeof n === "number" && Number.isFinite(n);
  const lines: string[] = [];

  if (has(latest.bodyFat)) lines.push(`- Massa grassa attuale: ${latest.bodyFat}%`);
  if (has(latest.muscleMass)) lines.push(`- Massa muscolare: ${latest.muscleMass}`);
  if (has(latest.bodyWater)) lines.push(`- Acqua corporea (TBW): ${latest.bodyWater}%`);

  if (trend7d && (has(trend7d.bodyFat) || has(trend7d.muscleMass) || has(trend7d.bodyWater))) {
    lines.push("- Trend ultimi 7 giorni:");
    if (has(trend7d.bodyFat)) lines.push(`  • BF%: ${trend7d.bodyFat! > 0 ? "+" : ""}${trend7d.bodyFat}`);
    if (has(trend7d.muscleMass)) lines.push(`  • Massa muscolare: ${trend7d.muscleMass! > 0 ? "+" : ""}${trend7d.muscleMass}`);
    if (has(trend7d.bodyWater)) lines.push(`  • TBW%: ${trend7d.bodyWater! > 0 ? "+" : ""}${trend7d.bodyWater}`);
  }

  return `
## Linee guida: composizione corporea (ref: Silva 2023, Ackland IOC 2012, Campa 2021)

Dati disponibili:
${lines.join("\n")}

INTERPRETAZIONE EVIDENCE-BASED:
- **Massa grassa (BF%)**: correla con performance in sport endurance (meno BF = migliore economia, costo ~2-3% VO2/kg). Range salutare: donne 18-28%, uomini 10-20%. Range atleta endurance: donne 14-20%, uomini 6-13%. **Non spingere mai al ribasso** senza supervisione (rischio RED-S, Mountjoy IOC 2023).
- **Massa muscolare (SMM)**: correla positivamente con potenza, forza, e tempi in sport misti (BIA sport-level). Aumenti di 1-2 kg in 12 settimane sono realistici per intermedi (Schoenfeld 2017).
- **Acqua corporea (TBW)**: proxy di idratazione cronica (normale adulto 50-65% peso). Riduzioni >2% del peso corporeo via disidratazione compromettono prestazione aerobica e forza (Sawka ACSM 2007). TBW cronicamente basso indica disidratazione o ridotto contenuto muscolare (muscolo = 75% acqua).

CAUTELE SUL DATO (BIA domestica):
- Errore tipico ±3-8% su BF%, ±2-4% su TBW (Kasper 2021).
- Sensibile a: idratazione momentanea, pasti recenti, esercizio nelle 4h precedenti, ciclo mestruale.
- **Usa il TREND, non il valore singolo**. Una variazione <1% in una settimana è rumore.

RED FLAG DA SEGNALARE:
- BF% in calo rapido (>1.5% in 2 settimane) in atleta con storia RED-S → possibile LEA ricorrente.
- Massa muscolare in calo + RPE in salita → possibile overtraining catabolico (Meeusen 2013).
- TBW in calo cronico (>3%) con attività costante → disidratazione cronica o perdita massa magra.

COSA NON FARE:
- Non prescrivere "target BF%" specifici: è dominio del nutrizionista sportivo.
- Non raccomandare deficit calorici basati su BF% da BIA domestica (errore troppo alto).
- Non ignorare: commenta solo trend significativi, non valori singoli.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
