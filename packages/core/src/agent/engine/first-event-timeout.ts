/**
 * Shared stream deadlines for model-request engines.
 *
 * Two bounds, both keyed off facts the transport can actually establish:
 *
 *  - FIRST: a request that connects and then streams zero events means the
 *    transport or gateway is wedged, not slow — real models (including deep
 *    thinking ones) emit their first event within seconds.
 *  - TOTAL: the whole request, first event or not, cannot outlive the largest
 *    budget any caller runs inside.
 *
 * AUDIENCE: every `engine.stream()` caller, `runAgentLoop` INCLUDED. The first
 * bound used to be described as shadowed inside the loop by a 90s in-loop
 * watchdog that "always wins"; that watchdog is gone (see
 * run-lifecycle-invariants.ts), so these are now the PRIMARY bounds on a model
 * call that wedges. They survive that deletion because neither infers death
 * from the ABSENCE of a particular event mid-generation — the fact the removed
 * watchdogs got wrong, since the Anthropic SDK drops the provider's `ping`
 * keepalives before any consumer sees them. Do not "clean them up" as
 * redundant, and do not add a no-progress bound back beside them.
 */
export const FIRST_STREAM_EVENT_TIMEOUT_MS = 120_000;

/**
 * Ceiling on one model call end to end, measured from request start.
 *
 * Sized so it can never preempt healthy work: the largest chunk any caller runs
 * inside is the ~13-minute background soft timeout, and a hosted run is bounded
 * by its own chunk long before this. It exists for the runtimes that have no
 * outer budget at all — local dev and self-hosted resolve the soft timeout to
 * `0`, so without this a socket that wedges AFTER the first frame leaves the
 * run pending forever. Mirrors the ceiling builder-engine already applies to
 * its own gateway requests, for the engines that talk to a provider directly.
 */
export const STREAM_TOTAL_TIMEOUT_MS = 14 * 60_000;

export interface FirstEventAbortController {
  readonly signal: AbortSignal;
  /** Idempotent. Call once the first real (non-keepalive) stream event arrives. */
  markFirstEvent: () => void;
  didTimeout: () => boolean;
  /**
   * Which deadline fired, phrased for the user, or `undefined` if none did.
   * Callers must not assume a timeout is the first-event one — after
   * `markFirstEvent()` a timeout means the total deadline, and reporting the
   * wrong one describes a wedged mid-stream socket as a connection that never
   * spoke.
   */
  timeoutMessage: () => string | undefined;
  cleanup: () => void;
}

/**
 * Layer the two deadlines above on top of a caller's AbortSignal. Aborts if
 * `markFirstEvent()` is not called within `FIRST_STREAM_EVENT_TIMEOUT_MS`, and
 * again if the whole request outlives `STREAM_TOTAL_TIMEOUT_MS`. Callers that
 * need a TIGHTER total deadline (e.g. builder-engine's flat gateway timeout)
 * compose their own on top.
 */
export function createFirstEventAbortController(
  parentSignal: AbortSignal,
): FirstEventAbortController {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeoutMessage: string | undefined;
  let firstEventSeen = false;

  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal.reason);
  };

  const fireTimeout = (message: string) => {
    timeoutMessage = message;
    if (!controller.signal.aborted) {
      controller.abort(new Error(message));
    }
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
      if (firstEventSeen || timeoutMessage) return;
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
