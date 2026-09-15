import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDbExec: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => mocks);

const {
  isHistoricalAnalyticsRollupBackfillComplete,
  runAnalyticsRollupBackfillOnce,
} = await import("./analytics-rollup-backfill");

function makeTransactionalDb(options: { lock?: boolean } = {}) {
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
  return { db, tx };
}

beforeEach(() => {
  vi.stubEnv("ANALYTICS_ROLLUP_BACKFILL_JOBS", "");
  mocks.getDbExec.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analytics historical rollup backfill", () => {
  it("skips the legacy scan when explicitly disabled", async () => {
    vi.stubEnv("ANALYTICS_ROLLUP_BACKFILL_JOBS", "0");
    const { db } = makeTransactionalDb();

    await expect(runAnalyticsRollupBackfillOnce()).resolves.toEqual({
      status: "disabled",
      remaining: 1,
    });

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rebuilds both rollups and records completion in one Postgres transaction", async () => {
    const { db, tx } = makeTransactionalDb();

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
    const { tx } = makeTransactionalDb({ lock: false });

    await expect(runAnalyticsRollupBackfillOnce()).resolves.toEqual({
      status: "skipped-lock",
      remaining: 1,
    });

    // Assert what actually matters — losing the lock does no backfill work and
    // records no completion — rather than a raw call count, which broke the
    // moment a statement was legitimately added ahead of the lock.
    const executed = tx.execute.mock.calls.map(([arg]: [unknown]) =>
      typeof arg === "string" ? arg : ((arg as { sql?: string })?.sql ?? ""),
    );
    expect(
      executed.some((s) => s.includes("analytics_event_daily_rollups")),
    ).toBe(false);
    expect(executed.some((s) => s.includes("completed"))).toBe(false);
    // The backfill scans a 41 GB table under a 15-minute lease, so it must
    // raise its own statement_timeout before a role-level cap can kill it.
    expect(
      executed.some((s) => s.includes("SET LOCAL statement_timeout")),
    ).toBe(true);
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
    await expect(isHistoricalAnalyticsRollupBackfillComplete()).resolves.toBe(
      false,
    );
    await expect(isHistoricalAnalyticsRollupBackfillComplete()).resolves.toBe(
      true,
    );
  });
});
