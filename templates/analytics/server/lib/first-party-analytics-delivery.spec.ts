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
        .mockResolvedValueOnce({ rows: [eventRow] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
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
        .mockResolvedValueOnce({ rows: [eventRow] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
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
