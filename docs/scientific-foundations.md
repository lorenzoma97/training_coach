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

## Mapping rapido: regola del coach → paper

| Regola hardcoded in `SAFETY` | Paper di riferimento |
|---|---|
| `weeklyVolumeIncreaseMaxPct: 10` | Buist 2008, Nielsen 2014, Johansen 2025 (da ripesare in v2) |
| `restDaysMinPerWeek: 2` | Principio generale di supercompensazione — no paper singolo, review Seiler 2010 |
| `beginnerRunCapMinutesPerSession: 25` | ACSM guidelines 2021 + Nielsen 2014 |
| `painStopThreshold: 3` (scala 0-4) | Silbernagel 2007 (soglia più conservativa della loro 5/10) |
| `rpeEasySessionCap: 6` su Z2 | Foster 2001, Haddad 2017 — RPE >6 = zona soglia, non Z2 |
| `z2UpperPct: 0.75` FCmax | Seiler 2010, Stöggl/Sperlich 2014 |
| `sleepFatigueRedFlag` combo | Meeusen 2013 (ECSS/ACSM), Saw 2016 |
| `maxHRFormula: 208 - 0.7 * age` | Tanaka 2001 |

---

## Gap e roadmap v2

Aree in cui il coach può migliorare integrando evidenza più recente:

1. **Single-session spike detection** (Johansen 2025) — più predittivo del volume settimanale
2. **HRV integration** (Plews 2013, Buchheit 2014) — via Garmin/Apple Health API
3. **PAR-Q+ nell'onboarding** (Warburton 2011) — screening pre-esercizio
4. **Modalità riabilitazione** con Silbernagel pain-monitoring esplicito per tendinopatie
5. **Open-goal alternative** nei suggerimenti per utenti sedentari (Swann 2022)
6. **Behavior change theory** nei prompt chat (COM-B, self-determination) — Fu 2024
7. **HRV-guided training** come feature premium (Plews 2013)

---

## Come citare questo tool in un contesto clinico

Il coach **non è un dispositivo medico**. È una PWA personale basata su:
- Regole di sicurezza da linee guida ACSM/ECSS
- Scale validate (Borg RPE, Silbernagel pain-monitoring)
- LLM generalista (Gemini 2.0 Flash) con prompt engineering strutturato

Per uso clinico o in popolazioni a rischio, integrare con professionista qualificato.
