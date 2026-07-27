import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — set up before importing the module under test so vi.mock hoisting
// can replace the dynamic imports that migrations.ts uses.
// ---------------------------------------------------------------------------

// We mock client.ts to avoid real DB connections.
vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    isPostgres: vi.fn(() => false),
    getDialect: vi.fn(() => "sqlite" as const),
    getMigrationDatabaseUrl: vi.fn(() => ""),
    retrySqliteBusy: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    getDbExec: vi.fn(),
    createDbExec: vi.fn(),
  };
});

import {
  isPostgres,
  getDbExec,
  createDbExec,
  getMigrationDatabaseUrl,
} from "./client.js";
import { runMigrations } from "./migrations.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExec(rows: Array<{ v: number | null }> = [{ v: null }]) {
  return {
    execute: vi.fn(async (sql: string | { sql: string; args: unknown[] }) => {
      const s = typeof sql === "string" ? sql : sql.sql;
      if (/SELECT MAX/i.test(s)) return { rows, rowsAffected: 0 };
      return { rows: [], rowsAffected: 0 };
    }),
    close: vi.fn(async () => {}),
  };
}

/**
 * Exec mock for named-migration tests: also answers `SELECT name FROM
 * <table>_named` from a configurable set of already-applied names, and
 * records every `INSERT ... INTO <table>_named` it sees so tests can assert
 * on what got recorded.
 */
function makeNamedExec(options: {
  version?: number | null;
  appliedNames?: string[];
}) {
  const insertedNames: string[] = [];
  const insertedVersions: number[] = [];
  const exec = {
    execute: vi.fn(async (sql: string | { sql: string; args?: unknown[] }) => {
      const s = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : (sql.args ?? []);
      if (/SELECT MAX/i.test(s)) {
        return {
          rows: [{ v: options.version ?? null }],
          rowsAffected: 0,
        };
      }
      if (/SELECT name FROM/i.test(s)) {
        return {
          rows: (options.appliedNames ?? []).map((name) => ({ name })),
          rowsAffected: 0,
        };
      }
      if (/INSERT.*INTO \S*_named/is.test(s)) {
        insertedNames.push(String(args[0]));
        return { rows: [], rowsAffected: 1 };
      }
      if (/INSERT/i.test(s)) {
        insertedVersions.push(Number(args[0]));
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    }),
    close: vi.fn(async () => {}),
    insertedNames,
    insertedVersions,
  };
  return exec;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMigrations – SQLite steady-state (no pending migrations)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("issues zero direct-exec opens when already up to date", async () => {
    // SQLite path uses the pooled singleton exec only
    vi.mocked(isPostgres).mockReturnValue(false);
    const exec = makeExec([{ v: 5 }]);
    vi.mocked(getDbExec).mockReturnValue(exec);

    const migrations = [
      { version: 1, sql: "CREATE TABLE t1 (id INTEGER PRIMARY KEY)" },
      { version: 2, sql: "CREATE TABLE t2 (id INTEGER PRIMARY KEY)" },
    ];

    const plugin = runMigrations(migrations, { table: "test_migrations" });
    await plugin(null);

    // createDbExec must NOT be called for SQLite
    expect(createDbExec).not.toHaveBeenCalled();
  });
});

