// Knowledge base scientifica del coach — 38 chunk auto-contenuti
// Fonte: docs/scientific-foundations.md
// Ogni chunk sintetizza: cosa fa il coach + evidenza + implicazione + warning.
//
// Wave 2.1: aggiunto campo `contexts: RagContext[]` per RAG context routing
// (vedi ARCHITECTURE.md §3.2). Il campo è additive (optional retroattivo), ma
// tutti i chunk esistenti sono ora taggati esplicitamente. Default behavior
// del retriever è "no filter" se contexts non specificato.

/**
 * Context tag per il routing RAG multi-pass (vedi contextRouter.ts).
 * Un chunk può appartenere a più contexts (1-3 tipici).
 * - "macro_periodization": chunks su periodizzazione, ACWR, fasi, taper, principi generali.
 * - "strength_db": forza (Ratamess, Schoenfeld, Rønnestad, programmazione pratica).
 * - "cardio_intervals": corsa intervalli, zone FC, polarizzazione.
 * - "sport_specific": calcio, tennis/padel, multi-sport.
 * - "mobility": recovery, mobility, foam rolling, stretching.
 * - "none": meta chunks usabili da qualsiasi pass (LLM coaching, safety generale).
 */
export type RagContext =
  | "macro_periodization"
  | "strength_db"
  | "cardio_intervals"
  | "sport_specific"
  | "mobility"
  | "none";

export interface KnowledgeChunk {
  id: string;
  sectionNumber: number;
  title: string;
  topics: string[];
  content: string;
  primaryCitation: string;
  links: string[];
  /** Context tag per RAG routing multi-pass. Vedi RagContext. */
  contexts: RagContext[];
}

