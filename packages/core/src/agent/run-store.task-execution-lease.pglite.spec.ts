import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { withExecutionFence } from "./execution-fence.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => getExecutor(),
}));

function getExecutor(): DbExec {
  return {
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: pglite.transaction,
  };
}

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

const {
  beginAgentExecutionStep,
  claimBackgroundRun,
  claimTaskExecutionLease,
  claimTurnExecutionLease,
  clearLedgerForThread,
  finalizeClaimedBackgroundRunFailure,
  getLastTerminalRunEvent,
  markAgentExecutionStepDispatched,
  recordLateAgentExecutionStepOutcome,
  ensureRunTables,
  insertRun,
  readBackgroundRunClaim,
  reapIfStale,
  renewTaskExecutionLease,
  updateRunTerminalStateIfRunning,
  writeLedgerEntry,
} = await import("./run-store.js");

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
});

afterAll(async () => {
  await pglite?.close();
});

describe("task execution leases", () => {
  it("claims and renews without an agent_runs row, then fences stale generations", async () => {
    const threadId = "a2a-task:lease-test";
    const turnId = "lease-test";
    const firstFence = await claimTaskExecutionLease(
      threadId,
      turnId,
      "a2a:worker-a",
    );

    const owner = await pglite.query("SELECT id FROM agent_runs WHERE id = ?", [
      firstFence.runId,
    ]);
    expect(owner.rows).toHaveLength(0);
    await renewTaskExecutionLease(firstFence);
    await expect(
      claimTaskExecutionLease(threadId, turnId, "a2a:worker-b"),
    ).rejects.toMatchObject({ code: "turn_execution_lease_busy" });

    await pglite.query(
      `UPDATE agent_execution_leases
          SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
          WHERE thread_id = ? AND turn_id = ?`,
      [threadId, turnId],
    );
    const secondFence = await claimTaskExecutionLease(
      threadId,
      turnId,
      "a2a:worker-b",
    );
    expect(BigInt(secondFence.generation)).toBe(
      BigInt(firstFence.generation) + 1n,
    );

    const staleStep = {
      ...firstFence,
      stepId: "stale-step",
      operationId: "test:step",
      toolName: "test-step",
      inputJson: "{}",
      replayPolicy: "never" as const,
    };
    await expect(
      withExecutionFence(firstFence, () => beginAgentExecutionStep(staleStep)),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });

    const currentStep = {
      ...secondFence,
      stepId: "current-step",
      operationId: "test:step",
      toolName: "test-step",
      inputJson: "{}",
      replayPolicy: "never" as const,
    };
    await expect(
      withExecutionFence(secondFence, () =>
        beginAgentExecutionStep(currentStep),
      ),
    ).resolves.toEqual({ status: "execute", wasDispatched: false });
  });

  it("keeps a parent task fence active inside a nested agent-run fence", async () => {
    const taskThreadId = "a2a-task:nested-fence-test";
    const taskTurnId = "nested-fence-test";
    const runId = "nested-fence-run";
    const taskFence = await claimTaskExecutionLease(
      taskThreadId,
      taskTurnId,
      "a2a:worker",
    );
    await insertRun(runId, runId, runId);
    const runFence = await claimTurnExecutionLease(runId, runId, runId);
    const step = {
      ...runFence,
      stepId: "nested-step",
      operationId: "test:nested-step",
      toolName: "nested-step",
      inputJson: "{}",
      replayPolicy: "never" as const,
    };

    await expect(
      withExecutionFence(taskFence, () =>
        withExecutionFence(runFence, () => beginAgentExecutionStep(step)),
      ),
    ).resolves.toEqual({ status: "execute", wasDispatched: false });

    await pglite.query(
      `UPDATE agent_execution_leases
          SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
          WHERE thread_id = ? AND turn_id = ?`,
      [taskThreadId, taskTurnId],
    );

    await expect(
      withExecutionFence(taskFence, () =>
        withExecutionFence(runFence, () =>
          beginAgentExecutionStep({ ...step, stepId: "after-task-loss" }),
        ),
      ),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });
  });

  it("rejects a late journal receipt after the parent task fence expires", async () => {
    const taskThreadId = "a2a-task:late-receipt-fence-test";
    const taskTurnId = "late-receipt-fence-test";
    const runId = "late-receipt-fence-run";
    const stepId = "late-receipt-fence-step";
    const taskFence = await claimTaskExecutionLease(
      taskThreadId,
      taskTurnId,
      "a2a:worker",
    );
    await insertRun(runId, runId, runId);
    const runFence = await claimTurnExecutionLease(runId, runId, runId);
    const intent = {
      ...runFence,
      stepId,
      operationId: "test:late-receipt",
      toolName: "late-receipt",
      inputJson: "{}",
      replayPolicy: "never" as const,
    };

    await withExecutionFence(taskFence, () =>
      withExecutionFence(runFence, async () => {
        await beginAgentExecutionStep(intent);
        await markAgentExecutionStepDispatched(intent);
      }),
    );
    await pglite.query(
      `UPDATE agent_execution_leases
          SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
          WHERE thread_id = ? AND turn_id = ?`,
      [taskThreadId, taskTurnId],
    );

    await expect(
      withExecutionFence(taskFence, () =>
        withExecutionFence(runFence, () =>
          recordLateAgentExecutionStepOutcome(
            intent,
            JSON.stringify({ result: "must not attach" }),
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });

    const receipt = await pglite.query(
      `SELECT status, result_json FROM agent_execution_steps
        WHERE thread_id = ? AND turn_id = ? AND step_id = ?`,
      [runFence.threadId, runFence.turnId, stepId],
    );
    expect(receipt.rows[0]).toMatchObject({ status: "dispatched" });
    expect(
      (receipt.rows[0] as { result_json: string | null }).result_json,
    ).toBeNull();
  });

  it("commits terminal status and failure details before a successor claims", async () => {
    const threadId = "thread-terminal-state-fence";
    const turnId = "terminal-state-fence";
    const runId = "run-terminal-state-fence";
    await insertRun(runId, threadId, turnId, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ message: "continue" }),
    });
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);

    await expect(
      withExecutionFence(fence, () =>
        updateRunTerminalStateIfRunning(runId, {
          status: "errored",
          terminalReason: "error:provider_failed",
          errorCode: "provider_failed",
          errorDetail: "upstream unavailable",
        }),
      ),
    ).resolves.toBe(true);

    const terminal = await pglite.query(
      `SELECT status, error_code, error_detail, terminal_reason, dispatch_payload
         FROM agent_runs WHERE id = ?`,
      [runId],
    );
    expect(terminal.rows[0]).toMatchObject({
      status: "errored",
      error_code: "provider_failed",
      error_detail: "upstream unavailable",
      terminal_reason: "error:provider_failed",
      dispatch_payload: null,
    });

    const successorId = `${runId}-successor`;
    await insertRun(successorId, threadId, turnId);
    const successorFence = await claimTurnExecutionLease(
      threadId,
      turnId,
      successorId,
    );
    expect(BigInt(successorFence.generation)).toBe(
      BigInt(fence.generation) + 1n,
    );

    const continuationRunId = `${runId}-continuation`;
    await insertRun(continuationRunId, threadId, `${turnId}-continuation`);
    const continuationFence = await claimTurnExecutionLease(
      threadId,
      `${turnId}-continuation`,
      continuationRunId,
    );
    await withExecutionFence(continuationFence, () =>
      updateRunTerminalStateIfRunning(continuationRunId, {
        status: "completed",
        terminalReason: "no_progress",
      }),
    );
    const continuation = await pglite.query(
      `SELECT status, terminal_reason FROM agent_runs WHERE id = ?`,
      [continuationRunId],
    );
    expect(continuation.rows[0]).toMatchObject({
      status: "truncated",
      terminal_reason: "no_progress",
    });
  });

  it("does not let a late process failure overwrite the reaper's terminal result", async () => {
    const threadId = "thread-reaper-before-process-failure";
    const turnId = "reaper-before-process-failure";
    const runId = "run-reaper-before-process-failure";
    await insertRun(runId, threadId, turnId, { dispatchMode: "background" });
    expect(await claimBackgroundRun(runId)).toBe(true);
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    const oldTimestamp = Date.now() - 60_000;
    await pglite.query(
      `UPDATE agent_runs
          SET started_at = ?, heartbeat_at = ?, last_progress_at = ?
          WHERE id = ?`,
      [oldTimestamp, oldTimestamp, oldTimestamp, runId],
    );
    await pglite.query(
      `UPDATE agent_execution_leases
          SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
          WHERE thread_id = ? AND turn_id = ? AND generation = CAST(? AS BIGINT)`,
      [threadId, turnId, fence.generation],
    );

    const claimObservedByOldProcess = await readBackgroundRunClaim(runId);
    expect(claimObservedByOldProcess).toMatchObject({
      status: "running",
      dispatchMode: "background-processing",
    });
    expect(await reapIfStale(runId, 0)).toBe(true);

    await expect(
      finalizeClaimedBackgroundRunFailure(runId, {
        errorCode: "background_worker_failed",
        errorDetail: "late process failure",
        event: {
          type: "error",
          errorCode: "background_worker_failed",
          error: "late process failure",
        },
      }),
    ).resolves.toBe(false);

    const run = await pglite.query(
      `SELECT status, error_code, terminal_reason FROM agent_runs WHERE id = ?`,
      [runId],
    );
    expect(run.rows[0]).toMatchObject({
      status: "errored",
      error_code: "stale_run",
      terminal_reason: "error:stale_run",
    });
    await expect(getLastTerminalRunEvent(runId)).resolves.toMatchObject({
      event: { type: "error", errorCode: "stale_run" },
    });
  });

  it("does not let a stale worker clear a newer tool ledger receipt", async () => {
    const threadId = "a2a-task:ledger-clear-fence";
    const turnId = "ledger-clear-fence";
    const staleFence = await claimTaskExecutionLease(
      threadId,
      turnId,
      "a2a:ledger-worker-a",
    );

    await pglite.query(
      `UPDATE agent_execution_leases
          SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
          WHERE thread_id = ? AND turn_id = ?`,
      [threadId, turnId],
    );
    const currentFence = await claimTaskExecutionLease(
      threadId,
      turnId,
      "a2a:ledger-worker-b",
    );
    await withExecutionFence(currentFence, () =>
      writeLedgerEntry(threadId, "tool:step", "durable result"),
    );

    await withExecutionFence(staleFence, () => clearLedgerForThread(threadId));

    const retained = await pglite.query(
      `SELECT result_summary FROM agent_tool_ledger WHERE thread_id = ?`,
      [threadId],
    );
    expect(retained.rows).toEqual([{ result_summary: "durable result" }]);

    await withExecutionFence(currentFence, () =>
      clearLedgerForThread(threadId),
    );
    const cleared = await pglite.query(
      `SELECT result_summary FROM agent_tool_ledger WHERE thread_id = ?`,
      [threadId],
    );
    expect(cleared.rows).toHaveLength(0);
  });
});