describe("runMigrations – Postgres steady-state (no pending migrations)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("opens zero direct-endpoint connections when all migrations applied", async () => {
    // Postgres path — pooled singleton says max version = 10 (all migrations done)
    vi.mocked(isPostgres).mockReturnValue(true);
    const pooledExec = makeExec([{ v: 10 }]);
    vi.mocked(getDbExec).mockReturnValue(pooledExec);

    const migrations = [
      { version: 1, sql: "CREATE TABLE t1 (id BIGINT PRIMARY KEY)" },
      { version: 5, sql: "CREATE TABLE t5 (id BIGINT PRIMARY KEY)" },
      { version: 10, sql: "CREATE TABLE t10 (id BIGINT PRIMARY KEY)" },
    ];

    const plugin = runMigrations(migrations, { table: "pg_test_migrations" });
    await plugin(null);

    // The fast-path SELECT went through the pooled exec
    expect(pooledExec.execute).toHaveBeenCalled();
    // Direct exec must NOT be created
    expect(createDbExec).not.toHaveBeenCalled();
  });

  it("treats a missing migrations table (pooled SELECT throws) as all-pending", async () => {
    // When the pooled exec throws (table doesn't exist yet), we should still
    // proceed to apply all migrations via the direct endpoint.
    vi.mocked(isPostgres).mockReturnValue(true);
    const pooledExec = {
      execute: vi
        .fn()
        .mockRejectedValue(
          new Error('relation "new_table_migrations" does not exist'),
        ),
      close: vi.fn(async () => {}),
    };
    vi.mocked(getDbExec).mockReturnValue(pooledExec);
    vi.mocked(getMigrationDatabaseUrl).mockReturnValue("postgres://direct");

    const directExec = makeExec([{ v: null }]); // no rows yet
    vi.mocked(createDbExec).mockResolvedValue(directExec);

    const migrations = [
      { version: 1, sql: "CREATE TABLE brand_new (id BIGINT PRIMARY KEY)" },
    ];

    const plugin = runMigrations(migrations, { table: "new_table_migrations" });
    await plugin(null);

    // Direct exec must have been created (for DDL)
    expect(createDbExec).toHaveBeenCalledWith({ url: "postgres://direct" });
    // And migrations applied
    const calls = directExec.execute.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(calls.some((s) => /CREATE TABLE brand_new/i.test(s))).toBe(true);
  });

  it("opens the direct exec and applies pending migrations", async () => {
    vi.mocked(isPostgres).mockReturnValue(true);
    // Pooled exec reports version = 2 (version 3 pending)
    const pooledExec = makeExec([{ v: 2 }]);
    vi.mocked(getDbExec).mockReturnValue(pooledExec);
    vi.mocked(getMigrationDatabaseUrl).mockReturnValue("postgres://direct");

    const directExec = makeExec([{ v: 2 }]);
    vi.mocked(createDbExec).mockResolvedValue(directExec);

    const migrations = [
      { version: 1, sql: "CREATE TABLE t1 (id BIGINT PRIMARY KEY)" },
      { version: 2, sql: "CREATE TABLE t2 (id BIGINT PRIMARY KEY)" },
      { version: 3, sql: "ALTER TABLE t1 ADD COLUMN name TEXT" },
    ];

    const plugin = runMigrations(migrations, {
      table: "apply_test_migrations",
    });
    await plugin(null);

    expect(createDbExec).toHaveBeenCalledWith({ url: "postgres://direct" });
    const calls = directExec.execute.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0] as { sql: string }).sql,
    );
    // Version 3 migration (ALTER TABLE) must be applied
    expect(calls.some((s) => /ALTER TABLE t1/i.test(s))).toBe(true);
    // Version 1 and 2 must NOT be applied (already at v2)
    expect(calls.some((s) => /CREATE TABLE t1/i.test(s))).toBe(false);
  });

  it("closes the direct exec after migrations complete", async () => {
    vi.mocked(isPostgres).mockReturnValue(true);
    const pooledExec = makeExec([{ v: 0 }]);
    vi.mocked(getDbExec).mockReturnValue(pooledExec);
    vi.mocked(getMigrationDatabaseUrl).mockReturnValue("postgres://direct");

    const directExec = makeExec([{ v: 0 }]);
    vi.mocked(createDbExec).mockResolvedValue(directExec);

    const migrations = [
      { version: 1, sql: "CREATE TABLE close_test (id BIGINT PRIMARY KEY)" },
    ];

    const plugin = runMigrations(migrations, {
      table: "close_test_migrations",
    });
    await plugin(null);

    // The exec's close() must be called (via releaseMigrationExec)
    expect(directExec.close).toHaveBeenCalledTimes(1);
  });

  it("closes the direct exec even when a migration throws", async () => {
    vi.mocked(isPostgres).mockReturnValue(true);
    const pooledExec = makeExec([{ v: 0 }]);
    vi.mocked(getDbExec).mockReturnValue(pooledExec);
    vi.mocked(getMigrationDatabaseUrl).mockReturnValue("postgres://direct");

    const directExec = {
      execute: vi.fn(async (sql: string | { sql: string; args: unknown[] }) => {
        const s = typeof sql === "string" ? sql : sql.sql;
        if (/SELECT MAX/i.test(s)) return { rows: [{ v: 0 }], rowsAffected: 0 };
        if (/CREATE TABLE/i.test(s)) return { rows: [], rowsAffected: 0 };
        // Fail on the actual migration DDL
        throw new Error("permission denied");
      }),
      close: vi.fn(async () => {}),
    };
    vi.mocked(createDbExec).mockResolvedValue(directExec);

    const migrations = [
      { version: 1, sql: "ALTER TABLE nonexistent ADD COLUMN x TEXT" },
    ];

    // runMigrations swallows the error on serverless; on non-serverless it calls
    // process.exit. We spy and prevent exit to keep the test alive.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as () => never);

    const plugin = runMigrations(migrations, { table: "err_test_migrations" });
    await plugin(null);

    // close() must still be called despite the migration failure
    expect(directExec.close).toHaveBeenCalledTimes(1);

    exitSpy.mockRestore();
  });

  it("shares one direct exec across concurrent runners in the same boot window", async () => {
    vi.mocked(isPostgres).mockReturnValue(true);
    // Both pooled execs report current = 0 → both have pending migrations
    const pooledExec = makeExec([{ v: 0 }]);
    vi.mocked(getDbExec).mockReturnValue(pooledExec);
    vi.mocked(getMigrationDatabaseUrl).mockReturnValue("postgres://direct");

    const sharedDirectExec = makeExec([{ v: 0 }]);
    vi.mocked(createDbExec).mockResolvedValue(sharedDirectExec);

    const m1 = [
      { version: 1, sql: "CREATE TABLE shared_a (id BIGINT PRIMARY KEY)" },
    ];
    const m2 = [
      { version: 1, sql: "CREATE TABLE shared_b (id BIGINT PRIMARY KEY)" },
    ];

    const plugin1 = runMigrations(m1, { table: "shared_a_migrations" });
    const plugin2 = runMigrations(m2, { table: "shared_b_migrations" });

    // Run both plugins concurrently
    await Promise.all([plugin1(null), plugin2(null)]);

    // createDbExec must have been called exactly once (shared exec)
    expect(createDbExec).toHaveBeenCalledTimes(1);
    // close() must be called exactly once (last releaser)
    expect(sharedDirectExec.close).toHaveBeenCalledTimes(1);
  });
});

