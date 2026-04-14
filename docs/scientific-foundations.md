# Fondamenti scientifici del coach

Questo documento mappa ogni regola e comportamento del coach AI a **paper peer-reviewed** di riferimento. Per ogni area indichiamo:
- cosa fa il coach nel codice
- il paper/consenso che lo supporta (o lo mette in discussione)
- dove è implementato nel repo

Ultimo aggiornamento ricerca: 2026-04.

---

## 1. Progressione del carico — la "regola del 10%" non è un dogma

**Cosa fa il coach**: in [safetyRules.ts](../src/lib/coach/safetyRules.ts) il prompt impone `weeklyVolumeIncreaseMaxPct: 10` come cap di progressione settimanale.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Buist I. et al., *No effect of a graded training program on the number of running-related injuries in novice runners* | 2008 | Am J Sports Med | Nessuna differenza tra progressione +10%/sett e progressione "libera" su 532 neofiti (RCT). La regola del 10% **non** è supportata come misura preventiva. |
| Nielsen RO. et al., *Excessive progression in weekly running distance and risk of running-related injuries* | 2014 | J Orthop Sports Phys Ther | Aumenti >30%/sett aumentano il rischio per specifici infortuni; sotto il 30% l'associazione è debole. |
| Johansen K. et al., *How much running is too much? Identifying high-risk running sessions in a 5200-person cohort study* | 2025 | Br J Sports Med | Paradigm shift: il rischio non è il volume settimanale ma gli **spike della singola sessione** rispetto alla più lunga degli ultimi 30gg. Spike 10-30% → +64% rischio overuse. |

**Implicazione per il coach**: la regola del 10%/sett è **conservativa ma non rigorosamente evidence-based**. Vale come safeguard prudenziale per neofiti; è il *single-session spike* vs. recente che andrebbe pesato di più.

