# Fondamenti scientifici del coach

Questo documento mappa ogni regola e comportamento del coach AI a **paper peer-reviewed** di riferimento. Per ogni area indichiamo:
- cosa fa il coach nel codice
- il paper/consenso che lo supporta (o lo mette in discussione)
- dove è implementato nel repo

Ultimo aggiornamento ricerca: 2026-04-15 (fix safety rules: spike-detection, pain 3-livelli, sonno <7h×3gg, rest-days age-tiered).

---

## 1. Progressione del carico — la "regola del 10%" non è un dogma

**Cosa fa il coach**: in [safetyRules.ts](../src/lib/coach/safetyRules.ts) il prompt impone `weeklyVolumeIncreaseMaxPct: 10` come cap di progressione settimanale.

**Evidenza**:

| Paper | Anno | Rivista | Punto chiave |
|---|---|---|---|
| Buist I. et al., *No effect of a graded training program on the number of running-related injuries in novice runners* | 2008 | Am J Sports Med | Nessuna differenza tra progressione +10%/sett e progressione "libera" su 532 neofiti (RCT). La regola del 10% **non** è supportata come misura preventiva. |
| Nielsen RO. et al., *Excessive progression in weekly running distance and risk of running-related injuries* | 2014 | J Orthop Sports Phys Ther | Aumenti >30%/sett aumentano il rischio per specifici infortuni; sotto il 30% l'associazione è debole. |
| Johansen K. et al., *How much running is too much? Identifying high-risk running sessions in a 5200-person cohort study* | 2025 | Br J Sports Med | Paradigm shift: il rischio non è il volume settimanale ma gli **spike della singola sessione** rispetto alla più lunga degli ultimi 30gg. Spike 10-30% → +64% rischio overuse. |
| **Videbæk S. et al., *Incidence of Running-Related Injuries Per 1000h of running in Different Types of Runners: A Systematic Review and Meta-Analysis*** | 2015 | Sports Med | Novice injury rate ~17.8/1000h vs. 7.7/1000h recreational. Programmi novice tipici: **20-30 min/sessione, 2-3×/sett**. |
| Buist I. et al., *Incidence and risk factors of running-related injuries during preparation for a 4-mile recreational running event* | 2010 | Br J Sports Med | Protocolli novice: ~30 min/sessione × 3/sett (~90 min/sett) con progressione +10%/sett. Training error = principale predittore. |
| Piercy KL. et al. (ACSM/HHS), *The Physical Activity Guidelines for Americans* | 2018 | JAMA | Sedentari: partire **150 min/sett moderata** gradualmente. "Start low, go slow". |

**Implicazione per il coach** (aggiornata 2026-04): la regola primaria in `safetyRules.ts` è ora `sessionSpikeMaxPct: 20` — `checkLocalRedFlags` calcola il delta tra la durata della sessione corrente e la sessione più lunga degli ultimi 7gg (ideale 30gg, limite tecnico: abbiamo solo una finestra 7gg in memoria runtime) e segnala warning se spike >+20%. La scelta di 20% è il punto intermedio della banda di rischio 10-30% identificata da Johansen: più basso genererebbe troppi falsi positivi per normale progressione, più alto lascerebbe scoperta metà della banda. Il cap `weeklyVolumeIncreaseMaxPct: 10` rimane come safeguard di secondo livello per neofiti assoluti, con la nota esplicita che non è rigorosamente evidence-based.

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

**Implicazione forte sul coach** (aggiornata 2026-04): le soglie sono state allineate alla **semantica verbale della scala** (0-4: 2=avvertibile, 3=localizzato/riduci, 4=a spillo/STOP). Evitiamo la traduzione numerica 2/4 ↔ 5/10 (non validata: la nostra scala è ordinale-semantica, quella di Silbernagel è VAS lineare). Tre livelli in `safetyRules.ts`:
- `painStopThreshold: 4` → STOP + consulenza specialista (prima era 3, contraddiceva la scala verbale)
- `painWarnThreshold: 3` → riduci intensità
- `painMonitorThreshold: 2` → monitora trend (prima invisibile: falsa sicurezza)

Il principio Silbernagel (dolore tollerabile se non peggiora e rientra a baseline entro 24h) è espresso nel prompt in termini qualitativi, non tramite mapping numerico cross-scala.

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
| **Fullagar HHK. et al., *Sleep and Athletic Performance: The Effects of Sleep Loss on Exercise Performance, and Physiological and Cognitive Responses to Exercise*** | 2015 | Sports Med | **Review cardinale.** Sleep loss riduce performance sport-specifica, cognizione, tempo di reazione. Restrizione cronica parziale (<6h × 3+ notti) **più dannosa** di singola notte acuta. |
| **Walsh NP. et al., *Sleep and the athlete: narrative review and 2021 expert consensus recommendations*** | 2021 | Br J Sports Med | **Consensus expert 2021.** Atleti: target 7-9h; <7h per ≥3 notti consecutive degrada performance/immunità. Raccomandato uso di **media mobile 7gg** invece di soglie singola-notte. |
| Mah CD. et al., *The effects of sleep extension on the athletic performance of collegiate basketball players* | 2011 | Sleep | **Landmark.** Estendere sonno a ≥10h/notte per 5-7 settimane → sprint più veloci, accuratezza tiri migliore, mood migliore. Dose-risposta positiva al sonno. |
| Watson NF. et al. (AASM/SRS Joint Consensus), *Recommended amount of sleep for a healthy adult* | 2015 | Sleep / J Clin Sleep Med | **Consensus ufficiale.** Adulti 18-60 anni: ≥7h/notte per salute ottimale. <6h cronico → rischio cardiovascolare, metabolico, cognitivo. |
| Vitale KC. et al., *Sleep Hygiene for Optimizing Recovery in Athletes: Review and Recommendations* | 2019 | Int J Sports Med | Linee guida pratiche: regolarità orari, 7-9h minimo, ambiente, caffeina timing. |
| Fox JL. et al., *A Narrative Review of the Impact of Sleep on Athletes* | 2025 | PMC | Review recente su restrizione sonno, monitoraggio, interventi (sleep extension, nap, hygiene). |

