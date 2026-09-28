export const FIRST_STREAM_EVENT_TIMEOUT_MS = 120_000;

export const STREAM_TOTAL_TIMEOUT_MS = 14 * 60_000;

export interface FirstEventAbortController {
  readonly signal: AbortSignal;
  markFirstEvent: () => void;
  didTimeout: () => boolean;
  timeoutMessage: () => string | undefined;
  cleanup: () => void;
}

export function createFirstEventAbortController(
  parentSignal: AbortSignal,
): FirstEventAbortController {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeoutMessage: string | undefined;
  let firstEventSeen = false;

  const abortFromParent = () => {
    clearTimeout(timeout);
    if (!controller.signal.aborted) controller.abort(parentSignal.reason);
  };

  const fireTimeout = (message: string) => {
    // Record a timeout ONLY when this controller wins the abort race. Setting
    // the message first and checking `aborted` after made a deadline that
    // merely fired into an already-aborted controller indistinguishable from
    // one that caused the abort — and `didTimeout()` is what the engines read
    // to decide a failure was the transport's fault and worth retrying.
    if (controller.signal.aborted) return;
    timeoutMessage = message;
    controller.abort(new Error(message));
  };

  let timeout = setTimeout(() => {
    fireTimeout(
      `Model request produced no stream events within ${FIRST_STREAM_EVENT_TIMEOUT_MS / 1000}s`,
    );
  }, FIRST_STREAM_EVENT_TIMEOUT_MS);

  if (parentSignal.aborted) abortFromParent();
  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    markFirstEvent: () => {
      if (firstEventSeen || controller.signal.aborted) return;
      firstEventSeen = true;
      clearTimeout(timeout);
      timeout = setTimeout(
        () => {
          fireTimeout(
            `Model request exceeded the ${STREAM_TOTAL_TIMEOUT_MS / 60_000}-minute total stream deadline`,
          );
        },
        Math.max(0, STREAM_TOTAL_TIMEOUT_MS - (Date.now() - startedAt)),
      );
    },
    didTimeout: () => timeoutMessage !== undefined,
    timeoutMessage: () => timeoutMessage,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}
