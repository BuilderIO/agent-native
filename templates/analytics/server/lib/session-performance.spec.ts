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

import { schema } from "../db/index.js";
import type { SessionEventIndexInputRow } from "./session-event-index";
import {
  __resetSessionPerformanceForTests,
  aggregatePerformanceRows,
  getSessionPerformanceSummaries,
  listRoutePerformance,
  recordRoutePerformance,
  recordSessionPerformance,
  slowSessionConditions,
} from "./session-performance";

/** The DDL comes straight from the migration so the test tracks it. */
function performanceMigrationSql(): string[] {
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
        { metric: "request", bucket: 12, weight: 20 },
        { metric: "request", bucket: 26, weight: 1 },
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

  async function slowRecordings(
    filter: "any" | "vitals" | "requests",
  ): Promise<string[]> {
    const r = schema.sessionRecordings;
    const rows = await db
      .select({ id: r.id })
      .from(r)
      .where(and(...(await slowSessionConditions(filter))))
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

  const scope = { userEmail: OWNER, orgId: ORG };

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

    expect(await slowRecordings("vitals")).toEqual(["r-poor-lcp"]);
    expect(await slowRecordings("requests")).toEqual(["r-slow-request"]);
    expect(await slowRecordings("any")).toEqual([
      "r-poor-lcp",
      "r-slow-request",
    ]);

    const summaries = await getSessionPerformanceSummaries([
      { id: "r-fast", sessionId: "s-fast", ownerEmail: OWNER, orgId: ORG },
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
    });
    expect(summaries.has("r-unmeasured")).toBe(false);
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

  it("marks sessions and days incomplete when an aggregate write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ingest([vitals("s-ok", { lcp_ms: 1_000 })]);
    await failInsertsInto("analytics_session_performance");
    await client.query(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON analytics_route_performance_daily FOR EACH ROW EXECUTE FUNCTION fail_insert()",
    );
    await ingest([vitals("s-lost", { lcp_ms: 5_000 })]);
    warn.mockRestore();

    // The events still committed.
    const stored = await client.query(
      "SELECT count(*)::int AS count FROM session_recordings",
    );
    expect(stored.rows).toEqual([{ count: 2 }]);
    const gaps = await client.query(
      "SELECT event_date, session_id FROM analytics_performance_gaps ORDER BY session_id",
    );
    expect(gaps.rows).toEqual([
      { event_date: DAY, session_id: "" },
      { event_date: DAY, session_id: "s-lost" },
    ]);
    const result = await listRoutePerformance(scope, { from: DAY, to: DAY });
    expect(result.incompleteDates).toEqual([DAY]);
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
        await getSessionPerformanceSummaries([
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
