import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listBuilderBlogArticles: vi.fn(),
  runFullReport: vi.fn(),
  querySearchAnalytics: vi.fn(),
  contexts: [] as unknown[],
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (ctx: unknown, fn: () => unknown) => {
    mocks.contexts.push(ctx);
    return fn();
  },
}));

vi.mock("../../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../../db/schema.js")>(
      "../../db/schema.js",
    );
  return { getDb: mocks.getDb, schema };
});

vi.mock("../../../actions/builder-blog-articles.js", () => ({
  listBuilderBlogArticles: mocks.listBuilderBlogArticles,
}));

vi.mock("../google-analytics.js", () => ({
  runFullReport: mocks.runFullReport,
}));

vi.mock("../search-console.js", () => ({
  querySearchAnalytics: mocks.querySearchAnalytics,
}));

import * as dbModule from "../../db/index.js";
import {
  collectContentForAllTenants,
  collectContentForCollection,
} from "./collect.js";
import { CONTENT_METRICS_MIGRATION_SQL } from "./migration.js";
import {
  readContentCollection,
  writeContentCollection,
  startContentRun,
} from "./store.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const ORG_A = { ownerEmail: "alice@example.test", orgId: "org_a" };

/** Summaries for the steps that are switched on. */
function ran<T extends { reason?: string }>(summaries: T[]): T[] {
  return summaries.filter((summary) => summary.reason !== "step_disabled");
}

function onlySteps(
  steps: Partial<Record<"builderBlog" | "ga4" | "searchConsole", boolean>>,
  sites: Array<{ siteUrl: string; pathPrefix?: string }> = [],
) {
  return writeContentCollection(ORG_A, {
    enabled: true,
    config: {
      builderBlog: { enabled: steps.builderBlog ?? false },
      ga4: { enabled: steps.ga4 ?? false },
      searchConsole: { enabled: steps.searchConsole ?? false, sites },
    },
  });
}

function article(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    handle: `post-${id}`,
    title: `Post ${id}`,
    author: { id: "author-1", name: "Ada Example", handle: "ada" },
    authors: [{ id: "author-1", name: "Ada Example", handle: "ada" }],
    publishDate: "2026-10-01T00:00:00.000Z",
    firstPublished: "2026-10-01T00:00:00.000Z",
    createdDate: null,
    lastUpdated: null,
    ...overrides,
  };
}

function connectionMissing(): Error {
  return Object.assign(
    new Error(
      "Builder Content API is not connected for this Analytics workspace.",
    ),
    { errorCode: "builder_not_connected", statusCode: 424 },
  );
}

