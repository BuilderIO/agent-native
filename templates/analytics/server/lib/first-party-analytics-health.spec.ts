import { beforeEach, describe, expect, it, vi } from "vitest";

const insertConflictUpdate = vi.hoisted(() => vi.fn());
const insertValues = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const getBackend = vi.hoisted(() => vi.fn());
const getBigQueryMetrics = vi.hoisted(() => vi.fn());
const getDeliveryHealth = vi.hoisted(() => vi.fn());
const deliveryNeedsAttention = vi.hoisted(() => vi.fn());
const isDeliveryQueueMissing = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb,
}));
vi.mock("./credentials.js", () => ({
  hasCredential: vi.fn().mockResolvedValue(true),
}));
vi.mock("./first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend: getBackend,
  getFirstPartyAnalyticsBigQueryMetrics: getBigQueryMetrics,
}));
vi.mock("./first-party-analytics-delivery.js", () => ({
  firstPartyAnalyticsDeliveryNeedsAttention: deliveryNeedsAttention,
  getFirstPartyAnalyticsDeliveryHealth: getDeliveryHealth,
  isFirstPartyAnalyticsDeliveryQueueMissingError: isDeliveryQueueMissing,
}));

import {
  classifyFirstPartyAnalyticsQuery,
  FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS,
  getFirstPartyAnalyticsHealth,
  queryOutcomeFromError,
  recordFirstPartyAnalyticsQueryPressure,
  unavailableFirstPartyAnalyticsHealth,
} from "./first-party-analytics-health";

beforeEach(() => {
  insertConflictUpdate.mockReset();
  insertValues.mockReset();
  insert.mockReset();
  getDb.mockReset();
  select.mockReset();
  getBackend.mockReset();
  getBigQueryMetrics.mockReset();
  getDeliveryHealth.mockReset();
  deliveryNeedsAttention.mockReset();
  isDeliveryQueueMissing.mockReset();
  insert.mockReturnValue({ values: insertValues });
  insertValues.mockReturnValue({ onConflictDoUpdate: insertConflictUpdate });
  insertConflictUpdate.mockResolvedValue(undefined);
  select.mockReturnValue({
    from: () => ({ where: async () => [] }),
  });
  getDb.mockReturnValue({ insert, select });
  getBackend.mockResolvedValue({
    sink: "bigquery",
    table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
  });
  getBigQueryMetrics.mockResolvedValue({
    eventCount: 0,
    dailyRollupRows: 0,
    firstEventDate: null,
    lastEventDate: null,
  });
  getDeliveryHealth.mockResolvedValue({
    pendingCount: 0,
    oldestPendingAt: null,
    lastDeliveredAt: null,
    lastError: null,
  });
  deliveryNeedsAttention.mockImplementation(
    (health: { lastError: string | null }) => Boolean(health.lastError),
  );
  isDeliveryQueueMissing.mockReturnValue(false);
});

