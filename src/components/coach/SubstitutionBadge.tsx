// SubstitutionBadge — UI badge presentational per esercizi sostituiti runtime
// (G8, Wave 3.5). NO logica business: si limita a mostrare original → resolved
// + tooltip con la reason.
//
// Usato in render-time dalle session card forza quando PlannedExercise.effectiveExerciseId
// è diverso da exerciseId (substitutor ha applicato hop > 0).
//
// Wiring alle session card è scope di Fase 4 (UI rinnovata) — qui solo il
// componente atomico, plug-and-play.

import React from "react";

export interface SubstitutionBadgeProps {
  /** Esercizio originale prescritto dal piano (slug catalog). */
  original: string;
  /** Esercizio effettivamente eseguito dopo substitution (slug catalog). */
  resolved: string;
  /** Reason user-facing (es. "no barbell, used dumbbell"). Opzionale. */
  reason?: string;
}

/**
 * Badge "sostituito" inline. Inline-style (codebase non usa Tailwind).
 * Tooltip nativo via title attr (no librerie esterne).
 */
export function SubstitutionBadge({ original, resolved, reason }: SubstitutionBadgeProps) {
  const tooltip = reason
    ? `Sostituito: ${original} → ${resolved} (${reason})`
    : `Sostituito: ${original} → ${resolved}`;

  // a11y: role="img" + aria-label espone il contesto completo a screen reader
  // (la singola parola "sostituito" sarebbe insufficiente). Title resta per
  // tooltip mouse hover.
  return (
    <span
      role="img"
      title={tooltip}
      aria-label={tooltip}
      style={{
        backgroundColor: "#fef3c7", // amber-100
        color: "#78350f",           // amber-900 (contrast ~10:1 vs amber-100, AAA)
        padding: "2px 8px",
        borderRadius: "4px",
        // WCAG 1.4.4 Resize Text — 12px minimo per body inline copy
        fontSize: "12px",
        fontWeight: 600,
        marginLeft: "6px",
        verticalAlign: "middle",
      }}
    >
      sostituito
    </span>
  );
}

export default SubstitutionBadge;
