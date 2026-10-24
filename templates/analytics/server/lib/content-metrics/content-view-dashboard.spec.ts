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

function runDay(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
        ('s6', 'org:org_b', 'carol@example.test', 'org_b', 'b1', '${daysAgo(3)}', 'ga4_pageviews', 999, 'ga4', 'rb', '${daysAgo(1)}'),
        ('s7', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(3)}', 'signups_first_touch', 2, 'signups', 'r5', '${daysAgo(1)}'),
        ('s8', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(3)}', 'signups_first_touch_source', 1, 'signups', 'r5', '${daysAgo(1)}');
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, window_end, error_code, error_message) VALUES
        ('r1', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:00.000Z', NULL, NULL, NULL),
        ('r2', 'org:org_a', 'alice@example.test', 'org_a', 'ga4', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:01.000Z', '${daysAgo(2)}', NULL, NULL),
        ('r3', 'org:org_a', 'alice@example.test', 'org_a', 'search_console', 'scheduled', 'succeeded', '${daysAgo(2)}T07:00:02.000Z', '${daysAgo(4)}', NULL, NULL),
        ('r4', 'org:org_a', 'alice@example.test', 'org_a', 'search_console', 'scheduled', 'not_configured', '${daysAgo(1)}T07:00:02.000Z', NULL, 'search_console_no_access', 'Search Console denied access to sc-domain:example.test.'),
        ('r5', 'org:org_a', 'alice@example.test', 'org_a', 'signups', 'scheduled', 'cost_limited', '${daysAgo(1)}T07:00:03.000Z', NULL, 'signups_bytes_cap', 'The signups join would scan 5000 bytes, over the 1000-byte cap. Nothing ran.'),
        ('rb', 'org:org_b', 'carol@example.test', 'org_b', 'ga4', 'scheduled', 'failed', '${daysAgo(1)}T07:00:00.000Z', NULL, 'step_failed', 'boom');
    `);
  });

  // The database clock, not the test runner's UTC date: near midnight the two
  // name different days.
  async function yesterday(format: string): Promise<string> {
    const { rows } = (await client.query(
      `SELECT to_char(CURRENT_DATE - 1, '${format}') AS day`,
    )) as { rows: Array<{ day: string }> };
    return rows[0]!.day;
  }

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
        .filter(
          (name) =>
            ![
              "latest",
              "sources",
              "runs",
              "totals",
              "dates",
              "per_article",
              "top_authors",
              "windows",
            ].includes(name),
        );
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
        data_through: daysAgo(4),
        detail: "Search Console denied access to sc-domain:example.test.",
      }),
      expect.objectContaining({ source: "Signups", status: "Cost-limited" }),
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("keeps a source with no run in 30 days, with its last run from this organization", async () => {
    await client.exec(
      `UPDATE analytics_content_collection_runs SET started_at = '${daysAgo(40)}T07:00:01.000Z' WHERE id = 'r2'`,
    );
    expect(await runPanel("collection-status")).toEqual([
      expect.objectContaining({ source: "Blog articles", status: "Collected" }),
      expect.objectContaining({
        source: "GA4 pageviews",
        status: "No run in 30 days",
        last_run: `${daysAgo(40)}T07:00:01.000Z`,
        data_through: daysAgo(2),
      }),
      expect.objectContaining({ source: "Search Console" }),
      expect.objectContaining({ source: "Signups" }),
    ]);
    expect(await runPanel("missing-data")).toEqual([
      {
        severity: "warning",
        message: "**Pageviews haven't been collected in the last 30 days**.",
      },
      expect.objectContaining({ severity: "warning" }),
      expect.objectContaining({ severity: "critical" }),
    ]);
  });

  it("names each source that failed, hit the cost cap or isn't connected in one notice", async () => {
    expect(await runPanel("missing-data")).toEqual([
      {
        severity: "warning",
        message:
          "**Search clicks and impressions aren't connected yet**: waiting for Search Console access.",
      },
      {
        severity: "critical",
        message: `**Signups stopped at the cost cap** on the ${runDay(1)} run.`,
      },
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("says nothing is missing only when every source collected recently, and only from this organization's runs", async () => {
    await client.exec(
      "UPDATE analytics_content_collection_runs SET status = 'succeeded' WHERE id IN ('r4', 'r5')",
    );
    expect(await runPanel("missing-data")).toEqual([
      {
        severity: "info",
        message: "Nothing is missing: every source collected on its last run.",
      },
    ]);

    await client.exec(
      `UPDATE analytics_content_collection_runs SET started_at = '${daysAgo(40)}T07:00:00.000Z' WHERE tenant_key = 'org:org_a'`,
    );
    expect(await runPanel("missing-data")).toEqual(
      ["Articles", "Pageviews", "Search clicks and impressions", "Signups"].map(
        (label) => ({
          severity: "warning",
          message: `**${label} haven't been collected in the last 30 days**.`,
        }),
      ),
    );
  });

  it("ranks articles by signups and leaves an article with none in the window blank", async () => {
    expect(await runPanel("articles")).toEqual([
      {
        title: "Post one",
        href: "https://www.builder.io/blog/one",
        author: "Ada",
        published: "2026-09-01",
        signups: 2,
        source_signups: 1,
      },
      {
        title: "Post two",
        href: "https://www.builder.io/blog/two",
        author: "Grace",
        published: daysAgo(0),
        signups: null,
        source_signups: null,
      },
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("rejects a custom date scaffold wider than the supported range", () => {
    const panel = contentView().panels.find(
      (panel) => panel.id === "signups-per-day",
    )!;
    expect(
      interpolateDashboardPanelSql(
        panel.sql,
        {
          timeRange: "custom",
          timeRangeStart: "2000-01-01",
          timeRangeEnd: "2026-10-20",
        },
        panel,
      ),
    ).toBe("SELECT __invalid_custom_date_range__");
  });

  it("keeps a day with no signups as null through yesterday", async () => {
    const days = await runPanel("signups-per-day");
    expect(days).toHaveLength(28);
    expect(days[days.length - 1]).toEqual({
      date: await yesterday("YYYY-MM-DD"),
      signups: null,
    });
    expect(days.filter((row) => row.signups !== null)).toEqual([
      { date: daysAgo(3), signups: 2 },
    ]);
    const panel = contentView().panels.find(
      (panel) => panel.id === "signups-per-day",
    )!;
    const plan = planPanelRender(days, panel, { timeRange: 28 });
    expect(plan.rows.find((row) => row.date === daysAgo(2))?.signups).toBe(
      null,
    );
  });

  it("keeps the time range and the organization in every panel", async () => {
    await client.exec(`
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at) VALUES
        ('s9', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(40)}', 'signups_first_touch', 10, 'signups', 'r0', '${daysAgo(39)}'),
        ('s10', 'org:org_b', 'carol@example.test', 'org_b', 'b1', '${daysAgo(3)}', 'signups_first_touch', 50, 'signups', 'rb', '${daysAgo(1)}');
    `);
    const all = await runPanel("articles", "all");
    expect(all.find((row) => row.title === "Post one")?.signups).toBe(12);
    expect(all.some((row) => row.title === "Other org post")).toBe(false);

    expect(await runPanel("signups-by-author")).toEqual([
      { author: "Ada", signups: 2 },
    ]);
    expect(await runPanel("authors")).toEqual([
      { author: "Ada", articles: 1, with_signups: 1, signups: 2 },
      { author: "Grace", articles: 1, with_signups: 0, signups: null },
    ]);
    expect(await runPanel("author-weeks")).toEqual([
      { author: "Ada", week: await yesterday("YYYY-MM-DD"), signups: 2 },
    ]);
    expect((await runPanel("author-articles")).map((row) => row.title)).toEqual(
      ["Post one", "Post two"],
    );
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("picks the weekly chart's top authors from the days it draws, not today", async () => {
    await client.exec(`
      INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, url, title, author, published_at, first_seen_at, updated_at) VALUES
        ('w1', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'w1', 'https://www.builder.io/blog/w1', 'W1', 'Writer 1', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01'),
        ('w2', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'w2', 'https://www.builder.io/blog/w2', 'W2', 'Writer 2', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01'),
        ('w3', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'w3', 'https://www.builder.io/blog/w3', 'W3', 'Writer 3', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01'),
        ('w4', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'w4', 'https://www.builder.io/blog/w4', 'W4', 'Writer 4', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01'),
        ('w5', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'w5', 'https://www.builder.io/blog/w5', 'W5', 'Writer 5', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'ws' || item_id || days_ago, 'org:org_a', 'alice@example.test', 'org_a', item_id, to_char(CURRENT_DATE - days_ago, 'YYYY-MM-DD'), 'signups_first_touch', value, 'signups', 'r0', '2026-09-01'
      FROM (VALUES ('w1', 2, 9), ('w2', 2, 8), ('w3', 2, 7), ('w4', 2, 6), ('w5', 0, 100), ('w1', 0, 40)) AS rows (item_id, days_ago, value);
    `);
    // The chart leaves today out: Writer 5's signups are all from today, so
    // Ada keeps the fifth line, and Writer 1's 40 today stay out of their week.
    const week = await yesterday("YYYY-MM-DD");
    const rows = await runPanel("author-weeks");
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        { author: "Writer 1", week, signups: 9 },
        { author: "Writer 2", week, signups: 8 },
        { author: "Writer 3", week, signups: 7 },
        { author: "Writer 4", week, signups: 6 },
        { author: "Ada", week, signups: 2 },
      ]),
    );
  });

  it("counts a new article's first week and compares each article's last 28 days with the 28 before", async () => {
    await client.exec(`
      UPDATE analytics_content_items SET published_at = '${daysAgo(120)}T00:00:00.000Z' WHERE id = 'a1';
      INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, url, title, author, published_at, first_seen_at, updated_at) VALUES
        ('a3', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'a3', 'https://www.builder.io/blog/three', 'Post three', 'Ada', '${daysAgo(80)}T00:00:00.000Z', '2026-09-01', '2026-09-01');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at) VALUES
        ('s11', 'org:org_a', 'alice@example.test', 'org_a', 'a3', '${daysAgo(78)}', 'signups_first_touch', 5, 'signups', 'r0', '${daysAgo(77)}'),
        ('s13', 'org:org_a', 'alice@example.test', 'org_a', 'a3', '${daysAgo(85)}', 'signups_first_touch', 4, 'signups', 'r0', '${daysAgo(84)}'),
        ('s12', 'org:org_a', 'alice@example.test', 'org_a', 'a3', '${daysAgo(10)}', 'signups_first_touch', 10, 'signups', 'r0', '${daysAgo(9)}');
      -- Each window's edges, dated by the database clock so midnight can't shift them.
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'edge' || days_ago, 'org:org_a', 'alice@example.test', 'org_a', 'a3', to_char(CURRENT_DATE - days_ago, 'YYYY-MM-DD'), 'signups_first_touch', value, 'signups', 'r0', '2026-09-01'
      FROM (VALUES (57, 50), (56, 3), (29, 2), (28, 1), (0, 100)) AS edges (days_ago, value);
    `);
    expect(await runPanel("new-articles")).toEqual([
      {
        title: "Post two",
        href: "https://www.builder.io/blog/two",
        published: daysAgo(0),
        first_week: null,
        signups: null,
      },
      {
        title: "Post three",
        href: "https://www.builder.io/blog/three",
        published: daysAgo(80),
        // The 4 from before publication count toward the total, not week 1.
        first_week: 5,
        signups: 175,
      },
    ]);
    // Post one has 2 signups across both windows, under the 10 a change needs.
    // Recent is the 28 days through yesterday and previous the 28 before it:
    // today's partial day and the day before the earlier window stay out.
    expect(await runPanel("rising")).toEqual([
      {
        title: "Post three",
        href: "https://www.builder.io/blog/three",
        recent: 11,
        previous: 5,
        change: 120,
      },
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });
});
