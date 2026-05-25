# Programma multi-settimanale per Coach App

Sei un coach esperto. Genera un programma di allenamento multi-settimanale per il seguente atleta:

**Profilo**:
- Età: {ETA}
- Peso: {PESO_KG} kg
- Sport principale: {SPORT}
- Obiettivo: {GOAL}
- Settimane: {NUM_SETTIMANE}
- Frequenza: {SEDUTE_PER_SETTIMANA} sedute/settimana
- Equipment: {EQUIPMENT}
- Infortuni / aree dolorose: {INFORTUNI}
- Livello: {LIVELLO}

---

## Formato output richiesto

Il file deve avere DUE parti, in quest'ordine:

**PARTE 1 — Narrative markdown libera**

Scrivi un piano completo in markdown professionale. Includi:
- Struttura generale (tabella fasi + focus + RPE target + intensità)
- Glossario tecnico (CMJ, DJ, RSA, HIIT, CoD, RPE, vVO2max, HRmax — definisci ciò che usi)
- Warm-up dettagliato (jogging + mobilità dinamica + attivazione specifica) con cue + distanze
- Per ogni esercizio: esecuzione passo-passo (5-7 step), errori comuni, varianti facilitanti/avanzate
- Schema seduta riepilogativo con tempi stimati
- Tabelle riepilogative (piano settimanale per fase, volume/intensità progressiva, segnali stop, attrezzatura, tracking metriche)
- Fonti scientifiche (paper peer-reviewed con DOI o citazione formale)

Stile: tono coach esperto, italiano, denso di info utili, tabelle markdown dove pertinente.

**PARTE 2 — Blocco JSON strutturato (OBBLIGATORIO, parser-friendly)**

Alla fine del file, inserisci il blocco JSON sotto. È machine-readable: deve essere JSON VALIDO (numeri come numeri, `null` per campi opzionali assenti, array vuoti `[]` per liste vuote).

````markdown
## ⚙ Programma strutturato

```json
{
  "metadata": {
    "title": "...",
    "goal": "...",
    "sport": "calcio",
    "weeks_total": 5,
    "start_date": "2026-05-26",
    "generated_at": "2026-05-25",
    "generated_by": "claude opus 4.7"
  },
  "phases": [
    {
      "name": "Attivazione",
      "weeks": [1, 2],
      "focus": "...",
      "rpe_target_min": 6,
      "rpe_target_max": 7.5,
      "notes": "..."
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
            }
          ],
          "intervals": []
        },
        {
          "day": "mer",
          "type": "corsa",
          "duration_min": 60,
          "notes_text": "HIIT 4x4min Helgerud 2007",
          "exercises": [],
          "intervals": [
            { "kind": "warmup", "duration_min": 12, "zone": 2, "reps": null, "recovery_sec": null, "distance_km": null, "cue": "Jogging progressivo" },
            { "kind": "main", "reps": 3, "duration_min": 4, "zone": 4, "recovery_sec": 180, "distance_km": null, "cue": "90-95% HRmax" },
            { "kind": "cooldown", "duration_min": 5, "zone": 1, "reps": null, "recovery_sec": null, "distance_km": null, "cue": "Passo lento" }
          ]
        }
      ]
    }
  ],
  "tracking_metrics": [
    { "id": "cmj_height_cm", "name": "CMJ altezza", "unit": "cm", "frequency": "weekly", "notes": "App My Jump 2, ogni lunedì" },
    { "id": "fc_riposo_bpm", "name": "FC riposo mattutina", "unit": "bpm", "frequency": "daily", "notes": null }
  ]
}
```
````

---

## Vincoli sintassi JSON

### Esercizi: usa id catalog quando possibile