**Implicazione per il coach** (aggiornata 2026-04): soglia aggiornata da "≤6h × 2gg" a **"<7h × 3gg"** in `safetyRules.ts` per allinearsi al target AASM (≥7h) e alla raccomandazione Walsh 2021 (≥3 notti consecutive). Il vecchio threshold generava falsi positivi da variabilità weekend. Azione v2 residua: sleep debt cumulativo (differenza target 7.5h vs. reali, sommata su 7gg) + media mobile.

Link: [Fullagar 2015 (Springer)](https://link.springer.com/article/10.1007/s40279-014-0260-0) · [Walsh 2021 BJSM (PubMed)](https://pubmed.ncbi.nlm.nih.gov/33144349/) · [Vitale 2019 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/30665263/) · [Fox 2025 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11779686/)

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
| **Fell J., Williams AD., *The effect of aging on skeletal-muscle recovery from exercise: possible implications for aging athletes*** | 2008 | J Aging Phys Act | Review fondativa: master endurance richiedono recupero inter-sessione più lungo; raccomanda **≥1 giorno separazione hard** e **max 4 sessioni HI/sett**. |
| **Doering TM. et al., *Postexercise Recovery of Skeletal Muscle Damage and Protein Synthesis in Older Men*** | 2016 | Int J Sport Nutr Exerc Metab | Master necessitano **+24-48h extra** vs. giovani per risoluzione muscle damage. |
| Borde R. et al., *Dose-Response Relationships of Resistance Training in Healthy Old Adults: A Systematic Review and Meta-Analysis* | 2015 | Sports Med | Frequenza ottimale forza in anziani: **2d/sett con 48-72h** tra sessioni. |
| Easthope CS. et al., *Effects of a trail running competition on muscular performance and efficiency in well-trained young and master athletes* | 2010 | Eur J Appl Physiol | Recupero neuromuscolare master ~72h vs. ~48h giovani post-endurance event. |

**Implicazione per il coach** (aggiornata 2026-04): giorni riposo minimi ora **age-tiered** in `safetyRules.ts` via `restDaysMinForAge()`:
- **<50 anni**: 2 giorni riposo/sett (baseline)
- **50-64 anni**: 3 giorni riposo/sett (Fell 2008, Doering 2016)
- **≥65 anni**: 3 giorni + max 2 giorni consecutivi allenamento (Chodzko-Zajko ACSM 2009, Borde 2015)

Il prompt `safetyRulesAsPrompt(ctx)` riceve `age` dal profilo utente e inietta automaticamente la regola appropriata. Residuo v2: differenziare volume/frequenza HIIT per fascia età in `planGenerator`.

Link: [ACSM 2009 older adults (PDF)](https://www.bewegenismedicijn.nl/files/downloads/acsm_position_stand_exercise_and_physical_activity_for_older_adults.pdf) · [Chodzko-Zajko 2009 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/19516148/) · [Fell & Williams 2008 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/18212398/) · [Doering 2016 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/26479490/) · [Borde 2015 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/26420238/)

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
| `sessionSpikeMaxPct: 20` **(regola primaria)** | Johansen 2025 (Br J Sports Med) — punto intermedio della banda di rischio 10-30% |
| `weeklyVolumeIncreaseMaxPct: 10` **(safeguard secondario)** | Buist 2008 (regola non evidence-based), Nielsen 2014 |
| `restDaysMinForAge()` age-tiered (2/3/3) | Chodzko-Zajko ACSM 2009 (≥65), Fell & Williams 2008, Doering 2016, Borde 2015 |
| `beginnerRunCapMinutesPerSession: 25` / `beginnerRunCapMinutesPerWeek: 90` | Videbæk 2015 (20-30 min novice), Buist 2010 (~90 min/sett baseline), ACSM/Piercy 2018 |
| `painStopThreshold: 4`, `painWarnThreshold: 3`, `painMonitorThreshold: 2` (scala 0-4) | Allineamento semantica verbale della scala del diario + principio Silbernagel 2007 (tolleranza se non peggiora + return-to-baseline 24h) |
| `rpeEasySessionCap: 6` su Z2 | Foster 2001, Haddad 2017 — RPE >6 = zona soglia, non Z2 |
| `z2UpperPct: 0.75` FCmax | Seiler 2010, Stöggl/Sperlich 2014 |
| `sleepFatigueRedFlag` combo `<7h × 3gg` | Watson AASM 2015 (target ≥7h), Walsh BJSM 2021 (≥3 notti consec.), Fullagar 2015, Saw 2016 |
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

## Gap noti di ancoraggio scientifico (2026-04)

Alcuni valori numerici sono euristiche editoriali senza ancoraggio diretto a un singolo paper. Li documentiamo esplicitamente:

- **`fatigueMin: 8` su scala 0-10**: Saw 2016 e Kellmann 2018 confermano che i questionari soggettivi sono validi, ma non forniscono un cutoff specifico su scala 0-10 (Hooper-Mackinnon usa 1-7 con ≥5/7 come red flag, ≈71%). Scegliamo 8/10 (80%) come compromesso prudente: soglia più alta del cutoff Hooper per evitare falsi positivi da fatica transitoria, ancorata però nella parte alta della scala.
- **Cutoff `restDaysMinMidAge` a 50 anni**: Chodzko-Zajko ACSM 2009 definisce esplicitamente 65+; Fell 2008 e Doering 2016 parlano di "master" senza cutoff numerico (le federazioni usano 35-40). Tanaka-Seals 2008 documenta declino performance ~10%/decade post-40 con accelerazione post-70. 50 è scelta editoriale intermedia tra l'inizio del declino (40) e il cutoff ACSM (65): garantisce tier intermedio senza proliferare fasce. Residuo v2: considerare tier a 55 allineandosi al declino VO2max più marcato.
- **`beginnerMaxRaceDistanceAt8w: 5 km`**: non ancorato a un singolo paper. Coerente con Couch-to-5k standard e ACSM/Piercy 2018 (150 min/sett baseline per sedentari, raggiungibile in 8 sett). Euristica prudenziale.

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

## Estensioni Fase 5 (2026-05-11) — 9 aree paper-backed

Le seguenti sezioni 11-19 estendono il doc con paper peer-reviewed per le 9 aree
target del plan `imperative-wandering-raccoon.md` (P1 critiche + F+J+K+M+N):
A. Resistance training, D. Strength-for-endurance, F. Master/aging,
B. Sleep, C. Nutrizione, J. Recovery, K. Biomeccanica corsa,
M. Wearable HR/HRV validity, N. Ambiente (heat/altitude).

**Totale paper aggiunti**: 56 (Ratamess 2009, Schoenfeld 2017/2019, Grgic 2018,
Refalo 2023, Currier 2023, Rønnestad 2014, Beattie 2014, Blagrove 2018,
Berryman 2018, Fyfe 2014, Schumann 2022, Chodzko-Zajko 2009, Tanaka 2001/2008,
Lepers 2016, Fragala 2019, Borde 2015, Bauer 2013, Izquierdo 2021, Watson 2015,
Fullagar 2015, Mah 2011, Bonnar 2018, Charest 2020, Walker 2009, Maughan 2018,
Thomas 2016, Jäger 2017, Kerksick 2018, Sawka 2007, McCubbin 2020, Dupuy 2018,
Wiewelhove 2019, Leeder 2012, Roberts 2015, Hill 2014, Bishop 2008,
Heiderscheit 2011, Napier 2018, Daoud 2012, Anderson 2020, Schubert 2014,
Malisoux 2020, Nelson 2019, Bent 2020, Dooley 2017, Cosoli 2020, Singh 2018,
Hinde 2021, Armstrong 2007, Périard 2015/2021, Casa 2015, Wilber 2007,
Chapman 2013).

NB: WebFetch è stato negato durante la stesura — link PMID/DOI sono i canonici
noti. Verifica spot consigliata prima di pubblicazione (es. Watson 2015 PMID
26039963, Dupuy 2018 PMC5932411, Roberts 2015 PMC4594298, Refalo 2023 PMID
36622555, Currier 2023 PMID 37127349).

---

### 11. Resistance training — progressione e dosaggio (estensione di §11)

**Cosa fa il coach oggi**: workout types `forza_gambe` (HIIT, esplosiva, massimale, circuito) e `forza_upper` (upper, core, combo) gestiti da `planGenerator.ts`. `strengthValidators.ts` impone progressione carico ≤+10% w/w (Schoenfeld 2017). `safetyRules.ts:SAFETY.weeklyLoadIncreaseMaxPct = 10` come soglia globale. Tracking 1RM tramite `lib/strength/oneRM.ts` (Epley). Mancano in prompt: range espliciti di set/rep/%1RM per fascia di esperienza, volume settimanale per gruppo muscolare, frequenza minima per stimolo.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Ratamess NA. et al. (ACSM), *Progression Models in Resistance Training for Healthy Adults — Position Stand* | 2009 | Position stand fondativo. Novizi: 1-3 set, 8-12 rep, 60-70% 1RM, 2-3x/sett. Intermedi: 3-6 set, 1-12 rep, 70-85%, 3-4x/sett. Avanzati: periodizzazione undulating con 1-12 rep continuum, 4-6x/sett. Progressione carico 2-10% quando l'utente completa 1-2 rep extra del target per 2 sessioni consecutive. | [PMID 19204579](https://pubmed.ncbi.nlm.nih.gov/19204579/) |
| Schoenfeld BJ., Ogborn D., Krieger JW., *Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis* | 2017 | Meta-analisi dose-risposta: ≥10 set/muscolo/settimana massimizzano ipertrofia (vs. <5 set: effetto sub-ottimale). Relazione curvilinea, non lineare oltre ~20 set. | [PMID 27433992](https://pubmed.ncbi.nlm.nih.gov/27433992/) |
| Grgic J. et al., *Effect of Resistance Training Frequency on Gains in Muscular Strength: A Systematic Review and Meta-Analysis* | 2018 | A parità di volume settimanale, frequenza 2-3x/sett per gruppo muscolare > 1x/sett su guadagni di forza (effect size moderato). Implica split su 2+ giorni. | [PMID 29470825](https://pubmed.ncbi.nlm.nih.gov/29470825/) |
| Schoenfeld BJ., Grgic J., Krieger J., *How many times per week should a muscle be trained to maximize muscle hypertrophy? A systematic review and meta-analysis* | 2019 | Frequenza per gruppo muscolare: ≥2x/sett superiore a 1x/sett su ipertrofia quando volume è equiparato. | [PMID 30558493](https://pubmed.ncbi.nlm.nih.gov/30558493/) |
| Refalo MC. et al., *Influence of Resistance Training Proximity-to-Failure on Skeletal Muscle Hypertrophy: A Systematic Review with Meta-analysis* | 2023 | Lavorare a 0-3 RIR (Reps In Reserve) ottimizza ipertrofia; failure assoluto non superiore e aumenta fatigue/recovery cost. | [PMID 36622555](https://pubmed.ncbi.nlm.nih.gov/36622555/) |
| Currier BS. et al., *Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis* | 2023 | Network meta-analysis BJSM: forza ottimale con carichi pesanti (>80% 1RM), ipertrofia robusta in range 30-80% 1RM se vicino a failure. Conferma volume ≥10 set/sett ma con effetto in plateau dopo 20. | [PMID 37127349](https://pubmed.ncbi.nlm.nih.gov/37127349/) |

**Implicazione per il coach** (mapping paper → codice):
- Ratamess 2009 → suggerimento prompt in `systemPrompts.ts` (Pass-2 strength): range per livello — "novizio 8-12 rep @ 60-70%, intermedio 6-12 @ 70-85%, esplosiva 3-5 @ 30-60% high velocity, massimale 1-5 @ 85-100%". **PENDENTE v3.**
- Schoenfeld 2017 → già implementato in `strengthValidators.ts` + `safetyRules.ts:SAFETY.weeklyLoadIncreaseMaxPct`. **IMPLEMENTATO.**
- Schoenfeld 2017 (volume) → regola "MEV 10 set/muscolo/sett, MAV 16-20, MRV ~22" in `planGenerator.ts` Pass-1. **PENDENTE v3.**
- Grgic 2018 + Schoenfeld 2019 → vincolo: se goal ipertrofia/forza, distribuire ogni gruppo su ≥2 sessioni/sett. **PENDENTE v3.**
- Refalo 2023 → suggerimento prompt: RPE/RIR target invece di carico assoluto (RIR 1-3). **PENDENTE v2.**
- Currier 2023 → warning se utente con goal "max strength" lavora cronicamente <70% 1RM. **ROADMAP v3.**

---

### 12. Strength training per endurance — interferenza e periodizzazione

**Cosa fa il coach oggi**: `planGenerator.ts` può schedulare `forza_gambe` per utenti con goal endurance ma **senza enforce** di 2-3 sessioni/sett né separazione temporale obbligatoria da sessione di corsa chiave. Mancano: caratterizzazione heavy vs. plyo, gestione interferenza ordinale, periodizzazione su mesocicli.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Rønnestad BR., Mujika I., *Optimizing strength training for running and cycling endurance performance: A review* | 2014 | Heavy strength (1-5 rep, 85-90% 1RM) 2-3x/sett per ≥8 sett migliora economia 3-8% senza ipertrofia significativa. | [PMID 23914932](https://pubmed.ncbi.nlm.nih.gov/23914932/) |
| Beattie K. et al., *The Effect of Strength Training on Performance in Endurance Athletes* | 2014 | Systematic review: strength concomitante non compromette VO2max, migliora economia e performance 1500m–marathon. | [PMID 24532151](https://pubmed.ncbi.nlm.nih.gov/24532151/) |
| Blagrove RC. et al., *Effects of Strength Training on the Physiological Determinants of Middle- and Long-Distance Running Performance: A Systematic Review* | 2018 | 2-3 sessioni forza/sett per ≥6 sett → running economy 2-8% e/o time-trial. Heavy strength + pliometria prioritari. | [PMID 29249083](https://pubmed.ncbi.nlm.nih.gov/29249083/) |
| Berryman N. et al., *Strength Training for Middle- and Long-Distance Performance: A Meta-Analysis* | 2018 | Effect size moderato (Hedges g ~0.52). Heavy e plyometric > endurance-strength tradizionale. | [PMID 28872271](https://pubmed.ncbi.nlm.nih.gov/28872271/) |
| Fyfe JJ. et al., *Interference between Concurrent Resistance and Endurance Exercise* | 2014 | Interference effect AMPK/mTOR. Mitigazione: separare ≥3-6h, forza prima dell'endurance se stessa sessione. | [PMID 24728927](https://pubmed.ncbi.nlm.nih.gov/24728927/) |
| Schumann M. et al., *Compatibility of Concurrent Aerobic and Strength Training* | 2022 | Update 2022: interferenza dose-dipendente; >5h endurance/sett compromette ipertrofia. <5h compatibile. | [PMID 34757594](https://pubmed.ncbi.nlm.nih.gov/34757594/) |

**Implicazione per il coach**:
- Rønnestad 2014 + Blagrove 2018 → Pass-1 regola: se goal corsa, inserire 2 sessioni `forza_gambe` heavy/sett (3-5 rep @ 85% 1RM). **PENDENTE v2.**
- Beattie 2014 → safety prompt rassicurante "forza heavy non penalizza VO2max". **PENDENTE v2.**
- Berryman 2018 → alternare heavy + plyometric/sett per runner. **PENDENTE v3.**
- Fyfe 2014 → `planValidator.ts`: warning se corsa Z3+ e forza_gambe stessa giornata senza separazione. **PENDENTE v2.**
- Schumann 2022 → `feasibility.ts`: warning interferenza se >5h endurance + goal ipertrofia gambe. **ROADMAP v3.**

---

### 13. Master athletes / aging — volume, recupero, sarcopenia

**Cosa fa il coach oggi**: `safetyRules.ts:restDaysMinForAge(age)` implementa giorni riposo age-tiered. Formula Tanaka HRmax. `safetyRulesAsPrompt(ctx)` inietta nota "≥65 anni: max 2 giorni consecutivi". Manca: differenziazione volume HIIT per fascia, raccomandazione esplicita forza 2x/sett 8-10 gruppi, screening sarcopenia, soglia proteine, gestione caduta/equilibrio.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Chodzko-Zajko WJ. et al. (ACSM), *Exercise and Physical Activity for Older Adults* | 2009 | Position stand ACSM 65+: aerobica 150min mod o 75min vigorosa/sett. Forza 2x/sett 8-10 gruppi (8-12 rep, RPE 5-8). Equilibrio regolare. | [PMID 19516148](https://pubmed.ncbi.nlm.nih.gov/19516148/) |
| Tanaka H. et al., *Age-predicted maximal heart rate revisited* | 2001 | HRmax = 208 − 0.7 × età. Errore standard ridotto vs. "220−età". Indipendente da sesso/livello/etnia. | [PMID 11153730](https://pubmed.ncbi.nlm.nih.gov/11153730/) |
| Tanaka H., Seals DR., *Endurance exercise performance in Masters athletes* | 2008 | Declino ~10% per decade dopo 30-40 anni, accelerazione >70. VO2max + lattate threshold relativo cause primarie. | [PMID 18056103](https://pubmed.ncbi.nlm.nih.gov/18056103/) |
| Lepers R., Stapley PJ., *Master Athletes Are Extending the Limits of Human Endurance* | 2016 | Master ben allenati mantengono livelli competitivi fino a 60-70 anni; declino non lineare (più ripido oltre 75). Forza crolla prima di aerobica. | [PMID 27512371](https://pubmed.ncbi.nlm.nih.gov/27512371/) |
| Fragala MS. et al. (NSCA), *Resistance Training for Older Adults* | 2019 | Forza anziani con 70-85% 1RM è sicura ed efficace; periodizzazione; 2-3x/sett; power training (40-60% 1RM) per prevenzione caduta. | [PMID 31343601](https://pubmed.ncbi.nlm.nih.gov/31343601/) |
| Borde R. et al., *Dose-Response Relationships of Resistance Training in Healthy Old Adults* | 2015 | Dosi ottimali: 70-79% 1RM, 2-3 set, 7-9 rep, 2 d/sett con 48-72h tra sessioni, durata programma 50-53 sett. | [PMID 26420238](https://pubmed.ncbi.nlm.nih.gov/26420238/) |
| Bauer J. et al. (PROT-AGE), *Evidence-based recommendations for optimal dietary protein intake in older people* | 2013 | Soglia proteine anziani: ≥1.0-1.2 g/kg/die sani, 1.2-1.5 g/kg/die se attivi/cronici. 25-30g/pasto. | [PMID 23867520](https://pubmed.ncbi.nlm.nih.gov/23867520/) |
| Izquierdo M. et al. (ICFSR), *International Exercise Recommendations in Older Adults* | 2021 | Consensus: aerobic+resistance+balance+flexibility. Sarcopenia screening SARC-F/forza presa. Power priority cadute. | [PMID 33710585](https://pubmed.ncbi.nlm.nih.gov/33710585/) |

**Implicazione per il coach**:
- Chodzko-Zajko 2009 + Borde 2015 → parzialmente in `safetyRules.ts:restDaysMinForAge`. **IMPLEMENTATO.**
- Tanaka 2001 → formula HRmax age-adjusted. **IMPLEMENTATO.**
- Chodzko-Zajko 2009 (volume aerobic) → regola età ≥65: 150min mod o 75min vigorosa. **PENDENTE v3.**
- Tanaka & Seals 2008 + Lepers 2016 → tarare aspettative weekly report per ≥50. **PENDENTE v3.**
- Fragala 2019 → per ≥65 includere 1 sessione/sett power training. **PENDENTE v3.**
- Borde 2015 → dose 70-79% 1RM, 2-3 set, 7-9 rep, 2x/sett per `age ≥65`. **PENDENTE v2.**
- Bauer 2013 → chat: soglia proteine 1.0-1.2 g/kg/die per ≥65. **PENDENTE v3.**
- Izquierdo 2021 → screening cadute ≥70. **ROADMAP v3.**

---

### 14. Sleep — recupero atletico e performance

**Cosa fa il coach oggi**: il sonno è uno dei tre pilastri di `readinessScoring.ts` con **peso 30/100** (vs HRV 40, soggettivo 20, soreness 10). Componenti `daily.sleep` (ore) e `daily.sleepQ` (qualità multiplicatore). Pipeline Samsung Health `SAMSUNG_SLEEP_HISTORY_KEY` per import oggettivo. Manca: sleep-debt tracking 3gg, suggerimento sleep-extension pre-gara.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Watson NF. et al. (AASM/SRS Consensus), *Recommended Amount of Sleep for a Healthy Adult* | 2015 | Adulti 18-60 anni dovrebbero dormire ≥7h/notte regolarmente. Sotto 7h: deficit cognitivo, immunitario, cardiovascolare. | [PMID 26039963](https://pubmed.ncbi.nlm.nih.gov/26039963/) |
| Fullagar HHK. et al., *Sleep and Athletic Performance* | 2015 | Privazione parziale (4-6h × 2-4 notti) compromette tempo a esaurimento, accuratezza, reaction time. Cronica → cortisol↑, testosterone↓, GH↓. | [PMID 25315456](https://pubmed.ncbi.nlm.nih.gov/25315456/) |
| Mah CD. et al., *Sleep extension and athletic performance of collegiate basketball players* | 2011 | RCT Stanford: 11 cestisti estesi a ≥10h/notte per 5-7 sett. Sprint -0.7s, tiri liberi +9%, 3pt +9.2%, reaction time migliorato. | [PMID 21731144](https://pubmed.ncbi.nlm.nih.gov/21731144/) |
| Bonnar D. et al., *Sleep Interventions Designed to Improve Athletic Performance and Recovery: A Systematic Review* | 2018 | 8 interventi: sleep extension più replicato; nap 20-90 min post-pranzo recupera deficit notte parziale. | [PMID 29352373](https://pubmed.ncbi.nlm.nih.gov/29352373/) |
| Charest J., Grandner MA., *Sleep and Athletic Performance: Impacts on Physical Performance, Mental Performance, Injury Risk, Recovery, Mental Health* | 2020 | Sonno <7h moltiplica rischio infortuni 1.7-2.4x. Sleep banking 5-7gg pre-evento attenua debito acuto. | [PMID 32088053](https://pubmed.ncbi.nlm.nih.gov/32088053/) |
| Walker MP., *Sleep, memory, and emotional regulation* | 2009 | Sonno REM/NREM: consolidamento procedurale (motor learning) e riparazione tissutale via GH-pulse. | [PMID 18929315](https://pubmed.ncbi.nlm.nih.gov/18929315/) |

**Implicazione per il coach**:
- Watson 2015 → soglia 7h in `readinessScoring.ts:209` (`hoursScore=100` se hours≥7). **IMPLEMENTATO.**
- Fullagar 2015 + Bonnar 2018 → peso sleep=30 in `readinessScoring.ts:39`. **IMPLEMENTATO.**
- Mah 2011 → suggerimento sleep extension pre-gara in `taperingRules.ts`. **PENDENTE v2.**
- Charest 2020 → regola overtraining "sonno <7h × 3gg consecutivi" via `checkSleepDebt`. **PENDENTE v2.**
- Bonnar 2018 (nap) → chip in CoachChat. **ROADMAP v3.**
- Walker 2009 → quality multiplier "scarso"=0.4 in `readinessScoring.ts:219`. **IMPLEMENTATO.**

---

### 15. Nutrizione & idratazione

**Cosa fa il coach oggi**: diario raccoglie `daily.meds` (sanitizzato `promptSanitizer.ts`) e `workout.fields.kcal`. Coach applica **guardrail attivo** in `promptModules/nutritionGuardrail.ts` che vieta prescrizione di diete/integratori. Blocco incluso condizionalmente via keyword-match.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Maughan RJ. et al. (IOC Consensus), *Dietary supplements and the high-performance athlete* | 2018 | Solo **5 integratori** con evidenza robusta: caffeina, creatina, beta-alanina, bicarbonato Na, nitrati. | [PMID 29540367](https://pubmed.ncbi.nlm.nih.gov/29540367/) |
| Thomas DT. et al. (ACSM/AND/Dietitians Canada), *Nutrition and Athletic Performance* | 2016 | Macro: CHO 3-12 g/kg/die modulati; proteine 1.2-2.0 g/kg/die; grassi ≥20% energy. | [PMID 26891166](https://pubmed.ncbi.nlm.nih.gov/26891166/) |
| Jäger R. et al. (ISSN), *Protein and exercise* | 2017 | Proteine: 0.4 g/kg/pasto × 4 pasti (~1.6 g/kg/die); finestra post-workout 2-4h; leucina ≥3g/pasto. | [PMID 28642676](https://pubmed.ncbi.nlm.nih.gov/28642676/) |
| Kerksick CM. et al. (ISSN), *ISSN exercise & sports nutrition review update* | 2018 | Timing CHO: 30-60 g/h durante sforzi >60 min; 60-90 g/h con co-ingestione fruttosio >2.5h. | [PMID 30068354](https://pubmed.ncbi.nlm.nih.gov/30068354/) |
| Sawka MN. et al. (ACSM), *Exercise and Fluid Replacement* | 2007 | Idratazione: pre 5-10 mL/kg in 2-4h; durante: deficit max 2% BW; post: 1.25-1.5 L/kg perso. | [PMID 17277604](https://pubmed.ncbi.nlm.nih.gov/17277604/) |
| McCubbin AJ. et al. (Sports Dietitians Australia), *Nutrition for Exercise in Hot Environments* | 2020 | Ad-libitum drinking sufficiente per la maggior parte sforzi <2h in clima temperato. | [PMID 31891914](https://pubmed.ncbi.nlm.nih.gov/31891914/) |

**Implicazione per il coach**:
- Maughan IOC 2018 → guardrail integratori hardcoded in `nutritionGuardrail.ts:9`. **IMPLEMENTATO.**
- Thomas 2016 → range macro hardcoded. **IMPLEMENTATO.**
- Sawka 2007 → idratazione 5-10 mL/kg + deficit 2% red flag. **IMPLEMENTATO.**
- Jäger 2017 → `proteinDistributionTip` in weeklyReport. **PENDENTE v2.**
- Kerksick 2018 → fuel hint 30-60 g CHO/h se `workoutDuration > 60 min`. **PENDENTE v3.**
- McCubbin 2020 → caveat ad-libitum. **PENDENTE v2.**

---

### 16. Recovery modalities — efficacia comparata post-sforzo

**Cosa fa il coach oggi**: workout type `mobilita` come categoria primaria. `MobilityLibrary` (Wave 3.4) cataloga 6 routine. Prompt `recoveryBlock` (`promptModules/recoveryModalities.ts`) attivo quando `lastSessionIntensity === "hard"`.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Dupuy O. et al., *Evidence-Based Approach for Choosing Post-exercise Recovery Techniques* | 2018 | Meta-analisi 99 studi, 9 tecniche. **Massaggio** effect size più ampio (g=0.85). Stretching statico passivo: 0 beneficio. | [PMID 29755363](https://pubmed.ncbi.nlm.nih.gov/29755363/) |
| Wiewelhove T. et al., *Meta-Analysis of Foam Rolling on Performance and Recovery* | 2019 | Effetto piccolo: sprint +0.7%, flessibilità +4%, attenuazione DOMS post-sessione. | [PMID 31024339](https://pubmed.ncbi.nlm.nih.gov/31024339/) |
| Leeder J. et al., *Cold water immersion and recovery from strenuous exercise: meta-analysis* | 2012 | CWI 11-15°C × 11-15 min riduce DOMS a 24h e 48h vs recupero passivo. | [PMID 22260513](https://pubmed.ncbi.nlm.nih.gov/22260513/) |
| Roberts LA. et al., *Post-exercise cold water immersion attenuates acute anabolic signalling and long-term adaptations in muscle to strength training* | 2015 | RCT 12 sett: **CWI post-forza riduce ipertrofia e guadagni di forza**. Attenuazione mTOR/p70S6K. | [PMID 26174323](https://pubmed.ncbi.nlm.nih.gov/26174323/) |
| Hill J. et al., *Compression garments and recovery from exercise-induced muscle damage: meta-analysis* | 2014 | 12 studi. Compressione 12-48h post riduce DOMS (g=0.40), CK, accelera ripristino forza. | [PMID 23757486](https://pubmed.ncbi.nlm.nih.gov/23757486/) |
| Bishop PA. et al., *Recovery from training: a brief review* | 2008 | Tassonomia: immediate/<1h, short-term 1-12h, long-term >12h. Active recovery 10-20 min FC bassa. | [PMID 18438226](https://pubmed.ncbi.nlm.nih.gov/18438226/) |

**Implicazione per il coach**:
- Dupuy 2018 → ranking hardcoded `recoveryModalities.ts:9-13`. **IMPLEMENTATO.**
- Wiewelhove 2019 → modalità "moderate" foam rolling 8-10 min. **IMPLEMENTATO.**
- Leeder 2012 → parametri CWI "11-15°C × 11-15 min". **IMPLEMENTATO.**
- Roberts 2015 → WARNING "CWI post-forza attenua adattamenti". **IMPLEMENTATO.**
- Hill 2014 → compression 12-48h. **IMPLEMENTATO.**
- Bishop 2008 → active recovery 10-20 min FC bassa. **IMPLEMENTATO.**
- Ranking dinamico per workoutType (corsa hard → CWI ok; forza_gambe hard → evita CWI). **ROADMAP v3.**

---

### 17. Biomeccanica corsa — cadenza, scarpe e foot strike

**Cosa fa il coach oggi**: il diario corsa raccoglie campi `cadenza` (spm), `scarpe`, `superficie` come metadata libero. Nessun validator attivo cross-controlla questi valori. La biomeccanica resta input descrittivo, non leva di coaching.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Heiderscheit BC et al., *Effects of step rate manipulation on joint mechanics during running* | 2011 | +5-10% step rate vs cadenza preferita riduce carico anca/ginocchio (-20% energy absorption ginocchio). Razionale 170-180 spm per PFP/ITBS. | [PMID 21131862](https://pubmed.ncbi.nlm.nih.gov/21131862/) |
| Napier C et al., *Kinetic risk factors of running-related injuries in female recreational runners* | 2018 | Vertical loading rate + impact peak marker più consistenti per RRI; intervento cadenza riduce loading rate 18-20%. Minimaliste non riducono RRI. | [PMID 29055178](https://pubmed.ncbi.nlm.nih.gov/29055178/) |
| Daoud AI et al., *Foot strike and injury rates in endurance runners: a retrospective study* | 2012 | 52 corridori NCAA Harvard: RFS injury rate ~2x vs FFS/MFS. Studio retrospettivo, non causale. | [PMID 22318203](https://pubmed.ncbi.nlm.nih.gov/22318203/) |
| Anderson LM et al., *What are the benefits and risks associated with changing foot strike pattern during running? A systematic review and meta-analysis* | 2020 | 53 studi: switch RFS→FFS riduce loading rate ginocchio ma aumenta carico caviglia/Achille; nessuna riduzione RRI. Cadenza > foot strike change. | [PMID 31845152](https://pubmed.ncbi.nlm.nih.gov/31845152/) |
| Schubert AG et al., *Influence of stride frequency and length on running mechanics: a systematic review* | 2014 | +5-10% step rate riduce loading senza penalizzare VO2 (<3%). Sweet spot 170-180 spm recreational. | [PMID 24587864](https://pubmed.ncbi.nlm.nih.gov/24587864/) |
| Malisoux L et al., *Shoe cushioning influences the running injury risk according to body mass: RCT 848 recreational runners* | 2020 | Cushioning soft vs hard non differisce in injury rate complessivo, ma interagisce con BW (>71 kg → soft protettivo). | [PMID 31877062](https://pubmed.ncbi.nlm.nih.gov/31877062/) |

**Implicazione per il coach**:
- Heiderscheit 2011 + Schubert 2014 → validator soft in `safetyRules.ts` cadenza <160 spm + sintomi ginocchio. **PENDENTE v3.**
- Daoud 2012 + Anderson 2020 → guardrail hardcoded: NO conversione foot strike pattern. **PENDENTE v2.**
- Malisoux 2020 → suggerimento refresh scarpa basato su BW + km accumulati. **PENDENTE v3.**
- Napier 2018 → copy onboarding: minimaliste richiedono 12+ settimane transizione. **PENDENTE v2.**

---

### 18. Wearable / FC validity — accuratezza optical wrist HR e HRV

**Cosa fa il coach oggi**: import Samsung Health (Wave 3.2) popola `fc_media`/`fc_max`. Wave 3.4 estende a HRV per readiness. Validator FC age-tiered in `safetyRules.ts` flagga deviazioni `fc_max > Tanaka_pred + 15 bpm` come probabile artefatto wearable.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Nelson BW, Allen NB, *Accuracy of consumer wearable heart rate measurement during an ecologically valid 24-hour period* | 2019 | Validation 24h: ±3 bpm a riposo, MAPE 5-8% walking, errori >10% durante HIIT. Wrist-based sottostima HR di picco. | [PMID 30855232](https://pubmed.ncbi.nlm.nih.gov/30855232/) |
| Bent B et al., *Investigating sources of inaccuracy in wearable optical heart rate sensors* | 2020 | Skin tone scuri (Fitzpatrick V-VI) → errore +15% MAE; movimento polso → degrado accuracy 2-3x vs running. | [PMID 32047863](https://pubmed.ncbi.nlm.nih.gov/32047863/) |
| Dooley EE et al., *Estimating accuracy at exercise intensities: comparative study of self-monitoring HR wearables* | 2017 | 4 wearable consumer vs ECG: accuracy HR cala linearmente con intensità (r=0.92 riposo → r=0.67 VO2max). | [PMID 28288955](https://pubmed.ncbi.nlm.nih.gov/28288955/) |
| Cosoli G et al., *Wrist-worn and chest-strap wearable devices: systematic review on accuracy* | 2020 | 19 studi: chest strap MAE <2 bpm; wrist 3-5 bpm riposo, 8-15 bpm dynamic. Chest strap per zone training, wrist per trend. | [DOI 10.1016/j.measurement.2020.108247](https://doi.org/10.1016/j.measurement.2020.108247) |
| Singh N et al., *Heart rate variability: an old metric with new meaning in the era of using mHealth technologies* | 2018 | Morning resting RMSSD via wrist sensor marker affidabile (ICC 0.85-0.92 vs ECG); HRV durante esercizio unreliable. | [PMID 30310690](https://pubmed.ncbi.nlm.nih.gov/30310690/) |
| Hinde K et al., *Wearable devices suitable for monitoring twenty-four hour heart rate variability* | 2021 | Polar H10 gold standard; wrist Garmin/Fitbit affidabili solo HRV notturna. Trust score context-aware. | [PMID 33806595](https://pubmed.ncbi.nlm.nih.gov/33806595/) |

**Implicazione per il coach**:
- Dooley 2017 + Nelson 2019 → `safetyRules.ts:HR_VALIDATOR` flag artefatto wearable >+15 bpm. **IMPLEMENTATO.**
- Bent 2020 → campo `skin_tone` opzionale onboarding (Fitzpatrick I-VI) per calibrare confidence score. **ROADMAP v3.**
- Cosoli 2020 → disclaimer in `sessionFeedback.ts` per `intensita_percepita >= 8/10`. **PENDENTE v2.**
- Singh 2018 + Hinde 2021 → HRV readiness usa SOLO morning resting RMSSD wrist. **IMPLEMENTATO** (readinessScoring.ts).

---

### 19. Ambiente — heat stress e altitude

**Cosa fa il coach oggi**: **nulla è tracciato attualmente**. Il diario corsa non ha `temperatura_ambiente`, `umidita_relativa`, `WBGT` né `altitudine`. Blind spot noto (Bologna estate 35°C + 70% RH, uso in vacanza/quota). Tutta l'area è **pendente roadmap v3**.

**Evidenza scientifica**:

| Paper | Anno | Sintesi | Link |
|---|---|---|---|
| Armstrong LE et al. (ACSM), *Exertional heat illness during training and competition* | 2007 | WBGT metrica autoritativa. Rischio >28°C WBGT; sospensione >32°C in non-acclimatati. FC +1 bpm per °C oltre 25°C. | [PMID 17473783](https://pubmed.ncbi.nlm.nih.gov/17473783/) |
| Périard JD et al., *Adaptations and mechanisms of human heat acclimation* | 2015 | 10-14 gg esposizione progressiva 35-40°C → plasma volume +10-15%, HR -10 bpm, core temp -0.4°C. | [PMID 25943654](https://pubmed.ncbi.nlm.nih.gov/25943654/) |
| Casa DJ et al. (NATA), *Exertional heat illnesses position statement* | 2015 | Heat illness continuum. Cold-water immersion gold standard cooling (>10°C swing in <15 min). Hydration solo non previene EHS. | [PMID 26381473](https://pubmed.ncbi.nlm.nih.gov/26381473/) |
| Wilber RL, *Application of altitude/hypoxic training by elite athletes* | 2007 | "Live high, train low" 2000-2500m: Hb-mass +3-5%, VO2max +1-3% in 3-4 sett. Acute >2500m → desaturazione, FC riposo +5-10 bpm. | [PMID 17909409](https://pubmed.ncbi.nlm.nih.gov/17909409/) |
| Périard JD et al., *Exercise under heat stress: thermoregulation, hydration, performance implications and mitigation* | 2021 | >30°C ambient: performance -0.3-0.5% per °C oltre 25°C. Pre-cooling +1-3%. Hydration 0.4-0.8 L/h. | [PMID 33760638](https://pubmed.ncbi.nlm.nih.gov/33760638/) |
| Chapman RF, *The individual response to training and competition at altitude* | 2013 | 30-40% "non-responder" anche con LHTL. Serve tracking individuale Hb/ferritina pre-camp. | [PMID 24282206](https://pubmed.ncbi.nlm.nih.gov/24282206/) |

**Implicazione per il coach** (TUTTO ROADMAP v3 — nessun campo ambiente nel diario):
- Armstrong 2007 + Périard 2021 → nuovo campo `condizioni_ambiente` (temp+RH+WBGT). Auto-fetch via Open-Meteo API. **ROADMAP v3.**
- Périard 2015 → prompt `sessionFeedback.ts`: WBGT >28°C → pace -5-8% e FC +5-10 bpm; warning >32°C. **ROADMAP v3.**
- Casa 2015 → `HEAT_ILLNESS_DETECTOR` in `safetyRules.ts`: sintomi + WBGT >28 → escalation cooling/idratazione. **ROADMAP v3.**
- Wilber 2007 + Chapman 2013 → campo `altitudine_sessione_m`; >2000m warning FC riposo elevata primi 3-5gg. **ROADMAP v3** (priorità bassa).

---

## Come citare questo tool in un contesto clinico

Il coach **non è un dispositivo medico**. È una PWA personale basata su:
- Regole di sicurezza da linee guida ACSM/ECSS
- Scale validate (Borg RPE, Silbernagel pain-monitoring)
- LLM generalista (Gemini Flash) con prompt engineering strutturato

Per uso clinico o in popolazioni a rischio, integrare con professionista qualificato.
