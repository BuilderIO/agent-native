import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const client = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => client,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const {
  insertRun,
  insertRunEvent,
  reconcileTerminalRunFromEvents,
  getRunByThread,
  STALE_RUN_ERROR_EVENT,
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

describe("reconcileTerminalRunFromEvents convergence", () => {
  it("repairs a still-running row whose terminal event already landed", async () => {
    const { runId } = await seedStaleRun("needs-repair");

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        `SELECT status, error_code FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe(STALE_RUN_ERROR_EVENT.errorCode);
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

    const insert = await pglite.prepare(
      "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
    );
    await insert.run(runId, 0, Date.now(), '{"type":"error"'); // Invalid JSON
    await insert.run(runId, 1, Date.now(), '{"type":"missing_api_key'); // Invalid JSON

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(true);

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

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(true);

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

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(true);

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

    const insert = await pglite.prepare(
      "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
    );
    await insert.run(runId, 0, Date.now(), JSON.stringify({ type: "done" }));
    await insert.run(runId, 1, Date.now(), '{"type":"done"'); // Invalid JSON

    await expect(reconcileTerminalRunFromEvents(runId)).resolves.toBe(true);

    const row = (await (
      await pglite.prepare(
        `SELECT status, error_code FROM agent_runs WHERE id = ?`,
      )
    ).get(runId)) as { status: string; error_code: string };
    expect(row.status).toBe("errored");
    expect(row.error_code).toBe("terminal_event_unreadable");
  });
});
