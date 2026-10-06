import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { and, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return { ...actual, getDb: getDbMock };
});

import {
  histogramBucket,
  histogramEdges,
  performanceCeiling,
} from "../../shared/session-performance";
import { schema } from "../db/index.js";
import type { SessionEventIndexInputRow } from "./session-event-index";
import {
  __resetSessionPerformanceForTests,
  aggregatePerformanceRows,
  getSessionPerformanceSummaries,
  listRoutePerformance,
  prunePerformanceAggregates,
  recordRoutePerformance,
  recordSessionPerformance,
  slowSessionConditions,
} from "./session-performance";

/** The DDL comes straight from the migration so the test tracks it. */
function performanceMigrationSql(): string[] {
  // source-read-ok: runs the migration's SQL against PGlite; nothing asserts on the text.
  const source = readFileSync(
    new URL("../plugins/db.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(
    /name: "analytics-performance-aggregates",\s*sql: \{\s*postgres: `([\s\S]*?)`/,
  );
  if (!match) throw new Error("performance aggregates migration not found");
  return match[1]
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const OWNER = "owner@example.com";
const ORG = "org_1";
const DAY = "2026-09-20";

function vitals(
  sessionId: string | null,
  properties: Record<string, unknown>,
  overrides: Partial<SessionEventIndexInputRow> = {},
): SessionEventIndexInputRow {
  return {
    eventName: "web_vitals",
    sessionId,
    timestamp: `${DAY}T10:00:00.000Z`,
    eventDate: DAY,
    app: "clips",
    properties: JSON.stringify({ route: "/r/:id", ...properties }),
    ownerEmail: OWNER,
    orgId: ORG,
    ...overrides,
  };
}

function response(
  sessionId: string | null,
  properties: Record<string, unknown>,
  overrides: Partial<SessionEventIndexInputRow> = {},
): SessionEventIndexInputRow {
  return {
    ...vitals(sessionId, {}, overrides),
    eventName: "action.response",
    properties: JSON.stringify({
      route: "/r/:id",
      sample_weight: 1,
      outcome: "success",
      ...properties,
    }),
    ...overrides,
  };
}

describe("aggregatePerformanceRows", () => {
  it("keeps each session's worst page view and counts only slow requests", () => {
    const { sessions } = aggregatePerformanceRows([
      vitals("s1", { ttfb_ms: 300, lcp_ms: 1_200, cls: 0.02 }),
      vitals("s1", { inp_ms: 640, cls: 0.4 }),
      response("s1", { duration_ms: 1_000 }),
      response("s1", { duration_ms: 400, sample_weight: 10 }),
      // Neither is a wait a person sat through.
      response("s1", { duration_ms: 9_000, page_hidden: true }),
      response("s1", { duration_ms: 9_000, outcome: "cancelled" }),
      { ...vitals("s1", { lcp_ms: 99_000 }), eventName: "pageview" },
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({
        tenantKey: `org:${ORG}`,
        sessionId: "s1",
        pageViews: 2,
        maxTtfbMs: 300,
        maxLcpMs: 1_200,
        maxInpMs: 640,
        maxCls: 0.4,
        slowRequests: 1,
        maxRequestMs: 1_000,
      }),
    ]);
  });

  it("leaves unmeasured metrics null and skips unweighted or invalid samples", () => {
    const { sessions, routeBuckets } = aggregatePerformanceRows([
      vitals("s1", { lcp_ms: -5, inp_ms: "fast", cls: Number.NaN }),
      response("s1", { duration_ms: 300, sample_weight: undefined }),
      vitals("s2", { ttfb_ms: 120 }, { properties: '{"ttfb_ms":120}' }),
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId: "s2",
        maxTtfbMs: 120,
        maxLcpMs: null,
        maxInpMs: null,
        maxCls: null,
        maxRequestMs: null,
      }),
    ]);
    // Without a route template there is nothing to group by.
    expect(routeBuckets).toEqual([]);
  });

  it("caps out-of-range values into the top bucket instead of dropping them", () => {
    const { sessions, routeBuckets } = aggregatePerformanceRows([
      vitals("s1", { lcp_ms: 3_600_000, cls: 250 }),
      response("s1", { duration_ms: 400, sample_weight: 50_000 }),
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({
        maxLcpMs: performanceCeiling("lcp"),
        maxCls: performanceCeiling("cls"),
      }),
    ]);
    expect(
      routeBuckets.map(({ metric, bucket, weight }) => ({
        metric,
        bucket,
        weight,
      })),
    ).toEqual(
      expect.arrayContaining([
        { metric: "lcp", bucket: histogramEdges("lcp").length - 1, weight: 1 },
        { metric: "cls", bucket: histogramEdges("cls").length - 1, weight: 1 },
        {
          metric: "request",
          bucket: histogramBucket("request", 400),
          weight: 10_000,
        },
      ]),
    );
  });

  it("weights sampled requests and merges samples into fixed buckets", () => {
    const { routeBuckets } = aggregatePerformanceRows([
      response(null, { duration_ms: 120, sample_weight: 10 }),
      response(null, { duration_ms: 110, sample_weight: 10 }),
      response(null, { duration_ms: 2_100 }),
    ]);
    expect(
      routeBuckets.map(({ metric, bucket, weight }) => ({
        metric,
        bucket,
        weight,
      })),
    ).toEqual(
      expect.arrayContaining([
        // 110 and 120 ms share the [100, 125) bucket.
        {
          metric: "request",
          bucket: histogramBucket("request", 110),
          weight: 20,
        },
        {
          metric: "request",
          bucket: histogramBucket("request", 2_100),
          weight: 1,
        },
      ]),
    );
    expect(routeBuckets).toHaveLength(2);
  });
});

describe("performance aggregates on Postgres", () => {
  let client: PGliteClient;
  let db: any;

  beforeEach(async () => {
    __resetSessionPerformanceForTests();
    client = await PGlite.create("memory://");
    for (const statement of performanceMigrationSql()) {
      await client.query(statement);
    }
    await client.query(`
      CREATE TABLE session_recordings (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        owner_email text NOT NULL,
        org_id text,
        started_at text NOT NULL
      )
    `);
    db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
  });

  afterEach(async () => {
    await client.close();
  });

  /** Mirrors ingest: session maxima in the event transaction, routes after. */
  async function ingest(
    rows: SessionEventIndexInputRow[],
    receivedAt = `${DAY}T10:00:00.000Z`,
  ) {
    await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`INSERT INTO session_recordings (id, session_id, owner_email, org_id, started_at)
            VALUES (${`stored-${Math.random()}`}, 'stored', ${OWNER}, ${ORG}, ${receivedAt})`,
      );
      await recordSessionPerformance(tx, rows, receivedAt);
    });
    await recordRoutePerformance(rows, receivedAt);
  }

  async function addRecording(
    id: string,
    sessionId: string,
    owner: { ownerEmail?: string; orgId?: string | null } = {},
  ) {
    await client.query(
      `INSERT INTO session_recordings (id, session_id, owner_email, org_id, started_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        sessionId,
        owner.ownerEmail ?? OWNER,
        owner.orgId === undefined ? ORG : owner.orgId,
        `${DAY}T09:00:00.000Z`,
      ],
    );
  }

  const scope = { userEmail: OWNER, orgId: ORG };

  async function slowRecordings(
    filter: "any" | "vitals" | "requests",
    viewer: { userEmail: string; orgId: string | null } = scope,
  ): Promise<string[]> {
    const r = schema.sessionRecordings;
    const rows = await db
      .select({ id: r.id })
      .from(r)
      .where(and(...(await slowSessionConditions(viewer, filter))))
      .orderBy(asc(r.id));
    return rows.map((row: { id: string }) => row.id);
  }

  async function failInsertsInto(table: string) {
    await client.query(
      "CREATE OR REPLACE FUNCTION fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'insert failed'; END $$",
    );
    await client.query(
      `CREATE TRIGGER fail_insert BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_insert()`,
    );
  }

  it("reports route percentiles across batches, and no data as null", async () => {
    await ingest([
      ...[1_000, 1_000, 1_000, 1_000, 1_000].map((lcp) =>
        vitals("s1", { lcp_ms: lcp }),
      ),
      ...[3_000, 3_000, 3_000, 3_000].map((lcp) =>
        vitals("s2", { lcp_ms: lcp }),
      ),
    ]);
    await ingest([
      vitals("s3", { lcp_ms: 9_000 }),
      response("s3", { duration_ms: 150, sample_weight: 10 }),
      response("s3", { duration_ms: 1_400 }),
    ]);

    const result = await listRoutePerformance(scope, {
      from: DAY,
      to: DAY,
      app: "clips",
    });
    expect(result.coverageStartedAt).toBe(`${DAY}T10:00:00.000Z`);
    expect(result.incompleteDates).toEqual([]);
    expect(result.routes).toHaveLength(1);
    const [route] = result.routes;
    expect(route).toMatchObject({ app: "clips", route: "/r/:id" });
    expect(route.lcp?.samples).toBe(10);
    // Interpolated inside the [1000, 1250) bucket that holds the median.
    expect(route.lcp?.p50).toEqual({ value: 1_250, atLeast: false });
    expect(route.lcp?.p95).toEqual({ value: 9_000, atLeast: false });
    expect(route.request).toMatchObject({ samples: 11, slow: 1 });
    // Nothing measured INP here: that is no data, not a fast route.
    expect(route.inp).toBeNull();
    expect(route.ttfb).toBeNull();
  });

  it("keeps each gap marker as long as the aggregate it describes", async () => {
    const now = new Date(`${DAY}T12:00:00.000Z`);
    const daysAgo = (days: number) =>
      new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    for (const [id, days, sessionId] of [
      ["session-recent", 10, "s-recent"],
      ["session-old", 100, "s-old"],
      ["route-old", 100, ""],
      ["route-expired", 200, ""],
    ] as const) {
      await client.query(
        `INSERT INTO analytics_performance_gaps (id, tenant_key, owner_email, org_id, event_date, session_id, recorded_at)
         VALUES ($1, 'tenant', $2, $3, $4, $5, $6)`,
        [id, OWNER, ORG, daysAgo(days), sessionId, now.toISOString()],
      );
    }

    // A batch for s-live failed long ago, but its later events keep its row.
    await ingest([vitals("s-live", { lcp_ms: 1_000 })]);
    const [{ tenant_key: tenantKey }] = (
      await client.query(
        "SELECT tenant_key FROM analytics_session_performance WHERE session_id = 's-live'",
      )
    ).rows;
    await client.query(
      `INSERT INTO analytics_performance_gaps (id, tenant_key, owner_email, org_id, event_date, session_id, recorded_at)
       VALUES ('session-live', $1, $2, $3, $4, 's-live', $5)`,
      [tenantKey, OWNER, ORG, daysAgo(100), now.toISOString()],
    );

    await prunePerformanceAggregates(30, now);

    const kept = await client.query(
      "SELECT id FROM analytics_performance_gaps ORDER BY id",
    );
    // Sessions last as long as their replays; route days last 180 days.
    expect(kept.rows.map((row: { id: string }) => row.id)).toEqual([
      "route-old",
      "session-live",
      "session-recent",
    ]);
  });

  it("lists every app in range, even one whose routes rank below the limit", async () => {
    await ingest([
      vitals("s1", { lcp_ms: 1_000 }),
      vitals("s1", { lcp_ms: 1_000 }),
      vitals("s2", { route: "/home", lcp_ms: 1_000 }, { app: "mail" }),
      vitals("s3", { lcp_ms: 1_000 }, { app: "" }),
    ]);

    const top = await listRoutePerformance(scope, {
      from: DAY,
      to: DAY,
      limit: 1,
    });
    expect(top.routes.map((row) => row.app)).toEqual(["clips"]);
    expect(top.truncated).toBe(true);
    expect(top.apps).toEqual(["clips", "mail"]);
    // The app filter narrows routes, not the apps there are to choose from.
    const mail = await listRoutePerformance(scope, {
      from: DAY,
      to: DAY,
      app: "mail",
    });
    expect(mail.routes.map((row) => row.route)).toEqual(["/home"]);
    expect(mail.apps).toEqual(["clips", "mail"]);
  });

  it("finds sessions by poor vitals or slow requests, per recording tenant", async () => {
    await ingest([
      vitals("s-poor-lcp", { lcp_ms: 4_200 }),
      vitals("s-fast", { lcp_ms: 900, inp_ms: 80, cls: 0 }),
      response("s-slow-request", { duration_ms: 1_000 }),
      response("s-fast", { duration_ms: 400 }),
    ]);
    await addRecording("r-poor-lcp", "s-poor-lcp");
    await addRecording("r-fast", "s-fast");
    await addRecording("r-slow-request", "s-slow-request");
    await addRecording("r-unmeasured", "s-unmeasured");
    // Same session id, another tenant: their aggregates are not this one's.
    await addRecording("r-other-tenant", "s-poor-lcp", {
      ownerEmail: "other@example.com",
      orgId: "org_2",
    });
    // A share grants the recording, not its tenant's speed data.
    await ingest([
      vitals(
        "s-shared",
        { lcp_ms: 5_000 },
        { ownerEmail: "other@example.com", orgId: "org_2" },
      ),
    ]);
    await addRecording("r-shared", "s-shared", {
      ownerEmail: "other@example.com",
      orgId: "org_2",
    });

    expect(await slowRecordings("vitals")).toEqual(["r-poor-lcp"]);
    expect(await slowRecordings("requests")).toEqual(["r-slow-request"]);
    expect(await slowRecordings("any")).toEqual([
      "r-poor-lcp",
      "r-slow-request",
    ]);
    expect(
      await slowRecordings("vitals", {
        userEmail: "other@example.com",
        orgId: "org_2",
      }),
    ).toEqual(["r-shared"]);
    const shared = {
      id: "r-shared",
      sessionId: "s-shared",
      ownerEmail: "other@example.com",
      orgId: "org_2",
    };
    expect(
      (await getSessionPerformanceSummaries(scope, [shared])).has("r-shared"),
    ).toBe(false);
    expect(
      (
        await getSessionPerformanceSummaries(
          { userEmail: shared.ownerEmail, orgId: shared.orgId },
          [shared],
        )
      ).get("r-shared"),
    ).toMatchObject({ lcpMs: 5_000 });

    const summaries = await getSessionPerformanceSummaries(scope, [
      { id: "r-fast", sessionId: "s-fast", ownerEmail: OWNER, orgId: ORG },
      {
        id: "r-poor-lcp",
        sessionId: "s-poor-lcp",
        ownerEmail: OWNER,
        orgId: ORG,
      },
      {
        id: "r-unmeasured",
        sessionId: "s-unmeasured",
        ownerEmail: OWNER,
        orgId: ORG,
      },
    ]);
    expect(summaries.get("r-fast")).toEqual({
      ttfbMs: null,
      lcpMs: 900,
      inpMs: 80,
      cls: 0,
      slowRequests: 0,
      maxRequestMs: 400,
      atLeast: [],
      incomplete: false,
    });
    // It made no measured request, so it has no count rather than zero.
    expect(summaries.get("r-poor-lcp")).toMatchObject({
      lcpMs: 4_200,
      slowRequests: null,
    });
    expect(summaries.has("r-unmeasured")).toBe(false);
  });

  it("marks a session value that hit the ceiling as a floor", async () => {
    await ingest([
      vitals("s1", { lcp_ms: 3_600_000, cls: 0.3 }),
      response("s1", { duration_ms: 900_000 }),
    ]);
    const summaries = await getSessionPerformanceSummaries(scope, [
      { id: "r1", sessionId: "s1", ownerEmail: OWNER, orgId: ORG },
    ]);
    expect(summaries.get("r1")).toMatchObject({
      lcpMs: performanceCeiling("lcp"),
      cls: 0.3,
      maxRequestMs: performanceCeiling("request"),
      slowRequests: 1,
      atLeast: ["lcpMs", "maxRequestMs"],
    });
  });

  it("scopes route performance to the viewer's tenants", async () => {
    await ingest([
      vitals(
        "s1",
        { lcp_ms: 1_000 },
        { ownerEmail: "other@example.com", orgId: "org_2" },
      ),
      vitals("s2", { lcp_ms: 2_000 }),
    ]);
    const result = await listRoutePerformance(scope, { from: DAY, to: DAY });
    expect(result.routes.map((route) => route.lcp?.samples)).toEqual([1]);
  });

  it("reads a session whose maxima failed to save as incomplete, not complete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ingest([
      vitals("s-ok", { lcp_ms: 1_000 }),
      vitals("s-partial", { lcp_ms: 900 }),
    ]);
    await failInsertsInto("analytics_session_performance");
    await ingest([
      vitals("s-lost", { lcp_ms: 900 }),
      vitals("s-partial", { lcp_ms: 900 }),
    ]);
    warn.mockRestore();

    // The events still committed.
    const stored = await client.query(
      "SELECT count(*)::int AS count FROM session_recordings",
    );
    expect(stored.rows).toEqual([{ count: 2 }]);
    await addRecording("r-ok", "s-ok");
    await addRecording("r-lost", "s-lost");
    await addRecording("r-partial", "s-partial");

    const summaries = await getSessionPerformanceSummaries(scope, [
      { id: "r-ok", sessionId: "s-ok", ownerEmail: OWNER, orgId: ORG },
      { id: "r-lost", sessionId: "s-lost", ownerEmail: OWNER, orgId: ORG },
      {
        id: "r-partial",
        sessionId: "s-partial",
        ownerEmail: OWNER,
        orgId: ORG,
      },
    ]);
    expect(summaries.get("r-ok")?.incomplete).toBe(false);
    expect(summaries.get("r-lost")).toEqual({
      ttfbMs: null,
      lcpMs: null,
      inpMs: null,
      cls: null,
      slowRequests: null,
      maxRequestMs: null,
      atLeast: [],
      incomplete: true,
    });
    expect(summaries.get("r-partial")).toMatchObject({
      lcpMs: 900,
      incomplete: true,
    });
    // Nothing measured rules them out, so `any` keeps them; the specific
    // filters need a measured slow value.
    expect(await slowRecordings("any")).toEqual(["r-lost", "r-partial"]);
    expect(await slowRecordings("vitals")).toEqual([]);
    expect(await slowRecordings("requests")).toEqual([]);
    // The route samples were written in full, so the day is complete.
    const result = await listRoutePerformance(scope, { from: DAY, to: DAY });
    expect(result.incompleteDates).toEqual([]);
    expect(result.routes[0]?.lcp?.samples).toBe(4);
  });

  it("shows routes saved while a tenant's first session write failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failInsertsInto("analytics_session_performance");
    await ingest([vitals("s-lost", { lcp_ms: 1_000 })]);
    warn.mockRestore();

    const result = await listRoutePerformance(scope, { from: DAY, to: DAY });
    expect(result.coverageStartedAt).toBe(`${DAY}T10:00:00.000Z`);
    expect(result.routes[0]?.lcp?.samples).toBe(1);
    await addRecording("r-lost", "s-lost");
    expect(
      (
        await getSessionPerformanceSummaries(scope, [
          { id: "r-lost", sessionId: "s-lost", ownerEmail: OWNER, orgId: ORG },
        ])
      ).get("r-lost")?.incomplete,
    ).toBe(true);
  });

  it("marks a day incomplete when its route aggregates fail to save", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ingest([vitals("s-ok", { lcp_ms: 1_000 })]);
    await failInsertsInto("analytics_route_performance_daily");
    await ingest([vitals("s-lost-route", { lcp_ms: 5_000 })]);
    warn.mockRestore();

    const gaps = await client.query(
      "SELECT event_date, session_id FROM analytics_performance_gaps",
    );
    expect(gaps.rows).toEqual([{ event_date: DAY, session_id: "" }]);
    const result = await listRoutePerformance(scope, { from: DAY, to: DAY });
    expect(result.incompleteDates).toEqual([DAY]);
    // A route-day marker says nothing about any one session.
    await addRecording("r-ok", "s-ok");
    expect(
      (
        await getSessionPerformanceSummaries(scope, [
          { id: "r-ok", sessionId: "s-ok", ownerEmail: OWNER, orgId: ORG },
        ])
      ).get("r-ok")?.incomplete,
    ).toBe(false);
  });

  it("stores caller text the way Postgres keeps it, so a batch never collides", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const long = `/${"a".repeat(260)}`;
    await ingest([
      vitals("s1", { route: "/nul\u0000route", lcp_ms: 1_000 }),
      // Two different lone surrogates both become U+FFFD in Postgres.
      vitals("s1", { route: "/x/\uD800", lcp_ms: 1_000 }),
      vitals("s1", { route: "/x/\uDC00", lcp_ms: 1_000 }),
      vitals("s-\uD800", { lcp_ms: 1_000 }),
      vitals("s-\uDBFF", { lcp_ms: 1_000 }),
      vitals("s2", { route: `${long}b`, lcp_ms: 1_000 }),
      vitals("s2", { route: `${long}c`, lcp_ms: 1_000 }),
      vitals("s3", { lcp_ms: 1_000 }, { app: "cl\u0000ips" }),
    ]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    const gaps = await client.query(
      "SELECT count(*)::int AS count FROM analytics_performance_gaps",
    );
    expect(gaps.rows).toEqual([{ count: 0 }]);
    const result = await listRoutePerformance(scope, { from: DAY, to: DAY });
    const samples = Object.fromEntries(
      result.routes.map((row) => [row.route, row.lcp?.samples]),
    );
    expect(samples).toEqual({
      "/nulroute": 1,
      "/x/\uFFFD": 2,
      [long.slice(0, 200)]: 2,
      "/r/:id": 3,
    });
    expect(result.routes.every((row) => row.app === "clips")).toBe(true);
    const merged = await client.query(
      "SELECT page_views FROM analytics_session_performance WHERE session_id = $1",
      ["s-\uFFFD"],
    );
    expect(merged.rows).toEqual([{ page_views: 2 }]);
  });

  it("stores events and reports no coverage before the tables are migrated", async () => {
    for (const table of [
      "analytics_performance_coverage",
      "analytics_performance_gaps",
      "analytics_session_performance",
      "analytics_route_performance_daily",
    ]) {
      await client.query(`DROP TABLE ${table}`);
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ingest([vitals("s1", { lcp_ms: 5_000 })]);
    expect(String(warn.mock.calls[0]?.[0])).toContain("not migrated yet");
    warn.mockRestore();

    const stored = await client.query(
      "SELECT count(*)::int AS count FROM session_recordings",
    );
    expect(stored.rows).toEqual([{ count: 1 }]);
    await addRecording("r1", "s1");
    expect(await slowRecordings("any")).toEqual([]);
    expect(
      await listRoutePerformance(scope, { from: DAY, to: DAY }),
    ).toMatchObject({ routes: [], coverageStartedAt: null });
    expect(
      (
        await getSessionPerformanceSummaries(scope, [
          { id: "r1", sessionId: "s1", ownerEmail: OWNER, orgId: ORG },
        ])
      ).size,
    ).toBe(0);
  });

  it("refuses an unbounded range", async () => {
    await expect(
      listRoutePerformance(scope, { from: "2026-01-01", to: DAY }),
    ).rejects.toThrow("at most 90 days");
  });
});
