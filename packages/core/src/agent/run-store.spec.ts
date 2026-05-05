import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let latestEventRows: Array<{ seq: number; event_data: string }> = [];

const mockDb = {
  execute: vi.fn(async (sql: string | { sql: string; args?: unknown[] }) => {
    const rawSql = typeof sql === "string" ? sql : sql.sql;
    const args = typeof sql === "string" ? [] : (sql.args ?? []);
    execCalls.push({ sql: rawSql, args });

    if (/SELECT seq, event_data FROM agent_run_events/i.test(rawSql)) {
      return { rows: latestEventRows, rowsAffected: 0 };
    }

    return {
      rows: [],
      rowsAffected: /^\s*UPDATE\b/i.test(rawSql) ? 1 : 0,
    };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const { markRunAborted } = await import("./run-store.js");

describe("run store", () => {
  beforeEach(() => {
    execCalls.length = 0;
    latestEventRows = [];
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
});
