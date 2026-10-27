import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
  timeoutMs?: number;
  maxAttempts?: number;
}

const execCalls: ExecCall[] = [];
let staleSelectRows: Array<{ id: string }> = [];

const mockDb: any = {
  execute: vi.fn(
    async (
      statement:
        | string
        | {
            sql: string;
            args?: unknown[];
            timeoutMs?: number;
            maxAttempts?: number;
          },
    ) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);
      execCalls.push({
        sql,
        args,
        timeoutMs:
          typeof statement === "string" ? undefined : statement.timeoutMs,
        maxAttempts:
          typeof statement === "string" ? undefined : statement.maxAttempts,
      });

      if (
        /SELECT id FROM agent_runs WHERE status = 'running' LIMIT 1/i.test(sql)
      ) {
        return { rows: staleSelectRows.slice(0, 1), rowsAffected: 0 };
      }
      if (
        /SELECT thread_id, COALESCE\(turn_id, id\) AS turn_id\s+FROM agent_runs WHERE id = \?/i.test(
          sql,
        )
      ) {
        return {
          rows: [{ thread_id: "thread-dead", turn_id: String(args[0]) }],
          rowsAffected: 0,
        };
      }
      if (
        /SELECT status, worker_generation FROM agent_runs WHERE id = \? FOR UPDATE/i.test(
          sql,
        )
      ) {
        return {
          rows: [{ status: "running", worker_generation: null }],
          rowsAffected: 0,
        };
      }
      if (/SELECT id FROM agent_runs[\s\S]*status = 'running'/i.test(sql)) {
        return { rows: staleSelectRows, rowsAffected: 0 };
      }
      return {
        rows: [],
        rowsAffected: /^\s*(UPDATE|INSERT|DELETE)\b/i.test(sql) ? 1 : 0,
      };
    },
  ),
};
mockDb.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) =>
  fn(mockDb),
);

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/capture-error.js", () => ({
  captureError: vi.fn(),
}));

const {
  RUN_STALE_MS,
  STALE_RUN_TERMINAL_REASON,
  cleanupOldRuns,
  reapAllStaleRuns,
  updateRunHeartbeat,
  __resetNoRunningRunsProbeForTests,
} = await import("./run-store.js");

function staleReapUpdates(): ExecCall[] {
  return execCalls.filter(
    (call) =>
      /UPDATE agent_runs/i.test(call.sql) &&
      /SET status = 'errored'/i.test(call.sql) &&
      call.args.includes("stale_run"),
  );
}

beforeEach(() => {
  execCalls.length = 0;
  staleSelectRows = [];
  __resetNoRunningRunsProbeForTests();
});

describe("stale reap accounting", () => {
  it("records completed_at from the liveness basis, never the reap time", async () => {
    staleSelectRows = [{ id: "run-dead" }];
    await reapAllStaleRuns();

    const updates = staleReapUpdates();
    expect(updates).toHaveLength(1);
    for (const update of updates) {
      expect(update.sql).toMatch(
        /completed_at = COALESCE\(completed_at, \(CASE WHEN COALESCE\(last_progress_at/,
      );
      expect(update.sql).not.toMatch(/completed_at = \?/);
      const setPlaceholders =
        update.sql.slice(0, update.sql.indexOf("WHERE")).split("?").length - 1;
      expect(setPlaceholders).toBe(3);
      expect(
        update.args.slice(0, 3).every((arg) => typeof arg === "string"),
      ).toBe(true);
    }
  });

  it("writes one terminal_reason for one outcome, matching the reconciler's error:<code>", async () => {
    staleSelectRows = [{ id: "run-dead" }];
    await reapAllStaleRuns();

    const updates = staleReapUpdates();
    expect(updates).toHaveLength(1);
    expect(STALE_RUN_TERMINAL_REASON).toBe("error:stale_run");
    for (const update of updates) {
      expect(update.args).toContain(STALE_RUN_TERMINAL_REASON);
      expect(update.args).toContain("stale_run");
    }
  });

  it("does not update stale status independently during cleanup", async () => {
    await cleanupOldRuns(24 * 60 * 60 * 1000);

    expect(staleReapUpdates()).toHaveLength(0);
    expect(
      execCalls.some(
        (call) =>
          /UPDATE agent_runs/i.test(call.sql) &&
          /SET status = 'errored'/i.test(call.sql),
      ),
    ).toBe(false);
    expect(execCalls.some((call) => /OR started_at < \?/i.test(call.sql))).toBe(
      false,
    );
  });

  it("bounds the heartbeat write well inside the stale window it defends", async () => {
    await updateRunHeartbeat("run-live");

    const heartbeat = execCalls.find((call) =>
      /UPDATE agent_runs\s*SET heartbeat_at/i.test(call.sql),
    );
    expect(heartbeat).toBeDefined();
    expect(heartbeat?.maxAttempts).toBe(1);
    expect(heartbeat?.timeoutMs).toBeGreaterThan(0);
    const worstCaseMs =
      (heartbeat?.maxAttempts ?? 0) * (heartbeat?.timeoutMs ?? 0);
    expect(worstCaseMs).toBeLessThan(RUN_STALE_MS / 2);
  });
});
