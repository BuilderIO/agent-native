import { useEffect, useRef } from "react";

import { createPollEngine } from "../shared/poll-engine.js";

const HIDDEN_INTERVAL_FLOOR_MS = 10_000;

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export interface UsePollLoopOptions {
  intervalMs: number;
  timeoutMs?: number;
  timeoutFloorMs?: number;
  onError?: (err: unknown) => void;
  leading?: boolean;
  enabled?: boolean;
  pauseWhenHidden?: boolean;
  hiddenIntervalFloorMs?: number;
}

export interface UsePollLoopHandle {
  pollNow: () => void;
}

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
