/**
 * Shared "first stream event" deadline for model-request engines.
 *
 * A request that connects successfully but then streams zero events means the
 * transport or gateway is wedged, not slow — real models (including deep
 * thinking ones) emit their first event within seconds. Bounding this window
 * separately from any total-request deadline turns a silent multi-minute hang
 * into a fast abort-and-retry.
 */
export const FIRST_STREAM_EVENT_TIMEOUT_MS = 120_000;

export interface FirstEventAbortController {
  readonly signal: AbortSignal;
  /** Idempotent. Call once the first real (non-keepalive) stream event arrives. */
  markFirstEvent: () => void;
  didTimeout: () => boolean;
  cleanup: () => void;
}

/**
 * Layer a first-event deadline on top of a caller's AbortSignal. Aborts if
 * `markFirstEvent()` is not called within `FIRST_STREAM_EVENT_TIMEOUT_MS`.
 * Has no opinion on a total-request deadline — callers that need one (e.g.
 * builder-engine's flat gateway timeout) compose their own on top.
 */
export function createFirstEventAbortController(
  parentSignal: AbortSignal,
): FirstEventAbortController {
  const controller = new AbortController();
  let timedOut = false;
  let firstEventSeen = false;

  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal.reason);
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) {
      controller.abort(
        new Error(
          `Model request produced no stream events within ${FIRST_STREAM_EVENT_TIMEOUT_MS / 1000}s`,
        ),
      );
    }
  }, FIRST_STREAM_EVENT_TIMEOUT_MS);

  if (parentSignal.aborted) abortFromParent();
  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    markFirstEvent: () => {
      if (firstEventSeen) return;
      firstEventSeen = true;
      clearTimeout(timeout);
    },
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}
