import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];

const defaultExecute = async (
  sql: string | { sql: string; args?: unknown[] },
) => {
  const rawSql = typeof sql === "string" ? sql : sql.sql;
  const args = typeof sql === "string" ? [] : (sql.args ?? []);
  execCalls.push({ sql: rawSql, args });
  return { rows: [], rowsAffected: 0 };
};

const mockDb = {
  execute: vi.fn(defaultExecute),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  isUniqueViolation: () => false,
  retryOnDdlRace: (fn: () => unknown) => fn(),
  safeJsonParse: (value: string, fallback: unknown) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
}));

vi.mock("../server/poll.js", () => ({
  recordChange: vi.fn(),
}));

const { DEFAULT_PROGRESS_RUN_STALE_MS, listRuns } = await import("./store.js");

function lastSelect(): ExecCall {
  const selects = execCalls.filter((c) => /^\s*SELECT\b/i.test(c.sql));
  if (selects.length === 0) throw new Error("no SELECT was executed");
  return selects[selects.length - 1];
}

describe("progress store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execCalls.length = 0;
    vi.clearAllMocks();
    mockDb.execute.mockImplementation(defaultExecute);
  });

  it("scopes list queries to the owner and clamps invalid limits", async () => {
    await listRuns("alice@example.com", { activeOnly: true, limit: -1 });

    const call = lastSelect();
    expect(call.sql).toMatch(/WHERE owner = \? AND status = 'running'/);
    expect(call.sql).toMatch(/LIMIT \?/);
    expect(call.args).toEqual(["alice@example.com", 50]);
  });

  it("marks stale running rows cancelled before listing active runs", async () => {
    const now = Date.UTC(2026, 4, 8, 16, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockDb.execute.mockImplementation(
      async (sql: string | { sql: string; args?: unknown[] }) => {
        const rawSql = typeof sql === "string" ? sql : sql.sql;
        const args = typeof sql === "string" ? [] : (sql.args ?? []);
        execCalls.push({ sql: rawSql, args });
        return {
          rows: [],
          rowsAffected: /^\s*UPDATE progress_runs\b/i.test(rawSql) ? 2 : 0,
        };
      },
    );

    await listRuns("alice@example.com", { activeOnly: true, limit: 10 });

    const update = execCalls.find((c) =>
      /^\s*UPDATE progress_runs\b/i.test(c.sql),
    );
    expect(update?.sql).toMatch(/SET status = 'cancelled'/);
    expect(update?.sql).toMatch(/AND status = 'running'/);
    expect(update?.sql).toMatch(/AND updated_at < \?/);
    expect(update?.args).toEqual([
      "Stopped after 30 minutes without progress.",
      now,
      now,
      "alice@example.com",
      now - DEFAULT_PROGRESS_RUN_STALE_MS,
    ]);
  });
});
