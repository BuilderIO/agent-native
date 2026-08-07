import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  query: vi.fn(),
}));
const exceptionMocks = vi.hoisted(() => ({
  ingest: vi.fn(),
}));
const analyticsDbMocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const insertValues = vi.fn();
  const updateWhere = vi.fn();
  const db: Record<string, any> = {};
  db.transaction = vi.fn(async (callback: (transaction: unknown) => unknown) =>
    callback(db),
  );
  db.select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: selectLimit })),
    })),
  }));
  db.insert = vi.fn(() => ({ values: insertValues }));
  db.update = vi.fn(() => ({
    set: vi.fn(() => ({ where: updateWhere })),
  }));
  return {
    selectLimit,
    insertValues,
    updateWhere,
    db,
  };
});

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({ execute }),
}));
vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: () => analyticsDbMocks.db,
}));
vi.mock("./first-party-analytics-rollups.js", () => ({
  upsertFirstPartyAnalyticsRollups: rollupMocks.upsert,
}));
vi.mock("./error-capture.js", () => ({
  EXCEPTION_EVENT_NAME: "$exception",
  ingestAnalyticsExceptionEvents: exceptionMocks.ingest,
}));
vi.mock("./first-party-analytics-health.js", () => ({
  classifyFirstPartyAnalyticsQuery: healthMocks.classify,
  queryOutcomeFromError: healthMocks.outcome,
  recordFirstPartyAnalyticsQueryPressure: healthMocks.record,
}));
vi.mock("./first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend: backendMocks.get,
  getFirstPartyAnalyticsTable: backendMocks.table,
  insertFirstPartyAnalyticsRows: backendMocks.insert,
  queryFirstPartyAnalyticsInBigQuery: backendMocks.query,
}));

