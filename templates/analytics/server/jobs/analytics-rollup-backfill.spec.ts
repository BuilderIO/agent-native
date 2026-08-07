import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDbExec: vi.fn(),
  getDialect: vi.fn(),
  isPostgres: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => mocks);

const {
  isHistoricalAnalyticsRollupBackfillComplete,
  runAnalyticsRollupBackfillOnce,
} = await import("./analytics-rollup-backfill");

function makeTransactionalDb(options: { postgres: boolean; lock?: boolean }) {
  let completed = false;
  const tx = {
    execute: vi.fn(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("pg_try_advisory_xact_lock")) {
          return {
            rows: [{ acquired: options.lock ?? true }],
            rowsAffected: 0,
          };
        }
        if (sql.includes("SELECT status")) {
          return {
            rows: completed ? [{ status: "completed" }] : [],
            rowsAffected: 0,
          };
        }
        if (sql.includes("SET status = 'completed'")) completed = true;
        return { rows: [], rowsAffected: 1 };
      },
    ),
  };
  const db = {
    execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
    transaction: vi.fn(
      async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
  mocks.getDbExec.mockReturnValue(db);
  mocks.getDialect.mockReturnValue(options.postgres ? "postgres" : "sqlite");
  mocks.isPostgres.mockReturnValue(options.postgres);
  return { db, tx };
}

beforeEach(() => {
  vi.stubEnv("ANALYTICS_ROLLUP_BACKFILL_JOBS", "");
  mocks.getDbExec.mockReset();
  mocks.getDialect.mockReset();
  mocks.isPostgres.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analytics historical rollup backfill", () => {
  it("skips the legacy scan when explicitly disabled", async () => {
    vi.stubEnv("ANALYTICS_ROLLUP_BACKFILL_JOBS", "0");
    const { db } = makeTransactionalDb({ postgres: true });

    await expect(runAnalyticsRollupBackfillOnce()).resolves.toEqual({
      status: "disabled",
      remaining: 1,
    });

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rebuilds both rollups and records completion in one Postgres transaction", async () => {
    const { db, tx } = makeTransactionalDb({ postgres: true });

    await expect(runAnalyticsRollupBackfillOnce()).resolves.toEqual({
      status: "completed",
      remaining: 0,
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledWith(
      expect.stringContaining("FROM analytics_events"),
    );
    expect(tx.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("SET status = 'completed'"),
      }),
    );
  });

  it("skips a concurrent Postgres backfill without recording completion", async () => {
    const { tx } = makeTransactionalDb({ postgres: true, lock: false });

    await expect(runAnalyticsRollupBackfillOnce()).resolves.toEqual({
      status: "skipped-lock",
      remaining: 1,
    });

    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("uses an atomic batch for D1", async () => {
    const db = {
      execute: vi.fn(async (query: string | { sql: string }) => {
        if (
          typeof query !== "string" &&
          query.sql.includes("status = 'running'")
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      }),
      atomicBatch: vi.fn(async (statements: readonly unknown[]) =>
        statements.map((_, index) => ({
          rows: [],
          rowsAffected: index === statements.length - 1 ? 1 : 0,
        })),
      ),
    };
    mocks.getDbExec.mockReturnValue(db);
    mocks.getDialect.mockReturnValue("d1");
    mocks.isPostgres.mockReturnValue(false);

    await expect(runAnalyticsRollupBackfillOnce()).resolves.toEqual({
      status: "completed",
      remaining: 0,
    });

    expect(db.atomicBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining("analytics_event_daily_rollups"),
        expect.objectContaining({
          sql: expect.stringContaining("SET status = 'completed'"),
        }),
      ]),
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("lease_expires_at"),
      }),
    );
  });

  it("skips a D1 backfill when another isolate owns the lease", async () => {
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 0 })
        .mockResolvedValueOnce({
          rows: [{ status: "running" }],
          rowsAffected: 0,
        }),
      atomicBatch: vi.fn(),
    };
    mocks.getDbExec.mockReturnValue(db);
    mocks.getDialect.mockReturnValue("d1");
    mocks.isPostgres.mockReturnValue(false);

    await expect(runAnalyticsRollupBackfillOnce()).resolves.toEqual({
      status: "skipped-lock",
      remaining: 1,
    });

    expect(db.atomicBatch).not.toHaveBeenCalled();
  });

  it("only reports completion after the durable state row is marked complete", async () => {
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ status: "pending" }],
          rowsAffected: 0,
        })
        .mockResolvedValueOnce({
          rows: [{ status: "completed" }],
          rowsAffected: 0,
        }),
    };
    mocks.getDbExec.mockReturnValue(db);
    mocks.getDialect.mockReturnValue("sqlite");
    mocks.isPostgres.mockReturnValue(false);

    await expect(isHistoricalAnalyticsRollupBackfillComplete()).resolves.toBe(
      false,
    );
    await expect(isHistoricalAnalyticsRollupBackfillComplete()).resolves.toBe(
      true,
    );
  });
});
