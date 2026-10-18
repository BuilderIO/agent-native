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

const executionFenceStorage = new AsyncLocalStorage<ExecutionFence>();

export function currentExecutionFence(): ExecutionFence | undefined {
  return executionFenceStorage.getStore();
}

export function withExecutionFence<T>(fence: ExecutionFence, work: () => T): T {
  return executionFenceStorage.run(fence, work);
}

export async function withFencedExecutionWrite<T>(
  write: (tx: DbExec) => Promise<T>,
  scope?: { runId?: string; threadId?: string; turnId?: string },
): Promise<T> {
  const fence = currentExecutionFence();
  const client = getDbExec();
  if (!fence) return write(client);
  if (
    (scope?.runId && scope.runId !== fence.runId) ||
    (scope?.threadId && scope.threadId !== fence.threadId) ||
    (scope?.turnId && scope.turnId !== fence.turnId)
  ) {
    throw new StaleExecutionFenceError(fence);
  }
  if (!client.transaction) {
    throw new Error("Fenced execution writes require transaction support");
  }
  return client.transaction(async (tx) => {
    const { rows } = await tx.execute({
      sql: `SELECT generation
            FROM agent_execution_leases
            WHERE thread_id = ?
              AND turn_id = ?
              AND owner_run_id = ?
              AND generation = CAST(? AS BIGINT)
              AND lease_expires_at > clock_timestamp()
            FOR UPDATE`,
      args: [fence.threadId, fence.turnId, fence.runId, fence.generation],
    });
    if (rows.length !== 1) throw new StaleExecutionFenceError(fence);
    return write(tx);
  });
}
