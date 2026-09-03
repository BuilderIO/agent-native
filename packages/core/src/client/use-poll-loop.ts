import { useEffect, useRef } from "react";

import { createPollEngine } from "../shared/poll-engine.js";

const HIDDEN_INTERVAL_FLOOR_MS = 10_000;

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export interface UsePollLoopOptions {
  /** Delay in ms between attempts while the tab is visible. */
  intervalMs: number;
  /** Per-attempt timeout. Default: `Math.max(timeoutFloorMs, intervalMs * 4)`. */
  timeoutMs?: number;
  /** Floor used by the default `timeoutMs`. Default: 10_000. */
  timeoutFloorMs?: number;
  /** Called when an attempt throws or times out. Default: swallow. */
  onError?: (err: unknown) => void;
  /** Run the first attempt immediately on mount. Default: true. */
  leading?: boolean;
  /** Set to false to tear the loop down without unmounting the caller. Default: true. */
  enabled?: boolean;
  /**
   * true: fully stop while the tab is hidden, resuming immediately when it
   * becomes visible again. false (default): keep polling at a relaxed
   * cadence (`Math.max(intervalMs, hiddenIntervalFloorMs)`) — use this for
   * loops that must still reach a backgrounded tab (e.g. browser
   * notifications).
   */
  pauseWhenHidden?: boolean;
  /** Floor for the relaxed hidden-tab cadence when `pauseWhenHidden` is false. Default: 10_000. */
  hiddenIntervalFloorMs?: number;
}

export interface UsePollLoopHandle {
  /** Cancel the pending wait and run an attempt now. */
  pollNow: () => void;
}

/**
 * Poll a network endpoint on a recurring cadence without hand-rolling a
 * visibility check, an in-flight guard, or a request timeout — see
 * `createPollEngine` for the underlying guarantees. `attempt` receives an
 * `AbortSignal`; pass it to `fetch` for real cancellation on timeout.
 *
 * Supersedes `usePausingInterval`, which pauses/resumes on visibility but has
 * no request timeout and schedules via `setInterval` rather than a
 * settle-then-reschedule loop.
 */
export function usePollLoop(
  attempt: (signal: AbortSignal) => Promise<void>,
  options: UsePollLoopOptions,
): UsePollLoopHandle {
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const pollNowRef = useRef<() => void>(() => {});

  const {
    intervalMs,
    timeoutMs,
    timeoutFloorMs,
    onError,
    leading,
    enabled = true,
    pauseWhenHidden = false,
    hiddenIntervalFloorMs = HIDDEN_INTERVAL_FLOOR_MS,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    const engine = createPollEngine((signal) => attemptRef.current(signal), {
      intervalMs: pauseWhenHidden
        ? intervalMs
        : () =>
            isDocumentHidden()
              ? Math.max(intervalMs, hiddenIntervalFloorMs)
              : intervalMs,
      timeoutMs,
      timeoutFloorMs,
      onError,
      leading,
    });
    pollNowRef.current = () => engine.pollNow();
    // Mounting in an already-hidden tab (background restore, prerender) must
    // not fire the leading attempt when pauseWhenHidden promises a full pause
    // while hidden — the visibility handler below starts the loop instead.
    if (!pauseWhenHidden || !isDocumentHidden()) engine.start();

    const onVisibilityChange = (): void => {
      if (isDocumentHidden()) {
        if (pauseWhenHidden) engine.stop();
        else engine.reschedule();
      } else if (pauseWhenHidden) {
        engine.start();
      } else {
        engine.pollNow();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      engine.stop();
      pollNowRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    intervalMs,
    timeoutMs,
    timeoutFloorMs,
    onError,
    leading,
    enabled,
    pauseWhenHidden,
    hiddenIntervalFloorMs,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pollNow: () => pollNowRef.current() };
}
