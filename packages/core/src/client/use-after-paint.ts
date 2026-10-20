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

export function useAfterPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => scheduleAfterPaint(() => setReady(true)), []);
  return ready;
}

/**
 * How long into a page load background status reads wait. The paint-aligned
 * wait above settles within 250-500ms, well before a route's first content on
 * a real workspace, so reads that only feed badges and setup hints still
 * competed with it for the server and its database connections.
 */
const STARTUP_SETTLE_MS = 3_000;

function startupSettleRemainingMs(): number {
  if (typeof performance === "undefined") return 0;
  return Math.max(0, STARTUP_SETTLE_MS - performance.now());
}

/**
 * `scheduleAfterPaint`, but never before the page is `STARTUP_SETTLE_MS` old.
 * Later in the page's life it is `scheduleAfterPaint` unchanged.
 */
export function scheduleAfterStartup(
  callback: () => void,
): ScheduleAfterPaintCancel {
  if (typeof window === "undefined" || typeof setTimeout !== "function") {
    return () => {};
  }
  let cancelAfterPaint: ScheduleAfterPaintCancel | null = null;
  const timer = setTimeout(() => {
    cancelAfterPaint = scheduleAfterPaint(callback);
  }, startupSettleRemainingMs());
  return () => {
    clearTimeout(timer);
    cancelAfterPaint?.();
  };
}

export function useAfterStartup(): boolean {
  const [ready, setReady] = useState(
    () => typeof window !== "undefined" && startupSettleRemainingMs() === 0,
  );
  useEffect(() => {
    if (ready) return;
    return scheduleAfterStartup(() => setReady(true));
  }, [ready]);
  return ready;
}