describe("content collection", () => {
  let client: PGliteClient;

  async function rows(sql: string) {
    return (await client.query(sql)).rows as Array<Record<string, unknown>>;
  }

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    mocks.getDb.mockReset();
    mocks.getDb.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    mocks.listBuilderBlogArticles.mockReset();
    mocks.runFullReport.mockReset();
    mocks.querySearchAnalytics.mockReset();
    mocks.contexts.length = 0;
    for (const statement of CONTENT_METRICS_MIGRATION_SQL) {
      await client.exec(statement);
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it("writes the article list with authors under the stored owner and marks the run succeeded", async () => {
    await onlySteps({ builderBlog: true });
    mocks.listBuilderBlogArticles.mockResolvedValueOnce({
      articles: [
        article("a1"),
        article("a2", {
          author: null,
          authors: [],
        }),
      ],
      total: 2,
      truncated: false,
      nextOffset: null,
    });

    const result = await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });

    expect(ran(result)).toEqual([
      expect.objectContaining({ step: "builder_blog", status: "succeeded" }),
    ]);
    expect(mocks.listBuilderBlogArticles).toHaveBeenCalledWith(
      { offset: 0 },
      expect.objectContaining({
        userEmail: "alice@example.test",
        orgId: "org_a",
      }),
    );
    expect(mocks.contexts).toEqual([
      { userEmail: "alice@example.test", orgId: "org_a" },
    ]);
    expect(
      await rows(
        "SELECT tenant_key, external_id, url, author, authors, published_at FROM analytics_content_items ORDER BY external_id",
      ),
    ).toEqual([
      {
        tenant_key: "org:org_a",
        external_id: "a1",
        url: "https://www.builder.io/blog/post-a1",
        author: "Ada Example",
        authors: '["Ada Example"]',
        published_at: "2026-10-01T00:00:00.000Z",
      },
      {
        tenant_key: "org:org_a",
        external_id: "a2",
        url: "https://www.builder.io/blog/post-a2",
        author: null,
        authors: "[]",
        published_at: "2026-10-01T00:00:00.000Z",
      },
    ]);
    expect(
      await rows(
        "SELECT step, trigger, status, row_count, error_code FROM analytics_content_collection_runs",
      ),
    ).toEqual([
      {
        step: "builder_blog",
        trigger: "scheduled",
        status: "succeeded",
        row_count: 2,
        error_code: null,
      },
    ]);
  });

  it("records a missing connection as not configured and writes no items", async () => {
    await onlySteps({ builderBlog: true });
    mocks.listBuilderBlogArticles.mockRejectedValueOnce(connectionMissing());

    const [summary] = await collectContentForAllTenants();

    expect(summary).toEqual(
      expect.objectContaining({
        status: "not_configured",
        reason: "builder_not_connected",
      }),
    );
    expect(await rows("SELECT id FROM analytics_content_items")).toEqual([]);
    expect(
      await rows(
        "SELECT status, error_code, error_message, row_count FROM analytics_content_collection_runs",
      ),
    ).toEqual([
      {
        status: "not_configured",
        error_code: "builder_not_connected",
        error_message:
          "Builder Content API is not connected for this Analytics workspace.",
        row_count: null,
      },
    ]);
  });

  it("records a provider failure as failed, not as an empty article list", async () => {
    await onlySteps({ builderBlog: true });
    mocks.listBuilderBlogArticles.mockRejectedValueOnce(
      Object.assign(new Error("Builder Content API returned HTTP 503."), {
        errorCode: "provider_error",
        statusCode: 502,
      }),
    );

    const [summary] = await collectContentForAllTenants();

    expect(summary?.status).toBe("failed");
    expect(
      await rows(
        "SELECT status, error_code, row_count FROM analytics_content_collection_runs",
      ),
    ).toEqual([
      { status: "failed", error_code: "provider_error", row_count: null },
    ]);
  });

  it("fails rather than saving a partial list when the feed never ends", async () => {
    await onlySteps({ builderBlog: true });
    mocks.listBuilderBlogArticles.mockImplementation(
      async ({ offset }: { offset: number }) => ({
        articles: [article(`a${offset}`)],
        total: 1,
        truncated: true,
        nextOffset: offset + 20_000,
      }),
    );

    const [summary] = await collectContentForAllTenants();

    expect(summary?.status).toBe("failed");
    expect(await rows("SELECT id FROM analytics_content_items")).toEqual([]);
  });

  it("runs each step once per UTC day on schedule, while a manual run always runs", async () => {
    await onlySteps({ builderBlog: true });
    mocks.listBuilderBlogArticles.mockResolvedValue({
      articles: [article("a1")],
      total: 1,
      truncated: false,
      nextOffset: null,
    });
    const morning = new Date();

    await collectContentForAllTenants({ now: morning });
    const second = await collectContentForAllTenants({ now: morning });
    expect(ran(second)).toEqual([
      expect.objectContaining({
        status: "skipped",
        reason: "already_ran_today",
      }),
    ]);

    const collection = (await readContentCollection(ORG_A))!;
    const manual = await collectContentForCollection(collection, {
      trigger: "manual",
      now: morning,
    });
    expect(ran(manual)).toEqual([
      expect.objectContaining({ status: "succeeded" }),
    ]);
    expect(mocks.listBuilderBlogArticles).toHaveBeenCalledTimes(2);
  });

  it("retries a failed step on the next scheduled pass the same day", async () => {
    await onlySteps({ builderBlog: true });
    mocks.listBuilderBlogArticles
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({
        articles: [article("a1")],
        total: 1,
        truncated: false,
        nextOffset: null,
      });

    await collectContentForAllTenants();
    const [retry] = await collectContentForAllTenants();

    expect(retry?.status).toBe("succeeded");
  });

  it("closes a run abandoned mid-flight as failed before the next pass", async () => {
    await onlySteps({ builderBlog: true });
    await client.exec(`INSERT INTO analytics_content_collection_runs
      (id, tenant_key, owner_email, org_id, step, trigger, status, started_at)
      VALUES ('stuck', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'scheduled', 'running', '2026-10-14T07:00:00.000Z')`);
    mocks.listBuilderBlogArticles.mockResolvedValueOnce({
      articles: [],
      total: 0,
      truncated: false,
      nextOffset: null,
    });

    await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00.000Z"),
    });

    expect(
      await rows(
        "SELECT status, error_code FROM analytics_content_collection_runs WHERE id = 'stuck'",
      ),
    ).toEqual([{ status: "failed", error_code: "abandoned" }]);
  });

  it("expires an abandoned run during a manual retry", async () => {
    const collection = await onlySteps({ builderBlog: true });
    await client.exec(`INSERT INTO analytics_content_collection_runs
      (id, tenant_key, owner_email, org_id, step, trigger, status, started_at)
      VALUES ('stuck', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'manual', 'running', '2026-10-14T07:00:00.000Z')`);
    mocks.listBuilderBlogArticles.mockResolvedValue({
      articles: [],
      truncated: false,
      nextOffset: null,
    });
    expect(
      await collectContentForCollection(collection, {
        trigger: "manual",
        now: new Date("2026-10-15T07:00:00Z"),
        steps: ["builder_blog"],
      }),
    ).toEqual([expect.objectContaining({ status: "succeeded" })]);
    expect(
      await rows(
        "SELECT status, error_code FROM analytics_content_collection_runs WHERE id = 'stuck'",
      ),
    ).toEqual([{ status: "failed", error_code: "abandoned" }]);
  });

  it("allows only one concurrent claim before provider work", async () => {
    const collection = await writeContentCollection(ORG_A, { enabled: true });
    const claims = await Promise.all([
      startContentRun(collection, "builder_blog", "manual"),
      startContentRun(collection, "builder_blog", "scheduled"),
    ]);
    expect(claims.filter((claim) => claim.runId)).toHaveLength(1);
    expect(
      claims.filter((claim) => claim.reason === "already_running"),
    ).toHaveLength(1);
    expect(
      await rows("SELECT status FROM analytics_content_collection_runs"),
    ).toEqual([{ status: "running" }]);
  });

  it("keeps unresolved author IDs in metadata without displaying them as names", async () => {
    await writeContentCollection(ORG_A, { enabled: true });
    mocks.listBuilderBlogArticles.mockResolvedValue({
      articles: [
        article("a1", {
          author: { id: "gone", name: null, handle: null },
          authors: [{ id: "gone", name: null, handle: null }],
        }),
      ],
      truncated: false,
      nextOffset: null,
    });
    await collectContentForAllTenants();
    const [item] = await rows(
      "SELECT author, authors, metadata FROM analytics_content_items",
    );
    expect(item?.author).toBeNull();
    expect(item?.authors).toBe("[]");
    expect(JSON.parse(String(item?.metadata)).authorIds).toEqual(["gone"]);
  });

  it("collects enabled tenants after the first page", async () => {
    await client.exec(`INSERT INTO analytics_content_collections
      (tenant_key, owner_email, org_id, enabled, config, created_at, updated_at)
      SELECT 'org:' || lpad(i::text, 4, '0'), 'owner@example.test', 'org_' || i, true,
        '{"builderBlog":{"enabled":false}}', '2026-10-15', '2026-10-15'
      FROM generate_series(1, 1001) AS i`);
    const summaries = await collectContentForAllTenants();
    const tenants = [...new Set(summaries.map((summary) => summary.tenantKey))];
    expect(tenants).toHaveLength(1001);
    expect(tenants[1000]).toBe("org:1001");
  });

  it("skips tenants that turned collection off and steps they turned off", async () => {
    await writeContentCollection(ORG_A, { enabled: false });
    expect(await collectContentForAllTenants()).toEqual([]);

    await onlySteps({});
    expect(await collectContentForAllTenants()).toEqual(
      ["builder_blog", "ga4", "search_console"].map((step) =>
        expect.objectContaining({
          step,
          status: "skipped",
          reason: "step_disabled",
        }),
      ),
    );
    expect(mocks.listBuilderBlogArticles).not.toHaveBeenCalled();
  });

  function feed(...articles: ReturnType<typeof article>[]) {
    mocks.listBuilderBlogArticles.mockResolvedValue({
      articles,
      total: articles.length,
      truncated: false,
      nextOffset: null,
    });
  }

  function ga4Row(date: string, path: string, views: number) {
    return {
      dimensionValues: [{ value: date }, { value: path }],
      metricValues: [{ value: String(views) }],
    };
  }

  async function snapshots(metric: string) {
    return rows(
      `SELECT i.external_id, s.metric_date, s.value, s.source
         FROM analytics_content_metric_snapshots s
         JOIN analytics_content_items i ON i.id = s.item_id
        WHERE s.metric = '${metric}'
        ORDER BY i.external_id, s.metric_date`,
    );
  }

  it("writes GA4 pageviews per article, zero only for days GA4 has reported", async () => {
    await onlySteps({ builderBlog: true, ga4: true });
    feed(
      article("a1"),
      article("a2", { publishDate: "2026-10-14T00:00:00.000Z" }),
    );
    mocks.runFullReport.mockResolvedValueOnce([
      ga4Row("20261012", "/blog/post-a1", 1),
      ga4Row("20261013", "/blog/post-a1", 5),
      ga4Row("20261013", "/blog/post-a1/", 2),
      ga4Row("20261013", "/blog/retired-post", 9),
    ]);

    const summaries = await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });

    expect(ran(summaries).map((summary) => summary.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(mocks.runFullReport).toHaveBeenCalledWith(
      expect.objectContaining({
        dateRange: { startDate: "2026-07-17", endDate: "2026-10-14" },
      }),
    );
    const written = await snapshots("ga4_pageviews");
    // a1 from its publish date through the last day GA4 returned; a2 was
    // published after that, and 2026-10-14 is not reported yet.
    expect(written).toHaveLength(13);
    expect(written[0]).toEqual({
      external_id: "a1",
      metric_date: "2026-10-01",
      value: 0,
      source: "ga4",
    });
    expect(written.slice(-2)).toEqual([
      { external_id: "a1", metric_date: "2026-10-12", value: 1, source: "ga4" },
      { external_id: "a1", metric_date: "2026-10-13", value: 7, source: "ga4" },
    ]);
    expect(
      await rows(
        "SELECT window_start, window_end, row_count FROM analytics_content_collection_runs WHERE step = 'ga4'",
      ),
    ).toEqual([
      { window_start: "2026-07-17", window_end: "2026-10-13", row_count: 13 },
    ]);

    mocks.runFullReport.mockResolvedValueOnce([
      ga4Row("20261015", "/blog/post-a1", 4),
    ]);
    await collectContentForAllTenants({
      now: new Date("2026-10-16T07:00:00Z"),
    });
    expect(mocks.runFullReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dateRange: { startDate: "2026-10-13", endDate: "2026-10-15" },
      }),
    );
  });

  it("fails a GA4 run whose property reports no blog pages instead of writing zeros", async () => {
    await onlySteps({ builderBlog: true, ga4: true });
    feed(article("a1"));
    mocks.runFullReport.mockResolvedValueOnce([]);

    const [, ga4] = await collectContentForAllTenants();

    expect(ga4).toEqual(
      expect.objectContaining({ step: "ga4", status: "failed" }),
    );
    expect(await snapshots("ga4_pageviews")).toEqual([]);
  });

  it("records GA4 without a property as not configured", async () => {
    await onlySteps({ builderBlog: true, ga4: true });
    feed(article("a1"));
    mocks.runFullReport.mockRejectedValueOnce(
      Object.assign(new Error("GA4_PROPERTY_ID not configured"), {
        errorCode: "ga4_not_configured",
        statusCode: 424,
      }),
    );

    const [, ga4] = await collectContentForAllTenants();

    expect(ga4).toEqual(
      expect.objectContaining({
        status: "not_configured",
        reason: "ga4_not_configured",
      }),
    );
  });

  it("attaches Search Console pages to articles and stores other pages as their own items", async () => {
    await onlySteps({ builderBlog: true, searchConsole: true }, [
      { siteUrl: "sc-domain:builder.io", pathPrefix: "/blog/" },
      { siteUrl: "sc-domain:agent-native.com" },
    ]);
    feed(article("a1", { publishDate: "2026-10-09T00:00:00.000Z" }));
    mocks.querySearchAnalytics.mockImplementation(
      async ({ siteUrl }: { siteUrl: string }) =>
        siteUrl === "sc-domain:builder.io"
          ? [
              {
                keys: ["2026-10-10", "https://www.builder.io/blog/post-a1#faq"],
                clicks: 3,
                impressions: 40,
              },
              {
                keys: ["2026-10-10", "https://www.builder.io/blog/post-a1"],
                clicks: 1,
                impressions: 10,
              },
            ]
          : [
              {
                keys: ["2026-10-11", "https://agent-native.com/docs/"],
                clicks: 2,
                impressions: 20,
              },
            ],
    );

    const summaries = await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });

    expect(ran(summaries).map((summary) => summary.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(mocks.querySearchAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        siteUrl: "sc-domain:builder.io",
        pageRegex: "^https?://[^/]+/blog/",
      }),
    );
    const clicks = await snapshots("search_console_clicks");
    expect(clicks.filter((row) => row.external_id === "a1")).toEqual([
      {
        external_id: "a1",
        metric_date: "2026-10-10",
        value: 4,
        source: "search_console",
      },
    ]);
    expect(
      clicks.find(
        (row) =>
          row.external_id === "agent-native.com/docs" &&
          row.metric_date === "2026-10-11",
      ),
    ).toEqual(expect.objectContaining({ value: 2 }));
    expect(
      await rows(
        "SELECT source, external_id, url FROM analytics_content_items WHERE source = 'search_console'",
      ),
    ).toEqual([
      {
        source: "search_console",
        external_id: "agent-native.com/docs",
        url: "https://agent-native.com/docs/",
      },
    ]);
  });

  it("emits each key once for overlapping properties and leaves omissions absent", async () => {
    await onlySteps({ builderBlog: true, searchConsole: true }, [
      { siteUrl: "sc-domain:builder.io" },
      { siteUrl: "https://www.builder.io/" },
    ]);
    feed(article("a1"), article("a2"));
    mocks.querySearchAnalytics
      .mockResolvedValueOnce([
        {
          keys: ["2026-10-10", "https://www.builder.io/blog/post-a1"],
          clicks: 3,
          impressions: 40,
        },
      ])
      .mockResolvedValueOnce([
        {
          keys: ["2026-10-10", "https://www.builder.io/blog/post-a1"],
          clicks: 2,
          impressions: 30,
        },
      ]);
    const summaries = await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });
    expect(ran(summaries).map((summary) => summary.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(await snapshots("search_console_clicks")).toEqual([
      {
        external_id: "a1",
        metric_date: "2026-10-10",
        value: 3,
        source: "search_console",
      },
    ]);
    expect(await snapshots("search_console_impressions")).toEqual([
      {
        external_id: "a1",
        metric_date: "2026-10-10",
        value: 40,
        source: "search_console",
      },
    ]);
  });

  it("advances query coverage after an empty successful Search Console run", async () => {
    await onlySteps({ searchConsole: true }, [
      { siteUrl: "sc-domain:example.test" },
    ]);
    mocks.querySearchAnalytics.mockResolvedValue([]);
    await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });
    expect(
      await rows(
        "SELECT window_end FROM analytics_content_collection_runs WHERE step = 'search_console'",
      ),
    ).toEqual([{ window_end: "2026-10-14" }]);
    await collectContentForAllTenants({
      now: new Date("2026-10-16T07:00:00Z"),
    });
    expect(mocks.querySearchAnalytics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startDate: "2026-10-11",
        endDate: "2026-10-15",
      }),
    );
    expect(await snapshots("search_console_clicks")).toEqual([]);
  });

  it("fails the entire step if any Search Console property denies access", async () => {
    await onlySteps({ searchConsole: true }, [
      { siteUrl: "sc-domain:example.test" },
      { siteUrl: "sc-domain:denied.test" },
    ]);
    mocks.querySearchAnalytics
      .mockResolvedValueOnce([
        {
          keys: ["2026-10-10", "https://example.test/page"],
          clicks: 3,
          impressions: 4,
        },
      ])
      .mockRejectedValueOnce(
        Object.assign(new Error("Access denied"), {
          errorCode: "search_console_no_access",
          statusCode: 424,
        }),
      );
    expect(
      (await collectContentForAllTenants()).find(
        (summary) => summary.step === "search_console",
      )?.status,
    ).toBe("not_configured");
    expect(await snapshots("search_console_clicks")).toEqual([]);
  });

  it("records Search Console without access, or without properties, as not configured", async () => {
    await onlySteps({ builderBlog: true, searchConsole: true }, [
      { siteUrl: "sc-domain:builder.io" },
    ]);
    feed(article("a1"));
    mocks.querySearchAnalytics.mockRejectedValueOnce(
      Object.assign(new Error("Search Console denied access"), {
        errorCode: "search_console_no_access",
        statusCode: 424,
      }),
    );
    const denied = (await collectContentForAllTenants()).find(
      (summary) => summary.step === "search_console",
    );
    expect(denied).toEqual(
      expect.objectContaining({
        status: "not_configured",
        reason: "search_console_no_access",
      }),
    );

    await onlySteps({ searchConsole: true });
    const empty = (await collectContentForAllTenants()).find(
      (summary) => summary.step === "search_console",
    );
    expect(empty).toEqual(
      expect.objectContaining({
        status: "not_configured",
        reason: "no_search_console_sites",
      }),
    );
    expect(await snapshots("search_console_clicks")).toEqual([]);
  });
});
