# Template per generare programmi multi-settimanali compatibili col Coach App

Copia tutto questo file nella conversazione con Claude (es. Claude.ai Opus 4.7 deep search) insieme al tuo contesto specifico (goal, sport, settimane, equipment disponibile, eventuali infortuni).

Chiedi a Claude di:
1. Scrivere il piano in **markdown libero** nella prima parte del file (narrative): glossario, warm-up dettagliati, tabelle riepilogative, esecuzione passo-passo, errori comuni, varianti, fonti scientifiche. Lunghezza libera, come faresti per una scheda professionale.
2. Aggiungere alla fine il blocco **JSON strutturato** (machine-readable) seguendo lo schema sotto. Il Coach App parsera questo blocco per generare automaticamente la settimana corrente nel TodayTab.

---

## Schema JSON atteso (alla fine del file dopo la narrative)

Il blocco DEVE essere racchiuso esattamente in code-fence ```json:

````markdown
## ⚙ Programma strutturato (machine-readable, NON modificare)

```json
{
  "metadata": {
    "title": "Ritorno Calcio - 5 settimane",
    "goal": "ritorno alla performance post-infortunio polpaccio",
    "sport": "calcio",
    "weeks_total": 5,
    "start_date": "2026-05-26",
    "generated_at": "2026-05-25",
    "generated_by": "claude opus 4.7 deep search"
  },
  "phases": [
    {
      "name": "Attivazione",
      "weeks": [1, 2],
      "focus": "base intermittente, forza esplosiva, tecnica",
      "rpe_target_min": 6,
      "rpe_target_max": 7.5,
      "notes": "No sprint massimali in questa fase (max 85%)"
    },
    {
      "name": "Condizionamento",
      "weeks": [3, 4],
      "focus": "RSA, HIIT, pliometria avanzata, CoD",
      "rpe_target_min": 7.5,
      "rpe_target_max": 8.5,
      "notes": "Sprint 90-100%"
    },
    {
      "name": "Re-performance",
      "weeks": [5, 5],
      "focus": "agility reattiva, RSA piena, simulazione partita",
      "rpe_target_min": 8.5,
      "rpe_target_max": 9.5,
      "notes": "Intensità di picco, volume stabile vs S4"
    }
  ],
  "weeks": [
    {
      "week": 1,
      "notes": "Adattamento, niente sovraccarichi",
      "sessions": [
        {
          "day": "lun",
          "type": "forza_gambe",
          "duration_min": 73,
          "notes_text": "Tecnica palla 20 min in coda",
          "setup_spatial": null,
          "exercises": [
            {
              "id": "goblet-squat-kettlebell",
              "name": "Squat Goblet con kettlebell",
              "pattern": "squat",
              "equipment": ["kettlebell"],
              "sets": 3,
              "reps_min": 10,
              "reps_max": 10,
              "rpe_target": 6,
              "rest_sec": 90,
              "tempo_eccentrico_sec": null,
              "pause_sec": null,
              "variants": [],
              "technique": null,
              "guidance": null
            },
            {
              "id": "deadlift-romanian-dumbbell",
              "name": "RDL con manubri",
              "pattern": "hinge",
              "equipment": ["dumbbell"],
              "sets": 3,
              "reps_min": 8,
              "reps_max": 8,
              "rpe_target": 7,
              "rest_sec": 90,
              "tempo_eccentrico_sec": 3,
              "pause_sec": null,
              "variants": [],
              "technique": null,
              "guidance": null
            }
          ],
          "intervals": []
        },
        {
          "day": "mer",
          "type": "corsa",
          "duration_min": 60,
          "notes_text": "HIIT 4x4min protocol Helgerud 2007",
          "exercises": [],
          "intervals": [
            { "kind": "warmup", "duration_min": 12, "zone": 2, "reps": null, "recovery_sec": null, "cue": "Jogging progressivo + drill" },
            { "kind": "main", "reps": 3, "duration_min": 4, "zone": 4, "recovery_sec": 180, "cue": "90-95% HRmax sostenuto" },
            { "kind": "cooldown", "duration_min": 5, "zone": 1, "reps": null, "recovery_sec": null, "cue": "Passo lento" }
          ]
        },
        {
          "day": "ven",
          "type": "forza_gambe",
          "duration_min": 60,
          "notes_text": "Sprint sub-massimali + pliometria base",
          "exercises": [
            {
              "id": "sprint-linear-progressive",
              "name": "Sprint lineari sub-massimali 20-30m",
              "pattern": "sprint",
              "equipment": ["bodyweight"],
              "sets": 6,
              "reps_min": 1,
              "reps_max": 1,
              "rpe_target": 8,
              "rest_sec": 90,
              "variants": ["20m al 80%", "30m al 85%"],
              "technique": null,
              "guidance": null
            }
          ],
          "intervals": []
        },
        {
          "day": "dom",
          "type": "sport",
          "duration_min": 50,
          "notes_text": "SSG 4v4 con regole intensity-up: max 2 tocchi, gol da sotto porta",
          "setup_spatial": "Campo 20x25m, porte piccole 2m",
          "exercises": [
            {
              "id": "ssg-4v4-football",
              "name": "Small-Sided Game 4v4",
              "pattern": "ssg",
              "equipment": ["bodyweight"],
              "sets": 3,
              "reps_min": 1,
              "reps_max": 1,
              "rpe_target": 7,
              "rest_sec": 240,
              "variants": ["Se non hai compagni: 30min tecnica + drill CoD coni"],
              "technique": null,
              "guidance": null
            }
          ],
          "intervals": []
        }
      ]
    }
  ],
  "tracking_metrics": [
    {
      "id": "cmj_height_cm",
      "name": "CMJ altezza",
      "unit": "cm",
      "frequency": "weekly",
      "notes": "Misura con app My Jump 2, ogni lunedi pre-allenamento"
    },
    {
      "id": "fc_riposo_bpm",
      "name": "FC riposo mattutina",
      "unit": "bpm",
      "frequency": "daily",
      "notes": "Compila in DailyCheck"
    },
    {
      "id": "sprint_decrement_pct",
      "name": "Sprint Decrement RSA",
      "unit": "%",
      "frequency": "weekly",
      "notes": "Cronometra 1° e 6° sprint, target < 5%"
    }
  ]
}
```
````

---

## Note importanti per Claude (incollare nella request)

### Campo `id` per gli esercizi

Per ogni esercizio, prova a usare un `id` slug stabile in kebab-case. Esempi di id già nel catalog del coach app (113+ esercizi):

**Forza compound**: `back-squat-barbell`, `front-squat-barbell`, `goblet-squat-kettlebell`, `dumbbell-squat`, `bulgarian-split-squat-dumbbell`, `bulgarian-split-squat-bodyweight`, `deadlift-conventional-barbell`, `deadlift-sumo-barbell`, `deadlift-romanian-barbell`, `deadlift-romanian-dumbbell`, `bench-press-flat-barbell`, `bench-press-flat-dumbbell`, `bench-press-incline-barbell`, `barbell-row-bent-over`, `dumbbell-row-bent-over`, `military-press-standing-barbell`, `seated-shoulder-press-dumbbell`, `pull-up-bodyweight`, `chin-up-bodyweight`

**Accessori**: `lunge-walking-dumbbell`, `step-up-dumbbell`, `glute-bridge-bodyweight`, `hip-thrust-barbell`, `face-pull-cable`, `lateral-raise-dumbbell`, `bicep-curl-dumbbell`, `tricep-extension-dumbbell`

**Core**: `plank-front-bodyweight`, `side-plank-bodyweight`, `dead-bug-bodyweight`, `bird-dog-bodyweight`, `pallof-press-band`, `copenhagen-plank`, `nordic-hamstring-curl`

**Plyometric**: `box-jump`, `broad-jump`, `depth-jump`, `lateral-bound-bodyweight`, `pogo-jump-bodyweight`, `jump-squat-bodyweight`, `jumping-lunge-bodyweight`

**Sport-specific (agility/sprint/RSA/SSG/reactive)**: `t-test-agility`, `pro-agility-5-10-5`, `shuttle-505-test`, `mirror-drill-reactive`, `go-no-go-reactive`, `compass-drill-reactive`, `sprint-linear-progressive`, `rsa-linear-30m`, `rsa-shuttle-15-15`, `ssg-4v4-football`, `ssg-1v1-football`

### Esercizi nuovi (non in lista sopra)

Se devi prescrivere un esercizio NON nella lista sopra:
1. Inventa un `id` in kebab-case (es. `"reverse-nordic-curl"`, `"farmer-walk-kettlebell-heavy"`)
2. Compila SEMPRE i campi `name`, `pattern`, `equipment`, `technique`, `guidance` (5 bullet: Setup, Esecuzione, Respirazione, Errori comuni, Sicurezza)
3. Il Coach App rilevera l'esercizio nuovo e lo aggiungera automaticamente al catalog personalizzato dell'utente

### Patterns disponibili

`squat`, `hinge`, `lunge`, `horizontal_push`, `vertical_push`, `horizontal_pull`, `vertical_pull`, `carry`, `core_antiext`, `core_antirot`, `plyometric`, `isometric`, `mobility`, `agility`, `reactive`, `sprint`, `rsa`, `ssg`

### Equipment tags disponibili

`bodyweight`, `dumbbell`, `barbell`, `kettlebell`, `band`, `machine`, `cable`, `trx`, `bench`, `pullup_bar`, `box`

### Type sessione disponibili

`corsa`, `forza_gambe`, `forza_upper`, `sport`, `mobilita`

### Day labels

`lun`, `mar`, `mer`, `gio`, `ven`, `sab`, `dom`

### Cardio intervals — kind disponibili

`warmup`, `main`, `cooldown`, `repetition`, `recovery`

### Validità JSON

Il blocco JSON deve essere VALIDO. Numeri come numeri (non stringhe), null per campi opzionali assenti, array vuoti `[]` per liste vuote.

---

## Esempi di prompt da dare a Claude

```
Genera un programma di [N] settimane per [SPORT/OBIETTIVO] usando il template
allegato.

Mio contesto:
- Eta: [eta]
- Peso: [kg]
- Sport principale: [calcio/padel/tennis/...]
- Goal: [es. "ritorno alla performance dopo infortunio polpaccio"]
- Frequenza: [N] sedute/settimana
- Equipment disponibile: [bilanciere, manubri, kettlebell, panca, pullup bar, ...]
- Eventuali infortuni / aree dolorose: [polpaccio sx storico, ...]
- Livello: [intermediate/advanced]

Scrivi prima il piano in markdown narrativa completa (glossario, WU dettagliato,
esecuzione passo-passo, errori comuni, fonti scientifiche, tabelle riepilogative).
Poi alla fine inserisci il blocco JSON strutturato secondo lo schema fornito.

Rispetta la sintassi JSON e usa id esercizi della lista quando possibile.
Per esercizi nuovi compila SEMPRE name, pattern, equipment, technique, guidance.
```
