/**
 * The stale reapers used to lie twice about the same failure.
 *
 * 1. `completed_at` was stamped at REAP time, so a run that died at T+15s but
 *    was not noticed until T+30m recorded a 30-minute duration. That is
 *    detection latency filed as run duration — and it is the exact measurement
 *    used to judge whether reaping is timely, so the corruption hid itself.
 * 2. `terminal_reason` was written as the bare `stale_run` while
 *    `reconcileTerminalRunFromEvents` wrote `error:stale_run` for the very same
 *    outcome, splitting one failure across two permanent
 *    `agent_run_outcome_daily` buckets (prod: 612 + 604).
 *
 * A third lie was in the heartbeat that feeds them: its write inherited the
 * default DbExec budget (8s x 3 attempts on serverless = 24s) against a 15s
 * `RUN_STALE_MS`, so a live run could be reaped while its own heartbeat was
 * still in flight.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
  timeoutMs?: number;
  maxAttempts?: number;
}

const execCalls: ExecCall[] = [];
let staleSelectRows: Array<{ id: string }> = [];

const mockDb = {
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
      execCalls.push({
        sql,
        args: typeof statement === "string" ? [] : (statement.args ?? []),
        timeoutMs:
          typeof statement === "string" ? undefined : statement.timeoutMs,
        maxAttempts:
          typeof statement === "string" ? undefined : statement.maxAttempts,
      });

      // hasRunningRuns short-circuits every sweep, so it must agree with the
      // stale fixture or the test would assert on a sweep that never ran.
      if (
        /SELECT id FROM agent_runs WHERE status = 'running' LIMIT 1/i.test(sql)
      ) {
        return { rows: staleSelectRows.slice(0, 1), rowsAffected: 0 };
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

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  isPostgres: () => false,
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

/** The reap-to-errored UPDATEs, in call order. */
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
    await cleanupOldRuns(24 * 60 * 60 * 1000);

    const updates = staleReapUpdates();
    expect(updates.length).toBe(3);
    for (const update of updates) {
      // The liveness basis is the last proof the producer was alive; COALESCE
      // keeps an already-written completed_at authoritative.
      expect(update.sql).toMatch(
        /completed_at = COALESCE\(completed_at, \(CASE WHEN COALESCE\(last_progress_at/,
      );
      expect(update.sql).not.toMatch(/completed_at = \?/);
      // No clock value may be BOUND into the SET list at all: three
      // placeholders, for error_code, error_detail and terminal_reason.
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
    await cleanupOldRuns(24 * 60 * 60 * 1000);

    const updates = staleReapUpdates();
    // reapAllStaleRuns' per-row UPDATE plus cleanupOldRuns' absolute-age and
    // heartbeat-stale UPDATEs — every writer of this outcome.
    expect(updates.length).toBe(3);
    expect(STALE_RUN_TERMINAL_REASON).toBe("error:stale_run");
    for (const update of updates) {
      expect(update.args).toContain(STALE_RUN_TERMINAL_REASON);
      // The bare code stays the error_code; only terminal_reason is normalized,
      // so `reconcileTerminalRunFromEvents`' repair WHERE still matches the row.
      expect(update.args).toContain("stale_run");
    }
  });

  it("bounds the heartbeat write well inside the stale window it defends", async () => {
    await updateRunHeartbeat("run-live");

    const heartbeat = execCalls.find((call) =>
      /UPDATE agent_runs\s*SET heartbeat_at/i.test(call.sql),
    );
    expect(heartbeat).toBeDefined();
    expect(heartbeat?.maxAttempts).toBe(1);
    expect(heartbeat?.timeoutMs).toBeGreaterThan(0);
    // Worst-case occupancy is maxAttempts * timeoutMs. It must leave room for a
    // later tick to land before the reap cutoff, or the single-flight guard lets
    // a live run go stale behind its own in-flight write.
    const worstCaseMs =
      (heartbeat?.maxAttempts ?? 0) * (heartbeat?.timeoutMs ?? 0);
    expect(worstCaseMs).toBeLessThan(RUN_STALE_MS / 2);
  });
});
