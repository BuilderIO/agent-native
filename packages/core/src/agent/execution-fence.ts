import { AsyncLocalStorage } from "node:async_hooks";

import {
  getDbExec,
  getScopedTransactionDbExec,
  type DbExec,
} from "../db/client.js";

export interface ExecutionFence {
  threadId: string;
  turnId: string;
  runId: string;
  generation: string;
  /**
   * A requested Stop expires the run's lease, and the stopped run still has
   * to save what it wrote. This fence holds while the lease names the run and
   * generation, however expired; a worker that claims the turn replaces both.
   */
  outlivesStop?: true;
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

export function currentExecutionFenceForScope(scope: {
  runId?: string;
  threadId?: string;
  turnId?: string;
}): ExecutionFence | undefined {
  const context = executionFenceStorage.getStore();
  const fence = context?.fences.find(
    (candidate) =>
      (!scope.runId || scope.runId === candidate.runId) &&
      (!scope.threadId || scope.threadId === candidate.threadId) &&
      (!scope.turnId || scope.turnId === candidate.turnId),
  );
  if (fence) return fence;
  if (context?.executionLeaseRequested) {
    const activeFence = context.fences.at(-1);
    if (!activeFence) throw new MissingExecutionFenceError();
    throw new StaleExecutionFenceError(activeFence);
  }
  return undefined;
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

export function runWithoutExecutionFence<T>(work: () => T): T {
  // A follow-up turn scheduled by a completed run must not inherit that run's
  // now-expired lease through AsyncLocalStorage.
  return executionFenceStorage.run(
    { fences: [], executionLeaseRequested: false },
    work,
  );
}

export async function lockAndAssertCurrentExecutionFences(
  tx: DbExec,
  ignoredFence?: ExecutionFence,
): Promise<void> {
  const fences = executionFenceStorage.getStore()?.fences ?? [];
  for (const activeFence of fences) {
    if (
      ignoredFence &&
      activeFence.threadId === ignoredFence.threadId &&
      activeFence.turnId === ignoredFence.turnId &&
      activeFence.runId === ignoredFence.runId &&
      activeFence.generation === ignoredFence.generation
    ) {
      continue;
    }
    const { rows } = await tx.execute({
      sql: `SELECT generation
            FROM agent_execution_leases
            WHERE thread_id = ?
              AND turn_id = ?
              AND owner_run_id = ?
              AND generation = CAST(? AS BIGINT)
              ${activeFence.outlivesStop ? "" : "AND lease_expires_at > clock_timestamp()"}
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
  if (getScopedTransactionDbExec() === client) {
    await lockAndAssertCurrentExecutionFences(client);
    return write(client);
  }
  if (!client.transaction) {
    throw new Error("Fenced execution writes require transaction support");
  }
  return client.transaction(async (tx) => {
    await lockAndAssertCurrentExecutionFences(tx);
    return write(tx);
  });
}
