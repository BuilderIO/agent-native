import type {
  ChainServerDrivenContinuationDeps,
  ContinuationDispatchBudget,
} from "../production-agent.js";

/**
 * The subset of `ChainServerDrivenContinuationDeps` this stage needs,
 * already resolved to their non-optional defaults (mirrors how
 * `chainServerDrivenContinuation` builds its local `d` object).
 */
export type ContinuationDispatchRetryDeps = Required<
  Pick<
    ChainServerDrivenContinuationDeps,
    | "sleep"
    | "updateRunHeartbeat"
    | "fireInternalDispatch"
    | "readBackgroundRunClaim"
  >
>;

/**
 * Attempts to deliver one background-continuation dispatch, retrying with
 * backoff up to `dispatchBudget.maxDispatchAttempts` times.
 *
 * Moved verbatim out of `chainServerDrivenContinuation`'s "TRANSACTIONAL
 * HANDOFF" section — behavior, ordering, and error handling unchanged. The
 * caller is still responsible for: minting `nextRunId`, inserting the
 * successor row, building `dispatchBody`, and handling the
 * deferred-recovery / fatal-error paths after this returns.
 *
 * `isLoopProtectionDispatchError` and `maxNestedSelfDispatchDepth` are
 * passed in (rather than imported) so this module has no runtime import
 * back on `production-agent.js` — only the type-only import above, which
 * TypeScript erases.
 */
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
}): Promise<{
  dispatched: boolean;
  lastDispatchErr: unknown;
  nestedDepthExceeded: boolean;
}> {
  const {
    event,
    chainViaDurableBackground,
    backgroundContinuationCount,
    nextRunId,
    nextRowInserted,
    continuationDispatchPath,
    dispatchBody,
    dispatchBudget,
    isLoopProtectionDispatchError,
    maxNestedSelfDispatchDepth,
    deps: d,
  } = params;
  const maxDispatchAttempts = dispatchBudget.maxDispatchAttempts;
  const dispatchResponseTimeoutMs = dispatchBudget.dispatchResponseTimeoutMs;

  let dispatched = false;
  let lastDispatchErr: unknown;
  // Proactive nested-chain safety margin — see `MAX_NESTED_SELF_DISPATCH_DEPTH`.
  // Skip the nested dispatch attempt entirely once this segment's hop count
  // reaches the cap; a nested attempt at this depth is expected to trip
  // Netlify's loop protection, so there is nothing to gain by trying it and
  // burning this worker's remaining wall clock on a doomed call. Falls
  // straight into the same deferred-recovery path below as an exhausted
  // retry budget.
  const nestedDepthExceeded =
    backgroundContinuationCount >= maxNestedSelfDispatchDepth;
  if (nestedDepthExceeded) {
    lastDispatchErr = new Error(
      `proactive nested-dispatch depth cap reached (backgroundContinuationCount=${backgroundContinuationCount} >= MAX_NESTED_SELF_DISPATCH_DEPTH=${maxNestedSelfDispatchDepth}) — deferring to the unclaimed-background-run sweep instead of risking Netlify loop protection`,
    );
  }
  for (
    let attempt = 0;
    !nestedDepthExceeded && attempt < maxDispatchAttempts && !dispatched;
    attempt++
  ) {
    try {
      if (attempt > 0) {
        // Uncapped budgets (durable-background and true-foreground) keep
        // the original `500 * 2 ** attempt` schedule unchanged. The capped
        // budget (proven-in-background-function) instead uses a schedule
        // starting at 500ms and doubling per gap, capped at
        // `backoffCapMs` — see `resolveContinuationDispatchBudget` for why
        // this stays well inside the worker's remaining wall clock even
        // with 5 attempts.
        const backoffMs = Number.isFinite(dispatchBudget.backoffCapMs)
          ? Math.min(500 * 2 ** (attempt - 1), dispatchBudget.backoffCapMs)
          : 500 * 2 ** attempt;
        await d.sleep(backoffMs);
        // Keep the pre-inserted successor row visibly alive while we
        // retry: the awaited attempts + backoff can outlast
        // UNCLAIMED_BACKGROUND_RUN_GRACE_MS (25s), and without a fresh
        // heartbeat the unclaimed-run reaper / sweep could error a handoff
        // we are still delivering.
        if (nextRowInserted) {
          await d.updateRunHeartbeat(nextRunId).catch(() => {});
        }
      }
      await d.fireInternalDispatch({
        event,
        // Durable chain: same path resolution as the initial dispatch —
        // on hosted Netlify the background function's DEFAULT url (no
        // custom config.path; async via background:true; never shadowed
        // because /.netlify/* is excluded from the /* catch-all) so each
        // chunk keeps the 15-min budget; off-Netlify the in-process
        // framework route. Foreground self-chain: always the framework
        // `_process-run` route on the regular function (see the fn doc).
        path: continuationDispatchPath,
        taskId: nextRunId,
        body: dispatchBody,
        awaitResponse: true,
        responseTimeoutMs: dispatchResponseTimeoutMs,
      });
      dispatched = true;
    } catch (dispatchErr) {
      lastDispatchErr = dispatchErr;
      // Regular-function targets (foreground self-chain) respond only
      // after the successor chunk FINISHES, so an await timeout is not
      // proof of a dead handoff. The successor's ATOMIC CLAIM is: a row
      // that left `dispatch_mode='background'` (claimed) or is already
      // terminal proves the handoff landed — stop retrying. A duplicate
      // delivery would lose the claim and no-op anyway; skipping it saves
      // wall-clock this close to the invocation deadline.
      if (!chainViaDurableBackground && nextRowInserted) {
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
      // Netlify loop protection (see `isLoopProtectionDispatchError`) is a
      // property of this same live, nested call chain — retrying the exact
      // same nested self-dispatch within the next few seconds will not
      // change that, so further attempts are a guaranteed-doomed use of
      // this worker's remaining wall clock. Stop immediately (instead of
      // burning the full `maxDispatchAttempts` budget) and fall into the
      // same deferred-recovery path below, which hands the successor to the
      // sweep — a genuinely different, non-nested invocation.
      if (isLoopProtectionDispatchError(dispatchErr)) {
        break;
      }
    }
  }
  return { dispatched, lastDispatchErr, nestedDepthExceeded };
}
