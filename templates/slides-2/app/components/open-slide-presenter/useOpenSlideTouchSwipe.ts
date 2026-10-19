import { useEffect, useRef } from "react";

const MIN_SWIPE_PX = 50;
const MAX_SWIPE_MS = 600;
const FLICK_VELOCITY_PX_MS = 0.4;
const MIN_FLICK_PX = 24;

type Options = {
  target: HTMLElement | null;
  enabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

/** Navigate between slides with a single-finger horizontal swipe. */
export function useOpenSlideTouchSwipe({
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
      if (Math.abs(dx) <= Math.abs(dy)) return;

      const duration = performance.now() - initial.time;
      const distance = Math.abs(dx);
      const velocity = distance / Math.max(duration, 1);
      const distanceCommit =
        distance >= MIN_SWIPE_PX && duration <= MAX_SWIPE_MS;
      const flickCommit =
        velocity >= FLICK_VELOCITY_PX_MS && distance >= MIN_FLICK_PX;
      if (!distanceCommit && !flickCommit) return;

      if (dx < 0) onNext();
      else onPrevious();
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