describe("first-party analytics pressure", () => {
  it("classifies raw, rollup, replay, and mixed queries without retaining SQL", () => {
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT count(*) FROM analytics_events WHERE event_date >= '2026-08-01'",
      ),
    ).toBe("raw-events");
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT event_date, SUM(event_count) FROM analytics_event_daily_rollups GROUP BY event_date",
      ),
    ).toBe("rollups");
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT id FROM session_recordings WHERE started_at >= '2026-08-01'",
      ),
    ).toBe("session-replay");
    expect(
      classifyFirstPartyAnalyticsQuery(
        "SELECT * FROM analytics_events JOIN analytics_user_days USING (event_date)",
      ),
    ).toBe("mixed");
  });

  it("distinguishes timeout failures from other query errors", () => {
    expect(queryOutcomeFromError(new Error("query timed out"))).toBe("timeout");
    expect(queryOutcomeFromError(new Error("permission denied"))).toBe("error");
  });

  it("writes an aggregate row for a slow query and keeps the query class only", async () => {
    await recordFirstPartyAnalyticsQueryPressure(
      { userEmail: "owner@example.com", orgId: "org_123" },
      {
        durationMs: FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.slowQueryMs,
        outcome: "success",
        queryClass: "raw-events",
      },
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "org:org_123",
        eventDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        queryClass: "raw-events",
        slowQueryCount: 1,
        totalDurationMs: 5_000,
        maxDurationMs: 5_000,
        lastSeenAt: expect.stringMatching(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      }),
    );
    expect(insertConflictUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          slowQueryCount: expect.anything(),
          maxDurationMs: expect.anything(),
        }),
      }),
    );
  });

  it("does not write fast successful queries", async () => {
    await recordFirstPartyAnalyticsQueryPressure(
      { userEmail: "owner@example.com", orgId: null },
      { durationMs: 100, outcome: "success", queryClass: "rollups" },
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it("advertises the verified external analytics backends", () => {
    const health = unavailableFirstPartyAnalyticsHealth();

    expect(health.externalBackends.map((backend) => backend.id)).toEqual([
      "bigquery",
      "amplitude",
    ]);
    expect(health.externalBackends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bigquery",
          role: "warehouse",
          setupLink: expect.stringContaining("bigquery"),
        }),
        expect.objectContaining({
          id: "amplitude",
          role: "product-analytics",
          setupLink: expect.stringContaining("amplitude"),
        }),
      ]),
    );
    expect(health.bigQuery.id).toBe("bigquery");
  });

  it("reports degraded delivery while the queue migration is pending", async () => {
    getDeliveryHealth.mockRejectedValueOnce(
      new Error('relation "analytics_bigquery_delivery_queue" does not exist'),
    );
    isDeliveryQueueMissing.mockReturnValueOnce(true);

    const health = await getFirstPartyAnalyticsHealth({
      userEmail: "owner@example.com",
      orgId: "org_builder",
    });

    expect(health.status).toBe("monitor");
    expect(health.reasons).toContain("delivery_backlog");
    expect(health.delivery.lastError).toBe(
      "BigQuery delivery queue migration is pending",
    );
  });

  it("does not report event volume as a BigQuery migration reason after cutover", async () => {
    getBigQueryMetrics.mockResolvedValueOnce({
      eventCount: 1_000_001,
      dailyRollupRows: 1,
      firstEventDate: "2026-10-10",
      lastEventDate: "2026-10-10",
    });

    const health = await getFirstPartyAnalyticsHealth({
      userEmail: "owner@example.com",
      orgId: "org_builder",
    });

    expect(health.status).toBe("healthy");
    expect(health.reasons).not.toContain("event_volume");
    expect(health.recommendation).toBe("none");
    expect(health.externalBackendRecommendation).toBe("none");
  });

  it("keeps BigQuery query pressure visible without recommending another cutover", async () => {
    getBigQueryMetrics.mockResolvedValueOnce({
      eventCount: 1_000_001,
      dailyRollupRows: 1,
      firstEventDate: "2026-10-10",
      lastEventDate: "2026-10-10",
    });
    select.mockReturnValueOnce({
      from: () => ({
        where: async () => [
          {
            slowQueryCount: 3,
            timeoutCount: 1,
            errorCount: 0,
            maxDurationMs: 30_000,
          },
        ],
      }),
    });

    const health = await getFirstPartyAnalyticsHealth({
      userEmail: "owner@example.com",
      orgId: "org_builder",
    });

    expect(health.status).toBe("monitor");
    expect(health.reasons).toEqual(["slow_queries", "query_timeout"]);
    expect(health.recommendation).toBe("none");
    expect(health.externalBackendRecommendation).toBe("none");
  });

  it("recommends BigQuery when the built-in sink crosses a migration threshold", async () => {
    getBackend.mockResolvedValueOnce({
      sink: "postgres",
      table: "analytics_events",
    });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: async () => [
            {
              eventCount: 1_000_001,
              dailyRollupRows: 1,
              firstEventDate: "2026-10-10",
              lastEventDate: "2026-10-10",
            },
          ],
        }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: async () => [] }),
      });

    const health = await getFirstPartyAnalyticsHealth({
      userEmail: "owner@example.com",
      orgId: "org_builder",
    });

    expect(health.status).toBe("recommend_bigquery");
    expect(health.reasons).toContain("event_volume");
    expect(health.recommendation).toBe("use_bigquery");
    expect(health.externalBackendRecommendation).toBe("use");
  });
});
