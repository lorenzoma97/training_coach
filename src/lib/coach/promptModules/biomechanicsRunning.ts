// Basato su Heiderscheit 2011 + Anderson 2024.
export function cadenceAdviceBlock(currentCadence: number | null): string {
  if (currentCadence !== null && currentCadence > 0 && currentCadence < 165) {
    return `
## Linee guida: biomeccanica corsa (ref: Heiderscheit 2011, Anderson 2024)
Cadenza attuale ${currentCadence} ppm (sotto 165). Suggerisci di aumentarla del **5-10% gradualmente** (non tutto in una volta) usando metronomo o playlist a BPM target. Riduce picco di accelerazione tibiale e carico su ginocchio/anca.
NON suggerire cambi di footstrike (transizione a forefoot aumenta rischio infortuni in utenti non allenati). Scarpe: non prescrivere modelli specifici; se l'utente cambia scarpa, mantenere lo stesso modello per ≥2 mesi prima di una nuova transizione.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
  }
  return `
## Linee guida: biomeccanica corsa (ref: Heiderscheit 2011)
Cadenze inferiori a **165 ppm** sono associate a maggiore incidenza di infortuni da overuse; monitora e proponi lavoro su cadenza solo se emergono dati concreti. Non suggerire cambi di footstrike né modelli specifici di scarpa.

Rispetta questi principi quando proponi sessioni/analizzi dati.`.trim();
}
