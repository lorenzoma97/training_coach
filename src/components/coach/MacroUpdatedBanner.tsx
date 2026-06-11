// MacroUpdatedBanner — Wave 4.3 (UI rinnovata).
//
// Banner blu informativo che appare quando il macrociclo attivo è cambiato
// (creazione, sostituzione, race aggiornata). Si abbona all'evento globale
// `macro:updated` (emesso da macroLifecycle.ts in Wave 3.3).
//
// Comportamento:
//   - All'mount + ad ogni `macro:updated`, ricarica `loadActiveMacroContext`
//     dal profilo per ottenere phase/weekNumber/totalWeeks correnti.
//   - Se non c'è macro attivo → no render (banner solo per stato "macro
//     attivo presente e aggiornato").
//   - Dismissibile: persiste flag in localStorage `macro-banner-dismissed-<id>`.
//     Quando arriva un nuovo macro con id diverso, il banner ricompare.
//
// Stile: Tailwind utility-first. Italiano.

import { useEffect, useState, useCallback } from "react";
import { events } from "../../lib/events";
import { getJSON } from "../../lib/storage";
import { loadActiveMacroContext } from "../../lib/coach/macroLookup";
import type { UserProfile } from "../../lib/types";
import type { BuildContextMacroCtx } from "../../lib/coach/promptBuilder";

const DISMISSED_PREFIX = "macro-banner-dismissed-";

export interface MacroUpdatedBannerProps {
  /**
   * Callback invocato dalla CTA "Rigenera piano corrente". Tipicamente il
   * parent (CoachPage / TrainingPlanView) wira questo a regenerateNextWeek
   * o equivalente. Se omesso, la CTA non viene mostrata.
   */
  onRegenerate?: () => void;
}

export function MacroUpdatedBanner({ onRegenerate }: MacroUpdatedBannerProps = {}) {
  const [ctx, setCtx] = useState<BuildContextMacroCtx | null>(null);
  const [macroId, setMacroId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  const reload = useCallback(async () => {
    try {
      const profile = await getJSON<UserProfile | null>("user-profile", null);
      const result = await loadActiveMacroContext(profile);
      if (!result) {
        setCtx(null);
        setMacroId(null);
        setDismissed(false);
        return;
      }
      setCtx(result.macroContext);
      setMacroId(result.macro.id);
      // Verifica dismissed flag per QUESTO macroId
      try {
        const flag = localStorage.getItem(`${DISMISSED_PREFIX}${result.macro.id}`);
        setDismissed(flag === "1");
      } catch {
        setDismissed(false);
      }
    } catch {
      setCtx(null);
      setMacroId(null);
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const off = events.on("macro:updated", () => {
      // Reset dismissed: nuovo macro o ricomputo → banner ri-emerge
      reload();
    });
    return off;
  }, [reload]);

  if (!ctx || !macroId) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(`${DISMISSED_PREFIX}${macroId}`, "1");
    } catch { /* ignore quota */ }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Macrociclo aggiornato"
      style={{
        // Dark theme (P2): token info su superficie scura.
        // Prima era blue-100 chiaro → riquadro pastello fuori tema.
        backgroundColor: "#0891B214",
        color: "#67E8F9",
        border: "1px solid #0891B255",
        borderRadius: "12px",
        padding: "12px 16px",
        marginBottom: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Macrociclo aggiornato
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Chiudi banner macrociclo aggiornato"
          style={{
            marginLeft: "auto",
            fontSize: "13px",
            fontWeight: 700,
            cursor: "pointer",
            textDecoration: "underline",
            background: "transparent",
            border: "none",
            color: "inherit",
            // a11y WCAG 2.5.5 — touch target min 44x44px
            minHeight: "44px",
            minWidth: "44px",
            padding: "8px 12px",
          }}
        >
          Chiudi
        </button>
      </div>
      <div style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.35 }}>
        Il tuo macrociclo è cambiato (race aggiornata o aggiunta).
      </div>
      <div style={{ fontSize: "12px", marginTop: "4px", fontFamily: "monospace" }}>
        Settimana attuale: {ctx.weekNumber}/{ctx.totalWeeks} · fase {ctx.phase}
        {ctx.race?.name ? ` · target: ${ctx.race.name}` : ""}
      </div>
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          style={{
            marginTop: "8px",
            background: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
            color: "#052E2A",
            fontSize: "14px",
            fontWeight: 800,
            // a11y WCAG 2.5.5 — touch target min 44x44px
            minHeight: "44px",
            padding: "10px 16px",
            borderRadius: "10px",
            border: "none",
            cursor: "pointer",
          }}
        >
          Rigenera piano corrente
        </button>
      )}
    </div>
  );
}

export default MacroUpdatedBanner;
