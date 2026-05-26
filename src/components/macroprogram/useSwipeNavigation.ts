// Hook swipe left/right per mobile (Sprint 4.2, 2026-05-26).
// Detection: touchstart + touchend, distanza orizzontale > 50px, time < 500ms.

import { useEffect, useRef } from "react";

export function useSwipeNavigation(
  containerRef: React.RefObject<HTMLElement | null>,
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
) {
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      startTime.current = Date.now();
    }
    function handleTouchEnd(e: TouchEvent) {
      const t = e.changedTouches[0];
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;
      const dt = Date.now() - startTime.current;
      // Swipe valido: orizzontale (|dx| > 50), non troppo verticale (|dx|>|dy|*2),
      // tempo veloce (< 500ms)
      if (dt > 500) return;
      if (Math.abs(dx) < 50) return;
      if (Math.abs(dx) < Math.abs(dy) * 2) return;
      if (dx > 0) onSwipeRight();
      else onSwipeLeft();
    }

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [containerRef, onSwipeLeft, onSwipeRight]);
}
