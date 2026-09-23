import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDbExec: vi.fn(),
  runWithRequestContext: vi.fn(),
  insert: vi.fn(),
  insertWithResults: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: mocks.getDbExec,
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));
vi.mock("./first-party-analytics-backend.js", () => ({
  FIRST_PARTY_ANALYTICS_BACKFILL_COLUMNS: ["id", "owner_email", "org_id"],
  insertFirstPartyAnalyticsRows: mocks.insert,
  insertFirstPartyAnalyticsRowsWithResults: mocks.insertWithResults,
}));

const {
  FIRST_PARTY_ANALYTICS_DELIVERY_MAX_ATTEMPTS,
  FIRST_PARTY_ANALYTICS_DELIVERY_STALE_MS,
  firstPartyAnalyticsDeliveryNeedsAttention,
  getFirstPartyAnalyticsDeliveryHealth,
  isFirstPartyAnalyticsDeliveryQueueMissingError,
  runFirstPartyAnalyticsBigQueryDeliveryOnce,
  unavailableFirstPartyAnalyticsDeliverySweep,
} = await import("./first-party-analytics-delivery.js");

const queueRow = {
  event_id: "evt_1",
  owner_email: "owner@example.com",
  org_id: "org_builder",
  table_ref: "builder-3b0a2.analytics.first_party_analytics_events_raw",
  attempt_count: 0,
  created_at: "2026-09-11T00:00:00.000Z",
};
const eventRow = {
  id: "evt_1",
  owner_email: "owner@example.com",
  org_id: "org_builder",
};

beforeEach(() => {
  mocks.getDbExec.mockReset();
  mocks.runWithRequestContext
    .mockReset()
    .mockImplementation(async (_context: unknown, fn: () => Promise<unknown>) =>
      fn(),
    );
  mocks.insert.mockReset();
  mocks.insertWithResults.mockReset().mockResolvedValue({
    acceptedIds: ["evt_1"],
    rejectedIds: [],
    error: null,
  });
});