Link: [Johansen 2025 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12421110/) · [Nielsen 2014 (JOSPT)](https://www.jospt.org/doi/10.2519/jospt.2014.5164) · [Canadian Running summary](https://runningmagazine.ca/sections/training/the-10-per-cent-mileage-rule-isnt-what-you-think-study-warns/)

---

## 2. Monitoraggio del carico — Acute:Chronic Workload Ratio (ACWR)

**Cosa fa il coach**: il coach non calcola ACWR esplicitamente ma confronta "ultimi 7 giorni" con il piano e con il trend quando genera `sessionFeedback` e `weeklyReport`.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Gabbett TJ., *The training-injury prevention paradox: should athletes be training smarter and harder?* | 2016 | Br J Sports Med | Paper fondativo: carico cronico alto è protettivo; carico acuto alto relativo al cronico è rischioso. Sweet spot ACWR 0.80-1.30. |
| Maupin D. et al., *The Relationship Between Acute:Chronic Workload Ratios and Injury Risk in Sports: A Systematic Review* | 2020 | Open Access J Sports Med | 27 studi: ACWR associato al rischio, ma metodologia eterogenea → **usare con cautela**. |
| Wang C. et al., *Is the Acute:Chronic Workload Ratio Associated with Risk of Time-Loss Injury in Professional Team Sports?* | 2020 | Sports Medicine (Springer) | Systematic review: evidenza mista. Il calcolo è fragile rispetto a definizioni differenti. |
| Impellizzeri FM. et al., *Acute:Chronic Workload Ratio: Is There Scientific Evidence?* (editoriale) | 2021 | Front Physiol | Critica metodologica severa: molti studi hanno errori statistici; ACWR da usare come descrittore, non come strumento predittivo. |

**Implicazione**: integrare ACWR nella versione v2 (fase 2) come metrica descrittiva, non come "allarme" rigido.

Link: [Maupin 2020 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7047972/) · [Impellizzeri 2021 editoriale (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8138569/) · [Wang 2020 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/32572824/)

---

## 3. Frequenza cardiaca massima e zone — formula Tanaka

**Cosa fa il coach**: [safetyRules.ts](../src/lib/coach/safetyRules.ts) usa `208 - 0.7 * age` (Tanaka) per stimare FCmax, e segnala se FC media in fondo lento > 75% FCmax.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Tanaka H., Monahan KD., Seals DR., *Age-predicted maximal heart rate revisited* | 2001 | J Am Coll Cardiol | Meta-analisi su 351 studi + lab 514 soggetti. Formula `208 - 0.7 × età` con errore standard ~10bpm. Bias inferiore alla classica `220 - età`. |
| Shargal E. et al., *Age-related maximal heart rate...* | 2015 | J Sports Med Phys Fitness | Conferma superiorità di Tanaka vs. 220-age per popolazione mista sedentaria-attiva. |
| Mahon AD. et al., *Accuracy of Commonly Used Age-Predicted Maximal Heart Rate Equations* | 2020 | Int J Exerc Sci | Bland-Altman: bias minimo simile per Fox/Gellish/Tanaka su popolazione generale. |
| Shookster D. et al., *Validation of Maximal Heart Rate Prediction Equations Based on Sex and Physical Activity Status* | 2016 | Int J Exerc Sci | Tanaka resta il miglior trade-off multi-popolazione. |

**Limite**: Tanaka ha errore individuale ±10bpm — il coach deve esprimersi in range, non in valori assoluti.

Link: [Tanaka 2001 (JACC)](https://www.jacc.org/doi/10.1016/S0735-1097(00)01054-8) · [PubMed 11153730](https://pubmed.ncbi.nlm.nih.gov/11153730/) · [Mahon 2020 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7523886/)

---

## 4. Polarizzazione & Zona 2

**Cosa fa il coach**: propone "fondo lento Z2" come sessione dominante nei piani per neofiti/amatori; avvisa se FC o RPE sono sproporzionati rispetto alla tipologia.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Stöggl T., Sperlich B., *Polarized training has greater impact on key endurance variables than threshold, HIIT, or high-volume training* | 2014 | Front Physiol | RCT 48 atleti: distribuzione polarizzata (80% bassa / 20% alta intensità) → maggiori guadagni VO2max vs. altri modelli. |
| Seiler S., *What is best practice for training intensity and duration distribution in endurance athletes?* | 2010 | Int J Sports Physiol Perform | Review fondativa 80/20. Definizione delle 3 zone e del principio polarizzato. |
| Stöggl T., Sperlich B., *Training intensity distribution among well-trained and elite endurance athletes* | 2015 | Front Physiol | Review: atleti d'élite dedicano ~75-80% del volume a bassa intensità. |
| Rosenblat M. et al., *The Effect of Polarized Training Intensity Distribution on Maximal Oxygen Uptake and Work Economy: A Systematic Review* | 2024 | Sports Medicine Open | Meta-analisi recente: polarizzato vs. altri modelli → vantaggi su VO2peak e economia. |

**Implicazione per il coach**: 80% Z1-Z2 / 20% Z3+ è un default ragionevole nei piani — codificarlo in planGenerator come soft-constraint.

Link: [Stöggl/Sperlich 2014 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4621419/) · [Rosenblat 2024 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11679080/) · [8020endurance.com · Seiler hierarchy](https://www.8020endurance.com/seilers-hierarchy-of-endurance-training-needs/)

---

## 5. RPE & Session-RPE (carico interno)

**Cosa fa il coach**: il diario raccoglie RPE 1-10 per ogni sessione. Il coach segnala se RPE>6 su sessione dichiarata Z2/fondo lento (segno di sforzo sproporzionato). `weeklyReport` somma la "load" settimanale.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Borg GA., *Psychophysical bases of perceived exertion* | 1982 | Med Sci Sports Exerc | Scala originale 6-20 + CR-10. Validità rispetto a FC e lattato. |
| Foster C., *Monitoring training in athletes with reference to overtraining syndrome* | 1998 | Med Sci Sports Exerc | Introduce session-RPE come prodotto (RPE × durata) = carico interno. Riferimento universale. |
| Foster C. et al., *A new approach to monitoring exercise training* | 2001 | J Strength Cond Res | Validazione vs. HR-TRIMP: session-RPE è valido ed economico. |
| Haddad M. et al., *Session-RPE Method for Training Load Monitoring: Validity, Ecological Usefulness, and Influencing Factors* | 2017 | Front Neurosci | Review completa: validità confermata in sport diversi, età diverse. |
| Scott TJ. et al., *The Validation of Session Rating of Perceived Exertion for Quantifying Internal Training Load in Adolescent Distance Runners* | 2018 | Int J Sports Physiol Perform | RPE post-sessione (0, 15 o 30 min) è valido per adolescenti. |

**Implicazione**: il valore RPE che il diario raccoglie è già evidence-based; moltiplicarlo per durata → "load unit" semplice da graficare in fase 2.

Link: [Haddad 2017 (Frontiers)](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2017.00612/full) · [Scott 2018 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/30160557/)

---

## 6. Overtraining e monitoraggio del recupero

**Cosa fa il coach**: `checkLocalRedFlags` in [safetyRules.ts](../src/lib/coach/safetyRules.ts) segnala "deload obbligatorio" se sonno ≤6h + stanchezza ≥8/10 per ≥2 giorni consecutivi.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Meeusen R. et al., *Prevention, diagnosis, and treatment of the overtraining syndrome — Joint consensus ECSS/ACSM*** | 2013 | Eur J Sport Sci / Med Sci Sports Exerc | **Il riferimento internazionale.** Definisce FOR (funzionale), NFOR (non-funzionale), OTS. Prevalenza NFOR/OTS ~10% negli endurance. Criteri diagnostici multidimensionali (psicologici + fisiologici + training). |
| Saw AE. et al., *Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures* | 2016 | Br J Sports Med | Review: i questionari soggettivi (fatigue, mood, sleep, muscle soreness) sono spesso più sensibili ai cambiamenti di carico di marker oggettivi (CK, cortisolo). |
| Kellmann M. et al., *Recovery and performance in sport: consensus statement* | 2018 | Int J Sports Physiol Perform | Fatigue/recovery multidimensionale. Validità di strumenti come TQR, POMS, REST-Q. |
| Plews DJ. et al., *Training adaptation and heart rate variability in elite endurance athletes* | 2013 | Int J Sports Physiol Perform | HRV come marker di adattamento: **media settimanale + coefficiente di variazione**, non misure isolate. |
| Buchheit M., *Monitoring training status with HR measures: do all roads lead to Rome?* | 2014 | Front Physiol | Review completa: misure HR-based per monitoraggio (HRrest, HRR, HRV). Trade-off e protocolli. |

**Implicazione**: le soglie hardcoded (sonno 6h + fatica 8) sono **euristiche plausibili** allineate al principio Saw 2016 (i soggettivi contano); per v2 integrare HRV via wearable è l'upgrade naturale.

Link: [Meeusen 2013 (PDF sportgeneeskunde)](https://www.sportgeneeskunde.com/wp-content/uploads/Meeusen-et-al-2013-Overtraining-Consensus-ECSS-ACSM.pdf) · [Plews 2013 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/23852425/) · [Buchheit 2014 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3936188/)

---

## 7. Dolore come guida al carico — modello Silbernagel

**Cosa fa il coach**: il diario raccoglie **dolore polpaccio 0-4+** (pre/durante/post). Regola hardcoded: ≥3 = STOP.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Silbernagel KG. et al., *Continued sports activity, using a pain-monitoring model, during rehabilitation in patients with Achilles tendinopathy: a randomized controlled study*** | 2007 | Am J Sports Med | **Il paper di riferimento.** L'attività può continuare se il dolore resta ≤5/10, non aumenta significativamente durante, e torna a baseline entro il giorno dopo. Nessun effetto negativo vs. riposo completo. |
| Silbernagel KG., Crossley KM., *A Proposed Return-to-Sport Program for Patients With Midportion Achilles Tendinopathy* | 2015 | J Orthop Sports Phys Ther | Framework ritorno allo sport basato su pain monitoring + Borg-RPE. Livelli light/medium/high con giorni di recupero crescenti. |
| Alfredson H. et al., *Heavy-load eccentric calf muscle training...* | 1998 | Am J Sports Med | Protocollo eccentrico Alfredson — trattamento consolidato per tendinopatia achillea. |
| Rio E. et al., *Isometric exercise induces analgesia and reduces inhibition in patellar tendinopathy* | 2015 | Br J Sports Med | Base neurofisiologica per l'analgesia da carico. |

**Implicazione forte sul coach**: la soglia "≥3 = STOP" sulla scala 0-4 è più conservativa di Silbernagel (≤5/10). Per tendinopatie croniche **stabili**, si può rilassare la soglia con monitoraggio 24h post-attività. La versione attuale è corretta per neofiti/dubbi diagnostici; in v2 aggiungere "modalità riabilitazione" che adotta il protocollo Silbernagel esplicito.

Link: [Silbernagel 2007 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/17307888/) · [Silbernagel 2015 return-to-sport (JOSPT)](https://www.jospt.org/doi/10.2519/jospt.2015.5885)

---

## 8. SMART goals: meno ovvi di quanto sembri

**Cosa fa il coach**: l'onboarding chiede obiettivi, li valuta con `feasibility.ts` e genera **versioni SMART**.

**Evidenza che sfida l'assunto**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Swann C. et al., *The (over)use of SMART goals for physical activity promotion: A narrative review and critique* | 2022 | Health Psychol Rev | **Critica importante.** SMART goals non sono universalmente efficaci. Per persone *insufficiently active* possono ridurre aderenza e piacere vs. "open goals" (es. "cammina di più"). |
| Swann C. et al., *The effects of open and SMART goals on physical activity and psychological outcomes over one week* | 2025 | Int J Sport Exerc Psychol | Evidenza sperimentale: insufficiently active camminano di più con open goal vs. SMART individualizzato. |
| Epton T. et al., *Goal setting: A systematic review and meta-analysis of the behaviour change literature* | 2017 | Health Psychol Rev | 141 studi, 52 interventi. Effect size medio sul PA. Il goal-setting funziona ma i meccanismi specifici (SMART vs. altri) sono meno chiari. |
| Samdal GB. et al., *Effective behaviour change techniques for physical activity and healthy eating: systematic review and meta-regression* | 2017 | Int J Behav Nutr Phys Act | Auto-monitoraggio + feedback + goal setting → significativa adesione. |

**Implicazione**: per utenti neofiti, la `feasibility.ts` potrebbe **proporre open goals alternativi** ("muoviti 3 volte a settimana") oltre a quelli SMART. Da testare A/B in v2.

Link: [Swann 2022 critique (Taylor&Francis)](https://www.tandfonline.com/doi/full/10.1080/17437199.2021.2023608) · [Swann 2025 open vs SMART](https://www.tandfonline.com/doi/full/10.1080/1612197X.2025.2570187)

---

## 9. LLM come coach — stato dell'arte 2025

**Cosa fa il coach**: usa Gemini 2.0 Flash con system prompt strutturato + Zod schema + regole di sicurezza iniettate.

**Evidenza aggiornata**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Cosentino J. et al. (Google Research), *A personal health large language model for sleep and fitness coaching*** | 2025 | Nature Medicine | **Il riferimento più forte.** Gemini fine-tuned (PH-LLM) su dati wearable: **supera gli esperti umani** su esami multiple-choice di sleep medicine (79% vs 76%) e fitness (88% vs 71%). 857 case studies reali: performance pari agli esperti sul fitness. |
| Lu X. et al., *Using Large Language Models to Enhance Exercise Recommendations and Physical Activity in Clinical and Healthy Populations: Scoping Review* | 2025 | JMIR Medical Informatics | Review di 20+ studi. ChatGPT usato nel 55%. Conclude: promettente ma **supplemento a expertise umana**, richiede validazione esperta per safety. |
| Lu X. et al., *Evaluation Strategies for Large Language Model-Based Models in Exercise and Health Coaching: Scoping Review* | 2025 | J Med Internet Res | Rigore metodologico medio 2.5/5. 55% studi a basso rigore. Framework di valutazione frammentato. |
| Fu R. et al., *Infusing behavior science into large language models for activity coaching* | 2024 | PLOS Digital Health | Aggiungere teoria del cambiamento comportamentale (COM-B, self-determination) migliora la qualità dei suggerimenti LLM. |
| Englhardt Z. et al., *Towards a Personal Health Large Language Model* | 2024 | arXiv (pre-Nature Medicine) | Metodologia di fine-tuning e valutazione PH-LLM. |

**Implicazione per il coach**:
- L'approccio LLM + regole iniettate + validazione Zod è **allineato allo stato dell'arte**.
- Limite noto: senza fine-tuning specifico, Gemini "vanilla" è competente ma non supera esperti.
- v2: valutare few-shot prompting con esempi di coaching reali (principio Fu 2024).

Link: [Cosentino 2025 (Nature Medicine)](https://www.nature.com/articles/s41591-025-03888-0) · [Lu 2025 scoping review (JMIR)](https://medinform.jmir.org/2025/1/e59309) · [Fu 2024 PLOS](https://pmc.ncbi.nlm.nih.gov/articles/PMC10986996/)

---

## 10. Safety e limiti etici

**Cosa fa il coach**: disclaimer esplicito "non sostituisce medico/fisioterapista" iniettato nel prompt + mostrato in onboarding.

**Evidenza**:

| Paper | Anno | Punto chiave |
|---|---|---|
| American College of Sports Medicine, *ACSM's Guidelines for Exercise Testing and Prescription* (11th ed.) | 2021 | Standard di riferimento per screening pre-esercizio e prescrizione. Il PAR-Q+ è la base per auto-screening. |
| Riebe D. et al. (ACSM), *Updating ACSM's Recommendations for Exercise Preparticipation Health Screening* | 2015 | Med Sci Sports Exerc | Nuovo algoritmo di screening: esercizio, sintomi, condizioni cardiache. |
| Warburton DER. et al., *The Physical Activity Readiness Questionnaire for Everyone (PAR-Q+)* | 2011 | Health Fitness J Canada | Questionario validato per identificare controindicazioni all'esercizio. Open source. |

**Implicazione**: in v2 inserire un **PAR-Q+ semplificato** nell'onboarding come step pre-profilo.

Link: [ACSM guidelines (libro)](https://www.acsm.org/education-resources/books/acsms-guidelines-exercise-testing-prescription) · [PAR-Q+ sito ufficiale](https://eparmedx.com/)

---

## 11. Forza / resistance training — prescrizione

**Cosa fa il coach**: workout types `forza_gambe` (HIIT, esplosiva, massimale, circuito) e `forza_upper` (upper, core, combo). Propone durate e carichi nei piani ma senza intervalli di volume/intensità documentati.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Ratamess NA. et al. (ACSM), *Progression models in resistance training for healthy adults — Position Stand*** | 2009 | Med Sci Sports Exerc | **Riferimento internazionale.** Novizi: 1-3 set, 8-12 rep, 60-70% 1RM, 2-3x/sett. Intermedi: 3-6 set, 1-12 rep, 70-85%, 3-4x/sett. Avanzati: periodizzazione. Uso di contrazioni concentriche/eccentriche/isometriche + esercizi mono e multi-articolari, bilaterali e unilaterali. |
| ACSM, *Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance: Overview of Reviews* | 2025 | Med Sci Sports Exerc | Update sintetico degli ultimi 15 anni di review. Conferma principi 2009, aggiunge raccomandazioni su volume settimanale e progressione. |
| Schoenfeld BJ. et al., *Dose-response relationship between weekly resistance training volume and increases in muscle mass* | 2017 | J Sports Sci | Meta-analisi: ≥10 set/muscolo/settimana massimizzano ipertrofia; dose-risposta curvilineare. |
| Grgic J. et al., *Effect of Resistance Training Frequency on Gains in Muscular Strength: A Systematic Review and Meta-Analysis* | 2018 | Sports Med | Frequenza per gruppo muscolare: 2-3x/sett migliore di 1x, a parità di volume. |

**Implicazione per il coach**: il prompt di `planGenerator` **non specifica** intervalli di set/rep/%1RM. Per v2: iniettare range ACSM per livello di esperienza. Aggiungere al system prompt: "forza massimale: 1-5 rep, 85-100%; esplosiva: 3-5 rep, 30-60% carico con alta velocità; ipertrofia: 6-12 rep, 65-80%; resistenza: 15+ rep, <65%".

Link: [Ratamess 2009 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/19204579/) · [ACSM 2025 overview (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/) · [PDF ACSM 2009](https://tourniquets.org/wp-content/uploads/PDFs/ACSM-Progression-models-in-resistance-training-for-healthy-adults-2009.pdf)

---

## 12. Sonno — impatto su performance e recupero

**Cosa fa il coach**: il check giornaliero raccoglie ore, qualità sonno, stanchezza. `checkLocalRedFlags` attiva deload se sonno ≤6h + fatica ≥8/10 per 2 giorni consecutivi.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Fullagar HHK. et al., *Sleep and Athletic Performance: The Effects of Sleep Loss on Exercise Performance, and Physiological and Cognitive Responses to Exercise*** | 2015 | Sports Med | **Review cardinale.** Sleep loss riduce performance sport-specifica, cognizione, tempo di reazione. Compiti massimali brevi meno colpiti; performance prolungate e cognitive molto colpite. |
| Mah CD. et al., *The effects of sleep extension on the athletic performance of collegiate basketball players* | 2011 | Sleep | **Landmark.** Estendere sonno a ≥10h/notte per 5-7 settimane → sprint più veloci, accuratezza tiri migliore, mood migliore. Dose-risposta positiva al sonno. |
| Watson NF. et al. (AASM/SRS Joint Consensus), *Recommended amount of sleep for a healthy adult* | 2015 | Sleep / J Clin Sleep Med | **Consensus ufficiale.** Adulti 18-60 anni: ≥7h/notte per salute ottimale. <6h cronico → rischio cardiovascolare, metabolico, cognitivo. |
| Vitale KC. et al., *Sleep Hygiene for Optimizing Recovery in Athletes: Review and Recommendations* | 2019 | Int J Sports Med | Linee guida pratiche: regolarità orari, 7-9h minimo, ambiente, caffeina timing. |
| Fox JL. et al., *A Narrative Review of the Impact of Sleep on Athletes* | 2025 | PMC | Review recente su restrizione sonno, monitoraggio, interventi (sleep extension, nap, hygiene). |

**Implicazione per il coach**: la soglia "6h" è **coerente** con Watson 2015. Azione v2: raccomandare proattivamente 7-9h via check-in motivazionale. Considerare aggiunta di un indicatore "sleep debt cumulativo" (differenza tra 7.5h target e ore reali, sommata su 7gg).

Link: [Fullagar 2015 (Springer)](https://link.springer.com/article/10.1007/s40279-014-0260-0) · [Fullagar 2015 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/25315456/) · [Vitale 2019 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/30665263/) · [Fox 2025 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11779686/)

---

## 13. Nutrizione & idratazione

**Cosa fa il coach**: il diario ha campi `kcal` (stimati) e `meds` (farmaci/integratori). Il coach **non consiglia nutrizione** direttamente — corretto dal punto di vista etico. Può però citare principi in chat.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Maughan RJ. et al. (IOC), *IOC Consensus Statement: Dietary Supplements and the High-Performance Athlete*** | 2018 | Br J Sports Med / Int J Sport Nutr Exerc Metab | **Consensus di riferimento.** Solo **caffeina, creatina, beta-alanina, bicarbonato, nitrati** hanno evidenza robusta di benefici su performance. Tutto il resto: insufficiente o nullo. Mai sostituire nutrizione di base con integratori. |
| Thomas DT. et al. (ACSM/AND/Dietitians Canada), *Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: Nutrition and Athletic Performance* | 2016 | Med Sci Sports Exerc | Standard: carboidrati 3-12 g/kg/die in base a carico; proteine 1.2-2.0 g/kg/die; idratazione 5-10 mL/kg 2-4h pre-esercizio. |
| Kerksick CM. et al. (ISSN), *International society of sports nutrition position stand: nutrient timing* | 2017 | J Int Soc Sports Nutr | Timing nutrizionale: finestra anabolica estesa; carbs pre/durante/post in base a durata/intensità. |
| Sawka MN. et al. (ACSM), *Exercise and Fluid Replacement — Position Stand* | 2007 | Med Sci Sports Exerc | Idratazione: bilancio individuale con pesate pre/post; evitare deficit >2% peso corporeo. |

**Implicazione per il coach**: il coach dovrebbe **rifiutare esplicitamente** di consigliare integratori specifici o diete in chat, rinviando a nutrizionista sportivo. Azione v2: aggiungere in `systemPrompts.ts` una *guardrail* esplicita sui limiti nutrizionali ("posso parlare di principi generali ma non prescrivere").

Link: [Maughan 2018 IOC (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5867441/) · [Maughan 2018 IOC (PubMed)](https://pubmed.ncbi.nlm.nih.gov/29589768/) · [Thomas 2016 ACSM Joint Position](https://pubmed.ncbi.nlm.nih.gov/26891166/)

---

## 14. Strength training per atleti di endurance

**Cosa fa il coach**: il diario separa `corsa` e `forza_gambe`/`forza_upper`. Nei piani, il `planGenerator` potrebbe alternare le due senza un razionale esplicito di combinazione ottimale.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Rønnestad BR., Mujika I., *Optimizing strength training for running and cycling endurance performance: A review*** | 2014 | Scand J Med Sci Sports | **Review fondativa.** La forza (specialmente heavy, 1-5 rep, 85-90% 1RM) **migliora l'economia di corsa** senza aumentare massa corporea. 2-3 sessioni/sett in parallelo all'endurance. Maggiore effetto su runners di medio-lungo corso. |
| Beattie K. et al., *The Effect of Strength Training on Performance in Endurance Athletes* | 2014 | Sports Med | Meta-analisi: strength training concomitante non compromette e spesso migliora economia, TTE e performance di gara. |
| Blagrove RC. et al., *Effects of Strength Training on the Physiological Determinants of Middle- and Long-Distance Running Performance: A Systematic Review* | 2018 | Sports Med | Conferma: 2-3 sessioni forza/sett per ≥6 settimane migliorano running economy e/o time trial performance. Priorità: heavy + plyometric. |
| Fyfe JJ. et al., *Concurrent training: a critical review from the physiological and molecular perspectives* | 2014 | Sports Med | Interference effect: l'endurance fatto subito prima della forza può limitare i guadagni di forza. Separare di ≥3h o fare forza prima. |

**Implicazione per il coach**: il coach può/deve inserire **2-3 sessioni di forza/sett** nei piani per corridori, preferibilmente in giorni separati dalla corsa lunga o almeno non subito prima. Azione v2: iniettare in `planGenerator` una regola "se obiettivo contiene corsa, includere 2 sessioni forza/sett + separazione temporale da sessione endurance chiave".

Link: [Rønnestad & Mujika 2014 (Wiley)](https://onlinelibrary.wiley.com/doi/abs/10.1111/sms.12104) · [Beattie 2014 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/24532151/) · [Concurrent training review PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5983157/)

---

## 15. Salute donna — ciclo mestruale e RED-S

**Cosa fa il coach**: profilo raccoglie `sex` ma **nessuna differenziazione** nei prompt. Coach non considera fase del ciclo, uso di contraccettivi, disponibilità energetica.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Elliott-Sale KJ. et al., *The Effects of Menstrual Cycle Phase on Exercise Performance in Eumenorrheic Women: A Systematic Review and Meta-Analysis*** | 2020 | Sports Med | **Review rigorosa.** Performance **leggermente ridotta** in fase follicolare precoce vs. altre fasi, ma effect size trivial e alta varianza tra studi. Approccio **individuale** raccomandato, non linee guida universali. |
| **Mountjoy M. et al. (IOC), *2023 International Olympic Committee's consensus statement on Relative Energy Deficiency in Sport (REDs)*** | 2023 | Br J Sports Med | **Update consensus REDs.** Sindrome da bassa disponibilità energetica (LEA) con conseguenze su salute (immunità, ossa, ciclo, cardio) e performance. Rischio in atleti di entrambi i sessi. Checklist di screening. |
| Mountjoy M. et al. (IOC), *IOC consensus statement on relative energy deficiency in sport (RED-S): 2018 update* | 2018 | Br J Sports Med | Consenso precedente che ha allargato il concetto da "Female Athlete Triad" a sindrome multidimensionale. |
| Janse de Jonge XAK., *Effects of the menstrual cycle on exercise performance* | 2003 | Sports Med | Review storica — contesto fisiologico (estrogeno/progesterone su termoregolazione, substrato, fatica). |

**Implicazione per il coach**: attualmente il coach **non differenzia** donne/uomini oltre al dato di Tanaka (FCmax simile in Tanaka). Azione v2 prudente: (a) aggiungere nel profilo femminile un campo opzionale "fase ciclo" e "contraccezione", con l'opzione di tracciare mensilmente; (b) inserire guardrail in feasibility.ts che rileva segnali di LEA (perdita peso rapida, amenorrea dichiarata, fatica cronica) → rinvio a specialista. **Non** prescrivere periodizzazione ciclo-based senza evidenza individuale.

Link: [Elliott-Sale 2020 (Springer)](https://link.springer.com/article/10.1007/s40279-020-01319-3) · [Elliott-Sale 2020 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/32661839/) · [Mountjoy 2023 REDs (PubMed)](https://pubmed.ncbi.nlm.nih.gov/37752011/) · [IOC REDs page](https://www.olympics.com/ioc/news/ioc-publishes-new-consensus-statement-on-relative-energy-deficiency-in-sport-reds-to-protect-athlete-health)

---

## 16. Master athletes — invecchiamento

**Cosa fa il coach**: profilo chiede età; formula Tanaka (HRmax) è age-adjusted. Ma **nessuna differenziazione** nei volumi/intensità, né considerazione di recupero più lento con l'età.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Chodzko-Zajko WJ. et al. (ACSM), *Exercise and Physical Activity for Older Adults — Position Stand*** | 2009 | Med Sci Sports Exerc | **Posizione ACSM per adulti 65+**: 150min moderata o 75min vigorosa aerobica/sett; forza 2x/sett su 8-10 gruppi muscolari; equilibrio/flessibilità regolari. Applicabile anche a 50-64 con patologie croniche. |
| Tanaka H., Seals DR., *Endurance exercise performance in Masters athletes: age-associated changes and underlying physiological mechanisms* | 2008 | J Physiol | Declino performance ~10%/decade dopo 30-40 anni, accelerazione dopo 70. Causa dominante: riduzione VO2max (cardiaca + muscolare). |
| Lepers R., Cattagni T., *Do older athletes reach limits in their performance during marathon running?* | 2012 | Age | Longevità performance: master ben allenati mantengono ottimi livelli fino a 60-70 anni con training appropriato. |
| Reaburn P., Dascombe B., *Endurance performance in masters athletes* | 2008 | Eur Rev Aging Phys Act | Recupero post-sessione più lento: +24-48h vs. giovani. Adattare frequenza. |

**Implicazione per il coach**: azione v2 in `planGenerator`: per utenti ≥50 anni ridurre frequenza sessioni ad alta intensità (max 2/sett) e inserire giorni di recovery attivo. Per ≥65, adottare linee guida ACSM 2009 (volume ≤150min moderata/sett come baseline). Considerare formula FCmax alternativa per master: alcuni studi suggeriscono `220 - 0.93 × età` più accurata per atleti master ben allenati (Tanaka è già migliore di 220-età però).

Link: [ACSM 2009 older adults (PDF)](https://www.bewegenismedicijn.nl/files/downloads/acsm_position_stand_exercise_and_physical_activity_for_older_adults.pdf) · [Chodzko-Zajko 2009 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/19516148/)

---

## 17. Screening pre-esercizio — PAR-Q+

**Cosa fa il coach**: profilo raccoglie `injuries` (testo libero) e `meds`, ma **nessun flusso di screening strutturato**. Un utente con patologia cardiaca può iniziare un piano senza alert.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Warburton DER. et al., *The Physical Activity Readiness Questionnaire for Everyone (PAR-Q+) and Electronic Physical Activity Readiness Medical Examination (ePARmed-X+)*** | 2011 | Health Fitness J Canada | **Questionario standard internazionale.** 7 domande base + follow-up condizionali. Open source, validato su ampie popolazioni. Screening in <2 minuti. |
| **Riebe D. et al. (ACSM), *Updating ACSM's Recommendations for Exercise Preparticipation Health Screening*** | 2015 | Med Sci Sports Exerc | Algoritmo ACSM aggiornato: valuta storia esercizio + sintomi + condizioni cardio/metaboliche/renali → decide se serve clearance medica prima di iniziare. |
| Bredin SSD. et al., *The creation of the Physical Activity Readiness Questionnaire for Pregnancy (PARmed-X for Pregnancy)* | 2013 | Br J Sports Med | Variante PAR-Q per donne in gravidanza. |

**Implicazione per il coach**: **gap critico da colmare**. Azione v2: implementare i 7 PAR-Q+ in `OnboardingWizard` come step tra profilo e obiettivi. Se qualunque risposta è "sì" → mostrare disclaimer forte "consulta medico prima di iniziare" e disabilitare generazione piano finché utente non conferma.

Link: [PAR-Q+ ufficiale eparmedx.com](https://eparmedx.com/) · [Riebe 2015 (ACSM)](https://pubmed.ncbi.nlm.nih.gov/26061457/)

---

## 18. Condizioni croniche ed esercizio

**Cosa fa il coach**: profilo ha `meds` e `injuries` liberi, ma **nessuna reazione** se l'utente dichiara diabete, ipertensione, obesità, cardiopatia.

**Evidenza** (position stand ACSM per condizione):

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Colberg SR. et al. (ACSM/ADA), *Physical Activity/Exercise and Diabetes: A Position Statement of the American Diabetes Association* | 2016 | Diabetes Care | Tipo 1, tipo 2, prediabete: 150min/sett aerobica + 2-3 forza/sett. Monitoraggio glicemia pre/post. Cautela ipoglicemia in T1. |
| Pescatello LS. et al. (ACSM), *Exercise and Hypertension — Position Stand* | 2004 | Med Sci Sports Exerc | Aerobica riduce BP sistolica 5-7 mmHg. 30min moderata ≥5gg/sett. Evitare Valsalva e heavy lifting se BP non controllata. |
| Donnelly JE. et al. (ACSM), *Appropriate Physical Activity Intervention Strategies for Weight Loss and Prevention of Weight Regain for Adults* | 2009 | Med Sci Sports Exerc | Obesità: 225-420min/sett aerobica per perdita significativa; <150min insufficiente. Deficit calorico 500-750 kcal/die. |
| Pescatello LS. et al., *Exercise for Hypertension: A Prescription Update Integrating Existing Recommendations With Emerging Research* | 2015 | Curr Hypertens Rep | Update: high-intensity interval vs. moderata continua — entrambi efficaci, scelta per aderenza. |

**Implicazione per il coach**: azione v2 in `OnboardingWizard`: un set di checkbox con "patologie dichiarate" (diabete, ipertensione, cardiopatia, obesità, asma) → il coach inietta la position stand rilevante nel system prompt e adatta i piani. Corrente: solo `injuries` libero, coach può interpretare male.

Link: [Colberg 2016 diabetes (Diabetes Care)](https://diabetesjournals.org/care/article/39/11/2065/37249/) · [Colberg ACSM/ADA 2010 joint (PubMed)](https://pubmed.ncbi.nlm.nih.gov/21115758/) · [Pescatello 2004 hypertension (PubMed)](https://pubmed.ncbi.nlm.nih.gov/15076798/) · [Donnelly 2009 weight management (PubMed)](https://pubmed.ncbi.nlm.nih.gov/19127177/)

---

## 19. Motivazione e comportamento — Self-Determination Theory

**Cosa fa il coach**: tono "supportivo e pedagogico", feedback proattivo, check-in motivazionale. Persona hardcoded nel system prompt ma **non ancorata a teorie del cambiamento comportamentale** esplicite.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Teixeira PJ. et al., *Exercise, physical activity, and self-determination theory: A systematic review*** | 2012 | Int J Behav Nutr Phys Act | **Review cardinale.** 66 studi. **Motivazione autonoma** (intrinseca, identificata) predice adesione a lungo termine all'esercizio; motivazione controllata (esterna, introiettata) solo adozione iniziale. Supporto di **autonomia**, **competenza**, **relazione** da parte del coach → maggiore adesione. |
| Ryan RM., Deci EL., *Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being* | 2000 | Am Psychol | Paper fondativo SDT: i 3 bisogni psicologici fondamentali (autonomia, competenza, relazione). |
| Ntoumanis N. et al., *A meta-analysis of self-determination theory-informed intervention studies in the health domain* | 2021 | Health Psychol Rev | 73 studi. Gli interventi SDT-informati hanno effect size small-to-medium su motivazione autonoma, salute fisica/psicologica. |
| Michie S. et al., *The behaviour change wheel: A new method for characterising and designing behaviour change interventions* | 2011 | Implement Sci | Framework COM-B (Capability, Opportunity, Motivation → Behaviour). Tassonomia tecniche comportamentali. |

**Implicazione per il coach**: il coach attuale è già "pedagogico" per design. Azione v2: allineare esplicitamente il system prompt ai principi SDT — "supporta autonomia (offri scelte, non imporre)", "rinforza competenza (cita dati di progresso)", "crea senso di relazione (tono caldo, memoria del contesto)". Inoltre: nel check-in motivazionale, evitare linguaggio controllante ("devi", "dovresti") e preferire informativo ("i dati suggeriscono…", "potresti considerare…").

Link: [Teixeira 2012 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3441783/) · [Teixeira 2012 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/22726453/) · [Ntoumanis 2021 meta (Taylor&Francis)](https://www.tandfonline.com/doi/full/10.1080/17437199.2020.1718529) · [Michie 2011 COM-B (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3096582/)

---

## 20. Recovery modalities

**Cosa fa il coach**: workout type `mobilita` include stretching statico/dinamico, propriocezione, camminata, foam rolling, piscina. Nessun ranking di efficacia comunicato all'utente.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Dupuy O. et al., *An Evidence-Based Approach for Choosing Post-exercise Recovery Techniques to Reduce Markers of Muscle Damage, Soreness, Fatigue, and Inflammation: A Systematic Review With Meta-Analysis*** | 2018 | Front Physiol | **Meta-analisi 99 studi.** Ranking efficacia su DOMS/fatica: **massaggio** > recupero attivo > compression garments > immersion > contrast therapy > cryoterapia. Massaggio anche riduce marker infiammatori. Stretching passivo: effetti minimi. |
| Wiewelhove T. et al., *A Meta-Analysis of the Effects of Foam Rolling on Performance and Recovery* | 2019 | Front Physiol | Foam rolling: piccolo effetto positivo su performance acuta (sprint, flessibilità) e piccola riduzione DOMS. Miglior uso: pre-esercizio warmup e post-esercizio recovery. |
| Machado AF. et al., *Can Water Temperature and Immersion Time Influence the Effect of Cold Water Immersion on Muscle Soreness? A Systematic Review and Meta-Analysis* | 2016 | Sports Med | CWI (cold water immersion) 11-15°C per 11-15min è la finestra ottimale per ridurre DOMS. |
| Leeder J. et al., *Cold water immersion and recovery from strenuous exercise: a meta-analysis* | 2012 | Br J Sports Med | CWI efficace per recupero post-esercizio ad alta intensità. **Attenzione**: uso ripetuto può **compromettere adattamenti** di ipertrofia e forza. |

**Implicazione per il coach**: azione v2: differenziare suggerimento recovery nel feedback sessione. Dopo sessione intensa → suggerire camminata/massaggio/CWI se disponibili. Warning utente se fa CWI sistematicamente post-forza (rischio di ridurre adattamenti). Stretching statico: ok per mobilità ma non per recupero ha poca evidenza.

Link: [Dupuy 2018 (Semantic Scholar)](https://www.semanticscholar.org/paper/634f4c715da0a38f6b80a5fbfee4d3796f0eb248) · [Dupuy 2018 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/29755363/) · [Wiewelhove 2019 foam rolling (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6416396/)

---

## 21. Biomeccanica della corsa — cadenza, footstrike, scarpe

**Cosa fa il coach**: il diario raccoglie `cadenza`, `scarpe`, `superficie`. Il coach potrebbe commentare ma attualmente non ha regole specifiche.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Heiderscheit BC. et al., *Effects of step rate manipulation on joint mechanics during running* | 2011 | Med Sci Sports Exerc | **Landmark.** Aumentare cadenza di ~5-10% rispetto alla preferita → riduzione significativa di stress su ginocchio e anca. Non richiede cambio di footstrike. |
| Quinn TJ. et al., *What is the Effect of Changing Running Step Rate on Injury, Performance and Biomechanics? A Systematic Review and Meta-analysis* | 2022 | Sports Med Open | Conferma: cadence ↑ riduce carico articolare, peak impact. Effetto su infortuni: evidenza indiretta ma coerente. |
| Anderson LM. et al., *The Influence of Running Cadence on Biomechanics and Injury Prevention: A Systematic Review* | 2024 | PMC | Review aggiornata: cadenze <165 passi/min associate a maggiore incidenza di overload injuries (specialmente tibiali). |
| Napier C. et al., *Footwear and Running-Related Injuries: A Systematic Review* | 2019 | Am J Sports Med | Tipo di scarpa e minimalismo: evidenza inconsistente. Importanza di abitudine e progressione graduale, non della scarpa in sé. |
| Daoud AI. et al., *Foot strike and injury rates in endurance runners: a retrospective study* | 2012 | Med Sci Sports Exerc | Forefoot strike associato a minor incidenza infortuni ripetitivi vs. rearfoot, ma popolazione elite. **Non generalizzabile** al runner medio. |

**Implicazione per il coach**: azione v2: se cadenza dichiarata <165 ppm, suggerire gentile "prova ad aumentare la cadenza di 5%" come strategia anti-impatto. Non consigliare cambi di footstrike (rischio infortuni da transizione). Sulla scarpa: non prescrivere ma monitorare che l'utente tenga stabile lo stesso modello per ≥2 mesi prima di cambiare.

Link: [Anderson 2024 cadence review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12440572/) · [Quinn 2022 (Springer)](https://link.springer.com/article/10.1186/s40798-022-00504-0) · [Heiderscheit Stride PDF](https://www.researchgate.net/profile/Bryan-Heiderscheit/publication/262021758)

---

## 22. Tapering / peaking

**Cosa fa il coach**: gli obiettivi hanno una `deadline`. Il coach potrebbe pianificare un tapering pre-gara ma al momento **non lo fa esplicitamente**.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Bosquet L. et al., *Effects of tapering on performance: a meta-analysis*** | 2007 | Med Sci Sports Exerc | **Meta-analisi di riferimento.** Tapering ottimale: **8-14 giorni**, **riduzione volume 41-60%** (esponenziale decrescente), **intensità e frequenza invariate**. Effect size maggiore per endurance events. |
| Mujika I. et al., *Physiological changes associated with the pre-event taper in athletes* | 2004 | Sports Med | Review classica: miglioramenti performance 0.5-6% durante taper. Meccanismi: rimozione fatica + mantenimento adattamenti. |
| Spilsbury KL. et al., *Effects of tapering on performance in endurance athletes: A systematic review and meta-analysis* | 2023 | PLOS ONE | Update: conferma Bosquet 2007, suggerisce anche taper di 7gg e 15-21gg efficaci. Finestra flessibile. |

**Implicazione per il coach**: azione v2: se un obiettivo gara è entro 2 settimane, `planGenerator` genera automaticamente un taper (volume -50% settimana gara, -30% settimana precedente, mantenere intensità su sessioni brevi).

Link: [Bosquet 2007 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/17762369/) · [Spilsbury 2023 (PLOS)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0282838) · [Spilsbury 2023 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10171681/)

---

## 23. Validità dei dati da wearable (FC, PPG)

**Cosa fa il coach**: usa `fc_media` e `fc_max` inseriti dall'utente (tipicamente da smartwatch/fascia). `checkLocalRedFlags` confronta FC con soglia Z2.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Mühlen JM. et al. (INTERLIVE Network), *Recommendations for determining the validity of consumer wearable heart rate devices: expert statement and checklist*** | 2021 | Br J Sports Med | **Framework di riferimento** per valutare accuratezza wearable PPG. Checklist per pubblicazioni e utenti. |
| Bent B. et al., *Investigating sources of inaccuracy in wearable optical heart rate sensors* | 2020 | npj Digital Medicine | PPG wrist: errore medio basso a riposo (<3%), aumenta con movimento (fino a 10-15%), peggiora con pelle scura, tatuaggi, freddo. |
| Shcherbina A. et al., *Accuracy in Wrist-Worn, Sensor-Based Measurements of Heart Rate and Energy Expenditure in a Diverse Cohort* | 2017 | J Pers Med | Wrist HR accurato entro ±5% in condizioni stabili; stima calorie molto meno accurata (±27-93%). |
| Sañudo B. et al., *Accuracy of Heart Rate Measurement with Wrist-Worn Wearable Devices in Various Skin Tones: a Systematic Review* | 2022 | J Med Syst | 4/10 studi mostrano riduzione accuratezza su pelle più scura. Evidenza preliminare. |

**Implicazione per il coach**: le regole basate su FC (Tanaka + %FCmax) vanno interpretate con **bande di tolleranza**, non come cutoff rigidi. Azione v2: nel system prompt del coach aggiungere "FC da wearable ha errore ±5-10%; considera sempre anche RPE come corroboratore". Valore kcal da wearable è **inaffidabile** per intake nutrizionale — non basare consigli su quello.

Link: [Mühlen 2021 INTERLIVE (PubMed)](https://pubmed.ncbi.nlm.nih.gov/33397674/) · [Validation wearable Frontiers 2024](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2024.1326511/full)

---

## 24. Ambiente — caldo, altitudine

**Cosa fa il coach**: **non traccia né ambiente né meteo**. Potrebbe però interpretare male una FC alta in giornata calda come segnale di overtraining.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Sawka MN. et al. (ACSM), *Exercise and Fluid Replacement — Position Stand* | 2007 | Med Sci Sports Exerc | Base per esercizio in ambiente caldo: idratazione, acclimatazione 10-14gg, alert >30°C con umidità >75%. |
| Armstrong LE. et al. (ACSM), *Exertional Heat Illness during Training and Competition — Position Stand* | 2007 | Med Sci Sports Exerc | Linee guida sintomi heat illness, gestione, prevenzione. |
| Bergeron MF. et al., *International Olympic Committee consensus statement on thermoregulatory and altitude challenges for high-level athletes* | 2012 | Br J Sports Med | Altitudine: VO2max ridotto ~6-8% per 1000m >1500m. Acclimatazione richiede 2-4 settimane. |
| Périard JD. et al., *Consensus recommendations on training and competing in the heat* | 2015 | Scand J Med Sci Sports | Protocol acclimatazione 5-14gg, idratazione 250-500 ml/h, sorveglianza Tc interna. |

**Implicazione per il coach**: azione v2: aggiungere al diario un campo opzionale "condizioni ambientali" (temperatura, umidità, altitudine). Nel feedback sessione: se FC è alta e l'utente indica temp >28°C → coach non segnala overtraining ma invita a rallentare per heat stress.

Link: [ACSM fluid replacement (PDF)](https://www.khsaa.org/sportsmedicine/heat/exerciseandfluidreplacement.pdf) · [ACSM Position Stands index](https://acsm.org/education-resources/pronouncements-scientific-communications/position-stands/)

---

## 25. Composizione corporea — massa grassa, massa muscolare, acqua corporea

**Cosa fa il coach**: il check giornaliero raccoglie campi opzionali `bodyFat` (%), `muscleMass` (kg o %), `bodyWater` (% TBW) tipicamente da bilance BIA domestiche. Il coach può contestualizzare prestazioni e trend.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| **Silva AM. et al., *Body composition in a large cohort of Olympic athletes with different training loads: reference values for fat mass and fat-free mass domains*** | 2023 | Acta Diabetologica | **Riferimento normativo.** 898 atleti olimpici italiani. Range FM/FFM per sport (endurance < forza < power). Fornisce benchmark per valutare se l'atleta è in range sport-specifico. |
| **Ackland TR. et al. (IOC Medical Commission), *Current Status of Body Composition Assessment in Sport*** | 2012 | Sports Medicine | **Consensus IOC.** DXA è gold standard, BIA è accettabile ma con limiti. Errore tipico su BF% da BIA: ±3-8% individuale, ±1-2% group-level. |
| Campa F. et al., *Assessment of Body Composition in Athletes: A Narrative Review of Available Methods with Special Reference to Quantitative and Qualitative Bioimpedance Analysis* | 2021 | Nutrients | Review BIA in atleti. Raccomandazioni: misurare a riposo, digiuno 8h, post-minzione, no esercizio nelle 4h precedenti. Trend > singolo valore. |
| Matias CN. et al., *Estimation of total body water and extracellular water with bioimpedance in athletes: need for athlete-specific prediction models* | 2015 | Clin Nutr | BIA usata senza equazioni sport-specifiche sottostima TBW negli atleti di ~5-10%. Bias non trascurabile. |
| Kasper AM. et al., *Come back skinfolds, all is forgiven: A narrative review of the efficacy of common body composition methods* | 2021 | Nutrients | Critica metodologica: BF% da BIA domestica è proxy con alta varianza; **utile per trend personale, non per confronto assoluto**. |
| Mourtakos S. et al., *Body composition and race time in mountain bikers* | 2025 | Sci Rep | Correlazioni rilevanti: tempo gara correla positivamente con BF% (più grasso = più lento) e negativamente con massa muscolare e TBW. |
| Lukaski HC., *Vector bioelectrical impedance analysis (BIVA): current applications in health and sport* | 2015 | Sports Med | BIVA (vettoriale) più robusto di BIA-scalare per tracking idratazione individuale. |

**Cosa può dire il coach**:
- **Massa grassa (BF%)**: correla con costo energetico (~2-3% VO2/kg) in sport endurance. Range salutari: donne 18-28%, uomini 10-20%. Range atleti endurance: donne 14-20%, uomini 6-13%. **Mai spingere al ribasso** senza supervisione (rischio RED-S — Mountjoy IOC 2023).
- **Massa muscolare**: correla positivamente con forza/potenza. Aumenti di 1-2 kg in 12 settimane sono realistici per intermedi (Schoenfeld 2017).
- **Acqua corporea (TBW)**: ~50-65% del peso corporeo normale. Riduzioni >2% peso via disidratazione compromettono performance aerobica e forza (Sawka ACSM 2007).

**Cosa NON deve fare il coach**:
- Non prescrivere target BF% specifici (dominio nutrizionista sportivo)
- Non raccomandare deficit calorici basati su BF% da BIA domestica (errore troppo alto)
- Non leggere singoli valori come indicatori: commenta solo trend significativi (>1.5% in 2 settimane)

**Red flag incorporati**:
- BF% in calo >1.5% in 2 settimane in atleta con storia RED-S → possibile LEA ricorrente (linkato a sez 15)
- Massa muscolare in calo + RPE in salita → possibile overtraining catabolico (Meeusen 2013, sez 6)
- TBW in calo >3% con attività costante → disidratazione cronica o perdita massa magra

**Implementazione**: modulo [`bodyComposition.ts`](../src/lib/coach/promptModules/bodyComposition.ts) attivato automaticamente quando il daily check include uno qualsiasi dei 3 campi. Il prompt riceve valore attuale + delta ultimi 7 giorni.

Link: [Silva 2023 Olympic athletes (Springer)](https://link.springer.com/article/10.1007/s00592-023-02203-y) · [Ackland 2012 IOC (PubMed)](https://pubmed.ncbi.nlm.nih.gov/22571238/) · [Campa 2021 BIA athletes (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8150618/) · [Kasper 2021 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/33669687/)

---

## Mapping rapido: regola del coach → paper

| Regola hardcoded in `SAFETY` | Paper di riferimento |
|---|---|
| `weeklyVolumeIncreaseMaxPct: 10` | Buist 2008, Nielsen 2014, Johansen 2025 (da ripesare in v2) |
| `restDaysMinPerWeek: 2` | Principio generale di supercompensazione — review Seiler 2010; per master: Reaburn 2008 |
| `beginnerRunCapMinutesPerSession: 25` | ACSM guidelines 2021 + Nielsen 2014 |
| `painStopThreshold: 3` (scala 0-4) | Silbernagel 2007 (soglia più conservativa della loro 5/10) |
| `rpeEasySessionCap: 6` su Z2 | Foster 2001, Haddad 2017 — RPE >6 = zona soglia, non Z2 |
| `z2UpperPct: 0.75` FCmax | Seiler 2010, Stöggl/Sperlich 2014 |
| `sleepFatigueRedFlag` combo | Meeusen 2013 (ECSS/ACSM), Saw 2016, Watson AASM 2015 |
| `maxHRFormula: 208 - 0.7 * age` | Tanaka 2001 (±10bpm, ±5-10% con wearable PPG: Mühlen 2021) |
| **Forza — set/rep/%1RM** (da iniettare) | Ratamess ACSM 2009 + ACSM 2025 overview |
| **Strength+endurance concomitante** | Rønnestad & Mujika 2014, Beattie 2014 |
| **Ore sonno target 7-9h** | Watson AASM 2015, Fullagar 2015 |
| **Prescrizione over-65** | Chodzko-Zajko ACSM 2009 |
| **Screening cardiometabolico** | Warburton PAR-Q+ 2011, Riebe ACSM 2015 |
| **Diabete / ipertensione adattamenti** | Colberg ADA/ACSM 2016, Pescatello 2004/2015 |
| **Tono autonomia-supportive** | Teixeira 2012 SDT, Ntoumanis 2021 |
| **Ranking recovery modalities** | Dupuy 2018, Wiewelhove 2019 |
| **Cadenza corsa suggerita ≥165** | Heiderscheit 2011, Anderson 2024 |
| **Tapering -50% volume 7-14gg** | Bosquet 2007, Spilsbury 2023 |
| **FC±10% tolerance da wearable** | Mühlen INTERLIVE 2021 |
| **Heat stress modifier** | ACSM Sawka 2007, Périard 2015 |
| **Body composition tracking** | Silva 2023, Ackland IOC 2012, Campa 2021, Kasper 2021 |
| **Pain areas configurabili** (non hardcoded polpaccio) | Silbernagel 2007 adattato a zone multiple |

---

## Gap e roadmap v2

Aree in cui il coach può migliorare integrando l'evidenza raccolta (priorità alta → bassa):

### Priorità P1 — coach fa già qualcosa, manca solo l'evidenza iniettata

1. **Prescrizione forza con range ACSM** — iniettare set/rep/%1RM per livello esperienza (Ratamess 2009)
2. **2-3 sessioni forza/sett per endurance runners** — regola in `planGenerator` (Rønnestad 2014)
3. **Target sonno 7-9h** + sleep debt tracking (Watson 2015, Mah 2011)
4. **Guardrail nutrizione in chat**: rifiutare consigli su diete/integratori, rinviare a specialista (Maughan IOC 2018)

### Priorità P2 — personalizzazione utente

5. **PAR-Q+ nell'onboarding** come step pre-piano (Warburton 2011, Riebe 2015)
6. **Checkbox patologie → adatta piani**: diabete, ipertensione, obesità, cardio (Colberg 2016, Pescatello 2004)
7. **Differenziazione master 50+**: ridurre frequenza HIIT, allungare recovery (ACSM Chodzko-Zajko 2009)
8. **Campo ciclo/LEA opzionale** per donne + rilevatore red flag RED-S (Mountjoy 2023, Elliott-Sale 2020)

### Priorità P3 — engagement & precisione

9. **Single-session spike detection** (Johansen 2025) — più predittivo del volume settimanale
10. **Tono SDT autonomia-supportive** esplicito nel prompt (Teixeira 2012)
11. **Open-goal alternative** nei suggerimenti per utenti sedentari (Swann 2022)
12. **Modalità riabilitazione** con Silbernagel pain-monitoring 5/10 per tendinopatie
13. **Suggerimento cadenza ≥165ppm** se utente < soglia (Heiderscheit 2011)
14. **Ranking recovery modalities** nel feedback post-sessione (Dupuy 2018)

### Priorità P4 — advanced / integrazioni

15. **Tapering automatico** se gara in 2 settimane (Bosquet 2007)
16. **Campo condizioni ambientali** + contestualizzazione FC (ACSM Sawka 2007)
17. **HRV-guided training** come feature premium via HealthKit/Garmin (Plews 2013)
18. **Tolleranza ±10% su FC da wearable** nel prompt coach (Mühlen INTERLIVE 2021)
19. **Behavior change theory COM-B** nei prompt chat (Fu 2024, Michie 2011)

---

## Come citare questo tool in un contesto clinico

Il coach **non è un dispositivo medico**. È una PWA personale basata su:
- Regole di sicurezza da linee guida ACSM/ECSS
- Scale validate (Borg RPE, Silbernagel pain-monitoring)
- LLM generalista (Gemini 2.0 Flash) con prompt engineering strutturato

Per uso clinico o in popolazioni a rischio, integrare con professionista qualificato.
