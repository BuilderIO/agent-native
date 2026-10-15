import { SelfDispatchHttpError } from "../../server/self-dispatch.js";
import type {
  ChainServerDrivenContinuationDeps,
  ContinuationDispatchBudget,
} from "../production-agent.js";

export type ContinuationDispatchRetryDeps = Required<
  Pick<
    ChainServerDrivenContinuationDeps,
    | "sleep"
    | "updateRunHeartbeat"
    | "fireInternalDispatch"
    | "readBackgroundRunClaim"
  >
>;

// These statuses mean the endpoint is shedding load, not that the handoff is
// dead. They are waited out with jittered backoff instead of spending the short
// fixed attempt cap, which deferred the chunk to the sweep's multi-minute gap.
const OVERLOAD_STATUSES = new Set([429, 502, 503, 504, 520]);
const OVERLOAD_BACKOFF_BASE_MS = 1_000;
const OVERLOAD_BACKOFF_CAP_MS = 30_000;
const RETRY_AFTER_CLAMP_MS = 60_000;
// Full jitter can draw ~0 forever, so the wait budget alone never drains.
const MAX_OVERLOAD_RETRIES = 8;

/** Delay before the next try, or null when waiting any longer is pointless. */
function overloadBackoffMs(
  err: SelfDispatchHttpError,
  retriesSoFar: number,
  waitedMs: number,
  budgetMs: number,
  random: () => number,
): number | null {
  if (retriesSoFar >= MAX_OVERLOAD_RETRIES) return null;
  const remainingMs = budgetMs - waitedMs;
  if (remainingMs <= 0) return null;
  const retryAfterMs = Math.min(err.retryAfterMs ?? 0, RETRY_AFTER_CLAMP_MS);
  // The server asked for longer than this run can wait; the sweep owns it.
  if (retryAfterMs > remainingMs) return null;
  const ceilingMs = Math.min(
    OVERLOAD_BACKOFF_CAP_MS,
    OVERLOAD_BACKOFF_BASE_MS * 2 ** retriesSoFar,
  );
  return Math.min(Math.max(random() * ceilingMs, retryAfterMs), remainingMs);
}

export async function attemptContinuationDispatch(params: {
  event: unknown;
  chainViaDurableBackground: boolean;
  backgroundContinuationCount: number;
  nextRunId: string;
  nextRowInserted: boolean;
  continuationDispatchPath: string;
  dispatchBody: Record<string, unknown>;
  dispatchBudget: ContinuationDispatchBudget;
  isLoopProtectionDispatchError: (err: unknown) => boolean;
  maxNestedSelfDispatchDepth: number;
  deps: ContinuationDispatchRetryDeps;
  random?: () => number;
  /** Wall clock for the overload budget; injectable so specs need no timers. */
  now?: () => number;
}): Promise<{
  dispatched: boolean;
  lastDispatchErr: unknown;
  nestedDepthExceeded: boolean;
}> {
  const {
    event,
    backgroundContinuationCount,
    nextRunId,
    nextRowInserted,
    continuationDispatchPath,
    dispatchBody,
    dispatchBudget,
    isLoopProtectionDispatchError,
    maxNestedSelfDispatchDepth,
    deps: d,
    random = Math.random,
    now = Date.now,
  } = params;
  const maxDispatchAttempts = dispatchBudget.maxDispatchAttempts;
  const dispatchResponseTimeoutMs = dispatchBudget.dispatchResponseTimeoutMs;
  const overloadWaitBudgetMs = dispatchBudget.overloadWaitBudgetMs;

  let dispatched = false;
  let lastDispatchErr: unknown;
  const nestedDepthExceeded =
    backgroundContinuationCount >= maxNestedSelfDispatchDepth;
  if (nestedDepthExceeded) {
    lastDispatchErr = new Error(
      `proactive nested-dispatch depth cap reached (backgroundContinuationCount=${backgroundContinuationCount} >= MAX_NESTED_SELF_DISPATCH_DEPTH=${maxNestedSelfDispatchDepth}) — deferring to the unclaimed-background-run sweep instead of risking Netlify loop protection`,
    );
  }
  const startedAt = now();
  // Overload retries are paid for by the wait budget, not the attempt cap.
  let overloadRetries = 0;
  let overloadWaitedMs = 0;
  let failedAttempts = 0;
  let nextBackoffMs = 0;
  for (
    let attempt = 0;
    !nestedDepthExceeded &&
    attempt < maxDispatchAttempts + overloadRetries &&
    !dispatched;
    attempt++
  ) {
    try {
      if (attempt > 0) {
        await d.sleep(nextBackoffMs);
        if (nextRowInserted) {
          await d.updateRunHeartbeat(nextRunId).catch(() => {});
        }
      }
      await d.fireInternalDispatch({
        event,
        path: continuationDispatchPath,
        taskId: nextRunId,
        body: dispatchBody,
        awaitResponse: true,
        responseTimeoutMs: dispatchResponseTimeoutMs,
      });
      dispatched = true;
    } catch (dispatchErr) {
      lastDispatchErr = dispatchErr;
      if (nextRowInserted) {
        const claim = await d
          .readBackgroundRunClaim(nextRunId)
          .catch(() => null);
        if (
          claim &&
          ((claim.dispatchMode && claim.dispatchMode !== "background") ||
            (claim.status && claim.status !== "running"))
        ) {
          dispatched = true;
          break;
        }
      }
      console.error(
        `[agent-chat] background continuation dispatch attempt ${attempt + 1} failed:`,
        dispatchErr instanceof Error ? dispatchErr.message : dispatchErr,
      );
      if (isLoopProtectionDispatchError(dispatchErr)) {
        break;
      }
      if (
        dispatchErr instanceof SelfDispatchHttpError &&
        OVERLOAD_STATUSES.has(dispatchErr.httpStatus)
      ) {
        const backoffMs = overloadBackoffMs(
          dispatchErr,
          overloadRetries,
          // Slow overload responses spend the same host time as the sleeps.
          Math.max(overloadWaitedMs, now() - startedAt),
          overloadWaitBudgetMs,
          random,
        );
        if (backoffMs === null) break;
        overloadRetries++;
        overloadWaitedMs += backoffMs;
        nextBackoffMs = backoffMs;
      } else {
        failedAttempts++;
        nextBackoffMs = Number.isFinite(dispatchBudget.backoffCapMs)
          ? Math.min(
              500 * 2 ** (failedAttempts - 1),
              dispatchBudget.backoffCapMs,
            )
          : 500 * 2 ** failedAttempts;
      }
    }
  }
  return { dispatched, lastDispatchErr, nestedDepthExceeded };
}
