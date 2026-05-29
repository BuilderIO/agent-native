import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let latestEventRows: Array<{ seq: number; event_data: string }> = [];
let staleSelectRows: Array<{ id: string }> = [];
let insertEventBehavior: () => void = () => {};

const mockDb = {
  execute: vi.fn(async (sql: string | { sql: string; args?: unknown[] }) => {
    const rawSql = typeof sql === "string" ? sql : sql.sql;
    const args = typeof sql === "string" ? [] : (sql.args ?? []);
    execCalls.push({ sql: rawSql, args });

    if (/SELECT seq, event_data FROM agent_run_events/i.test(rawSql)) {
      return { rows: latestEventRows, rowsAffected: 0 };
    }
    if (/SELECT id FROM agent_runs[\s\S]*status = 'running'/i.test(rawSql)) {
      return { rows: staleSelectRows, rowsAffected: 0 };
    }
    if (/INSERT INTO agent_run_events/i.test(rawSql)) {
      insertEventBehavior();
      return { rows: [], rowsAffected: 1 };
    }

    return {
      rows: [],
      rowsAffected: /^\s*UPDATE\b/i.test(rawSql) ? 1 : 0,
    };
  }),
};

const mockCaptureError = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("../server/capture-error.js", () => ({
  captureError: mockCaptureError,
}));

const { markRunAborted, reapIfStale, cleanupOldRuns } =
  await import("./run-store.js");

describe("run store", () => {
  beforeEach(() => {
    execCalls.length = 0;
    latestEventRows = [];
    staleSelectRows = [];
    insertEventBehavior = () => {};
    vi.clearAllMocks();
  });

  it("persists a terminal event when marking a run aborted", async () => {
    await markRunAborted("run-abort");

    const update = execCalls.find((call) =>
      /UPDATE agent_runs SET status = 'aborted'/i.test(call.sql),
    );
    expect(update?.args[0]).toBe("user");
    expect(update?.args[2]).toBe("run-abort");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args).toEqual(["run-abort", 0, '{"type":"done"}']);
  });

  it("does not append another terminal event after auto_continue", async () => {
    latestEventRows = [
      {
        seq: 4,
        event_data: JSON.stringify({
          type: "auto_continue",
          reason: "run_timeout",
        }),
      },
    ];

    await markRunAborted("run-abort-after-terminal", "no_progress");

    const eventInserts = execCalls.filter((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(eventInserts).toHaveLength(0);
  });

  it("retries a failed terminal-event insert before giving up", async () => {
    let attempts = 0;
    insertEventBehavior = () => {
      attempts++;
      if (attempts === 1) throw new Error("transient SQL blip");
    };

    await markRunAborted("run-retry-success");

    expect(attempts).toBe(2);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("captures to Sentry when the terminal-event retry also fails", async () => {
    insertEventBehavior = () => {
      throw new Error("DB unavailable");
    };

    await markRunAborted("run-retry-fail");

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [err, ctx] = mockCaptureError.mock.calls[0];
    expect((err as Error).message).toBe("DB unavailable");
    expect(ctx?.tags?.operation).toBe("append-terminal-event");
    expect(ctx?.tags?.source).toBe("mark-aborted");
    expect(ctx?.extra?.runId).toBe("run-retry-fail");
  });

  it("appends a terminal event for runs reaped by reapIfStale", async () => {
    await reapIfStale("run-stale");

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[0]).toBe("run-stale");
    const eventJson = insert?.args[2] as string;
    expect(eventJson).toContain('"errorCode":"stale_run"');
  });

  it("cleanupOldRuns SELECTs both heartbeat-stale AND age-stale rows for terminal-event append", async () => {
    staleSelectRows = [{ id: "old-but-heartbeating-run" }];

    await cleanupOldRuns(24 * 60 * 60 * 1000);

    // The broadened SELECT — both predicates in one query — is what catches
    // a 24h-old row whose heartbeat somehow stayed fresh. The older
    // heartbeat-only SELECT would have left it without a terminal event.
    const select = execCalls.find(
      (call) =>
        /SELECT id FROM agent_runs/i.test(call.sql) &&
        /COALESCE\(heartbeat_at, started_at\) < \?/.test(call.sql) &&
        /OR started_at < \?/.test(call.sql),
    );
    expect(select).toBeDefined();

    const insert = execCalls.find((call) =>
      /INSERT INTO agent_run_events/i.test(call.sql),
    );
    expect(insert?.args[0]).toBe("old-but-heartbeating-run");
    expect(insert?.args[2] as string).toContain('"errorCode":"stale_run"');
  });

  it("keeps errored runs longer than completed runs during cleanup", async () => {
    await cleanupOldRuns(24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);

    const deleteEvents = execCalls.find((call) =>
      /DELETE FROM agent_run_events/i.test(call.sql),
    );
    expect(deleteEvents?.sql).toContain("status = 'completed'");
    expect(deleteEvents?.sql).toContain("status IN ('errored', 'aborted')");
    expect(Number(deleteEvents?.args[1])).toBeLessThan(
      Number(deleteEvents?.args[0]),
    );

    const deleteRuns = execCalls.find((call) =>
      /DELETE FROM agent_runs/i.test(call.sql),
    );
    expect(deleteRuns?.sql).toContain("status = 'completed'");
    expect(deleteRuns?.sql).toContain("status IN ('errored', 'aborted')");
    expect(Number(deleteRuns?.args[1])).toBeLessThan(
      Number(deleteRuns?.args[0]),
    );
  });
});