Lista id già presenti nel sistema (usa SEMPRE questi quando l'esercizio corrisponde):

**Forza compound**: `back-squat-barbell`, `front-squat-barbell`, `goblet-squat-kettlebell`, `dumbbell-squat`, `bulgarian-split-squat-dumbbell`, `bulgarian-split-squat-bodyweight`, `deadlift-conventional-barbell`, `deadlift-sumo-barbell`, `deadlift-romanian-barbell`, `deadlift-romanian-dumbbell`, `bench-press-flat-barbell`, `bench-press-flat-dumbbell`, `bench-press-incline-barbell`, `barbell-row-bent-over`, `dumbbell-row-bent-over`, `military-press-standing-barbell`, `seated-shoulder-press-dumbbell`, `pull-up-bodyweight`, `chin-up-bodyweight`

**Accessori**: `lunge-walking-dumbbell`, `step-up-dumbbell`, `glute-bridge-bodyweight`, `hip-thrust-barbell`, `face-pull-cable`, `lateral-raise-dumbbell`, `bicep-curl-dumbbell`, `tricep-extension-dumbbell`

**Core**: `plank-front-bodyweight`, `side-plank-bodyweight`, `dead-bug-bodyweight`, `bird-dog-bodyweight`, `pallof-press-band`, `copenhagen-plank`, `nordic-hamstring-curl`

**Plyometric**: `box-jump`, `broad-jump`, `depth-jump`, `lateral-bound-bodyweight`, `pogo-jump-bodyweight`, `jump-squat-bodyweight`, `jumping-lunge-bodyweight`

**Sport-specific**: `t-test-agility`, `pro-agility-5-10-5`, `shuttle-505-test`, `mirror-drill-reactive`, `go-no-go-reactive`, `compass-drill-reactive`, `sprint-linear-progressive`, `rsa-linear-30m`, `rsa-shuttle-15-15`, `ssg-4v4-football`, `ssg-1v1-football`

### Esercizi NUOVI (non in lista sopra)

Se prescrivi un esercizio NON nella lista:
1. Inventa un `id` slug kebab-case (es. `"reverse-nordic-curl"`, `"farmer-walk-kettlebell-heavy"`)
2. Compila OBBLIGATORIAMENTE: `name`, `pattern`, `equipment`, `technique` (1 frase tecnica), `guidance` (esattamente 5 bullet: `Setup:`, `Esecuzione:`, `Respirazione:`, `Errori comuni:`, `Sicurezza:`)
3. Il sistema lo aggiungerà al catalog personalizzato dell'utente automaticamente

### Enum valori ammessi

- **`session.type`**: `corsa` · `forza_gambe` · `forza_upper` · `sport` · `mobilita`
- **`session.day`**: `lun` · `mar` · `mer` · `gio` · `ven` · `sab` · `dom`
- **`exercise.pattern`**: `squat` · `hinge` · `lunge` · `horizontal_push` · `vertical_push` · `horizontal_pull` · `vertical_pull` · `carry` · `core_antiext` · `core_antirot` · `plyometric` · `isometric` · `mobility` · `agility` · `reactive` · `sprint` · `rsa` · `ssg`
- **`exercise.equipment`** (array): `bodyweight` · `dumbbell` · `barbell` · `kettlebell` · `band` · `machine` · `cable` · `trx` · `bench` · `pullup_bar` · `box`
- **`interval.kind`**: `warmup` · `main` · `cooldown` · `repetition` · `recovery`
- **`interval.zone`**: numero `1`-`5` (Z1 recovery, Z2 fondo lento, Z3 tempo, Z4 soglia, Z5 VO2max)
- **`tracking.frequency`**: `daily` · `weekly` · `after_rsa_session` · `after_session`

### Range numerici tollerati

- `duration_min`: 5-240
- `sets`: 1-20
- `reps_min` / `reps_max`: 1-200
- `rpe_target`: 1-10 (Borg)
- `rest_sec`: 0-900
- `tempo_eccentrico_sec`, `pause_sec`: 1-60
- `recovery_sec`: 15-900
- `weeks_total`: 1-52

### Regole strutturali

- Le `phases.weeks` possono essere un range `[1, 2]` o lista esplicita `[1, 3, 5]` — il sistema riconosce entrambe
- Ogni settimana in `weeks_total` deve avere almeno una entry in `weeks`
- Ogni settimana deve essere coperta da almeno una fase
- Una sessione ha SOLO `exercises[]` (per forza/sport) O SOLO `intervals[]` (per corsa) — l'altra è `[]`
- `tracking_metrics` è opzionale; se incluso, deve avere `id` univoci
