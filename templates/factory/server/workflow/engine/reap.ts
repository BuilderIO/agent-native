import {
  WORKFLOW_STORE_LIMITS,
  WorkflowStoreError,
  type WorkflowHost,
  type WorkflowScope,
} from "../adapter.js";
import { RUN_STALE_MARGIN_MS } from "./constants.js";

/**
 * How long a run may stay `running` before the next tick calls it dead: the
 * longest the scheduler lets a tick run, with a margin, and never less than a
 * lease. A host that does not say takes the lease lifetime.
 */
export function runStaleAfterMs(host: WorkflowHost): number {
  return host.runTimeoutMs === undefined
    ? WORKFLOW_STORE_LIMITS.leaseTtlMs
    : Math.max(
        WORKFLOW_STORE_LIMITS.leaseTtlMs,
        host.runTimeoutMs + RUN_STALE_MARGIN_MS,
      );
}

/**
 * Finishes the runs of a workflow that a killed function left `running`: a run
 * still open after `runStaleAfterMs` is not working, since any tick that began
 * within it has long been stopped by the scheduler's hard deadline. Each is
 * marked failed with `run_interrupted`, keeping the counts it has, and
 * reported through the host's tripwire. A run still inside that time may be
 * alive and is never touched.
 */
export async function reapInterruptedRuns(
  host: WorkflowHost,
  scope: WorkflowScope,
  workflowId: string,
): Promise<void> {
  const now = host.clock.now();
  const staleAfterMs = runStaleAfterMs(host);
  const open = await host.store.listRuns(scope, {
    workflowId,
    status: "running",
    limit: WORKFLOW_STORE_LIMITS.runsPageMax,
  });
  for (const run of open.items) {
    const ageMs = now.getTime() - Date.parse(run.startedAt);
    if (!(ageMs > staleAfterMs)) continue;
    try {
      await host.store.finishRun(scope, {
        runId: run.id,
        status: "failed",
        counts: run.counts,
        error: {
          code: "run_interrupted",
          message: `The function running this tick stopped before it finished: it started at ${run.startedAt} and nothing has closed it in the ${Math.round(ageMs / 60_000)} minutes since.`,
        },
        finishedAt: now.toISOString(),
      });
    } catch (error) {
      // Another tick closed it between the list and here; it is finished either way.
      if (
        error instanceof WorkflowStoreError &&
        error.code === "invalid_transition"
      ) {
        continue;
      }
      throw error;
    }
    host.tripwire?.({
      area: "scheduler",
      code: "runner_stale_active",
      severity: "warn",
      workflowId,
      runId: run.id,
      details: { ageMs, mode: run.mode, startedAt: run.startedAt },
    });
  }
}