describe("runMigrations – name-based tracking", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("applies a named migration despite version <= recorded MAX (the collision fix)", async () => {
    // Regression case: analytics_migrations reports MAX=83 (a colliding
    // branch's versions), but the named row for this migration was never
    // recorded — it must still apply.
    vi.mocked(isPostgres).mockReturnValue(false);
    const exec = makeNamedExec({ version: 83, appliedNames: [] });
    vi.mocked(getDbExec).mockReturnValue(exec);

    const migrations = [
      {
        version: 75,
        name: "alert-rules-table",
        sql: "CREATE TABLE analytics_alert_rules (id TEXT PRIMARY KEY)",
      },
    ];

    const plugin = runMigrations(migrations, { table: "analytics_migrations" });
    await plugin(null);

    const calls = exec.execute.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(
      calls.some((s) => /CREATE TABLE analytics_alert_rules/i.test(s)),
    ).toBe(true);
    expect(exec.insertedNames).toContain("alert-rules-table");
  });

  it("does not re-apply a named migration whose name is already recorded", async () => {
    vi.mocked(isPostgres).mockReturnValue(false);
    const exec = makeNamedExec({
      version: 83,
      appliedNames: ["alert-rules-table"],
    });
    vi.mocked(getDbExec).mockReturnValue(exec);

    const migrations = [
      {
        version: 75,
        name: "alert-rules-table",
        sql: "CREATE TABLE analytics_alert_rules (id TEXT PRIMARY KEY)",
      },
    ];

    const plugin = runMigrations(migrations, { table: "analytics_migrations" });
    await plugin(null);

    const calls = exec.execute.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(
      calls.some((s) => /CREATE TABLE analytics_alert_rules/i.test(s)),
    ).toBe(false);
  });

  it("does not re-apply on a second run after recording the name", async () => {
    vi.mocked(isPostgres).mockReturnValue(false);
    // First run: name not yet applied.
    const firstExec = makeNamedExec({ version: 5, appliedNames: [] });
    vi.mocked(getDbExec).mockReturnValue(firstExec);

    const migrations = [
      {
        version: 6,
        name: "second-run-guard",
        sql: "CREATE TABLE second_run_guard (id TEXT PRIMARY KEY)",
      },
    ];

    const plugin = runMigrations(migrations, {
      table: "second_run_migrations",
    });
    await plugin(null);
    expect(firstExec.insertedNames).toContain("second-run-guard");

    // Second run: simulate the name now being recorded (as the first run
    // would have left it) — the migration must be skipped this time.
    const secondExec = makeNamedExec({
      version: 6,
      appliedNames: ["second-run-guard"],
    });
    vi.mocked(getDbExec).mockReturnValue(secondExec);

    await plugin(null);
    const calls = secondExec.execute.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(calls.some((s) => /CREATE TABLE second_run_guard/i.test(s))).toBe(
      false,
    );
  });

  it("keeps unnamed legacy migrations gated purely by version > MAX", async () => {
    vi.mocked(isPostgres).mockReturnValue(false);
    const exec = makeNamedExec({ version: 2, appliedNames: [] });
    vi.mocked(getDbExec).mockReturnValue(exec);

    const migrations = [
      { version: 1, sql: "CREATE TABLE t1 (id INTEGER PRIMARY KEY)" },
      { version: 2, sql: "CREATE TABLE t2 (id INTEGER PRIMARY KEY)" },
      { version: 3, sql: "CREATE TABLE t3 (id INTEGER PRIMARY KEY)" },
    ];

    const plugin = runMigrations(migrations, { table: "legacy_migrations" });
    await plugin(null);

    const calls = exec.execute.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0] as { sql: string }).sql,
    );
    // v1/v2 already applied (version <= MAX), only v3 should run.
    expect(calls.some((s) => /CREATE TABLE t1/i.test(s))).toBe(false);
    expect(calls.some((s) => /CREATE TABLE t2/i.test(s))).toBe(false);
    expect(calls.some((s) => /CREATE TABLE t3/i.test(s))).toBe(true);
  });

  it("throws at startup on a duplicate migration name", () => {
    const migrations = [
      { version: 1, name: "dup-name", sql: "CREATE TABLE a (id TEXT)" },
      { version: 2, name: "dup-name", sql: "CREATE TABLE b (id TEXT)" },
    ];

    expect(() =>
      runMigrations(migrations, { table: "dup_name_migrations" }),
    ).toThrow(/duplicate migration name/i);
  });

  it("does not throw for a mixed list of unique named and unnamed entries", () => {
    const migrations = [
      { version: 1, sql: "CREATE TABLE a (id TEXT)" },
      { version: 2, name: "named-one", sql: "CREATE TABLE b (id TEXT)" },
      { version: 3, sql: "CREATE TABLE c (id TEXT)" },
      { version: 4, name: "named-two", sql: "CREATE TABLE d (id TEXT)" },
    ];

    expect(() =>
      runMigrations(migrations, { table: "mixed_list_migrations" }),
    ).not.toThrow();
  });

  it("advances the legacy version row when a named migration's version exceeds MAX", async () => {
    vi.mocked(isPostgres).mockReturnValue(false);
    const exec = makeNamedExec({ version: 5, appliedNames: [] });
    vi.mocked(getDbExec).mockReturnValue(exec);

    const migrations = [
      {
        version: 6,
        name: "advances-legacy",
        sql: "CREATE TABLE advances_legacy (id TEXT PRIMARY KEY)",
      },
    ];

    const plugin = runMigrations(migrations, {
      table: "advances_legacy_migrations",
    });
    await plugin(null);

    // Both the named row AND the legacy version row should be recorded,
    // since version 6 > current max of 5.
    expect(exec.insertedNames).toContain("advances-legacy");
    expect(exec.insertedVersions).toContain(6);
  });

  it("applies a named migration on Postgres despite a stale direct-endpoint version", async () => {
    vi.mocked(isPostgres).mockReturnValue(true);
    const pooledExec = makeNamedExec({ version: 83, appliedNames: [] });
    vi.mocked(getDbExec).mockReturnValue(pooledExec);
    vi.mocked(getMigrationDatabaseUrl).mockReturnValue("postgres://direct");

    const directExec = makeNamedExec({ version: 83, appliedNames: [] });
    vi.mocked(createDbExec).mockResolvedValue(directExec);

    const migrations = [
      {
        version: 75,
        name: "pg-alert-rules-table",
        sql: {
          postgres: "CREATE TABLE analytics_alert_rules (id TEXT PRIMARY KEY)",
        },
      },
    ];

    const plugin = runMigrations(migrations, {
      table: "pg_named_migrations",
    });
    await plugin(null);

    expect(createDbExec).toHaveBeenCalledWith({ url: "postgres://direct" });
    expect(directExec.insertedNames).toContain("pg-alert-rules-table");
  });
});
