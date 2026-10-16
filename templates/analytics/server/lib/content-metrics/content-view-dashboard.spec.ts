import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Content view's seeded panels, run through the real first-party query
// path against a local PGlite database, for an organization whose events
// sink is BigQuery.

const { PGlite } = createRequire(
  new URL("../../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const bigQuery = vi.hoisted(() => ({ query: vi.fn() }));
const database = vi.hoisted(() => ({
  client: null as null | {
    query: (
      sql: string,
      args: unknown[],
    ) => Promise<{ rows: unknown[]; affectedRows?: number }>;
    transaction: <T>(
      callback: (tx: {
        query: (
          sql: string,
          args: unknown[],
        ) => Promise<{ rows: unknown[]; affectedRows?: number }>;
      }) => Promise<T>,
    ) => Promise<T>;
  },
}));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    execute: async ({ sql, args }: { sql: string; args?: unknown[] }) => {
      if (!database.client) throw new Error("test database is not open");
      const result = await database.client.query(sql, args ?? []);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      if (!database.client) throw new Error("test database is not open");
      return database.client.transaction((tx) =>
        callback({
          execute: async ({ sql, args }: { sql: string; args?: unknown[] }) => {
            const result = await tx.query(sql, args ?? []);
            return {
              rows: result.rows,
              rowsAffected: result.affectedRows ?? 0,
            };
          },
        }),
      );
    },
  }),
}));
vi.mock("../first-party-analytics-backend.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../first-party-analytics-backend.js")
  >()),
  getFirstPartyAnalyticsBackend: async () => ({
    sink: "bigquery",
    table: "example-project.analytics.first_party_analytics_events_raw",
    backfillCursor: "evt_last",
    backfillCompleted: true,
  }),
  queryFirstPartyAnalyticsInBigQuery: bigQuery.query,
}));
vi.mock("../first-party-analytics-health.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../first-party-analytics-health.js")
  >()),
  recordFirstPartyAnalyticsQueryPressure: async () => {},
}));

import { interpolateDashboardPanelSql } from "../../../app/pages/adhoc/sql-dashboard/interpolate";
import { planPanelRender } from "../../../shared/panel-render-contract";
import { getDashboardCatalogEntry } from "../dashboard-catalog";
import { queryFirstPartyAnalytics } from "../first-party-analytics";
import { CONTENT_METRICS_MIGRATION_SQL } from "./migration";

const ALICE = { userEmail: "alice@example.test", orgId: "org_a" };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function contentView() {
  const entry = getDashboardCatalogEntry("content-view");
  if (!entry) throw new Error("content-view is not in the dashboard catalog");
  return entry.buildConfig();
}

async function runPanel(id: string, timeRange = "28d") {
  const panel = contentView().panels.find((candidate) => candidate.id === id);
  if (!panel) throw new Error(`no panel ${id}`);
  const sql = interpolateDashboardPanelSql(panel.sql, { timeRange }, panel);
  return (await queryFirstPartyAnalytics(sql, ALICE, { cache: false })).rows;
}

