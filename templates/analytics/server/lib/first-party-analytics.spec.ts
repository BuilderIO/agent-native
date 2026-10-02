import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { resetAppConfigForTests } from "@agent-native/core/app-config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const execute = vi.fn();
const rollupMocks = vi.hoisted(() => ({
  upsert: vi.fn(),
}));
const healthMocks = vi.hoisted(() => ({
  classify: vi.fn(() => "other"),
  outcome: vi.fn(() => "error"),
  record: vi.fn(),
}));
const backendMocks = vi.hoisted(() => ({
  get: vi.fn(),
  table: vi.fn(),
  insert: vi.fn(),
  insertWithResults: vi.fn(),
  query: vi.fn(),
}));
const exceptionMocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  recordFailure: vi.fn(),
}));
const deliveryMocks = vi.hoisted(() => ({
  queueMissing: vi.fn(),
  fallbackKey: (eventId: string) =>
    `first-party-analytics-bigquery-fallback:${eventId}`,
}));
const analyticsDbMocks = vi.hoisted(() => {
  const getDb = vi.fn();
  const selectLimit = vi.fn();
  const insertValues = vi.fn();
  const insertOnConflictDoNothing = vi.fn();
  const updateWhere = vi.fn();
  const updateReturning = vi.fn();
  const db: Record<string, any> = {};
  db.execute = vi.fn();
  db.transaction = vi.fn(async (callback: (transaction: unknown) => unknown) =>
    callback(db),
  );
  db.select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: selectLimit })),
    })),
  }));
  db.insert = vi.fn(() => ({
    values: (...args: unknown[]) => {
      insertValues(...args);
      return { onConflictDoNothing: insertOnConflictDoNothing };
    },
  }));
  db.update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: (...args: unknown[]) => {
        updateWhere(...args);
        return { returning: updateReturning };
      },
    })),
  }));
  getDb.mockReturnValue(db);
  return {
    getDb,
    selectLimit,
    insertValues,
    insertOnConflictDoNothing,
    updateWhere,
    updateReturning,
    transactionExecute: db.execute,
    db,
  };
});

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({ execute }),
}));
vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: analyticsDbMocks.getDb,
}));
vi.mock("./first-party-analytics-rollups.js", () => ({
  upsertFirstPartyAnalyticsRollups: rollupMocks.upsert,
}));
vi.mock("./error-capture.js", () => ({
  EXCEPTION_EVENT_NAME: "$exception",
  ingestAnalyticsExceptionEvents: exceptionMocks.ingest,
  recordErrorIngestFailure: exceptionMocks.recordFailure,
}));
vi.mock("./first-party-analytics-health.js", () => ({
  classifyFirstPartyAnalyticsQuery: healthMocks.classify,
  queryOutcomeFromError: healthMocks.outcome,
  recordFirstPartyAnalyticsQueryPressure: healthMocks.record,
}));
vi.mock("./first-party-analytics-delivery.js", () => ({
  firstPartyAnalyticsDeliveryFallbackKey: deliveryMocks.fallbackKey,
  isFirstPartyAnalyticsDeliveryQueueMissingError: deliveryMocks.queueMissing,
}));
vi.mock("./first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend: backendMocks.get,
  getFirstPartyAnalyticsTable: backendMocks.table,
  insertFirstPartyAnalyticsRows: backendMocks.insert,
  insertFirstPartyAnalyticsRowsWithResults: backendMocks.insertWithResults,
  queryFirstPartyAnalyticsInBigQuery: backendMocks.query,
}));

