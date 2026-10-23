import { useEffect, useRef } from "react";

import { getTouchSwipeDirection } from "./touch-swipe";

type Options = {
  target: HTMLElement | null;
  enabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

/** Navigate between slides with a single-finger horizontal swipe. */
export function useSlides2TouchSwipe({
  target,
  enabled = true,
  onPrevious,
  onNext,
}: Options) {
  const start = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    if (!target || !enabled) return;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        start.current = null;
        return;
      }

      const touch = event.touches[0];
      start.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
      };
    };

    const onTouchEnd = (event: TouchEvent) => {
      const initial = start.current;
      start.current = null;
      if (!initial) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - initial.x;
      const dy = touch.clientY - initial.y;
      const duration = performance.now() - initial.time;
      const direction = getTouchSwipeDirection(dx, dy, duration);
      if (direction === "next") onNext();
      else if (direction === "previous") onPrevious();
    };

    const onTouchCancel = () => {
      start.current = null;
    };

    target.addEventListener("touchstart", onTouchStart, { passive: true });
    target.addEventListener("touchend", onTouchEnd);
    target.addEventListener("touchcancel", onTouchCancel);

    return () => {
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchend", onTouchEnd);
      target.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [enabled, onNext, onPrevious, target]);
}
