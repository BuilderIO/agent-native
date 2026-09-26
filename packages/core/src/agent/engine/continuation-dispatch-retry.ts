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
        const backoffMs = Number.isFinite(dispatchBudget.backoffCapMs)
          ? Math.min(500 * 2 ** (attempt - 1), dispatchBudget.backoffCapMs)
          : 500 * 2 ** attempt;
        await d.sleep(backoffMs);
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
    }
  }
  return { dispatched, lastDispatchErr, nestedDepthExceeded };
}
