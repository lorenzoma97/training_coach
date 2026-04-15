// Blocco prompt che espone al coach le zone FC PERSONALIZZATE dell'utente
// (Tanaka / Karvonen / Empirica) + tempo-per-zona + check polarizzato 80/20.
// Iniettato quando il contesto include corsa o un obiettivo running.

import type { ZonesResult, TimeInZone } from "../zones";

export function zonesBlock(
  zones: ZonesResult,
  timeInZone?: TimeInZone[],
  polar?: { lowPct: number; highPct: number; isPolarized: boolean },
  totalSessions?: number,
): string {
  const methodLabel = {
    empirical: "derivate dallo storico corse (empirica)",
    karvonen: "metodo Karvonen (FC riserva)",
    tanaka: "stima generica Tanaka (età, errore ±10bpm)",
  }[zones.method];

  const zonesLines = zones.zones.map(z =>
    `- ${z.shortLabel} (${z.name}): ${z.hrLow}-${z.hrHigh} bpm, RPE ${z.rpeLow}-${z.rpeHigh}`
    + (z.paceTypicalSec ? `, passo tipico ${Math.floor(z.paceTypicalSec / 60)}:${String(z.paceTypicalSec % 60).padStart(2, "0")}/km` : "")
  ).join("\n");

  let analyticsSection = "";
  if (timeInZone && timeInZone.length && (totalSessions ?? 0) >= 4) {
    const total = timeInZone.reduce((a, z) => a + z.minutes, 0);
    if (total > 0 && polar) {
      const distribLines = timeInZone
        .filter(t => t.minutes > 0)
        .map(t => `Z${t.zoneIndex}: ${t.minutes}min (${Math.round(t.minutes / total * 100)}%)`)
        .join(", ");
      analyticsSection = `
ULTIMI CARICHI PER ZONA (corse con FC tracciata): ${distribLines}.
Distribuzione bassa/alta intensità: ${polar.lowPct}% / ${polar.highPct}% ${polar.isPolarized ? "(✓ polarizzata ok)" : "(⚠ sbilanciata: target ≥75% bassa intensità)"}.`;
    }
  }

  return `
ZONE DI FREQUENZA CARDIACA PERSONALIZZATE DELL'UTENTE (${methodLabel}):
FCmax usata: ${zones.fcMax} bpm${zones.fcMaxObserved ? ` (osservata dai workout, > Tanaka teorica)` : ""}${zones.fcRest ? `, FC a riposo mattutina: ${zones.fcRest} bpm` : ""}
${zonesLines}
${analyticsSection}

REGOLE PER IL COACH:
- Quando commenti la FC media di una corsa, confrontala con la zona personalizzata dell'utente, NON con la soglia Tanaka generica. Se l'utente ha Z2 empirica più alta della teorica, non rimproverarlo per "FC troppo alta" se resta nel suo range.
- Se suggerisci una sessione Z2/Z3/Z4/Z5, cita il range bpm personalizzato (es. "Z4 per te: 155-170 bpm") così l'utente sa cosa targetare.
- Se la distribuzione polarizzata è sbilanciata (<75% in Z1+Z2), segnala al coach ma senza allarmi: suggerisci di rallentare i fondi lenti, non di evitare i lavori di qualità.
- Se il metodo è "tanaka" (stima generica), informa l'utente che aggiungendo la FC a riposo mattutina nel check le zone diventano più accurate.
`.trim();
}
