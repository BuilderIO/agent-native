import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDbExec: vi.fn(),
  isPostgres: vi.fn(),
  runWithRequestContext: vi.fn(),
  backfill: vi.fn(),
  saveBackend: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: mocks.getDbExec,
  isPostgres: mocks.isPostgres,
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));
vi.mock("../lib/first-party-analytics-backend.js", () => ({
  backfillFirstPartyAnalyticsBatch: mocks.backfill,
  saveFirstPartyAnalyticsBackend: mocks.saveBackend,
}));

const {
  getFirstPartyAnalyticsBigQueryBackfillJob,
  queueFirstPartyAnalyticsBigQueryBackfill,
  runFirstPartyAnalyticsBigQueryBackfillOnce,
} = await import("./analytics-bigquery-backfill.js");

const scope = { userEmail: "owner@example.com", orgId: "org_builder" };
const job = {
  id: "first-party-analytics:org_builder",
  org_id: "org_builder",
  owner_email: "owner@example.com",
  table_ref: "builder-3b0a2.analytics.first_party_analytics_events_raw",
  batch_size: 250,
  backfill_cursor: null,
  status: "pending",
  copied_count: 0,
  lease_token: null,
  lease_expires_at: null,
  next_run_at: "2026-08-07T00:00:00.000Z",
  last_error: null,
  completed_at: null,
  updated_at: "2026-08-07T00:00:00.000Z",
};
const queuedJob = { ...job, batch_size: 750 };

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.getDbExec.mockReset();
  mocks.isPostgres.mockReset().mockReturnValue(true);
  mocks.runWithRequestContext
    .mockReset()
    .mockImplementation(async (_context: unknown, fn: () => Promise<unknown>) =>
      fn(),
    );
  mocks.backfill.mockReset();
  mocks.saveBackend.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("durable BigQuery backfill worker", () => {
  it("pauses before claiming work when the database has lock waiters", async () => {
    const db = { execute: vi.fn() };
    db.execute.mockResolvedValue({
      rows: [
        {
          total_sessions: "10",
          active_sessions: "2",
          waiting_sessions: "4",
          lock_waiters: "1",
        },
      ],
    });
    mocks.getDbExec.mockReturnValue(db);

    await expect(runFirstPartyAnalyticsBigQueryBackfillOnce()).resolves.toEqual(
      expect.objectContaining({
        status: "paused-pressure",
        batches: 0,
        remaining: 1,
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it("fails closed when the pressure probe itself times out", async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error("database timeout")),
    };
    mocks.getDbExec.mockReturnValue(db);

    await expect(runFirstPartyAnalyticsBigQueryBackfillOnce()).resolves.toEqual(
      expect.objectContaining({
        status: "paused-pressure",
        reason: expect.stringContaining("pressure probe failed"),
      }),
    );
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it("claims and completes one bounded job batch", async () => {
    vi.stubEnv("ANALYTICS_BIGQUERY_BACKFILL_SWEEP_LIMIT", "1");
    vi.stubEnv("ANALYTICS_BIGQUERY_BACKFILL_BATCH_SIZE", "750");
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [job] })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
    };
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              total_sessions: "10",
              active_sessions: "2",
              waiting_sessions: "0",
              lock_waiters: "0",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              total_sessions: "10",
              active_sessions: "2",
              waiting_sessions: "0",
              lock_waiters: "0",
            },
          ],
        })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
      transaction: vi.fn(async (fn: (transaction: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    mocks.getDbExec.mockReturnValue(db);
    mocks.backfill.mockResolvedValue({
      nextCursor: JSON.stringify({
        receivedAt: "2026-08-07T00:00:00.000Z",
        id: "evt_last",
      }),
      copied: 250,
      complete: true,
    });

    await expect(runFirstPartyAnalyticsBigQueryBackfillOnce()).resolves.toEqual(
      expect.objectContaining({
        status: "completed",
        batches: 1,
        copied: 250,
        remaining: 0,
      }),
    );
    expect(mocks.backfill).toHaveBeenCalledWith(
      scope,
      null,
      750,
      job.table_ref,
    );
    expect(mocks.saveBackend).not.toHaveBeenCalled();
  });

  it("persists a bounded job when prepare queues a migration", async () => {
    const queuedJob = { ...job, batch_size: 750 };
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [queuedJob] }),
    };
    mocks.getDbExec.mockReturnValue(db);

    await expect(
      queueFirstPartyAnalyticsBigQueryBackfill(scope, job.table_ref, 5_000),
    ).resolves.toMatchObject({
      id: job.id,
      batchSize: 750,
      status: "pending",
    });
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining(
          "ON CONFLICT (id) DO UPDATE SET batch_size",
        ),
        args: expect.arrayContaining([scope.orgId, scope.userEmail, 750]),
      }),
    );
  });

  it("seeds a recovered job with the legacy cursor", async () => {
    const legacyCursor = JSON.stringify({
      receivedAt: "2026-08-07T00:00:00.000Z",
      id: "evt_last",
    });
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ ...job, backfill_cursor: legacyCursor }],
        }),
    };
    mocks.getDbExec.mockReturnValue(db);

    await expect(
      queueFirstPartyAnalyticsBigQueryBackfill(
        scope,
        job.table_ref,
        250,
        legacyCursor,
      ),
    ).resolves.toMatchObject({ cursor: legacyCursor, status: "pending" });
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([legacyCursor]),
      }),
    );
  });

  it("does not reset a pending job when prepare is repeated", async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [job] }),
    };
    mocks.getDbExec.mockReturnValue(db);

    await expect(
      queueFirstPartyAnalyticsBigQueryBackfill(scope, job.table_ref, 750),
    ).resolves.toMatchObject({
      id: job.id,
      status: "pending",
      batchSize: 250,
    });
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining(
          "ON CONFLICT (id) DO UPDATE SET batch_size",
        ),
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("does not run while explicitly disabled", async () => {
    vi.stubEnv("ANALYTICS_BIGQUERY_BACKFILL_JOBS", "0");
    const db = { execute: vi.fn() };
    mocks.getDbExec.mockReturnValue(db);

    await expect(runFirstPartyAnalyticsBigQueryBackfillOnce()).resolves.toEqual(
      { status: "disabled", batches: 0, copied: 0, remaining: 0 },
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("returns the scoped job status without broad reads", async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [job] }) };
    mocks.getDbExec.mockReturnValue(db);

    await expect(
      getFirstPartyAnalyticsBigQueryBackfillJob(scope),
    ).resolves.toMatchObject({
      id: job.id,
      orgId: scope.orgId,
      ownerEmail: scope.userEmail,
      status: "pending",
    });
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("FROM analytics_bigquery_backfill_jobs"),
      }),
    );
  });
});
