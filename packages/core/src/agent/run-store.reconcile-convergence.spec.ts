import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { withExecutionFence, type ExecutionFence } from "./execution-fence.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const client: any = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql) || /\breturning\b/i.test(input.sql)) {
      const rows = await stmt.all(...args);
      return { rows, rowsAffected: rows.length };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};
client.transaction = async (run: (tx: any) => Promise<unknown>) => {
  await pglite.exec("BEGIN");
  try {
    const result = await run(client);
    await pglite.exec("COMMIT");
    return result;
  } catch (error) {
    await pglite.exec("ROLLBACK");
    throw error;
  }
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => client,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const {
  beginAgentExecutionStep,
  claimTurnExecutionLease,
  insertRun,
  insertRunEvent,
  markAgentExecutionStepDispatched,
  recordLateAgentExecutionStepOutcome,
  reconcileTerminalRunFromEvents,
  reapAllStaleRuns,
  reapIfStale,
  getRunByThread,
  STALE_RUN_ERROR_EVENT,
  __resetNoRunningRunsProbeForTests,
} = await import("./run-store.js");

async function seedStaleRun(name: string) {
  const runId = `run-${name}`;
  const threadId = `thread-${name}`;
  await insertRun(runId, threadId, `turn-${name}`);
  await insertRunEvent(runId, 0, JSON.stringify(STALE_RUN_ERROR_EVENT));
  return { runId, threadId };
}

async function markReapedStale(runId: string) {
  await (
    await pglite.prepare(
      `UPDATE agent_runs
       SET status = 'errored', error_code = ?, error_detail = ?,
           terminal_reason = 'stale_run', completed_at = ?
       WHERE id = ?`,
    )
  ).run(
    STALE_RUN_ERROR_EVENT.errorCode,
    STALE_RUN_ERROR_EVENT.details,
    Date.now(),
    runId,
  );
}

async function addCurrentFence(
  runId: string,
  threadId: string,
  turnId: string,
  generation = "1",
): Promise<ExecutionFence> {
  await pglite
    .prepare(
      `INSERT INTO agent_execution_leases (
         thread_id, turn_id, generation, owner_run_id, lease_expires_at, updated_at
       ) VALUES (?, ?, CAST(? AS BIGINT), ?,
         clock_timestamp() + INTERVAL '1 minute', clock_timestamp())`,
    )
    .run(threadId, turnId, generation, runId);
  return { threadId, turnId, runId, generation };
}

describe("reconcileTerminalRunFromEvents convergence", () => {
  it("repairs a still-running row whose terminal event already landed", async () => {
    const { runId, threadId } = await seedStaleRun("needs-repair");
    const fence = await claimTurnExecutionLease(
      threadId,
      "turn-needs-repair",
      runId,
    );

    await expect(
      withExecutionFence(fence, () => reconcileTerminalRunFromEvents(runId)),
    ).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        `SELECT status, error_code FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe(STALE_RUN_ERROR_EVENT.errorCode);
  });

  it("marks a matching terminal row for thread projection retry", async () => {
    const runId = "run-thread-projection-retry";
    const threadId = "thread-thread-projection-retry";
    const turnId = "turn-thread-projection-retry";
    await insertRun(runId, threadId, turnId);
    await insertRunEvent(runId, 0, JSON.stringify({ type: "done" }));
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    await pglite
      .prepare(
        `UPDATE agent_runs
         SET status = 'completed', terminal_reason = 'done', completed_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), runId);

    await expect(
      withExecutionFence(fence, () =>
        reconcileTerminalRunFromEvents(runId, {
          threadProjectionPending: true,
        }),
      ),
    ).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        "SELECT thread_projection_pending FROM agent_runs WHERE id = ?",
      )
    ).get(runId)) as { thread_projection_pending: boolean };
    expect(row.thread_projection_pending).toBe(true);
  });

  it("leaves terminal status repair to a worker that owns the current generation", async () => {
    const { runId, threadId } = await seedStaleRun("unowned-repair");

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(false);
    const beforeTransfer = (await (
      await pglite.prepare(`SELECT status FROM agent_runs WHERE id = ?`)
    ).get(runId)) as { status: string };
    expect(beforeTransfer.status).toBe("running");

    const staleFence = await claimTurnExecutionLease(
      threadId,
      "turn-unowned-repair",
      runId,
    );
    await pglite
      .prepare(
        `UPDATE agent_execution_leases
         SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
         WHERE thread_id = ? AND turn_id = ?`,
      )
      .run(threadId, "turn-unowned-repair");
    const recoveryRunId = `${runId}-recovery`;
    await insertRun(recoveryRunId, threadId, "turn-unowned-repair");
    const recoveryFence = await claimTurnExecutionLease(
      threadId,
      "turn-unowned-repair",
      recoveryRunId,
    );
    expect(BigInt(recoveryFence.generation)).toBe(
      BigInt(staleFence.generation) + 1n,
    );
    await expect(
      withExecutionFence(staleFence, () =>
        reconcileTerminalRunFromEvents(runId),
      ),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });
    const afterStaleWrite = (await (
      await pglite.prepare(`SELECT status FROM agent_runs WHERE id = ?`)
    ).get(runId)) as { status: string };
    expect(afterStaleWrite.status).toBe("running");

    await expect(
      withExecutionFence(recoveryFence, () =>
        reconcileTerminalRunFromEvents(runId),
      ),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });
  });

  it("repairs a durable terminal event after the reaper locks an expired lease", async () => {
    __resetNoRunningRunsProbeForTests();
    const { runId, threadId } = await seedStaleRun("reaper-terminal-repair");
    const turnId = "turn-reaper-terminal-repair";
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    await withExecutionFence(fence, () =>
      insertRunEvent(runId, 1, JSON.stringify({ type: "done" })),
    );
    await pglite
      .prepare(
        `UPDATE agent_runs
         SET started_at = ?, heartbeat_at = ?, last_progress_at = ?
         WHERE id = ?`,
      )
      .run(
        Date.now() - 300_000,
        Date.now() - 300_000,
        Date.now() - 300_000,
        runId,
      );
    await pglite
      .prepare(
        `UPDATE agent_execution_leases
         SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
         WHERE thread_id = ? AND turn_id = ?`,
      )
      .run(threadId, turnId);

    await expect(reapAllStaleRuns()).resolves.toMatchObject({
      reaped: 0,
      failed: 0,
    });

    const repaired = (await (
      await pglite.prepare(
        `SELECT status, error_code, terminal_reason FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as {
      status: string;
      error_code: string | null;
      terminal_reason: string | null;
    };
    expect(repaired).toEqual({
      status: "completed",
      error_code: null,
      terminal_reason: "done",
    });
  });

  it("does not repair a terminal event while the matching worker lease is live", async () => {
    __resetNoRunningRunsProbeForTests();
    const { runId, threadId } = await seedStaleRun("reaper-live-terminal");
    const turnId = "turn-reaper-live-terminal";
    const fence = await claimTurnExecutionLease(threadId, turnId, runId);
    await withExecutionFence(fence, () =>
      insertRunEvent(runId, 1, JSON.stringify({ type: "done" })),
    );
    await pglite
      .prepare(
        `UPDATE agent_runs
         SET started_at = ?, heartbeat_at = ?, last_progress_at = ?
         WHERE id = ?`,
      )
      .run(
        Date.now() - 300_000,
        Date.now() - 300_000,
        Date.now() - 300_000,
        runId,
      );

    await expect(reapAllStaleRuns()).resolves.toMatchObject({
      reaped: 0,
      failed: 0,
    });

    const stillRunning = (await (
      await pglite.prepare(`SELECT status FROM agent_runs WHERE id = ?`)
    ).get(runId)) as { status: string };
    expect(stillRunning.status).toBe("running");
  });

  it("fences late journal receipts to the dispatched worker generation", async () => {
    const runId = "run-late-outcome-current";
    const recoveryRunId = "run-late-outcome-recovery";
    const threadId = "thread-late-outcome";
    const turnId = "turn-late-outcome";
    await insertRun(runId, threadId, turnId);
    const firstFence = await claimTurnExecutionLease(threadId, turnId, runId);
    const makeIntent = (stepId: string) => ({
      ...firstFence,
      stepId,
      operationId: "test:effect",
      toolName: "effect",
      inputJson: JSON.stringify({ stepId }),
      replayPolicy: "never" as const,
    });
    const currentIntent = makeIntent("late-outcome-current-step");
    const staleIntent = makeIntent("late-outcome-stale-step");
    await withExecutionFence(firstFence, async () => {
      await beginAgentExecutionStep(currentIntent);
      await markAgentExecutionStepDispatched(currentIntent);
      await beginAgentExecutionStep(staleIntent);
      await markAgentExecutionStepDispatched(staleIntent);
    });

    await recordLateAgentExecutionStepOutcome(
      currentIntent,
      JSON.stringify({ result: "saved" }),
    );
    const currentReceipt = (await (
      await pglite.prepare(
        `SELECT status, result_json FROM agent_execution_steps
         WHERE thread_id = ? AND turn_id = ? AND step_id = ?`,
      )
    ).get(threadId, turnId, currentIntent.stepId)) as {
      status: string;
      result_json: string;
    };
    expect(currentReceipt.status).toBe("completed");
    expect(JSON.parse(currentReceipt.result_json)).toEqual({ result: "saved" });

    await pglite
      .prepare(
        `UPDATE agent_execution_leases
         SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
         WHERE thread_id = ? AND turn_id = ?`,
      )
      .run(threadId, turnId);
    await insertRun(recoveryRunId, threadId, turnId);
    const recoveryFence = await claimTurnExecutionLease(
      threadId,
      turnId,
      recoveryRunId,
    );
    await expect(
      recordLateAgentExecutionStepOutcome(
        staleIntent,
        JSON.stringify({ result: "must not commit" }),
      ),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });
    const staleReceipt = (await (
      await pglite.prepare(
        `SELECT status, result_json FROM agent_execution_steps
         WHERE thread_id = ? AND turn_id = ? AND step_id = ?`,
      )
    ).get(threadId, turnId, staleIntent.stepId)) as {
      status: string;
      result_json: string | null;
    };
    expect(BigInt(recoveryFence.generation)).toBe(
      BigInt(firstFence.generation) + 1n,
    );
    expect(staleReceipt.status).toBe("dispatched");
    expect(staleReceipt.result_json).toBeNull();
  });

  it("reaches a fixed point instead of reporting a repair forever", async () => {
    const { runId } = await seedStaleRun("converged");
    await markReapedStale(runId);

    await reconcileTerminalRunFromEvents(runId);

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(false);
    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(false);
  });

  it("terminates getRunByThread for a settled errored/stale_run row", async () => {
    const { runId, threadId } = await seedStaleRun("lookup");
    await markReapedStale(runId);

    const before = client.execute.mock.calls.length;
    const run = await getRunByThread(threadId, { includeTerminal: true });

    expect(run?.id).toBe(runId);
    expect(run?.status).toBe("errored");
    expect(client.execute.mock.calls.length - before).toBeLessThan(12);
  });

  it("selects the newest continuation when runs share a start time", async () => {
    const threadId = "thread-same-start-time";
    const turnId = "turn-same-start-time";
    await insertRun("run-first-continuation", threadId, turnId);
    await insertRun("run-latest-continuation", threadId, turnId);
    await (
      await pglite.prepare(
        "UPDATE agent_runs SET started_at = ? WHERE thread_id = ?",
      )
    ).run(1, threadId);

    const run = await getRunByThread(threadId, {
      includeTerminal: true,
      turnId,
    });

    expect(run?.id).toBe("run-latest-continuation");
  });

  it("marks run errored when all terminal event rows are unreadable", async () => {
    const runId = "run-unreadable-terminal";
    const threadId = "thread-unreadable-terminal";
    const turnId = "turn-unreadable-terminal";
    await insertRun(runId, threadId, turnId);
    const fence = await addCurrentFence(runId, threadId, turnId);

    const insert = await pglite.prepare(
      "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
    );
    await insert.run(runId, 0, Date.now(), '{"type":"error"'); // Invalid JSON
    await insert.run(runId, 1, Date.now(), '{"type":"missing_api_key'); // Invalid JSON

    await expect(
      withExecutionFence(fence, () => reconcileTerminalRunFromEvents(runId)),
    ).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        `SELECT status, error_code FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe("terminal_event_unreadable");
  });

  it("prefers readable terminal event over unreadable one", async () => {
    const runId = "run-readable-over-unreadable";
    const threadId = "thread-readable-over-unreadable";
    const turnId = "turn-readable-over-unreadable";
    await insertRun(runId, threadId, turnId);
    const fence = await addCurrentFence(runId, threadId, turnId);

    const insert = await pglite.prepare(
      "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
    );
    await insert.run(runId, 0, Date.now(), '{"type":"error'); // Invalid JSON
    await insert.run(
      runId,
      1,
      Date.now(),
      JSON.stringify({
        type: "error",
        errorCode: "test_error",
      }),
    );

    await expect(
      withExecutionFence(fence, () => reconcileTerminalRunFromEvents(runId)),
    ).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        `SELECT status, error_code FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe("test_error");
  });

  it("does not let a readable terminal event hide a newer unreadable event", async () => {
    const runId = "run-newer-unreadable-terminal";
    const threadId = "thread-newer-unreadable-terminal";
    const turnId = "turn-newer-unreadable-terminal";
    await insertRun(runId, threadId, turnId);
    const fence = await addCurrentFence(runId, threadId, turnId);

    const insert = await pglite.prepare(
      "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
    );
    await insert.run(
      runId,
      0,
      Date.now(),
      JSON.stringify({ type: "error", errorCode: "older_error" }),
    );
    await insert.run(runId, 1, Date.now(), '{"type":"done"'); // Invalid JSON

    await expect(
      withExecutionFence(fence, () => reconcileTerminalRunFromEvents(runId)),
    ).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        `SELECT status, error_code FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe("terminal_event_unreadable");
  });

  it("does not let an older readable terminal event hide a newer unreadable event", async () => {
    const runId = "run-newer-unreadable-over-done";
    const threadId = "thread-newer-unreadable-over-done";
    const turnId = "turn-newer-unreadable-over-done";
    await insertRun(runId, threadId, turnId);
    const fence = await addCurrentFence(runId, threadId, turnId);

    const insert = await pglite.prepare(
      "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
    );
    await insert.run(runId, 0, Date.now(), JSON.stringify({ type: "done" }));
    await insert.run(runId, 1, Date.now(), '{"type":"done"'); // Invalid JSON

    await expect(
      withExecutionFence(fence, () => reconcileTerminalRunFromEvents(runId)),
    ).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        `SELECT status, error_code FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe("terminal_event_unreadable");
  });
});
