# Migration 2026-05-18 — Data Cleanup Tier 1

## Scope

Rimozione di campi UI raccolti ma **mai usati** da nessun coach module (audit "data utilization" — 51% campi low-impact).

## Approccio: backward-compatible, no breaking changes

- I campi **NON sono rimossi dal type/schema** — solo dall'UI form di raccolta.
- Workout / profili esistenti con questi campi restano leggibili (campi extra ignorati silenziosamente da Zod parse).
- Migration localStorage NON necessaria: nessun consumer chiama questi campi, quindi la loro presenza/assenza non rompe nulla.

## Campi rimossi dall'UI

### Workout (corsa) — `DiaryApp.tsx` WORKOUT_TYPES "corsa"
- `durata_corsa` — "Tempo Corsa Effettivo" (redundant con `durata_totale`)
- `passo_frazioni` — "Passo Frazioni Veloci" (no consumer; cadenza/zone bastano)
- `scarpe` — "Scarpe" (knowledge chunk dice esplicitamente "nessuna regola coach")
- `superficie` — "Superficie" (no consumer)

### Workout (sport) — `DiaryApp.tsx` WORKOUT_TYPES "sport"
- `match_type` — "Tipo" (già implicito nello "Sport" subtype: es. "Calcio (Partita)" vs "Calcio (Allenamento)")

### Profile (`OnboardingWizard.tsx`)
- `menstrualCycle.contraception` — raccolto, mai usato
- `menstrualCycle.lastPeriodStart` — raccolto, mai usato (potrebbe servire in futuro per ciclicità Elliott-Sale 2020 ma non implementato)
- `menstrualCycle.avgCycleLengthDays` — idem

`menstrualCycle.enabled` resta (usato per detection RED-S amenorrhea da daily check).

## Campi NON rimossi (audit pre-delete ha trovato references)

- `tut_sec`, `rest_sec`, `rir` (ExerciseSet): 4 test references. Da rivedere in sessione dedicata.
- `failureReason` (ExercisePerformance): 3 test references. Da rivedere.
- `wearableLastSync` (UserProfile): planValidator commento + test. Da rivedere.

## Future opzionali

- Step successivo: rimuovere anche dal type/schema (richiede migration localStorage per pulire user data esistenti). Per ora data theatre eliminato a livello UI è sufficiente.
- Aggiornare knowledge chunk `chunks.ts` biomeccanica corsa per riflettere assenza scarpe/superficie da diario.
