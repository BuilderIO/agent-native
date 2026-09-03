/**
 * `reapAllStaleRuns` returned a bare count, and every per-row failure inside it
 * was coerced to "not reaped" by a `.catch(() => false)`. So a pass in which
 * every single row failed to reap returned `0` — the same value as "nothing was
 * stale". The route above it had just been given a `null`-vs-`0` distinction for
 * exactly this reason, which that coercion made worthless one level down.
 *
 * The sweep is also now the first thing on the shared durable tick, ahead of
 * `processRecurringJobs`. Production carried 1,216 stale rows while nothing
 * periodic reaped them, so the first tick after that fix meets a backlog; an
 * unbounded pass at ~5-10 serial round trips per row would spend the whole
 * platform wall before any recurring job ran.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let staleSelectRows: Array<{ id: string }> = [];
const updatedRunIds: string[] = [];

const mockDb = {
  execute: vi.fn(
    async (statement: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);

      if (
        /SELECT id FROM agent_runs WHERE status = 'running' LIMIT 1/i.test(sql)
      ) {
        return { rows: staleSelectRows.slice(0, 1), rowsAffected: 0 };
      }
      if (/SELECT id FROM agent_runs[\s\S]*status = 'running'/i.test(sql)) {
        // Honour the LIMIT the sweep asks for, so a test can prove the cap is
        // real rather than that the fixture happened to be small.
        const limit = /LIMIT (\d+)/i.exec(sql)?.[1];
        return {
          rows: limit
            ? staleSelectRows.slice(0, Number(limit))
            : staleSelectRows,
          rowsAffected: 0,
        };
      }
      if (
        /UPDATE agent_runs/i.test(sql) &&
        /SET status = 'errored'/i.test(sql)
      ) {
        const id = args.find(
          (arg): arg is string =>
            typeof arg === "string" && arg.startsWith("run-"),
        );
        if (id === "run-boom") throw new Error("pooler exhausted");
        if (id) updatedRunIds.push(id);
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

const { reapAllStaleRuns, __resetNoRunningRunsProbeForTests } =
  await import("./run-store.js");

beforeEach(() => {
  staleSelectRows = [];
  updatedRunIds.length = 0;
  __resetNoRunningRunsProbeForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reapAllStaleRuns accounting", () => {
  it("counts a row whose reap threw as failed, not as nothing-to-reap", async () => {
    staleSelectRows = [{ id: "run-boom" }];

    const result = await reapAllStaleRuns();

    expect(result.failed).toBe(1);
    expect(result.reaped).toBe(0);
    // The distinction the caller depends on: a pass where everything failed
    // must not be reportable as a clean sweep of an empty table.
    const nothingStale = { reaped: 0, failed: 0, truncated: false };
    expect(result).not.toEqual(nothingStale);
  });

  it("keeps reaping the rest of the batch after one row fails", async () => {
    staleSelectRows = [{ id: "run-a" }, { id: "run-boom" }, { id: "run-b" }];

    const result = await reapAllStaleRuns();

    expect(result).toEqual({ reaped: 2, failed: 1, truncated: false });
    expect(updatedRunIds).toEqual(["run-a", "run-b"]);
  });

  it("bounds one pass and reports that more remain", async () => {
    staleSelectRows = Array.from({ length: 250 }, (_, i) => ({
      id: `run-${i}`,
    }));

    const result = await reapAllStaleRuns();

    expect(result.truncated).toBe(true);
    expect(result.reaped).toBe(200);
    expect(updatedRunIds.length).toBe(200);
  });

  it("does not claim truncation when the batch fits", async () => {
    staleSelectRows = Array.from({ length: 5 }, (_, i) => ({ id: `run-${i}` }));

    const result = await reapAllStaleRuns();

    expect(result).toEqual({ reaped: 5, failed: 0, truncated: false });
  });
});
