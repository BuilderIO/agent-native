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