import {
  isMarketingWebsiteSessionEvent,
  normalizeAnalyticsTimestamp,
  queryFirstPartyAnalytics,
  recordAnalyticsEvents,
  resolveAnalyticsEventDimensions,
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics";

beforeEach(() => {
  execute.mockReset();
  analyticsDbMocks.selectLimit.mockReset();
  analyticsDbMocks.insertValues.mockReset();
  analyticsDbMocks.updateWhere.mockReset();
  analyticsDbMocks.selectLimit.mockResolvedValue([
    { id: "apk_123", ownerEmail: "owner@example.com", orgId: null },
  ]);
  analyticsDbMocks.insertValues.mockResolvedValue(undefined);
  analyticsDbMocks.updateWhere.mockResolvedValue(undefined);
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
  backendMocks.query.mockReset();
  exceptionMocks.ingest.mockReset();
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
  // Production outage 2026-08-07: this UPDATE ran inside the ingest
  // transaction, so every concurrent request for one public key took an
  // exclusive row lock on that key and held it through the rollup upsert.
  // 36 writers stacked on three hot rows waiting 38-57s, the connection pool
  // starved, and Analytics stopped loading for everyone.
  const source = readFileSync(
    new URL("./first-party-analytics.ts", import.meta.url),
    "utf8",
  );

  it("never writes the stamp inside a transaction", () => {
    // Everything between `db.transaction(` and its closing `});` must be free
    // of the stamp write, whatever else the transaction grows to do.
    const start = source.indexOf("db.transaction(");
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf("\n  }", start));
    expect(body).not.toContain("analyticsPublicKeys");
    expect(body).not.toContain("lastUsedAt");
  });

  it("throttles the stamp in SQL, not in the caller", () => {
    // A JS-side check would still let every racing request issue its own
    // unconditional write. The predicate must be in the statement so Postgres
    // matches — and therefore locks — zero rows for a freshly stamped key.
    const fn = source.slice(source.indexOf("touchPublicKeyLastUsedAt("));
    const update = fn.slice(fn.indexOf(".update(schema.analyticsPublicKeys)"));
    const where = update.slice(0, update.indexOf("} catch"));
    expect(where).toContain("isNull(schema.analyticsPublicKeys.lastUsedAt)");
    expect(where).toContain("lt(schema.analyticsPublicKeys.lastUsedAt");
    expect(where).toContain("staleBefore");
  });

  it("routes every stamp write through the throttled helper", () => {
    // Two call sites drifted apart once already; a third unconditional write
    // anywhere re-creates the convoy on its own.
    // Exactly one place may set the stamp: the throttled helper. Other writes
    // to this table (revocation) are rare admin actions and not the convoy.
    let stampWrites = 0;
    for (const file of ["first-party-analytics.ts", "session-replay.ts"]) {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      stampWrites += (text.match(/\.set\(\{\s*lastUsedAt:/g) ?? []).length;
    }
    expect(stampWrites).toBe(1);
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

  it("stops Postgres event and rollup writes after the org cuts over", async () => {
    backendMocks.get.mockResolvedValueOnce({
      sink: "bigquery",
      table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
      backfillCursor: "evt_last",
      backfillCompleted: true,
    });

    await recordAnalyticsEvents("anpk_test", [{ event: "pageview" }]);

    expect(backendMocks.insert).toHaveBeenCalledWith(
      [expect.objectContaining({ eventName: "pageview" })],
      "builder-3b0a2.analytics.first_party_analytics_events_raw",
    );
    expect(analyticsDbMocks.insertValues).not.toHaveBeenCalled();
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

    expect(backendMocks.insert).toHaveBeenCalled();
    expect(exceptionMocks.ingest).toHaveBeenCalledWith(
      {
        ownerEmail: "owner@example.com",
        orgId: null,
        publicKeyId: "apk_123",
      },
      [expect.objectContaining({ derived: expect.any(Object) })],
    );
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
        "SELECT name FROM analytics_events, sqlite_master",
      ),
    ).toThrow("Comma-separated table sources");
  });

  it("rejects quoted table sources that the scoping rewriter cannot replace", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        'SELECT name FROM analytics_events, "sqlite_master"',
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
});

describe("scopedAnalyticsSql", () => {
  it("adds tenant and freshness guards around analytics event reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS count FROM analytics_events GROUP BY event_date",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM (SELECT * FROM analytics_events WHERE org_id = ?",
    );
    expect(scoped.sql).toContain(
      "UNION ALL SELECT * FROM analytics_events WHERE org_id IS NULL AND owner_email = ?",
    );
    expect(
      scoped.sql.match(
        /COALESCE\(NULLIF\(event_date, ''\), substr\(timestamp, 1, 10\)\) <= \?/g,
      ),
    ).toHaveLength(2);
    expect(scoped.sql).not.toContain("org_id = ? OR");
    expect(scoped.args).toEqual([
      "org_123",
      "2026-07-01",
      "alice@example.com",
      "2026-07-01",
    ]);
  });

  it("adds freshness guards around session recording reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT COUNT(*) AS recordings FROM session_recordings",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );

    expect(scoped.sql).toContain("substr(started_at, 1, 10) <= ?");
    expect(scoped.args).toEqual(["alice@example.com", "2026-07-01"]);
  });

  it("scopes rollups by tenant key without changing all-time lower bounds", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, event_name, SUM(event_count) AS events FROM analytics_event_daily_rollups GROUP BY event_date, event_name",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM (SELECT * FROM analytics_event_daily_rollups WHERE tenant_key = ? AND event_date <= ? UNION ALL SELECT * FROM analytics_event_daily_rollups WHERE tenant_key = ? AND event_date <= ?)",
    );
    expect(scoped.sql).not.toContain("event_date >= ?");
    expect(scoped.args).toEqual([
      "org:org_123",
      "2026-07-01",
      "user:alice@example.com",
      "2026-07-01",
    ]);
  });

  it("uses the personal tenant key for user-day rollups without an org", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS active_users FROM analytics_user_days GROUP BY event_date",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );

    expect(scoped.sql).toContain(
      "FROM (SELECT * FROM analytics_user_days WHERE tenant_key = ? AND event_date <= ?)",
    );
    expect(scoped.args).toEqual(["user:alice@example.com", "2026-07-01"]);
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