describe("Content view dashboard", () => {
  let client: PGliteClient;

  beforeEach(async () => {
    bigQuery.query.mockReset();
    client = await PGlite.create("memory://");
    database.client = client;
    await client.exec(`
      ${CONTENT_METRICS_MIGRATION_SQL.join(";\n")};
      CREATE TABLE first_party_analytics_cache (
        key text PRIMARY KEY, sql text NOT NULL, result text NOT NULL,
        created_at text NOT NULL, expires_at text NOT NULL
      );
      INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, url, title, author, published_at, first_seen_at, updated_at) VALUES
        ('a1', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'a1', 'https://www.builder.io/blog/one', 'Post one', 'Ada', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01'),
        ('a2', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'a2', 'https://www.builder.io/blog/two', 'Post two', 'Grace', '${daysAgo(0)}T00:00:00.000Z', '2026-09-01', '2026-09-01'),
        ('p1', 'org:org_a', 'alice@example.test', 'org_a', 'search_console', 'agent-native.com/docs', 'https://agent-native.com/docs', NULL, NULL, NULL, '2026-09-01', '2026-09-01'),
        ('b1', 'org:org_b', 'carol@example.test', 'org_b', 'builder_blog', 'b1', 'https://www.builder.io/blog/other', 'Other org post', 'Carol', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at) VALUES
        ('s1', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(3)}', 'ga4_pageviews', 5, 'ga4', 'r2', '${daysAgo(1)}'),
        ('s2', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(2)}', 'ga4_pageviews', 0, 'ga4', 'r2', '${daysAgo(1)}'),
        ('s3', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(40)}', 'ga4_pageviews', 100, 'ga4', 'r0', '${daysAgo(39)}'),
        ('s4', 'org:org_a', 'alice@example.test', 'org_a', 'p1', '${daysAgo(4)}', 'search_console_clicks', 2, 'search_console', 'r9', '${daysAgo(1)}'),
        ('s5', 'org:org_a', 'alice@example.test', 'org_a', 'p1', '${daysAgo(4)}', 'search_console_impressions', 30, 'search_console', 'r9', '${daysAgo(1)}'),
        ('s6', 'org:org_b', 'carol@example.test', 'org_b', 'b1', '${daysAgo(3)}', 'ga4_pageviews', 999, 'ga4', 'rb', '${daysAgo(1)}');
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, window_end, error_code, error_message) VALUES
        ('r1', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:00.000Z', NULL, NULL, NULL),
        ('r2', 'org:org_a', 'alice@example.test', 'org_a', 'ga4', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:01.000Z', '${daysAgo(2)}', NULL, NULL),
        ('r3', 'org:org_a', 'alice@example.test', 'org_a', 'search_console', 'scheduled', 'succeeded', '${daysAgo(2)}T07:00:02.000Z', '${daysAgo(4)}', NULL, NULL),
        ('r4', 'org:org_a', 'alice@example.test', 'org_a', 'search_console', 'scheduled', 'not_configured', '${daysAgo(1)}T07:00:02.000Z', NULL, 'search_console_no_access', 'Search Console denied access to sc-domain:example.test.'),
        ('rb', 'org:org_b', 'carol@example.test', 'org_b', 'ga4', 'scheduled', 'failed', '${daysAgo(1)}T07:00:00.000Z', NULL, 'step_failed', 'boom');
    `);
  });

  afterEach(async () => {
    database.client = null;
    await client?.close();
  });

  it("reads only the content tables through the first-party source", () => {
    const config = contentView();
    expect(config.panels.length).toBeGreaterThan(0);
    for (const panel of config.panels) {
      expect(panel.source).toBe("first-party");
      const tables = [
        ...panel.sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi),
      ]
        .map((match) => match[1]!.toLowerCase())
        .filter((name) => name !== "latest" && name !== "totals");
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) {
        expect(table).toMatch(/^analytics_content_/);
      }
    }
  });

  it("names each source's latest run, including one that has no access", async () => {
    expect(await runPanel("collection-status")).toEqual([
      expect.objectContaining({ source: "Blog articles", status: "Collected" }),
      expect.objectContaining({
        source: "GA4 pageviews",
        status: "Collected",
        data_through: daysAgo(2),
      }),
      expect.objectContaining({
        source: "Search Console",
        status: "Not set up",
        detail: "Search Console denied access to sc-domain:example.test.",
      }),
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("lists articles with the reason a metric is missing instead of a zero", async () => {
    const rows = await runPanel("articles");
    expect(rows).toEqual([
      expect.objectContaining({
        title: "Post two",
        author: "Grace",
        published: daysAgo(0),
        pageviews: null,
        clicks: null,
        not_collected: "GA4: still arriving · Search Console: not set up",
      }),
      expect.objectContaining({
        title: "Post one",
        href: "https://www.builder.io/blog/one",
        pageviews: 5,
        clicks: null,
        not_collected: "Search Console: not set up",
      }),
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("keeps the time range and the organization in every panel", async () => {
    const all = await runPanel("articles", "all");
    expect(all.find((row) => row.title === "Post one")?.pageviews).toBe(105);
    expect(all.some((row) => row.title === "Other org post")).toBe(false);

    // Search Console reported nothing on these days: null, drawn as a gap.
    const trend = await runPanel("daily-trend");
    expect(trend).toEqual([
      { date: daysAgo(3), pageviews: 5, search_clicks: null },
      { date: daysAgo(2), pageviews: 0, search_clicks: null },
    ]);
    const trendPanel = contentView().panels.find(
      (panel) => panel.id === "daily-trend",
    )!;
    const plan = planPanelRender(trend, trendPanel, { timeRange: 28 });
    expect(plan.yKeys).toEqual(["pageviews", "search_clicks"]);
    expect(plan.rows.map((row) => row.search_clicks)).toEqual([null, null]);
    expect(await runPanel("search-pages")).toEqual([
      {
        page: "https://agent-native.com/docs",
        href: "https://agent-native.com/docs",
        clicks: 2,
        impressions: 30,
      },
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });
});
