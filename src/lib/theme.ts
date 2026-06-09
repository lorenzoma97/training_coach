// Sistema colore semantico (Sprint N, 2026-06-09).
//
// REGOLA: un colore = UN significato. Nasce dall'audit UX che ha trovato
// ambiguità ricorrenti (amber usato sia per warning sia per intensità normale;
// due blu #0891B2/#38BDF8; due verdi #22C55E/#10B981; due rossi #E8553A/#EF4444).
//
// Uso: importa TOKENS e, per bg/bordi semitrasparenti, withAlpha(TOKENS.x, "22").

export const TOKENS = {
  /** Identità programma/piano + azione primaria. MAI come warning. */
  primary: "#E8553A",
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
