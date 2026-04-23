import { useEffect } from "react";

/**
 * Runs `callback` on an interval, pausing when the tab becomes hidden and
 * resuming (with an immediate re-run) when the tab becomes visible again.
 * Fires `callback` once immediately on mount (if the tab is visible).
 *
 * Pass `pollMs=0` to disable. Pass `pauseWhenHidden=false` to keep the
 * interval running even when the tab is hidden — the bell's browser-
 * notification popup loop uses that to still reach backgrounded tabs.
 */
export function usePausingInterval(
  callback: () => void | Promise<void>,
  pollMs: number,
  pauseWhenHidden: boolean = true,
): void {
  useEffect(() => {
    if (pollMs <= 0) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id == null) id = setInterval(callback, pollMs);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };

    callback();

    if (!pauseWhenHidden) {
      start();
      return () => stop();
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        callback();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [callback, pollMs, pauseWhenHidden]);
}