describe("BigQuery delivery queue", () => {
  it("delivers a leased event and leaves the durable receipt until cleanup", async () => {
    const claimTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [queueRow] })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
    };
    const emptyTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const cleanupTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rowsAffected: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [eventRow] })
        .mockResolvedValueOnce({ rowsAffected: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              pending_count: "0",
              oldest_pending_at: null,
              last_delivered_at: "2026-09-11T00:01:00.000Z",
              last_error: null,
            },
          ],
        }),
      transaction: vi
        .fn()
        .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(claimTx))
        .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(emptyTx))
        .mockImplementationOnce((fn: (tx: unknown) => unknown) =>
          fn(cleanupTx),
        ),
    };
    mocks.getDbExec.mockReturnValue(db);

    await expect(runFirstPartyAnalyticsBigQueryDeliveryOnce()).resolves.toEqual(
      expect.objectContaining({
        status: "progress",
        batches: 1,
        delivered: 1,
        pendingCount: 0,
      }),
    );
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org_builder" },
      expect.any(Function),
    );
    expect(mocks.insertWithResults).toHaveBeenCalledWith(
      [eventRow],
      queueRow.table_ref,
      { maxRowsPerRequest: 500, maxConcurrentRequests: 4 },
    );
    expect(claimTx.execute.mock.calls[0]?.[0]?.args?.[1]).toBe(2_000);
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("deliveryState"),
      }),
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("UPDATE settings"),
      }),
    );
    const reconcileSql = db.execute.mock.calls[0]?.[0]?.sql as string;
    expect(reconcileSql).toMatch(
      /deliveryState[\s\S]*NOT EXISTS[\s\S]*LIMIT \$2/,
    );
  });

  it("keeps later tenant leases unclaimed while a BigQuery request runs past the lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T00:00:00.000Z"));
    const secondQueueRow = {
      ...queueRow,
      event_id: "evt_2",
      owner_email: "other@example.com",
      org_id: "org_other",
      table_ref: "builder-3b0a2.analytics.other_events_raw",
    };
    const secondEventRow = {
      ...eventRow,
      id: "evt_2",
      owner_email: secondQueueRow.owner_email,
      org_id: secondQueueRow.org_id,
    };
    let firstInsertInProgress = false;
    let secondClaimDuringFirstInsert = false;
    const claimTimes: number[] = [];
    const renewals: string[][] = [];
    const eventRows = [eventRow, secondEventRow];
    const claimTransactions = [
      {
        execute: vi
          .fn()
          .mockImplementationOnce(async (query: { sql: string }) => {
            claimTimes.push(Date.now());
            expect(query.sql).toContain("WITH next_scope AS MATERIALIZED");
            expect(query.sql).toContain(
              "delivery.table_ref IS NOT DISTINCT FROM scope.table_ref",
            );
            return { rows: [queueRow] };
          })
          .mockResolvedValueOnce({ rowsAffected: 1 }),
      },
      {
        execute: vi
          .fn()
          .mockImplementationOnce(async () => {
            if (firstInsertInProgress) secondClaimDuringFirstInsert = true;
            claimTimes.push(Date.now());
            return { rows: [secondQueueRow] };
          })
          .mockResolvedValueOnce({ rowsAffected: 1 }),
      },
      { execute: vi.fn().mockResolvedValue({ rows: [] }) },
    ];
    const cleanupTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    let transactionIndex = 0;
    const db = {
      execute: vi.fn(async (query: { sql: string; args?: unknown[] }) => {
        if (
          query.sql.includes("INSERT INTO analytics_bigquery_delivery_queue")
        ) {
          return { rowsAffected: 0 };
        }
        if (query.sql.includes("lease_expires_at = $1")) {
          const ids = query.args?.slice(3) as string[];
          renewals.push(ids);
          return { rowsAffected: ids.length };
        }
        if (query.sql.includes("FROM analytics_events")) {
          const ids = query.args as string[];
          return { rows: eventRows.filter((row) => ids.includes(row.id)) };
        }
        if (query.sql.includes("UPDATE settings")) {
          return { rowsAffected: 0 };
        }
        if (query.sql.includes("SET delivered_at = $1")) {
          return { rowsAffected: (query.args?.length ?? 2) - 2 };
        }
        if (query.sql.includes("pending_count")) {
          return {
            rows: [
              {
                pending_count: "0",
                oldest_pending_at: null,
                last_delivered_at: "2026-09-22T00:06:00.000Z",
                last_error: null,
              },
            ],
          };
        }
        throw new Error(`Unexpected delivery query: ${query.sql}`);
      }),
      transaction: vi.fn((fn: (tx: unknown) => unknown) => {
        const tx = claimTransactions[transactionIndex] ?? cleanupTx;
        if (transactionIndex < claimTransactions.length) transactionIndex += 1;
        return fn(tx);
      }),
    };
    mocks.getDbExec.mockReturnValue(db);
    mocks.insertWithResults.mockImplementation(
      async (rows: Array<{ id: string }>) => {
        if (rows[0]?.id === "evt_1") {
          firstInsertInProgress = true;
          await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
          firstInsertInProgress = false;
        }
        return {
          acceptedIds: rows.map((row) => row.id),
          rejectedIds: [],
          error: null,
        };
      },
    );
    try {
      await expect(
        runFirstPartyAnalyticsBigQueryDeliveryOnce(),
      ).resolves.toMatchObject({
        status: "progress",
        delivered: 2,
      });
      expect(secondClaimDuringFirstInsert).toBe(false);
      expect(claimTimes).toHaveLength(2);
      expect(claimTimes[1]! - claimTimes[0]!).toBeGreaterThan(5 * 60 * 1000);
      expect(
        renewals.filter((ids) => ids.includes("evt_1")).length,
      ).toBeGreaterThan(1);
      const secondGroupRenewal = renewals.findIndex((ids) =>
        ids.includes("evt_2"),
      );
      expect(secondGroupRenewal).toBeGreaterThan(0);
      expect(
        renewals
          .slice(0, secondGroupRenewal)
          .every((ids) => !ids.includes("evt_2")),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires terminal source events after their recovery retention", async () => {
    const terminalEventId = "evt_terminal";
    const claimTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const cleanupTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ event_id: terminalEventId }] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
    };
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rowsAffected: 0 })
        .mockResolvedValueOnce({
          rows: [
            {
              pending_count: "0",
              oldest_pending_at: null,
              last_delivered_at: null,
              last_error: null,
            },
          ],
        }),
      transaction: vi
        .fn()
        .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(claimTx))
        .mockImplementationOnce((fn: (tx: unknown) => unknown) =>
          fn(cleanupTx),
        ),
    };
    mocks.getDbExec.mockReturnValue(db);

    await expect(
      runFirstPartyAnalyticsBigQueryDeliveryOnce(),
    ).resolves.toMatchObject({
      status: "idle",
      cleaned: 1,
    });

    expect(cleanupTx.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("DELETE FROM analytics_events"),
        args: [terminalEventId],
      }),
    );
  });

  it("records a retry and exposes the failed receipt to the canary", async () => {
    const claimTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [queueRow] })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
    };
    const emptyTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const cleanupTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rowsAffected: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [eventRow] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              pending_count: "1",
              oldest_pending_at: queueRow.created_at,
              last_delivered_at: null,
              last_error: "warehouse unavailable",
            },
          ],
        }),
      transaction: vi
        .fn()
        .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(claimTx))
        .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(emptyTx))
        .mockImplementationOnce((fn: (tx: unknown) => unknown) =>
          fn(cleanupTx),
        ),
    };
    mocks.getDbExec.mockReturnValue(db);
    mocks.insertWithResults.mockRejectedValueOnce(
      new Error("warehouse unavailable"),
    );
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(runFirstPartyAnalyticsBigQueryDeliveryOnce()).resolves.toEqual(
      expect.objectContaining({
        status: "retry-scheduled",
        batches: 1,
        delivered: 0,
        pendingCount: 1,
        lastError: "warehouse unavailable",
      }),
    );

    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("attempt_count = attempt_count + 1"),
        args: expect.arrayContaining(["warehouse unavailable"]),
      }),
    );
    errorSpy.mockRestore();
  });

  it("marks repeated failures terminal after the bounded retry budget", async () => {
    const terminalQueueRow = {
      ...queueRow,
      attempt_count: FIRST_PARTY_ANALYTICS_DELIVERY_MAX_ATTEMPTS - 1,
    };
    const claimTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [terminalQueueRow] })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
    };
    const emptyTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const cleanupTx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rowsAffected: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [eventRow] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              pending_count: "0",
              oldest_pending_at: null,
              last_delivered_at: null,
              last_error: `[terminal after ${FIRST_PARTY_ANALYTICS_DELIVERY_MAX_ATTEMPTS} attempts] warehouse rejected`,
            },
          ],
        }),
      transaction: vi
        .fn()
        .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(claimTx))
        .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(emptyTx))
        .mockImplementationOnce((fn: (tx: unknown) => unknown) =>
          fn(cleanupTx),
        ),
    };
    mocks.getDbExec.mockReturnValue(db);
    mocks.insertWithResults.mockRejectedValueOnce(
      new Error("warehouse rejected"),
    );
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(runFirstPartyAnalyticsBigQueryDeliveryOnce()).resolves.toEqual(
      expect.objectContaining({
        status: "retry-scheduled",
        pendingCount: 0,
        lastError: `[terminal after ${FIRST_PARTY_ANALYTICS_DELIVERY_MAX_ATTEMPTS} attempts] warehouse rejected`,
      }),
    );
    const retryCall = db.execute.mock.calls.find(([query]) =>
      String(query?.sql).includes("terminal after"),
    );
    expect(retryCall?.[0]?.sql).toContain("attempt_count <");
    expect(retryCall?.[0]?.args).toEqual(
      expect.arrayContaining(["warehouse rejected"]),
    );
    errorSpy.mockRestore();
  });

  it("flags stale receipts and prior delivery errors", () => {
    const now = Date.parse("2026-09-11T01:00:00.000Z");
    expect(
      firstPartyAnalyticsDeliveryNeedsAttention(
        {
          pendingCount: 1,
          oldestPendingAt: new Date(
            now - FIRST_PARTY_ANALYTICS_DELIVERY_STALE_MS,
          ).toISOString(),
          lastDeliveredAt: null,
          lastError: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      firstPartyAnalyticsDeliveryNeedsAttention(
        {
          pendingCount: 0,
          oldestPendingAt: null,
          lastDeliveredAt: null,
          lastError: "one failed attempt",
        },
        now,
      ),
    ).toBe(true);
  });

  it("recognizes a rollout where the queue migration has not run yet", () => {
    expect(
      isFirstPartyAnalyticsDeliveryQueueMissingError(
        new Error(
          'relation "analytics_bigquery_delivery_queue" does not exist',
        ),
      ),
    ).toBe(true);
    expect(
      isFirstPartyAnalyticsDeliveryQueueMissingError(
        new Error("BigQuery is temporarily unavailable"),
      ),
    ).toBe(false);
    expect(unavailableFirstPartyAnalyticsDeliverySweep()).toMatchObject({
      status: "unavailable",
      batches: 0,
      delivered: 0,
    });
  });

  it("scopes health to the organization and its personal fallback", async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          {
            pending_count: "2",
            oldest_pending_at: "2026-09-11T00:00:00.000Z",
            last_delivered_at: null,
            last_error: null,
          },
        ],
      }),
    };

    await expect(
      getFirstPartyAnalyticsDeliveryHealth(
        { userEmail: "owner@example.com", orgId: "org_builder" },
        db,
      ),
    ).resolves.toEqual({
      pendingCount: 2,
      oldestPendingAt: "2026-09-11T00:00:00.000Z",
      lastDeliveredAt: null,
      lastError: null,
    });
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining(
          "org_id = $1 OR (org_id IS NULL AND owner_email = $2)",
        ),
        args: ["org_builder", "owner@example.com"],
      }),
    );
  });
});
