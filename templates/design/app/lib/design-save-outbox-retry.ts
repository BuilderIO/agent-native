// A queued edit the server keeps refusing is retried with growing gaps.
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

/** How often a drain that threw before settling any entry is retried before it waits for a page event. */
export const MAX_DRAIN_FAILURE_RETRIES = 3;

/** The gap before re-checking while this tab's own saves are still in flight. */
export const OUTBOX_BUSY_RETRY_MS = 1_000;

export interface OutboxRetryScheduler {
  /** Arms one retry; does nothing while one is pending or after `dispose`. */
  schedule(delayMs?: number): void;
  /** Drops the pending retry, for a retry that is about to run now. */
  cancel(): void;
  /** Starts the backoff over once a drain leaves nothing failed. */
  resetBackoff(): void;
  /** Drops the pending retry and refuses new ones until `activate`. */
  dispose(): void;
  activate(): void;
}

export function createOutboxRetryScheduler(
  run: () => void,
): OutboxRetryScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let disposed = false;
  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  return {
    schedule(delayMs) {
      if (disposed || timer !== null) return;
      const gap =
        delayMs ??
        RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      if (delayMs === undefined) attempt += 1;
      timer = setTimeout(() => {
        timer = null;
        run();
      }, gap);
    },
    cancel,
    resetBackoff() {
      attempt = 0;
    },
    dispose() {
      disposed = true;
      cancel();
    },
    activate() {
      disposed = false;
    },
  };
}