import {
  isMarketingWebsiteSessionEvent,
  normalizeAnalyticsTimestamp,
  queryFirstPartyAnalytics,
  recordAnalyticsEvents,
  resolveAnalyticsEventDimensions,
  scopedAnalyticsSql,
  touchPublicKeyLastUsedAt,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics";

beforeEach(() => {
  execute.mockReset();
  analyticsDbMocks.getDb.mockReset();
  analyticsDbMocks.getDb.mockReturnValue(analyticsDbMocks.db);
  analyticsDbMocks.db.transaction.mockClear();
  analyticsDbMocks.transactionExecute.mockReset();
  analyticsDbMocks.transactionExecute.mockResolvedValue({ rowsAffected: 1 });
  analyticsDbMocks.selectLimit.mockReset();
  analyticsDbMocks.insertValues.mockReset();
  analyticsDbMocks.insertOnConflictDoNothing.mockReset();
  analyticsDbMocks.updateWhere.mockReset();
  analyticsDbMocks.updateReturning.mockReset();
  analyticsDbMocks.selectLimit.mockResolvedValue([
    { id: "apk_123", ownerEmail: "owner@example.com", orgId: null },
  ]);
  analyticsDbMocks.insertValues.mockResolvedValue(undefined);
  analyticsDbMocks.insertOnConflictDoNothing.mockResolvedValue(undefined);
  analyticsDbMocks.updateWhere.mockResolvedValue(undefined);
  analyticsDbMocks.updateReturning.mockResolvedValue([
    { eventCount: 1, eventLimit: 1_000_000 },
  ]);
  rollupMocks.upsert.mockReset();
  rollupMocks.upsert.mockResolvedValue({
    eventCount: 1,
    dailyRollupCount: 1,
    userDayCount: 1,
  });
  healthMocks.classify.mockClear();
  healthMocks.outcome.mockClear();
  healthMocks.record.mockReset();
  healthMocks.record.mockResolvedValue(undefined);
  backendMocks.get.mockReset();
  backendMocks.table.mockReset();
  backendMocks.insert.mockReset();
  backendMocks.insertWithResults
    .mockReset()
    .mockImplementation(async (rows: Array<{ id: string }>) => ({
      acceptedIds: rows.map((row) => row.id),
      rejectedIds: [],
      error: null,
    }));
  backendMocks.query.mockReset();
  exceptionMocks.ingest.mockReset();
  exceptionMocks.recordFailure.mockReset();
  deliveryMocks.queueMissing.mockReset();
  deliveryMocks.queueMissing.mockReturnValue(false);
  backendMocks.get.mockResolvedValue({
    sink: "postgres",
    table: null,
    backfillCursor: null,
    backfillCompleted: false,
  });
  backendMocks.table.mockResolvedValue({
    projectId: "builder-3b0a2",
    datasetId: "analytics",
    tableId: "first_party_analytics_events_raw",
    fullyQualified: "builder-3b0a2.analytics.first_party_analytics_events_raw",
  });
  backendMocks.insert.mockResolvedValue(1);
  backendMocks.query.mockResolvedValue({
    rows: [{ events: 1 }],
    schema: [{ name: "events", type: "number" }],
  });
  exceptionMocks.ingest.mockResolvedValue(undefined);
});

describe("public-key last-used stamp", () => {
  const source = readFileSync(
    new URL("./first-party-analytics.ts", import.meta.url),
    "utf8",
  );

  it("never writes the stamp inside a transaction", () => {
    const start = source.indexOf("db.transaction(");
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf("\n  }", start));
    expect(body).not.toContain("analyticsPublicKeys");
    expect(body).not.toContain("lastUsedAt");
  });

  it("throttles the stamp in SQL, not in the caller", () => {
    const fn = source.slice(source.indexOf("touchPublicKeyLastUsedAt("));
    const update = fn.slice(fn.indexOf(".update(schema.analyticsPublicKeys)"));
    const where = update.slice(0, update.indexOf("} catch"));
    expect(where).toContain("isNull(schema.analyticsPublicKeys.lastUsedAt)");
    expect(where).toContain("lt(schema.analyticsPublicKeys.lastUsedAt");
    expect(where).toContain("staleBefore");
  });

  it("routes every stamp write through the throttled helper", () => {
    let stampWrites = 0;
    for (const file of ["first-party-analytics.ts", "session-replay.ts"]) {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      stampWrites += (text.match(/\.set\(\{\s*lastUsedAt:/g) ?? []).length;
    }
    expect(stampWrites).toBe(1);
  });

  it("does not reject when acquiring the stamp database fails", async () => {
    analyticsDbMocks.getDb.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      touchPublicKeyLastUsedAt("apk_123", "2026-08-07T17:00:00.000Z"),
    ).resolves.toBeUndefined();
  });
});

describe("resolveAnalyticsEventDimensions", () => {
  it("promotes signup tracking attribution into queryable app/template columns", () => {
    expect(
      resolveAnalyticsEventDimensions({
        properties: {
          agent_native_app: "chat",
          agent_native_template: "plan",
        },
        context: {},
        hostname: null,
      }),
    ).toEqual({ app: "chat", template: "plan" });
  });

  it("keeps explicit app/template values ahead of compatibility aliases", () => {
    expect(
      resolveAnalyticsEventDimensions({
        properties: {
          app: "analytics",
          template: "docs",
          agent_native_app: "chat",
          agent_native_template: "plan",
        },
        context: {},
        hostname: "mail.agent-native.com",
      }),
    ).toEqual({ app: "analytics", template: "docs" });
  });

  it("prefers canonical app/template properties", () => {
    expect(
      resolveAnalyticsEventDimensions({
        properties: {
          app_name: "clips",
          template_name: "clips",
          app: "analytics",
          template: "docs",
        },
        context: {},
        hostname: "mail.agent-native.com",
      }),
    ).toEqual({ app: "clips", template: "clips" });
  });
});

describe("isMarketingWebsiteSessionEvent", () => {
  it("keeps www.agent-native.com out of signed-in session cohorts", () => {
    expect(
      isMarketingWebsiteSessionEvent({
        eventName: "session status",
        hostname: "www.agent-native.com",
        app: "www",
        template: "www",
      }),
    ).toBe(true);
  });

  it("keeps canonical session-status aliases out of signed-in session cohorts", () => {
    expect(
      isMarketingWebsiteSessionEvent({
        eventName: "session_status",
        hostname: "www.agent-native.com",
        app: "www",
        template: "www",
      }),
    ).toBe(true);
  });

  it("keeps legacy host-derived www events out when hostname was omitted", () => {
    expect(
      isMarketingWebsiteSessionEvent({
        eventName: "session status",
        hostname: null,
        app: " WWW ",
        template: "WWW",
      }),
    ).toBe(true);
  });

  it("does not suppress product-template session events", () => {
    expect(
      isMarketingWebsiteSessionEvent({
        eventName: "session status",
        hostname: "plan.agent-native.com",
        app: "plan",
        template: "plan",
      }),
    ).toBe(false);
  });
});

describe("recordAnalyticsEvents", () => {
  it("updates compact rollups after persisting raw events", async () => {
    await recordAnalyticsEvents("anpk_test", [
      {
        event: "pageview",
        userId: "user_1",
        properties: { app: "analytics", template: "analytics" },
      },
    ]);

    expect(rollupMocks.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          eventName: "pageview",
          ownerEmail: "owner@example.com",
          orgId: null,
          userKey: "user_1",
        }),
      ],
      analyticsDbMocks.db,
    );
    expect(
      analyticsDbMocks.insertValues.mock.invocationCallOrder[0],
    ).toBeLessThan(rollupMocks.upsert.mock.invocationCallOrder[0]);
  });

  it("does not acquire the retired historical-backfill lock during ingest", async () => {
    await recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]);

    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects the ingest when a rollup update fails", async () => {
    rollupMocks.upsert.mockRejectedValueOnce(new Error("rollup unavailable"));

    await expect(
      recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]),
    ).rejects.toThrow("rollup unavailable");
    expect(analyticsDbMocks.insertValues).toHaveBeenCalled();
  });

  it("persists both sides of a signup identity bridge", async () => {
    await recordAnalyticsEvents("anpk_test", [
      {
        event: "signup",
        userId: "new@example.com",
        anonymousId: "anon_signup_1",
      },
    ]);

    expect(analyticsDbMocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        eventName: "signup",
        userId: "new@example.com",
        anonymousId: "anon_signup_1",
      }),
    ]);
  });

  it("persists www session status as signed out", async () => {
    await recordAnalyticsEvents("anpk_test", [
      {
        event: "session status",
        properties: {
          url: "https://www.agent-native.com/docs",
          signed_in: true,
        },
      },
    ]);

    expect(analyticsDbMocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        app: "www",
        template: "www",
        signedIn: "false",
      }),
    ]);
  });

  it("stages cutover events durably until the warehouse confirms delivery", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });

    await recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]);

    expect(backendMocks.insert).not.toHaveBeenCalled();
    expect(analyticsDbMocks.insertValues).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ eventName: "pageview" }),
    ]);
    expect(analyticsDbMocks.insertValues).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        eventId: expect.any(String),
        ownerEmail: "owner@example.com",
        orgId: null,
        tableRef: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      }),
    ]);
    expect(rollupMocks.upsert).not.toHaveBeenCalled();
  });

  it("retains events while the delivery queue migration is pending", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });
    deliveryMocks.queueMissing.mockReturnValueOnce(true);
    analyticsDbMocks.db.transaction.mockRejectedValueOnce(
      new Error('relation "analytics_bigquery_delivery_queue" does not exist'),
    );

    await expect(
      recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]),
    ).resolves.toMatchObject({ accepted: 1 });

    expect(analyticsDbMocks.db.transaction).toHaveBeenCalledTimes(3);
    expect(analyticsDbMocks.insertValues).toHaveBeenCalledTimes(1);
    expect(analyticsDbMocks.transactionExecute).toHaveBeenCalledTimes(2);
    expect(analyticsDbMocks.transactionExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ queryChunks: expect.any(Array) }),
    );
    expect(backendMocks.insertWithResults).toHaveBeenCalledWith(
      [expect.objectContaining({ eventName: "pageview" })],
      "builder-3b0a2.analytics.first_party_analytics_events_raw",
    );
  });

  it("enforces the Postgres volume limit during dual writes", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "dual",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: false,
    });
    analyticsDbMocks.selectLimit
      .mockResolvedValueOnce([
        { id: "apk_123", ownerEmail: "owner@example.com", orgId: null },
      ])
      .mockResolvedValueOnce([
        { eventCount: 1_000_000, eventLimit: 1_000_000 },
      ]);
    analyticsDbMocks.updateReturning.mockResolvedValueOnce([]);

    await expect(
      recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]),
    ).rejects.toThrow("volume limit reached");

    expect(backendMocks.insert).toHaveBeenCalledWith(
      [expect.objectContaining({ eventName: "pageview" })],
      "builder-3b0a2.analytics.first_party_analytics_events_raw",
    );
    expect(analyticsDbMocks.insertValues).toHaveBeenCalledTimes(1);
    expect(rollupMocks.upsert).not.toHaveBeenCalled();
  });

  it("keeps derived exception issues in SQL after the event cutover", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });

    await recordAnalyticsEvents("anpk_test", [
      {
        event: "$exception",
        properties: { error: "boom", app: "analytics" },
      },
    ]);

    expect(backendMocks.insert).not.toHaveBeenCalled();
    expect(exceptionMocks.ingest).toHaveBeenCalledWith(
      {
        ownerEmail: "owner@example.com",
        orgId: null,
        publicKeyId: "apk_123",
      },
      [expect.objectContaining({ derived: expect.any(Object) })],
    );
  });

  it("counts a failed exception ingest instead of swallowing it", async () => {
    const failure = new Error("password authentication failed");
    exceptionMocks.ingest.mockRejectedValueOnce(failure);

    await expect(
      recordAnalyticsEvents("anpk_test", [
        { event: "$exception", properties: { error: "a", app: "analytics" } },
        { event: "$exception", properties: { error: "b", app: "analytics" } },
      ]),
    ).resolves.toMatchObject({ accepted: 2 });

    expect(exceptionMocks.recordFailure).toHaveBeenCalledWith(2, failure);
  });

  it("keeps test identities out of analytics tables but routes their exceptions to error issues", async () => {
    const result = await recordAnalyticsEvents("anpk_test", [
      { event: "pageview", userId: "real@example.com" },
      { event: "pageview", userId: "qa+autoz@builder.io" },
      { event: "signup", properties: { user_email: "probe@agents.test" } },
      { event: "$exception", properties: { error: "real", app: "analytics" } },
      {
        event: "$exception",
        properties: { error: "qa", app: "analytics", test_identity: true },
      },
    ]);

    expect(result).toMatchObject({ accepted: 2, suppressedTestIdentity: 3 });
    expect(analyticsDbMocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        eventName: "pageview",
        userId: "real@example.com",
      }),
      expect.objectContaining({ eventName: "$exception" }),
    ]);
    expect(rollupMocks.upsert.mock.calls[0]?.[0]).toHaveLength(2);
    const [, sources] = exceptionMocks.ingest.mock.calls[0]!;
    expect(
      sources.map((source: { derived: { testIdentity: boolean } }) => [
        source.derived.testIdentity,
      ]),
    ).toEqual([[false], [true]]);
  });

  it("checks deployment-configured test identities a browser cannot know", async () => {
    vi.stubEnv("AGENT_NATIVE_TEST_IDENTITY_EMAILS", "qa@corp.com");
    resetAppConfigForTests();
    try {
      const result = await recordAnalyticsEvents("anpk_test", [
        { event: "pageview", userId: "qa@corp.com" },
        { event: "pageview", userId: "dev@corp.com" },
      ]);
      expect(result).toMatchObject({ accepted: 1, suppressedTestIdentity: 1 });
    } finally {
      vi.unstubAllEnvs();
      resetAppConfigForTests();
    }
  });

  it("preserves SQL exception issues while warehouse delivery is pending", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });
    await expect(
      recordAnalyticsEvents("anpk_test", [
        {
          event: "$exception",
          properties: { error: "boom", app: "analytics" },
        },
      ]),
    ).resolves.toMatchObject({ accepted: 1 });

    expect(backendMocks.insert).not.toHaveBeenCalled();
    expect(exceptionMocks.ingest).toHaveBeenCalledWith(
      {
        ownerEmail: "owner@example.com",
        orgId: null,
        publicKeyId: "apk_123",
      },
      [expect.objectContaining({ derived: expect.any(Object) })],
    );
    expect(analyticsDbMocks.updateWhere).toHaveBeenCalled();
  });
});

