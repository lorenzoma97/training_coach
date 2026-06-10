// Design tokens condivisi — unica fonte di verità per colori, spacing, font.
// Evita la duplicazione degli style inline negli oltre 20 componenti.
// Gli stili inline restano, ma leggono da qui invece di hard-codare i valori.

export const colors = {
  // Superficie
  bg: "#0B0F1A",          // sfondo app
  bgRaised: "#16213E",    // card, pannelli
  bgElevated: "#1A1A2E",  // elementi su card (input, bottoni secondari)
  bgDeep: "#0F172A",      // bottom sheet, modali

  // Testo
  textPrimary: "#E2E8F0",   // testo principale (NON usare #FFF puro)
  textSecondary: "#CBD5E1", // testo secondario, label
  textMuted: "#94A3B8",     // hint, caption (≥12px per contrasto AA)
  textDim: "#64748B",       // valori sparsi, placeholder (SOLO ≥12px)

  // Accent
  accent: "#14B8A6",        // primario (CTA, titoli emphasis)
  accentDark: "#0D9488",    // hover gradient end
  accentSoft: "#14B8A666",  // border 40%
  accentFaint: "#14B8A615", // bg selezione 8%

  info: "#0891B2",          // info (Karvonen, knowledge base)
  infoDark: "#0E7490",
  infoSoft: "#0891B266",

  // Semantic
  success: "#22C55E",
  successSoft: "#22C55E66",
  successFaint: "#22C55E20",
  warning: "#F59E0B",
  warningSoft: "#F59E0B66",
  warningFaint: "#F59E0B15",
  danger: "#EF4444",
  dangerSoft: "#EF444466",
  dangerFaint: "#EF444415",

  // Border
  border: "rgba(255,255,255,0.06)",
  borderStrong: "rgba(255,255,255,0.12)",
  borderFocus: "rgba(255,255,255,0.15)",
} as const;

// Zone FC — colori canonici (Coggan/Friel 5-zone). Unica fonte.
// Ogni zona ha 3 varianti: bg tenue, border medio, text pieno.
export const ZONE_COLORS: Record<1 | 2 | 3 | 4 | 5, { bg: string; border: string; text: string }> = {
  1: { bg: "#10B98115", border: "#10B98166", text: "#10B981" }, // emerald
  2: { bg: "#22C55E20", border: "#22C55E66", text: "#22C55E" }, // green
  3: { bg: "#EAB30820", border: "#EAB30866", text: "#EAB308" }, // yellow
  4: { bg: "#F9731620", border: "#F9731666", text: "#F97316" }, // orange
  5: { bg: "#EF444420", border: "#EF444466", text: "#EF4444" }, // red
};

// Spacing scale (multipli di 2 per consistenza)
export const space = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "10px",
  xl: "12px",
  xxl: "14px",
  xxxl: "16px",
  huge: "20px",
  big: "24px",
} as const;

// Dimensioni minime touch target (WCAG 2.5.5 AAA + iOS HIG)
export const touch = {
  min: "44px",     // minimo assoluto per interattivi principali
  compact: "40px", // OK per bottoni densi in gruppo (tab, chip)
  inline: "32px",  // chip rimovibili, non-primari
} as const;

// Radius
export const radius = {
  sm: "6px",
  md: "8px",
  lg: "10px",
  xl: "12px",
  xxl: "14px",
  pill: "999px",
} as const;

// Font
export const fonts = {
  mono: "'JetBrains Mono', monospace",
} as const;

// Font size scale. 9px è evitato (contrasto insufficiente su sfondo scuro),
// 11px è il minimo per testo informativo leggibile, 10px solo per label
// molto saltuari a colore pieno (mai #64748B/#94A3B8 sotto 11px).
export const fontSize = {
  xs: "11px",   // minimum for muted text
  sm: "12px",
  base: "13px", // body standard
  md: "14px",
  lg: "15px",
  xl: "16px",
  xxl: "18px",
  huge: "22px",
  display: "26px",
} as const;

// Helper: style-object pre-composti per pattern ricorrenti
export const styles = {
  card: {
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.xxl,
    padding: "18px 20px",
  },
  inputBase: {
    width: "100%",
    padding: "11px 14px",
    background: colors.bgElevated,
    border: `1px solid rgba(255,255,255,0.1)`,
    borderRadius: radius.lg,
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    outline: "none",
    boxSizing: "border-box" as const,
    minHeight: touch.compact,
  },
  btnPrimary: {
    padding: "10px 16px",
    background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`,
    border: "none",
    borderRadius: radius.lg,
    color: colors.textPrimary,
    fontWeight: 700,
    fontSize: fontSize.base,
    cursor: "pointer" as const,
    minHeight: touch.min,
  },
  btnGhost: {
    padding: "10px 14px",
    background: colors.bgElevated,
    border: `1px solid ${colors.borderFocus}`,
    borderRadius: radius.lg,
    color: colors.textPrimary,
    fontWeight: 600,
    fontSize: fontSize.base,
    cursor: "pointer" as const,
    minHeight: touch.min,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: 700,
    letterSpacing: "0.15em",
    color: colors.accent,
    textTransform: "uppercase" as const,
    fontFamily: fonts.mono,
  },
} as const;
