// Costanti timer/timeout/debounce centralizzate.
// Sostituiscono ~15 magic numbers sparsi nel codebase (setTimeout/setInterval).
//
// Razionale per ognuno:
// - DEBOUNCE_MS: collassa eventi storage/event-bus ravvicinati (cross-tab burst).
// - POLL_INTERVAL_MS: fallback storage event quando il browser non li propaga.
// - TOAST_DURATION_MS: tempo di lettura comodo per messaggio breve.
// - SAVE_FLASH_MS: feedback "salvato" prima di nascondersi.
// - SCROLL_DELAY_MS: dopo apertura tastiera iOS, attendere il viewport reflow.
// - LLM_LOCK_TTL_MS: cross-tab mutex per evitare doppia run del weekly report.
// - DRAFT_MAX_AGE_MS: bozza onboarding scaduta dopo 30 giorni.

export const TIMING = {
  DEBOUNCE_MS: 200,
  POLL_INTERVAL_MS: 15_000,
  TOAST_DURATION_MS: 6_000,
  SAVE_FLASH_MS: 2_200,
  SAVED_MICRO_MS: 1_500,
  SCROLL_DELAY_MS: 300,
  LLM_LOCK_TTL_MS: 60_000,
  DRAFT_MAX_AGE_MS: 30 * 24 * 3600 * 1000,
  ZONES_HISTORY_DAYS: 60,
  DIARY_CONTEXT_DAYS: 14,
  PLAN_VALIDITY_DAYS: 14,
  MOTIVATION_MIN_IDLE_DAYS: 3,
  MOTIVATION_MIN_GAP_DAYS: 4,
} as const;
