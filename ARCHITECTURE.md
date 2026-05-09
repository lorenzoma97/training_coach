# DESIGN DOC: diario-coach v2 — "Personal Trainer Pro"

**Author:** Architect agent · **Date:** 2026-05-09 · **Target:** ARCHITECTURE.md (root)
**Scope:** estensione da wellness coach a coach prescrittivo per atleta amatoriale serio (corsa + calcio + forza occasionale).
**Effort target:** 8-11 settimane · **Builder Specialist coinvolti:** 7 (schema, llm-prompt, kb-content, validator, frontend, data-integration, documentation).

---

## 1. Goals (misurabili)

| # | Goal | Misura del successo |
|---|---|---|
| G1 | Forza prescrittiva con carico | ≥80% sessioni `forza_*` includono `exercises[]` con `weight_kg` (o `bodyweight: true`) e RPE/RIR target derivati da %1RM/storia. Validator `strength_load_progression` flagga deviazioni >+10% vs storia. |
| G2 | Database esercizi | ≥80 esercizi catalogati (squat/dead/bench/row/press patterns + accessori + sport-specific calcio + core), ognuno con `equipment[]`, `muscles[]`, `pattern`, `level`, `alternatives[]`. Lookup O(1) per nome. |
| G3 | 1RM tracking | Profile contiene `oneRepMaxes` per ≥3 lift base (squat, panca, stacco) — testato (test sul campo) o stimato (Brzycki/Epley dal diario). Valore aggiornabile dal piano dopo PR. |
| G4 | Wearable Samsung Health import | Parser CSV ZIP UTF-16 LE; ≥4 stream supportati (workout, heart_rate, sleep, weight). Dedup vs registrazioni manuali con f1≥0.9 su test dataset (date+type+duration±2min). |
| G5 | Macrocicli race-driven | `RaceEvent` con date+sport+target genera `MacroCycle` 12-24 settimane con fasi `base/build/peak/taper`. Pass-1 LLM riceve fase corrente come input. |
| G6 | Mobility library | ≥6 routine pre-strutturate (FIFA 11+, Movement Prep, Dynamic Flow Runner, Foam Rolling, Yoga Recovery 20', Calf+Achilles Protocol). Selezionabili in piano e iniettate come `blocks[]` strutturati. |
| G7 | Readiness scoring | `Readiness` calcolato da HRV trend 7gg vs baseline 30gg + sleep + `morningFreshness`. Score 0-100 con auto-adjust validator: readiness <50 → downgrade Z4-5 → Z2-3. |
| G8 | Equipment substitution | Tabella `EXERCISE_ALTERNATIVES` con ≥3 alternative/esercizio principale; al cambio `profile.equipment` il piano corrente ri-renderizza `effectiveExercise` senza ri-chiamare LLM. |
| G9 | Sessioni prescrittive non più "blande" | Su test set di 10 input "calcio 40min" / "forza upper 45min", l'output Pass-2 contiene ≥4 esercizi/sessione forza con sets/reps/weight specifici e per cardio ≥3 blocchi (warmup+core+cooldown) con intensità target — verifica manuale + golden tests. |
| G10 | Cost & latency budget | Generazione piano completa (Pass 1+2+3) ≤ €0.05/run, ≤25s end-to-end p95 wall-clock. |

---

## 2. Data Model Changes

Tutto in `src/lib/types.ts` salvo dove indicato. **Backward-compat principle:** ogni nuovo campo è `optional` su interfacce esistenti. Migrazioni esplicite documentate in §2.M.

### 2.1 Nuove interfacce (additive, no breaking)

```ts
// src/lib/types/exercise.ts (NEW FILE)
export type ExercisePattern =
  | "squat" | "hinge" | "lunge" | "horizontal_push" | "vertical_push"
  | "horizontal_pull" | "vertical_pull" | "carry" | "core_antiext"
  | "core_antirot" | "plyometric" | "isometric" | "mobility";

export type ExerciseLevel = "beginner" | "intermediate" | "advanced";
export type EquipmentTag =
  | "bodyweight" | "dumbbell" | "barbell" | "kettlebell" | "band"
  | "machine" | "cable" | "trx" | "bench" | "pullup_bar" | "box";

export interface Exercise {
  id: string;                    // slug, es. "back-squat-barbell"
  name: string;                  // "Back Squat con bilanciere"
  pattern: ExercisePattern;
  primaryMuscles: string[];      // ["quadricipiti","glutei"]
  secondaryMuscles: string[];
  equipment: EquipmentTag[];     // ALL of these required
  level: ExerciseLevel;
  unilateral: boolean;
  technique: string;             // 1-2 frasi cue chiave
  cautions?: string[];           // controindicazioni (es. "lombare")
  /** ID degli esercizi sostitutivi (G8). Ordine = preferenza. */
  alternatives: string[];
  /** Per stima volume: kg×reps×sets. False per stretch/mobility. */
  loadable: boolean;
}

// src/lib/types/strength.ts (NEW FILE)
export interface ExercisePerformance {
  exerciseId: string;            // FK Exercise.id (validato runtime)
  /** N° set effettivamente eseguiti. Pianificato → 0..N actualSets ≤ plannedSets. */
  sets: ExerciseSet[];
  notes?: string;
  /** Tecnica/stallo segnalato dall'utente. Iniettato in pass-2 successiva. */
  failureReason?: "form_breakdown" | "rpe_cap" | "missed_reps" | "pain";
}

export interface ExerciseSet {
  reps: number;                  // ripetizioni completate
  /** kg sollevati. undefined → bodyweight (peso corporeo). */
  weight_kg?: number;
  /** RPE 1-10 (Borg modificato). Optional. */
  rpe?: number;
  /** Reps in Reserve. Alternativa pedagogica a RPE. */
  rir?: number;
  /** Tempo riposo PRIMA di questo set (sec). Per super-set/EMOM. */
  rest_sec?: number;
  /** Tempo sotto tensione totale (sec). Optional, mostly per ipertrofia. */
  tut_sec?: number;
}

export interface OneRepMax {
  exerciseId: string;            // FK Exercise.id
  value_kg: number;
  /** "tested" = test sul campo; "estimated" = derivato Brzycki/Epley dal diario. */
  source: "tested" | "estimated";
  /** ISO date di acquisizione. Stale dopo 6 mesi → UI prompt re-test. */
  acquiredAt: string;
  /** Se source=estimated: workout id che l'ha generato (audit trail). */
  fromWorkoutId?: string;
}

// src/lib/types/periodization.ts (NEW FILE)
export type MacroPhase = "base" | "build" | "peak" | "taper" | "transition";

export interface RaceEvent {
  id: string;
  name: string;                  // "Maratona di Bologna"
  sport: "corsa" | "sport" | "trail" | "triathlon";
  date: string;                  // YYYY-MM-DD
  /** Distanza km (corsa) o durata target (calcio: undefined). */
  distance_km?: number;
  /** Tempo target free-text. Se misurabile in sec, usare targetTimeSec. */
  targetTime?: string;           // "1:45:00"
  targetTimeSec?: number;
  priority: "A" | "B" | "C";     // A = peak event
  notes?: string;
  createdAt: string;
}

export interface MacroCycle {
  id: string;
  /** Race "A" che ancora il macrociclo. */
  raceId: string;
  startDate: string;             // YYYY-MM-DD (lunedì)
  endDate: string;               // = race.date
  /** Settimane tagged per fase. Calcolato deterministicamente da rules in macroPlanner.ts. */
  phases: MesoCycle[];
  /** Hash dei goal+race usati. Drift detection. */
  inputHash: string;
}

export interface MesoCycle {
  weekNumber: number;            // 1..N (dall'inizio macro)
  phase: MacroPhase;
  /** Volume target relativo (1.0 = baseline, 1.2 = +20%, 0.6 = deload). */
  volumeMultiplier: number;
  /** Intensità target (% sessioni in Z3+ rispetto al totale corsa). */
  intensityHighPct: number;
  focus: string;                 // "base aerobica", "soglia", "race pace"
}

// src/lib/types/mobility.ts (NEW FILE)
export interface MobilityRoutine {
  id: string;                    // "fifa-11plus", "movement-prep", ...
  name: string;
  purpose: "warmup" | "cooldown" | "recovery" | "injury_prevention";
  duration_min: number;          // totale routine
  /** Step ordinati. */
  steps: MobilityStep[];
  /** Sport target (calcio per FIFA 11+). undefined = generale. */
  sport?: string;
  citation?: string;             // "Soligard BMJ 2008"
}
export interface MobilityStep {
  name: string;
  duration_sec?: number;         // o reps
  reps?: number;
  cue: string;                   // 1 frase tecnica
}

// src/lib/types/readiness.ts (NEW FILE)
export interface ReadinessSnapshot {
  date: string;                  // YYYY-MM-DD
  score: number;                 // 0-100
  /** Componenti per debug + UI breakdown. */
  components: {
    hrvDelta?: number;           // RMSSD oggi - baseline 30gg (ms)
    sleepScore?: number;         // 0-100 da hours+quality
    subjectiveScore?: number;    // morningFreshness mappato 0-100
    soreness?: number;           // se l'utente lo registra
  };
  /** "low" <50, "moderate" 50-70, "high" >70. */
  band: "low" | "moderate" | "high";
  /** Suggerimento applicato dal validator (audit). */
  appliedAdjustment?: "downgrade_z45" | "skip_session" | "none";
}

// src/lib/types/wearable.ts (NEW FILE)
export interface WearableSample {
  source: "samsung_health" | "manual";
  /** ISO datetime inizio sessione (UTC normalizzato). */
  startedAt: string;
  /** Durata in minuti. */
  duration_min: number;
  /** Tipo nativo dal wearable + tipo mappato app. */
  rawType: string;
  mappedType: "corsa" | "forza_gambe" | "forza_upper" | "sport" | "mobilita";
  /** Hash deterministico per dedup (vedi §5.3). */
  dedupKey: string;
  /** Metriche estratte (subset). */
  hrAvg?: number;
  hrMax?: number;
  /** RMSSD ms se sample HRV disponibile. */
  hrvRmssd?: number;
  distance_km?: number;
  calories?: number;
  /** Match con workout esistente (id) post-import. null = nuovo. */
  matchedWorkoutId?: string | null;
}
```

### 2.2 Estensioni a interfacce esistenti (`src/lib/types.ts`)

```ts
export interface PlannedSession {
  // ... campi esistenti (day, date, type, subtype, duration_min, details, rationale, zone)

  /** Esercizi prescritti (forza_*). Ogni elemento referenzia Exercise.id. */
  exercises?: PlannedExercise[];
  /** Blocchi cardio strutturati (corsa: warmup + main + cooldown). */
  intervals?: CardioInterval[];
  /** Blocchi generici per mobility/sport (pre-strutturati). */
  blocks?: SessionBlock[];
  /** Routine mobility iniettata (FK MobilityRoutine.id). Per warmup/cooldown. */
  warmupRoutineId?: string;
  cooldownRoutineId?: string;
  /** Regola progressione: cosa fare la settimana prossima se RPE/PR raggiunti. */
  progressionRule?: ProgressionRule;
  /** Fase macrociclo a cui appartiene (audit / UI badge). */
  macroPhase?: MacroPhase;
  /** Auto-adjustment applicato dal validator readiness (G7). */
  readinessAdjusted?: boolean;
}

export interface PlannedExercise {
  exerciseId: string;            // FK Exercise.id
  plannedSets: number;
  /** Reps target. Range "8-10" → ["8","10"] tuple. */
  repsTarget: { min: number; max: number };
  /** Carico target. Esattamente uno tra weight_kg, pct1RM, rpe_target. */
  weight_kg?: number;
  pct1RM?: number;               // 0..100
  rpe_target?: number;           // 1..10
  rir_target?: number;           // 0..5
  rest_sec: number;
  /** Cue tecnico (1 frase). */
  cue?: string;
  /** Esercizio sostitutivo runtime (G8). Calcolato a render-time, non persistito. */
  effectiveExerciseId?: string;
}

export interface CardioInterval {
  /** Tipo blocco: warmup/main/cooldown/repetition. */
  kind: "warmup" | "main" | "cooldown" | "repetition" | "recovery";
  duration_min?: number;
  distance_km?: number;
  zone?: 1 | 2 | 3 | 4 | 5;
  /** Numero ripetizioni se kind=repetition. */
  reps?: number;
  /** Recovery dopo ogni rep. */
  recovery_sec?: number;
  cue?: string;
}

export interface SessionBlock {
  name: string;                  // "Activation", "Skill", "Conditioning"
  duration_min: number;
  details: string;
}

export interface ProgressionRule {
  /** "se 3 sessioni consecutive con RPE ≤ target → +X kg" */
  triggerCondition: string;
  /** "+2.5 kg" oppure "+1 rep/set". Free text iniettato in pass-2 successiva. */
  action: string;
}

export interface UserProfile {
  // ... campi esistenti

  /** 1RM per i lift principali. Estendibile. (G3) */
  oneRepMaxes?: OneRepMax[];
  /** Connessione wearable. */
  wearableConnected?: boolean;
  wearableLastSync?: string;     // ISO datetime
  /** Race future configurate dall'utente. (G5) */
  races?: RaceEvent[];
  /** Macro corrente attivo. Calcolato; rigenerato quando races cambia. */
  activeMacroCycleId?: string;
  /** Esperienza per disciplina (più granulare di profile.experience). */
  experienceByDiscipline?: {
    corsa?: Experience;
    forza?: Experience;
    sport?: Experience;
  };
}

export interface TrainingPlan {
  // ... campi esistenti

  /** ID macrociclo attivo. */
  macroCycleId?: string;
  /** Settimana corrente nel macro (1..N). */
  macroWeekNumber?: number;
  /** Fase corrente. Audit + UI badge. */
  macroPhase?: MacroPhase;
  /** Provenienza pass: "single" (legacy 1-pass) | "multi" (1+2+3). */
  generationMode?: "single" | "multi";
}
```

### 2.3 Storage keys (nuovi)

| Key | Type | Purpose |
|---|---|---|
| `exercise-db-version` | string | Versione catalogo esercizi (per cache invalidation) |
| `user-1rm-history` | `OneRepMax[]` | Storia testata 1RM (delta nel tempo per UI trend) |
| `user-races` | `RaceEvent[]` | Race configurate (sorgente di verità per macro) |
| `macro-cycle:<id>` | `MacroCycle` | Singolo macrociclo persistito |
| `wearable-import-log` | `Array<{importedAt, file, sampleCount, dedupedCount}>` | Audit import |
| `wearable-samples-v1` | `WearableSample[]` | Cache samples non ancora matched (max 90 giorni) |
| `readiness-history` | `ReadinessSnapshot[]` | Ultimi 60 giorni (pruning automatico) |
| `mobility-routines-version` | string | Versione catalogo routine |

I cataloghi `Exercise` e `MobilityRoutine` sono **bundlati nel codice** (`src/lib/catalog/exercises.ts`, `src/lib/catalog/mobilityRoutines.ts`) — vedi Open Question Q1.

### 2.M Migration plan

| Da | A | Strategia |
|---|---|---|
| `UserProfile` v1 | v2 (con oneRepMaxes, races, etc.) | Tutti opzionali. Nessuna migration esplicita: lettori controllano `profile.oneRepMaxes ?? []`. |
| `PlannedSession` v1 | v2 (con exercises/intervals/blocks) | Tutti opzionali. UI rendering legacy se assenti. **Backup v1**: migration `migrateToLatest` no-op (gli optional rimangono undefined). |
| `Workout` v1 (`fields: Record<string, unknown>`) | v2 con `exercises?: ExercisePerformance[]` | Aggiunta sotto-campo opzionale `workout.exercises` PARALLELO a `fields`. NON sostituiamo `fields` (legacy reader OK). Nuovi reader leggono `exercises[]` se presente, altrimenti parsano `fields.note` con regex. |
| `BackupPayload` v1 | v2 | **Bump version a 2** in `src/lib/backup.ts`. Aggiungere `migrateToLatest` ramo `if version === 1 → set defaults vuoti per nuove chiavi`. Backup v2 letto da app v2; backup v1 leggibile da app v2 con hydration defaults; backup v2 NON leggibile da app v1 (atteso). |

---

## 3. Architecture Changes

### 3.1 Multi-pass orchestrator (sostituisce `planGenerator.ts` 1-pass)

Nuovo file: **`src/lib/coach/planOrchestrator.ts`**.

```ts
// Signature pubbliche
export async function generatePlanMulti(input: PlanInput): Promise<TrainingPlan>;

// Pass 1: skeleton settimanale (tipo + giorno + duration). NO esercizi, NO blocchi.
//   Modello: Gemini Flash. Token budget: ~3K out.
//   Input: profile + goals + macroCtx + recentDaysSummary
//   Output: PlanSkeleton (PlannedSession senza exercises/intervals/blocks)
async function pass1Skeleton(input: PlanInput): Promise<PlanSkeleton>;

// Pass 2: dettaglio per sessione. 1 call per sessione (5-7 totali).
//   Modello: Gemini Pro 2.5 (vedi §3.4). Token budget: ~4K/call out.
//   Input: skeleton[i] + RAG-context (dipende dal sessionType, vedi §3.2) + history
//   Output: sessione arricchita con exercises[]/intervals[]/blocks[]
//   Esecuzione: Promise.allSettled in parallelo (max 3 in-flight per rate-limit)
async function pass2Detail(session: PlannedSession, ctx: SessionDetailCtx): Promise<PlannedSession>;

// Pass 3: validation + cross-session coherence. NO RAG, deterministic+LLM hybrid.
//   Step A (deterministic): runs all validators (vedi §3.3) → issues[]
//   Step B (LLM only se issues.length>0): chiede correzioni mirate
//   Modello: Gemini Flash. Token budget: ~2K out.
async function pass3Validate(plan: TrainingPlan, profile: UserProfile, history: DiaryDay[]): Promise<TrainingPlan>;
```

**Order of operations:**
1. Compute `MacroCtx` da `profile.races` + macroPlanner deterministico (no LLM).
2. Pass 1 → skeleton.
3. For each session in skeleton (parallel batched 3): Pass 2.
4. Merge sessions → plan candidate.
5. Pass 3 → validation; se non-fixabile deterministicamente, 1 LLM correction call.
6. Final validatePlan() (esistente, esteso) → log issues.

**Fallback:** se Pass 1 fallisce → `buildFallbackPlan` esistente. Se Pass 2 fallisce su una sessione → riempi con session "minimal" (solo type+duration+details) + warning. Se Pass 3 fallisce → consegna piano con warning "validator non eseguito".

**Cost estimate (Gemini API listino 2026-04, EU pricing):**
- Pass 1: ~1.5K in + 3K out × $0.075/1M in + $0.30/1M out (Flash) ≈ $0.001
- Pass 2: 7 × (2K in + 4K out) × $1.25/1M in + $5.00/1M out (Pro 2.5) ≈ $0.16 (preoccupante)
- Pass 3: ~3K in + 2K out × Flash ≈ $0.001
- **Totale: ~$0.16/run** — supera il budget G10 (€0.05). **Open Question Q4**: valutare Pass 2 con Flash + few-shot vs Pro.

### 3.2 RAG context routing

Nuovo file: **`src/lib/knowledge/contextRouter.ts`**.

```ts
export type RagContext = "macro_periodization" | "strength_db" | "cardio_intervals"
  | "sport_specific" | "mobility" | "none";

export interface RouteParams {
  pass: 1 | 2 | 3;
  sessionType?: PlannedSession["type"];
  macroPhase?: MacroPhase;
  hasStrengthHistory?: boolean;
}

export function routeContext(p: RouteParams): RagContext[] {
  if (p.pass === 3) return ["none"];
  if (p.pass === 1) return ["macro_periodization", p.macroPhase ? "sport_specific" : "none"];
  // pass === 2
  switch (p.sessionType) {
    case "forza_gambe":
    case "forza_upper": return ["strength_db", p.hasStrengthHistory ? "strength_db" : "none"];
    case "corsa":       return ["cardio_intervals"];
    case "sport":       return ["sport_specific"];
    case "mobilita":    return ["mobility"];
    default:            return ["none"];
  }
}

// Per ogni RagContext → query template predefinito che alimenta retrieveRelevantChunks().
// I chunk in chunks.ts vengono taggati con un nuovo campo `contexts: RagContext[]`
// (additive, default ["macro_periodization"] per compat). Filtro: top-K per cosine similarity
// MA solo tra chunks dove contexts intersect requested.
```

**Cambiamento a `retriever.ts`:** aggiungere `contextFilter?: RagContext[]` a `retrieveRelevantChunks(params)`. Default `undefined` (= no filter, comportamento esistente). Backward compatible.

**Cambiamento a `chunks.ts`:** aggiungere `contexts?: RagContext[]` a `KnowledgeChunk`. Tag retroattivo dei 38 chunk esistenti via PR del kb-content-specialist.

### 3.3 Validator architecture (estensione `planValidator.ts`)

Aggiunta tipo `PlanValidationIssue.type`:
- `strength_load_progression` (G1: max +10% vs storia)
- `pct1rm_reps_mismatch` (>85% 1RM con >5 reps)
- `phase_coherence` (taper in build phase, etc.)
- `readiness_override_required` (G7)
- `polarization_violation` (>20% high-intensity in build/base)
- `equipment_mismatch` (esercizio richiede equipment non in profile)
- `cycle_phase_warn` (donne, fase luteale + Z5 → warn)

**Composition pattern (no big-bang refactor):**
```ts
type PlanValidator = (plan: TrainingPlan, ctx: ValidatorCtx) => PlanValidationIssue[];

const VALIDATORS: PlanValidator[] = [
  validateRestDays,                  // esistente
  validateBeginnerCap,               // esistente
  validateConsecutiveDaysSenior,     // esistente
  validateZoneConfig,                // esistente
  validateSpikeJohansen,             // esistente
  validateStrengthAgeTiered,         // esistente
  validateSubtype,                   // esistente
  validateStrengthRecovery,          // esistente
  validateWeeklyVolume,              // esistente
  // NUOVI:
  validateStrengthLoadProgression,
  validatePct1rmRepsCoherence,
  validatePhaseCoherence,
  validateReadiness,                 // chiamato anche con auto-correction
  validatePolarization,
  validateEquipment,
  validateCyclePhaseRisk,
];

export function validatePlan(plan, profile, history, options): PlanValidationResult {
  const ctx = buildValidatorCtx(plan, profile, history, options);
  const issues = VALIDATORS.flatMap(v => v(plan, ctx));
  // ... auto-correction logic per readiness, equipment (substitute alternative)
}
```

**Auto-correction policy:**
- `equipment_mismatch` → silently swap to first alternative in `Exercise.alternatives` available with user equipment. Log warning.
- `readiness < 50` AND session has Z4/Z5 → downgrade to Z2-Z3, mark `readinessAdjusted: true`. Inject info nel rationale.
- Altre issues → sempre `warn` o `error`, mai modifica silente.

### 3.4 Modello tiering

| Pass / Use case | Modello | Razionale |
|---|---|---|
| Pass 1 (skeleton) | Gemini Flash | Strutturato, basso volume token, no reasoning complesso. |
| Pass 2 (detail) | **Default: Flash** + few-shot. **Opt-in Pro 2.5** dietro feature-flag `ADVANCED_DETAIL_MODE`. | Flash con prompt-engineering accurato + esempi prescrittivi (proven via golden tests) può raggiungere quality target a 1/40 del costo Pro. **Open Q4** + golden test su 10 input. |
| Pass 3 (validate-correct) | Flash | Solo riformulazione di sezioni flagged dai validators deterministici. |
| Chat / weekly report / motivation | Flash (status quo) | No change. |
| Embeddings | gemini-embedding-001 (status quo) | No change. |

**Fallback chain:** Pro fail → Flash. Flash fail → fallback hardcoded (sessione minimale).

---

## 4. Sequence Plan — Fasi e Wave

### FASE 1 — Architecture (settimana 1)
**Specialist:** Architect (questo doc) + Reviewer (sign-off).
**Deliverable:** ARCHITECTURE.md persistito + sign-off contracts §5.
**Acceptance:** doc letto e approvato dall'utente; nessuna ambiguità su data model + contracts.

### FASE 2 — Foundation (settimane 2-3)
Tutto in **parallelo**, dipendenze interne minime.

**Wave 2.1 (parallel)**
| Specialist | Task | Output |
|---|---|---|
| schema-specialist | Implementa `Exercise`, `ExercisePerformance`, `OneRepMax`, `RaceEvent`, `MacroCycle`, `MesoCycle`, `MobilityRoutine`, `WearableSample`, `ReadinessSnapshot` + estensioni a `PlannedSession`/`UserProfile`/`TrainingPlan`. Tutti i Zod schemas paralleli. | `src/lib/types/*.ts`, `src/lib/schemas/*.ts` (Zod). Test snapshot. |
| kb-content-specialist | Costruisce `src/lib/catalog/exercises.ts` con ≥80 esercizi (squat/dead/bench/row/press + accessori + sport-calcio + core). Tag `contexts` sui 38 chunks esistenti. Bundle `mobilityRoutines.ts` con 6 routine. | `exercises.ts`, `mobilityRoutines.ts`, chunks.ts patch. |
| documentation-specialist | Scrive guide Excel/Word per tester (NON .md): "Come fare il test 1RM", "Come esportare Samsung Health". | 2 file Excel/Word in `docs/`. |

**Wave 2.2 (serial, dipende da 2.1 schema)**
| Specialist | Task |
|---|---|
| schema-specialist | Bump backup version 1→2 + migration. |
| frontend-specialist | Estensione OnboardingWizard step "1RM opzionale" + step "Race calendar opzionale". |

**Acceptance Wave 2:**
- `npm run typecheck` pulito.
- `Exercise.alternatives` puntano tutti a id esistenti (test contract).
- Tutti i 38 chunks esistenti hanno almeno 1 context tag.
- Backup v1 si carica in app v2 senza errori.

### FASE 3 — Feature Build wave (settimane 3-7)
**Parallel waves** dove possibile, **serial** dove dipende dal data model di fase 2.

**Wave 3.1 — Strength engine (settimane 3-4, parallel)**
| Specialist | Task |
|---|---|
| llm-prompt-specialist | Pass 2 prompt forza con schemaHint che obbliga `exercises[]`. Few-shot ≥3 esempi prescrittivi. RAG query: "ipertrofia squat progressione amatoriale". |
| validator-specialist | `validateStrengthLoadProgression`, `validatePct1rmRepsCoherence`. Test ≥10 golden cases. |
| frontend-specialist | DiaryApp: nuovo form "exercises" structured (sets/reps/weight/RPE/RIR) parallel al form "fields" legacy. Toggle "modalità strutturata". |
| data-integration-specialist | Brzycki/Epley estimator → aggiorna `oneRepMaxes` quando workout PR. Function `inferOneRepMaxFromHistory(workouts, exerciseId)`. |

**Wave 3.2 — Wearable import (settimane 4-5, parallel a 3.1)**
| Specialist | Task |
|---|---|
| data-integration-specialist | Parser ZIP CSV Samsung Health. Encoding UTF-16 LE BOM. Mapping table workout type → app type. Dedup function (date+type+duration±2min). |
| frontend-specialist | SettingsPage: button "Import Samsung Health ZIP" + preview tabella samples + conferma "import N samples (M dedup-skipped)". |

**Wave 3.3 — Macrocycle + races (settimane 4-5, parallel)**
| Specialist | Task |
|---|---|
| schema-specialist | (continuazione) `macroPlanner.ts` deterministico: input race+today → output `MacroCycle` con phases. |
| llm-prompt-specialist | Estensione `taperingRules.ts` per integrare `macroPhase` corrente nel prompt Pass 1. |
| frontend-specialist | UI race calendar (sezione SettingsPage o nuovo `RacesPage.tsx`). Aggiungi/rimuovi/edita race. |

**Wave 3.4 — Mobility library + Readiness (settimane 5-6, parallel)**
| Specialist | Task |
|---|---|
| frontend-specialist | UI "Mobility routines" library (lista + dettaglio step-by-step). Iniezione in piano (`warmupRoutineId`). |
| data-integration-specialist | `readinessScoring.ts` — algoritmo HRV-trend + sleep + soggettivo. Test su dataset sintetico. |
| validator-specialist | `validateReadiness` con auto-correction Z4/5→Z2/3. |

**Wave 3.5 — Equipment substitution (settimana 6, serial dipende da Exercise catalog)**
| Specialist | Task |
|---|---|
| data-integration-specialist | `equipmentSubstitutor.ts`: `substituteIfNeeded(plannedExercise, availableEquipment) → effectiveExerciseId`. |
| frontend-specialist | TrainingPlanView: rendering effective exercise + tooltip "originale: X". |
| validator-specialist | `validateEquipment` (warn se NO alternativa disponibile). |

**Acceptance Fase 3:**
- ≥80% golden tests pass per ogni feature (10 fissi/feature).
- 0 regressions su test suite esistenti (storage.test, planValidator.test, zones.test).

### FASE 4 — Architectural Integration (settimane 7-9)

**Wave 4.1 — Multi-pass orchestrator** (serial, dipende da Fase 3)
| Specialist | Task |
|---|---|
| llm-prompt-specialist | Implementa `planOrchestrator.ts` (Pass 1, 2, 3). Refactor `planGenerator.ts` come thin wrapper di compatibilità (status quo callsite). |
| validator-specialist | `validateAll` integration test — pass 3 chiama tutto `VALIDATORS[]`. |
| documentation-specialist | Aggiorna README con architettura multi-pass. |

**Wave 4.2 — RAG context routing**
| Specialist | Task |
|---|---|
| kb-content-specialist | Tag completo `contexts` su tutti i 38 chunks. Aggiunti ~10 nuovi chunks (forza periodizzazione, calcio FIFA 11+, HRV interpretazione, RaceEvent strategie taper). |
| llm-prompt-specialist | Cablaggio `contextRouter` in pass1/pass2 RAG fetch. |

**Wave 4.3 — Profile/UI rinnovata**
| Specialist | Task |
|---|---|
| frontend-specialist | Refactor TrainingPlanView per supportare `exercises[]`/`intervals[]`/`blocks[]` rendering. Refactor DiaryApp — sezione esercizi strutturati. |

**Acceptance Fase 4:**
- Generazione piano end-to-end multi-pass ≤25s p95.
- Costo run ≤€0.05 (oppure ≤€0.20 con Pro 2.5 + flag opt-in chiaro).
- Backward compat: profili pre-v2 generano ancora piani validi (solo type+duration+details, no exercises) via fallback Pass 2.

### FASE 5 — Polish & Documentation (settimane 9-11)

| Specialist | Task |
|---|---|
| reviewer | Audit cross-feature: ogni feature dimostra contract test pass. Stress test su backup v1 + edge cases (utente senza race, utente senza wearable, utente principiante senza 1RM). |
| documentation-specialist | Guide Excel "Come usare il nuovo coach" + "Come fare upload Samsung Health" + "Come testare 1RM". (NO markdown). |
| frontend-specialist | UX polish, empty states ("nessuna race configurata → testo pedagogico + CTA"), loading states multi-pass ("Pass 2 di 3..."). |
| validator-specialist | Performance pass: assicura `validatePlan` <100ms su piano realistic. |

**Acceptance Fase 5:**
- Demo end-to-end: utente onboarding → race calendar → plan multi-pass → workout strutturato → import Samsung → readiness adjusts plan.
- Tutti i 7 specialist hanno passato review.

---

## 5. Contracts (interfacce binding tra moduli)

### 5.1 Schema → LLM-prompt
- **Produce:** `Exercise[]`, `MobilityRoutine[]`, `MacroCycle`, schemas Zod pubblici.
- **Consuma (LLM-prompt):** importa `EXERCISES_BY_ID` da catalog, usa `Exercise.id` per validare le risposte LLM. Iniezione lista nomi esercizi nel prompt deve venire da catalog (no hardcode in prompt).
- **Contract test:** `tests/contracts/exercise-catalog.test.ts` — verifica ogni `Exercise.alternatives[]` referenzia id esistente; ogni Pass-2 prompt cita ≥1 esercizio del catalog.

### 5.2 LLM-prompt → Validator
- **Produce:** `TrainingPlan` con `PlannedSession.exercises[]` popolato.
- **Consuma (Validator):** `validateStrengthLoadProgression` legge `plan.weeks[*].sessions[*].exercises[*].weight_kg`.
- **Contract test:** `tests/contracts/plan-shape.test.ts` — il JSON output di Pass 2 conforme al Zod schema esteso. 0 unknown keys.

### 5.3 Data-integration → Storage/Diary
- **Produce (parser Samsung):** `WearableSample[]` con `dedupKey = sha1(date_iso_minute|mappedType|round(duration_min/2)*2)`.
- **Consuma (DiaryApp):** quando user carica zip, mostra preview; conferma → scrive `Workout` con `fields.source = "samsung_health"` + `fields.dedupKey` per future dedup.
- **Contract test:** `tests/contracts/samsung-import.test.ts` — fixture CSV → expected Workout[] (≥3 fixtures).

### 5.4 Validator → Frontend
- **Produce:** `PlanValidationResult.issues[]` con `category` standardizzata.
- **Consuma (TrainingPlanView):** rendering UI badge severity per categoria. Categorie sconosciute → fallback "Avvertenza".
- **Contract test:** enum `PlanValidationIssue.type` è export pubblico; FE ha switch esaustivo.

### 5.5 Macro planner → Pass 1
- **Produce:** `MacroCtx { phase, weekNumber, volumeMultiplier, intensityHighPct }`.
- **Consuma:** Pass 1 inietta nel prompt `"FASE MACRO: ${phase}, sett ${weekNumber}/${total}, volume ${volMul}x"`.
- **Contract test:** macroPlanner deterministico — input race date 2026-09-15 oggi 2026-05-09 → expected output mathchable.

### 5.6 Readiness → Validator
- **Produce:** `ReadinessSnapshot` per oggi.
- **Consuma (validator):** se readiness.score<50 e plan ha session oggi con zone≥4 → auto-adjust + `readinessAdjusted: true`.
- **Contract test:** unit test `validateReadiness({readiness:{score:30}, plan:{sessions:[{zone:5}]}})` → output session.zone == 3.

### 5.7 Equipment substitutor → Validator + UI
- **Produce:** function pure `substituteIfNeeded(planned, equipment): { effectiveId, swapped: boolean }`.
- **Consuma:** validator usa per check `equipment_mismatch`; UI usa per render.
- **Contract test:** profile.equipment=[] + planned squat-barbell → effective=squat-bodyweight (non null).

---

## 6. Intersections critiche (top 10)

| # | Intersezione | Cosa rompe se errato | Prevenzione |
|---|---|---|---|
| I1 | `Exercise.id` shape coerente tra catalog ↔ LLM output ↔ Workout.exercises | LLM inventa "back-squat" vs catalog "back-squat-barbell" → matching fallisce, FE mostra "esercizio sconosciuto", validator load progression non funziona | Allowlist iniettata nel Pass 2 prompt (analogo a `workoutSubtypesForPrompt()`); validator `unknown_exercise_id` warn; runtime fallback "esercizio non riconosciuto" lo mostra come free-text |
| I2 | `dedupKey` Samsung vs manual workout | Doppia registrazione (utente importa, poi registra a mano stessa sessione) → volume gonfiato, validator spike falsi | Algoritmo dedup documentato (data + tipo + duration±2min). Test fixture coverage ≥10 casi reali. UI mostra "duplicato sospetto, conferma?" se match >0.8 |
| I3 | `MacroCycle` rigenerazione vs piano corrente | Utente aggiunge race → macro cambia → piano corrente è "vecchia fase". Se ri-genero piano automaticamente, perdo workout già fatti | Su race add: NON rigenero piano corrente; mark plan `staleReason: "macro_changed"`. UI prompt manuale "ricalcola piano". |
| I4 | `oneRepMaxes` aggiornamento da diario | Brzycki estimator scrive 1RM "estimated" — sovrascrive 1RM "tested"? | Mai: `tested > estimated`. Solo `estimated` nuovo > `estimated` vecchio aggiorna. UI mostra source con badge. |
| I5 | RAG `contexts[]` filter vs query | Se filter troppo stretto → 0 chunks, coach perde contesto scientifico. Se troppo largo → noise | Default fallback: se filter ritorna 0 chunks, retry senza filter. Log "context_router_miss". |
| I6 | Pass 2 parallel calls rate-limit | 7 sessioni × API call simultanee → rate-limit Gemini → fallimenti random | `Promise.allSettled` con concurrency cap=3. Retry singolo con backoff. Settled fallback per session non-critical. |
| I7 | Readiness auto-correction su piano già visto | Utente vede piano lunedì con Z5; martedì readiness basso → validator downgrade a Z2 → utente confuso "il piano è cambiato senza preavviso" | UI banner "Adattato per readiness basso oggi". Notifica chiara. **Mai** modifica silente del piano persistito; il cambiamento è solo a render-time + new feed item. |
| I8 | `Workout.exercises[]` vs `workout.fields.note` legacy | Utente legacy ha forza in `fields.note` come testo libero. Validator legge `exercises[]` → vuoto → flagga "no progression possible" | Parser fallback: estrai esercizi da note free-text con regex (best-effort). Se fallisce, validator skippa silently. |
| I9 | Backup v1 → app v2 | Profilo v1 senza `oneRepMaxes/races` → coach non sa cosa fare di Pass 2 forza | Defaults: `oneRepMaxes ?? []`, `races ?? []`. Pass 2 forza con 1RM=null usa range RPE invece di %1RM. |
| I10 | Equipment substitution chain | User toglie barbell da equipment → squat-barbell → goblet-squat (ok). Poi toglie kettlebell → goblet-squat → bulgarian-split (ok). Poi toglie dumbbell → bulgarian → bodyweight-squat. UI mostra cosa? | Render mostra `effectiveExercise` con tooltip "originale: ${plannedExercise.name}". Sequenza substitution loop max 3. Se anche bodyweight non disponibile (assurdo) → flag warn. |

---

## 7. Risks & Mitigations (top 10)

| # | Rischio | P | I | Mitigazione |
|---|---|---|---|---|
| R1 | Multi-pass costo > €0.05/run con Pro 2.5 | high | high | Default Flash + few-shot; opt-in Pro dietro flag (Open Q4). Misura cost con telemetry counter. |
| R2 | Latenza multi-pass > 25s p95 | med | high | Pass 2 in parallelo (max 3). Streaming intermedio in UI ("Pass 2/3..."). Hard cap 30s con fallback. |
| R3 | Catalog 80 esercizi incompleto / con errori semantici | med | med | Review manuale utente fase 2.1. Test snapshot. Iteration in Fase 5 polish. |
| R4 | Samsung Health export schema variabile per versione app | high | med | Parser tollerante; warn "tipo workout sconosciuto, mappato a sport (Altro)". Log raw header per debug utente. |
| R5 | RAG context routing mistuning → coach perde scienza | med | high | Fallback "no filter" su 0 chunks. Telemetry "context_router_miss" rate. Manual review. |
| R6 | Validator rules contraddittorie tra loro (es. polarization vs race-week intensity) | med | med | Validator priority matrix in `planValidator.ts`. Issue de-duplication per category. Test combinatori. |
| R7 | Readiness score falso (HRV PPG da wearable noisy) | high | med | Smoothing 3gg moving avg. Min sample 7 days di baseline prima di score. UI disclaimer "score indicativo". |
| R8 | Refactor planGenerator rompe weekly scheduler | low | high | Mantieni `planGenerator.ts` come thin facade compat; scheduler chiama API stabile. Smoke test scheduler in CI. |
| R9 | UI 1RM test in onboarding scoraggia nuovo utente | high | med | Test 1RM **opzionale post-onboarding** (Open Q2). Mostra badge "test 1RM consigliato per piano forza prescrittivo". |
| R10 | Macrocycle 24-settimane dimensione localStorage | low | med | MacroCycle ~5KB serializzato. Limit 5 macrocicli storici (pruning). Plan history già gestita. |

---

## 8. Open Questions

| # | Domanda | Opzioni | Raccomandazione |
|---|---|---|---|
| Q1 | DB esercizi: hardcoded in `catalog/exercises.ts` o JSON file separato? | (A) TS const con type-safety. (B) JSON + import + Zod validation. | **(A)** TS const: type-check al build, lookup O(1) via `Record<string, Exercise>`, no runtime parsing cost, no async load. Catalog cresce poco (target 80, max ~150). |
| Q2 | Test 1RM: obbligatorio in onboarding o opzionale post? | (A) Step obbligatorio onboarding. (B) Opzionale skippabile. (C) Solo post-onboarding via "Tools" page. | **(B)** Opzionale skippabile: utente può cliccare "Lo farò dopo". Pass 2 forza degrada a `rpe_target` invece di `pct1RM` se 1RM null. |
| Q3 | Default macrociclo se nessuna race | (A) Macro generico 12-settimane "fitness base". (B) No macro, planning settimana-per-settimana (status quo). | **(B)** Status quo: macro è opt-in via race add. Evitiamo over-engineering per utente casual. |
| Q4 | Pass 2 modello: Flash con few-shot o Pro 2.5? | (A) Flash always. (B) Pro always. (C) Flash default, Pro opt-in flag "modalità avanzata" (transparency cost). | **(C)** Default Flash con golden tests come gate quality. Se utente vuole quality top → toggle Pro con disclaimer "+€0.15/run". Misuriamo quality gap su 10 golden cases prima di decidere. |
| Q5 | Mobility routines: hardcoded in app o link YouTube esterno? | (A) Hardcoded step-by-step. (B) Link YouTube. (C) Hardcoded + opzionale link. | **(A)** Hardcoded: app PWA offline-first, no dipendenze esterne. ~6 routine × 10 step = 60 step totali, peso minimo. |
| Q6 | Wearable: solo Samsung Health o estendiamo a Garmin/Strava? | (A) Solo Samsung. (B) Anche Garmin TCX. (C) Plug-in architecture. | **(A)** Samsung only per v2. Architettura `WearableSample` + parser-per-source è già pronta per espansione, ma scope v2 = Samsung. |
| Q7 | Sessioni "blande" — root cause: solo prompt o anche schema? | Cambiamento prompt forse basta? | Schema-first: `exercises[]` REQUIRED nel Zod schema di Pass 2 forza. Senza esercizi → parse fail → fallback. Forza prescrittiva strutturalmente. |
| Q8 | RaceEvent.sport: enum chiuso o open string? | (A) Enum stretto. (B) Free string. | **(A)** Enum + "altro" come catch-all. macroPlanner ha rule diverse per corsa vs sport vs trail — devono essere known. |

**Confermare con utente Q1, Q2, Q4, Q5 prima di iniziare Wave 2.1.**

---

## 9. Effort estimate refined

| Fase | Wave | Specialist-week (h equivalenti) |
|---|---|---|
| 1 Architecture | — | 1 sw (40h) |
| 2 Foundation | 2.1 schema | 1.5 sw |
| | 2.1 kb-content (catalog) | 2 sw |
| | 2.1 docs guide | 0.5 sw |
| | 2.2 backup migration + onboarding | 1 sw |
| 3 Build | 3.1 strength engine | 2.5 sw (parallel: prompt + validator + FE + data-int) |
| | 3.2 wearable Samsung | 1.5 sw |
| | 3.3 macrocycle + races | 1.5 sw |
| | 3.4 mobility + readiness | 1.5 sw |
| | 3.5 equipment substitution | 0.5 sw |
| 4 Integration | 4.1 multi-pass orchestrator | 2 sw |
| | 4.2 RAG context routing + chunks | 1.5 sw |
| | 4.3 UI rinnovata | 2 sw |
| 5 Polish | review + docs + UX polish + perf | 2 sw |
| **TOTALE** | | **~21 sw** ÷ ~2 specialist parallel = **~10.5 settimane wall-clock** ✓ rientra in 8-11 settimane |

**Sanity check:** 21 specialist-week effort, con 2-3 specialist in parallel su molte wave (Fase 2.1, 3.1-3.4) → wall-clock ≈ 10 settimane ✓. Buffer 1 settimana per imprevisti.

---

## Note di chiusura

- **Tech-debt riconosciuto NON affrontato qui** (esplicito): refactor di `DiaryApp.tsx` (1464 LoC), `TrainingPlanView.tsx` (1347 LoC), `OnboardingWizard.tsx` (1253 LoC). Add only-mode in queste fasi: aggiunte componenti figli, no re-architettura. Refactor in v3.
- **Scheduler weekly** (`scheduler.ts`) chiama `regenerateNextWeek` (legacy 1-pass): in Wave 4.1 il refactor mantiene compat: `regenerateNextWeek` diventa wrapper di `generatePlanMulti({mode:"next-week"})`. Scheduler invariato.
- **Test infrastructure**: vitest esistente è sufficiente. Aggiungere ≥30 nuovi test (10 contract + 20 unit feature). Nessun framework nuovo.
- **CI/CD**: GitHub Actions deploy esistente intoccato.
- **Sequenza esecuzione raccomandata:** dopo sign-off di questo doc → batch domande Q1/Q2/Q4/Q5 all'utente → start Wave 2.1.
