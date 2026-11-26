import { createRequire } from "node:module";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

import { planPanelRender } from "@agent-native/toolkit/dashboard/panel-render-contract";

import { interpolateDashboardPanelSql } from "../../../app/pages/adhoc/sql-dashboard/interpolate";
import { getDashboardCatalogEntry } from "../dashboard-catalog";
import { queryFirstPartyAnalytics } from "../first-party-analytics";
import { resetPublicSchema } from "../testing/pglite-reset";
import {
  CONTENT_METRICS_MIGRATION_SQL,
  CONTENT_SEARCH_QUERIES_MIGRATION_SQL,
} from "./migration";

const ALICE = { userEmail: "alice@example.test", orgId: "org_a" };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function xMonth(): string {
  return new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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

  beforeAll(async () => {
    client = await PGlite.create("memory://");
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    bigQuery.query.mockReset();
    await resetPublicSchema(client);
    database.client = client;
    await client.exec(`
      ${CONTENT_METRICS_MIGRATION_SQL.join(";\n")};
      ${CONTENT_SEARCH_QUERIES_MIGRATION_SQL.join(";\n")};
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
        ('s8', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(3)}', 'signups_first_touch_source', 1, 'signups', 'r5', '${daysAgo(1)}'),
        ('s14', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(3)}', 'agent_native_signups', 4, 'agent_native_signups', 'r6', '${daysAgo(1)}'),
        ('s15', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(3)}', 'daily_dev_sessions', 3, 'daily_dev', 'r8', '${daysAgo(1)}');
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, window_end, error_code, error_message) VALUES
        ('r1', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:00.000Z', NULL, NULL, NULL),
        ('r2', 'org:org_a', 'alice@example.test', 'org_a', 'ga4', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:01.000Z', '${daysAgo(2)}', NULL, NULL),
        ('r3', 'org:org_a', 'alice@example.test', 'org_a', 'search_console', 'scheduled', 'succeeded', '${daysAgo(2)}T07:00:02.000Z', '${daysAgo(4)}', NULL, NULL),
        ('r4', 'org:org_a', 'alice@example.test', 'org_a', 'search_console', 'scheduled', 'not_configured', '${daysAgo(1)}T07:00:02.000Z', NULL, 'search_console_no_access', 'Search Console denied access to sc-domain:example.test.'),
        ('r5', 'org:org_a', 'alice@example.test', 'org_a', 'signups', 'scheduled', 'cost_limited', '${daysAgo(1)}T07:00:03.000Z', NULL, 'signups_bytes_cap', 'The signups join would scan 5000 bytes, over the 1000-byte cap. Nothing ran.'),
        ('r6', 'org:org_a', 'alice@example.test', 'org_a', 'agent_native_signups', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:04.000Z', '${daysAgo(2)}', NULL, NULL),
        ('r8', 'org:org_a', 'alice@example.test', 'org_a', 'daily_dev', 'scheduled', 'succeeded', '${daysAgo(1)}T07:00:05.000Z', '${daysAgo(2)}', NULL, NULL),
        ('rb', 'org:org_b', 'carol@example.test', 'org_b', 'ga4', 'scheduled', 'failed', '${daysAgo(1)}T07:00:00.000Z', NULL, 'step_failed', 'boom');
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, window_end)
      SELECT 'r7', 'org:org_a', 'alice@example.test', 'org_a', 'search_console_queries', 'scheduled', 'succeeded', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD') || 'T07:00:03.000Z', to_char(CURRENT_DATE - 8, 'YYYY-MM-DD');
    `);
  });

  async function weekStart(weeksAgo: number): Promise<string> {
    const { rows } = (await client.query(
      "SELECT to_char(date_trunc('week', CURRENT_DATE::timestamp)::date - 7 * $1::int, 'YYYY-MM-DD') AS day",
      [weeksAgo],
    )) as { rows: Array<{ day: string }> };
    const [row = { day: "" }] = rows;
    return row.day;
  }

  async function monthLabel(monthsAgo: number): Promise<string> {
    const { rows } = (await client.query(
      "SELECT to_char(date_trunc('month', CURRENT_DATE::timestamp) - make_interval(months => $1::int), 'Mon ''YY') AS month",
      [monthsAgo],
    )) as { rows: Array<{ month: string }> };
    const [row = { month: "" }] = rows;
    return row.month;
  }

  async function insertQueries(): Promise<void> {
    await client.exec(`
      INSERT INTO analytics_content_search_queries (id, tenant_key, owner_email, org_id, item_id, week_start, query, clicks, impressions, position_weighted, run_id, collected_at)
      SELECT rows.item_id || rows.weeks_ago || rows.query, items.tenant_key, items.owner_email, items.org_id, rows.item_id, to_char(date_trunc('week', CURRENT_DATE::timestamp)::date - 7 * rows.weeks_ago, 'YYYY-MM-DD'), rows.query, rows.clicks, rows.impressions, rows.impressions * rows.position, 'r7', '2026-09-01'
      FROM (VALUES
        ('a1', 1, 'headless cms', 6, 200, 3),
        ('a1', 2, 'headless cms', 4, 200, 5),
        ('a1', 10, 'old query', 50, 100, 1.5),
        ('a2', 1, 'visual cms', 1, 300, 12),
        ('p1', 1, 'docs query', 70, 700, 2),
        ('b1', 1, 'other org query', 99, 999, 1)
      ) AS rows (item_id, weeks_ago, query, clicks, impressions, position)
      JOIN analytics_content_items items ON items.id = rows.item_id;
    `);
  }

  // The database clock, not the test runner's UTC date: near midnight the two
  // name different days.
  async function yesterday(format: string): Promise<string> {
    const { rows } = (await client.query(
      `SELECT to_char(CURRENT_DATE - 1, '${format}') AS day`,
    )) as { rows: Array<{ day: string }> };
    return rows[0]!.day;
  }

  async function lastWeek(): Promise<string> {
    const end = new Date(`${await yesterday("YYYY-MM-DD")}T00:00:00Z`);
    const start = new Date(end.getTime() - 6 * 86_400_000);
    const format = (date: Date, month: boolean) =>
      date.toLocaleDateString("en-US", {
        ...(month ? { month: "short" } : {}),
        day: "numeric",
        timeZone: "UTC",
      });
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    return `${format(start, true)}–${format(end, !sameMonth)}`;
  }

  afterEach(async () => {
    database.client = null;
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
              "weeks",
              "windows",
              "newest",
              "per_query",
              "recent",
              "reads",
              "gains",
              "ranked",
              "per_video",
              "per_post",
              "posts",
              "channels",
              "named",
              "latest",
              "covered",
              "x_month",
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
        source: "daily.dev visits",
        status: "Collected",
        first_data: daysAgo(3),
        data_through: daysAgo(2),
      }),
      expect.objectContaining({
        source: "Search Console",
        status: "Not set up",
        data_through: daysAgo(4),
        detail: "Search Console denied access to sc-domain:example.test.",
      }),
      expect.objectContaining({
        source: "Search queries",
        status: "Collected",
        first_data: null,
        detail:
          "Each article's top queries per week, Monday to Sunday, once Search Console has the whole week. History fills back a few weeks a run.",
      }),
      expect.objectContaining({
        source: "Builder signups",
        status: "Cost-limited",
      }),
      expect.objectContaining({
        source: "Agent-Native signups",
        status: "Collected",
        first_data: daysAgo(3),
        data_through: daysAgo(2),
      }),
      expect.objectContaining({
        source: "YouTube videos",
        status: "No run in 30 days",
        last_run: null,
        first_data: null,
      }),
      expect.objectContaining({
        source: "X posts",
        status: "No run in 30 days",
        last_run: null,
        first_data: null,
      }),
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
      expect.objectContaining({ source: "daily.dev visits" }),
      expect.objectContaining({ source: "Search Console" }),
      expect.objectContaining({ source: "Search queries" }),
      expect.objectContaining({ source: "Builder signups" }),
      expect.objectContaining({ source: "Agent-Native signups" }),
      expect.objectContaining({ source: "YouTube videos" }),
      expect.objectContaining({ source: "X posts" }),
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
        message: `**Builder signups stopped at the cost cap** on the ${runDay(1)} run.`,
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
      [
        "Articles",
        "Pageviews",
        "daily.dev visits",
        "Search clicks and impressions",
        "Search queries",
        "Builder signups",
        "Agent-Native signups",
      ].map((label) => ({
        severity: "warning",
        message: `**${label} haven't been collected in the last 30 days**.`,
      })),
    );
  });

  it("dates each source's first data and explains a source with no error", async () => {
    const rows = await runPanel("collection-status");
    expect(rows.find((row) => row.source === "GA4 pageviews")).toEqual(
      expect.objectContaining({
        first_data: daysAgo(40),
        detail: "Daily pageviews per article, as GA4 counts them.",
      }),
    );
    expect(rows.find((row) => row.source === "Blog articles")).toEqual(
      expect.objectContaining({
        first_data: "2026-09-01",
        detail: "Titles, authors and publish dates.",
      }),
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
        agent_native_signups: 4,
        pageviews: 5,
        daily_dev_visits: 3,
        clicks: null,
        impressions: null,
        position: null,
      },
      {
        title: "Post two",
        href: "https://www.builder.io/blog/two",
        author: "Grace",
        published: daysAgo(0),
        signups: null,
        agent_native_signups: null,
        pageviews: null,
        daily_dev_visits: 0,
        clicks: null,
        impressions: null,
        position: null,
      },
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("leaves daily.dev blank before the step has collected, and names it waiting for GA4", async () => {
    await client.exec(
      "UPDATE analytics_content_collection_runs SET status = 'not_configured', window_end = NULL WHERE id = 'r8'",
    );
    expect(
      (await runPanel("articles")).map((row) => row.daily_dev_visits),
    ).toEqual([null, null]);
    expect(await runPanel("missing-data")).toEqual([
      {
        severity: "warning",
        message:
          "**daily.dev visits aren't connected yet**: waiting for a GA4 property.",
      },
      expect.objectContaining({ severity: "warning" }),
      expect.objectContaining({ severity: "critical" }),
    ]);
  });

  async function insertVideos(): Promise<void> {
    await client.exec(`
      INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, url, title, author, published_at, metadata, first_seen_at, updated_at) VALUES
        ('y1', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'y1', 'https://www.youtube.com/watch?v=y1', 'Old Builder video', 'Builder', '2026-09-01T12:00:00Z', '{"channelId":"UCbuilder","durationSeconds":813}', '2026-09-01', '${daysAgo(0)}T07:00:06.000Z'),
        ('y2', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'y2', 'https://www.youtube.com/watch?v=y2', 'New Builder video', 'Builder', '${daysAgo(1)}T15:00:00Z', '{"channelId":"UCbuilder","durationSeconds":3723}', '2026-09-01', '${daysAgo(0)}T07:00:06.000Z'),
        ('y3', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'y3', 'https://www.youtube.com/watch?v=y3', 'Codevolution video', 'Codevolution', '2026-09-01T12:00:00Z', '{"channelId":"UCcodevolution","durationSeconds":null}', '2026-09-01', '${daysAgo(0)}T07:00:06.000Z'),
        ('y4', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'y4', 'https://www.youtube.com/watch?v=y4', 'Other Builder channel video', 'Builder', '${daysAgo(2)}T12:00:00Z', '{"channelId":"UCotherbuilder","durationSeconds":60}', '2026-09-01', '${daysAgo(0)}T07:00:06.000Z'),
        ('y6', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'y6', 'https://www.youtube.com/watch?v=y6', 'Deleted Builder video', 'Builder', '2026-09-01T12:00:00Z', '{"channelId":"UCbuilder","durationSeconds":45}', '2026-09-01', '${daysAgo(1)}T07:00:06.000Z'),
        ('y5', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'y5', 'https://www.youtube.com/watch?v=y5', 'Removed channel video', 'Old channel', '2026-09-01T12:00:00Z', '{"channelId":"UCremoved","durationSeconds":30}', '2026-09-01', '${daysAgo(0)}T06:00:00.000Z'),
        ('yb', 'org:org_b', 'carol@example.test', 'org_b', 'youtube', 'yb', 'https://www.youtube.com/watch?v=yb', 'Other org video', 'Builder', '2026-09-01T12:00:00Z', '{"channelId":"UCbuilder","durationSeconds":60}', '2026-09-01', '${daysAgo(0)}T07:00:06.000Z');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT reads.item_id || reads.metric || reads.days_ago, items.tenant_key, items.owner_email, items.org_id, reads.item_id, to_char(CURRENT_DATE - reads.days_ago, 'YYYY-MM-DD'), reads.metric, reads.value, 'youtube', 'ry', '2026-09-01'
      FROM (VALUES
        ('y1', 'youtube_views', 3, 100),
        ('y1', 'youtube_views', 2, 110),
        ('y1', 'youtube_views', 1, 125),
        ('y1', 'youtube_views', 0, 130),
        ('y1', 'youtube_likes', 0, 9),
        ('y1', 'youtube_comments', 1, 1),
        ('y2', 'youtube_views', 0, 50),
        ('y3', 'youtube_views', 2, 1000),
        ('y3', 'youtube_views', 1, 1007),
        ('y3', 'youtube_views', 0, 1010),
        ('y5', 'youtube_views', 1, 10),
        ('y5', 'youtube_views', 0, 20),
        ('y6', 'youtube_views', 2, 500),
        ('y6', 'youtube_views', 1, 520),
        ('y4', 'youtube_views', 1, 400),
        ('y4', 'youtube_views', 0, 404),
        ('yb', 'youtube_views', 3, 5000),
        ('yb', 'youtube_views', 0, 9000)
      ) AS reads (item_id, metric, days_ago, value)
      JOIN analytics_content_items items ON items.id = reads.item_id;
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, window_end)
      VALUES ('ry', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'scheduled', 'succeeded', '${daysAgo(0)}T07:00:00.000Z', '${daysAgo(0)}');
    `);
  }

  it("draws views each channel gained per day, from one day's read to the next, counting a new video from 0", async () => {
    await insertVideos();
    expect(await runPanel("youtube-views-per-day")).toEqual([
      { date: daysAgo(3), channel: "Builder (UCbuilder)", views: 10 },
      { date: daysAgo(2), channel: "Builder (UCbuilder)", views: 35 },
      { date: daysAgo(2), channel: "Codevolution", views: 7 },
      { date: daysAgo(1), channel: "Builder (UCbuilder)", views: 55 },
      { date: daysAgo(1), channel: "Builder (UCotherbuilder)", views: 4 },
      { date: daysAgo(1), channel: "Codevolution", views: 3 },
    ]);
    expect(await runPanel("youtube-views-per-day", "7d")).toHaveLength(6);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("draws only the days a read covered, so a day without one has no bar rather than a zero", async () => {
    await insertVideos();
    const panel = contentView().panels.find(
      (candidate) => candidate.id === "youtube-views-per-day",
    );
    if (!panel) throw new Error("no YouTube views panel");
    const plan = planPanelRender(await runPanel(panel.id, "7d"), panel, {
      timeRange: 7,
    });
    expect(plan.rows.map((row) => row.date)).toEqual([
      daysAgo(3),
      daysAgo(2),
      daysAgo(1),
    ]);
  });

  it("lists videos by views gained in the time range, with their counts to date", async () => {
    await insertVideos();
    expect(await runPanel("youtube-videos")).toEqual([
      {
        title: "New Builder video",
        href: "https://www.youtube.com/watch?v=y2",
        channel: "Builder",
        published: daysAgo(1),
        length: "1:02:03",
        views_gained: 50,
        views: 50,
        likes: null,
        comments: null,
      },
      {
        title: "Old Builder video",
        href: "https://www.youtube.com/watch?v=y1",
        channel: "Builder",
        published: "2026-09-01",
        length: "13:33",
        views_gained: 30,
        views: 130,
        likes: 9,
        comments: null,
      },
      {
        title: "Codevolution video",
        href: "https://www.youtube.com/watch?v=y3",
        channel: "Codevolution",
        published: "2026-09-01",
        length: null,
        views_gained: 10,
        views: 1010,
        likes: null,
        comments: null,
      },
      {
        title: "Other Builder channel video",
        href: "https://www.youtube.com/watch?v=y4",
        channel: "Builder",
        published: daysAgo(2),
        length: "1:00",
        views_gained: 4,
        views: 404,
        likes: null,
        comments: null,
      },
    ]);
    expect(
      (await runPanel("youtube-videos", "7d")).find(
        (row) => row.title === "Old Builder video",
      )?.views_gained,
    ).toBe(30);
  });

  it("shows no YouTube videos once the newest read returned none", async () => {
    await insertVideos();
    await client.exec(
      `INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, window_end) VALUES ('ry2', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'manual', 'succeeded', '${daysAgo(0)}T09:00:00.000Z', '${daysAgo(0)}')`,
    );
    expect(await runPanel("youtube-views-per-day")).toEqual([]);
    expect(await runPanel("youtube-videos")).toEqual([]);
  });

  it("names YouTube in the notice once it has run and failed", async () => {
    await client.exec(`
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, error_code, error_message)
      VALUES ('ry', 'org:org_a', 'alice@example.test', 'org_a', 'youtube', 'scheduled', 'not_configured', '${daysAgo(1)}T07:00:06.000Z', 'youtube_api_key_missing', 'No YouTube Data API key is saved.');
    `);
    const notices = await runPanel("missing-data");
    expect(notices[notices.length - 1]).toEqual({
      severity: "warning",
      message:
        "**YouTube views aren't connected yet**: waiting for channels and a YouTube Data API key.",
    });
    expect(
      (await runPanel("collection-status")).find(
        (row) => row.source === "YouTube videos",
      ),
    ).toEqual(
      expect.objectContaining({
        status: "Not set up",
        detail: "No YouTube Data API key is saved.",
      }),
    );
  });

  async function insertXPosts(): Promise<void> {
    const readAt = `${daysAgo(0)}T07:00:07.000Z`;
    const savedAt = `${daysAgo(0)}T07:00:09.000Z`;
    await client.exec(`
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at)
      VALUES
        ('rxa', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'scheduled', 'succeeded', '${readAt}'),
        ('rxb', 'org:org_b', 'carol@example.test', 'org_b', 'x', 'scheduled', 'succeeded', '${readAt}');
      INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, url, title, author, published_at, relevance, metadata, first_seen_at, updated_at) VALUES
        ('xa1', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'account:1', 'https://x.com/builderio', '@builderio', '@builderio', NULL, 'account', '{"authorId":"1"}', '2026-09-01', '${savedAt}'),
        ('xa2', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'account:2', 'https://x.com/Steve8708', '@Steve8708', '@Steve8708', NULL, 'account', '{"authorId":"2"}', '2026-09-01', '${savedAt}'),
        ('xab', 'org:org_b', 'carol@example.test', 'org_b', 'x', 'account:1', 'https://x.com/builderio', '@builderio', '@builderio', NULL, 'account', '{"authorId":"1"}', '2026-09-01', '${savedAt}'),
        ('x1', 'org:org_a', 'alice@example.test', 'org_a', 'x', '1001', 'https://x.com/builderio/status/1001', 'Fusion is out builder.io/blog/fusion', '@builderio', '${daysAgo(10)}T03:00:00.000Z', 'counted', '{"authorId":"1"}', '2026-09-01', '2026-09-01'),
        ('x2', 'org:org_a', 'alice@example.test', 'org_a', 'x', '2001', 'https://x.com/Steve8708/status/2001', 'Built with Agent-Native', '@Steve8708', '${daysAgo(2)}T03:00:00.000Z', 'counted', '{"authorId":"2"}', '2026-09-01', '2026-09-01'),
        ('x3', 'org:org_a', 'alice@example.test', 'org_a', 'x', '2002', 'https://x.com/Steve8708/status/2002', 'Every builder should read this', '@Steve8708', '${daysAgo(2)}T03:00:00.000Z', 'not_counted', '{"authorId":"2"}', '2026-09-01', '2026-09-01'),
        ('x4', 'org:org_a', 'alice@example.test', 'org_a', 'x', '1000', 'https://x.com/builderio/status/1000', NULL, '@builderio', '${daysAgo(40)}T03:00:00.000Z', 'counted', '{"authorId":"1"}', '2026-09-01', '2026-09-01'),
        ('xb', 'org:org_b', 'carol@example.test', 'org_b', 'x', '1001', 'https://x.com/builderio/status/1001', 'Other org post', '@builderio', '${daysAgo(10)}T03:00:00.000Z', 'counted', '{"authorId":"1"}', '2026-09-01', '2026-09-01');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT reads.item_id || reads.metric || reads.days_ago, items.tenant_key, items.owner_email, items.org_id, reads.item_id, to_char(CURRENT_DATE - reads.days_ago, 'YYYY-MM-DD'), reads.metric, reads.value, 'x', 'rx', '2026-09-01'
      FROM (VALUES
        ('x1', 'x_age_hours', 10, 5),
        ('x1', 'x_views', 10, 100),
        ('x1', 'x_age_hours', 9, 29),
        ('x1', 'x_views', 9, 200),
        ('x1', 'x_age_hours', 7, 77),
        ('x1', 'x_views', 7, 300),
        ('x1', 'x_age_hours', 3, 173),
        ('x1', 'x_views', 3, 400),
        ('x1', 'x_likes', 3, 40),
        ('x1', 'x_reposts', 3, 4),
        ('x1', 'x_replies', 3, 2),
        ('x2', 'x_age_hours', 1, 29),
        ('x2', 'x_views', 1, 50),
        ('x2', 'x_likes', 1, 5),
        ('x3', 'x_age_hours', 1, 29),
        ('x3', 'x_views', 1, 999),
        ('x4', 'x_age_hours', 10, 725),
        ('x4', 'x_views', 10, 7000),
        ('xb', 'x_age_hours', 9, 29),
        ('xb', 'x_views', 9, 5000)
      ) AS reads (item_id, metric, days_ago, value)
      JOIN analytics_content_items items ON items.id = reads.item_id;
    `);
  }

  it("lists the posts that count, posted in the time range, with their latest counts and views at each age", async () => {
    await insertXPosts();
    expect(await runPanel("x-posts")).toEqual([
      {
        post: "Fusion is out builder.io/blog/fusion",
        href: "https://x.com/builderio/status/1001",
        account: "@builderio",
        posted: daysAgo(10),
        views: 400,
        likes: 40,
        reposts: 4,
        replies: 2,
        views_1d: 200,
        views_3d: 300,
        views_7d: 400,
        views_30d: null,
      },
      {
        post: "Built with Agent-Native",
        href: "https://x.com/Steve8708/status/2001",
        account: "@Steve8708",
        posted: daysAgo(2),
        views: 50,
        likes: 5,
        reposts: null,
        replies: null,
        views_1d: 50,
        views_3d: null,
        views_7d: null,
        views_30d: null,
      },
    ]);
    expect((await runPanel("x-posts", "7d")).map((row) => row.account)).toEqual(
      ["@Steve8708"],
    );
    expect((await runPanel("x-posts", "all")).map((row) => row.post)).toEqual([
      "Post with no text",
      "Fusion is out builder.io/blog/fusion",
      "Built with Agent-Native",
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("stacks the latest views of the posts that count by account on the day they were posted", async () => {
    await insertXPosts();
    const rows = await runPanel("x-views-by-day");
    expect(rows).toEqual([
      { date: daysAgo(10), account: "@builderio", views: 400 },
      { date: daysAgo(2), account: "@Steve8708", views: 50 },
    ]);
    const panel = contentView().panels.find(
      (candidate) => candidate.id === "x-views-by-day",
    );
    if (!panel) throw new Error("no X views panel");
    expect(planPanelRender(rows, panel, { timeRange: 28 }).rows).toEqual([
      { date: daysAgo(10), "@builderio": 400, "@Steve8708": 0 },
      { date: daysAgo(2), "@builderio": 0, "@Steve8708": 50 },
    ]);
  });

  it("shows only the accounts the newest successful read covered", async () => {
    await insertXPosts();
    await client.exec(`
      UPDATE analytics_content_items SET updated_at = '${daysAgo(0)}T07:00:05.000Z' WHERE id = 'xa2';
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at)
      VALUES ('rxf', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'scheduled', 'failed', '${daysAgo(0)}T08:00:00.000Z');
    `);
    expect((await runPanel("x-posts")).map((row) => row.account)).toEqual([
      "@builderio",
    ]);
    expect(await runPanel("x-views-by-day")).toEqual([
      { date: daysAgo(10), account: "@builderio", views: 400 },
    ]);
  });

  it("leaves X out of the notice until it runs, then names what X is waiting for or the cost cap", async () => {
    await client.exec(
      "UPDATE analytics_content_collection_runs SET status = 'succeeded' WHERE id IN ('r4', 'r5')",
    );
    expect(await runPanel("missing-data")).toEqual([
      {
        severity: "info",
        message: "Nothing is missing: every source collected on its last run.",
      },
    ]);

    for (const [errorCode, message] of [
      [
        "x_bearer_token_missing",
        "**X posts aren't connected yet**: waiting for an X API Bearer token under Data Sources.",
      ],
      [
        "x_accounts_not_configured",
        "**X posts aren't connected yet**: waiting for X accounts to collect.",
      ],
      [
        "x_counting_rule_not_configured",
        "**X posts aren't connected yet**: no post can count yet. Mark an account to count all its posts, or name links or terms.",
      ],
    ]) {
      await client.exec(`
        DELETE FROM analytics_content_collection_runs WHERE step = 'x';
        INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, error_code, error_message)
        VALUES ('rx', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'scheduled', 'not_configured', '${daysAgo(1)}T07:00:07.000Z', '${errorCode}', 'Not set up.');
      `);
      expect(await runPanel("missing-data")).toEqual([
        { severity: "warning", message },
      ]);
    }

    await client.exec(`
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, error_code, error_message, cost_usd, detail)
      VALUES ('rx2', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'scheduled', 'cost_limited', '${daysAgo(0)}T07:00:07.000Z', 'x_monthly_cap', 'Stopped before the $25.00 monthly X cap: $25.00 spent in ${xMonth()} (UTC), $0.70 of it in this run.', 0.7, 'Read 136 posts and 2 accounts ($0.70).');
    `);
    expect(await runPanel("missing-data")).toEqual([
      {
        severity: "critical",
        message: `**X posts stopped at the cost cap** on the ${runDay(0)} run.`,
      },
    ]);
    expect(
      (await runPanel("collection-status")).find(
        (row) => row.source === "X posts",
      ),
    ).toEqual(
      expect.objectContaining({
        status: "Cost-limited",
        detail: `$0.70 of the $25 cap spent in ${xMonth()} (UTC). Stopped before the $25.00 monthly X cap: $25.00 spent in ${xMonth()} (UTC), $0.70 of it in this run. Read 136 posts and 2 accounts ($0.70).`,
      }),
    );
  });

  it("shows the latest X run's reads and projection in Sources, after what every X run this UTC month spent", async () => {
    await client.exec(`
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, window_end, cost_usd, detail, error_code)
      VALUES
        ('rx0', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'scheduled', 'succeeded', '2020-01-15T07:00:07.000Z', '2020-01-15', 3, 'An old month.', NULL),
        ('rx1', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'manual', 'failed', '${daysAgo(0)}T06:00:07.000Z', NULL, 0.5, NULL, 'x_request_failed'),
        ('rx', 'org:org_a', 'alice@example.test', 'org_a', 'x', 'scheduled', 'succeeded', '${daysAgo(0)}T07:00:07.000Z', '${daysAgo(0)}', 0.04, 'Read 4 posts and 2 accounts ($0.04): 3 of 4 new posts counted, 0 re-reads. ${xMonth()} (UTC): $0.54 of the $25.00 cap; month-end projection $0.56.', NULL);
    `);
    const rows = await runPanel("collection-status");
    expect(rows[rows.length - 1]).toEqual(
      expect.objectContaining({
        source: "X posts",
        status: "Collected",
        data_through: daysAgo(0),
        detail: `$0.54 of the $25 cap spent in ${xMonth()} (UTC). Read 4 posts and 2 accounts ($0.04): 3 of 4 new posts counted, 0 re-reads. ${xMonth()} (UTC): $0.54 of the $25.00 cap; month-end projection $0.56.`,
      }),
    );
  });

  it("counts an article's search clicks and impressions, not other pages in search", async () => {
    await client.exec(`
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at) VALUES
        ('c1', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(4)}', 'search_console_clicks', 3, 'search_console', 'r3', '${daysAgo(2)}'),
        ('c2', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(4)}', 'search_console_impressions', 40, 'search_console', 'r3', '${daysAgo(2)}'),
        ('c4', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(5)}', 'search_console_impressions', 60, 'search_console', 'r3', '${daysAgo(2)}');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'c3', 'org:org_a', 'alice@example.test', 'org_a', 'a1', metric_date, 'search_console_position_weighted', 132, 'search_console', 'r3', '2026-09-01'
      FROM analytics_content_metric_snapshots WHERE id = 'c1';
    `);
    expect(
      (await runPanel("articles")).find((row) => row.title === "Post one"),
    ).toEqual(
      expect.objectContaining({
        pageviews: 5,
        clicks: 3,
        impressions: 100,
        position: 3.3,
      }),
    );

    // Search Console reports two to three days late, so its newest days stay
    // blank instead of reading as zero clicks.
    const days = await runPanel("pageviews-per-day");
    expect(days).toHaveLength(28);
    expect(days[days.length - 1]).toEqual({
      date: await yesterday("YYYY-MM-DD"),
      pageviews: null,
      search_clicks: null,
    });
    expect(
      days.filter(
        (row) => row.pageviews !== null || row.search_clicks !== null,
      ),
    ).toEqual([
      { date: daysAgo(4), pageviews: null, search_clicks: 3 },
      { date: daysAgo(3), pageviews: 5, search_clicks: null },
      { date: daysAgo(2), pageviews: 0, search_clicks: null },
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("rejects a custom date scaffold wider than the supported range", () => {
    for (const id of [
      "signups-per-day",
      "agent-native-signups-per-day",
      "pageviews-per-day",
    ]) {
      const panel = contentView().panels.find((panel) => panel.id === id)!;
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
    }
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

  it("draws Agent-Native signups on their own chart, by signup day", async () => {
    const days = await runPanel("agent-native-signups-per-day");
    expect(days).toHaveLength(28);
    expect(days.filter((row) => row.signups !== null)).toEqual([
      { date: daysAgo(3), signups: 4 },
    ]);
    expect(
      (await runPanel("signups-per-day")).find((row) => row.date === daysAgo(3))
        ?.signups,
    ).toBe(2);
  });

  it("keeps the time range and the organization in every panel", async () => {
    await client.exec(`
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at) VALUES
        ('s9', 'org:org_a', 'alice@example.test', 'org_a', 'a1', '${daysAgo(40)}', 'signups_first_touch', 10, 'signups', 'r0', '${daysAgo(39)}'),
        ('s10', 'org:org_b', 'carol@example.test', 'org_b', 'b1', '${daysAgo(3)}', 'signups_first_touch', 50, 'signups', 'rb', '${daysAgo(1)}');
    `);
    const all = await runPanel("articles", "all");
    expect(all.find((row) => row.title === "Post one")?.signups).toBe(12);
    expect(all.find((row) => row.title === "Post one")?.pageviews).toBe(105);
    expect(all.some((row) => row.title === "Other org post")).toBe(false);
    expect(
      (await runPanel("pageviews-per-day", "all")).find(
        (row) => row.date === daysAgo(3),
      )?.pageviews,
    ).toBe(5);

    expect(await runPanel("signups-by-author")).toEqual([
      { author: "Ada", signups: 2 },
    ]);
    expect(await runPanel("authors")).toEqual([
      {
        author: "Ada",
        articles: 1,
        with_signups: 1,
        signups: 2,
        agent_native_signups: 4,
      },
      {
        author: "Grace",
        articles: 1,
        with_signups: 0,
        signups: null,
        agent_native_signups: null,
      },
    ]);
    const weeks = await runPanel("author-weeks");
    expect(weeks).toEqual([
      { author: "Ada", week: await lastWeek(), signups: 2 },
    ]);
    const weekly = contentView().panels.find(
      (panel) => panel.id === "author-weeks",
    );
    if (!weekly) throw new Error("no author-weeks panel");
    expect(planPanelRender(weeks, weekly, { timeRange: 28 }).rows).toEqual([
      { week: await lastWeek(), Ada: 2 },
    ]);
    expect((await runPanel("author-articles")).map((row) => row.title)).toEqual(
      ["Post one", "Post two"],
    );
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("counts the same full days in every Articles and Authors panel", async () => {
    await client.exec(`
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'day' || days_ago, 'org:org_a', 'alice@example.test', 'org_a', 'a1', to_char(CURRENT_DATE - days_ago, 'YYYY-MM-DD'), 'signups_first_touch', value, 'signups', 'r0', '2026-09-01'
      FROM (VALUES (8, 50), (7, 3), (0, 100)) AS days (days_ago, value);
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'view' || days_ago, 'org:org_a', 'alice@example.test', 'org_a', 'a1', to_char(CURRENT_DATE - days_ago, 'YYYY-MM-DD'), 'ga4_pageviews', value, 'ga4', 'r0', '2026-09-01'
      FROM (VALUES (8, 50), (7, 3), (0, 100)) AS days (days_ago, value);
    `);
    // Last 7 days is the seven days through yesterday: the 3 from seven days
    // ago and the 2 from three days ago, not the day before or today. Pageviews
    // add the 3 to the 5 and 0 already collected three and two days ago.
    const days = await runPanel("signups-per-day", "7d");
    expect(days).toHaveLength(7);
    expect(days.reduce((sum, row) => sum + Number(row.signups ?? 0), 0)).toBe(
      5,
    );
    const traffic = await runPanel("pageviews-per-day", "7d");
    expect(traffic).toHaveLength(7);
    expect(
      traffic.reduce((sum, row) => sum + Number(row.pageviews ?? 0), 0),
    ).toBe(8);
    const article = (await runPanel("articles", "7d")).find(
      (row) => row.title === "Post one",
    );
    expect(article?.signups).toBe(5);
    expect(article?.pageviews).toBe(8);
    expect(await runPanel("signups-by-author", "7d")).toEqual([
      { author: "Ada", signups: 5 },
    ]);
    expect(
      (await runPanel("authors", "7d")).find((row) => row.author === "Ada")
        ?.signups,
    ).toBe(5);
    expect(await runPanel("author-weeks", "7d")).toEqual([
      { author: "Ada", week: await lastWeek(), signups: 5 },
    ]);
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
    const week = await lastWeek();
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
        // The 4 from before publication count toward the total, not week 1,
        // and today's partial 100 toward neither.
        first_week: 5,
        signups: 75,
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

  it("lists the biggest drops with the biggest rises", async () => {
    await client.exec(`
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'move' || item_id || days_ago, 'org:org_a', 'alice@example.test', 'org_a', item_id, to_char(CURRENT_DATE - days_ago, 'YYYY-MM-DD'), 'signups_first_touch', value, 'signups', 'r0', '2026-09-01'
      FROM (VALUES ('a1', 40, 60), ('a1', 10, 20), ('a2', 40, 5), ('a2', 10, 17)) AS moves (item_id, days_ago, value);
    `);
    expect(
      (await runPanel("rising")).map(({ title, recent, previous }) => ({
        title,
        recent,
        previous,
      })),
    ).toEqual([
      { title: "Post one", recent: 22, previous: 60 },
      { title: "Post two", recent: 17, previous: 5 },
    ]);
  });

  it("lists each article's search queries in the weeks the time range touches, from this organization's articles only", async () => {
    await insertQueries();
    expect(await runPanel("search-queries")).toEqual([
      {
        query: "headless cms",
        title: "Post one",
        href: "https://www.builder.io/blog/one",
        impressions: 400,
        clicks: 10,
        click_rate: 0.025,
        position: 4,
      },
      {
        query: "visual cms",
        title: "Post two",
        href: "https://www.builder.io/blog/two",
        impressions: 300,
        clicks: 1,
        click_rate: 0.0033,
        position: 12,
      },
    ]);
    expect((await runPanel("search-queries", "all"))[0]).toEqual({
      query: "old query",
      title: "Post one",
      href: "https://www.builder.io/blog/one",
      impressions: 100,
      clicks: 50,
      click_rate: 0.5,
      position: 1.5,
    });
    expect(
      (await runPanel("collection-status")).find(
        (row) => row.source === "Search queries",
      ),
    ).toEqual(expect.objectContaining({ first_data: await weekStart(10) }));
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("reaches back to the newest collected week when Search Console's lag leaves the 7-day range without one", async () => {
    await client.exec(`
      INSERT INTO analytics_content_search_queries (id, tenant_key, owner_email, org_id, item_id, week_start, query, clicks, impressions, position_weighted, run_id, collected_at)
      SELECT rows.item_id || rows.weeks_ago, items.tenant_key, items.owner_email, items.org_id, rows.item_id, to_char(date_trunc('week', CURRENT_DATE::timestamp)::date - 7 * rows.weeks_ago, 'YYYY-MM-DD'), rows.query, rows.clicks, rows.impressions, rows.impressions * rows.position, 'r7', '2026-09-01'
      FROM (VALUES
        ('a1', 2, 'lagged query', 3, 60, 4),
        ('a1', 3, 'older query', 5, 80, 6)
      ) AS rows (item_id, weeks_ago, query, clicks, impressions, position)
      JOIN analytics_content_items items ON items.id = rows.item_id;
    `);
    expect(await runPanel("search-queries", "7d")).toEqual([
      {
        query: "lagged query",
        title: "Post one",
        href: "https://www.builder.io/blog/one",
        impressions: 60,
        clicks: 3,
        click_rate: 0.05,
        position: 4,
      },
    ]);
    const month = await runPanel("search-queries", "28d");
    expect(month.map((row) => row.query)).toEqual([
      "older query",
      "lagged query",
    ]);
  });

  it("shows a queries run's note and says when the queries step waits for Search Console access", async () => {
    await client.exec(
      "UPDATE analytics_content_collection_runs SET detail = 'Waiting for the page numbers to reach this week.' WHERE id = 'r7'",
    );
    expect(
      (await runPanel("collection-status")).find(
        (row) => row.source === "Search queries",
      )?.detail,
    ).toBe("Waiting for the page numbers to reach this week.");

    await client.exec(
      "UPDATE analytics_content_collection_runs SET status = 'not_configured' WHERE id = 'r7'",
    );
    expect(await runPanel("missing-data")).toEqual([
      expect.objectContaining({ severity: "warning" }),
      {
        severity: "warning",
        message:
          "**Search queries aren't connected yet**: waiting for Search Console access.",
      },
      expect.objectContaining({ severity: "critical" }),
    ]);
  });

  it("finds queries near the top of page two and top queries rarely clicked, from the four newest weeks", async () => {
    await client.exec(`
      INSERT INTO analytics_content_search_queries (id, tenant_key, owner_email, org_id, item_id, week_start, query, clicks, impressions, position_weighted, run_id, collected_at)
      SELECT rows.item_id || rows.weeks_ago || rows.query, items.tenant_key, items.owner_email, items.org_id, rows.item_id, to_char(date_trunc('week', CURRENT_DATE::timestamp)::date - 7 * rows.weeks_ago, 'YYYY-MM-DD'), rows.query, rows.clicks, rows.impressions, rows.impressions * rows.position, 'r7', '2026-09-01'
      FROM (VALUES
        ('a1', 1, 'page two', 1, 40, 9),
        ('a1', 4, 'page two', 0, 40, 11),
        ('a1', 1, 'too few', 0, 30, 10),
        ('a1', 1, 'deep', 0, 500, 25),
        ('a1', 5, 'stale', 0, 500, 10),
        ('a2', 2, 'seen not clicked', 1, 200, 3),
        ('a2', 2, 'well clicked', 20, 200, 2),
        ('b1', 1, 'other org', 0, 900, 10)
      ) AS rows (item_id, weeks_ago, query, clicks, impressions, position)
      JOIN analytics_content_items items ON items.id = rows.item_id;
    `);
    expect(await runPanel("near-page-one", "7d")).toEqual([
      {
        query: "page two",
        title: "Post one",
        href: "https://www.builder.io/blog/one",
        impressions: 80,
        clicks: 1,
        click_rate: 0.0125,
        position: 10,
      },
    ]);
    expect(await runPanel("rarely-clicked", "7d")).toEqual([
      {
        query: "seen not clicked",
        title: "Post two",
        href: "https://www.builder.io/blog/two",
        impressions: 200,
        clicks: 1,
        click_rate: 0.005,
        position: 3,
      },
    ]);
  });

  it("totals search clicks by full month and compares the newest 28 days with the same days a year before", async () => {
    await client.exec(`
      UPDATE analytics_content_items SET published_at = '2024-01-01T00:00:00.000Z' WHERE id = 'a1';
      INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, url, title, author, published_at, first_seen_at, updated_at) VALUES
        ('a3', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'a3', 'https://www.builder.io/blog/three', 'Post three', 'Ada', '2024-01-01T00:00:00.000Z', '2026-09-01', '2026-09-01'),
        ('a4', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'a4', 'https://www.builder.io/blog/four', 'Post four', 'Ada', '2024-01-01T00:00:00.000Z', '2026-09-01', '2026-09-01');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'yoy' || item_id || days_ago, 'org:org_a', 'alice@example.test', 'org_a', item_id, to_char(CURRENT_DATE - 3 - days_ago, 'YYYY-MM-DD'), 'search_console_clicks', value, 'search_console', 'r3', '2026-09-01'
      FROM (VALUES
        ('a1', 0, 30), ('a1', 27, 5), ('a1', 28, 1000), ('a1', 364, 10), ('a1', 391, 4), ('a1', 392, 500),
        ('a2', 0, 25),
        ('a3', 1, 5), ('a3', 370, 10),
        ('a4', 2, 10), ('a4', 380, 40)
      ) AS days (item_id, days_ago, value);
    `);
    const yearOverYear = [
      {
        title: "Post four",
        href: "https://www.builder.io/blog/four",
        recent: 10,
        year_before: 40,
        change: -75,
      },
      {
        title: "Post one",
        href: "https://www.builder.io/blog/one",
        recent: 35,
        year_before: 14,
        change: 150,
      },
      {
        title: "Post two",
        href: "https://www.builder.io/blog/two",
        recent: 25,
        year_before: null,
        change: null,
      },
    ];
    expect(await runPanel("search-year-over-year", "7d")).toEqual(yearOverYear);

    await client.exec(
      "UPDATE analytics_content_metric_snapshots SET metric_date = to_char(metric_date::date - 57, 'YYYY-MM-DD') WHERE metric = 'search_console_clicks'",
    );
    expect(await runPanel("search-year-over-year", "7d")).toEqual(yearOverYear);
    await client.exec(
      "UPDATE analytics_content_metric_snapshots SET metric_date = to_char(metric_date::date + 57, 'YYYY-MM-DD') WHERE metric = 'search_console_clicks'",
    );

    await client.exec(
      "DELETE FROM analytics_content_metric_snapshots WHERE metric = 'search_console_clicks' AND metric_date < to_char(CURRENT_DATE - 300, 'YYYY-MM-DD')",
    );
    expect(
      (await runPanel("search-year-over-year", "7d")).map(
        ({ title, year_before }) => ({ title, year_before }),
      ),
    ).toEqual([
      { title: "Post one", year_before: null },
      { title: "Post two", year_before: null },
    ]);

    await client.exec(`
      DELETE FROM analytics_content_metric_snapshots WHERE metric = 'search_console_clicks';
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'month' || item_id || months_ago || day, items.tenant_key, items.owner_email, items.org_id, item_id, to_char((date_trunc('month', CURRENT_DATE::timestamp) - make_interval(months => months_ago))::date + day, 'YYYY-MM-DD'), 'search_console_clicks', value, 'search_console', 'r3', '2026-09-01'
      FROM (VALUES
        ('a1', 1, 2, 7), ('a1', 1, 5, 3), ('a2', 13, 0, 4),
        ('a1', 0, 0, 100), ('a1', 25, 0, 9), ('p1', 1, 0, 50), ('b1', 1, 0, 60)
      ) AS days (item_id, months_ago, day, value)
      JOIN analytics_content_items items ON items.id = days.item_id;
    `);
    expect(await runPanel("search-months", "7d")).toEqual([
      { month: await monthLabel(13), clicks: 4 },
      { month: await monthLabel(1), clicks: 10 },
    ]);

    await client.exec(`
      DELETE FROM analytics_content_metric_snapshots WHERE id IN ('montha1250', 'montha2130');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at)
      SELECT 'partial', 'org:org_a', 'alice@example.test', 'org_a', 'a1', to_char((date_trunc('month', CURRENT_DATE::timestamp) - make_interval(months => 2))::date + 9, 'YYYY-MM-DD'), 'search_console_clicks', 6, 'search_console', 'r3', '2026-09-01';
    `);
    expect(await runPanel("search-months", "7d")).toEqual([
      { month: await monthLabel(1), clicks: 10 },
    ]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });
});
