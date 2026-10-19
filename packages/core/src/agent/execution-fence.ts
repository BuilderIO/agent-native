import { AsyncLocalStorage } from "node:async_hooks";

import { getDbExec, type DbExec } from "../db/client.js";

export interface ExecutionFence {
  threadId: string;
  turnId: string;
  runId: string;
  generation: string;
}

interface ExecutionFenceContext {
  fences: ExecutionFence[];
  executionLeaseRequested: boolean;
}

export class ExecutionFenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class StaleExecutionFenceError extends ExecutionFenceError {
  constructor(fence: ExecutionFence) {
    super(
      "stale_execution_fence",
      `Execution lease generation ${fence.generation} for turn ${fence.turnId} is no longer current`,
    );
  }
}

export class MissingExecutionFenceError extends ExecutionFenceError {
  constructor() {
    super(
      "missing_execution_fence",
      "Execution lease was requested without an execution fence",
    );
  }
}

const executionFenceStorage = new AsyncLocalStorage<ExecutionFenceContext>();

export function currentExecutionFence(): ExecutionFence | undefined {
  const context = executionFenceStorage.getStore();
  const fence = context?.fences.at(-1);
  if (!fence && context?.executionLeaseRequested) {
    throw new MissingExecutionFenceError();
  }
  return fence;
}

export function withExecutionLeaseRequested<T>(work: () => T): T {
  const current = executionFenceStorage.getStore();
  return executionFenceStorage.run(
    {
      fences: current?.fences ?? [],
      executionLeaseRequested: true,
    },
    work,
  );
}

export function withExecutionFence<T>(fence: ExecutionFence, work: () => T): T {
  const current = executionFenceStorage.getStore();
  const fences = current?.fences ?? [];
  const sameFence = fences.some(
    (candidate) =>
      candidate.threadId === fence.threadId &&
      candidate.turnId === fence.turnId &&
      candidate.runId === fence.runId &&
      candidate.generation === fence.generation,
  );
  return executionFenceStorage.run(
    {
      fences: sameFence ? fences : [...fences, fence],
      executionLeaseRequested: true,
    },
    work,
  );
}

export async function lockAndAssertCurrentExecutionFences(
  tx: DbExec,
): Promise<void> {
  const fences = executionFenceStorage.getStore()?.fences ?? [];
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
  const context = executionFenceStorage.getStore();
  const fences = context?.fences ?? [];
  const fence = fences.at(-1);
  const client = getDbExec();
  if (!fence) {
    if (context?.executionLeaseRequested)
      throw new MissingExecutionFenceError();
    return write(client);
  }
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