describe("validateFirstPartyAnalyticsSql", () => {
  it("rejects PostgreSQL-style bind placeholders outside string literals", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE timestamp >= $1",
      ),
    ).toThrow("Bind placeholders are not supported in dashboard SQL");
  });

  it("allows literal strings that mention a placeholder-like token", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT '$1' AS replacement_token FROM analytics_events",
      ),
    ).not.toThrow();
  });

  it("allows scoped session recording summary queries", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT app, COUNT(*) AS recordings FROM session_recordings WHERE owner_email = 'alice@example.com' GROUP BY app",
      ),
    ).not.toThrow();
  });

  it("allows compact event and user-day rollup queries", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT event_date, event_name, SUM(event_count) AS events FROM analytics_event_daily_rollups GROUP BY event_date, event_name",
      ),
    ).not.toThrow();
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT event_date, COUNT(*) AS active_users FROM analytics_user_days GROUP BY event_date",
      ),
    ).not.toThrow();
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT e.event_date FROM analytics_events e JOIN analytics_user_days u ON u.event_date = e.event_date",
      ),
    ).not.toThrow();
  });

  it("rejects PostgreSQL set-returning date functions, including infinite bounds", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT e.event_date FROM analytics_events e CROSS JOIN LATERAL pg_catalog.generate_series(1, 10000000, INTERVAL '1 day') AS days(day)",
      ),
    ).toThrow("table function pg_catalog.generate_series");
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "WITH bounds AS (SELECT '2000-01-01'::timestamp AS start_date, 'infinity'::timestamp AS end_date) SELECT e.event_date FROM analytics_events e CROSS JOIN bounds CROSS JOIN LATERAL pg_catalog.generate_series(bounds.start_date, bounds.end_date, INTERVAL '1 day') AS days(day)",
      ),
    ).toThrow("table function pg_catalog.generate_series");
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT e.event_date FROM analytics_events e CROSS JOIN LATERAL pg_catalog /* split */ . generate_series(1, 10000000, INTERVAL '1 day') AS days(day)",
      ),
    ).toThrow("table function pg_catalog.generate_series");
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT e.event_date FROM analytics_events e CROSS JOIN LATERAL custom_series(1, 2) AS days(day)",
      ),
    ).toThrow("cannot read from table function custom_series");
  });

  it("rejects set-returning functions in SELECT and CTE expressions", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT pg_catalog /* split */ . /* split */ generate_series(1, 2) AS day FROM analytics_events",
      ),
    ).toThrow("cannot call set-returning function generate_series");
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "WITH expanded AS (SELECT unnest(ARRAY[1, 2]) AS value FROM analytics_events) SELECT value FROM expanded",
      ),
    ).toThrow("cannot call set-returning function unnest");
  });

  it("rejects unapproved SQL functions that can escape tenant scoping", () => {
    for (const sql of [
      "SELECT Σ.sum(event_count) FROM analytics_event_daily_rollups",
      "SELECT table_to_xml('analytics_events'::regclass, false, true, '') AS leaked FROM analytics_events LIMIT 1",
      "SELECT table_to_xml(('analytics_' || 'events')::regclass, false, true, '') FROM session_recordings LIMIT 1",
      "SELECT query_to_xml('SELECT analytics_' || 'events', false, true, '') FROM session_recordings LIMIT 1",
      "SELECT ts_stat('SELECT * FROM analytics_events') FROM session_recordings LIMIT 1",
      "SELECT pg_sleep(1) FROM analytics_events",
      "SELECT public.sum(event_count) FROM analytics_event_daily_rollups",
    ]) {
      expect(() => validateFirstPartyAnalyticsSql(sql)).toThrow(
        "cannot call unapproved SQL function",
      );
    }
  });

  it("allows approved scalar functions and parenthesized SQL conditions", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT pg_catalog /* split */ . date_trunc('day', event_date), COALESCE(SUM(event_count), 0) FROM analytics_event_daily_rollups WHERE (event_date IS NOT NULL) GROUP BY event_date",
      ),
    ).not.toThrow();
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE 1.0 * COUNT(*) FILTER (WHERE event_date IS NOT NULL) / COUNT(*) END AS rate FROM analytics_events",
      ),
    ).not.toThrow();
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT .5 * COUNT(*) AS rate FROM analytics_events",
      ),
    ).not.toThrow();
  });

  it.each(["1.0", ".5", "1.", "1e+2", "1.0e-3"])(
    "allows numeric literal %s before an approved aggregate",
    (literal) => {
      expect(() =>
        validateFirstPartyAnalyticsSql(
          `SELECT ${literal} * COUNT(*) AS scaled_count FROM analytics_events`,
        ),
      ).not.toThrow();
    },
  );

  it.each([
    "1.0 * public.COUNT(*)",
    '1.0 * "public"."count"(*)',
    ".0foo.COUNT(*)",
    "1e2public.COUNT(*)",
  ])("rejects unapproved qualified aggregates after %s", (expression) => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        `SELECT ${expression} FROM analytics_events`,
      ),
    ).toThrow("cannot call unapproved SQL function");
  });

  it("rejects direct replay chunk queries", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT COUNT(*) AS chunks FROM session_replay_chunks",
      ),
    ).toThrow("session replay chunks");
  });

  it("rejects replay chunk names even as CTEs", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "WITH session_replay_chunks AS (SELECT id FROM analytics_events) SELECT COUNT(*) FROM session_replay_chunks",
      ),
    ).toThrow("session replay chunks");
  });

  it("rejects comma-separated sources instead of leaving the extra table unscoped", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT name FROM analytics_events, information_schema.tables",
      ),
    ).toThrow("Comma-separated table sources");
  });

  it("rejects quoted table sources that the scoping rewriter cannot replace", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        'SELECT name FROM analytics_events, "information_schema"',
      ),
    ).toThrow("Comma-separated table sources");
    expect(() =>
      validateFirstPartyAnalyticsSql('SELECT name FROM "analytics_events"'),
    ).toThrow("Quoted table identifiers");
  });

  it("rejects ONLY-qualified sources before they can bypass tenant scoping", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT COUNT(*) FROM ONLY analytics_events",
      ),
    ).toThrow("ONLY-qualified table sources");
  });
});

