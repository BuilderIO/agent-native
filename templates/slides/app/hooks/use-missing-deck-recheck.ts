import { useEffect, useRef } from "react";

const DEFAULT_RETRY_DELAYS_MS = [1_500, 4_000, 10_000];

export function useMissingDeckRecheck({
  active,
  autoRetry,
  retry,
  delaysMs = DEFAULT_RETRY_DELAYS_MS,
}: {
  active: boolean;
  autoRetry: boolean;
  retry: () => Promise<unknown>;
  delaysMs?: readonly number[];
}) {
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await retryRef.current();
      } catch (error) {
        console.warn("[slides] missing deck re-check failed:", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    const scheduleAttempt = (attempt: number) => {
      if (cancelled || attempt >= delaysMs.length) return;
      timer = setTimeout(() => {
        void run().then(() => scheduleAttempt(attempt + 1));
      }, delaysMs[attempt]);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    if (autoRetry) scheduleAttempt(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [active, autoRetry, delaysMs]);
}
