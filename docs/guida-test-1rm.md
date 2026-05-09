# Guida: Test 1RM (One Rep Max)

> Last updated: 2026-05-09
> Audience: utente diario-coach che vuole programmazione forza prescrittiva

---

## 1. Cos'è il 1RM e perche serve

Il **1RM (One Rep Max)** e il carico massimo che puoi sollevare per **una sola ripetizione** con tecnica corretta in un dato esercizio.

E la metrica che il coach usa per **prescrivere carichi precisi** in modo personalizzato. Senza 1RM, una prescrizione tipo "Squat 4x8" e generica: con 1RM il coach scrive "Squat 4x8 @70% 1RM" → se il tuo 1RM e 100 kg, sai che devi caricare 70 kg. Niente piu "vado a sensazione".

### Tested vs Estimated
- **1RM tested**: misurato direttamente sul campo (test 1RM o 5RM con Brzycki). Affidabilita massima.
- **1RM estimated**: derivato dal coach via formula Brzycki/Epley a partire dai tuoi workout regolari (es. squat 80 kg x 5 reps RPE 9 → 1RM stimato ~90 kg). Sufficiente per partire, viene aggiornato automaticamente quando registri un PR nel diario.

Il coach **preferisce sempre il 1RM tested** se disponibile. L'estimated viene sovrascritto solo da un altro estimated piu recente, mai da uno piu vecchio del tested.

---

## 2. Lift principali da testare

In ordine di priorita per il coach:

| # | Lift | Pattern | Perche serve |
|---|---|---|---|
| 1 | **Back Squat** (bilanciere) | squat | Base per ogni programmazione gambe (squat, front squat, lunge, leg press derivati) |
| 2 | **Bench Press** (panca piana bilanciere) | horizontal_push | Base spinte orizzontali (panca, dip, push-up zavorrato) |
| 3 | **Deadlift** convenzionale | hinge | Base catena posteriore (RDL, hip thrust, good morning) |
| 4 | Military Press (overhead) | vertical_push | Optional, se fai upper dedicato |
| 5 | Pull-up zavorrato | vertical_pull | Optional, se fai upper dedicato. Se non riesci pull-up bodyweight, salta. |

**Minimo consigliato**: 1RM su Squat + Bench + Deadlift. Se programmi solo upper, anche solo Bench + un push/pull e sufficiente per partire.

---

## 3. Protocollo test diretto (5RM, da cui Brzycki estima 1RM)

> **Perche 5RM e non 1RM puro**: testare 1 rep al massimale aumenta drasticamente il rischio infortunio (massima compressione spinale, breakdown tecnico al limite). Il **5RM con stima Brzycki** ha precisione >95% rispetto al 1RM testato, con rischio molto inferiore. E lo standard usato dalla maggior parte dei coach forza amatoriali.

### Safety disclaimer (leggere)
- **Serve uno spotter** per Squat e Bench (rack di sicurezza con safety pin se sei solo). MAI fare Bench massimale senza spotter o safety bar.
- **NO test se infortunio attivo** nella zona muscolare coinvolta (lombare, spalla, ginocchio).
- **Riscaldamento generale obbligatorio** (10 min di mobility + cardio leggero) prima dei warm-up set specifici.
- Se durante un set la **tecnica si rompe** (ginocchia che cedono dentro, lombare che si flette, spalla che si protrae), **stop immediato**. Quel set non conta.
- **Mai testare 2 lift principali nella stessa seduta** (es. squat + deadlift). Distanza minima 48-72h tra test diversi.

### Riscaldamento (set di avvicinamento)

Esempio per Back Squat se il target del set di test e ~80 kg:

| Set | Peso | Reps | Note |
|---|---|---|---|
| 1 | bilanciere vuoto (20 kg) | 10 | Ranging, focus tecnica |
| 2 | 50% target = 40 kg | 8 | Velocita controllata |
| 3 | 60% target = 48 kg | 5 | Inizio "feel" del peso |
| 4 | 70% target = 56 kg | 3 | Esplosivo |
| 5 | 80% target = 64 kg | 2 | Singola spinta |
| **TEST** | **80 kg** | **5** | RPE 9 (1 RIR) |

Riposo tra warm-up set: 90-120s. Riposo prima del set di test: **3-5 min**.

### Set di test
- Carica un peso che pensi di poter completare per **5 reps a RPE 9** (=ti rimane 1 rep in tasca).
- Esegui le 5 reps con tecnica perfetta.
- **Risultato OK**: completi 5 reps con buona forma → usa quel peso per stima Brzycki.
- **Peso troppo basso**: completi 6+ reps facilmente (RPE ≤8) → il peso era leggero, riprova **fra 7 giorni** con +5%.
- **Peso troppo alto**: completi solo 3-4 reps o tecnica si rompe → riprova **fra 7 giorni** con -5%. Non insistere lo stesso giorno.

### Formula Brzycki

```
1RM = peso × 36 / (37 - reps)
```

