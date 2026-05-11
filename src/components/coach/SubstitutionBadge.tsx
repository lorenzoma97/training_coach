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
 * Badge "sostituito" inline. Tailwind: bg-amber-100 text-amber-900.
 * Tooltip nativo via title attr (no librerie esterne).
 */
export function SubstitutionBadge({ original, resolved, reason }: SubstitutionBadgeProps) {
  const tooltip = reason
    ? `Sostituito: ${original} → ${resolved} (${reason})`
    : `Sostituito: ${original} → ${resolved}`;

  return (
    <span
      className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded text-xs"
      title={tooltip}
      aria-label={tooltip}
    >
      sostituito
    </span>
  );
}

export default SubstitutionBadge;
