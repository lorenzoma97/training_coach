// Knowledge base scientifica del coach — 24 chunk auto-contenuti
// Fonte: docs/scientific-foundations.md
// Ogni chunk sintetizza: cosa fa il coach + evidenza + implicazione + warning.

export interface KnowledgeChunk {
  id: string;
  sectionNumber: number;
  title: string;
  topics: string[];
  content: string;
  primaryCitation: string;
  links: string[];
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
    ]
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
    ]
  },
  {
    id: "sec-3-tanaka-hrmax",
    sectionNumber: 3,
    title: "Frequenza cardiaca massima — formula Tanaka",
    topics: ["FCmax", "HRmax", "Tanaka", "zone cardiache", "208 - 0.7 age", "Z2 threshold"],
    content: `Il coach in safetyRules.ts usa la formula di Tanaka (208 - 0.7 × età) per stimare la frequenza cardiaca massima, e segnala se la FC media in fondo lento supera il 75% della FCmax stimata.

Evidenza: Tanaka, Monahan e Seals (J Am Coll Cardiol, 2001) hanno validato la formula 208 - 0.7 × età su meta-analisi di 351 studi più test di laboratorio su 514 soggetti; l'errore standard è circa ±10 bpm e il bias è inferiore rispetto alla vecchia 220-età. Shargal et al. (2015) confermano la superiorità di Tanaka su popolazione mista. Mahon et al. (Int J Exerc Sci, 2020) con analisi Bland-Altman mostrano bias minimo simile tra Fox, Gellish e Tanaka su popolazione generale. Shookster et al. (2016) indicano Tanaka come miglior trade-off multi-popolazione.

Implicazione per il coach: usare Tanaka come stima ragionevole ma esprimersi sempre in range (±10 bpm), non come valore assoluto. La soglia "Z2 ≤ 75% FCmax" è coerente con Seiler e il training polarizzato. Warning: l'errore individuale è ampio (±10 bpm); combinare la FC con RPE per decisioni su intensità. Per soggetti anziani altamente allenati (master), alcune evidenze suggeriscono formule leggermente diverse ma Tanaka resta il default più affidabile.`,
    primaryCitation: "Tanaka 2001 (J Am Coll Cardiol)",
    links: [
      "https://www.jacc.org/doi/10.1016/S0735-1097(00)01054-8",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC7523886/"
    ]
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
    ]
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
    ]
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
    ]
  },
  {
    id: "sec-7-pain-monitoring",
    sectionNumber: 7,
    title: "Dolore come guida al carico — modello Silbernagel",
    topics: ["dolore", "tendinopatia", "polpaccio", "Silbernagel", "pain-monitoring", "return to sport"],
    content: `Il diario raccoglie dolore su scala 0-4+ (pre, durante, post sessione), configurabile per area corporea. La regola hardcoded del coach è allineata alla semantica della scala: ≥4 (a spillo) = STOP immediato, =3 (localizzato) = riduci intensità, =2 (avvertibile) = monitora trend.

Evidenza: Silbernagel et al. (Am J Sports Med, 2007) è il paper di riferimento sulla tendinopatia achillea: l'attività può continuare se il dolore resta ≤5/10, non aumenta significativamente durante, e torna a baseline entro il giorno dopo; nessun effetto negativo rispetto al riposo completo. Silbernagel e Crossley (JOSPT, 2015) definiscono un framework di ritorno allo sport basato su pain-monitoring e Borg-RPE con livelli light/medium/high e giorni di recupero crescenti. Alfredson et al. (1998) hanno consolidato il protocollo eccentrico del polpaccio come trattamento per tendinopatia achillea. Rio et al. (2015) forniscono la base neurofisiologica dell'analgesia indotta da esercizio isometrico.

Implicazione per il coach: la soglia "≥4 = STOP, =3 = riduci" è allineata sia alla semantica della scala (4="a spillo", 3="localizzato/riduci") sia alla tolleranza Silbernagel (≤5/10 ≈ ≤2/4). Per tendinopatie croniche già stabili in riabilitazione il coach può tollerare fino a 5/10 con monitoraggio del ritorno a baseline entro 24h. Warning: se il dolore cambia sede, peggiora progressivamente o diventa notturno, il coach deve rinviare a fisioterapista/medico; non è compito dell'LLM fare diagnosi differenziale.`,
    primaryCitation: "Silbernagel 2007 (Am J Sports Med)",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/17307888/",
      "https://www.jospt.org/doi/10.2519/jospt.2015.5885"
    ]
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
    ]
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
    ]
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
    ]
  },
  {
    id: "sec-11-resistance-training",
    sectionNumber: 11,
    title: "Forza e resistance training — prescrizione",
    topics: ["forza", "resistance training", "set rep 1RM", "Ratamess ACSM", "ipertrofia", "progressione forza"],
    content: `Il coach gestisce workout type forza_gambe (HIIT, esplosiva, massimale, circuito) e forza_upper (upper, core, combo). Il planGenerator propone durate e carichi ma senza intervalli espliciti di volume e intensità.

Evidenza: Ratamess et al. (ACSM Position Stand, Med Sci Sports Exerc, 2009) è il riferimento internazionale — novizi 1-3 set, 8-12 rep, 60-70% 1RM, 2-3x/sett; intermedi 3-6 set, 1-12 rep, 70-85% 1RM, 3-4x/sett; avanzati con periodizzazione. Importanza di contrazioni concentriche/eccentriche/isometriche, esercizi mono e multi-articolari, bilaterali e unilaterali. L'update ACSM 2025 (Overview of Reviews) conferma i principi del 2009 con raccomandazioni aggiornate su volume settimanale. Schoenfeld et al. (J Sports Sci, 2017) con meta-analisi dose-risposta: ≥10 set per muscolo per settimana massimizzano ipertrofia, con curva curvilineare. Grgic et al. (Sports Med, 2018): a parità di volume, frequenza 2-3x/settimana per gruppo muscolare supera 1x/settimana.

Implicazione per il coach: il prompt di planGenerator dovrebbe iniettare i range ACSM per livello di esperienza. Schema operativo: forza massimale 1-5 rep, 85-100% 1RM; esplosiva 3-5 rep, 30-60% a velocità alta; ipertrofia 6-12 rep, 65-80%; resistenza muscolare 15+ rep, <65%. Warning: non prescrivere carichi assoluti; ragionare in %1RM o in RIR (reps in reserve).`,
    primaryCitation: "Ratamess ACSM 2009",
    links: [
      "https://pubmed.ncbi.nlm.nih.gov/19204579/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/"
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
  }
];