describe("normalizeAnalyticsTimestamp", () => {
  it("clamps future client timestamps to the server receive time", () => {
    expect(
      normalizeAnalyticsTimestamp(
        "2026-07-05T12:00:00.000Z",
        "2026-07-01T13:00:00.000Z",
      ),
    ).toBe("2026-07-01T13:00:00.000Z");
  });

  it("keeps valid past timestamps", () => {
    expect(
      normalizeAnalyticsTimestamp(
        "2026-06-30T12:00:00.000Z",
        "2026-07-01T13:00:00.000Z",
      ),
    ).toBe("2026-06-30T12:00:00.000Z");
  });

  it("clamps timestamps outside BigQuery's streaming date range to server receive time", () => {
    expect(
      normalizeAnalyticsTimestamp(
        "1978-09-22T20:14:12.587Z",
        "2026-09-22T20:14:13.110Z",
      ),
    ).toBe("2026-09-22T20:14:13.110Z");
  });
});

describe("scopedAnalyticsSql", () => {
  it("adds tenant and freshness guards around analytics event reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS count FROM analytics_events GROUP BY event_date",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM (SELECT * FROM analytics_events WHERE org_id = $1",
    );
    expect(scoped.sql).toContain(
      "UNION ALL SELECT * FROM analytics_events WHERE org_id IS NULL AND owner_email = $3",
    );
    expect(
      scoped.sql.match(
        /COALESCE\(NULLIF\(event_date, ''\), substr\(timestamp, 1, 10\)\) <= \$\d+/g,
      ),
    ).toHaveLength(2);
    expect(scoped.sql).not.toContain("org_id = $1 OR");
    expect(scoped.args).toEqual([
      "org_123",
      "2026-07-01",
      "alice@example.com",
      "2026-07-01",
    ]);
  });

  it("keeps org-scoped reads off personal and legacy owner rows", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS count FROM analytics_events GROUP BY event_date",
      {
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM (SELECT * FROM analytics_events WHERE org_id = $1",
    );
    expect(scoped.sql).not.toContain("org_id IS NULL");
    expect(scoped.sql).not.toContain("owner_email");
    expect(scoped.args).toEqual(["customer-org", "2026-07-01"]);
  });

  it("returns no rows for org-scoped reads without an org", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS count FROM analytics_events GROUP BY event_date",
      {
        userEmail: "admin@example.com",
        orgId: null,
        credentialScope: "org",
      },
      "2026-07-01",
    );

    expect(scoped.sql).toContain("WHERE 1 = 0");
    expect(scoped.sql).not.toContain("owner_email");
    expect(scoped.args).toEqual([]);
  });

  it("adds freshness guards around session recording reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT COUNT(*) AS recordings FROM session_recordings",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );

    expect(scoped.sql).toContain("substr(started_at, 1, 10) <= $2");
    expect(scoped.args).toEqual(["alice@example.com", "2026-07-01"]);
  });

  it("scopes rollups by tenant key without changing all-time lower bounds", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, event_name, SUM(event_count) AS events FROM analytics_event_daily_rollups GROUP BY event_date, event_name",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM (SELECT * FROM analytics_event_daily_rollups WHERE tenant_key = $1 AND event_date <= $2 UNION ALL SELECT * FROM analytics_event_daily_rollups WHERE tenant_key = $3 AND event_date <= $4)",
    );
    expect(scoped.sql).not.toContain("event_date >= $1");
    expect(scoped.args).toEqual([
      "org:org_123",
      "2026-07-01",
      "user:alice@example.com",
      "2026-07-01",
    ]);
  });

  it("keeps org-scoped rollups on the organization tenant only", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, event_name FROM analytics_event_daily_rollups",
      {
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      },
      "2026-07-01",
    );

    expect(scoped.sql).toContain("tenant_key = $1");
    expect(scoped.sql).not.toContain("user:admin@example.com");
    expect(scoped.args).toEqual(["org:customer-org", "2026-07-01"]);

    const missingOrg = scopedAnalyticsSql(
      "SELECT event_date, event_name FROM analytics_event_daily_rollups",
      {
        userEmail: "admin@example.com",
        orgId: null,
        credentialScope: "org",
      },
      "2026-07-01",
    );
    expect(missingOrg.sql).toContain("WHERE 1 = 0");
    expect(missingOrg.args).toEqual([]);
  });

  it("uses the personal tenant key for user-day rollups without an org", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS active_users FROM analytics_user_days GROUP BY event_date",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM (SELECT * FROM analytics_user_days WHERE tenant_key = $1 AND event_date <= $2 AND NOT (",
    );
    expect(scoped.args).toEqual(["user:alice@example.com", "2026-07-01"]);
  });

  it("excludes test identities from every source that carries an identity", async () => {
    const client = await PGlite.create("memory://");
    try {
      await client.query(
        "CREATE TABLE analytics_events (org_id text, owner_email text, event_date text, timestamp text, user_id text)",
      );
      await client.query(
        "CREATE TABLE session_recordings (org_id text, owner_email text, started_at text, user_id text)",
      );
      for (const userId of [
        "real@example.com",
        null,
        "qa+autoz@builder.io",
        "bot@agents.test",
      ]) {
        await client.query(
          "INSERT INTO analytics_events VALUES (NULL, 'alice@example.com', '2026-07-01', '2026-07-01T00:00:00Z', $1)",
          [userId],
        );
        await client.query(
          "INSERT INTO session_recordings VALUES (NULL, 'alice@example.com', '2026-07-01T00:00:00Z', $1)",
          [userId],
        );
      }
      const count = async (sql: string, includeTestIdentities?: boolean) => {
        const scoped = scopedAnalyticsSql(
          sql,
          { userEmail: "alice@example.com", orgId: null },
          "2026-07-01",
          { includeTestIdentities },
        );
        const result = (await client.query(scoped.sql, scoped.args)) as {
          rows: Array<{ n: number }>;
        };
        return Number(result.rows[0]!.n);
      };

      expect(await count("SELECT COUNT(*) AS n FROM analytics_events")).toBe(2);
      expect(await count("SELECT COUNT(*) AS n FROM session_recordings")).toBe(
        2,
      );
      expect(
        await count("SELECT COUNT(*) AS n FROM analytics_events", true),
      ).toBe(4);
    } finally {
      await client.close();
    }
  });

  it("leaves identity-free daily rollups unfiltered and renders the filter for BigQuery", async () => {
    const { renderFirstPartyAnalyticsBigQuerySql } = await vi.importActual<
      typeof import("./first-party-analytics-backend.js")
    >("./first-party-analytics-backend.js");
    const rollups = scopedAnalyticsSql(
      "SELECT SUM(event_count) AS events FROM analytics_event_daily_rollups",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );
    expect(rollups.sql).not.toContain("NOT (");

    const events = scopedAnalyticsSql(
      "SELECT COUNT(*) AS n FROM analytics_events",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );
    expect(events.sql.match(/AND NOT \(strpos\(/g)).toHaveLength(2);
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      events.sql,
      events.args,
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
    );
    expect(rendered).toMatch(
      /AND NOT \(strpos\(lower\(trim\(COALESCE\(user_id, ''\)\)\), '@'\) > 1 AND [^]*\)\) QUALIFY ROW_NUMBER\(\)/,
    );
  });
});

