import type { CSSProperties } from "react";

// Sistema colore semantico (Sprint N, 2026-06-09).
//
// REGOLA: un colore = UN significato. Nasce dall'audit UX che ha trovato
// ambiguità ricorrenti (amber usato sia per warning sia per intensità normale;
// due blu #0891B2/#38BDF8; due verdi #22C55E/#10B981; due rossi #14B8A6/#EF4444).
//
// Uso: importa TOKENS e, per bg/bordi semitrasparenti, withAlpha(TOKENS.x, "22").

export const TOKENS = {
  /** Identità programma/piano + azione primaria. MAI come warning. */
  primary: "#14B8A6",
  /** Informazione neutra e dati operativi non allarmanti (un solo blu). */
  info: "#0891B2",
  /** Serve attenzione ma non bloccante. MAI per dati/intensità normali. */
  attention: "#F59E0B",
  /** Stato positivo / completato (un solo verde). */
  success: "#22C55E",
  /** Critico / bloccante. Unico rosso d'allarme. */
  danger: "#EF4444",
  /** Testo secondario, label, hint, stati "non disponibile"/placeholder. */
  neutral: "#94A3B8",

  // Superfici (non sono "significati", solo layering del dark theme).
  surface: "#16213E",
  surfaceAlt: "#1A1A2E",
  surfaceDeep: "#0F172A",
  /** Testo primario / heading. */
  text: "#E2E8F0",
  /** Testo molto attenuato (gerarchia sotto neutral). */
  textDim: "#64748B",
} as const;

export type SemanticToken = "primary" | "info" | "attention" | "success" | "danger" | "neutral";

/** Aggiunge un suffisso alpha esadecimale (2 cifre) a un hex. withAlpha(x,"22"). */
export function withAlpha(hex: string, alpha2: string): string {
  return `${hex}${alpha2}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scala SPAZIATURE / RAGGI / TIPOGRAFIA (skill product-ui-system, 2026-06-09)
// Regola: gap/padding/raggi/testo SOLO da qui → ritmo coerente, niente numeri
// sparsi (prima: 6/10/14/18 misti, testo 10-13px ovunque = aspetto "denso").
// ─────────────────────────────────────────────────────────────────────────────

/** Ritmo spaziale 4/8px. */
export const SPACE = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
} as const;

/** Raggi: controlli, card, pill. */
export const RADIUS = {
  control: 8, card: 14, pill: 999,
} as const;

/**
 * Scala tipografica con RUOLI espliciti (title > section > body > secondary >
 * label). Spread direttamente in `style`. Corpo a 15px / 1.55 per leggibilità
 * (prima molto testo a 12-13px). Le label restano piccole ma con tracking.
 */
export const TYPE = {
  title:      { fontSize: "20px", fontWeight: 700, lineHeight: 1.25 },
  section:    { fontSize: "15px", fontWeight: 700, lineHeight: 1.35 },
  body:       { fontSize: "15px", fontWeight: 400, lineHeight: 1.55 },
  bodyStrong: { fontSize: "15px", fontWeight: 600, lineHeight: 1.5 },
  secondary:  { fontSize: "13px", fontWeight: 500, lineHeight: 1.5 },
  label:      { fontSize: "11px", fontWeight: 700, lineHeight: 1.3, letterSpacing: "0.08em", textTransform: "uppercase" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Stili UI CONDIVISI (skill product-ui-system) — un solo linguaggio per card,
// label di sezione e valori-metrica in tutta l'app. Le schermate importano
// questi invece di ridefinirne uno proprio → consistenza per costruzione.
// ─────────────────────────────────────────────────────────────────────────────

export const uiCard: CSSProperties = {
  background: TOKENS.surface,
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: `${RADIUS.card}px`,
  padding: `${SPACE.lg}px`,
};

export const uiLabel: CSSProperties = {
  ...TYPE.label,
  color: TOKENS.neutral,
  marginBottom: `${SPACE.sm}px`,
};

export const uiValue: CSSProperties = {
  fontSize: "20px",
  fontWeight: 800,
  color: TOKENS.text,
  fontFamily: "'JetBrains Mono', monospace",
};
