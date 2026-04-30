import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];

const mockDb = {
  execute: vi.fn(async (sql: string | { sql: string; args?: unknown[] }) => {
    const rawSql = typeof sql === "string" ? sql : sql.sql;
    const args = typeof sql === "string" ? [] : (sql.args ?? []);
    execCalls.push({ sql: rawSql, args });
    return { rows: [], rowsAffected: 0 };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
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

const { listNotifications } = await import("./store.js");

function lastSelect(): ExecCall {
  const selects = execCalls.filter((c) => /^\s*SELECT\b/i.test(c.sql));
  if (selects.length === 0) throw new Error("no SELECT was executed");
  return selects[selects.length - 1];
}

describe("notifications store", () => {
  beforeEach(() => {
    execCalls.length = 0;
    vi.clearAllMocks();
  });

  it("scopes list queries to the owner and clamps invalid limits", async () => {
    await listNotifications("alice@example.com", { limit: -1 });

    const call = lastSelect();
    expect(call.sql).toMatch(/WHERE owner = \?/);
    expect(call.sql).toMatch(/LIMIT \?/);
    expect(call.args).toEqual(["alice@example.com", 50]);
  });
});
