// EmptyState — helper UI per stati "nessun dato / niente da mostrare".
// Pattern condiviso applicato a Goals, Plan, Sparkline, Profile-missing, ecc.
//
// Design:
//  - Card dashed-border centrata su bgRaised (coerente con redesign Settings 2a70ea0 / Coach 814cd22)
//  - Titolo principale (italiano, frase incoraggiante, no emoji per regola task)
//  - Sottotitolo opzionale (contesto/istruzioni)
//  - CTA opzionale: bottone primary (gradient accent) o ghost — touch ≥44px
//
// A11y:
//  - role="status" → SR annunciano il contenuto come stato della pagina
//  - aria-label opzionale per descrivere l'empty state senza leggere titolo+desc
//
// NO emoji nei testi (vincolo task). Il "look-and-feel emoji" del codebase
// (es. 🧘 in MobilityLibrary, 📈 in TrendsPage) resta nei consumers che già
// l'hanno; questo helper è progettato per i NUOVI empty states che il task
// vuole UX-friendly senza emoji.
//
// Pattern d'uso:
//   <EmptyState title="Nessun obiettivo impostato" />
//   <EmptyState
//     title="Nessun obiettivo"
//     description="Aggiungi il primo obiettivo per orientare il coach."
//     ctaLabel="Aggiungi obiettivo"
//     onCta={() => setAdding(true)}
//   />

import { colors, fontSize, radius, space, touch } from "../lib/designTokens";

interface EmptyStateProps {
  /** Titolo principale (frase incoraggiante, italiano). */
  title: string;
  /** Sottotitolo / istruzione opzionale. */
  description?: string;
  /** Label del bottone CTA (opzionale). Se omesso, nessun bottone. */
  ctaLabel?: string;
  /** Handler click CTA (richiesto se ctaLabel presente). */
  onCta?: () => void;
  /** Variante CTA: "primary" (gradient accent) o "ghost" (border-only). Default: primary. */
  ctaVariant?: "primary" | "ghost";
  /** Bottone CTA disabilitato (es. durante async op). */
  ctaDisabled?: boolean;
  /** data-testid passthrough per smoke test. */
  "data-testid"?: string;
  /** Padding container override (default huge x huge). Compact per inline contexts. */
  compact?: boolean;
}

export default function EmptyState({
  title,
  description,
  ctaLabel,
  onCta,
  ctaVariant = "primary",
  ctaDisabled = false,
  "data-testid": testId,
  compact = false,
}: EmptyStateProps) {
  const hasCta = !!ctaLabel && !!onCta;

  return (
    <div
      role="status"
      data-testid={testId ?? "empty-state"}
      style={{
        background: colors.bgRaised,
        border: `1px dashed ${colors.borderStrong}`,
        borderRadius: radius.xxl,
        padding: compact ? `${space.huge} ${space.xxxl}` : `${space.big} ${space.huge}`,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: space.md,
      }}
    >
      <div style={{
        fontSize: fontSize.md,
        fontWeight: 700,
        color: colors.textSecondary,
        lineHeight: 1.4,
      }}>
        {title}
      </div>
      {description && (
        <div style={{
          fontSize: fontSize.sm,
          color: colors.textMuted,
          lineHeight: 1.5,
          maxWidth: "320px",
        }}>
          {description}
        </div>
      )}
      {hasCta && (
        <button
          type="button"
          onClick={onCta}
          disabled={ctaDisabled}
          data-testid={testId ? `${testId}-cta` : "empty-state-cta"}
          style={{
            marginTop: space.md,
            minHeight: touch.min,
            padding: `${space.lg} ${space.huge}`,
            background: ctaVariant === "primary"
              ? `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`
              : colors.bgElevated,
            border: ctaVariant === "primary"
              ? "none"
              : `1px solid ${colors.borderStrong}`,
            borderRadius: radius.lg,
            color: colors.textPrimary,
            fontSize: fontSize.base,
            fontWeight: 700,
            cursor: ctaDisabled ? "not-allowed" : "pointer",
            opacity: ctaDisabled ? 0.5 : 1,
          }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
