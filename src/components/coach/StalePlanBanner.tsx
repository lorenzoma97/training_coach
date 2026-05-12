// StalePlanBanner — Fix 1.
//
// Banner amber che appare in cima al piano quando l'utente non apre l'app
// per più di 7 giorni (now > plan.startDate + 7d). La prima settimana del
// piano renderizzata è ormai passata: senza segnale UI l'utente si confonde
// (vede "lun → dom" ma è già martedì successivo).
//
// Comportamento:
//   - Pattern visivo amber (MacroUpdatedBanner usa blu informativo, questo è
//     warning ⇒ amber stile #fef3c7/#92400e).
//   - NON dismissibile: l'informazione è critica finché non rigeneri (al
//     contrario di MacroUpdatedBanner che è solo notifica).
//   - CTA "Genera nuova settimana" wired su `onRegenerate` (parent passa
//     `handleRegenerate("next-week")`).
//   - Mostra la data lunedì del piano stale ("lun 05/05") per orientamento.
//   - a11y: role=status, aria-live=polite, touch target WCAG 2.5.5 (44px).
//
// Stile: inline `style={{}}` (codebase convention, no Tailwind).

import { formatWeekdayDayMonth } from "../../lib/dateFormatters";

export interface StalePlanBannerProps {
  /** ISO date "YYYY-MM-DD" del lunedì della settimana del piano scaduto. */
  startDate: string;
  /** Callback CTA: tipicamente `handleRegenerate("next-week")` del parent. */
  onRegenerate: () => void;
  /** Disabilita CTA durante una rigenerazione già in corso. */
  disabled?: boolean;
}

export function StalePlanBanner({ startDate, onRegenerate, disabled }: StalePlanBannerProps) {
  // "lun 05/05" — formatter condiviso, parsing locale (no off-by-one UTC).
  const dateLabel = formatWeekdayDayMonth(startDate);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Piano della settimana scaduto"
      style={{
        backgroundColor: "#fef3c7", // amber-100
        color: "#78350f",           // amber-900
        border: "1px solid #fcd34d", // amber-300
        borderRadius: "12px",
        padding: "12px 16px",
        marginBottom: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Piano scaduto
        </span>
      </div>
      <div style={{ fontSize: "13px", marginTop: "6px", lineHeight: 1.4 }}>
        Il tuo piano è della settimana del <b>{dateLabel}</b>. Vuoi una nuova settimana?
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={disabled}
        aria-label="Genera nuova settimana del piano"
        style={{
          marginTop: "10px",
          backgroundColor: disabled ? "#92400e88" : "#92400e", // amber-800 (contrast >7:1 vs white)
          color: "white",
          fontSize: "14px",
          fontWeight: 700,
          // a11y WCAG 2.5.5 — touch target min 44x44px
          minHeight: "44px",
          padding: "10px 16px",
          borderRadius: "8px",
          border: "none",
          cursor: disabled ? "wait" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        Genera nuova settimana
      </button>
    </div>
  );
}

export default StalePlanBanner;
