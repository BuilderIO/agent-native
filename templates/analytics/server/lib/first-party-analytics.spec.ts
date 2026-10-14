import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { resetAppConfigForTests } from "@agent-native/core/app-config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const execute = vi.fn();
const expressionGuard = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/agent-sql", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/agent-sql")>()),
  verifyAgentPostgresExpressions: expressionGuard,
}));
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
const sessionEventIndexMocks = vi.hoisted(() => ({
  record: vi.fn(),
  catalog: vi.fn(),
}));
const performanceMocks = vi.hoisted(() => ({
  session: vi.fn(),
  route: vi.fn(),
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
  getDbExec: () => ({
    execute,
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        execute: (input: { sql: string }) =>
          input.sql === "SET TRANSACTION READ ONLY"
            ? Promise.resolve({ rows: [], rowsAffected: 0 })
            : execute(input),
      }),
  }),
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
vi.mock("./session-event-index.js", () => ({
  recordSessionEventIndex: sessionEventIndexMocks.record,
  recordEventCatalog: sessionEventIndexMocks.catalog,
}));
vi.mock("./session-performance.js", () => ({
  recordSessionPerformance: performanceMocks.session,
  recordRoutePerformance: performanceMocks.route,
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

import { lexAgentSql } from "@agent-native/core/agent-sql";

import {
  isMarketingWebsiteSessionEvent,
  normalizeAnalyticsTimestamp,
  parseAnalyticsTrackPayload,
  queryFirstPartyAnalytics,
  FirstPartyAnalyticsQueryTimeoutError,
  recordAnalyticsEvents,
  resolveAnalyticsEventDimensions,
  scopedAnalyticsSql,
  SESSION_RECORDING_FILTER_TABLES,
  touchPublicKeyLastUsedAt,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics";
import {
  buildOnboardingJourneyEventsSql,
  buildOnboardingJourneyFollowupSql,
  buildOnboardingJourneyPersonFollowupSql,
  onboardingJourneyEventDateRange,
  onboardingJourneyPersonFollowupDateRange,
} from "./first-party-metric-catalog";
import {
  MAX_APP_LENGTH,
  MAX_EVENT_NAME_LENGTH,
  MAX_PATH_LENGTH,
  MAX_USER_KEY_LENGTH,
  boundedIdentity,
} from "./indexed-text.js";

beforeEach(() => {
  execute.mockReset();
  expressionGuard.mockReset();
  expressionGuard.mockResolvedValue(undefined);
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
  sessionEventIndexMocks.record.mockReset();
  sessionEventIndexMocks.record.mockResolvedValue(undefined);
  sessionEventIndexMocks.catalog.mockReset();
  sessionEventIndexMocks.catalog.mockResolvedValue(undefined);
  performanceMocks.session.mockReset();
  performanceMocks.session.mockResolvedValue(undefined);
  performanceMocks.route.mockReset();
  performanceMocks.route.mockResolvedValue(undefined);
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

  it("cuts app and template names to a length that fits an index entry", () => {
    expect(
      resolveAnalyticsEventDimensions({
        properties: {
          app: "中".repeat(4096),
          template: `${"t".repeat(MAX_APP_LENGTH - 1)}\u{1F600}`,
        },
        context: {},
        hostname: null,
      }),
    ).toEqual({
      app: "中".repeat(MAX_APP_LENGTH),
      template: "t".repeat(MAX_APP_LENGTH - 1),
    });
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

  it.each(["postgres", "dual", "bigquery"] as const)(
    "indexes session events in Postgres at ingest with the %s sink",
    async (sink) => {
      backendMocks.get.mockResolvedValueOnce({
        sink,
        table:
          sink === "postgres"
            ? null
            : "builder-3b0a2.analytics.first_party_analytics_events_raw",
        backfillCursor: sink === "postgres" ? null : "evt_last",
        backfillCompleted: sink === "bigquery",
      });
      let openTransactions = 0;
      let catalogSawOpenTransaction = false;
      let sessionPerformanceSawOpenTransaction = false;
      let routePerformanceSawOpenTransaction = false;
      analyticsDbMocks.db.transaction.mockImplementationOnce(
        async (callback: (transaction: unknown) => unknown) => {
          openTransactions += 1;
          try {
            return await callback(analyticsDbMocks.db);
          } finally {
            openTransactions -= 1;
          }
        },
      );
      sessionEventIndexMocks.catalog.mockImplementationOnce(async () => {
        catalogSawOpenTransaction = openTransactions > 0;
      });
      performanceMocks.session.mockImplementationOnce(async () => {
        sessionPerformanceSawOpenTransaction = openTransactions > 0;
      });
      performanceMocks.route.mockImplementationOnce(async () => {
        routePerformanceSawOpenTransaction = openTransactions > 0;
      });

      await recordAnalyticsEvents("anpk_test", [
        {
          event: "recording_started",
          properties: { sessionId: "rs_1", app: "clips" },
        },
      ]);

      expect(sessionEventIndexMocks.record).toHaveBeenCalledOnce();
      expect(sessionEventIndexMocks.record).toHaveBeenCalledWith(
        analyticsDbMocks.db,
        [
          expect.objectContaining({
            eventName: "recording_started",
            ownerEmail: "owner@example.com",
          }),
        ],
        expect.any(String),
      );
      expect(sessionEventIndexMocks.catalog).toHaveBeenCalledOnce();
      expect(catalogSawOpenTransaction).toBe(false);
      // Session maxima commit with the events; hot route rows wait for it.
      expect(performanceMocks.session).toHaveBeenCalledOnce();
      expect(sessionPerformanceSawOpenTransaction).toBe(true);
      expect(performanceMocks.route).toHaveBeenCalledOnce();
      expect(routePerformanceSawOpenTransaction).toBe(false);
    },
  );

  it("replaces a lone surrogate in an event name instead of failing the batch", async () => {
    // JSON can carry half of a surrogate pair as an escape like \ud83d.
    const parsed = parseAnalyticsTrackPayload(
      JSON.stringify({
        publicKey: "anpk_test",
        events: [{ event: "clip_\uD83D", properties: { sessionId: "rs_1" } }],
      }),
    );
    await recordAnalyticsEvents(parsed.publicKey, parsed.events);

    expect(sessionEventIndexMocks.record).toHaveBeenCalledWith(
      analyticsDbMocks.db,
      [expect.objectContaining({ eventName: "clip_\uFFFD" })],
      expect.any(String),
    );
  });

  it("drops NUL from every string and key so one cannot fail the batch", async () => {
    const parsed = parseAnalyticsTrackPayload(
      JSON.stringify({
        publicKey: "anpk_test",
        events: [
          {
            event: "clip\u0000_viewed",
            userId: "user\u0000_1",
            properties: {
              path: "/clips\u0000",
              "note\u0000": { quote: "a\u0000b", half: "x\uD83D" },
            },
          },
        ],
      }),
    );
    await recordAnalyticsEvents(parsed.publicKey, parsed.events);

    const [rows] = rollupMocks.upsert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      eventName: "clip_viewed",
      userId: "user_1",
      path: "/clips",
    });
    expect(JSON.parse(rows[0].properties).note).toEqual({
      quote: "ab",
      half: "x�",
    });
    expect(JSON.stringify(rows[0])).not.toMatch(/\\u0000|\\ud83d/i);
  });

  it("bounds every indexed value so one long value cannot fail the batch", async () => {
    const long = "中".repeat(4096);
    await recordAnalyticsEvents("anpk_test", [
      { event: long, userId: long, properties: { app: long, path: long } },
      { event: "pageview", userId: "user_1" },
    ]);

    const [rows] = rollupMocks.upsert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      eventName: "中".repeat(MAX_EVENT_NAME_LENGTH),
      app: "中".repeat(MAX_APP_LENGTH),
      template: "中".repeat(MAX_APP_LENGTH),
      path: "中".repeat(MAX_PATH_LENGTH),
      userKey: boundedIdentity(long, MAX_USER_KEY_LENGTH),
      userId: long,
    });
    expect(rows[1]).toMatchObject({ eventName: "pageview", userKey: "user_1" });
  });

  it("keeps two long user ids with the same prefix as two users", async () => {
    const shared = "u".repeat(MAX_USER_KEY_LENGTH);
    await recordAnalyticsEvents("anpk_test", [
      { event: "pageview", userId: `${shared}-first` },
      { event: "pageview", userId: `${shared}-second` },
    ]);

    const [rows] = rollupMocks.upsert.mock.calls[0];
    expect(rows[0].userKey).not.toBe(rows[1].userKey);
    expect(rows[0].userKey.length).toBeLessThanOrEqual(MAX_USER_KEY_LENGTH);
  });

  it("bounds the user id an exception indexes in its error event", async () => {
    await recordAnalyticsEvents("anpk_test", [
      { event: "$exception", userId: "中".repeat(4096), properties: {} },
    ]);

    const [, sources] = exceptionMocks.ingest.mock.calls[0];
    expect(sources[0].derived.userId).toBe(
      boundedIdentity("中".repeat(4096), MAX_USER_KEY_LENGTH),
    );
  });

  it("rejects an unknown key as the caller's error", async () => {
    analyticsDbMocks.selectLimit.mockResolvedValueOnce([]);

    await expect(
      recordAnalyticsEvents("anpk_unknown", [{ event: "pageview" }]),
    ).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid analytics public key",
    });
  });

  it("does not index session events when persistence fails", async () => {
    rollupMocks.upsert.mockRejectedValueOnce(new Error("rollup unavailable"));

    await expect(
      recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]),
    ).rejects.toThrow();

    expect(sessionEventIndexMocks.record).not.toHaveBeenCalled();
    expect(sessionEventIndexMocks.catalog).not.toHaveBeenCalled();
    expect(performanceMocks.session).not.toHaveBeenCalled();
    expect(performanceMocks.route).not.toHaveBeenCalled();
  });

  it("fails the batch when its sessions cannot be indexed or marked incomplete", async () => {
    sessionEventIndexMocks.record.mockRejectedValueOnce(
      new Error("gap marker write failed"),
    );

    await expect(
      recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]),
    ).rejects.toThrow("gap marker write failed");
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
        properties: {
          error: "qa",
          app: "analytics",
          test_identity: true,
          test_identity_email: "qa+autoz@builder.io",
        },
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

  it("does not take a sender's test_identity flag as proof of a test identity", async () => {
    const result = await recordAnalyticsEvents("anpk_test", [
      {
        event: "pageview",
        userId: "real@example.com",
        properties: { test_identity: true },
      },
      {
        event: "$exception",
        userId: "real@example.com",
        properties: { error: "real", app: "analytics", test_identity: true },
      },
    ]);

    expect(result).toMatchObject({ accepted: 2, suppressedTestIdentity: 0 });
    const [, sources] = exceptionMocks.ingest.mock.calls[0]!;
    expect(sources[0].derived.testIdentity).toBe(false);
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

  it("checks the identity a sender puts only in the event context", async () => {
    vi.stubEnv("AGENT_NATIVE_TEST_IDENTITY_EMAILS", "qa@corp.com");
    resetAppConfigForTests();
    try {
      const result = await recordAnalyticsEvents("anpk_test", [
        { event: "pageview", context: { email: "qa@corp.com" } },
        { event: "pageview", context: { user_email: "qa@corp.com" } },
        { event: "pageview", context: { traits: { email: "qa@corp.com" } } },
        { event: "pageview", context: { email: "dev@corp.com" } },
      ]);
      expect(result).toMatchObject({ accepted: 1, suppressedTestIdentity: 3 });
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
    ).toThrow("Table functions are not supported");
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "WITH bounds AS (SELECT '2000-01-01'::timestamp AS start_date, 'infinity'::timestamp AS end_date) SELECT e.event_date FROM analytics_events e CROSS JOIN bounds CROSS JOIN LATERAL pg_catalog.generate_series(bounds.start_date, bounds.end_date, INTERVAL '1 day') AS days(day)",
      ),
    ).toThrow("Table functions are not supported");
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT e.event_date FROM analytics_events e CROSS JOIN LATERAL pg_catalog /* split */ . generate_series(1, 10000000, INTERVAL '1 day') AS days(day)",
      ),
    ).toThrow("Table functions are not supported");
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT e.event_date FROM analytics_events e CROSS JOIN LATERAL custom_series(1, 2) AS days(day)",
      ),
    ).toThrow("Table functions are not supported");
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
    ).toThrow(
      /cannot call unapproved SQL function|number must not run directly into an identifier/,
    );
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

  it.each([
    "WITH session_recording_shares AS (SELECT id AS resource_id FROM session_recordings) SELECT id FROM session_recordings",
    'WITH "session_recording_shares" AS (SELECT id AS resource_id FROM session_recordings) SELECT id FROM session_recordings',
    "WITH Session_Recording_Shares (resource_id) AS (SELECT id FROM session_recordings) SELECT id FROM session_recordings",
  ])(
    "rejects recording SQL that names the table the sharing filter reads: %s",
    (sql) => {
      expect(() => validateFirstPartyAnalyticsSql(sql)).toThrow(
        "cannot reference session_recording_shares",
      );
    },
  );

  it("rejects recording SQL the core lexer cannot read", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql('SELECT U&"id" FROM session_recordings'),
    ).toThrow("U&");
  });

  it("names every table the injected recording filter reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT id FROM session_recordings",
      { userEmail: "alice@example.com", orgId: "org-1" },
      "2026-07-01",
    );
    const tokens = lexAgentSql(scoped.sql, { dialect: "postgres" });
    const filterTables = new Set<string>();
    tokens.forEach((token, index) => {
      const previous = tokens[index - 1];
      if (
        previous?.kind === "word" &&
        (previous.value === "from" || previous.value === "join") &&
        (token.kind === "word" || token.kind === "quoted-identifier") &&
        token.value !== "session_recordings"
      ) {
        filterTables.add(token.value);
      }
    });
    expect([...filterTables].sort()).toEqual(
      [...SESSION_RECORDING_FILTER_TABLES].sort(),
    );
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
  it("preserves source aliases after replacing the raw events table", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT e.id FROM analytics_events e WHERE e.event_name = 'signup'",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM agent_native_scoped_analytics_events e WHERE e.event_name = 'signup'",
    );
    expect(scoped.sql).not.toContain(
      "FROM agent_native_scoped_analytics_events AS analytics_events e",
    );
  });

  it("adds tenant and freshness guards around analytics event reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS count FROM analytics_events GROUP BY event_date",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "WITH agent_native_scoped_analytics_events AS (SELECT * FROM analytics_events WHERE org_id = $1",
    );
    expect(scoped.sql).toContain(
      "FROM agent_native_scoped_analytics_events AS analytics_events",
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

  it("keeps org and legacy owner access in one opt-in raw event scan", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT id, org_id, event_name FROM analytics_events WHERE event_name = 'signup'",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
      { scopedEventsSingleScan: true },
    );

    expect(scoped.sql).toContain(
      "FROM analytics_events WHERE (org_id = $1 OR (org_id IS NULL AND owner_email = $3)) AND (COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) <= $2)",
    );
    expect(scoped.sql).not.toContain(
      "UNION ALL SELECT * FROM analytics_events",
    );
    expect(scoped.args).toEqual(["org_123", "2026-07-01", "alice@example.com"]);
  });

  it("returns the same scoped event rows for the legacy union and single scan", async () => {
    const client = await PGlite.create("memory://");
    try {
      await client.query(
        "CREATE TABLE analytics_events (id text, org_id text, owner_email text, event_date text, timestamp text, user_id text, event_name text, received_at text)",
      );
      await client.query(
        "INSERT INTO analytics_events VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($9, $10, $11, $12, $13, $14, $15, $16), ($17, $18, $19, $20, $21, $22, $23, $24), ($25, $26, $27, $28, $29, $30, $31, $32), ($33, $34, $35, $36, $37, $38, $39, $40), ($41, $42, $43, $44, $45, $46, $47, $48)",
        [
          "same-id",
          "org_123",
          "alice@example.com",
          "2026-06-30",
          "2026-06-30T12:00:00Z",
          "real@example.com",
          "signup",
          "2026-06-30T12:00:01Z",
          "same-id",
          null,
          "alice@example.com",
          "2026-06-30",
          "2026-06-30T12:00:00Z",
          "real@example.com",
          "signup",
          "2026-06-30T12:00:02Z",
          "org-event",
          "org_123",
          "bob@example.com",
          "2026-07-01",
          "2026-07-01T12:00:00Z",
          "real@example.com",
          "onboarding_step_viewed",
          "2026-07-01T12:00:01Z",
          "owner-event",
          null,
          "alice@example.com",
          "2026-07-01",
          "2026-07-01T12:00:00Z",
          "real@example.com",
          "onboarding_step_viewed",
          "2026-07-01T12:00:01Z",
          "other-org-event",
          "org_other",
          "alice@example.com",
          "2026-07-01",
          "2026-07-01T12:00:00Z",
          "real@example.com",
          "signup",
          "2026-07-01T12:00:01Z",
          "other-owner-event",
          null,
          "bob@example.com",
          "2026-07-01",
          "2026-07-01T12:00:00Z",
          "real@example.com",
          "signup",
          "2026-07-01T12:00:01Z",
        ],
      );
      await client.query(
        "INSERT INTO analytics_events VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($9, $10, $11, $12, $13, $14, $15, $16)",
        [
          "same-id",
          "org_123",
          "alice@example.com",
          "2026-06-30",
          "2026-06-30T11:59:00Z",
          "real@example.com",
          "stale-org-version",
          "2026-06-30T12:00:00Z",
          "same-id",
          null,
          "alice@example.com",
          "2026-06-30",
          "2026-06-30T11:59:00Z",
          "real@example.com",
          "stale-owner-version",
          "2026-06-30T12:00:00Z",
        ],
      );

      const query =
        "SELECT id, org_id, event_name, received_at FROM analytics_events";
      const legacy = scopedAnalyticsSql(
        query,
        { userEmail: "alice@example.com", orgId: "org_123" },
        "2026-07-01",
      );
      const singleScan = scopedAnalyticsSql(
        query,
        { userEmail: "alice@example.com", orgId: "org_123" },
        "2026-07-01",
        { scopedEventsSingleScan: true },
      );
      const legacyRows = await client.query(legacy.sql, legacy.args);
      const singleScanRows = await client.query(
        singleScan.sql,
        singleScan.args,
      );
      const sortRows = (rows: Array<Record<string, unknown>>) =>
        [...rows].sort((left, right) =>
          `${left.id}:${left.org_id ?? ""}:${left.received_at}`.localeCompare(
            `${right.id}:${right.org_id ?? ""}:${right.received_at}`,
          ),
        );

      expect(sortRows(singleScanRows.rows)).toEqual(sortRows(legacyRows.rows));
      expect(sortRows(singleScanRows.rows)).toEqual([
        {
          id: "org-event",
          org_id: "org_123",
          event_name: "onboarding_step_viewed",
          received_at: "2026-07-01T12:00:01Z",
        },
        {
          id: "owner-event",
          org_id: null,
          event_name: "onboarding_step_viewed",
          received_at: "2026-07-01T12:00:01Z",
        },
        {
          id: "same-id",
          org_id: null,
          event_name: "stale-owner-version",
          received_at: "2026-06-30T12:00:00Z",
        },
        {
          id: "same-id",
          org_id: null,
          event_name: "signup",
          received_at: "2026-06-30T12:00:02Z",
        },
        {
          id: "same-id",
          org_id: "org_123",
          event_name: "stale-org-version",
          received_at: "2026-06-30T12:00:00Z",
        },
        {
          id: "same-id",
          org_id: "org_123",
          event_name: "signup",
          received_at: "2026-06-30T12:00:01Z",
        },
      ]);

      const legacyLatestRows = await client.query(
        `SELECT id, org_id, event_name, received_at FROM (
          SELECT id, org_id, event_name, received_at,
            ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) AS receipt_rank
          FROM analytics_events
          WHERE org_id = $1 AND COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) <= $2
        ) AS org_receipts WHERE receipt_rank = 1
        UNION ALL
        SELECT id, org_id, event_name, received_at FROM (
          SELECT id, org_id, event_name, received_at,
            ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) AS receipt_rank
          FROM analytics_events
          WHERE org_id IS NULL AND owner_email = $3
            AND COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) <= $4
        ) AS owner_receipts WHERE receipt_rank = 1`,
        legacy.args,
      );
      const singleScanLatestRows = await client.query(
        `SELECT id, org_id, event_name, received_at FROM (
          SELECT id, org_id, event_name, received_at,
            ROW_NUMBER() OVER (PARTITION BY id, org_id ORDER BY received_at DESC) AS receipt_rank
          FROM analytics_events
          WHERE (org_id = $1 OR (org_id IS NULL AND owner_email = $3))
            AND COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) <= $2
        ) AS scoped_receipts WHERE receipt_rank = 1`,
        singleScan.args,
      );
      expect(sortRows(singleScanLatestRows.rows)).toEqual(
        sortRows(legacyLatestRows.rows),
      );
      expect(sortRows(singleScanLatestRows.rows)).toEqual([
        {
          id: "org-event",
          org_id: "org_123",
          event_name: "onboarding_step_viewed",
          received_at: "2026-07-01T12:00:01Z",
        },
        {
          id: "owner-event",
          org_id: null,
          event_name: "onboarding_step_viewed",
          received_at: "2026-07-01T12:00:01Z",
        },
        {
          id: "same-id",
          org_id: null,
          event_name: "signup",
          received_at: "2026-06-30T12:00:02Z",
        },
        {
          id: "same-id",
          org_id: "org_123",
          event_name: "signup",
          received_at: "2026-06-30T12:00:01Z",
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it("pushes each immutable event source predicate before BigQuery deduplication", async () => {
    const { renderFirstPartyAnalyticsBigQuerySql } = await vi.importActual<
      typeof import("./first-party-analytics-backend.js")
    >("./first-party-analytics-backend.js");
    const scoped = scopedAnalyticsSql(
      "SELECT e.id FROM analytics_events e WHERE e.event_name = 'signup' UNION ALL SELECT e.id FROM analytics_events e WHERE e.event_name = 'onboarding_step_viewed'",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql.match(/event_name = '/g)).toHaveLength(6);
    expect(scoped.sql.split("AND (((")).toHaveLength(3);

    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      scoped.sql,
      scoped.args,
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
    );
    const sources = [
      ...rendered.matchAll(
        /FROM `builder-3b0a2\.analytics\.first_party_analytics_events_raw` WHERE ([\s\S]*?) QUALIFY ROW_NUMBER\(\)/g,
      ),
    ];
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      expect(source[1]).toContain("event_name = 'signup'");
      expect(source[1]).toContain("event_name = 'onboarding_step_viewed'");
    }
  });

  it("does not push predicates when any event source is unfiltered", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT a.id FROM analytics_events a WHERE a.event_name = 'signup' UNION ALL SELECT b.id FROM analytics_events b",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql.match(/event_name = '/g)).toHaveLength(1);
    expect(scoped.sql).not.toContain("AND (((event_name =");
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
      "WITH agent_native_scoped_analytics_events AS (SELECT * FROM analytics_events WHERE org_id = $1",
    );
    expect(scoped.sql).toContain(
      "FROM agent_native_scoped_analytics_events AS analytics_events",
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

  it("reads session recordings through the sharing rule, with a freshness guard", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT COUNT(*) AS recordings FROM session_recordings",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      'lower("session_recordings"."owner_email") = $1',
    );
    expect(scoped.sql).toContain('from "session_recording_shares"');
    expect(scoped.sql).toContain("substr(started_at, 1, 10) <= $3");
    expect(scoped.sql).not.toContain("\n");
    expect(scoped.args).toEqual([
      "alice@example.com",
      "alice@example.com",
      "2026-07-01",
    ]);
  });

  it("numbers recording binds after earlier sources in the same query", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT e.event_name FROM analytics_events e JOIN session_recordings r ON r.session_id = e.session_id",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );

    expect(scoped.args).toEqual([
      "alice@example.com",
      "2026-07-01",
      "alice@example.com",
      "alice@example.com",
      "2026-07-01",
    ]);
    expect(scoped.sql).toContain(
      'lower("session_recordings"."owner_email") = $3',
    );
    expect(scoped.sql).toContain("substr(started_at, 1, 10) <= $5");
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
        "CREATE TABLE session_recordings (id text, org_id text, owner_email text, started_at text, user_id text, visibility text NOT NULL DEFAULT 'private')",
      );
      await client.query(
        "CREATE TABLE session_recording_shares (resource_id text, principal_type text, principal_id text, role text)",
      );
      for (const [index, userId] of [
        "real@example.com",
        null,
        "qa+autoz@builder.io",
        "bot@agents.test",
      ].entries()) {
        await client.query(
          "INSERT INTO analytics_events VALUES (NULL, 'alice@example.com', '2026-07-01', '2026-07-01T00:00:00Z', $1)",
          [userId],
        );
        await client.query(
          "INSERT INTO session_recordings (id, org_id, owner_email, started_at, user_id) VALUES ($1, NULL, 'alice@example.com', '2026-07-01T00:00:00Z', $2)",
          [`rec-${index}`, userId],
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
  it.each([
    "now()",
    "to_char(CURRENT_DATE, 'YYYY-MM-DD')",
    "date_trunc('week', event_date)",
    "split_part(event_name, ':', 1)",
  ])(
    "accepts PostgreSQL translation input %s on BigQuery",
    async (expression) => {
      backendMocks.get.mockResolvedValueOnce({ sink: "bigquery" });
      await queryFirstPartyAnalytics(
        `SELECT ${expression} FROM analytics_events`,
        { userEmail: "translation@example.test", orgId: "org_a" },
      );
      expect(backendMocks.query).toHaveBeenCalledTimes(1);
    },
  );

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
      expect.any(AbortSignal),
    );
    expect(backendMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("analytics_events"),
      expect.any(Array),
      expect.objectContaining({
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      }),
      expect.objectContaining({ maxBytesBilled: undefined }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("forwards the frozen onboarding range and records BigQuery read failures", async () => {
    const scope = { userEmail: "alice@example.com", orgId: "org_123" };
    healthMocks.classify.mockReturnValue("raw-events");
    const options = {
      timeoutMs: 20_000,
      maxBytesBilled: 25_000_000_000,
      eventDateRange: {
        startDate: "2026-10-08",
        endDate: "2026-10-08",
      },
    };
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
    });

    await queryFirstPartyAnalytics(
      "SELECT COUNT(*) AS count FROM analytics_events",
      scope,
      options,
    );

    expect(backendMocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining("analytics_events"),
      expect.any(Array),
      expect.objectContaining({ tableId: "first_party_analytics_events_raw" }),
      expect.objectContaining({
        maxBytesBilled: options.maxBytesBilled,
        timeoutMs: expect.any(Number),
        eventDateRange: options.eventDateRange,
        signal: expect.any(AbortSignal),
      }),
    );
    const lastQueryCall =
      backendMocks.query.mock.calls[backendMocks.query.mock.calls.length - 1];
    expect(lastQueryCall?.[3].timeoutMs).toBeGreaterThan(0);
    expect(lastQueryCall?.[3].timeoutMs).toBeLessThanOrEqual(options.timeoutMs);

    const backendFailure = new Error("private SQL and provider details");
    healthMocks.record.mockClear();
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
    });
    backendMocks.query.mockRejectedValueOnce(backendFailure);
    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) AS count FROM analytics_events",
        scope,
        options,
      ),
    ).rejects.toBe(backendFailure);

    expect(healthMocks.outcome).toHaveBeenCalledWith(backendFailure);
    expect(healthMocks.record).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ outcome: "error", queryClass: "raw-events" }),
    );
  });

  it("renders a 2,000-session follow-up under scope and query-size budgets", async () => {
    const { renderFirstPartyAnalyticsBigQuerySql } = await vi.importActual<
      typeof import("./first-party-analytics-backend.js")
    >("./first-party-analytics-backend.js");
    const filters = {
      dateFrom: "2026-10-08",
      dateTo: "2026-10-11",
      app: "all" as const,
      emailFilter: "exclude_builder" as const,
    };
    const observation = {
      observationCutoff: "2026-10-09T12:00:00.000Z",
      observationDate: "2026-10-09",
      observationWatermark: "2026-10-09T11:55:00.000Z",
    };
    const dateRange = onboardingJourneyEventDateRange(filters, observation);
    const scopedQuery = (sql: string) => {
      const scoped = scopedAnalyticsSql(
        sql,
        { userEmail: "owner@example.test", orgId: "org_123" },
        observation.observationDate,
      );
      return renderFirstPartyAnalyticsBigQuerySql(
        scoped.sql,
        scoped.args,
        {
          projectId: "builder-3b0a2",
          datasetId: "analytics",
          tableId: "first_party_analytics_events_raw",
          fullyQualified:
            "builder-3b0a2.analytics.first_party_analytics_events_raw",
        },
        { eventDateRange: dateRange },
      );
    };
    const eventsSql = buildOnboardingJourneyEventsSql(
      filters,
      { limit: 2_001, offset: 0 },
      observation,
      { freezeReceivedAt: true },
    );
    const renderedEvents = scopedQuery(eventsSql);
    const terminals = Array.from({ length: 2_000 }, (_, index) => ({
      sessionId: `session-${String(index).padStart(4, "0")}-${"a".repeat(16)}`,
      stepKey: "signup",
      tsMs: Date.parse("2026-10-08T12:00:00.000Z"),
    }));
    const followupSql = buildOnboardingJourneyFollowupSql(
      filters,
      terminals,
      observation,
    );
    const scopedFollowup = scopedAnalyticsSql(
      followupSql,
      { userEmail: "owner@example.test", orgId: "org_123" },
      observation.observationDate,
    );
    expect(
      lexAgentSql(scopedFollowup.sql, { dialect: "postgres" }).length,
    ).toBeLessThan(50_000);
    const rendered = scopedQuery(followupSql);
    const rawSources = [
      ...rendered.matchAll(
        /SELECT \* FROM `builder-3b0a2\.analytics\.first_party_analytics_events_raw` WHERE([\s\S]*?) QUALIFY ROW_NUMBER\(\)/g,
      ),
    ];

    expect(
      lexAgentSql(followupSql, { dialect: "postgres" }).length,
    ).toBeLessThan(50_000);
    expect(lexAgentSql(eventsSql, { dialect: "postgres" }).length).toBeLessThan(
      50_000,
    );
    expect(rendered.length).toBeLessThan(1_000_000);
    expect(rawSources).toHaveLength(2);
    for (const rawSource of rawSources) {
      expect(rawSource[1]).toContain("event_date >= DATE '2026-10-08'");
      expect(rawSource[1]).toContain("event_date <= DATE '2026-10-09'");
    }
    const renderedEventSources = [
      ...renderedEvents.matchAll(
        /SELECT \* FROM `builder-3b0a2\.analytics\.first_party_analytics_events_raw` WHERE([\s\S]*?) QUALIFY ROW_NUMBER\(\)/g,
      ),
    ];
    expect(renderedEvents.length).toBeLessThan(1_000_000);
    expect(renderedEventSources).toHaveLength(2);
    for (const rawSource of renderedEventSources) {
      expect(rawSource[1]).toContain("event_date >= DATE '2026-10-08'");
      expect(rawSource[1]).toContain("event_date <= DATE '2026-10-09'");
    }
  });

  it("renders a bounded 1,000-member person follow-up through the scoped BigQuery path", async () => {
    const { renderFirstPartyAnalyticsBigQuerySql } = await vi.importActual<
      typeof import("./first-party-analytics-backend.js")
    >("./first-party-analytics-backend.js");
    const filters = {
      dateFrom: "2026-10-08",
      dateTo: "2026-10-08",
      app: "all" as const,
      emailFilter: "exclude_builder" as const,
    };
    const observation = {
      observationCutoff: "2026-10-09T12:00:00.000Z",
      observationDate: "2026-10-09",
      observationWatermark: "2026-10-09T11:55:00.000Z",
    };
    const members = Array.from({ length: 1_000 }, (_, index) => ({
      sessionId: `session-${String(index).padStart(4, "0")}-${"a".repeat(16)}`,
      stepKey: "signup",
      tsMs: Date.parse("2026-10-08T12:00:00.000Z"),
      app: "clips",
      authUserId: `person-${String(index).padStart(4, "0")}`,
    }));
    const sql = buildOnboardingJourneyPersonFollowupSql(
      filters,
      members,
      observation,
    );
    const scoped = scopedAnalyticsSql(
      sql,
      { userEmail: "owner@example.test", orgId: "org_123" },
      observation.observationDate,
    );
    const rendered = renderFirstPartyAnalyticsBigQuerySql(
      scoped.sql,
      scoped.args,
      {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified:
          "builder-3b0a2.analytics.first_party_analytics_events_raw",
      },
      {
        eventDateRange: onboardingJourneyPersonFollowupDateRange(
          filters,
          members,
          observation,
        ),
      },
    );

    expect(lexAgentSql(sql, { dialect: "postgres" }).length).toBeLessThan(
      50_000,
    );
    expect(
      lexAgentSql(scoped.sql, { dialect: "postgres" }).length,
    ).toBeLessThan(50_000);
    expect(rendered.length).toBeLessThan(1_000_000);
    expect(rendered).toContain("JSON_VALUE(terminal_row.member_payload");
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

  it.each([
    "project.dataset.helper",
    "project.dataset.count",
    "safe.project.helper",
    "unapproved_helper",
  ])(
    "refuses BigQuery routine %s before submitting a query",
    async (routine) => {
      backendMocks.get.mockResolvedValueOnce({ sink: "bigquery" });
      await expect(
        queryFirstPartyAnalytics(
          `SELECT ${routine}(id) FROM analytics_events`,
          { userEmail: "alice@example.test", orgId: "org_a" },
        ),
      ).rejects.toThrow(/cannot call unapproved SQL function/);
      expect(backendMocks.query).not.toHaveBeenCalled();
    },
  );

  it("bounds backend and BigQuery table lookup by the read deadline", async () => {
    healthMocks.outcome.mockReturnValueOnce("timeout");
    healthMocks.classify.mockReturnValue("raw-events");
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
    });
    backendMocks.table.mockImplementationOnce(() => new Promise(() => {}));

    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events",
        { userEmail: "alice@example.com", orgId: "org_123" },
        { timeoutMs: 10 },
      ),
    ).rejects.toBeInstanceOf(FirstPartyAnalyticsQueryTimeoutError);

    expect(backendMocks.query).not.toHaveBeenCalled();
    expect(healthMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_123" }),
      expect.objectContaining({ outcome: "timeout", queryClass: "raw-events" }),
    );
  });

  it("cancels backend resolution when its caller is cancelled", async () => {
    let resolveBackend!: (value: { sink: string; table: null }) => void;
    backendMocks.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBackend = resolve;
      }),
    );
    const controller = new AbortController();
    const query = queryFirstPartyAnalytics(
      "SELECT COUNT(*) FROM analytics_events",
      { userEmail: "alice@example.com", orgId: "org_123" },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(query).rejects.toMatchObject({ name: "AbortError" });
    resolveBackend({ sink: "postgres", table: null });
    expect(backendMocks.table).not.toHaveBeenCalled();
  });

  it("normalizes Postgres query deadline errors for journey timeout handling", async () => {
    healthMocks.outcome.mockReturnValueOnce("timeout");
    backendMocks.get.mockResolvedValueOnce({ sink: "postgres", table: null });
    execute.mockRejectedValueOnce(
      Object.assign(
        new Error("DB query timed out after 20ms (connection terminated)"),
        { name: "DbTimeoutError", code: "CONNECT_TIMEOUT" },
      ),
    );

    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) AS count FROM analytics_events",
        { userEmail: "alice@example.com", orgId: null },
        { cache: false, timeoutMs: 20_000 },
      ),
    ).rejects.toBeInstanceOf(FirstPartyAnalyticsQueryTimeoutError);
  });

  it("does not materialize the scoped raw event CTE on Postgres execution", async () => {
    execute.mockResolvedValue({ rows: [{ count: "1" }], rowsAffected: 0 });

    await queryFirstPartyAnalytics(
      "SELECT COUNT(*) AS count FROM analytics_events",
      { userEmail: "alice@example.com", orgId: null },
      { cache: false },
    );

    const executedSql = execute.mock.calls.flatMap(([input]) =>
      typeof input === "string"
        ? [input]
        : input && typeof input.sql === "string"
          ? [input.sql]
          : [],
    );
    expect(
      executedSql.some((sql) =>
        sql.includes(
          "agent_native_scoped_analytics_events AS NOT MATERIALIZED",
        ),
      ),
    ).toBe(true);
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
        timeoutMs: expect.any(Number),
        maxAttempts: 1,
      }),
    );
    expect(execute.mock.calls[0][0].timeoutMs).toBeGreaterThan(0);
    expect(execute.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(45_000);
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
      ).rejects.toBeInstanceOf(FirstPartyAnalyticsQueryTimeoutError);
    } finally {
      dateNow.mockRestore();
    }

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("shares the cache deadline with expression verification", async () => {
    let now = 4_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    expressionGuard.mockImplementationOnce(async () => {
      now += 450;
    });
    execute.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes("first_party_analytics_cache")
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ count: "1" }], rowsAffected: 0 },
    );
    try {
      await queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events",
        { userEmail: "guard-deadline@example.test", orgId: null },
        { cache: true, timeoutMs: 500 },
      );
      expect(execute.mock.calls[0][0].timeoutMs).toBe(50);
      expect(execute.mock.calls[1][0].timeoutMs).toBe(50);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("coalesces concurrent cached reads after verification takes different time", async () => {
    let now = 5_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    expressionGuard.mockImplementation(async () => {
      now += 10;
    });
    let releaseCache!: () => void;
    let markCacheStarted!: () => void;
    const cacheStarted = new Promise<void>((resolve) => {
      markCacheStarted = resolve;
    });
    const cacheGate = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        markCacheStarted();
        await cacheGate;
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    try {
      const scope = { userEmail: "concurrent-guard@example.test", orgId: null };
      const first = queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events",
        scope,
        { cache: true, timeoutMs: 500 },
      );
      await cacheStarted;
      const second = queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events",
        scope,
        { cache: true, timeoutMs: 500 },
      );
      await vi.waitFor(() => expect(expressionGuard).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseCache();
      expect(await first).toEqual(await second);
      expect(
        execute.mock.calls.filter(([input]) =>
          input.sql.includes("SELECT result FROM first_party_analytics_cache"),
        ),
      ).toHaveLength(1);
    } finally {
      releaseCache();
      dateNow.mockRestore();
    }
  });

  it("bounds a coalesced cached read by the joining caller's own deadline", async () => {
    let now = 5_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    let releaseEarlyGuard!: () => void;
    const earlyGuardGate = new Promise<void>((resolve) => {
      releaseEarlyGuard = resolve;
    });
    expressionGuard.mockImplementationOnce(() => earlyGuardGate);
    let releaseCache!: () => void;
    let markCacheStarted!: () => void;
    const cacheStarted = new Promise<void>((resolve) => {
      markCacheStarted = resolve;
    });
    const cacheGate = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        markCacheStarted();
        await cacheGate;
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    try {
      const scope = { userEmail: "deadline-join@example.test", orgId: null };
      const early = queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events",
        scope,
        { cache: true, timeoutMs: 500 },
      );
      const earlyOutcome = early.then(
        () => "resolved",
        (error: Error) => error.message,
      );
      now = 5_100;
      const late = queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events",
        scope,
        { cache: true, timeoutMs: 500 },
      );
      await cacheStarted;
      now = 5_480;
      releaseEarlyGuard();
      expect(await earlyOutcome).toMatch(/timed out/);
      releaseCache();
      await expect(late).resolves.toMatchObject({ rows: [{ count: "1" }] });
    } finally {
      releaseEarlyGuard();
      releaseCache();
      dateNow.mockRestore();
    }
  });

  it("refuses a cached query when expression verification is unavailable", async () => {
    expressionGuard.mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_events",
        { userEmail: "guard-unavailable@example.test", orgId: null },
        { cache: true },
      ),
    ).rejects.toThrow("metadata unavailable");
    expect(execute).not.toHaveBeenCalled();
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
