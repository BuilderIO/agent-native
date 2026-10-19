import { AsyncLocalStorage } from "node:async_hooks";

import { getDbExec, type DbExec } from "../db/client.js";

export interface ExecutionFence {
  threadId: string;
  turnId: string;
  runId: string;
  generation: string;
}

export class StaleExecutionFenceError extends Error {
  readonly code = "stale_execution_fence";

  constructor(fence: ExecutionFence) {
    super(
      `Execution lease generation ${fence.generation} for turn ${fence.turnId} is no longer current`,
    );
    this.name = "StaleExecutionFenceError";
  }
}

const executionFenceStorage = new AsyncLocalStorage<ExecutionFence[]>();

export function currentExecutionFence(): ExecutionFence | undefined {
  const fences = executionFenceStorage.getStore();
  return fences?.at(-1);
}

export function withExecutionFence<T>(fence: ExecutionFence, work: () => T): T {
  const current = executionFenceStorage.getStore() ?? [];
  const sameFence = current.some(
    (candidate) =>
      candidate.threadId === fence.threadId &&
      candidate.turnId === fence.turnId &&
      candidate.runId === fence.runId &&
      candidate.generation === fence.generation,
  );
  return executionFenceStorage.run(
    sameFence ? current : [...current, fence],
    work,
  );
}

export async function lockAndAssertCurrentExecutionFences(
  tx: DbExec,
): Promise<void> {
  const fences = executionFenceStorage.getStore() ?? [];
  for (const activeFence of fences) {
    const { rows } = await tx.execute({
      sql: `SELECT generation
            FROM agent_execution_leases
            WHERE thread_id = ?
              AND turn_id = ?
              AND owner_run_id = ?
              AND generation = CAST(? AS BIGINT)
              AND lease_expires_at > clock_timestamp()
            FOR UPDATE`,
      args: [
        activeFence.threadId,
        activeFence.turnId,
        activeFence.runId,
        activeFence.generation,
      ],
    });
    if (rows.length !== 1) throw new StaleExecutionFenceError(activeFence);
  }
}

export async function withFencedExecutionWrite<T>(
  write: (tx: DbExec) => Promise<T>,
  scope?: { runId?: string; threadId?: string; turnId?: string },
): Promise<T> {
  const fences = executionFenceStorage.getStore() ?? [];
  const fence = fences.at(-1);
  const client = getDbExec();
  if (!fence) return write(client);
  // A nested task/run write can target either active scope; both leases still gate it.
  const scopedFence = fences.find(
    (candidate) =>
      (!scope?.runId || scope.runId === candidate.runId) &&
      (!scope?.threadId || scope.threadId === candidate.threadId) &&
      (!scope?.turnId || scope.turnId === candidate.turnId),
  );
  if (!scopedFence) {
    throw new StaleExecutionFenceError(fence);
  }
  if (!client.transaction) {
    throw new Error("Fenced execution writes require transaction support");
  }
  return client.transaction(async (tx) => {
    await lockAndAssertCurrentExecutionFences(tx);
    return write(tx);
  });
}
