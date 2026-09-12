import { useEffect, useState } from "react";

/**
 * Wait until the first paint has happened and the main thread has had an idle
 * moment, then run `callback` exactly once. Returns a cancel function.
 *
 * Fast path: `requestAnimationFrame` → `requestIdleCallback` (with a timeout
 * so a busy main thread cannot starve it). Two safety nets keep the callback
 * reliable: browsers without `requestIdleCallback` fall back to a macrotask,
 * and a bounded timer covers hidden tabs where `requestAnimationFrame` never
 * fires. Never runs during SSR — React effects do not run on the server, and
 * the scheduler is a no-op without a `window`.
 */
export type ScheduleAfterPaintCancel = () => void;

const AFTER_PAINT_FALLBACK_MS = 250;
const IDLE_TIMEOUT_MS = 500;

export function scheduleAfterPaint(
  callback: () => void,
): ScheduleAfterPaintCancel {
  if (typeof window === "undefined" || typeof setTimeout !== "function") {
    return () => {};
  }

  let settled = false;
  const cancels: Array<() => void> = [];
  const settle = () => {
    if (settled) return;
    settled = true;
    for (const cancel of cancels.splice(0)) cancel();
    callback();
  };

  // Hidden tabs never fire requestAnimationFrame and a busy main thread can
  // starve idle callbacks, so this timer bounds the wait: the read always
  // lands, just later than the paint-aligned fast path.
  const fallbackId = setTimeout(settle, AFTER_PAINT_FALLBACK_MS);
  cancels.push(() => clearTimeout(fallbackId));

  const scheduleIdle = () => {
    if (typeof requestIdleCallback === "function") {
      const idleId = requestIdleCallback(settle, { timeout: IDLE_TIMEOUT_MS });
      cancels.push(() => cancelIdleCallback(idleId));
    } else {
      const idleId = setTimeout(settle, 0);
      cancels.push(() => clearTimeout(idleId));
    }
  };

  if (typeof requestAnimationFrame === "function") {
    const scheduleIdleAfterFrame = () => {
      const inner = requestAnimationFrame(() => {
        if (settled) return;
        scheduleIdle();
      });
      cancels.push(() => cancelAnimationFrame(inner));
    };
    const outer = requestAnimationFrame(() => {
      if (settled) return;
      // A single frame's callback still runs before that frame's paint; the
      // second frame runs after the browser has committed the first paint.
      scheduleIdleAfterFrame();
    });
    cancels.push(() => cancelAnimationFrame(outer));
  } else {
    scheduleIdle();
  }

  return () => {
    settled = true;
    for (const cancel of cancels.splice(0)) cancel();
  };
}

/**
 * Opt-in deferral for non-visible startup reads. Returns `false` until the
 * first paint has happened and the main thread has been idle once, then
 * `true` for the rest of the mount. Call sites use it as an `enabled` gate or
 * to schedule their first read, keeping the first-paint window for work the
 * visitor can actually see.
 */
export function useAfterPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => scheduleAfterPaint(() => setReady(true)), []);
  return ready;
}
