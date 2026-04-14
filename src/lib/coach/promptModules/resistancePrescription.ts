// Basato su ACSM Position Stand Ratamess 2009 + Schoenfeld 2017 + Grgic 2018.
import type { Experience } from "../../types";

export function resistancePrescriptionBlock(experience: Experience): string {
  const byLevel: Record<Experience, string> = {
    sedentary: `NOVIZIO/SEDENTARIO: 1-3 set, 8-12 rep, 60-70% 1RM (o carico che permette forma pulita), 2-3x/sett su full-body. Focus tecnica, progressione graduale. Evita massimali e lavoro eccentrico eccessivo nei primi 2 mesi.`,
    occasional: `INTERMEDIO/OCCASIONALE: 3-4 set, 6-12 rep, 70-80% 1RM, 2-3x/sett per gruppo muscolare. Introduce variazione stimolo (ipertrofia + forza).`,
    regular: `AMATORIALE REGOLARE: 3-6 set, 1-12 rep a seconda obiettivo, 70-85% 1RM ipertrofia, 85-95% forza massimale, 2-3x/sett per gruppo. Periodizzazione lineare o ondulatoria.`,
    competitive: `AGONISTA: periodizzazione strutturata (accumulation/intensification/realization). Set 3-6, rep 1-12, 70-100% 1RM secondo ciclo. Monitoraggio volume-intensità accurato.`,
  };
  return `
## Linee guida: prescrizione forza (ref: Ratamess ACSM 2009)
${byLevel[experience]}

RANGE PER OBIETTIVO (applicabili a tutti i livelli):
- Ipertrofia: 6-12 rep, 65-80% 1RM, ≥10 set/muscolo/settimana (Schoenfeld 2017).
- Forza massimale: 1-5 rep, 85-100% 1RM, 3-5 min recupero.
- Potenza/esplosiva: 3-5 rep, 30-60% 1RM eseguiti con massima velocità concentrica.
- Resistenza muscolare: 15+ rep, <65% 1RM, recuperi brevi.

Frequenza per gruppo muscolare: 2-3x/settimana > 1x a parità di volume (Grgic 2018).
Progressione: aggiungi carico (2-10%) o rep quando tutti i set completati con forma pulita.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