**Esempio numerico**:
- Squat 80 kg × 5 reps → 1RM = 80 × 36 / (37-5) = 80 × 36 / 32 = **90 kg**
- Bench 70 kg × 5 reps → 1RM = 70 × 36 / 32 = **78.75 kg** (arrotonda a 80)
- Deadlift 100 kg × 5 reps → 1RM = 100 × 36 / 32 = **112.5 kg** (arrotonda a 112.5)

Tabella rapida per reps ≠ 5:

| Reps eseguite | Moltiplicatore (1RM = peso × X) |
|---|---|
| 3 | 1.058 |
| 4 | 1.091 |
| 5 | 1.125 |
| 6 | 1.161 |
| 8 | 1.241 |
| 10 | 1.333 |

(Brzycki perde precisione sopra le 10 reps. Per 12+ reps, non usare per stima 1RM.)

---

## 4. Come inserire nel app

### Durante l'onboarding
Allo step opzionale **"Test forza"**:
- Bottone **"Faccio il test ora"**: apre form di inserimento 1RM (vedi sotto).
- Bottone **"Lo faro dopo"**: skip. Il coach usera RPE/RIR invece di %1RM finche non inserisci dati.

### Form di inserimento 1RM
Compili:
- **Esercizio** (dropdown da catalogo): es. "Back Squat con bilanciere"
- **Peso** (kg): es. 80
- **Reps** (interi): es. 5 (per stima Brzycki)
- **Data**: default oggi
- **Tested?** (toggle): se hai fatto **1 rep al vero massimale** (raro, sconsigliato senza spotter), spunta `tested = true` e metti `reps = 1`. Altrimenti lascia spento → il sistema applica Brzycki sul valore inserito.

### In qualsiasi momento (post-onboarding)
**Settings → Profilo → "Test 1RM"** [da confermare nome esatto in app] → stesso form. Puoi:
- Aggiungere un nuovo 1RM per un esercizio nuovo
- Aggiornare un 1RM esistente (sovrascrive il precedente, mantenendo storia in `user-1rm-history` per UI trend)

---

## 5. Frequenza ideale

| Scenario | Frequenza re-test |
|---|---|
| Programmazione forza attiva (3+ sedute/settimana) | Ogni **4-6 settimane**, idealmente al termine di un blocco / dopo deload |
| Mantenimento (1-2 sedute/settimana) | Ogni **8-12 settimane** |
| Stop > 4 settimane sull'esercizio | Re-test prima di riprendere programmazione precisa |
| Cambio sostanziale di peso corporeo (>5%) | Re-test (la forza relativa cambia) |

Il coach mostra un **prompt automatico in UI** se un 1RM e piu vecchio di 6 mesi: "1RM Squat acquisito 2026-01-09, considera re-test".

---

## 6. Quando NON fare il test

Skippa o rimanda se:
- **Infortunio attivo** nella catena coinvolta (lombare per squat/deadlift, spalla per bench/press, ginocchio per squat).
- **Affaticamento alto**: HRV basso, sonno scarso (<6h ultime 2 notti), DOMS forte da seduta precedente.
- **Influenza/malattia** nelle ultime 72h.
- **Stress mentale alto** (giornata pesante al lavoro): la concentrazione e parte del set massimale.
- **Niente spotter / niente safety bar** per Squat o Bench → mai. Per Deadlift convenzionale lo spotter non serve (basta lasciar cadere il bilanciere).

In donne: **fase luteale tarda** (giorni 25-28 ciclo) tipicamente con prestazione forza inferiore di 3-7%. Non un divieto, ma evita di interpretare un test "deludente" come stallo se cade in quei giorni.

---

## 7. Cosa fare se skippi il test

Niente panico. Il coach passa a **prescrizione RPE-based**:

- Invece di "Squat 4x8 @70% 1RM" scrive "Squat 4x8 @RPE 8" (=ti restano 2 reps in tasca a fine set).
- Funziona benissimo per ipertrofia e forza generale.
- E **leggermente meno preciso** per programmazione forza pura (powerlifting style, blocchi peaking) dove la % 1RM precisa fa la differenza.
- Genera comunque **stime estimated** automaticamente: dopo 3-4 settimane di registrazione regolare di workout forza con peso+reps+RPE, il coach calcola il tuo 1RM stimato in background e lo mostra in Profilo come "estimated".

Quando vuoi, puoi fare il test in qualsiasi momento da **Settings → Profilo → "Test 1RM"** [da confermare nome esatto in app] e il coach inizia a usare %1RM nelle prescrizioni dalla settimana successiva.

---

## TL;DR operativo

1. **Lift da testare**: Squat, Bench, Deadlift (minimo). Optional: Press, Pull-up.
2. **Protocollo**: 5 set di warm-up scalati, poi 1 set di **5 reps** a RPE 9. Stima 1RM con Brzycki: `peso × 36 / 32`.
3. **Sicurezza**: spotter o safety bar obbligatori per squat/bench. Stop se tecnica si rompe.
4. **Inserisci in app**: Settings → Profilo → Test 1RM. Form: esercizio + peso + reps + data.
5. **Re-test**: ogni 4-6 settimane se programmi forza, ogni 8-12 se mantieni.
6. **Skip OK**: se non vuoi/puoi testare, il coach usa RPE-target. Funziona, e meno preciso ma robusto.