export const CHUNKS: KnowledgeChunk[] = [
  {
    id: "sec-1-progression-rule",
    sectionNumber: 1,
    title: "Progressione del carico — la regola del 10%",
    topics: ["progressione", "volume settimanale", "training load", "10% rule", "injury prevention", "single-session spike"],
    content: `Il coach applica in safetyRules.ts due regole distinte. La regola primaria è ora lo spike di singola sessione (sessionSpikeMaxPct: 30): alert se la durata della sessione corrente supera di oltre +30% la sessione più lunga negli ultimi giorni. Il cap settimanale +10% (weeklyVolumeIncreaseMaxPct) è mantenuto come safeguard di secondo livello per neofiti assoluti.

L'evidenza scientifica mette in discussione la regola del 10% come dogma. Buist et al. (Am J Sports Med, 2008) in un RCT su 532 neofiti non trovano differenze di incidenza infortuni tra progressione +10%/settimana e progressione libera. Nielsen et al. (JOSPT, 2014) mostrano che solo aumenti superiori al 30% a settimana aumentano il rischio per specifici infortuni da overuse; sotto il 30% l'associazione è debole. Il paradigm shift decisivo viene da Johansen et al. (Br J Sports Med, 2025), cohort study su 5200 runner: il predittore forte del rischio non è il volume settimanale cumulativo ma lo spike della singola sessione rispetto alla sessione più lunga degli ultimi 30 giorni — spike del 10-30% correla con +64% rischio overuse.

Implicazione per il coach: la logica è stata aggiornata per mettere lo spike della singola sessione come metrica primaria. Il checkLocalRedFlags ora calcola il delta vs. la sessione più lunga recente e segnala warning se >+30%. Warning: non presentare il 10%/settimana come "legge" scientifica; presentarlo come linea prudenziale secondaria.`,
    primaryCitation: "Johansen 2025 (Br J Sports Med)",
    links: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC12421110/",
      "https://www.jospt.org/doi/10.2519/jospt.2014.5164"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-2-acwr",
    sectionNumber: 2,
    title: "Monitoraggio del carico — Acute:Chronic Workload Ratio",
    topics: ["ACWR", "acute chronic", "carico cronico", "training load monitoring", "injury risk", "sweet spot"],
    content: `Il coach attualmente non calcola un ACWR esplicito, ma confronta gli ultimi 7 giorni col piano e col trend quando produce sessionFeedback e weeklyReport. L'ACWR rappresenta il rapporto tra carico acuto (tipicamente 7gg) e carico cronico (tipicamente 28gg).

Evidenza: Gabbett (Br J Sports Med, 2016) è il paper fondativo con il concetto di "training-injury prevention paradox": un carico cronico alto è protettivo, mentre un carico acuto alto relativo al cronico è rischioso; lo sweet spot ACWR è 0.80-1.30. Maupin et al. (Open Access J Sports Med, 2020) sintetizzano 27 studi confermando l'associazione ma segnalano eterogeneità metodologica — usare con cautela. Wang et al. (Sports Medicine, 2020) trovano evidenza mista negli sport di squadra professionistici. Impellizzeri et al. (Front Physiol, 2021) criticano severamente la metodologia: molti studi hanno errori statistici; l'ACWR va considerato descrittore, non strumento predittivo rigido.

Implicazione per il coach: ACWR può essere integrato in v2 come metrica descrittiva (non allarme automatico). Valori fuori dal range 0.8-1.3 meritano una segnalazione morbida, non un blocco. Warning: evitare il calcolo rolling con definizioni mal specificate; la fragilità statistica è documentata.`,
    primaryCitation: "Gabbett 2016 (Br J Sports Med)",
    links: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC7047972/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC8138569/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-3-tanaka-hrmax",
    sectionNumber: 3,
    title: "Frequenza cardiaca massima — formula Tanaka",
    topics: ["FCmax", "HRmax", "Tanaka", "zone cardiache", "208 - 0.7 age", "Z2 threshold"],
    content: `Il coach in safetyRules.ts usa la formula di Tanaka (208 - 0.7 × età) per stimare la frequenza cardiaca massima, e segnala se la FC media in fondo lento supera il 75% della FCmax stimata.

Evidenza: Tanaka, Monahan e Seals (J Am Coll Cardiol, 2001) hanno validato la formula 208 - 0.7 × età su meta-analisi di 351 studi più test di laboratorio su 514 soggetti; l'errore standard è circa ±10 bpm e il bias è inferiore rispetto alla vecchia 220-età. Shargal et al. (2015) confermano la superiorità di Tanaka su popolazione mista. Mahon et al. (Int J Exerc Sci, 2020) con analisi Bland-Altman mostrano bias minimo simile tra Fox, Gellish e Tanaka su popolazione generale. Shookster et al. (2016) indicano Tanaka come miglior trade-off multi-popolazione.

Implicazione per il coach: usare Tanaka come stima ragionevole ma esprimersi sempre in range (±10 bpm), non come valore assoluto. La soglia "Z2 ≤ 75% FCmax" è coerente con Seiler e il training polarizzato. Warning: l'errore individuale è ampio (±10 bpm); combinare la FC con RPE per decisioni su intensità. Per soggetti anziani altamente allenati (master), alcune evidenze suggeriscono formule leggermente diverse ma Tanaka resta il default più affidabile.`,
    primaryCitation: "Tanaka 2001 (validazione) + Mahon 2020 (confirmation multi-etnica)",
    links: [
      "https://www.jacc.org/doi/10.1016/S0735-1097(00)01054-8",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC7523886/"
    ],
    contexts: ["cardio_intervals", "macro_periodization"],
  },
  {
    id: "sec-4-polarized-z2",
    sectionNumber: 4,
    title: "Polarizzazione e Zona 2",
    topics: ["Z2", "polarized training", "80/20", "Seiler", "VO2max", "fondo lento"],
    content: `Il coach propone il fondo lento in Zona 2 come sessione dominante nei piani per neofiti e amatori, e avvisa se FC o RPE risultano sproporzionati rispetto alla tipologia dichiarata (es. fondo lento con RPE 8).

Evidenza: Stöggl e Sperlich (Front Physiol, 2014) in un RCT su 48 atleti trovano che la distribuzione polarizzata 80% bassa intensità / 20% alta intensità produce maggiori guadagni di VO2max rispetto a modelli threshold, HIIT puro o alto volume continuativo. Seiler (Int J Sports Physiol Perform, 2010) è la review fondativa del modello 80/20 con le tre zone. Stöggl e Sperlich (2015) confermano che atleti d'élite endurance dedicano circa il 75-80% del volume a bassa intensità. Rosenblat et al. (Sports Medicine Open, 2024) con meta-analisi recente confermano vantaggi del polarizzato su VO2peak ed economia di corsa.

Implicazione per il coach: 80% Z1-Z2 / 20% Z3+ è un default ragionevole da codificare come soft-constraint in planGenerator. Se l'utente dichiara troppe sessioni in zona soglia (Z3), il coach deve suggerire di spostare volume verso Z1-Z2. Warning: il polarizzato non è l'unico modello efficace — a parità di volume, piramidale e threshold funzionano in popolazioni selezionate; evitare rigidità.`,
    primaryCitation: "Stöggl & Sperlich 2014 (Front Physiol)",
    links: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC4621419/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC11679080/"
    ],
    contexts: ["cardio_intervals", "macro_periodization"],
  },
  {
    id: "sec-4b-zones-5tier-karvonen-empirical",
    sectionNumber: 4,
    title: "Zone FC a 5 livelli, Karvonen (HRR) e derivazione empirica",
    topics: ["Z1", "Z2", "Z3", "Z4", "Z5", "Karvonen", "HRR", "recovery", "tempo", "threshold", "VO2max", "soglia anaerobica", "zone FC personalizzate", "empirica", "dal diario"],
    content: `Il coach espone all'utente un modello a 5 zone di frequenza cardiaca (Coggan/Friel, standard usato in Garmin/Strava/Polar):
- Z1 Recovery (50-60% FCmax): camminata e recupero attivo. RPE 1-3.
- Z2 Easy / Fondo Lento (60-75% FCmax): volume base conversazionale. RPE 3-5. Zona dove l'atleta endurance passa ~80% del tempo.
- Z3 Tempo / Marathon pace (75-85% FCmax): passo gara 21-42 km. RPE 5-7.
- Z4 Threshold / Soglia (85-92% FCmax): ripetute lunghe, passo gara 10 km. RPE 7-8.
- Z5 VO2max / Intervals (92-100% FCmax): ripetute brevi 400-1000m, massimali. RPE 8-10.

Le zone sono derivate in cascata dai dati disponibili dell'utente (src/lib/coach/zones.ts):
1. TANAKA (solo età): FCmax = 208 - 0.7 × età. Ogni zona è una % di FCmax. Errore individuale ±10 bpm (Tanaka 2001). Disponibile sempre.
2. KARVONEN (HRR): se l'utente registra la FC a riposo mattutina nel check (campo morningHR), il coach passa al metodo Karvonen. Formula per ogni zona: FCtarget = FCrest + pct × (FCmax − FCrest). Karvonen (1957) è più personalizzato: un atleta allenato con FCrest bassa avrà range bpm più alti rispetto a Tanaka generica. I range salgono leggermente per tutte le zone.
3. EMPIRICA: se l'utente ha registrato ≥5 corse "Fondo Lento" con RPE ≤ 5, la Z2 viene derivata dal 25°-75° percentile della FC media effettiva osservata. Le altre zone (Z1, Z3, Z4, Z5) usano comunque Karvonen se disponibile, altrimenti Tanaka. Questo è il metodo più affidabile per Z2 perché riflette la fisiologia reale dell'utente (Seiler 2010 — la soglia LT1 varia individualmente ±15%).

Evidenza: Karvonen M.J. et al. (1957) "The effects of training on heart rate" è il paper originale sulla Heart Rate Reserve. Seiler S. (2010) definisce le 3 zone funzionali (sotto LT1, tra LT1 e LT2, sopra LT2); Coggan e Friel hanno successivamente esteso a 5 zone per la prescrizione pratica. Roecker et al. (Int J Sports Med, 2002) confermano che la variabilità inter-individuale della FC a parità di % FCmax è significativa (±10-15%), giustificando metodi più personalizzati di Tanaka.

Implicazione per il coach: quando commenta la FC media di una corsa, deve confrontarla con la zona personalizzata dell'utente (metodo = empirical > karvonen > tanaka), NON con la soglia Tanaka generica. Se l'utente ha Z2 empirica più alta della teorica, non va rimproverato per "FC troppo alta" se resta nel suo range. Per ogni zona suggerita nel piano, il coach cita il range bpm personalizzato. Warning: la FC da wearable PPG ha errore ±5-10% (Mühlen 2021), interpretare i numeri come bande non come cutoff.`,
    primaryCitation: "Karvonen 1957 + Coggan/Friel 5-zone model",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/13470504/",
      "https://pubmed.ncbi.nlm.nih.gov/12436270/"
    ],
    contexts: ["cardio_intervals", "macro_periodization"],
  },
  {
    id: "sec-4c-polarization-check-practical",
    sectionNumber: 4,
    title: "Check polarizzato 80/20 — lettura pratica della distribuzione per zona",
    topics: ["polarizzazione", "80/20", "sbilanciata", "intensità", "tempo in zona", "distribuzione", "training load"],
    content: `Il coach analizza il tempo trascorso in ciascuna zona FC negli ultimi 7/14/30/90 giorni (src/components/ZonesAnalytics.tsx) e lo confronta con il modello polarizzato 80/20.

Operativamente: viene bucket ogni corsa con fc_media nota nella zona corrispondente (bucketing semplice su fc_media singola — documentato come approssimazione perché manca il sample HR granulare). La durata totale per zona viene sommata, quindi si calcola:
- % bassa intensità = tempo in Z1+Z2 / tempo totale
- % alta intensità = tempo in Z3+Z4+Z5 / tempo totale

Se % bassa ≥ 75% (tolleranza rispetto all'80% di Seiler 2010 per campioni piccoli): distribuzione polarizzata OK. Altrimenti SBILANCIATA → il coach deve suggerire di rallentare i fondi lenti (non di evitare i lavori di qualità). Soglia minima di 4 sessioni di corsa con FC tracciata per calcolare il check — sotto quella il rapporto è dominato statisticamente da una singola corsa.

Errore tipico del runner amatoriale (documentato in Stöggl/Sperlich 2014): correre il "fondo lento" troppo velocemente, finendo in Z3 senza accorgersene. Il coach deve identificarlo confrontando fc_media dichiarata vs. zona personalizzata dell'utente e intervenire con nudge gentili. Non con allarmi.

Implicazione per il coach: in weeklyReport citare esplicitamente il rapporto % bassa/alta intensità quando disponibile. In chat, se l'utente chiede "come sta andando l'intensità", usare questi numeri come dato oggettivo invece di impressioni generiche. Warning: non applicare il check con meno di 4 corse con FC nel periodo — nemmeno come indicazione morbida. Un solo campione fuori banda produce rapporti 100%/0% fuorvianti.`,
    primaryCitation: "Seiler 2010 (3-zone polarized model)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/20861519/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC4621419/"
    ],
    contexts: ["cardio_intervals", "macro_periodization"],
  },
  {
    id: "sec-5-rpe-session",
    sectionNumber: 5,
    title: "RPE e Session-RPE — carico interno",
    topics: ["RPE", "session-RPE", "Borg", "carico interno", "Foster", "perceived exertion"],
    content: `Il diario raccoglie RPE 1-10 per ogni sessione. Il coach segnala sforzo sproporzionato se l'utente dichiara RPE>6 su una sessione etichettata come Z2 o fondo lento. Il weeklyReport calcola la "load" settimanale.

Evidenza: Borg (Med Sci Sports Exerc, 1982) ha introdotto la scala originale 6-20 e la CR-10, validate rispetto a frequenza cardiaca e lattato. Foster (1998) ha proposto session-RPE come prodotto RPE × durata, cioè il carico interno; è diventato riferimento universale. Foster et al. (J Strength Cond Res, 2001) lo hanno validato contro HR-TRIMP: session-RPE è valido ed economico. Haddad et al. (Front Neurosci, 2017) confermano validità in sport ed età diverse. Scott et al. (Int J Sports Physiol Perform, 2018) validano RPE post-sessione (0, 15 o 30 minuti dopo) negli adolescenti.

Implicazione per il coach: il dato RPE raccolto dal diario è già evidence-based; moltiplicarlo per durata dà una "load unit" semplice da graficare. La soglia "RPE > 6 su sessione facile" è coerente: RPE 7+ indica zona soglia (non Z2). Warning: l'RPE è influenzato da fattori contestuali (sonno, idratazione, temperatura, motivazione); un singolo valore discordante va interpretato in tendenza, non come allarme isolato.`,
    primaryCitation: "Foster 2001 (J Strength Cond Res)",
    links: [
      "https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2017.00612/full",
      "https://pubmed.ncbi.nlm.nih.gov/30160557/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-6-overtraining",
    sectionNumber: 6,
    title: "Overtraining e monitoraggio del recupero",
    topics: ["overtraining", "OTS", "NFOR", "recovery", "HRV", "sleep fatigue red flag", "Meeusen"],
    content: `Il coach, tramite checkLocalRedFlags in safetyRules.ts, segnala deload obbligatorio quando l'utente registra sonno <7h combinato con stanchezza ≥8/10 per almeno 3 giorni consecutivi.

Evidenza: Meeusen et al. (ECSS/ACSM Joint Consensus, 2013) è il riferimento internazionale che distingue Functional Overreaching (FOR), Non-Functional Overreaching (NFOR) e Overtraining Syndrome (OTS); prevalenza NFOR/OTS circa 10% negli endurance; criteri diagnostici multidimensionali (psicologici, fisiologici, training). Watson et al. (AASM/SRS Consensus, 2015) raccomandano ≥7h/notte per adulti 18-60. Walsh et al. (Br J Sports Med, 2021) — expert consensus su sleep e atleti — indicano che restrizione <7h per ≥3 notti consecutive degrada performance e immunità, e suggeriscono di usare media mobile 7gg invece di soglie singola-notte. Fullagar et al. (Sports Med, 2015) mostrano che la restrizione cronica parziale (<6h × 3+ notti) è più dannosa di una singola notte acuta. Saw et al. (Br J Sports Med, 2016) mostrano che i questionari soggettivi sono più sensibili ai cambi di carico rispetto ai marker oggettivi.

Implicazione per il coach: la soglia è stata aggiornata da "≤6h × 2gg" a "<7h × 3gg" per allinearsi ai target AASM/Walsh 2021 e ridurre falsi positivi da variabilità weekend. In v2 l'upgrade naturale è integrare HRV e uno sleep-debt cumulativo (differenza 7.5h target vs. ore reali sommata su 7gg).`,
    primaryCitation: "Meeusen ECSS/ACSM 2013; Walsh BJSM 2021",
    links: [
      "https://www.sportgeneeskunde.com/wp-content/uploads/Meeusen-et-al-2013-Overtraining-Consensus-ECSS-ACSM.pdf",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC3936188/",
      "https://pubmed.ncbi.nlm.nih.gov/33144349/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-7-pain-monitoring",
    sectionNumber: 7,
    title: "Dolore come guida al carico — modello Silbernagel",
    topics: ["dolore", "tendinopatia", "Silbernagel", "pain-monitoring", "scala 0-4", "return to sport monitoring"],
    content: `Il diario raccoglie dolore su scala 0-4+ (pre, durante, post sessione), configurabile per area corporea. La regola hardcoded del coach è allineata alla semantica della scala: ≥4 (a spillo) = STOP immediato, =3 (localizzato) = riduci intensità, =2 (avvertibile) = monitora trend.

Evidenza: Silbernagel et al. (Am J Sports Med, 2007) è il paper di riferimento sulla tendinopatia achillea: l'attività può continuare se il dolore resta ≤5/10, non aumenta significativamente durante, e torna a baseline entro il giorno dopo; nessun effetto negativo rispetto al riposo completo. Silbernagel e Crossley (JOSPT, 2015) definiscono un framework di ritorno allo sport basato su pain-monitoring e Borg-RPE con livelli light/medium/high e giorni di recupero crescenti. Alfredson et al. (1998) hanno consolidato il protocollo eccentrico del polpaccio come trattamento per tendinopatia achillea. Rio et al. (2015) forniscono la base neurofisiologica dell'analgesia indotta da esercizio isometrico.

Implicazione per il coach: la soglia "≥4 = STOP, =3 = riduci" è allineata sia alla semantica della scala (4="a spillo", 3="localizzato/riduci") sia alla tolleranza Silbernagel (≤5/10 ≈ ≤2/4). Per tendinopatie croniche già stabili in riabilitazione il coach può tollerare fino a 5/10 con monitoraggio del ritorno a baseline entro 24h. Warning: se il dolore cambia sede, peggiora progressivamente o diventa notturno, il coach deve rinviare a fisioterapista/medico; non è compito dell'LLM fare diagnosi differenziale.`,
    primaryCitation: "Silbernagel 2007 (Am J Sports Med)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/17307888/",
      "https://www.jospt.org/doi/10.2519/jospt.2015.5885"
    ],
    contexts: ["mobility", "macro_periodization"],
  },
  {
    id: "sec-8-smart-goals",
    sectionNumber: 8,
    title: "SMART goals — evidenza sfumata",
    topics: ["SMART", "obiettivi", "open goals", "motivazione", "goal setting", "feasibility"],
    content: `L'onboarding chiede obiettivi all'utente, li valuta con feasibility.ts e genera versioni in formato SMART (Specific, Measurable, Achievable, Relevant, Time-bound).

Evidenza che sfida l'assunto: Swann et al. (Health Psychol Rev, 2022) con narrative review critica l'uso universale degli SMART goals per la promozione dell'attività fisica; per soggetti insufficiently active gli SMART possono ridurre aderenza e piacere rispetto agli "open goals" tipo "cammina di più". Swann et al. (2025) forniscono evidenza sperimentale: insufficiently active camminano più volume con open goal rispetto a SMART individualizzato, su orizzonte di una settimana. Epton et al. (Health Psychol Rev, 2017) con meta-analisi su 141 studi confermano che il goal setting funziona ma i meccanismi specifici (SMART vs. altri) sono meno chiari. Samdal et al. (Int J Behav Nutr Phys Act, 2017) mostrano che auto-monitoraggio + feedback + goal setting migliorano adesione.

Implicazione per il coach: per utenti neofiti o sedentari, feasibility.ts dovrebbe poter proporre open goals alternativi ("muoviti 3 volte a settimana", "cammina di più") accanto agli SMART. Non forzare sempre la struttura SMART. Warning: gli SMART restano utili per utenti già attivi con obiettivi specifici di performance (gara, tempo su distanza), ma meno indicati come strumento motivazionale per chi parte da zero.`,
    primaryCitation: "Swann 2022 (Health Psychol Rev)",
    links: [
      "https://www.tandfonline.com/doi/full/10.1080/17437199.2021.2023608",
      "https://www.tandfonline.com/doi/full/10.1080/1612197X.2025.2570187"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-9-llm-coaching",
    sectionNumber: 9,
    title: "LLM come coach — stato dell'arte 2025",
    topics: ["LLM", "Gemini", "PH-LLM", "behavior change", "AI coach", "fine-tuning"],
    content: `Il coach usa Gemini 2.0 Flash con system prompt strutturato, schema Zod per validazione JSON e regole di sicurezza iniettate.

Evidenza aggiornata: Cosentino et al. (Nature Medicine, 2025) presentano PH-LLM, un Gemini fine-tuned su dati wearable che supera esperti umani su esami multiple-choice di sleep medicine (79% vs 76%) e fitness (88% vs 71%); su 857 case study reali la performance è pari agli esperti sul fitness. Lu et al. (JMIR Medical Informatics, 2025) fanno scoping review di 20+ studi: ChatGPT usato nel 55% dei casi; conclusione promettente ma come supplemento a expertise umana, con validazione esperta richiesta per la safety. Lu et al. (J Med Internet Res, 2025) valutano il rigore metodologico come medio 2.5/5 con 55% di studi a basso rigore e framework di valutazione ancora frammentato. Fu et al. (PLOS Digital Health, 2024) dimostrano che infondere teoria del cambiamento comportamentale (COM-B, self-determination) migliora la qualità dei suggerimenti LLM. Englhardt et al. (arXiv, 2024) descrivono la metodologia del fine-tuning di PH-LLM.

Implicazione per il coach: l'approccio LLM + regole iniettate + validazione Zod è allineato allo stato dell'arte. Limite noto: Gemini "vanilla" senza fine-tuning è competente ma non supera gli esperti. In v2 valutare few-shot prompting con esempi di coaching reali. Warning: comunicare sempre all'utente che il coach è un LLM generalista, non un sistema certificato.`,
    primaryCitation: "Cosentino 2025 (Nature Medicine)",
    links: [
      "https://www.nature.com/articles/s41591-025-03888-0",
      "https://medinform.jmir.org/2025/1/e59309",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC10986996/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-10-safety-parq",
    sectionNumber: 10,
    title: "Safety e limiti etici dell'AI coach",
    topics: ["safety", "disclaimer", "medical device", "ACSM guidelines", "scope limits", "non sostituisce medico"],
    content: `Il coach inietta nel prompt un disclaimer esplicito: non sostituisce medico né fisioterapista. Il disclaimer è anche mostrato durante l'onboarding.

Evidenza: ACSM, Guidelines for Exercise Testing and Prescription (11th ed., 2021), è lo standard di riferimento per screening pre-esercizio e prescrizione; il PAR-Q+ è la base per l'auto-screening. Riebe et al. (ACSM, Med Sci Sports Exerc, 2015) hanno aggiornato l'algoritmo di screening pre-partecipazione: valutazione di storia esercizio, sintomi e condizioni cardio-metaboliche-renali per decidere se è necessaria clearance medica prima di iniziare. Warburton et al. (Health Fitness J Canada, 2011) hanno validato il PAR-Q+ come questionario standard (7 domande base + follow-up condizionali, open source, <2 minuti).

Implicazione per il coach: il disclaimer attuale è corretto ma generico. In v2 inserire un PAR-Q+ semplificato nell'onboarding come step pre-profilo: se una risposta è "sì", mostrare disclaimer forte e bloccare la generazione del piano finché l'utente non conferma di aver consultato un medico. Warning: non usare mai formule del tipo "diagnosi", "prescrizione", "terapia"; preferire "suggerimento", "spunto", "linea generale". Il coach non è un dispositivo medico.`,
    primaryCitation: "Warburton PAR-Q+ 2011",
    links: [
      "https://eparmedx.com/",
      "https://pubmed.ncbi.nlm.nih.gov/26061457/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-11-resistance-training",
    sectionNumber: 11,
    title: "Forza e resistance training — prescrizione",
    topics: ["forza", "resistance training", "set rep 1RM", "Ratamess ACSM", "ipertrofia", "progressione forza"],
    content: `Il coach gestisce workout type forza_gambe (HIIT, esplosiva, massimale, circuito) e forza_upper (upper, core, combo). Il planGenerator propone durate e carichi ma senza intervalli espliciti di volume e intensità.

Evidenza: Ratamess et al. (ACSM Position Stand, Med Sci Sports Exerc, 2009) è il riferimento internazionale — novizi 1-3 set, 8-12 rep, 60-70% 1RM, 2-3x/sett; intermedi 3-6 set, 1-12 rep, 70-85% 1RM, 3-4x/sett; avanzati con periodizzazione. Importanza di contrazioni concentriche/eccentriche/isometriche, esercizi mono e multi-articolari, bilaterali e unilaterali. L'update ACSM 2025 (Overview of Reviews) conferma i principi del 2009 con raccomandazioni aggiornate su volume settimanale. Schoenfeld et al. (J Sports Sci, 2017) con meta-analisi dose-risposta: ≥10 set per muscolo per settimana massimizzano ipertrofia, con curva curvilineare. Grgic et al. (Sports Med, 2018): a parità di volume, frequenza 2-3x/settimana per gruppo muscolare supera 1x/settimana.

Implicazione per il coach: il prompt di planGenerator dovrebbe iniettare i range ACSM per livello di esperienza. Schema operativo: forza massimale 1-5 rep, 85-100% 1RM; esplosiva 3-5 rep, 30-60% a velocità alta; ipertrofia 6-12 rep, 65-80%; resistenza muscolare 15+ rep, <65%. Warning: non prescrivere carichi assoluti; ragionare in %1RM o in RIR (reps in reserve).

Confermato ACSM position stand update 2021 senza revisioni sostanziali dei principi.`,
    primaryCitation: "Ratamess 2009 (ACSM)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/19204579/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/"
    ],
    contexts: ["strength_db"],
  },
  {
    id: "sec-12-sleep",
    sectionNumber: 12,
    title: "Sonno — impatto su performance e recupero",
    topics: ["sonno", "sleep", "Watson AASM", "sleep extension", "recupero", "sleep debt", "7-9 ore"],
    content: `Il check giornaliero raccoglie ore di sonno, qualità e stanchezza. La regola checkLocalRedFlags attiva deload se sonno <7h combinato con fatica ≥8/10 per 3 giorni consecutivi (aggiornata da 6h/2gg ad aprile 2026 per allineamento Walsh BJSM 2021).

Evidenza: Fullagar et al. (Sports Med, 2015) è la review cardinale: il sonno insufficiente riduce performance sport-specifica, cognizione e tempo di reazione; compiti massimali brevi sono meno colpiti, performance prolungate e cognitive molto. Mah et al. (Sleep, 2011) è un landmark sugli atleti di basket collegiale: estendere il sonno a ≥10h per 5-7 settimane migliora sprint, accuratezza di tiro e mood, con dose-risposta positiva. Watson et al. (AASM/SRS Joint Consensus, Sleep 2015) raccomandano ufficialmente per adulti 18-60 almeno 7h/notte; <6h cronico aumenta rischio cardiovascolare, metabolico, cognitivo. Vitale et al. (Int J Sports Med, 2019) offrono linee guida pratiche di sleep hygiene (regolarità, 7-9h, ambiente, timing caffeina). Fox et al. (2025) sintetizzano restrizione sonno, monitoraggio e interventi (extension, nap, hygiene).

Implicazione per il coach: la soglia <7h × 3gg consecutivi è allineata a Walsh 2021 e al target AASM/Watson 2015 (≥7h). Residuo v2: raccomandare proattivamente 7-9h via check-in motivazionale e introdurre un indicatore "sleep debt cumulativo" (differenza tra target 7.5h e ore reali, sommata su 7 giorni). Warning: non demonizzare una notte singola breve; conta la media su 7-14 giorni e la regolarità.`,
    primaryCitation: "Watson AASM 2015",
    links: [
      "https://link.springer.com/article/10.1007/s40279-014-0260-0",
      "https://pubmed.ncbi.nlm.nih.gov/30665263/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-13-nutrition",
    sectionNumber: 13,
    title: "Nutrizione e idratazione — limiti del coach",
    topics: ["nutrizione", "integratori", "IOC Maughan", "idratazione", "caffeina creatina", "guardrail"],
    content: `Il diario ha campi kcal (stimati) e meds (farmaci/integratori). Il coach non consiglia nutrizione direttamente — scelta etica corretta. Può citare principi generali in chat ma non prescrivere.

Evidenza: Maughan et al. (IOC Consensus, Br J Sports Med, 2018) è il consensus di riferimento: solo caffeina, creatina, beta-alanina, bicarbonato e nitrati hanno evidenza robusta di benefici sulla performance; tutto il resto è insufficiente o nullo; non sostituire mai la nutrizione di base con integratori. Thomas et al. (ACSM/AND/Dietitians Canada, Med Sci Sports Exerc, 2016) indicano carboidrati 3-12 g/kg/die in base al carico, proteine 1.2-2.0 g/kg/die, idratazione 5-10 mL/kg 2-4h pre-esercizio. Kerksick et al. (ISSN, 2017) definiscono il nutrient timing: finestra anabolica estesa, carboidrati pre/durante/post in base a durata e intensità. Sawka et al. (ACSM, 2007) sull'idratazione: bilancio individuale con pesate pre/post, evitare deficit >2% peso corporeo.

Implicazione per il coach: il coach deve rifiutare esplicitamente di consigliare integratori specifici o diete in chat, rinviando a nutrizionista sportivo. In v2 aggiungere nel system prompt un guardrail esplicito sui limiti nutrizionali ("posso parlare di principi generali ma non prescrivere"). Warning: il valore kcal stimato da wearable è inaffidabile; non usarlo come base per raccomandazioni di intake.`,
    primaryCitation: "Maughan IOC 2018",
    links: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC5867441/",
      "https://pubmed.ncbi.nlm.nih.gov/26891166/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-14-strength-endurance",
    sectionNumber: 14,
    title: "Strength training per atleti di endurance",
    topics: ["concurrent training", "running economy", "Rønnestad", "forza per runner", "interference effect", "heavy strength"],
    content: `Il diario separa corsa e sessioni di forza (forza_gambe, forza_upper). Il planGenerator può alternare le due tipologie ma senza un razionale esplicito di combinazione ottimale.

Evidenza: Rønnestad e Mujika (Scand J Med Sci Sports, 2014) è la review fondativa: la forza heavy (1-5 rep, 85-90% 1RM) migliora l'economia di corsa senza aumentare la massa corporea, con 2-3 sessioni/sett in parallelo all'endurance; maggior effetto su runner di medio-lungo. Beattie et al. (Sports Med, 2014) con meta-analisi: lo strength training concomitante non compromette e spesso migliora economia, tempo a esaurimento e performance di gara. Blagrove et al. (Sports Med, 2018) confermano: 2-3 sessioni forza/sett per ≥6 settimane migliorano running economy e/o time trial; priorità a heavy + pliometrico. Fyfe et al. (Sports Med, 2014) evidenziano l'interference effect: se l'endurance viene fatto subito prima della forza, può limitare i guadagni di forza; separare di ≥3h o fare forza prima.

Implicazione per il coach: il planGenerator dovrebbe inserire 2-3 sessioni di forza/sett per runner, preferibilmente in giorni diversi dalla corsa lunga, o almeno non subito prima. Regola utile: se l'obiettivo contiene corsa, includere 2 sessioni forza/sett con separazione temporale dalla sessione endurance chiave. Warning: per principianti assoluti di corsa, partire con 1 sessione forza/sett e aggiungere gradualmente.`,
    primaryCitation: "Rønnestad & Mujika 2014",
    links: [
      "https://onlinelibrary.wiley.com/doi/abs/10.1111/sms.12104",
      "https://pubmed.ncbi.nlm.nih.gov/24532151/"
    ],
    contexts: ["strength_db", "cardio_intervals"],
  },
  {
    id: "sec-15-women-reds",
    sectionNumber: 15,
    title: "Salute donna — ciclo mestruale e RED-S",
    topics: ["ciclo mestruale", "RED-S", "LEA", "female athlete", "Mountjoy IOC", "disponibilità energetica"],
    content: `Il profilo raccoglie il campo sex ma attualmente nessuna differenziazione viene fatta nei prompt del coach. Il coach non considera fase del ciclo, uso di contraccettivi, o disponibilità energetica.

Evidenza: Elliott-Sale et al. (Sports Med, 2020) con review rigorosa mostrano che la performance è leggermente ridotta in fase follicolare precoce vs. altre fasi, ma l'effect size è trivial e la varianza tra studi è alta — approccio individuale raccomandato, non linee guida universali. Mountjoy et al. (IOC Consensus, Br J Sports Med, 2023) aggiornano la definizione di Relative Energy Deficiency in Sport (REDs): sindrome da bassa disponibilità energetica (LEA) con conseguenze su immunità, salute ossea, ciclo, cardio e performance; rischio in atleti di entrambi i sessi; checklist di screening disponibile. Mountjoy et al. (2018) hanno ampliato il concetto dalla Female Athlete Triad alla sindrome multidimensionale RED-S. Janse de Jonge (Sports Med, 2003) fornisce contesto fisiologico su estrogeni e progesterone (termoregolazione, substrato, fatica).

Implicazione per il coach: v2 prudente aggiungere nel profilo femminile un campo opzionale "fase ciclo" e "contraccezione" con tracciamento mensile; inserire guardrail in feasibility.ts che rilevi segnali di LEA (perdita peso rapida, amenorrea dichiarata, fatica cronica) e rinvii a specialista. Warning: non prescrivere periodizzazione ciclo-based senza evidenza individuale; la variabilità inter-soggettiva è molto alta.`,
    primaryCitation: "Mountjoy IOC REDs 2023",
    links: [
      "https://link.springer.com/article/10.1007/s40279-020-01319-3",
      "https://pubmed.ncbi.nlm.nih.gov/37752011/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-16-master-athletes",
    sectionNumber: 16,
    title: "Master athletes — invecchiamento",
    topics: ["master athletes", "over 50", "over 65", "ACSM older adults", "recovery lento", "HIIT ridotto"],
    content: `Il profilo chiede l'età e Tanaka fornisce una FCmax age-adjusted, ma il coach non differenzia volumi e intensità in base all'età, né considera il recupero più lento tipico delle persone over 50.

Evidenza: Chodzko-Zajko et al. (ACSM Position Stand, Med Sci Sports Exerc, 2009) per adulti 65+ raccomandano 150 min/sett di aerobica moderata o 75 min vigorosa, forza 2x/sett su 8-10 gruppi muscolari, equilibrio e flessibilità regolari; applicabile anche a 50-64 con patologie croniche. Tanaka e Seals (J Physiol, 2008) descrivono il declino di performance endurance ~10% per decade dopo i 30-40 anni, con accelerazione dopo i 70; causa dominante è la riduzione di VO2max (cardiaca + muscolare). Lepers e Cattagni (Age, 2012) documentano la longevità delle performance maratona nei master ben allenati. Reaburn e Dascombe (2008) evidenziano un recupero post-sessione più lento nei master: +24-48h rispetto ai giovani.

Implicazione per il coach: in v2 il planGenerator per utenti ≥50 anni dovrebbe ridurre la frequenza di sessioni ad alta intensità (max 2/settimana) e inserire giorni di recupero attivo; per ≥65 adottare le linee guida ACSM 2009 come baseline (≤150 min moderata/sett). Warning: non generalizzare — un master con storia atletica consolidata può tollerare carichi superiori rispetto a un neofita della stessa età.`,
    primaryCitation: "Chodzko-Zajko ACSM 2009",
    links: [
      "https://www.bewegenismedicijn.nl/files/downloads/acsm_position_stand_exercise_and_physical_activity_for_older_adults.pdf",
      "https://pubmed.ncbi.nlm.nih.gov/19516148/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-17-parq-screening",
    sectionNumber: 17,
    title: "Screening pre-esercizio — PAR-Q+",
    topics: ["PAR-Q+", "screening", "pre-participation", "Warburton", "Riebe ACSM", "clearance medica"],
    content: `Il profilo raccoglie injuries (testo libero) e meds, ma non esiste un flusso di screening strutturato. Un utente con patologia cardiaca potrebbe iniziare un piano senza alert.

Evidenza: Warburton et al. (Health Fitness J Canada, 2011) hanno definito il PAR-Q+ come questionario standard internazionale: 7 domande base più follow-up condizionali, validato su ampie popolazioni, open source, completabile in <2 minuti. Riebe et al. (ACSM, Med Sci Sports Exerc, 2015) forniscono l'algoritmo ACSM aggiornato: valutazione di storia esercizio, sintomi e condizioni cardio-metaboliche-renali per decidere se serve clearance medica prima di iniziare. Bredin et al. (Br J Sports Med, 2013) descrivono la variante PARmed-X per gravidanza.

Implicazione per il coach: gap critico da colmare. In v2 implementare i 7 PAR-Q+ nell'OnboardingWizard come step tra profilo e obiettivi; se una qualunque risposta è "sì", mostrare disclaimer forte ("consulta medico prima di iniziare") e disabilitare la generazione del piano finché l'utente non conferma. Warning: il PAR-Q+ non certifica sicurezza; certifica solo l'assenza di bandiere rosse note. In caso di dubbio clinico rinviare sempre a professionista.`,
    primaryCitation: "Warburton PAR-Q+ 2011",
    links: [
      "https://eparmedx.com/",
      "https://pubmed.ncbi.nlm.nih.gov/26061457/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-18-chronic-conditions",
    sectionNumber: 18,
    title: "Condizioni croniche ed esercizio",
    topics: ["diabete", "ipertensione", "obesità", "patologie croniche", "ACSM position stand", "Colberg Pescatello"],
    content: `Il profilo ha campi meds e injuries liberi, ma il coach non reagisce in modo strutturato se l'utente dichiara diabete, ipertensione, obesità o cardiopatia.

Evidenza: Colberg et al. (ACSM/ADA, Diabetes Care, 2016) per tipo 1, tipo 2 e prediabete indicano 150 min/sett aerobica + 2-3 sessioni forza/sett con monitoraggio glicemia pre/post e cautela sull'ipoglicemia in T1. Pescatello et al. (ACSM Position Stand, Med Sci Sports Exerc, 2004) mostrano che l'aerobica riduce la pressione sistolica di 5-7 mmHg; raccomandano 30 min moderata ≥5gg/sett, evitando Valsalva e heavy lifting se la pressione non è controllata. Donnelly et al. (ACSM, Med Sci Sports Exerc, 2009) per obesità raccomandano 225-420 min/sett aerobica per perdita significativa; <150 min risulta insufficiente; deficit calorico 500-750 kcal/die. Pescatello et al. (2015) aggiornano che HIIT e moderata continua sono entrambi efficaci — la scelta va fatta per aderenza.

Implicazione per il coach: in v2 aggiungere nell'OnboardingWizard checkbox di patologie dichiarate (diabete, ipertensione, cardiopatia, obesità, asma); il coach inietta nel system prompt la position stand rilevante e adatta i piani. Warning: l'LLM non deve sostituire il medico curante; in presenza di patologia dichiarata, il piano deve essere presentato come "da validare col tuo medico".`,
    primaryCitation: "Colberg ADA/ACSM 2016",
    links: [
      "https://diabetesjournals.org/care/article/39/11/2065/37249/",
      "https://pubmed.ncbi.nlm.nih.gov/15076798/"
    ],
    contexts: ["mobility", "macro_periodization"],
  },
  {
    id: "sec-19-sdt-motivation",
    sectionNumber: 19,
    title: "Motivazione — Self-Determination Theory",
    topics: ["SDT", "self-determination", "motivazione autonoma", "Teixeira", "COM-B", "tono coach", "autonomia competenza relazione"],
    content: `Il coach ha un tono definito come "supportivo e pedagogico", con feedback proattivo e check-in motivazionale. La persona è hardcoded nel system prompt ma non è ancorata esplicitamente a teorie del cambiamento comportamentale.

Evidenza: Teixeira et al. (Int J Behav Nutr Phys Act, 2012) è la review cardinale su SDT ed esercizio: 66 studi mostrano che la motivazione autonoma (intrinseca, identificata) predice l'adesione a lungo termine, mentre quella controllata (esterna, introiettata) predice solo l'adozione iniziale; supporto di autonomia, competenza e relazione da parte del coach migliora l'adesione. Ryan e Deci (Am Psychol, 2000) è il paper fondativo della Self-Determination Theory con i tre bisogni psicologici fondamentali. Ntoumanis et al. (Health Psychol Rev, 2021) in meta-analisi su 73 studi mostrano effect size small-to-medium per interventi SDT-informed su motivazione autonoma, salute fisica e psicologica. Michie et al. (Implement Sci, 2011) definiscono il framework COM-B (Capability, Opportunity, Motivation → Behaviour) e la tassonomia delle tecniche di behavior change.

Implicazione per il coach: in v2 allineare esplicitamente il system prompt a principi SDT — supportare autonomia (offrire scelte, non imporre), rinforzare competenza (citare dati di progresso), creare relazione (tono caldo, memoria del contesto). Nel check-in motivazionale evitare linguaggio controllante ("devi", "dovresti") e preferire informativo ("i dati suggeriscono", "potresti considerare"). Warning: tono troppo entusiasta e paternalistico riduce l'autonomia percepita.`,
    primaryCitation: "Teixeira 2012 SDT",
    links: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC3441783/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC3096582/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-20-recovery-modalities",
    sectionNumber: 20,
    title: "Recovery modalities — ranking efficacia",
    topics: ["recupero", "massaggio", "foam rolling", "CWI", "cold water immersion", "Dupuy", "DOMS"],
    content: `Il workout type "mobilita" include stretching statico/dinamico, propriocezione, camminata, foam rolling e piscina. Al momento il coach non comunica un ranking di efficacia delle diverse modalità di recupero.

Evidenza: Dupuy et al. (Front Physiol, 2018) in meta-analisi su 99 studi classificano l'efficacia sul ridurre DOMS e fatica: massaggio > recupero attivo > compression garments > immersion > contrast therapy > crioterapia; il massaggio riduce anche marker infiammatori. Lo stretching passivo ha effetti minimi. Wiewelhove et al. (Front Physiol, 2019) sul foam rolling trovano piccolo effetto positivo su performance acuta (sprint, flessibilità) e piccola riduzione DOMS; miglior uso come warm-up pre-esercizio o recupero post-esercizio. Machado et al. (Sports Med, 2016) identificano la finestra ottimale per cold water immersion: 11-15°C per 11-15 minuti per ridurre DOMS. Leeder et al. (Br J Sports Med, 2012) confermano l'efficacia della CWI per recupero post-esercizio ad alta intensità, con warning importante: uso ripetuto può compromettere gli adattamenti di ipertrofia e forza.

Implicazione per il coach: in v2 differenziare il suggerimento di recupero nel feedback sessione. Dopo sessione intensa suggerire camminata/massaggio/CWI quando disponibili. Warning: segnalare all'utente che la CWI sistematica dopo forza riduce adattamenti di ipertrofia. Lo stretching statico va bene per mobilità ma ha poca evidenza come strumento di recupero muscolare.`,
    primaryCitation: "Dupuy 2018 (Front Physiol)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/29755363/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC6416396/"
    ],
    contexts: ["mobility", "macro_periodization"],
  },
  {
    id: "sec-21-running-biomechanics",
    sectionNumber: 21,
    title: "Biomeccanica della corsa — cadenza, footstrike, scarpe",
    topics: ["cadenza", "footstrike", "scarpe", "biomeccanica corsa", "Heiderscheit", "165 ppm", "stride rate"],
    content: `Il diario raccoglie cadenza, tipo di scarpe e superficie. Il coach potrebbe commentare ma attualmente non ha regole specifiche di biomeccanica della corsa.

Evidenza: Heiderscheit et al. (Med Sci Sports Exerc, 2011) è landmark: aumentare la cadenza di circa 5-10% rispetto alla preferita riduce significativamente lo stress su ginocchio e anca, senza richiedere cambio di footstrike. Quinn et al. (Sports Med Open, 2022) con systematic review confermano: la cadenza più alta riduce carico articolare e picco d'impatto; l'effetto sugli infortuni è evidenza indiretta ma coerente. Anderson et al. (2024) review aggiornata: cadenze <165 passi/min sono associate a maggiore incidenza di overload injuries, specialmente tibiali. Napier et al. (Am J Sports Med, 2019) sulla scarpa: evidenza inconsistente su tipo e minimalismo; contano abitudine e progressione graduale, non la scarpa in sé. Daoud et al. (Med Sci Sports Exerc, 2012) su popolazione elite trovano il forefoot strike associato a minor incidenza di infortuni ripetitivi, ma non è generalizzabile al runner medio.

Implicazione per il coach: in v2, se la cadenza dichiarata è <165 ppm, suggerire gentilmente "prova ad aumentare la cadenza di ~5%" come strategia anti-impatto. Warning: non consigliare cambi di footstrike (rischio infortuni da transizione) e monitorare che l'utente mantenga stabile lo stesso modello di scarpa per almeno 2 mesi prima di cambiarlo.`,
    primaryCitation: "Heiderscheit 2011",
    links: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC12440572/",
      "https://link.springer.com/article/10.1186/s40798-022-00504-0"
    ],
    contexts: ["cardio_intervals"],
  },
  {
    id: "sec-22-tapering",
    sectionNumber: 22,
    title: "Tapering e peaking pre-gara",
    topics: ["tapering", "peaking", "pre gara", "Bosquet", "riduzione volume", "7-14 giorni"],
    content: `Gli obiettivi del coach possono avere una deadline. Il coach potrebbe pianificare un tapering pre-gara ma al momento non lo fa esplicitamente nel planGenerator.

Evidenza: Bosquet et al. (Med Sci Sports Exerc, 2007) è la meta-analisi di riferimento: il tapering ottimale dura 8-14 giorni, con riduzione del volume del 41-60% in forma esponenziale decrescente, mantenendo invariate intensità e frequenza; effect size maggiore per eventi endurance. Mujika et al. (Sports Med, 2004) review classica: miglioramenti di performance dello 0.5-6% durante il taper, grazie a rimozione della fatica e mantenimento degli adattamenti. Spilsbury et al. (PLOS ONE, 2023) confermano Bosquet 2007 e suggeriscono finestre flessibili — anche 7 giorni o 15-21 giorni sono efficaci in determinate popolazioni.

Implicazione per il coach: in v2, se un obiettivo di gara è entro 2 settimane, planGenerator dovrebbe generare automaticamente un taper: volume -50% la settimana della gara, -30% la settimana precedente, mantenendo intensità su sessioni brevi. Warning: il taper troppo aggressivo (>70% volume) o troppo lungo (>21gg) può portare a detraining. Mantenere sessioni brevi di qualità evita la perdita di "feeling" per il ritmo gara.`,
    primaryCitation: "Bosquet 2007 (meta-analysis)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/17762369/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC10171681/"
    ],
    contexts: ["macro_periodization", "cardio_intervals"],
  },
  {
    id: "sec-23-wearable-validity",
    sectionNumber: 23,
    title: "Validità dei dati da wearable",
    topics: ["wearable", "PPG", "FC wrist", "INTERLIVE", "accuracy", "kcal wearable", "tolleranza 10%"],
    content: `Il coach usa i valori fc_media e fc_max inseriti dall'utente (tipicamente raccolti da smartwatch o fascia toracica). La funzione checkLocalRedFlags confronta la FC con la soglia di Zona 2.

Evidenza: Mühlen et al. (INTERLIVE Network, Br J Sports Med, 2021) forniscono il framework di riferimento per valutare l'accuratezza dei wearable PPG, con checklist per pubblicazioni e utenti. Bent et al. (npj Digital Medicine, 2020) indagano le fonti di errore del PPG da polso: errore medio basso a riposo (<3%), che aumenta con il movimento (fino al 10-15%) e peggiora con pelle scura, tatuaggi o freddo. Shcherbina et al. (J Pers Med, 2017) trovano wrist HR accurato entro ±5% in condizioni stabili; la stima calorie è molto meno accurata (±27-93%). Sañudo et al. (J Med Syst, 2022) in systematic review: 4/10 studi mostrano riduzione di accuratezza su pelle più scura, ma l'evidenza è preliminare.

Implicazione per il coach: le regole basate su FC (Tanaka + %FCmax) vanno interpretate con bande di tolleranza, non come cutoff rigidi. In v2 aggiungere nel system prompt: "la FC da wearable ha errore ±5-10%; considera sempre anche l'RPE come corroboratore". Warning: il valore kcal da wearable è inaffidabile come base per raccomandazioni nutrizionali — non basare consigli di intake su quel dato.`,
    primaryCitation: "Mühlen INTERLIVE 2021",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/33397674/",
      "https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2024.1326511/full"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-24-environmental",
    sectionNumber: 24,
    title: "Ambiente — caldo, umidità, altitudine",
    topics: ["heat stress", "caldo umidità", "altitudine", "Sawka ACSM", "acclimatazione", "fluid replacement"],
    content: `Attualmente il coach non traccia né ambiente né meteo. Questo è un limite: il coach potrebbe interpretare male una FC alta in una giornata calda, leggendola come segnale di overtraining invece che di heat stress.

Evidenza: Sawka et al. (ACSM Position Stand, Med Sci Sports Exerc, 2007) sull'exercise e fluid replacement costituiscono la base per esercizio in ambiente caldo: idratazione individuale, acclimatazione 10-14 giorni, alert particolari per temperatura >30°C con umidità >75%. Armstrong et al. (ACSM, 2007) definiscono sintomi, gestione e prevenzione dell'exertional heat illness. Bergeron et al. (IOC Consensus, Br J Sports Med, 2012) per l'altitudine: VO2max ridotto circa 6-8% per ogni 1000m sopra i 1500m; acclimatazione richiede 2-4 settimane. Périard et al. (Scand J Med Sci Sports, 2015) raccomandano protocollo di acclimatazione di 5-14 giorni, idratazione 250-500 mL/h e sorveglianza della temperatura core.

Implicazione per il coach: in v2 aggiungere al diario un campo opzionale "condizioni ambientali" (temperatura, umidità, altitudine). Nel feedback sessione: se FC è alta e l'utente indica temperatura >28°C, il coach non deve segnalare overtraining ma invitare a rallentare per heat stress e aumentare l'idratazione. Warning: heat illness può progredire rapidamente; sintomi come nausea, confusione o cessazione della sudorazione richiedono stop immediato.`,
    primaryCitation: "Sawka ACSM 2007",
    links: [
      "https://www.khsaa.org/sportsmedicine/heat/exerciseandfluidreplacement.pdf",
      "https://acsm.org/education-resources/pronouncements-scientific-communications/position-stands/"
    ],
    contexts: ["cardio_intervals", "macro_periodization"],
  },
  {
    id: "sec-25-strength-programming-practical",
    sectionNumber: 25,
    title: "Forza — programmazione pratica (set, rep, rest, RIR, dose-response)",
    topics: ["set rep rest", "RIR", "reps in reserve", "Zourdos", "rest interval", "ipertrofia dose-response", "volume hypertrophy", "Schoenfeld", "1RM stimato", "Brzycki Epley", "autoregolazione", "carichi palestra", "manubri"],
    content: `Per sessioni di forza a casa o in palestra, il coach applica la programmazione ACSM Ratamess 2009 (chunk 11) con parametri pratici aggiuntivi qui dettagliati.

Rest tra serie (Schoenfeld et al., J Strength Cond Res, 2016, RCT su 21 uomini allenati): riposi lunghi 3 min producono maggiori guadagni di ipertrofia e forza rispetto a 1 min, a parità di volume. Implicazione: ipertrofia → 60-120s, forza massimale → 3-5 min, resistenza muscolare → 30-60s. Recuperi brevi NON offrono vantaggi di ipertrofia come spesso affermato nella cultura fitness.

Volume dose-response per ipertrofia (Schoenfeld, Ogborn, Krieger, J Sports Sci, 2017, meta-analisi 15 studi): set settimanali per gruppo muscolare e aumento massa muscolare mostrano dose-response con plateau intorno a 10-20 set/settimana; sotto 10 set effetto sub-ottimale, sopra 20-22 set diminishing returns e rischio di overreaching. Sweet spot pratico per hobbyist: 10-12 set/settimana per gruppo muscolare principale.

RIR / Reps In Reserve (Zourdos et al., J Strength Cond Res, 2016): scala soggettiva 0-10 in cui l'utente stima quante ripetizioni avrebbe potuto fare in più prima del cedimento. Correlazione alta con %1RM in utenti allenati. Per ipertrofia: RIR 1-3 ottimale. Per forza massimale: RIR 0-2. Evita training a cedimento tecnico costante (RIR 0) — Helms 2018 review conferma risultati simili a RIR 1-2 con meno fatica sistemica.

1RM stimato senza test massimale (Brzycki 1993, Epley 1985): formula pratica Brzycki 1RM = peso / (1.0278 − 0.0278 × reps). Precisione ±5% per reps 4-10, degrada oltre 12 reps. Per manubri componibili a casa: fare 8-10 rip con RIR 2-3, calcolare, sapere che è stima.

Implicazione per il coach: quando l'utente registra una sessione forza, chiedere RIR (non solo RPE) per dare feedback preciso. Se durata eccessiva (>60min) e RIR sempre 0, segnalare overreaching imminente. Proporre rest timer basato sull'obiettivo (ipertrofia vs massimale). Warning: non spingere al cedimento tecnico per esercizi complessi (squat, affondi) — rischio compensazioni e infortuni.`,
    primaryCitation: "Schoenfeld 2017 (J Sports Sci, meta-analisi volume)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/27433992/",
      "https://pubmed.ncbi.nlm.nih.gov/27102172/",
      "https://pubmed.ncbi.nlm.nih.gov/26605807/"
    ],
    contexts: ["strength_db"],
  },
  {
    id: "sec-26-core-unilateral-training",
    sectionNumber: 26,
    title: "Core stability & unilateral training — prevenzione asimmetrie",
    topics: ["core", "anti-rotazione", "McGill big three", "bird-dog", "side plank", "curl-up", "unilateral", "split squat", "Bulgarian", "affondi", "asimmetrie", "single-leg", "stabilità"],
    content: `Il coach suggerisce esercizi di core e unilaterali nei piani forza, specialmente post-infortunio e per sport con cambi di direzione (calcio, tennis).

Core stability (McGill, Spine, 2010 + Low Back Disorders libro 2015): "Big Three" validati per stabilità lombare — curl-up, side plank, bird-dog. Preferire contrazione ISOMETRICA e integrità spinale a high-volume sit-ups (che producono stress compressivo su L4-L5). Isolated core NON correla direttamente con prevenzione dolore lombare (Cochrane review Saragiotto 2016), ma supporta performance atletica integrando la catena cinetica (Willardson 2007).

Anti-rotazione (Behm & Colado, IJSM 2012): esercizi dove il core resiste a momento rotazionale esterno (Pallof press, one-arm carry, renegade row) reclutano obliqui + transverso in modo ecologico. Più specifici per sport che prevedono rotazioni (tennis serve, calcio cross) rispetto a sit-up classici.

Unilateral training (McCurdy et al., J Strength Cond Res, 2005; McCurdy & O'Kelley 2020): single-leg squat, Bulgarian split squat, affondi laterali. Vantaggi vs bilateral: (1) riduce asimmetrie forza arti 10-15% tipiche in runner; (2) carica ridotta sul rachide (metà del peso per gamba); (3) migliora stabilità anca/ginocchio — fondamentale post-infortunio muscolare o legamentoso. Carichi: partire con corpo libero, progredire a manubri 6-10kg/mano.

Bulgarian split squat specifico: piede posteriore elevato (20-30cm), 3 serie × 8-10 rip per gamba, RIR 2. Attiva più gluteo vs squat classico (Ebben 2009), utile per imbalance quadricipiti > glutei frequente in runner.

Implicazione per il coach: prescrivere almeno 1 sessione/settimana con 2 esercizi core (1 anti-rotazione + 1 stability) e almeno 1 esercizio unilaterale in sessioni forza gambe. Post-infortunio asymmetrico (es. polpaccio monolaterale): unilaterale prioritario per 4-6 settimane per riequilibrare. Warning: Bulgarian con carico pesante richiede stabilità; partire senza manubri.`,
    primaryCitation: "McGill 2010 (Spine) — core big three",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/20139764/",
      "https://pubmed.ncbi.nlm.nih.gov/16503684/",
      "https://www.backfitpro.com/"
    ],
    contexts: ["strength_db"],
  },
  {
    id: "sec-27-return-to-run-calf",
    sectionNumber: 27,
    title: "Return-to-run post-infortunio polpaccio — protocollo progressivo",
    topics: ["return to run", "polpaccio acuto", "microlesione", "strain grado 1", "gastrocnemio", "soleo", "Silbernagel", "Alfredson", "heavy slow resistance", "Kongsgaard", "eccentrico", "walk-jog-run", "recidiva", "calf raise"],
    content: `Per l'utente che ha subito una microlesione del polpaccio (tipicamente gastrocnemio, grado I), il coach applica un protocollo di ritorno progressivo distinto dal pain-monitoring Silbernagel (chunk 7) che resta regola durante tutte le fasi.

Heavy Slow Resistance vs eccentrico puro (Kongsgaard et al., Scand J Med Sci Sports, 2009; Beyer et al., Am J Sports Med, 2015): per tendinopatie e strain muscolari in fase riabilitativa, protocollo HSR (3 × 15 rip a 70-85% 1RM, tempo 3-6s concentrico + 3-6s eccentrico) produce risultati clinici equivalenti a eccentrico Alfredson puro MA con migliore aderenza (1 sessione 3x/settimana vs 2 sessioni/die Alfredson). Per calf specifico: standing calf raise + seated calf raise (bersaglia soleo che è 80% del volume polpaccio).

Walk-jog-run progression (MacAuley, Physician & Sports Med, 2014; Beach et al., Int J Sports Phys Ther, 2019): dopo 2-3 settimane di riposo + riabilitazione HSR, progressione graduale in 4-6 settimane. Fase 1 (settimana 1-2): cammino 30min, pain ≤2/10. Fase 2 (settimana 3): walk-jog intermittente 1min jog / 2min walk × 10 in Z1. Fase 3 (settimana 4): 3min jog / 1min walk × 8 in Z2 bassa. Fase 4 (settimana 5): corsa continua 20min in Z2. Fase 5 (settimana 6+): progressione volume +10-15%/settimana fino a baseline pre-infortunio.

Prevenzione recidiva (Maffulli et al., Br Med Bull, 2003; Silbernagel et al. 2007): calf eccentric 3 × 15 rip, 2x/settimana come maintenance indefinito. Riduce recidiva strain grado I del 30-50% a 6-12 mesi.

Implicazione per il coach: se l'utente ha in profile.injuries una microlesione polpaccio recente (≤8 settimane), il coach deve proporre piani con corsa in fase 2-3 anche se l'utente vuole tornare in fase 4 subito, includere sempre 1 sessione forza eccentrica polpaccio/settimana per 6 settimane, monitorare pain 0-4 ogni corsa, stop immediato se dolore sale a ≥3 durante o ≥2 residuo 24h dopo. Warning: recidiva polpaccio in primi 3 mesi è ~30% — la cautela è più importante dell'ambizione.

Nessun major update post-Beyer 2015; HSR resta standard per rehab tendini/muscolo polpaccio.`,
    primaryCitation: "Kongsgaard 2009 (HSR) + MacAuley 2014 (return-to-run)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/19793213/",
      "https://pubmed.ncbi.nlm.nih.gov/26362436/",
      "https://pubmed.ncbi.nlm.nih.gov/17485496/"
    ],
    contexts: ["mobility", "macro_periodization", "cardio_intervals"],
  },
  {
    id: "sec-28-football-amateur",
    sectionNumber: 28,
    title: "Calcio amatoriale — richiesta metabolica, prevenzione FIFA 11+, return to play",
    topics: ["calcio", "football", "recreational football", "partita", "Krustrup", "Yo-Yo IR", "30-15 IFT", "FIFA 11+", "Soligard", "prevenzione infortuni calcio", "return to play", "Ekstrand", "sprint repeatability", "strain", "calcio polpaccio strain specifico"],
    content: `Per l'utente che gioca calcio a 11 amatoriale e deve prepararsi a una partita specifica, il coach applica evidenza specifica sul calcio.

Richiesta metabolica calcio ricreativo (Krustrup et al., Br J Sports Med, 2010, su 2000+ amatori): partita 60-90min richiede distanza 8-12km con 1200-1500m ad alta intensità (>14 km/h), 40-60 sprint brevi (1-3s), 700-1000 cambi di direzione. Carico interno: FC media 85% FCmax, picchi 95%. Perdita fluidi 1.5-3L. VO2max correlazione r=0.60 con qualità prestazione.

Yo-Yo Intermittent Recovery Test 1 (Bangsbo 2008): predictor validato di performance calcistica. Benchmark amatoriale adulto: 1200-1800m (bassi-medi), 1800-2400m (buoni), >2400m (livello semi-pro).

FIFA 11+ warm-up (Soligard et al., BMJ, 2008, RCT cluster su 1892 calciatrici 13-17 anni): programma di 20min in 3 parti (corsa lenta, forza/equilibrio/pliometria, corsa con calcio) pre-allenamento 2-3x/settimana riduce infortuni -35%, infortuni gravi -50%. Valido anche per maschi adulti (Silvers-Granelli 2017 JSCR). Include esercizi chiave: Nordic hamstring, single-leg balance, plank laterale, squat con salto controllato.

Nordic hamstring specifico (Al Attar et al., Sports Med, 2017, meta-analisi): 3 serie × 5-10 rip eccentriche, 1-2x/settimana riduce strain ischiocrurali -51%. Obbligatorio per amatori calcio senza esperienza strutturata di forza.

Return to play post-infortunio polpaccio (Ekstrand et al., Br J Sports Med, 2011; consensus UEFA): strain grado I tipicamente 14-21 giorni. Protocollo minimo: pain-free camminato, corsa lineare Z2 senza dolore ≥20min, accelerazioni/decelerazioni submassimali, cambi direzione 45°→90° progressivi, sprint sub-max 90%, contatto e partita simulata. Ogni fase 2-3 sedute distanziate 48h. Tempo minimo totale 7-10 giorni dopo walk-to-run.

Implicazione per il coach: con partita programmata, proporre 4-8 settimane di preparazione con 2 corse/settimana (1 fondo Z2 + 1 sprint-repeat o intervalli alta intensità), 1 sessione forza gambe + Nordic hamstring, 1 FIFA 11+ come warm-up standalone. Tapering ultima settimana: -40% volume mantenendo intensità. Se l'utente ha infortunio recente, rispettare progression return-to-play anche se conflitta con calendario partita. Warning: 60min di partita richiedono fitness specifico — amatori "solo runner" spesso cedono muscolarmente al minuto 50-60.`,
    primaryCitation: "Soligard 2008 (BMJ) — FIFA 11+",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/19066168/",
      "https://pubmed.ncbi.nlm.nih.gov/20861097/",
      "https://pubmed.ncbi.nlm.nih.gov/28500081/"
    ],
    contexts: ["sport_specific"],
  },
  {
    id: "sec-29-tennis-padel",
    sectionNumber: 29,
    title: "Tennis & padel — physiology, conditioning rotazionale, overuse spalla",
    topics: ["tennis", "padel", "racquet sport", "Kovacs", "rotational power", "lateral agility", "shoulder overuse", "infraspinato", "wrist", "work rest ratio", "pronazione"],
    content: `Per l'utente che gioca tennis e padel 2-3 volte/settimana, il coach applica evidenza specifica per sport di racchetta.

Physiology tennis (Kovacs, Sports Med, 2007; Fernandez-Fernandez et al., Strength Cond J, 2009): gioco intermittente con rally medi 5-10s lavoro / 10-25s recupero, ratio work:rest 1:2-1:5. Match 60-120min totali. FC media 70-85% FCmax con picchi 95% nei punti lunghi. Domanda energetica mista aerobica (60-70% recupero tra punti), anaerobica alattacida (sprint esplosivi), forza eccentrica rotazionale (servizio).

Lateral agility (Kovacs 2006): test 5-10-5 shuttle e hexagon test come benchmark per tennis. Migliora con plyometrics laterali (lateral bound, skater jumps 3 × 10) + foot speed drills (agility ladder) 1-2x/settimana.

Rotational power / medicine ball training (Barcelos et al., J Strength Cond Res, 2015): medicine ball rotational throw 3 × 6-8 rip/lato, 2x/settimana, correlato con velocità servizio e colpi fondamentali. Peso raccomandato 2-4kg. Combina con cable woodchopper per resistenza eccentrica anti-rotazione.

Shoulder/elbow overuse (Cools et al., Br J Sports Med, 2015; Reinold 2009): incidenza tendinopatia cuffia rotatori in tennis player ~50% lifetime. Prevenzione: infraspinato e teres minor con banda elastica (external rotation 3 × 15 rip/braccio, 3x/settimana), Y-T-W prone. Gomito: tennis elbow (epicondilite laterale) da overuse rovescio bimanuale o backhand a una mano con tecnica scorretta — wrist extensor eccentric (Tyler twist) protocollo efficace.

Padel — letteratura emergente (Muñoz et al., Int J Environ Res Public Health, 2022; García-Fernández 2019): match 60-90min, intensità media 75% FCmax. Meno stress spalla vs tennis (nessun servizio full-overhead sostenuto) MA più stress polso in pronazione ripetuta (vibora, bandeja). Infortuni comuni: tennis elbow, strain polpaccio (partenze esplosive su campo corto).

Implicazione per il coach: se l'utente fa tennis/padel ≥2x/settimana, inserire nel piano 1 sessione prevenzione spalla-polso (esterni rotatori + wrist extensor/flexor) e 1 drill agility laterale con pliometria leggera. Durata 15-20min, stand-alone o warm-up pre-sessione sport. Warning: incrementare volume tennis senza preparazione agility → strain gastrocnemio/quadricipite frequentissimi nei "runner che riprendono il tennis".`,
    primaryCitation: "Kovacs 2007 (Sports Med) — tennis physiology",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/17326697/",
      "https://pubmed.ncbi.nlm.nih.gov/25708136/",
      "https://pubmed.ncbi.nlm.nih.gov/35681969/"
    ],
    contexts: ["sport_specific"],
  },
  {
    id: "sec-30-weight-loss-sustainable",
    sectionNumber: 30,
    title: "Weight loss sustainable — rate, deficit, preservazione massa magra",
    topics: ["weight loss", "perdita peso", "dimagrimento", "cut", "deficit calorico", "Garthe", "Helms", "ACSM Donnelly", "preservazione lean mass", "protein cut", "metabolic adaptation", "plateau", "diet break", "refeed"],
    content: `Per l'utente con goal di perdita peso (es. 5kg in 3 mesi), il coach applica evidenza su cal deficit sostenibile e preservazione massa magra.

Rate sicuro (ACSM Donnelly et al., Med Sci Sports Exerc, 2009, position stand): 0.5-1.0 kg/settimana è sostenibile con deficit 500-1000 kcal/die. Sopra questa soglia: maggior perdita lean mass, più rebound, peggio aderenza. Per atleti/sportivi più attivi: Garthe et al. (Int J Sport Nutr Exerc Metab, 2011), RCT su atleti d'élite, 0.7% body weight/settimana preserva performance e lean mass vs 1.4% che riduce entrambi.

Per utente 80kg che vuole perdere 5kg in 3 mesi = 0.42 kg/settimana = 0.52%/settimana. Rientra nel target safe-sustainable.

Preservazione lean mass in deficit (Helms et al., J Int Soc Sports Nutr, 2014, review protein requirements natural bodybuilders): durante cut aggressivo, proteine 2.3-3.1 g/kg massa magra (≈1.8-2.4 g/kg peso corporeo). In utente 80kg → 145-195g proteine/die. Evidenze Longland 2016 (Am J Clin Nutr): 2.4 g/kg + resistance training in deficit = +1.2kg lean mass (gain in deficit!) vs 1.2 g/kg perdita netta massa magra.

Protein distribution (Mamerow et al., J Nutr, 2014, RCT crossover): stesso totale 90g proteine distribuito 30g × 3 pasti vs 10-15-65g unbolo, il pattern distribuito aumenta MPS del 25%. Schoenfeld & Aragon, J Int Soc Sports Nutr, 2018: 0.4-0.55 g/kg per pasto × 4 pasti optimal. Per utente 80kg: 32-44g proteine × 4 pasti.

Cardio + strength vs solo cardio (Willis et al., J Appl Physiol, 2012, STRRIDE AT/RT trial): 8 mesi, overweight adulti. Solo aerobic -1.8kg fat, -0.1kg lean. Solo resistance +1.1kg lean, +0.8kg fat. Combinato -1.6kg fat, +1.0kg lean. Messaggio: cardio dimagrisce, ma combinare con forza preserva/costruisce lean mass.

Metabolic adaptation & plateau (Trexler et al., J Int Soc Sports Nutr, 2014): dopo 4-6 settimane deficit aggressivo, RMR scende del 5-15% (oltre la quota attesa). Strategie: diet break 1-2 settimane a maintenance ogni 8-10 settimane, refeed carb a 5-8 g/kg 1x/settimana ripristina leptina + TSH (Dirlewanger 2000 JCEM), mantenere volume allenamento forza costante anche in deficit.

Implicazione per il coach: se obiettivo peso è dichiarato, proporre target -0.5 kg/settimana calcolato, protein intake 1.8-2.2 g/kg distribuito su 3-4 pasti, mantenere 2 sessioni forza/settimana anche se volume cardio aumenta, pianificare diet break ogni 8 settimane come NORMA non come sconfitta. Warning: <1.6 g/kg proteine in deficit = perdita lean mass accelerata, sabota long-term metabolic health.`,
    primaryCitation: "Helms 2014 (JISSN) + Garthe 2011 (IJSNEM)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/24864135/",
      "https://pubmed.ncbi.nlm.nih.gov/21558571/",
      "https://pubmed.ncbi.nlm.nih.gov/22644898/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-31-nutrition-practical-timing",
    sectionNumber: 31,
    title: "Nutrizione pratica — timing pre/post-workout, caffeina, creatina",
    topics: ["nutrition timing", "pre workout", "post workout", "Burke", "anabolic window", "Schoenfeld", "caffeina", "Goldstein ISSN", "creatina", "Kreider", "Sawka idratazione", "alcohol MPS"],
    content: `Oltre al chunk 13 (limiti del coach su nutrizione), questo chunk fornisce evidenza pratica per timing specifico.

Pre-workout carbs (Burke et al., J Sports Sci, 2011): per endurance ≥60min, 1-4 g/kg carbs 1-4h prima. Per utente 80kg: 80-320g carbs 1-4h pre. Per corsa <60min o forza, 0.5-1 g/kg 30-60min prima è sufficiente. Preferire carbs low-to-medium GI per durate >90min, higher GI per <60min.

Post-workout anabolic window (Schoenfeld et al., J Int Soc Sports Nutr, 2013, narrative review; Aragón & Schoenfeld 2013): il mito della finestra 30-60min è stato smontato. Per persone che hanno consumato proteine 1-2h pre-workout, timing post-workout è largamente irrilevante. Per digiuno pre-workout, finestra estesa 4-6h post. Implicazione pratica: il pasto che conta è quello nelle 24h, non i 60min post-session.

Idratazione durante esercizio (Sawka et al., ACSM Position Stand, 2007): 400-800 mL/h in base a sudorazione. Test pratico: pesarsi pre/post sessione, ogni kg perso ≈ 1L fluidi. Elettroliti (Na+ 300-700 mg/h) necessari solo per durate >90min o caldo >28°C. Iperidratazione (bere troppo in eventi endurance) → iponatremia sintomatica, rischio documentato (Almond 2005 NEJM su maratoneti).

Caffeina ergogenica (Goldstein et al., ISSN position stand, J Int Soc Sports Nutr, 2010; Grgic 2018 meta): 3-6 mg/kg 30-60min prima di endurance o team sport produce miglioramento performance 2-5%, strength 5-7%. Utente 80kg: 240-480mg (3-6 tazzine espresso). Tolleranza sviluppa in 4-7 giorni di uso cronico. Cautela: sensibilità individuale, sconsigliata >400mg/die (FDA safety), evitare <6h pre-sleep (disrupts sleep architecture).

Creatina monoidrato (Kreider et al., ISSN position stand, J Int Soc Sports Nutr, 2017): 3-5 g/die costante, NO loading necessario (satura muscolo in 3-4 settimane comunque). Benefici validati: +5-15% forza e potenza, +1-2kg lean mass per saturazione intracellulare. Safe: oltre 20 anni di evidenza in sani, no effetti renali dannosi. Mito acqua "ritenzione": è intracellulare (muscolo), non sottocutanea.

Alcohol post-workout (Parr et al., PLOS ONE, 2014): 1.5 g/kg alcol post-resistance training riduce MPS -37% per 24h nonostante intake proteico adeguato. 1 birra (500ml al 5%) ≈ 20g alcol (0.25 g/kg per utente 80kg) = riduzione modesta. 4+ birre = effetto significativo. Timing: preferire 24-36h di distanza da sessione chiave (gara, test).

Implicazione per il coach: in risposte chat su domande nutrizione/timing, usare questi range concreti. Evitare di spingere supplementazione (creatina/caffeina sono efficaci ma opzionali). Warning: ogni raccomandazione nutrizionale specifica deve accompagnarsi a "queste sono linee guida da evidenza; consulta nutrizionista sportivo per piano personalizzato".`,
    primaryCitation: "Burke 2011 (JSS) + Schoenfeld 2013 (JISSN) + Kreider 2017 (JISSN)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/21660839/",
      "https://pubmed.ncbi.nlm.nih.gov/23360586/",
      "https://pubmed.ncbi.nlm.nih.gov/28615996/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-32-doms-management",
    sectionNumber: 32,
    title: "DOMS — meccanismo, gestione, repeated bout effect",
    topics: ["DOMS", "muscle soreness", "indolenzimento", "Proske", "Chen", "eccentric", "repeated bout effect", "Hortobagyi", "allenarsi con DOMS", "distinzione infortunio"],
    content: `DOMS (delayed onset muscle soreness) appare 24-72h dopo attività non abituale (tipicamente eccentrica). Il coach aiuta l'utente a distinguerlo da infortunio e a gestirlo.

Meccanismo (Proske & Morgan, J Physiol, 2001; Nosaka 2002): microtrauma strutturale a livello sarcomerico (z-disk disruption) da contrazioni eccentriche → risposta infiammatoria locale + sensibilizzazione nocicettori → dolore ritardato. Picco 48-72h, risolto entro 5-7 giorni. NON è acido lattico (mito sfatato anni '80).

Allenarsi con DOMS (Chen et al., Eur J Appl Physiol, 2009): DOMS lieve (<3/10 dolore) NON aumenta rischio infortunio in sessione successiva. Performance ridotta ~5-10% ma non pericolosa. DOMS severo (>5/10) con riduzione ROM >20%: raccomandato riposo o solo cardio leggero in Z1 (non eccentrico). Warning clinico: se dolore localizzato puntiforme (vs diffuso muscolare), gonfiore visibile, o calore cutaneo → NON è DOMS, è probabile infortunio (strain).

Repeated bout effect (McHugh, Scand J Med Sci Sports, 2003): primo stimolo eccentrico produce DOMS forte; stesso stimolo ripetuto dopo 1-2 settimane produce DOMS molto ridotto (-50-80%). Adattamento neurologico + strutturale + rimodellamento cytoskeletal. Pratico: prima sessione di un nuovo movimento sarà peggio; persevera 2-3 sessioni distanziate 5-7gg e il DOMS scompare.

Distinzione DOMS vs infortunio. DOMS: dolore diffuso bilaterale (o nel muscolo allenato), rigidità al movimento, ROM ridotto ma migliora con warm-up. Infortunio strain: dolore puntiforme, spesso unilaterale, compare durante/subito dopo esercizio, peggiora con movimento specifico, possibile gonfiore/ecchimosi. Tendinopatia: dolore focale su inserzione tendine, peggiora a freddo (caffè del mattino), migliora con warm-up, peggiora di nuovo dopo sessione.

Strategie gestione (Dupuy et al., Front Physiol, 2018, meta-analisi 99 studi): massaggio effect size 0.54 su DOMS (migliore), foam rolling 0.34, cold water immersion 0.30, stretching post-exercise effect trascurabile (0.12). Sonno adeguato (7-9h) e proteine 1.6+ g/kg accelerano recupero. NSAID routinari sconsigliati (Schoenfeld 2012: bloccano adattamento proteosintetico).

Implicazione per il coach: quando l'utente riporta RPE alto + soreness il giorno dopo una sessione, il coach non deve allarmarsi se è la prima sessione di un nuovo stimolo. Se DOMS persiste >5 giorni o dolore localizzato puntiforme: sospetto infortunio, sospendere e valutare. In piani: distribuire sessioni eccentriche (forza polpaccio, discese) con almeno 48-72h tra stimoli sullo stesso muscolo. Warning: primo mese di un nuovo programma forza → DOMS normale, non scoraggiarsi; dopo 3-4 settimane si attenua.`,
    primaryCitation: "Proske 2001 (J Physiol) + Chen 2009 (EJAP)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/11731588/",
      "https://pubmed.ncbi.nlm.nih.gov/19050918/",
      "https://pubmed.ncbi.nlm.nih.gov/29713282/"
    ],
    contexts: ["mobility", "macro_periodization"],
  },
  {
    id: "sec-33-allergie-esercizio",
    sectionNumber: 33,
    title: "Allergie stagionali e antistaminici — impatto su training",
    topics: ["allergie", "rinite allergica", "antistaminici", "EIB", "exercise-induced bronchoconstriction", "cetirizina", "loratadina", "performance VO2", "cortisolo"],
    content: `Per l'utente che soffre di allergie stagionali e usa antistaminici (es. cetirizina, loratadina), il coach considera l'impatto su performance e recupero.

Rinite allergica e endurance (Katelaris et al., Curr Allergy Asthma Rep, 2013; Surda et al. 2017): congestione nasale → aumento work of breathing + shift a respirazione orale che riduce heat exchange e filtrazione allergeni, peggiorando ulteriormente i sintomi. Studi su atleti cross-country: VO2max ridotto 5-10% durante fase sintomatica acuta. Recupero post-sforzo rallentato (più stress cortisolo).

Exercise-induced bronchoconstriction / EIB (Parsons et al., Am J Respir Crit Care Med, 2013 ATS guideline): spasmo bronchiale post-esercizio intenso, prevalenza atleti endurance 30-50%, generale 10-20%. Sintomi: dispnea, tosse, wheezing nei 5-15min post-esercizio. Fattori triggering: aria fredda/secca, inquinanti, pollini. Diagnosi richiede medico (test broncoprovocazione). Se sospetto: evitare Z5 VO2max in giornate con alta concentrazione allergeni.

Antistaminici H1 di seconda generazione (cetirizina, loratadina, fexofenadina, desloratadina): non sedativi, non impattano significativamente performance cognitive o fisiche. Loratadina e fexofenadina hanno evidenza di neutralità assoluta su VO2max e tempo reazione (Tashiro 2008 review). Cetirizina: mild sedation in minoranza di utenti — monitorare.

Antistaminici H1 di prima generazione (difenidramina, clorfenamina): SEDATIVI, riducono tempo reazione 15-30%, peggiorano performance in sport che richiedono agilità/decisioni (tennis, calcio). Da EVITARE in sessioni tecniche.

Timing assunzione vs allenamento (Scadding et al., Clin Exp Allergy, 2008 guidelines): seconda generazione → effetto pieno 1-3h post-assunzione, durata 24h. Assumere al mattino copre allenamenti pomeridiani-serali. Se picco pollinico mattutino (ore 5-10), pre-dose sera prima migliora controllo sintomi.

Cortisonici topici nasali (budesonide, mometasone): NON hanno effetto performance. Cortisonici sistemici (prednisone per allergia severa): sì, impatto catabolico muscolare a dosi >20mg/die per >1 settimana — segnalare al coach se in corso.

Implicazione per il coach: se l'utente dichiara uso antistaminici in giorni sintomatici, il coach accetta che RPE potrebbe essere aumentato di 1-2 punti a parità di carico e VO2 apparente ridotto 5-10%. NON interpretare questo come overtraining. Sessioni Z5 VO2max: consigliare di spostarle a giorni meno sintomatici. Warning: sintomi respiratori nuovi/peggiorati durante esercizio in utente con allergie → NON normalizzare, consigliare valutazione pneumologica per EIB.`,
    primaryCitation: "Tashiro 2008 (review antistaminici & performance) + Parsons 2013 (ATS EIB)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/18315547/",
      "https://pubmed.ncbi.nlm.nih.gov/23634861/",
      "https://pubmed.ncbi.nlm.nih.gov/28460296/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-34-stretching-mobility",
    sectionNumber: 34,
    title: "Stretching & mobility — dinamico pre, statico post, PNF, foam rolling",
    topics: ["stretching", "mobility", "static", "dynamic", "PNF", "Behm", "foam rolling", "self-myofascial release", "Wiewelhove", "warm-up", "cool down"],
    content: `Il coach suggerisce stretching e mobility in modo evidence-based, distinguendo pre/post sessione e obiettivi.

Static stretching PRIMA di esercizio esplosivo (Behm et al., Appl Physiol Nutr Metab, 2016, review 125 studi): static stretching >60s pre-exercise riduce forza massimale 4-8%, potenza 2-5%, velocità sprint 1-3%. Effetto transitorio (20-30min). Static stretching <45s pre-exercise ha effetto trascurabile. Conclusione: per sport di forza/potenza/sprint, evitare static stretch >60s immediato pre-session.

Dynamic stretching pre (Behm 2016 + Opplert & Babault, Sports Med, 2018): dynamic stretching (swing arti controllato, leg swings, walking lunges 10-20 rip) migliora performance 2-5% su forza-velocità + aumenta ROM senza penalty. Raccomandato come warm-up attivo in sostituzione del static classico. Combinare 5min cardio leggero + 5-10min dynamic drills.

Static stretching POST-exercise o in sessione dedicata: se obiettivo è aumento ROM, 3-5 rip × 30-60s × 3-5x/settimana produce gain 5-15° ROM in 4 settimane (Medeiros 2016 meta). Sicuro e senza downside di performance (eseguito lontano da performance).

PNF (proprioceptive neuromuscular facilitation), contract-relax e hold-relax: effetti simili o lievemente superiori a static per ROM (Hindle 2012 review). Richiede partner o set-up specifico — meno pratico.

Foam rolling / self-myofascial release (Wiewelhove et al., Front Physiol, 2019, meta-analisi 21 studi): pre-exercise migliora flessibilità transitoria SENZA penalty di performance (vantaggio vs static). Post-exercise: riduce DOMS (effect size 0.34), accelera recupero percepito. Claims su rilascio fasciale vero (collagene) NON supportati dalla scienza — meccanismo è probabilmente inibizione neurale + aumento flusso. Pratica: 30-60s per area tesa, pre o post sessione.

Stretching e prevenzione infortuni (Small et al., Res Sports Med, 2008 meta + Lauersen 2014 Br J Sports Med): static stretching generale NON riduce incidence infortuni (unlike opinion comune). Strength training eccentrico sì (-48% injuries). Implicazione: dedicare i 10min pre-session a dynamic drills + 10min post-session a static mirato NON è prevention per infortuni, è maintenance di ROM.

Implicazione per il coach: nei piani, proporre warm-up 10min dynamic (leg swings, carioca, skip, lunges) prima di corsa/forza. Post-session: 5-10min static stretching dei muscoli principali lavorati. Sessione mobility dedicata 1x/settimana se l'utente riporta rigidità. Warning: se utente dichiara "allungo sempre prima di correre" con static prolungati, suggerire switch a dynamic — performance immediata migliorerà.`,
    primaryCitation: "Behm 2016 (Appl Physiol Nutr Metab, stretching review)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/26642915/",
      "https://pubmed.ncbi.nlm.nih.gov/29589749/",
      "https://pubmed.ncbi.nlm.nih.gov/31164822/"
    ],
    contexts: ["mobility"],
  },
  {
    id: "sec-35-readiness-cmj",
    sectionNumber: 35,
    title: "Readiness scoring — wellness questionnaire, CMJ, freshness scientifica",
    topics: ["readiness", "freshness", "wellness questionnaire", "Saw", "McLean", "RESTQ", "CMJ", "counter-movement jump", "Claudino", "neuromuscular fatigue", "Hooper"],
    content: `L'app traccia freshness 1-10 nel check giornaliero. Questo chunk fornisce la base scientifica.

Wellness questionnaire validity (Saw et al., Br J Sports Med, 2016, systematic review su 56 studi): questionari soggettivi (sleep quality, fatigue, muscle soreness, mood, stress) rispondono prima e più chiaramente a variazioni training load rispetto a misure oggettive (HR, HRV, cortisolo). Versione breve 5-item validata. Implicazione: freshness soggettiva non è inferiore a HRV o morning HR come proxy readiness.

Hooper index (Hooper & Mackinnon, Sports Med, 1995; still validated Foster 2017): somma di 4 score 1-7 (sleep quality, fatigue, stress, DOMS). Score >20 su 28 → stato overreaching probabile, suggerire deload. Score 8-14 → ottimale. Formato semplice, alta compliance.

CMJ (counter-movement jump) come proxy fatica neuromuscolare (Claudino et al., Scand J Med Sci Sports, 2017, meta-analisi 27 studi): drop in altezza CMJ >10% vs baseline individuale = fatica neuromuscolare significativa; 5-10% = monitoring; <5% = normale. Misurazione: salto con rincorsa libera, misurato con smartphone app o cronometro tempo volo. Frequenza: pre-sessione dura, 2x/settimana.

Morning HR (RHR) come proxy (Buchheit, Front Physiol, 2014): elevazione RHR >5 bpm vs baseline per ≥3 giorni consecutivi suggerisce stress accumulato (simpatico dominant) o malattia imminente. RHR basso può indicare parasympathetic rebound post-overreaching (less reliable sign).

HRV (heart rate variability) (Plews et al., Int J Sports Physiol Perform, 2013): RMSSD mattutino può guidare intensità training session-to-session. Trend >7 giorni più affidabile di daily reading (day-to-day variance 10-15% normale). Richiede device dedicato (strap polare, Whoop, Oura): non sempre pratico.

Jack Daniels VDOT come proxy performance: correla pace a VO2max. Cambia negli stati di affaticamento vs baseline, ma meno sensibile di CMJ per cambi giorno-a-giorno.

Implicazione per il coach: il campo freshness 1-10 dell'utente è un segnale valido. Integrare con sleep quality e fatigue per score composito. Trigger di deload: freshness ≤3 per 3+ giorni, o morning HR +5bpm per 3+ giorni, o CMJ drop >10% se l'utente tracker. Nel feedback, NON sovrascrivere la percezione soggettiva con dati oggettivi opposti — sono complementari. Warning: readiness score scarso + mood depresso + calo performance >14 giorni → red flag overtraining, suggerire riposo 1-2 settimane e consulto.`,
    primaryCitation: "Saw 2016 (Br J Sports Med) + Claudino 2017 (SJMSS)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/26701923/",
      "https://pubmed.ncbi.nlm.nih.gov/27629813/",
      "https://pubmed.ncbi.nlm.nih.gov/24353105/"
    ],
    contexts: ["macro_periodization"],
  },
  {
    id: "sec-36-multisport-periodization",
    sectionNumber: 36,
    title: "Multi-sport periodizzazione — runner + calcio + tennis amatore",
    topics: ["multi-sport", "concurrent training", "calcio running tennis", "periodizzazione", "priority setting", "interferenza cardio-forza", "Jeffreys", "Ross concurrent"],
    content: `Per l'utente che combina corsa, calcio amatoriale e tennis/padel con 1-2 sessioni forza/settimana, il coach applica principi di periodizzazione concurrent per bilanciare stimoli conflittuali senza compromettere l'adattamento di nessuna qualità.

Concurrent training interference (Wilson et al., J Strength Cond Res, 2012, meta-analisi 21 studi): combinare endurance + strength nella stessa settimana riduce guadagni di forza/ipertrofia mediamente del 30% rispetto alla forza isolata, mentre l'endurance NON è compromesso. L'interferenza è dose-dipendente: >3 sessioni endurance/settimana o endurance ad alto volume (>70min) amplifica l'effetto. Modalità matters: cycling interferisce meno del running (minor danno muscolare eccentrico). Separazione temporale ≥6h tra endurance e strength mitiga l'effetto (Robineau 2016).

Periodizzazione concurrent per amatore multi-sport (Jeffreys, Strength Cond J, 2002; Issurin 2010 block periodization review): priority setting giornaliero. Il sistema neuromuscolare ha una capacità di recupero limitata: non si possono massimizzare tutte le qualità lo stesso giorno. Regola: una qualità primaria per sessione, qualità secondarie in modalità tecnica/mantenimento.

Settimana tipo per runner (priorità corsa) + calcio amatoriale 1x + tennis 1x + 2 sessioni forza:
- LUN: Forza gambe (split inferiore, 45-60min, focus Bulgarian + calf eccentric). Stimolo pesante, 48h recupero prima corsa qualità.
- MAR: Corsa Z2 fondo lento 40-50min. Bassa intensità, compatibile con DOMS residuo.
- MER: Tennis/padel 60-90min + warm-up dynamic. Qualità neuromuscolare laterale, agility.
- GIO: Corsa Z4 qualità (intervalli o tempo run) 30-40min + mobility 10min.
- VEN: Forza upper + core (30-40min, Pallof, bird-dog, pull). Lontana da gambe, no interferenza.
- SAB: Calcio partita 60-90min. Sessione neuromuscolare high-load, più sprint/cambi direzione.
- DOM: Corsa Z2 lunga 50-70min OPPURE riposo attivo (camminata, mobility) se DOMS severo post-calcio.

Priority setting quando c'è conflitto (Ross & Leveritt, Sports Med, 2001; Jeffreys 2002): se match calcio o torneo tennis entro 7 giorni, declassare forza heavy a "mantenimento" (1 sessione leggera RIR 3-4 invece di 2 sessioni pesanti). Se gara corsa entro 14 giorni, tagliare tennis/calcio a 1x/settimana o saltare per rispettare il taper.

Regola di sovrapposizione eccentrica: sessioni con alto carico eccentrico (corsa lunga in discesa, Bulgarian, calcio con molti sprint/direzione) producono DOMS 48-72h. NON programmare due sessioni high-eccentric su gambe consecutive (lun calcio + mar forza gambe = rischio strain). Distanziare ≥48h o alternare emisfero corpo (gambe/upper).

Implicazione per il coach: quando l'utente dichiara multi-sport (>1 sport oltre corsa + forza), il planGenerator deve valutare volume totale settimanale (non singole sessioni) e identificare giorni "a rischio cumulativo". Nei feedback, segnalare quando 3+ sessioni high-load gambe sono programmate in 7 giorni. Warning: amatore multi-sport ambizioso ("tutto in settimana") spesso plateau dopo 4-6 settimane da overreaching cronico non riconosciuto — il coach deve proporre micro-cicli con una qualità dominante a rotazione mensile.`,
    primaryCitation: "Wilson 2012 (J Strength Cond Res) + Jeffreys 2002",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/22002517/",
      "https://pubmed.ncbi.nlm.nih.gov/11310548/",
      "https://pubmed.ncbi.nlm.nih.gov/26816209/"
    ],
    contexts: ["sport_specific", "macro_periodization"],
  }
];
