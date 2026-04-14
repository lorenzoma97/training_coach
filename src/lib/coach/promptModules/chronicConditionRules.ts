// Basato su Colberg 2016 (ADA), Pescatello 2004 (ACSM), Donnelly 2009 (ACSM).
export function chronicConditionBlock(conditions: string[]): string {
  if (!conditions || conditions.length === 0) return "";

  const parts: string[] = [];

  if (conditions.includes("diabetes")) {
    parts.push(`- **Diabete** (Colberg 2016): 150 min/sett aerobica moderata + 2-3 sessioni forza/sett. Non saltare più di 2 giorni consecutivi senza movimento. Per T1: monitorare glicemia **pre e post** sessione, cautela ipoglicemia (avere carboidrati rapidi a disposizione). Evita esercizio intenso con glicemia <100 o >250 mg/dL senza controllo medico.`);
  }
  if (conditions.includes("hypertension")) {
    parts.push(`- **Ipertensione** (Pescatello 2004): **30 min attività moderata ≥5 giorni/sett** riduce PA di 5-7 mmHg. Evita manovra di Valsalva e heavy lifting massimale se PA non controllata. Preferisci aerobica regolare e forza con carichi moderati (60-70% 1RM) e respirazione continua.`);
  }
  if (conditions.includes("obesity")) {
    parts.push(`- **Obesità** (Donnelly 2009): per perdita peso significativa servono **225-420 min/sett aerobica** combinata con deficit calorico di **500-750 kcal/die** (da concordare con nutrizionista). Inizio graduale, impact basso (camminata/bici/piscina) per proteggere articolazioni. Integra forza 2x/sett per preservare massa magra.`);
  }
  if (conditions.includes("cardiac")) {
    parts.push(`- **Condizione cardiaca**: **consenso medico obbligatorio** prima di iniziare o intensificare. Evita soglia anaerobica senza supervisione. Monitora FC e sintomi (dolore toracico, dispnea sproporzionata, sincope) come stop immediato. Preferisci intensità Z1-Z2, progressione lentissima.`);
  }

  if (parts.length === 0) return "";

  return `
## Linee guida: condizioni croniche (ref: Colberg 2016, Pescatello 2004, Donnelly 2009)
L'utente presenta condizioni croniche rilevanti. Applica le seguenti regole:
${parts.join("\n")}

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
