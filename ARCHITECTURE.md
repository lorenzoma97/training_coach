# DESIGN DOC: diario-coach v2 — "Personal Trainer Pro"

**Author:** Architect agent · **Date:** 2026-05-09 · **Target:** ARCHITECTURE.md (root)
**Last refresh:** 2026-05-11 (Documentation Specialist Fase 5 — stato implementato Wave 2.1→4.3 + Privacy + roadmap residua, vedi §9-§11).
**Scope:** estensione da wellness coach a coach prescrittivo per atleta amatoriale serio (corsa + calcio + forza occasionale).
**Effort target:** 8-11 settimane · **Builder Specialist coinvolti:** 7 (schema, llm-prompt, kb-content, validator, frontend, data-integration, documentation).

---

## 1. Goals (misurabili)

| # | Goal | Misura del successo | Stato |
|---|---|---|---|
| G1 | Forza prescrittiva con carico | ≥80% sessioni `forza_*` includono `exercises[]` con `weight_kg` (o `bodyweight: true`) e RPE/RIR target derivati da %1RM/storia. Validator `strength_load_progression` flagga deviazioni >+10% vs storia. | **[IMPLEMENTATO]** Wave 3.1 (`buildStrengthPassPrompt` + `validateStrengthLoadProgression` + Zod `plannedExerciseSchema`). |
| G2 | Database esercizi | ≥80 esercizi catalogati (squat/dead/bench/row/press patterns + accessori + sport-specific calcio + core), ognuno con `equipment[]`, `muscles[]`, `pattern`, `level`, `alternatives[]`. Lookup O(1) per nome. | **[IMPLEMENTATO]** Wave 2.1 — 113 esercizi in `src/lib/catalog/exercises.ts` con `EXERCISES_BY_ID` lookup O(1). |
| G3 | 1RM tracking | Profile contiene `oneRepMaxes` per ≥3 lift base (squat, panca, stacco) — testato (test sul campo) o stimato (Brzycki/Epley dal diario). Valore aggiornabile dal piano dopo PR. | **[IMPLEMENTATO]** Wave 3.1 — `oneRepMaxEstimator.ts` (Brzycki+Epley) + `StepStrength1RM` onboarding + `UserProfile.oneRepMaxes`. |
| G4 | Wearable Samsung Health import | Parser CSV ZIP UTF-16 LE; ≥4 stream supportati (workout, heart_rate, sleep, weight). Dedup vs registrazioni manuali con f1≥0.9 su test dataset (date+type+duration±2min). | **[PARZIALE]** Wave 3.2 — exercise.csv (workouts) implementato. Wave 3.4 estesa a HRV+sleep JSON (`samsungHealthJson.ts`). Stream "weight" non implementato (rinviato). |
| G5 | Macrocicli race-driven | `RaceEvent` con date+sport+target genera `MacroCycle` 12-24 settimane con fasi `base/build/peak/taper`. Pass-1 LLM riceve fase corrente come input. | **[IMPLEMENTATO]** Wave 3.3 — `macroPlanner.ts` (Bompa/Mujika/Seiler) + `macroLifecycle.ts` (recompute+events) + `MacroCtx` iniettato in `buildPass1SkeletonPrompt`. |
| G6 | Mobility library | ≥6 routine pre-strutturate (FIFA 11+, Movement Prep, Dynamic Flow Runner, Foam Rolling, Yoga Recovery 20', Calf+Achilles Protocol). Selezionabili in piano e iniettate come `blocks[]` strutturati. | **[IMPLEMENTATO]** Wave 3.4 — 6 routine in `mobilityRoutines.ts` + `MobilityLibrary.tsx` + `MobilityRoutineGuide.tsx`. Iniezione in piano via `warmupRoutineId`/`cooldownRoutineId`. |
| G7 | Readiness scoring | `Readiness` calcolato da HRV trend 7gg vs baseline 30gg + sleep + `morningFreshness`. Score 0-100 con auto-adjust validator: readiness <50 → downgrade Z4-5 → Z2-3. | **[IMPLEMENTATO]** Wave 3.4 — `readinessScoring.ts` (HRV/sleep/subjective/soreness pesati) + `validateReadiness` + `ReadinessBanner`. |
| G8 | Equipment substitution | Tabella `EXERCISE_ALTERNATIVES` con ≥3 alternative/esercizio principale; al cambio `profile.equipment` il piano corrente ri-renderizza `effectiveExercise` senza ri-chiamare LLM. | **[IMPLEMENTATO]** Wave 3.5 — `equipmentSubstitutor.ts` (BFS + cycle detection) + 23 catalog alts + `validateEquipmentMismatch` + `SubstitutionBadge` orphan render. |
| G9 | Sessioni prescrittive non più "blande" | Su test set di 10 input "calcio 40min" / "forza upper 45min", l'output Pass-2 contiene ≥4 esercizi/sessione forza con sets/reps/weight specifici e per cardio ≥3 blocchi (warmup+core+cooldown) con intensità target — verifica manuale + golden tests. | **[IMPLEMENTATO]** Wave 4.1 — multi-pass orchestrator. Schema Zod `min(1).max(12)` exercises strength + `min(1).max(20)` cardio intervals. Verificato in `passOrchestrator.test.ts` + `strengthSessionPrompt.test.ts`. |
| G10 | Cost & latency budget | Generazione piano completa (Pass 1+2+3) ≤ €0.05/run, ≤25s end-to-end p95 wall-clock. | **[IMPLEMENTATO]** stima ~$0.005/run con default Flash (vedi §11). Latency p95 non ancora misurata in produzione (telemetria token open — vedi §10). |

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

> **[IMPLEMENTATO Wave 4.1]** File reale: [`src/lib/coach/passes/passOrchestrator.ts`](src/lib/coach/passes/passOrchestrator.ts) (rinominato per coerenza barrel `passes/`). Prompt builder: [`skeletonPrompt.ts`](src/lib/coach/passes/skeletonPrompt.ts), [`strengthSessionPrompt.ts`](src/lib/coach/passes/strengthSessionPrompt.ts), [`cardioIntervalPrompt.ts`](src/lib/coach/passes/cardioIntervalPrompt.ts). `planGenerator.ts` mantiene la firma legacy ma delega via `if (MULTI_PASS_ENABLED) await runMultiPass(...)` su 3 entry-point (initial/regen/adapt). Pass-3 è 100% deterministico (no LLM correction call: scelta pragmatica per token-cost — vedi §10 OQ4.1.4). Sessioni `corsa` con `zone <= 3`, `sport`, `mobilita` saltano Pass-2 (skeleton sufficiente).

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

> **[PARZIALE Wave 4.2]** Funzione cablata: `contextsForPass(pass, workoutType?)` esposta in [`src/lib/knowledge/index.ts`](src/lib/knowledge/index.ts) (no file separato `contextRouter.ts`). `RetrievalOptions.contexts?: RagContext[]` aggiunto in [`retriever.ts`](src/lib/knowledge/retriever.ts) con fallback "no filter su 0 chunks". Tutti i 38 chunks hanno tag `contexts: RagContext[]` (Wave 2.1). **Gap residuo**: `passOrchestrator.detailStrengthSession()` passa ancora `ragContextStrength: ""` hardcoded — il wiring `retrieveRelevantChunks({ contexts: contextsForPass("pass2_strength") })` dentro Pass-2 NON è implementato (vedi §10 OQ4.1.1). Solo `CoachChat.tsx` usa effettivamente `retrieveRelevantChunks` (senza filter, comportamento legacy).

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

### 3.4 Modello (decisione finale Q4: solo Flash, no tiering)

Tutti i pass usano il modello LLM **configurato dall'utente in Settings** (no tiering automatico, no feature flag dedicato per Pass 2). Default = Gemini Flash come oggi. Se l'utente vuole quality migliore, cambia provider/modello in Settings → si applica a tutto (chat, planGen, feedback, weekly).

| Pass / Use case | Modello | Razionale |
|---|---|---|
| Pass 1 (skeleton) | Modello configurato (default Flash) | Strutturato, basso volume token. |
| Pass 2 (detail) | Modello configurato (default Flash) + few-shot ≥3 esempi prescrittivi | La qualità prescrittiva si ottiene via **prompt engineering + few-shot + Zod schema obbligatorio**, non via modello premium. Quality verificata su 10 golden tests in Wave 3.1. |
| Pass 3 (validate-correct) | Modello configurato (default Flash) | Solo riformulazione di sezioni flagged. |
| Chat / weekly report / motivation | Modello configurato (status quo) | No change. |
| Embeddings | gemini-embedding-001 (status quo) | No change. |

**Cost stimato finale (default Flash):**
- Pass 1: ~$0.001
- Pass 2: 7 × ~$0.0005 ≈ $0.0035
- Pass 3: ~$0.001
- **Totale: ~$0.005/run** ✓ ben dentro budget G10 (€0.05)

**Fallback chain:** se modello configurato fail → fallback hardcoded (sessione minimale). Nessun cross-model fallback per evitare costi sorpresa.

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

| # | Intersezione | Cosa rompe se errato | Prevenzione | Stato |
|---|---|---|---|---|
| I1 | `Exercise.id` shape coerente tra catalog ↔ LLM output ↔ Workout.exercises | LLM inventa "back-squat" vs catalog "back-squat-barbell" → matching fallisce, FE mostra "esercizio sconosciuto", validator load progression non funziona | Allowlist iniettata nel Pass 2 prompt (analogo a `workoutSubtypesForPrompt()`); validator `unknown_exercise_id` warn; runtime fallback "esercizio non riconosciuto" lo mostra come free-text | **[RISOLTA]** Wave 3.1 — allowlist passata al prompt + Zod schema rigetta unknown id. Validator `equipment_mismatch`/`equipment_substituted` coprono il caso runtime. |
| I2 | `dedupKey` Samsung vs manual workout | Doppia registrazione (utente importa, poi registra a mano stessa sessione) → volume gonfiato, validator spike falsi | Algoritmo dedup documentato (data + tipo + duration±2min). Test fixture coverage ≥10 casi reali. UI mostra "duplicato sospetto, conferma?" se match >0.8 | **[RISOLTA]** Wave 3.2 — `dedupKey` deterministico in `samsungHealth.ts`; preview UI in `SettingsPage`. |
| I3 | `MacroCycle` rigenerazione vs piano corrente | Utente aggiunge race → macro cambia → piano corrente è "vecchia fase". Se ri-genero piano automaticamente, perdo workout già fatti | Su race add: NON rigenero piano corrente; mark plan `staleReason: "macro_changed"`. UI prompt manuale "ricalcola piano". | **[RISOLTA]** Wave 3.3 — `markPlanStaleIfMacroChanged` in `macroLifecycle.ts` + `MacroUpdatedBanner` (CTA "Rigenera ora"). |
| I4 | `oneRepMaxes` aggiornamento da diario | Brzycki estimator scrive 1RM "estimated" — sovrascrive 1RM "tested"? | Mai: `tested > estimated`. Solo `estimated` nuovo > `estimated` vecchio aggiorna. UI mostra source con badge. | **[RISOLTA]** Wave 3.1 — `oneRepMaxEstimator.ts` rispetta priority `tested > estimated` (29 test). |
| I5 | RAG `contexts[]` filter vs query | Se filter troppo stretto → 0 chunks, coach perde contesto scientifico. Se troppo largo → noise | Default fallback: se filter ritorna 0 chunks, retry senza filter. Log "context_router_miss". | **[RISOLTA]** Wave 4.2 — `retriever.ts` fallback su pool completo se subset < topK + `console.warn`. |
| I6 | Pass 2 parallel calls rate-limit | 7 sessioni × API call simultanee → rate-limit Gemini → fallimenti random | `Promise.allSettled` con concurrency cap=3. Retry singolo con backoff. Settled fallback per session non-critical. | **[APERTA]** Wave 4.1 — `runPass2` esegue sequenziale (for loop). Decisione pragmatica per debug + cost predictability. Parallelizzazione open in §10 OQ4.1.3. |
| I7 | Readiness auto-correction su piano già visto | Utente vede piano lunedì con Z5; martedì readiness basso → validator downgrade a Z2 → utente confuso "il piano è cambiato senza preavviso" | UI banner "Adattato per readiness basso oggi". Notifica chiara. **Mai** modifica silente del piano persistito; il cambiamento è solo a render-time + new feed item. | **[RISOLTA]** Wave 3.4/4.3 — `validateReadiness` produce `correctedPlan` con `readinessAdjusted: true` + `ReadinessBanner` (auto-mute se band="moderate"). |
| I8 | `Workout.exercises[]` vs `workout.fields.note` legacy | Utente legacy ha forza in `fields.note` come testo libero. Validator legge `exercises[]` → vuoto → flagga "no progression possible" | Parser fallback: estrai esercizi da note free-text con regex (best-effort). Se fallisce, validator skippa silently. | **[PARZIALE]** Wave 3.1 — `RecentWorkoutForValidator.exercises?: ExercisePerformance[]` opzionale. Se assente, validator skippa silenziosamente (no regex parser legacy implementato — accettato). |
| I9 | Backup v1 → app v2 | Profilo v1 senza `oneRepMaxes/races` → coach non sa cosa fare di Pass 2 forza | Defaults: `oneRepMaxes ?? []`, `races ?? []`. Pass 2 forza con 1RM=null usa range RPE invece di %1RM. | **[RISOLTA]** Wave 2.2 — backup v2 con `migrateToLatest`. Tutti i campi v2 sono optional con `?? []`/`?? null` defaults nei reader. |
| I10 | Equipment substitution chain | User toglie barbell da equipment → squat-barbell → goblet-squat (ok). Poi toglie kettlebell → goblet-squat → bulgarian-split (ok). Poi toglie dumbbell → bulgarian → bodyweight-squat. UI mostra cosa? | Render mostra `effectiveExercise` con tooltip "originale: ${plannedExercise.name}". Sequenza substitution loop max 3. Se anche bodyweight non disponibile (assurdo) → flag warn. | **[RISOLTA]** Wave 3.5 — `walkAlternativeChain` BFS con `DEFAULT_MAX_HOP=3` + cycle detection via `Set<visited>`. `SubstitutionBadge` mostra reason. |

---

## 7. Risks & Mitigations (top 10)

> **Update 2026-05-11**: R1 risolto (default Flash, ~$0.005/run — vedi §11). R2 latency p95 NON ancora misurata in produzione (telemetria token mancante — §10 OQ4.1.2). Nuovi rischi emersi: **R11** RAG-Pass2 wiring incompleto (§10 OQ4.1.1) — Pass-2 strength/cardio non riceve scientific evidence specifica, riduce qualità prescrittiva. **R12** Tailwind dependency — UI Wave 4.3 usa classi Tailwind senza setup PostCSS verificato (nessun build locale, deploy GH Actions: rischio render plain). **R13** Test coverage UI — `tsx` test files esistono ma jsdom + @testing-library/react non setup → assertion runtime su DOM non eseguite (vedi §10).

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

## 8. Open Questions — RISOLTE (2026-05-09)

Tutte e 8 le Open Questions originali (Q1-Q8) sono chiuse. Decisioni definitive sotto.

> **Nuove Open Questions emerse durante implementazione Wave 4.x → vedi §10 Roadmap residua.**

| # | Domanda | Decisione finale | Note |
|---|---|---|---|
| Q1 | DB esercizi format | **TS const** in `src/lib/catalog/exercises.ts` | Type-safety al build, lookup O(1), tree-shaking, no async load. |
| Q2 | Test 1RM in onboarding | **Opzionale skippabile** | UX: 2 bottoni "Faccio il test ora" / "Lo farò dopo". Pass 2 forza usa `rpe_target` se 1RM null. |
| Q3 | Default macrociclo se no race | **No macro default** | Macro è opt-in via race add. Status quo planning settimana-per-settimana. |
| Q4 | Pass 2 modello | **Solo Flash, sempre** (no tiering, no flag) | Usa modello configurato in Settings. L'utente cambia in Pro/Pro 2.5 da Settings se vuole. Quality si ottiene via prompt + few-shot + Zod schema obbligatorio. |
| Q5 | Mobility routines | **In-app step-by-step** | App PWA offline-first. ~6 routine × ~10 step = peso minimo. |
| Q6 | Wearable scope | **Solo Samsung Health** v2 | Architettura `WearableSample` pronta per espansione futura. |
| Q7 | Sessioni "blande" — root cause | **Schema-first** | `exercises[]` REQUIRED nel Zod schema di Pass 2 forza. Senza esercizi → parse fail → fallback strutturato. |
| Q8 | RaceEvent.sport | **Enum stretto** + "altro" catch-all | macroPlanner ha rule diverse per corsa/sport/trail. |

---

## §9. Implementation Status (al 2026-05-11)

Tabella sintetica dello stato di tutte le wave implementate. Test count = `it()`/`test()` count grep su `*.test.*` files.

| Wave | Status | Files chiave | Test count | Known issues |
|---|---|---|---|---|
| **2.1 Foundation — Schemas** | DONE | [`types/exercise.ts`](src/lib/types/exercise.ts), [`types/strength.ts`](src/lib/types/strength.ts), [`types/periodization.ts`](src/lib/types/periodization.ts), [`types/mobility.ts`](src/lib/types/mobility.ts), [`types/readiness.ts`](src/lib/types/readiness.ts), [`types/wearable.ts`](src/lib/types/wearable.ts), [`schemas/*.ts`](src/lib/schemas/) (Zod) | 39 (4 type tests) | — |
| **2.1 Foundation — Catalog** | DONE | [`catalog/exercises.ts`](src/lib/catalog/exercises.ts) (113 esercizi, target ≥80), [`catalog/mobilityRoutines.ts`](src/lib/catalog/mobilityRoutines.ts) (6 routine), [`knowledge/chunks.ts`](src/lib/knowledge/chunks.ts) (38 chunk con `contexts: RagContext[]`) | 30 (catalog+chunks) | — |
| **2.1 Foundation — Docs** | DONE | [`docs/guida-test-1rm.md`](docs/guida-test-1rm.md), [`docs/guida-import-samsung-health.md`](docs/guida-import-samsung-health.md), [`docs/scientific-foundations.md`](docs/scientific-foundations.md) | — | Output `.md` (Lorenzo policy: guide-utente in Excel/Word). Accettato per docs interne dev. |
| **2.2 Foundation — Backup migration + Onboarding** | DONE | `backup.ts` v2 + `migrateToLatest`, [`StepStrength1RM.tsx`](src/components/onboarding/StepStrength1RM.tsx), [`StepRaces.tsx`](src/components/onboarding/StepRaces.tsx) | 30 (backup+steps) | — |
| **3.1 Strength engine** | DONE | [`passes/strengthSessionPrompt.ts`](src/lib/coach/passes/strengthSessionPrompt.ts), [`validators/strengthValidators.ts`](src/lib/coach/validators/strengthValidators.ts), [`oneRepMaxEstimator.ts`](src/lib/coach/oneRepMaxEstimator.ts), [`StrengthExercisesForm.tsx`](src/components/diary/StrengthExercisesForm.tsx) | 105 (prompt+validator+estimator+form) | RAG context non passato a Pass-2 (`ragContextStrength: ""` hardcoded) — vedi Wave 4.2 gap. |
| **3.2 Wearable Samsung CSV** | DONE | [`integrations/samsungHealth.ts`](src/lib/integrations/samsungHealth.ts) (parser ZIP UTF-16 LE BOM + dedup), preview UI in `SettingsPage` | 31 | Stream "weight" non implementato. |
| **3.3 Macrocycle + races** | DONE | [`macroPlanner.ts`](src/lib/coach/macroPlanner.ts) (Bompa/Mujika/Seiler), [`macroLifecycle.ts`](src/lib/coach/macroLifecycle.ts), [`macroLookup.ts`](src/lib/coach/macroLookup.ts), [`RaceCalendarSection.tsx`](src/components/races/RaceCalendarSection.tsx), [`MacroUpdatedBanner.tsx`](src/components/coach/MacroUpdatedBanner.tsx), [`taperingRules.ts`](src/lib/coach/promptModules/taperingRules.ts) | 67 | — |
| **3.4 Mobility library + Readiness HRV** | DONE | [`MobilityLibrary.tsx`](src/components/mobility/MobilityLibrary.tsx), [`MobilityRoutineGuide.tsx`](src/components/mobility/MobilityRoutineGuide.tsx), [`readinessScoring.ts`](src/lib/coach/readinessScoring.ts), [`integrations/samsungHealthJson.ts`](src/lib/integrations/samsungHealthJson.ts) (HRV+sleep stream), [`validators/readinessValidator.ts`](src/lib/coach/validators/readinessValidator.ts), [`ReadinessBanner.tsx`](src/components/coach/ReadinessBanner.tsx) | 95 (mobility+readiness+samsungJson+validator+banner) | Reviewer DEFERRED: ZIP single-load perf (parser ricarica ZIP per ogni stream — accettabile <10MB). |
| **3.5 Equipment substitution G8** | DONE | [`equipmentSubstitutor.ts`](src/lib/coach/equipmentSubstitutor.ts) (BFS chain + cycle detect), 23 alternatives in catalog, `validateEquipmentMismatch` + `validateEquipmentSubstituted` (severity warn), [`SubstitutionBadge.tsx`](src/components/coach/SubstitutionBadge.tsx) | 27 (substitutor+wiring) | Reviewer MINOR: severity `info` non distinguibile da `warn` nell'enum (vedi §10). |
| **Privacy — PII sanitizer** | DONE | [`promptSanitizer.ts`](src/lib/promptSanitizer.ts) (regex IT-aware: email/phone IT/CF/IBAN/URL) — applicato su 9 free-text al cloud (`profile.notes`, `meds`, `injuries[]`, `goal.smartDescription`, `workout.notes`, `daily.note`, ecc.) | 15 | Ollama provider opt-in desktop NON implementato (Lorenzo decision: tutti i dati passano cloud Gemini sanitizzati). |
| **4.1 Multi-pass orchestrator** | DONE | [`passes/passOrchestrator.ts`](src/lib/coach/passes/passOrchestrator.ts), [`skeletonPrompt.ts`](src/lib/coach/passes/skeletonPrompt.ts), [`cardioIntervalPrompt.ts`](src/lib/coach/passes/cardioIntervalPrompt.ts), branch in [`planGenerator.ts`](src/lib/coach/planGenerator.ts) (3 entry-point) | 30 (orchestrator+prompts) | Pass-2 sequenziale (no parallel cap=3 come da design); Pass-3 senza LLM-repair call; token telemetria assente. Vedi §10. |
| **4.2 RAG context routing** | PARTIAL | `RetrievalOptions.contexts` in [`retriever.ts`](src/lib/knowledge/retriever.ts), `contextsForPass(pass, workoutType?)` in [`knowledge/index.ts`](src/lib/knowledge/index.ts), tag `contexts` su 38 chunks | 22 (retriever+chunks) | Wiring incompleto: `passOrchestrator.detailStrengthSession/detailCardioSession` NON chiama `retrieveRelevantChunks({contexts: contextsForPass(...)})`. Solo `CoachChat` la usa (senza filter). Vedi §10 OQ4.1.1. |
| **4.3 UI rinnovata** | DONE | [`ReadinessBanner.tsx`](src/components/coach/ReadinessBanner.tsx), [`MacroUpdatedBanner.tsx`](src/components/coach/MacroUpdatedBanner.tsx), wiring in [`TrainingPlanView.tsx`](src/components/TrainingPlanView.tsx) (linee 754-755) | 11 (banner tests) | Test render-DOM not effective: `tsx` test files presenti ma jsdom + @testing-library/react non setup → assertions su DOM non eseguite. Vedi §10 Wave Tests. |

**Totale test:** 527 `it()`/`test()` calls su 36 test files. Pass rate non misurato in questo refresh (no `npm test` — Lorenzo non ha Node locale; CI GitHub Actions è la fonte di verità).

---

## §10. Roadmap residua post-Fase 4

### Open Questions Wave 4.1 (multi-pass orchestrator)

- **OQ4.1.1 — RAG-Pass2 wiring**: cablare `retrieveRelevantChunks({contexts: contextsForPass("pass2_strength")})` in `passOrchestrator.detailStrengthSession()` e analogamente per `detailCardioSession`. Attualmente `ragContextStrength: ""` hardcoded → Pass-2 non ha scientific evidence specifica oltre quanto già nel few-shot del prompt builder. Effort: ~0.5 sw. **Bloccante per qualità prescrittiva G9 in regime "scientifico documentato".**
- **OQ4.1.2 — Token telemetria**: `PassLog.tokens?: number` è dichiarato ma sempre `undefined` (provider Gemini non ritorna token usage in `generateJSON`). Aggiungere counter approssimativo (input length / 4 + output length / 4 = token estimate) per validare empiricamente la stima §11. Effort: ~0.2 sw.
- **OQ4.1.3 — Parallelizzazione Pass-2**: design prevedeva `Promise.allSettled` con concurrency cap=3; implementazione attuale è for-loop sequenziale. Misurare prima latency p95 attuale; se >25s, parallelizzare. Effort: ~0.5 sw.
- **OQ4.1.4 — Pass-3 LLM-repair**: design prevedeva LLM correction call su issue residue non-fixabili deterministicamente. Attualmente Pass-3 si limita a deterministic + warning text in rationale. Decidere se vale la pena (token cost +~$0.001/run, qualità marginale). Effort: ~1 sw.
- **OQ4.1.5 — Focus handover Pass-1 → Pass-2**: Pass-1 popola `session.details = focus`, Pass-2 strength riceve `session.subtype` ma non `focus` esplicitamente. Verificare se l'inserimento di `focus` esplicito nel prompt Pass-2 migliora coerenza skeleton↔detail. Effort: ~0.3 sw.

### Reviewer deferred — Wave 3.4

- **ZIP single-load perf**: `samsungHealth.ts` + `samsungHealthJson.ts` ricaricano lo ZIP per ogni stream parsato (workout + HRV + sleep = 3 reload). Per ZIP <10MB OK; per export annuale (decine di MB) → singola load + parser multi-stream condiviso. Effort: ~0.5 sw.

### Reviewer minor — Wave 3.5

- **Severity `info` per equipment_substituted**: l'enum `PlanValidationIssue.severity` è `"warn" | "error"`. `equipment_substituted` (hop > 0 ma alternativa trovata) è "info-warn"; aggiungere `"info"` per non sporcare il counter warning del banner UI. Effort: ~0.2 sw + audit consumer FE.
- **Prompt pre-filter alts**: passare al Pass-2 prompt SOLO gli esercizi eseguibili con `profile.equipment` corrente (pre-filter via `walkAlternativeChain`) invece di tutto il catalog. Evita LLM che propone esercizi che poi il validator deve sostituire. Effort: ~0.3 sw.

### Wave Privacy — opzioni desktop

- **Ollama provider opt-in (desktop)**: per utenti che vogliono zero-cloud, esporre selettore provider "Ollama locale" in Settings. Richiede LLM client adapter (`src/lib/llm/`) + UI guard "embeddings non disponibili in modalità Ollama → RAG disabilitato". Decisione utente: posticipato (tutti i dati passano cloud Gemini sanitizzati con `promptSanitizer` — sufficiente per Lorenzo's threat model).

### Wave Mobile UX

- **PWA install banner**: `index.html` ha `manifest.json` (verificare). Aggiungere banner "Installa app" iOS/Android con auto-detect platform. Effort: ~0.5 sw.
- **Offline mode test**: app è offline-first per lettura diary/plan; test che il Settings + plan generation falliscono gracefully con `useOnline()`. Effort: ~0.3 sw.

### Wave Tests — infrastructure gap

- **jsdom + @testing-library/react setup** — RISOLTO (Wave 4.3+, 2026-05-11):
  - `vite.config.ts` ora include sezione `test:` con `environment: "jsdom"`, `globals: true`, `setupFiles: ["./vitest.setup.ts"]`.
  - `vitest.setup.ts` (NEW) registra matchers `@testing-library/jest-dom/vitest` + `cleanup()` automatico afterEach.
  - `package.json` devDeps aggiornate con `jsdom@^25`, `@testing-library/react@^16`, `@testing-library/jest-dom@^6.5`, `@testing-library/user-event@^14.5`.
  - `SubstitutionBadgeWiring.test.tsx` promosso a vero render test (PROOF), gli altri 2 banner restano smoke (convertibili seguendo lo stesso pattern).
  - **STEP MANUALE LORENZO**: dopo merge, runnare `npm install` in CI/GitHub Actions (Lorenzo non ha Node locale) per recepire le nuove devDeps. Verificare poi che `npm test` passi sia per i test Node-only esistenti (jsdom retrocompatibile) sia per il nuovo render test del badge.

---

## §11. Token cost analysis (al 2026-05-11)

Stime basate sui `maxTokens` impostati nel codice ([`passOrchestrator.ts`](src/lib/coach/passes/passOrchestrator.ts) linee 327, 502, 556) e su lunghezza tipica dei prompt builder. Token input stimati: caratteri prompt / 4 (rule of thumb GPT-tokenizer-like).

### Workflow `generateInitialPlan` — single-pass legacy (deprecato)

| Componente | Input tok | Output tok | Subtotale |
|---|---|---|---|
| 1× call planSchema | ~1500 | ~2000 | ~3500 token |

### Workflow `generateInitialPlan` — multi-pass (default `MULTI_PASS_ENABLED=true`)

Profilo tipico utente Lorenzo: 4-5 sessioni/settimana, di cui ~3-4 forza_*, ~1 corsa Z>=4, ~1 mobility/sport.

| Pass | Input tok | Output tok (`maxTokens`) | N call | Subtotale |
|---|---|---|---|---|
| Pass-1 skeleton | ~2000 | 1500 | 1 | ~3500 |
| Pass-2 strength | ~1800 | 1000 | 3-4 | ~10000 (3.5 avg) |
| Pass-2 cardio Z>=4 | ~1500 | 800 | 0-1 | ~2300 |
| Pass-3 validate | 0 (deterministico) | 0 | 0 | 0 |
| **Totale** | | | | **~12000-15000 token** |

### Altri workflow

| Workflow | Input tok | Output tok | Note |
|---|---|---|---|
| chat coach turn | ~1000 | ~500 | Incluso RAG context (~3 chunks × 200 tok) |
| weeklyReport | ~1500 | ~1000 | Riassunto 7gg + analisi qualitativa |
| sessionFeedback | ~1200 | ~600 | Feedback su singola sessione + suggerimento |

### Costi €/mese — Gemini Flash 2.5 (listino 2026-04, EU)

- Input: $0.075 / 1M token
- Output: $0.30 / 1M token

| Item | Token/run | Cost/run | Run/settimana | Cost/settimana | Cost/anno |
|---|---|---|---|---|---|
| `generateInitialPlan` multi-pass | 12500 | ~$0.0014 | 1 (lunedì auto) | ~$0.0014 | ~$0.07 |
| `weeklyReport` | 2500 | ~$0.0005 | 1 | ~$0.0005 | ~$0.026 |
| `sessionFeedback` | 1800 | ~$0.0003 | 4-5 | ~$0.0015 | ~$0.078 |
| `chat coach` | 1500 | ~$0.0002 | 5-10 | ~$0.002 | ~$0.10 |
| **Totale settimanale** | | | | **~$0.005** | **~$0.27/utente/anno** |

**Verdetto:** sostenibile per utente single (Lorenzo). Anche con 100 utenti pilot → ~$27/anno API costs. Ben dentro budget G10 (€0.05/run = $0.054 con cambio 1.08, attuale ~$0.0014/run = **2.6% del budget**).

**Note:**
- I numeri Pass-2 strength (3-4 sessioni × ~2800 token totali = ~10000) sono dominanti: ~80% del costo per generazione piano.
- Stima conservativa: token input reale può essere superiore se l'utente ha cronologia esercizi lunga (`recentStrengthHistory` dump). Cap soft: in pratica gli ultimi 30gg di storia forza ~5-8 workout × ~150 token = ~1000 token aggiuntivi.
- Pro 2.5 (decisione Q4 = no, default Flash): se l'utente passasse a Pro, costo × ~17 → ~$0.024/run. Ancora sotto budget G10 ma 17× più alto.

---

## §12. Effort estimate refined

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
