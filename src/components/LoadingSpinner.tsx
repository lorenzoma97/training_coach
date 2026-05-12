// LoadingSpinner — helper UI per stati di caricamento async (fetch/storage/IO).
// Wrappa la classe CSS `.spinner` già definita in styles.css (border-spinner
// 14px, animation @keyframes spin 0.8s linear infinite, accent #E8553A).
//
// Tre varianti di layout selezionabili via prop `variant`:
//  - "inline"  → spinner + label affiancati su una riga (default). Usato
//                accanto a testo o dentro frasi tipo "Verifico…".
//  - "block"   → container centrato con padding generoso, per loading
//                pagina/sezione (es. App boot, TrendsPage). textAlign: center.
//  - "minimal" → solo il pallino, niente label. Per inline dentro bottoni
//                già labelati o badge piccoli.
//
// A11y:
//  - role="status" + aria-live="polite" così screen reader annunciano il
//    cambio di stato senza essere intrusivi.
//  - Se label è fornita, è letta come testo. Altrimenti aria-label di default
//    "Caricamento in corso".
//
// NOTE: il design token `.spinner` size è 14px hard-coded in styles.css. Per
// dimensioni custom (16-24px) usa la prop `size` che applica width/height
// inline override (border-width scala proporzionalmente).
//
// Pattern d'uso (sostituisce stringhe sparse tipo "Caricamento…"):
//   <LoadingSpinner variant="block" label="Caricamento…" />
//   <LoadingSpinner variant="inline" label="Verifico…" />
//   <LoadingSpinner variant="minimal" size={16} />

import { colors, fontSize, space } from "../lib/designTokens";

interface LoadingSpinnerProps {
  /** Variante di layout. Default: "inline". */
  variant?: "inline" | "block" | "minimal";
  /** Label affiancata (italiano). Se omessa, mostra solo lo spinner. */
  label?: string;
  /** Override dimensione in px (default 14 da CSS). Range consigliato: 14-24. */
  size?: number;
  /** Padding del container "block" (default huge=20px x2). */
  blockPadding?: string;
  /** data-testid passthrough per smoke test. */
  "data-testid"?: string;
}

export default function LoadingSpinner({
  variant = "inline",
  label,
  size,
  blockPadding,
  "data-testid": testId,
}: LoadingSpinnerProps) {
  // Stile override size: scala il border proporzionalmente (size/14 * 2px).
  const sizeStyle: React.CSSProperties = size != null
    ? {
        width: `${size}px`,
        height: `${size}px`,
        borderWidth: `${Math.max(2, Math.round((size / 14) * 2))}px`,
      }
    : {};

  const spinnerEl = (
    <span
      className="spinner"
      aria-hidden
      style={sizeStyle}
    />
  );

  if (variant === "minimal") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={label ?? "Caricamento in corso"}
        data-testid={testId}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        {spinnerEl}
      </span>
    );
  }

  if (variant === "block") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label ?? "Caricamento in corso"}
        data-testid={testId}
        style={{
          padding: blockPadding ?? `${space.huge} ${space.huge}`,
          textAlign: "center",
          color: colors.textMuted,
          fontSize: fontSize.base,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: space.lg,
        }}
      >
        {spinnerEl}
        {label && <span>{label}</span>}
      </div>
    );
  }

  // variant === "inline" (default)
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? "Caricamento in corso"}
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: space.md,
        color: colors.textMuted,
        fontSize: fontSize.base,
      }}
    >
      {spinnerEl}
      {label && <span>{label}</span>}
    </span>
  );
}