describe("queryFirstPartyAnalytics", () => {
  it("routes event queries to BigQuery after the org cuts over", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });

    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) AS count FROM analytics_events",
        { userEmail: "alice@example.com", orgId: "org_123" },
      ),
    ).resolves.toEqual({
      rows: [{ events: 1 }],
      schema: [{ name: "events", type: "number" }],
    });

    expect(backendMocks.table).toHaveBeenCalledWith(
      "builder-3b0a2.analytics.first_party_analytics_events_raw",
    );
    expect(backendMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM analytics_events"),
      expect.any(Array),
      expect.objectContaining({
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects event and session replay joins after the cutover", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });

    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events JOIN session_recordings ON true",
        { userEmail: "alice@example.com", orgId: "org_123" },
      ),
    ).rejects.toThrow("Cross-backend joins are not supported");
  });

  it("rejects unapproved functions before executing SQL-store queries", async () => {
    await expect(
      queryFirstPartyAnalytics(
        "SELECT table_to_xml(('analytics_' || 'events')::regclass, false, true, '') FROM session_recordings LIMIT 1",
        { userEmail: "alice@example.com", orgId: "org_123" },
      ),
    ).rejects.toThrow("cannot call unapproved SQL function table_to_xml");

    expect(backendMocks.get).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps BigQuery-specific functions available after cutover", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });

    await queryFirstPartyAnalytics(
      "SELECT SAFE_DIVIDE(COUNT(*), 2) AS count FROM analytics_events",
      { userEmail: "alice@example.com", orgId: "org_123" },
    );

    expect(backendMocks.query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps ad-hoc first-party reads uncached", async () => {
    execute.mockResolvedValue({ rows: [{ count: "1" }], rowsAffected: 0 });

    await queryFirstPartyAnalytics(
      "SELECT COUNT(*) AS count FROM analytics_events",
      { userEmail: "alice@example.com", orgId: null },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 45_000,
        maxAttempts: 1,
      }),
    );
  });

  it("marks capped Postgres reads as truncated", async () => {
    execute.mockResolvedValue({
      rows: Array.from({ length: 5_001 }, (_, index) => ({ events: index })),
      rowsAffected: 0,
    });

    const result = await queryFirstPartyAnalytics(
      "SELECT events FROM analytics_events",
      { userEmail: "alice@example.com", orgId: null },
    );

    expect(result.rows).toHaveLength(5_000);
    expect(result.truncated).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ sql: expect.stringContaining("LIMIT 5001") }),
    );
  });

  it("caches dashboard-panel reads only when explicitly requested", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    execute.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes("first_party_analytics_cache")
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ count: "1" }], rowsAffected: 0 },
    );

    try {
      const query = "SELECT COUNT(*) AS count FROM analytics_events";
      const scope = { userEmail: "cached@example.com", orgId: null };
      await queryFirstPartyAnalytics(query, scope, { cache: true });
      await queryFirstPartyAnalytics(query, scope, { cache: true });
    } finally {
      random.mockRestore();
    }

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("first_party_analytics_cache"),
        maxAttempts: 1,
      }),
    );
    expect(execute.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(1_000);
    expect(execute.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        maxAttempts: 1,
      }),
    );
    expect(execute.mock.calls[2][0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("ON CONFLICT(key) DO UPDATE"),
        maxAttempts: 1,
      }),
    );
    expect(execute.mock.calls[2][0].timeoutMs).toBeLessThanOrEqual(1_000);
  });

  it("shares one deadline between the cache read and panel query", async () => {
    let now = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        now += 125;
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    try {
      await queryFirstPartyAnalytics(
        "SELECT COUNT(*) AS count FROM analytics_events",
        { userEmail: "deadline@example.com", orgId: null },
        { cache: true, timeoutMs: 500 },
      );
    } finally {
      dateNow.mockRestore();
    }

    expect(execute.mock.calls[0][0]).toEqual(
      expect.objectContaining({ timeoutMs: 500, maxAttempts: 1 }),
    );
    expect(execute.mock.calls[1][0]).toEqual(
      expect.objectContaining({ timeoutMs: 375, maxAttempts: 1 }),
    );
    expect(execute.mock.calls[2][0]).toEqual(
      expect.objectContaining({ timeoutMs: 375, maxAttempts: 1 }),
    );
  });

  it("does not start the panel query after the shared deadline expires", async () => {
    let now = 2_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        now += 500;
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    try {
      await expect(
        queryFirstPartyAnalytics(
          "SELECT COUNT(*) AS count FROM analytics_events",
          { userEmail: "expired-deadline@example.com", orgId: null },
          { cache: true, timeoutMs: 500 },
        ),
      ).rejects.toThrow("First-party analytics query timed out after 500ms");
    } finally {
      dateNow.mockRestore();
    }

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not hold a successful panel response on the cache write", async () => {
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        return { rows: [], rowsAffected: 0 };
      }
      if (sql.includes("ON CONFLICT(key) DO UPDATE")) {
        return await new Promise(() => {});
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) AS count FROM analytics_events",
        { userEmail: "nonblocking-cache@example.com", orgId: null },
        { cache: true },
      ),
    ).resolves.toEqual({
      rows: [{ count: "1" }],
      schema: [{ name: "count", type: "string" }],
    });
  });
});
