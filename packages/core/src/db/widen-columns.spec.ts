import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `widenIntColumnsToBigInt` resolves `isPostgres()` through `./client.js`,
// which derives the dialect from `process.env.DATABASE_URL`. These tests stub
// that env and pass an injected fake client, so no real database is required.

describe("widenIntColumnsToBigInt", () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
    vi.resetModules();
  });

  // A recording fake client. `int4Columns` are the columns the simulated
  // information_schema reports as 32-bit `integer`.
  function fakeClient(int4Columns: string[]) {
    const calls: string[] = [];
    const client = {
      execute: async (sql: string | { sql: string; args?: unknown[] }) => {
        const text = typeof sql === "string" ? sql : sql.sql;
        calls.push(text);
        if (/information_schema\.columns/i.test(text)) {
          return {
            rows: int4Columns.map((column_name) => ({ column_name })),
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    } as any;
    return { client, calls };
  }

  it("only ALTERs columns that are currently int4 (skips already-bigint)", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
    const { widenIntColumnsToBigInt } = await import("./widen-columns.js");
    // started_at + completed_at are still int4; heartbeat_at is already bigint.
    const { client, calls } = fakeClient(["started_at", "completed_at"]);
    await widenIntColumnsToBigInt(
      "agent_runs",
      ["started_at", "completed_at", "heartbeat_at"],
      client,
    );
    const alters = calls.filter((c) => /ALTER TABLE/i.test(c));
    expect(alters).toEqual([
      "ALTER TABLE agent_runs ALTER COLUMN started_at TYPE BIGINT",
      "ALTER TABLE agent_runs ALTER COLUMN completed_at TYPE BIGINT",
    ]);
  });

  it("is a no-op on SQLite (never touches the DB)", async () => {
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");
    const { widenIntColumnsToBigInt } = await import("./widen-columns.js");
    const { client, calls } = fakeClient(["started_at"]);
    await widenIntColumnsToBigInt("agent_runs", ["started_at"], client);
    expect(calls).toEqual([]);
  });

  it("issues no ALTER when no requested column is int4", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
    const { widenIntColumnsToBigInt } = await import("./widen-columns.js");
    const { client, calls } = fakeClient([]); // all already bigint
    await widenIntColumnsToBigInt("chat_threads", ["created_at"], client);
    expect(calls.some((c) => /ALTER TABLE/i.test(c))).toBe(false);
  });

  it("rejects non-identifier table names (no query issued)", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
    const { widenIntColumnsToBigInt } = await import("./widen-columns.js");
    const { client, calls } = fakeClient(["created_at"]);
    await widenIntColumnsToBigInt(
      "agent_runs; DROP TABLE x",
      ["created_at"],
      client,
    );
    expect(calls).toEqual([]);
  });

  it("swallows errors so a failed widen never breaks boot", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/db");
    const { widenIntColumnsToBigInt } = await import("./widen-columns.js");
    const throwing = {
      execute: async () => {
        throw new Error("permission denied for relation");
      },
    } as any;
    await expect(
      widenIntColumnsToBigInt("agent_runs", ["started_at"], throwing),
    ).resolves.toBeUndefined();
  });
});
