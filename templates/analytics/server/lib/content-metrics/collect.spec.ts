import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
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

const { PGlite } = createRequire(
  new URL("../../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listBuilderBlogArticles: vi.fn(),
  runFullReport: vi.fn(),
  querySearchAnalytics: vi.fn(),
  dryRunQuerySchema: vi.fn(),
  runQuery: vi.fn(),
  listYouTubeChannelVideos: vi.fn(),
  xToken: "test-x-token" as string | null,
  contexts: [] as unknown[],
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (ctx: unknown, fn: () => unknown) => {
    mocks.contexts.push(ctx);
    return fn();
  },
  testIdentitySql: (column: string) => `is_test_identity(${column})`,
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

vi.mock("../youtube.js", () => ({
  listYouTubeChannelVideos: mocks.listYouTubeChannelVideos,
}));

vi.mock("../credentials", () => ({
  resolveCredential: async () => mocks.xToken,
}));

vi.mock("../credentials-context", () => ({
  requireRequestCredentialContext: () => ({ email: "alice@example.test" }),
}));

vi.mock("../bigquery.js", () => ({
  BigQueryMaximumBytesBilledError: class extends Error {},
  dryRunQuerySchema: mocks.dryRunQuerySchema,
  runQuery: mocks.runQuery,
}));

import * as dbModule from "../../db/index.js";
import { BigQueryMaximumBytesBilledError } from "../bigquery.js";
import { resetPublicSchema } from "../testing/pglite-reset.js";
import {
  collectContentForAllTenants,
  collectContentForCollection,
} from "./collect.js";
import {
  agentNativeSignupsConfigSchema,
  defaultContentCollectionConfig,
  signupsConfigSchema,
  type AgentNativeSignupsConfig,
  type ContentCollectionConfig,
  type SignupsConfig,
} from "./config.js";
import {
  CONTENT_METRICS_MIGRATION_SQL,
  CONTENT_COVERAGE_CONFIG_MIGRATION_SQL,
  CONTENT_SEARCH_QUERIES_MIGRATION_SQL,
} from "./migration.js";
import {
  agentNativeSignupsSource,
  buildAgentNativeSignupsQuery,
} from "./steps/agent-native-signups.js";
import { buildSignupsQuery } from "./steps/signups.js";
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
  steps: Partial<
    Record<
      | "builderBlog"
      | "ga4"
      | "dailyDev"
      | "searchConsole"
      | "searchConsoleQueries"
      | "signups"
      | "agentNativeSignups"
      | "youtube"
      | "x",
      boolean
    >
  >,
  sites: Array<{ siteUrl: string; pathPrefix?: string }> = [],
  signups: Partial<SignupsConfig> = {},
  agentNativeSignups: Partial<AgentNativeSignupsConfig> = {},
  searchConsole: { historyMonths?: number; queriesPerPage?: number } = {},
  youtubeChannels: string[] = ["@Builderio"],
) {
  return writeContentCollection(ORG_A, {
    enabled: true,
    config: {
      builderBlog: { enabled: steps.builderBlog ?? false },
      ga4: { enabled: steps.ga4 ?? false, propertyId: "123456789" },
      dailyDev: { enabled: steps.dailyDev ?? false },
      searchConsole: {
        enabled: steps.searchConsole ?? false,
        sites,
        historyMonths: searchConsole.historyMonths ?? 1,
      },
      searchConsoleQueries: {
        enabled: steps.searchConsoleQueries ?? false,
        perPage: searchConsole.queriesPerPage ?? 25,
      },
      signups: {
        ...signupsConfigSchema.parse({ enabled: false }),
        ...signups,
        enabled: steps.signups ?? false,
      },
      agentNativeSignups: {
        ...agentNativeSignupsConfigSchema.parse({ enabled: false }),
        ...agentNativeSignups,
        enabled: steps.agentNativeSignups ?? false,
      },
      youtube: { enabled: steps.youtube ?? false, channels: youtubeChannels },
      x: { enabled: steps.x ?? false, accounts: [], links: [], terms: [] },
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

  beforeAll(async () => {
    client = await PGlite.create("memory://");
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await resetPublicSchema(client);
    mocks.getDb.mockReset();
    mocks.getDb.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    mocks.listBuilderBlogArticles.mockReset();
    mocks.runFullReport.mockReset();
    mocks.querySearchAnalytics.mockReset();
    mocks.dryRunQuerySchema.mockReset();
    mocks.runQuery.mockReset();
    mocks.listYouTubeChannelVideos.mockReset();
    mocks.xToken = "test-x-token";
    mocks.contexts.length = 0;
    for (const statement of CONTENT_METRICS_MIGRATION_SQL) {
      await client.exec(statement);
    }
    await client.exec(CONTENT_COVERAGE_CONFIG_MIGRATION_SQL);
    for (const statement of CONTENT_SEARCH_QUERIES_MIGRATION_SQL) {
      await client.exec(statement);
    }
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
      [
        "builder_blog",
        "ga4",
        "daily_dev",
        "search_console",
        "search_console_queries",
        "signups",
        "agent_native_signups",
        "youtube",
        "x",
      ].map((step) =>
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
        propertyId: "123456789",
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

  it("backfills GA4 history when the collection changes properties", async () => {
    const collection = await onlySteps({ builderBlog: true, ga4: true });
    feed(article("a1", { publishDate: "2026-07-01T00:00:00.000Z" }));
    mocks.runFullReport.mockResolvedValueOnce([
      ga4Row("20260717", "/blog/post-a1", 90),
      ga4Row("20261014", "/blog/post-a1", 4),
    ]);
    await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });
    await writeContentCollection(ORG_A, {
      enabled: true,
      config: {
        ...collection.config,
        ga4: { enabled: true, propertyId: "987654321" },
      },
    });
    mocks.runFullReport.mockResolvedValueOnce([
      ga4Row("20261013", "/blog/post-a1", 7),
    ]);
    await collectContentForAllTenants({
      now: new Date("2026-10-16T07:00:00Z"),
    });

    expect(mocks.runFullReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        propertyId: "987654321",
        dateRange: { startDate: "2026-07-18", endDate: "2026-10-15" },
      }),
    );
    const replaced = await snapshots("ga4_pageviews");
    expect(replaced).toContainEqual({
      external_id: "a1",
      metric_date: "2026-10-13",
      value: 7,
      source: "ga4",
    });
    expect(replaced.some((row) => row.metric_date === "2026-07-17")).toBe(
      false,
    );
    expect(replaced.some((row) => row.metric_date === "2026-10-14")).toBe(
      false,
    );
    const runs = await rows(
      "SELECT config_fingerprint FROM analytics_content_collection_runs WHERE step = 'ga4' ORDER BY window_end",
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]!.config_fingerprint).toEqual(expect.any(String));
    expect(runs[1]!.config_fingerprint).toEqual(expect.any(String));
    expect(runs[0]!.config_fingerprint).not.toEqual(
      runs[1]!.config_fingerprint,
    );
  });

  it("saves nothing from a GA4 run whose property changed mid-request, and collects the new one that day", async () => {
    const collection = await onlySteps({ builderBlog: true, ga4: true });
    feed(article("a1"));
    mocks.runFullReport.mockImplementationOnce(async () => {
      await writeContentCollection(ORG_A, {
        enabled: true,
        config: {
          ...collection.config,
          ga4: { enabled: true, propertyId: "987654321" },
        },
      });
      return [ga4Row("20261014", "/blog/post-a1", 4)];
    });

    const first = await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });

    expect(ran(first)[1]).toMatchObject({
      step: "ga4",
      status: "failed",
      reason: "content_config_changed",
    });
    expect(await snapshots("ga4_pageviews")).toEqual([]);

    mocks.runFullReport.mockResolvedValueOnce([
      ga4Row("20261014", "/blog/post-a1", 7),
    ]);
    const second = await collectContentForAllTenants({
      now: new Date("2026-10-15T08:00:00Z"),
    });

    expect(ran(second)[1]).toMatchObject({ step: "ga4", status: "succeeded" });
    expect(mocks.runFullReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ propertyId: "987654321" }),
    );
    expect(await snapshots("ga4_pageviews")).toContainEqual({
      external_id: "a1",
      metric_date: "2026-10-14",
      value: 7,
      source: "ga4",
    });
  });

  it.each(["empty", "unmatched", "provider_error", "save_error"])(
    "keeps the old GA4 series when a property replacement ends in %s",
    async (failure) => {
      const collection = await onlySteps({ builderBlog: true, ga4: true });
      feed(article("a1"));
      mocks.runFullReport.mockResolvedValueOnce([
        ga4Row("20261014", "/blog/post-a1", 4),
      ]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      const previous = await snapshots("ga4_pageviews");
      const previousRuns = await rows(
        "SELECT config_fingerprint, window_end FROM analytics_content_collection_runs WHERE step = 'ga4' AND status = 'succeeded'",
      );
      await writeContentCollection(ORG_A, {
        enabled: true,
        config: {
          ...collection.config,
          ga4: { enabled: true, propertyId: "987654321" },
        },
      });
      if (failure === "provider_error") {
        mocks.runFullReport.mockRejectedValueOnce(
          new Error("provider unavailable"),
        );
      } else if (failure === "empty") {
        mocks.runFullReport.mockResolvedValueOnce([]);
      } else if (failure === "unmatched") {
        mocks.runFullReport.mockResolvedValueOnce([
          ga4Row("20261015", "/blog/untracked-post", 5),
        ]);
      } else {
        await client.exec(
          "ALTER TABLE analytics_content_metric_snapshots ADD CONSTRAINT reject_new_ga4 CHECK (value <> 5)",
        );
        mocks.runFullReport.mockResolvedValueOnce([
          ga4Row("20261015", "/blog/post-a1", 5),
        ]);
      }
      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(ran(summaries)[1]).toMatchObject({
        step: "ga4",
        status: "failed",
      });
      expect(await snapshots("ga4_pageviews")).toEqual(previous);
      expect(
        await rows(
          "SELECT config_fingerprint, window_end FROM analytics_content_collection_runs WHERE step = 'ga4' AND status = 'succeeded'",
        ),
      ).toEqual(previousRuns);
    },
  );

  it.each(["empty", "unmatched"])(
    "fails a GA4 run whose property reports %s article data instead of writing zeros",
    async (report) => {
      await onlySteps({ builderBlog: true, ga4: true });
      feed(article("a1"));
      mocks.runFullReport.mockResolvedValueOnce(
        report === "empty"
          ? []
          : [ga4Row("20261014", "/blog/untracked-post", 5)],
      );

      const [, ga4] = await collectContentForAllTenants();

      expect(ga4).toEqual(
        expect.objectContaining({ step: "ga4", status: "failed" }),
      );
      expect(await snapshots("ga4_pageviews")).toEqual([]);
    },
  );

  it.each(["succeeds", "fails"])(
    "keeps newer GA4 snapshots and terminal run states when an abandoned request later %s",
    async (completion) => {
      const collection = await onlySteps({ builderBlog: true, ga4: true });
      feed(article("a1"));
      await collectContentForCollection(collection, {
        trigger: "manual",
        steps: ["builder_blog"],
        now: new Date("2026-10-15T07:00:00Z"),
      });
      let releaseOld!: (rows: ReturnType<typeof ga4Row>[]) => void;
      let rejectOld!: (error: Error) => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const oldReport = new Promise<ReturnType<typeof ga4Row>[]>(
        (resolve, reject) => {
          releaseOld = resolve;
          rejectOld = reject;
        },
      );
      mocks.runFullReport.mockImplementationOnce(() => {
        markStarted();
        return oldReport;
      });
      const older = collectContentForCollection(collection, {
        trigger: "manual",
        steps: ["ga4"],
        now: new Date("2026-10-15T07:00:00Z"),
      });
      await started;
      try {
        const updated = await writeContentCollection(ORG_A, {
          enabled: true,
          config: {
            ...collection.config,
            ga4: { enabled: true, propertyId: "987654321" },
          },
        });
        mocks.runFullReport.mockResolvedValueOnce([
          ga4Row("20261014", "/blog/post-a1", 7),
        ]);
        expect(
          await collectContentForCollection(updated, {
            trigger: "manual",
            steps: ["ga4"],
            now: new Date("2026-10-15T07:31:00Z"),
          }),
        ).toEqual([expect.objectContaining({ status: "succeeded" })]);
        const savedSnapshots = await snapshots("ga4_pageviews");
        expect(savedSnapshots).toContainEqual({
          external_id: "a1",
          metric_date: "2026-10-14",
          value: 7,
          source: "ga4",
        });
        const savedRuns = await rows(
          "SELECT status, error_code, finished_at, config_fingerprint FROM analytics_content_collection_runs WHERE step = 'ga4' ORDER BY started_at",
        );
        expect(savedRuns.map((run) => [run.status, run.error_code])).toEqual([
          ["failed", "abandoned"],
          ["succeeded", null],
        ]);
        if (completion === "fails")
          rejectOld(new Error("late provider failure"));
        else releaseOld([ga4Row("20261013", "/blog/post-a1", 99)]);
        expect(await older).toEqual([
          expect.objectContaining({ status: "failed" }),
        ]);
        expect(await snapshots("ga4_pageviews")).toEqual(savedSnapshots);
        expect(
          await rows(
            "SELECT status, error_code, finished_at, config_fingerprint FROM analytics_content_collection_runs WHERE step = 'ga4' ORDER BY started_at",
          ),
        ).toEqual(savedRuns);
      } finally {
        releaseOld([]);
        await older;
      }
    },
  );

  it("does not query the shared property when the collection has no GA4 property", async () => {
    const collection = await onlySteps({ builderBlog: true, ga4: true });
    await writeContentCollection(ORG_A, {
      enabled: true,
      config: {
        ...collection.config,
        ga4: { enabled: true, propertyId: null },
      },
    });
    feed(article("a1"));

    const [, ga4] = await collectContentForAllTenants();

    expect(ga4).toEqual(
      expect.objectContaining({
        status: "not_configured",
        reason: "ga4_property_not_configured",
      }),
    );
    expect(mocks.runFullReport).not.toHaveBeenCalled();
    expect(await snapshots("ga4_pageviews")).toEqual([]);
    expect(
      await rows(
        "SELECT status, row_count, error_code FROM analytics_content_collection_runs WHERE step = 'ga4'",
      ),
    ).toEqual([
      {
        status: "not_configured",
        row_count: null,
        error_code: "ga4_property_not_configured",
      },
    ]);
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

  it("advances coverage after an empty success with unchanged normalized config", async () => {
    await onlySteps({ searchConsole: true }, [
      { siteUrl: "sc-domain:example.test", pathPrefix: "/blog/" },
    ]);
    mocks.querySearchAnalytics.mockResolvedValue([]);
    await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });
    await onlySteps({ searchConsole: true }, [
      { siteUrl: " SC-DOMAIN:Example.test ", pathPrefix: " /blog/ " },
    ]);
    await collectContentForAllTenants({
      now: new Date("2026-10-16T07:00:00Z"),
    });
    expect(mocks.querySearchAnalytics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startDate: "2026-10-11",
        endDate: "2026-10-15",
      }),
    );
  });

  it.each(["correct", "add"])(
    "backfills all properties after a config change: %s",
    async (change) => {
      const populated = { siteUrl: "sc-domain:populated.test" };
      const empty = {
        siteUrl: "sc-domain:example.test",
        pathPrefix: "/wrong/",
      };
      await onlySteps({ searchConsole: true }, [populated, empty]);
      mocks.querySearchAnalytics
        .mockResolvedValueOnce([
          {
            keys: ["2026-10-14", "https://populated.test/post"],
            clicks: 2,
            impressions: 10,
          },
        ])
        .mockResolvedValueOnce([]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      const corrected = {
        siteUrl: "sc-domain:example.test",
        pathPrefix: "/blog/",
      };
      await onlySteps(
        { searchConsole: true },
        change === "correct"
          ? [populated, corrected]
          : [populated, empty, corrected],
      );
      mocks.querySearchAnalytics.mockResolvedValue([]).mockResolvedValueOnce([
        {
          keys: ["2026-08-01", "https://populated.test/post"],
          clicks: 3,
          impressions: 40,
        },
      ]);
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      for (const [args] of mocks.querySearchAnalytics.mock.calls.slice(2)) {
        expect(args).toMatchObject({
          startDate: "2026-07-18",
          endDate: "2026-10-15",
        });
      }
      expect(await snapshots("search_console_clicks")).toContainEqual({
        external_id: "populated.test/post",
        metric_date: "2026-08-01",
        value: 3,
        source: "search_console",
      });
    },
  );

  it("backfills after an empty initial run and a corrected property", async () => {
    await onlySteps({ searchConsole: true }, [
      { siteUrl: "sc-domain:example.test", pathPrefix: "/wrong/" },
    ]);
    mocks.querySearchAnalytics.mockResolvedValueOnce([]);
    await collectContentForAllTenants({
      now: new Date("2026-10-15T07:00:00Z"),
    });
    expect(
      await rows(
        "SELECT window_end FROM analytics_content_collection_runs WHERE step = 'search_console'",
      ),
    ).toEqual([{ window_end: "2026-10-14" }]);
    await onlySteps({ searchConsole: true }, [
      { siteUrl: "SC-DOMAIN:Example.test", pathPrefix: "/blog/" },
    ]);
    mocks.querySearchAnalytics.mockResolvedValueOnce([
      {
        keys: ["2026-08-01", "https://example.test/blog/post"],
        clicks: 3,
        impressions: 40,
      },
    ]);
    await collectContentForAllTenants({
      now: new Date("2026-10-16T07:00:00Z"),
    });
    expect(mocks.querySearchAnalytics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        siteUrl: "sc-domain:example.test",
        startDate: "2026-07-18",
        endDate: "2026-10-15",
        pageRegex: "^https?://[^/]+/blog/",
      }),
    );
    expect(await snapshots("search_console_clicks")).toEqual([
      {
        external_id: "example.test/blog/post",
        metric_date: "2026-08-01",
        value: 3,
        source: "search_console",
      },
    ]);
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
  describe("Search Console history and queries", () => {
    type PageRow = {
      date: string;
      page: string;
      clicks: number;
      impressions: number;
      position?: number;
      siteUrl?: string;
    };
    type QueryRow = PageRow & { query: string };

    function searchConsoleRows(pages: PageRow[], queries: QueryRow[] = []) {
      mocks.querySearchAnalytics.mockImplementation(
        async ({
          siteUrl,
          startDate,
          endDate,
          dimensions,
        }: {
          siteUrl: string;
          startDate: string;
          endDate: string;
          dimensions: string[];
        }) => {
          const within = (row: PageRow) =>
            row.date >= startDate &&
            row.date <= endDate &&
            (row.siteUrl ?? siteUrl) === siteUrl;
          const values = (row: PageRow) => ({
            clicks: row.clicks,
            impressions: row.impressions,
            ...(row.position === undefined ? {} : { position: row.position }),
          });
          return dimensions[1] === "query"
            ? queries
                .filter(within)
                .map((row) => ({ keys: [row.page, row.query], ...values(row) }))
            : pages
                .filter(within)
                .map((row) => ({ keys: [row.date, row.page], ...values(row) }));
        },
      );
    }

    function readCalls(kind: "page" | "query") {
      return mocks.querySearchAnalytics.mock.calls
        .map(
          ([args]) =>
            args as {
              startDate: string;
              endDate: string;
              dimensions: string[];
            },
        )
        .filter(
          (args) => (args.dimensions[1] === "query") === (kind === "query"),
        );
    }

    function queryDays() {
      return readCalls("query")
        .map((args) => args.startDate)
        .sort();
    }

    async function queryRows() {
      return rows(
        `SELECT i.external_id, q.week_start, q.query, q.clicks, q.impressions, q.position_weighted
           FROM analytics_content_search_queries q
           JOIN analytics_content_items i ON i.id = q.item_id
          ORDER BY q.week_start, q.impressions DESC, q.query`,
      );
    }

    async function runWindows(step: string) {
      const result = await client.query(
        `SELECT window_start, window_end, row_count, detail
           FROM analytics_content_collection_runs
          WHERE step = $1
          ORDER BY window_end`,
        [step],
      );
      return result.rows as Array<Record<string, unknown>>;
    }

    const POST = "https://www.builder.io/blog/post-a1";
    const BLOG = [{ siteUrl: "sc-domain:builder.io", pathPrefix: "/blog/" }];

    it("stores average position as position times impressions per page and day", async () => {
      await onlySteps({ builderBlog: true, searchConsole: true }, BLOG);
      feed(article("a1"));
      searchConsoleRows([
        {
          date: "2026-10-10",
          page: POST,
          clicks: 3,
          impressions: 40,
          position: 2.5,
        },
        { date: "2026-10-11", page: POST, clicks: 1, impressions: 10 },
      ]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      expect(await snapshots("search_console_position_weighted")).toEqual([
        {
          external_id: "a1",
          metric_date: "2026-10-10",
          value: 100,
          source: "search_console",
        },
      ]);
    });

    it("reads older history a piece per run until it reaches the history start", async () => {
      await onlySteps(
        { searchConsole: true },
        [{ siteUrl: "sc-domain:example.test" }],
        {},
        {},
        { historyMonths: 4 },
      );
      searchConsoleRows([
        {
          date: "2026-06-20",
          page: "https://example.test/old",
          clicks: 1,
          impressions: 5,
        },
      ]);

      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      expect(readCalls("page")).toEqual([
        expect.objectContaining({
          startDate: "2026-07-12",
          endDate: "2026-07-16",
        }),
        expect.objectContaining({
          startDate: "2026-07-17",
          endDate: "2026-10-14",
        }),
      ]);

      mocks.querySearchAnalytics.mockClear();
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(readCalls("page")).toEqual([
        expect.objectContaining({
          startDate: "2026-06-16",
          endDate: "2026-07-11",
        }),
        expect.objectContaining({
          startDate: "2026-10-11",
          endDate: "2026-10-15",
        }),
      ]);
      expect(await snapshots("search_console_clicks")).toEqual([
        {
          external_id: "example.test/old",
          metric_date: "2026-06-20",
          value: 1,
          source: "search_console",
        },
      ]);

      mocks.querySearchAnalytics.mockClear();
      await collectContentForAllTenants({
        now: new Date("2026-10-17T07:00:00Z"),
      });
      expect(readCalls("page")).toEqual([
        expect.objectContaining({
          startDate: "2026-10-12",
          endDate: "2026-10-16",
        }),
      ]);
      expect(
        (await runWindows("search_console")).map((run) => [
          run.window_start,
          run.window_end,
        ]),
      ).toEqual([
        ["2026-07-12", "2026-10-14"],
        ["2026-06-16", "2026-10-15"],
        ["2026-10-12", "2026-10-16"],
      ]);
    });

    it("fills 16 months 90 older days a run, 30 days a request", async () => {
      await onlySteps(
        { searchConsole: true },
        [{ siteUrl: "sc-domain:example.test" }],
        {},
        {},
        { historyMonths: 16 },
      );
      searchConsoleRows([]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      mocks.querySearchAnalytics.mockClear();
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(readCalls("page")).toEqual([
        expect.objectContaining({
          startDate: "2026-04-13",
          endDate: "2026-05-12",
        }),
        expect.objectContaining({
          startDate: "2026-05-13",
          endDate: "2026-06-11",
        }),
        expect.objectContaining({
          startDate: "2026-06-12",
          endDate: "2026-07-11",
        }),
        expect.objectContaining({
          startDate: "2026-10-11",
          endDate: "2026-10-15",
        }),
      ]);
    });

    it("counts a day as collected only once Search Console has returned it", async () => {
      await onlySteps(
        { searchConsole: true },
        [{ siteUrl: "sc-domain:example.test" }],
        {},
        {},
        { historyMonths: 4 },
      );
      searchConsoleRows([
        {
          date: "2026-10-09",
          page: "https://example.test/post",
          clicks: 1,
          impressions: 5,
        },
      ]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      mocks.querySearchAnalytics.mockClear();
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(readCalls("page").slice(-1)).toEqual([
        expect.objectContaining({
          startDate: "2026-10-10",
          endDate: "2026-10-15",
        }),
      ]);
      expect(
        (await runWindows("search_console")).map((run) => run.window_end),
      ).toEqual(["2026-10-09", "2026-10-15"]);
    });

    it("starts history over when the properties change and change back", async () => {
      const runWith = async (siteUrl: string, day: string) => {
        await onlySteps(
          { searchConsole: true },
          [{ siteUrl }],
          {},
          {},
          { historyMonths: 16 },
        );
        mocks.querySearchAnalytics.mockClear();
        await collectContentForAllTenants({
          now: new Date(`${day}T07:00:00Z`),
        });
      };
      searchConsoleRows([]);
      await runWith("sc-domain:example.test", "2026-10-15");
      await runWith("sc-domain:other.test", "2026-10-16");
      await runWith("sc-domain:example.test", "2026-10-17");
      expect(readCalls("page")).toEqual([
        expect.objectContaining({
          startDate: "2026-07-14",
          endDate: "2026-07-18",
        }),
        expect.objectContaining({
          startDate: "2026-07-19",
          endDate: "2026-10-16",
        }),
      ]);
    });

    it("starts history over when the properties change", async () => {
      await onlySteps(
        { searchConsole: true },
        [{ siteUrl: "sc-domain:example.test" }],
        {},
        {},
        { historyMonths: 16 },
      );
      searchConsoleRows([]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      await onlySteps(
        { searchConsole: true },
        [{ siteUrl: "sc-domain:other.test" }],
        {},
        {},
        { historyMonths: 16 },
      );
      mocks.querySearchAnalytics.mockClear();
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(readCalls("page")).toEqual([
        expect.objectContaining({
          startDate: "2026-07-13",
          endDate: "2026-07-17",
        }),
        expect.objectContaining({
          startDate: "2026-07-18",
          endDate: "2026-10-15",
        }),
      ]);
    });

    it("keeps each page's top queries per finished week, by impressions then clicks", async () => {
      await onlySteps(
        { builderBlog: true, searchConsole: true, searchConsoleQueries: true },
        BLOG,
        {},
        {},
        { queriesPerPage: 3 },
      );
      feed(article("a1"));
      const unlisted = "https://www.builder.io/blog/unlisted";
      const query = (
        date: string,
        page: string,
        text: string,
        clicks: number,
        impressions: number,
        position: number,
      ) => ({ date, page, query: text, clicks, impressions, position });
      searchConsoleRows(
        [{ date: "2026-10-12", page: POST, clicks: 5, impressions: 20 }],
        [
          query("2026-10-05", POST, "headless cms", 2, 10, 3),
          query("2026-10-11", POST, "headless cms", 1, 30, 7),
          query("2026-10-06", POST, "seen not clicked", 0, 500, 12),
          query("2026-10-06", POST, "tie a", 1, 5, 9),
          query("2026-10-06", POST, "tie b", 2, 5, 9),
          query("2026-10-12", POST, "unfinished week", 9, 90, 1),
          query("2026-09-29", unlisted, "older", 1, 2, 1),
        ],
      );

      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(ran(summaries).map((summary) => summary.status)).toEqual([
        "succeeded",
        "succeeded",
        "succeeded",
      ]);
      expect(await queryRows()).toEqual([
        {
          external_id: "builder.io/blog/unlisted",
          week_start: "2026-09-28",
          query: "older",
          clicks: 1,
          impressions: 2,
          position_weighted: 2,
        },
        {
          external_id: "a1",
          week_start: "2026-10-05",
          query: "seen not clicked",
          clicks: 0,
          impressions: 500,
          position_weighted: 6000,
        },
        {
          external_id: "a1",
          week_start: "2026-10-05",
          query: "headless cms",
          clicks: 3,
          impressions: 40,
          position_weighted: 240,
        },
        {
          external_id: "a1",
          week_start: "2026-10-05",
          query: "tie b",
          clicks: 2,
          impressions: 5,
          position_weighted: 45,
        },
      ]);
      const days = queryDays();
      expect(days).toHaveLength(28);
      expect(new Set(days).size).toBe(28);
      expect([days[0], days[days.length - 1]]).toEqual([
        "2026-09-14",
        "2026-10-11",
      ]);
      expect(
        readCalls("query").every((args) => args.startDate === args.endDate),
      ).toBe(true);
      expect(await runWindows("search_console_queries")).toEqual([
        {
          window_start: "2026-09-14",
          window_end: "2026-10-11",
          row_count: 4,
          detail: null,
        },
      ]);

      mocks.querySearchAnalytics.mockClear();
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      const again = queryDays();
      expect([again[0], again[again.length - 1], again.length]).toEqual([
        "2026-09-28",
        "2026-10-11",
        14,
      ]);
      expect(await queryRows()).toHaveLength(4);
    });

    it("reads the last two weeks again and fills older weeks a few per run", async () => {
      await onlySteps(
        { builderBlog: true, searchConsole: true, searchConsoleQueries: true },
        BLOG,
        {},
        {},
        { historyMonths: 16 },
      );
      feed(article("a1"));
      const pages = [
        { date: "2026-10-12", page: POST, clicks: 5, impressions: 20 },
      ];
      const kept = {
        date: "2026-09-30",
        page: POST,
        query: "kept",
        clicks: 1,
        impressions: 3,
        position: 2,
      };
      const lateData = {
        date: "2026-10-06",
        page: POST,
        query: "late data",
        clicks: 1,
        impressions: 10,
        position: 4,
      };
      searchConsoleRows(pages, [kept, lateData]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      const first = queryDays();
      expect([first[0], first[first.length - 1], first.length]).toEqual([
        "2026-08-17",
        "2026-10-11",
        56,
      ]);

      mocks.querySearchAnalytics.mockClear();
      searchConsoleRows(
        [
          ...pages,
          { date: "2026-10-19", page: POST, clicks: 1, impressions: 2 },
        ],
        [kept, { ...lateData, clicks: 4, impressions: 12 }],
      );
      await collectContentForAllTenants({
        now: new Date("2026-10-22T07:00:00Z"),
      });
      const days = queryDays();
      expect(days).toHaveLength(56);
      expect([days[0], days[days.length - 1]]).toEqual([
        "2026-07-06",
        "2026-10-18",
      ]);
      expect(
        days.filter((day) => day >= "2026-08-17" && day < "2026-10-05"),
      ).toEqual([]);
      expect(await queryRows()).toEqual([
        {
          external_id: "a1",
          week_start: "2026-09-28",
          query: "kept",
          clicks: 1,
          impressions: 3,
          position_weighted: 6,
        },
        {
          external_id: "a1",
          week_start: "2026-10-05",
          query: "late data",
          clicks: 4,
          impressions: 12,
          position_weighted: 48,
        },
      ]);
      expect(
        (await runWindows("search_console_queries")).map((run) => [
          run.window_start,
          run.window_end,
        ]),
      ).toEqual([
        ["2026-08-17", "2026-10-11"],
        ["2026-07-06", "2026-10-18"],
      ]);
    });

    it("lets the first property with rows own a page's day when properties overlap", async () => {
      await onlySteps(
        { builderBlog: true, searchConsole: true, searchConsoleQueries: true },
        [
          { siteUrl: "sc-domain:builder.io" },
          { siteUrl: "https://www.builder.io/" },
        ],
      );
      feed(article("a1"));
      const row = (
        siteUrl: string,
        date: string,
        clicks: number,
        impressions: number,
        position: number,
      ) => ({
        siteUrl,
        date,
        page: POST,
        query: "builder",
        clicks,
        impressions,
        position,
      });
      searchConsoleRows(
        [{ date: "2026-10-12", page: POST, clicks: 5, impressions: 20 }],
        [
          row("sc-domain:builder.io", "2026-10-06", 2, 10, 1),
          row("https://www.builder.io/", "2026-10-06", 7, 70, 1),
          row("https://www.builder.io/", "2026-10-07", 1, 5, 3),
        ],
      );
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      expect(await queryRows()).toEqual([
        {
          external_id: "a1",
          week_start: "2026-10-05",
          query: "builder",
          clicks: 3,
          impressions: 15,
          position_weighted: 25,
        },
      ]);
    });

    it("counts a page once when one property is listed twice with different paths", async () => {
      await onlySteps(
        { builderBlog: true, searchConsole: true, searchConsoleQueries: true },
        [
          { siteUrl: "sc-domain:builder.io", pathPrefix: "/blog/" },
          { siteUrl: "sc-domain:builder.io", pathPrefix: "/blog/post" },
        ],
      );
      feed(article("a1"));
      searchConsoleRows(
        [{ date: "2026-10-12", page: POST, clicks: 5, impressions: 20 }],
        [
          {
            date: "2026-10-06",
            page: POST,
            query: "builder",
            clicks: 2,
            impressions: 100,
            position: 4,
          },
        ],
      );
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      expect(await queryRows()).toEqual([
        {
          external_id: "a1",
          week_start: "2026-10-05",
          query: "builder",
          clicks: 2,
          impressions: 100,
          position_weighted: 400,
        },
      ]);
      expect(await snapshots("search_console_clicks")).toEqual([
        {
          external_id: "a1",
          metric_date: "2026-10-12",
          value: 5,
          source: "search_console",
        },
      ]);
    });

    it("says which days hit Search Console's daily row limit", async () => {
      await onlySteps(
        { builderBlog: true, searchConsole: true, searchConsoleQueries: true },
        BLOG,
      );
      feed(article("a1"));
      searchConsoleRows(
        [{ date: "2026-10-12", page: POST, clicks: 5, impressions: 20 }],
        Array.from({ length: 50_000 }, (_, index) => ({
          date: "2026-10-06",
          page: POST,
          query: `query ${index}`,
          clicks: 1,
          impressions: 1,
        })),
      );
      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      expect(
        summaries.find((summary) => summary.step === "search_console_queries")
          ?.status,
      ).toBe("succeeded");
      expect(await runWindows("search_console_queries")).toEqual([
        expect.objectContaining({
          row_count: 25,
          detail:
            "Search Console stopped at its 50,000-row daily limit on 1 day (2026-10-06 (sc-domain:builder.io)), so less-clicked queries are missing there.",
        }),
      ]);
    });

    it("waits for Search Console's daily page numbers under the current properties before reading queries", async () => {
      await onlySteps(
        { searchConsole: true, searchConsoleQueries: true },
        BLOG,
      );
      searchConsoleRows([
        { date: "2026-10-12", page: POST, clicks: 5, impressions: 20 },
      ]);
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      await onlySteps({ searchConsole: true, searchConsoleQueries: true }, [
        { siteUrl: "https://www.builder.io/" },
      ]);
      mocks.querySearchAnalytics.mockReset();
      mocks.querySearchAnalytics.mockRejectedValue(
        new Error("Search Console API error 500"),
      );
      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(
        ran(summaries).map((summary) => [summary.step, summary.status]),
      ).toEqual([
        ["search_console", "failed"],
        ["search_console_queries", "not_configured"],
      ]);
      expect(readCalls("query")).toEqual([]);
      expect(
        await rows(
          "SELECT error_code, error_message FROM analytics_content_collection_runs WHERE step = 'search_console_queries' AND status = 'not_configured'",
        ),
      ).toEqual([
        {
          error_code: "waiting_for_search_console_pages",
          error_message:
            "Waiting for Search Console's daily page numbers, which say which weeks are final.",
        },
      ]);
    });
  });

  describe("signups", () => {
    const WAREHOUSE: Partial<SignupsConfig> = {
      signupEventsTable: "example-project.analytics.events",
      firstPageviewsTable: "example-project.staging.first_pageviews",
      signupSource: "example-app",
      signupsSince: "2026-05-18",
    };

    it("reads signups only from the window's first day, or signupsSince if later", () => {
      const tables = {
        signupEventsTable: "example-project.analytics.events",
        firstPageviewsTable: "example-project.staging.first_pageviews",
        signupSource: "example-app",
      };
      const now = new Date("2026-10-19T07:00:00Z");

      const early = buildSignupsQuery(
        { ...tables, signupsSince: "2026-05-18" },
        now,
      );
      expect(early.startDate).toBe("2026-07-21");
      expect(early.sql).toContain("createdDate >= TIMESTAMP('2026-07-21')");
      expect(early.sql).not.toContain("2026-05-18");

      const late = buildSignupsQuery(
        { ...tables, signupsSince: "2026-09-01" },
        now,
      );
      expect(late.sql).toContain("createdDate >= TIMESTAMP('2026-09-01')");
    });

    it("joins each signup only to visits at or before that signup", () => {
      const { sql } = buildSignupsQuery(
        {
          ...WAREHOUSE,
          signupEventsTable: "example-project.analytics.events",
          firstPageviewsTable: "example-project.staging.first_pageviews",
          signupSource: "example-app",
          signupsSince: "2026-05-18",
        },
        new Date("2026-10-19T07:00:00Z"),
      );
      expect(sql).toContain("createdDate AS signup_at");
      expect(sql).toContain("GROUP BY 1, 2, 3");
      expect(sql).toContain(
        "visitor_id, created_date, DATE(created_date) AS day",
      );
      expect(sql).toContain(
        "s.visitor_id = v.visitor_id AND s.signup_at >= v.created_date",
      );
      expect(sql).toContain("COUNT(DISTINCT s.user_id) AS signups");
      expect(sql).toContain(
        "COUNT(DISTINCT IF(s.from_source, s.user_id, NULL)) AS source_signups",
      );
    });

    it("matches the blog host boundary rather than a URL substring", () => {
      const { sql } = buildSignupsQuery(
        {
          signupEventsTable: "example-project.analytics.events",
          firstPageviewsTable: "example-project.staging.first_pageviews",
          signupSource: "example-app",
          signupsSince: "2026-05-18",
        },
        new Date("2026-10-19T07:00:00Z"),
      );
      const pattern = /REGEXP_CONTAINS\(url, r'([^']+)'\)/.exec(sql)?.[1];
      expect(pattern).toBeDefined();
      const matches = new RegExp(pattern!);
      expect(matches.test("https://www.builder.io/blog/post-a1")).toBe(true);
      expect(matches.test("http://builder.io/blog/post-a1")).toBe(true);
      for (const url of [
        "https://evilbuilder.io/blog/post-a1",
        "https://builder.io.evil.test/blog/post-a1",
        "https://evil.test/builder.io/blog/post-a1",
        "https://evil.test/?next=https://builder.io/blog/post-a1",
      ])
        expect(matches.test(url)).toBe(false);
    });

    it("stays not set up, and runs no dry run, until a cap is saved", async () => {
      await onlySteps({ builderBlog: true, signups: true }, [], WAREHOUSE);
      feed(article("a1"));

      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(ran(summaries)).toEqual([
        expect.objectContaining({ step: "builder_blog", status: "succeeded" }),
        expect.objectContaining({ step: "signups", status: "not_configured" }),
      ]);
      expect(
        await rows(
          "SELECT error_code FROM analytics_content_collection_runs WHERE step = 'signups'",
        ),
      ).toEqual([{ error_code: "signups_not_configured" }]);
      expect(mocks.dryRunQuerySchema).not.toHaveBeenCalled();
      expect(mocks.runQuery).not.toHaveBeenCalled();
    });

    it("stops as cost-limited when the dry run is over the cap, without running the join", async () => {
      await onlySteps({ builderBlog: true, signups: true }, [], {
        ...WAREHOUSE,
        maxBytesBilled: 1_000,
      });
      feed(article("a1"));
      mocks.dryRunQuerySchema.mockResolvedValueOnce({
        error: null,
        totalBytesProcessed: 5_000,
      });

      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(ran(summaries)[1]).toEqual(
        expect.objectContaining({ step: "signups", status: "cost_limited" }),
      );
      expect(
        await rows(
          "SELECT error_code, error_message, bytes_processed, bytes_cap FROM analytics_content_collection_runs WHERE step = 'signups'",
        ),
      ).toEqual([
        {
          error_code: "signups_bytes_cap",
          bytes_processed: 0,
          bytes_cap: 1_000,
          error_message:
            "The signups join would scan 5000 bytes, over the 1000-byte cap. Nothing ran.",
        },
      ]);
      expect(mocks.runQuery).not.toHaveBeenCalled();
      expect(await snapshots("signups_first_touch")).toEqual([]);
    });

    it("records BigQuery stopping the join at the cap as cost-limited", async () => {
      await onlySteps({ builderBlog: true, signups: true }, [], {
        ...WAREHOUSE,
        maxBytesBilled: 1_000,
      });
      feed(article("a1"));
      mocks.dryRunQuerySchema.mockResolvedValueOnce({
        error: null,
        totalBytesProcessed: 900,
      });
      mocks.runQuery.mockRejectedValueOnce(
        new BigQueryMaximumBytesBilledError(),
      );

      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(ran(summaries)[1]).toEqual(
        expect.objectContaining({ step: "signups", status: "cost_limited" }),
      );
      expect(
        await rows(
          "SELECT bytes_processed, bytes_cap FROM analytics_content_collection_runs WHERE step = 'signups'",
        ),
      ).toEqual([{ bytes_processed: null, bytes_cap: 1_000 }]);
    });

    it.each([
      { name: "dry-run error", dryRun: { error: "unavailable" }, bytes: 0 },
      { name: "missing estimate", dryRun: { error: null }, bytes: 0 },
      {
        name: "query error",
        queryError: new Error("query unavailable"),
        bytes: null,
      },
      { name: "truncated result", result: { truncated: true }, bytes: 400 },
      {
        name: "row limit",
        result: { rows: Array(200_000).fill({}) },
        bytes: 400,
      },
      {
        name: "invalid signup count",
        result: {
          rows: [
            {
              data_through: "2026-10-13",
              handle: "post-a1",
              day: "2026-10-13",
              signups: Symbol("invalid-count"),
            },
          ],
        },
        bytes: 400,
      },
    ])(
      "keeps the cap and known usage after $name",
      async ({ dryRun, queryError, result, bytes }) => {
        await onlySteps({ builderBlog: true, signups: true }, [], {
          ...WAREHOUSE,
          maxBytesBilled: 1_000,
        });
        feed(article("a1"));
        mocks.dryRunQuerySchema.mockResolvedValueOnce(
          dryRun ?? { error: null, totalBytesProcessed: 900 },
        );
        if (queryError) mocks.runQuery.mockRejectedValueOnce(queryError);
        else
          mocks.runQuery.mockResolvedValueOnce({
            rows: [],
            totalRows: 0,
            schema: [],
            bytesProcessed: 400,
            ...result,
          });

        const summaries = await collectContentForAllTenants({
          now: new Date("2026-10-15T07:00:00Z"),
        });

        expect(ran(summaries)[1]).toMatchObject({
          step: "signups",
          status: "failed",
        });
        expect(
          await rows(
            "SELECT bytes_processed, bytes_cap FROM analytics_content_collection_runs WHERE step = 'signups'",
          ),
        ).toEqual([{ bytes_processed: bytes, bytes_cap: 1_000 }]);
        expect(mocks.runQuery).toHaveBeenCalledTimes(dryRun ? 0 : 1);
        expect(await snapshots("signups_first_touch")).toEqual([]);
      },
    );

    it.each([
      { bytesProcessed: 0, cached: false, expected: 0 },
      { bytesProcessed: undefined, cached: false, expected: null },
      { bytesProcessed: 400, cached: true, expected: 0 },
      { bytesProcessed: undefined, cached: true, expected: 0 },
    ])(
      "records $expected bytes for cached=$cached and returned usage=$bytesProcessed",
      async ({ bytesProcessed, cached, expected }) => {
        await onlySteps({ builderBlog: true, signups: true }, [], {
          ...WAREHOUSE,
          maxBytesBilled: 1_000,
        });
        feed(article("a1"));
        mocks.dryRunQuerySchema.mockResolvedValueOnce({
          error: null,
          totalBytesProcessed: 900,
        });
        mocks.runQuery.mockResolvedValueOnce({
          rows: [],
          totalRows: 0,
          schema: [],
          bytesProcessed,
          cached,
        });

        await collectContentForAllTenants({
          now: new Date("2026-10-15T07:00:00Z"),
        });

        expect(
          await rows(
            "SELECT status, bytes_processed, bytes_cap FROM analytics_content_collection_runs WHERE step = 'signups'",
          ),
        ).toEqual([
          {
            status: "succeeded",
            bytes_processed: expected,
            bytes_cap: 1_000,
          },
        ]);
      },
    );

    it("keeps actual query usage when saving snapshots fails", async () => {
      await onlySteps({ builderBlog: true, signups: true }, [], {
        ...WAREHOUSE,
        maxBytesBilled: 1_000,
      });
      feed(article("a1", { publishDate: "2026-10-13T00:00:00.000Z" }));
      await client.exec(
        "ALTER TABLE analytics_content_metric_snapshots ADD CONSTRAINT reject_signups CHECK (source <> 'signups')",
      );
      mocks.dryRunQuerySchema.mockResolvedValueOnce({
        error: null,
        totalBytesProcessed: 900,
      });
      mocks.runQuery.mockResolvedValueOnce({
        rows: [
          {
            data_through: "2026-10-13",
            handle: "post-a1",
            day: "2026-10-13",
            signups: 2,
            source_signups: 1,
          },
        ],
        totalRows: 1,
        schema: [],
        bytesProcessed: 400,
      });

      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(ran(summaries)[1]).toMatchObject({
        step: "signups",
        status: "failed",
      });
      expect(
        await rows(
          "SELECT status, bytes_processed, bytes_cap FROM analytics_content_collection_runs WHERE step = 'signups'",
        ),
      ).toEqual([{ status: "failed", bytes_processed: 400, bytes_cap: 1_000 }]);
      expect(await snapshots("signups_first_touch")).toEqual([]);
    });

    it("writes first-touch signups per article by visit day, zero only through the warehouse's last day", async () => {
      await onlySteps({ builderBlog: true, signups: true }, [], {
        ...WAREHOUSE,
        maxBytesBilled: 1_000,
      });
      feed(
        article("a1", { publishDate: "2026-10-10T00:00:00.000Z" }),
        article("a2", { publishDate: "2026-10-13T00:00:00.000Z" }),
      );
      mocks.dryRunQuerySchema.mockResolvedValueOnce({
        error: null,
        totalBytesProcessed: 900,
      });
      mocks.runQuery.mockResolvedValueOnce({
        rows: [
          {
            data_through: "2026-10-13",
            handle: "post-a1",
            day: "2026-10-11",
            signups: 2,
            source_signups: 1,
          },
          {
            data_through: "2026-10-13",
            handle: "POST-A1",
            day: "2026-10-13",
            signups: 1,
            source_signups: 0,
          },
          {
            data_through: "2026-10-13",
            handle: "retired-post",
            day: "2026-10-12",
            signups: 4,
          },
        ],
        totalRows: 3,
        schema: [],
        bytesProcessed: 400,
      });

      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      const [sql, options] = mocks.runQuery.mock.calls[0] as [
        string,
        { maxBytesBilled: number },
      ];
      expect(options.maxBytesBilled).toBe(1_000);
      expect(
        await rows(
          "SELECT status, bytes_processed, bytes_cap FROM analytics_content_collection_runs WHERE step = 'signups'",
        ),
      ).toEqual([
        { status: "succeeded", bytes_processed: 400, bytes_cap: 1_000 },
      ]);
      expect(sql).toContain("`example-project.analytics.events`");
      expect(sql).toContain("TIMESTAMP('2026-07-17')");
      expect(sql).toContain("DATE '2026-10-14'");
      expect(sql).toContain(
        "JSON_VALUE(data, '$.signupSource') = 'example-app'",
      );
      expect(
        (await snapshots("signups_first_touch_source")).map((row) => [
          row.external_id,
          row.metric_date,
          row.value,
        ]),
      ).toEqual([
        ["a1", "2026-10-10", 0],
        ["a1", "2026-10-11", 1],
        ["a1", "2026-10-12", 0],
        ["a1", "2026-10-13", 0],
        ["a2", "2026-10-13", 0],
      ]);
      expect(await snapshots("signups_first_touch")).toEqual([
        {
          external_id: "a1",
          metric_date: "2026-10-10",
          value: 0,
          source: "signups",
        },
        {
          external_id: "a1",
          metric_date: "2026-10-11",
          value: 2,
          source: "signups",
        },
        {
          external_id: "a1",
          metric_date: "2026-10-12",
          value: 0,
          source: "signups",
        },
        {
          external_id: "a1",
          metric_date: "2026-10-13",
          value: 1,
          source: "signups",
        },
        {
          external_id: "a2",
          metric_date: "2026-10-13",
          value: 0,
          source: "signups",
        },
      ]);
    });

    it("matches URL-encoded warehouse handles to collected article URLs", async () => {
      await onlySteps({ builderBlog: true, signups: true }, [], {
        ...WAREHOUSE,
        maxBytesBilled: 1_000,
      });
      feed(
        article("a1", {
          handle: "café",
          publishDate: "2026-10-13T00:00:00.000Z",
        }),
      );
      mocks.dryRunQuerySchema.mockResolvedValueOnce({
        error: null,
        totalBytesProcessed: 900,
      });
      mocks.runQuery.mockResolvedValueOnce({
        rows: [
          {
            data_through: "2026-10-13",
            handle: "caf%C3%A9",
            day: "2026-10-13",
            signups: 2,
            source_signups: 1,
          },
        ],
        totalRows: 1,
        schema: [],
        bytesProcessed: 900,
      });
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      expect(await snapshots("signups_first_touch")).toEqual([
        expect.objectContaining({
          external_id: "a1",
          metric_date: "2026-10-13",
          value: 2,
        }),
      ]);
      expect(await snapshots("signups_first_touch_source")).toEqual([
        expect.objectContaining({
          external_id: "a1",
          metric_date: "2026-10-13",
          value: 1,
        }),
      ]);
    });

    it("rewrites only the days whose signups changed when the window is recomputed", async () => {
      await onlySteps({ builderBlog: true, signups: true }, [], {
        ...WAREHOUSE,
        maxBytesBilled: 1_000,
      });
      feed(article("a1", { publishDate: "2026-10-10T00:00:00.000Z" }));
      mocks.dryRunQuerySchema.mockResolvedValue({
        error: null,
        totalBytesProcessed: 900,
      });
      const result = (rows: Array<Record<string, unknown>>) => ({
        rows,
        totalRows: rows.length,
        schema: [],
        bytesProcessed: 900,
      });
      mocks.runQuery.mockResolvedValueOnce(
        result([
          {
            data_through: "2026-10-12",
            handle: "post-a1",
            day: "2026-10-11",
            signups: 2,
          },
        ]),
      );
      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });
      // A later signup credits 10-12, an earlier visit day; 10-10 and 10-11 are unchanged.
      mocks.runQuery.mockResolvedValueOnce(
        result([
          {
            data_through: "2026-10-13",
            handle: "post-a1",
            day: "2026-10-11",
            signups: 2,
          },
          {
            data_through: "2026-10-13",
            handle: "post-a1",
            day: "2026-10-12",
            signups: 1,
          },
        ]),
      );
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });

      const runs = await rows(
        "SELECT id FROM analytics_content_collection_runs WHERE step = 'signups' ORDER BY started_at",
      );
      expect(runs).toHaveLength(2);
      const [first, second] = runs.map((run) => run.id);
      expect(
        await rows(
          "SELECT metric_date, value, run_id FROM analytics_content_metric_snapshots WHERE metric = 'signups_first_touch' ORDER BY metric_date",
        ),
      ).toEqual([
        { metric_date: "2026-10-10", value: 0, run_id: first },
        { metric_date: "2026-10-11", value: 2, run_id: first },
        { metric_date: "2026-10-12", value: 1, run_id: second },
        { metric_date: "2026-10-13", value: 0, run_id: second },
      ]);
    });

    it("parses a signups update without filling in what it leaves out", async () => {
      const { signupsSettingsUpdateSchema } = await import("./config.js");
      // configure-content-collection spreads this over the saved settings, so
      // a default here would reset a saved table or cap to null.
      expect(signupsSettingsUpdateSchema.parse({ enabled: false })).toEqual({
        enabled: false,
      });
    });
  });
  describe("Agent-Native signups", () => {
    const EVENTS = { eventsTable: "example-project.analytics.events_raw" };

    it("reads the organization's own tagged signups for the window, without test identities", () => {
      const { sql } = buildAgentNativeSignupsQuery(
        { eventsTable: "example-project.analytics.events_raw", orgId: "org_a" },
        { startDate: "2026-07-17", endDate: "2026-10-14" },
      );
      expect(sql).toContain("FROM `example-project.analytics.events_raw`");
      expect(sql).toContain("event_name = 'signup' AND org_id = 'org_a'");
      expect(sql).toContain(
        "event_date BETWEEN DATE '2026-07-17' AND DATE '2026-10-14'",
      );
      expect(sql).toContain("AND NOT is_test_identity(user_id)");
      expect(sql).toContain(
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) = 1",
      );
      expect(sql).toContain(
        "utm_source IN ('builder.io', 'www.builder.io') AND utm_content != ''",
      );
      expect(sql).toContain("COUNT(DISTINCT person) AS signups");
    });

    it("dates the window by the organization's newest event of any kind, not its newest signup", () => {
      const { sql } = buildAgentNativeSignupsQuery(
        { eventsTable: "example-project.analytics.events_raw", orgId: "org_a" },
        { startDate: "2026-07-17", endDate: "2026-10-14" },
      );
      expect(sql).toContain(
        "SELECT FORMAT_DATE('%F', MAX(event_date)) AS data_through\n  FROM `example-project.analytics.events_raw`\n  WHERE org_id = 'org_a'\n    AND event_date BETWEEN DATE '2026-07-17' AND DATE '2026-10-14'\n), counts AS",
      );
    });

    it("needs a collection that belongs to an organization", () => {
      expect(() =>
        agentNativeSignupsSource(
          agentNativeSignupsConfigSchema.parse({ enabled: true, ...EVENTS }),
          { orgId: null },
        ),
      ).toThrow(/belongs to an organization/);
    });

    it("stays not set up, and runs no dry run, until a table and a cap are saved", async () => {
      await onlySteps(
        { builderBlog: true, agentNativeSignups: true },
        [],
        {},
        EVENTS,
      );
      feed(article("a1"));

      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(ran(summaries)).toEqual([
        expect.objectContaining({ step: "builder_blog", status: "succeeded" }),
        expect.objectContaining({
          step: "agent_native_signups",
          status: "not_configured",
        }),
      ]);
      expect(
        await rows(
          "SELECT error_code FROM analytics_content_collection_runs WHERE step = 'agent_native_signups'",
        ),
      ).toEqual([{ error_code: "agent_native_signups_not_configured" }]);
      expect(mocks.dryRunQuerySchema).not.toHaveBeenCalled();
      expect(mocks.runQuery).not.toHaveBeenCalled();
    });

    it("stops as cost-limited when the dry run is over the cap, without running the query", async () => {
      await onlySteps(
        { builderBlog: true, agentNativeSignups: true },
        [],
        {},
        {
          ...EVENTS,
          maxBytesBilled: 1_000,
        },
      );
      feed(article("a1"));
      mocks.dryRunQuerySchema.mockResolvedValueOnce({
        error: null,
        totalBytesProcessed: 5_000,
      });

      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(
        await rows(
          "SELECT status, error_code, bytes_processed, bytes_cap FROM analytics_content_collection_runs WHERE step = 'agent_native_signups'",
        ),
      ).toEqual([
        {
          status: "cost_limited",
          error_code: "agent_native_signups_bytes_cap",
          bytes_processed: 0,
          bytes_cap: 1_000,
        },
      ]);
      expect(mocks.runQuery).not.toHaveBeenCalled();
      expect(await snapshots("agent_native_signups")).toEqual([]);
    });

    it("credits only tags that name a collected article, by signup day, then reads only recent days", async () => {
      await onlySteps(
        { builderBlog: true, agentNativeSignups: true },
        [],
        {},
        {
          ...EVENTS,
          maxBytesBilled: 1_000,
        },
      );
      feed(
        article("a1", { publishDate: "2026-10-10T00:00:00.000Z" }),
        article("a2", { publishDate: "2026-10-13T00:00:00.000Z" }),
      );
      mocks.dryRunQuerySchema.mockResolvedValue({
        error: null,
        totalBytesProcessed: 900,
      });
      mocks.runQuery.mockResolvedValueOnce({
        rows: [
          {
            data_through: "2026-10-14",
            tag: "post-a1",
            day: "2026-10-11",
            signups: 3,
          },
          {
            data_through: "2026-10-14",
            tag: "post-a2",
            day: "2026-10-14",
            signups: 1,
          },
          {
            data_through: "2026-10-14",
            tag: "/hackathon",
            day: "2026-10-12",
            signups: 9,
          },
        ],
        totalRows: 3,
        schema: [],
        bytesProcessed: 400,
      });

      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      const [sql, options] = mocks.runQuery.mock.calls[0] as [
        string,
        { maxBytesBilled: number },
      ];
      expect(options.maxBytesBilled).toBe(1_000);
      expect(sql).toContain(
        "event_date BETWEEN DATE '2026-07-17' AND DATE '2026-10-14'",
      );
      expect(
        (await snapshots("agent_native_signups")).map((row) => [
          row.external_id,
          row.metric_date,
          row.value,
          row.source,
        ]),
      ).toEqual([
        ["a1", "2026-10-10", 0, "agent_native_signups"],
        ["a1", "2026-10-11", 3, "agent_native_signups"],
        ["a1", "2026-10-12", 0, "agent_native_signups"],
        ["a1", "2026-10-13", 0, "agent_native_signups"],
        ["a1", "2026-10-14", 0, "agent_native_signups"],
        ["a2", "2026-10-13", 0, "agent_native_signups"],
        ["a2", "2026-10-14", 1, "agent_native_signups"],
      ]);
      expect(
        await rows(
          "SELECT status, window_end, bytes_processed FROM analytics_content_collection_runs WHERE step = 'agent_native_signups'",
        ),
      ).toEqual([
        { status: "succeeded", window_end: "2026-10-14", bytes_processed: 400 },
      ]);

      mocks.runQuery.mockResolvedValueOnce({
        rows: [
          { data_through: "2026-10-15", tag: null, day: null, signups: null },
        ],
        totalRows: 1,
        schema: [],
        bytesProcessed: 50,
      });
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(mocks.runQuery.mock.calls[1]?.[0]).toContain(
        "event_date BETWEEN DATE '2026-10-13' AND DATE '2026-10-15'",
      );
      expect(
        (await snapshots("agent_native_signups")).filter(
          (row) => row.external_id === "a1",
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ metric_date: "2026-10-11", value: 3 }),
          expect.objectContaining({ metric_date: "2026-10-15", value: 0 }),
        ]),
      );
    });

    it("matches tags to handles across case and escapes, and credits neither of two articles that share one", async () => {
      await onlySteps(
        { builderBlog: true, agentNativeSignups: true },
        [],
        {},
        { ...EVENTS, maxBytesBilled: 1_000 },
      );
      feed(
        article("a1", { handle: "Foo" }),
        article("a2", { handle: "foo" }),
        article("a3", { handle: "hello world" }),
      );
      mocks.dryRunQuerySchema.mockResolvedValue({
        error: null,
        totalBytesProcessed: 900,
      });
      mocks.runQuery.mockResolvedValueOnce({
        rows: [
          {
            data_through: "2026-10-14",
            tag: "foo",
            day: "2026-10-12",
            signups: 4,
          },
          {
            data_through: "2026-10-14",
            tag: "hello%20world",
            day: "2026-10-13",
            signups: 2,
          },
        ],
        totalRows: 2,
        schema: [],
        bytesProcessed: 400,
      });

      await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(
        (await snapshots("agent_native_signups"))
          .filter((row) => Number(row.value) > 0)
          .map((row) => [row.external_id, row.metric_date, row.value]),
      ).toEqual([["a3", "2026-10-13", 2]]);
    });

    it("counts days with events but no signups as zeros, and keeps its place when no events landed", async () => {
      await onlySteps(
        { builderBlog: true, agentNativeSignups: true },
        [],
        {},
        { ...EVENTS, maxBytesBilled: 1_000 },
      );
      feed(article("a1"));
      mocks.dryRunQuerySchema.mockResolvedValue({
        error: null,
        totalBytesProcessed: 900,
      });
      const quiet = (dataThrough: string | null) => ({
        rows: [
          { data_through: dataThrough, tag: null, day: null, signups: null },
        ],
        totalRows: 1,
        schema: [],
        bytesProcessed: 50,
      });
      mocks.runQuery
        .mockResolvedValueOnce({
          rows: [
            {
              data_through: "2026-10-14",
              tag: "post-a1",
              day: "2026-10-14",
              signups: 1,
            },
          ],
          totalRows: 1,
          schema: [],
          bytesProcessed: 400,
        })
        .mockResolvedValueOnce(quiet("2026-10-17"))
        .mockResolvedValueOnce(quiet(null));

      for (const day of ["2026-10-15", "2026-10-18", "2026-10-19"]) {
        await collectContentForAllTenants({
          now: new Date(`${day}T07:00:00Z`),
        });
      }

      expect(mocks.runQuery.mock.calls[1]?.[0]).toContain(
        "event_date BETWEEN DATE '2026-10-15' AND DATE '2026-10-17'",
      );
      expect(mocks.runQuery.mock.calls[2]?.[0]).toContain(
        "event_date BETWEEN DATE '2026-10-16' AND DATE '2026-10-18'",
      );
      expect(
        await rows(
          "SELECT window_end FROM analytics_content_collection_runs WHERE step = 'agent_native_signups' ORDER BY started_at",
        ),
      ).toEqual([
        { window_end: "2026-10-14" },
        { window_end: "2026-10-17" },
        { window_end: "2026-10-17" },
      ]);
      expect(
        (await snapshots("agent_native_signups"))
          .filter((row) => String(row.metric_date) >= "2026-10-14")
          .map((row) => [row.metric_date, Number(row.value)]),
      ).toEqual([
        ["2026-10-14", 1],
        ["2026-10-15", 0],
        ["2026-10-16", 0],
        ["2026-10-17", 0],
      ]);
    });

    it.each(["p/d/t", "p`d`t", "p.d"])(
      "refuses %s as an events table",
      (eventsTable) => {
        expect(
          agentNativeSignupsConfigSchema.safeParse({
            enabled: true,
            eventsTable,
          }).success,
        ).toBe(false);
      },
    );

    it("parses an Agent-Native signups update without filling in what it leaves out", async () => {
      const { agentNativeSignupsSettingsUpdateSchema } =
        await import("./config.js");
      expect(
        agentNativeSignupsSettingsUpdateSchema.parse({ enabled: true }),
      ).toEqual({ enabled: true });
    });
  });
  describe("daily.dev", () => {
    it("counts sessions daily.dev sent to each article, from its tag or its site", async () => {
      await onlySteps({ builderBlog: true, dailyDev: true });
      feed(article("a1"), article("a2"));
      mocks.runFullReport.mockResolvedValueOnce([
        ga4Row("20261012", "/blog/post-a1?via=dailydev", 3),
        ga4Row("20261012", "/blog/post-a1/?utm_source=x&via=dailydev", 1),
        ga4Row("20261013", "/blog/post-a2", 2),
        ga4Row("20261013", "/blog/retired-post?via=dailydev", 9),
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
          propertyId: "123456789",
          dimensions: ["date", "landingPagePlusQueryString"],
          metrics: ["sessions"],
          dateRange: { startDate: "2026-07-17", endDate: "2026-10-14" },
        }),
      );
      const reports = JSON.stringify(mocks.runFullReport.mock.calls);
      expect(reports).toContain("via=dailydev");
      expect(reports).toContain("sessionSource");
      const visits = await snapshots("daily_dev_sessions");
      expect(visits.filter((row) => Number(row.value) > 0)).toEqual([
        {
          external_id: "a1",
          metric_date: "2026-10-12",
          value: 4,
          source: "daily_dev",
        },
        {
          external_id: "a2",
          metric_date: "2026-10-13",
          value: 2,
          source: "daily_dev",
        },
      ]);
      expect(visits).toHaveLength(28);
      expect(visits).toContainEqual({
        external_id: "a1",
        metric_date: "2026-10-14",
        value: 0,
        source: "daily_dev",
      });
      expect(await snapshots("ga4_pageviews")).toEqual([]);
      expect(
        await rows(
          "SELECT window_start, window_end, row_count FROM analytics_content_collection_runs WHERE step = 'daily_dev'",
        ),
      ).toEqual([
        { window_start: "2026-07-17", window_end: "2026-10-14", row_count: 28 },
      ]);

      mocks.runFullReport.mockResolvedValueOnce([]);
      await collectContentForAllTenants({
        now: new Date("2026-10-16T07:00:00Z"),
      });
      expect(mocks.runFullReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dateRange: { startDate: "2026-10-13", endDate: "2026-10-15" },
        }),
      );
      const reread = await snapshots("daily_dev_sessions");
      expect(reread).toHaveLength(30);
      expect(reread.filter((row) => Number(row.value) > 0)).toEqual([
        {
          external_id: "a1",
          metric_date: "2026-10-12",
          value: 4,
          source: "daily_dev",
        },
      ]);
    });

    it("takes daily.dev's own session sources, not names that only contain it", async () => {
      const { DAILY_DEV_SOURCE } = await import("./steps/daily-dev.js");
      const source = new RegExp(`^(?:${DAILY_DEV_SOURCE})$`, "i");
      for (const value of [
        "daily.dev",
        "app.daily.dev",
        "dailydev",
        "Daily-Dev",
      ]) {
        expect(source.test(value)).toBe(true);
      }
      for (const value of [
        "notdailydev",
        "daily.dev.example.com",
        "dailydevotional.com",
      ]) {
        expect(source.test(value)).toBe(false);
      }
    });

    it("waits for a GA4 property without querying the shared one", async () => {
      const collection = await onlySteps({ dailyDev: true });
      await writeContentCollection(ORG_A, {
        enabled: true,
        config: {
          ...collection.config,
          ga4: { enabled: false, propertyId: null },
        },
      });

      const summaries = await collectContentForAllTenants();

      expect(ran(summaries)).toEqual([
        expect.objectContaining({
          step: "daily_dev",
          status: "not_configured",
          reason: "ga4_property_not_configured",
        }),
      ]);
      expect(mocks.runFullReport).not.toHaveBeenCalled();
    });
  });

  describe("YouTube", () => {
    function youtubeVideo(id: string, overrides: Record<string, unknown> = {}) {
      return {
        id,
        channelId: "UCAN7TYzCJm1yd-QXbwKfoOg",
        channelTitle: "Builder",
        title: `Video ${id}`,
        publishedAt: "2026-10-01T12:00:00Z",
        durationSeconds: 813,
        viewCount: 100,
        likeCount: 5,
        commentCount: 2,
        ...overrides,
      };
    }

    it("stores each video with its counts to date under the stored owner, leaving a hidden count out", async () => {
      await onlySteps({ youtube: true }, [], {}, {}, {}, [
        "@Builderio",
        "UC80PWRj_ZU8Zu0HSMNVwKWw",
      ]);
      mocks.listYouTubeChannelVideos.mockResolvedValueOnce({
        channels: [
          {
            id: "UCAN7TYzCJm1yd-QXbwKfoOg",
            title: "Builder",
            uploadsPlaylistId: "UUAN7TYzCJm1yd-QXbwKfoOg",
          },
          {
            id: "UC80PWRj_ZU8Zu0HSMNVwKWw",
            title: "Codevolution",
            uploadsPlaylistId: "UU80PWRj_ZU8Zu0HSMNVwKWw",
          },
        ],
        videos: [
          youtubeVideo("v1"),
          youtubeVideo("v2", {
            channelId: "UC80PWRj_ZU8Zu0HSMNVwKWw",
            channelTitle: "Codevolution",
            durationSeconds: null,
            likeCount: null,
            commentCount: 0,
          }),
        ],
      });

      const summaries = await collectContentForAllTenants({
        now: new Date("2026-10-15T07:00:00Z"),
      });

      expect(ran(summaries)).toEqual([
        expect.objectContaining({ step: "youtube", status: "succeeded" }),
      ]);
      expect(mocks.listYouTubeChannelVideos).toHaveBeenCalledWith(
        ["@Builderio", "UC80PWRj_ZU8Zu0HSMNVwKWw"],
        expect.objectContaining({ maxVideos: 10_000 }),
      );
      expect(mocks.contexts).toEqual([
        { userEmail: "alice@example.test", orgId: "org_a" },
      ]);
      expect(
        await rows(
          "SELECT source, external_id, url, title, author, published_at, metadata FROM analytics_content_items ORDER BY external_id",
        ),
      ).toEqual([
        {
          source: "youtube",
          external_id: "v1",
          url: "https://www.youtube.com/watch?v=v1",
          title: "Video v1",
          author: "Builder",
          published_at: "2026-10-01T12:00:00Z",
          metadata:
            '{"channelId":"UCAN7TYzCJm1yd-QXbwKfoOg","durationSeconds":813}',
        },
        {
          source: "youtube",
          external_id: "v2",
          url: "https://www.youtube.com/watch?v=v2",
          title: "Video v2",
          author: "Codevolution",
          published_at: "2026-10-01T12:00:00Z",
          metadata:
            '{"channelId":"UC80PWRj_ZU8Zu0HSMNVwKWw","durationSeconds":null}',
        },
      ]);
      const read = (externalId: string, value: number) => ({
        external_id: externalId,
        metric_date: "2026-10-15",
        value,
        source: "youtube",
      });
      expect(await snapshots("youtube_views")).toEqual([
        read("v1", 100),
        read("v2", 100),
      ]);
      expect(await snapshots("youtube_likes")).toEqual([read("v1", 5)]);
      expect(await snapshots("youtube_comments")).toEqual([
        read("v1", 2),
        read("v2", 0),
      ]);
      expect(
        await rows(
          "SELECT status, row_count, detail, window_start, window_end FROM analytics_content_collection_runs WHERE step = 'youtube'",
        ),
      ).toEqual([
        {
          status: "succeeded",
          row_count: 5,
          detail: "2 videos from Builder, Codevolution.",
          window_start: "2026-10-15",
          window_end: "2026-10-15",
        },
      ]);
    });

    it("keeps one read per day, so the view can take the difference", async () => {
      await onlySteps({ youtube: true });
      for (const [now, views] of [
        ["2026-10-15T07:00:00Z", 100],
        ["2026-10-16T07:00:00Z", 130],
      ] as const) {
        mocks.listYouTubeChannelVideos.mockResolvedValueOnce({
          channels: [],
          videos: [youtubeVideo("v1", { viewCount: views })],
        });
        await collectContentForAllTenants({ now: new Date(now) });
      }
      expect(
        (await snapshots("youtube_views")).map((row) => [
          row.metric_date,
          row.value,
        ]),
      ).toEqual([
        ["2026-10-15", 100],
        ["2026-10-16", 130],
      ]);
    });

    it("saves nothing from a read whose channels changed mid-request", async () => {
      const collection = await onlySteps({ youtube: true });
      mocks.listYouTubeChannelVideos.mockImplementationOnce(async () => {
        await writeContentCollection(ORG_A, {
          enabled: true,
          config: {
            ...collection.config,
            youtube: { enabled: true, channels: ["UC80PWRj_ZU8Zu0HSMNVwKWw"] },
          },
        });
        return {
          channels: [
            {
              id: "UCAN7TYzCJm1yd-QXbwKfoOg",
              title: "Builder",
              uploadsPlaylistId: "UUAN7TYzCJm1yd-QXbwKfoOg",
            },
          ],
          videos: [youtubeVideo("v1")],
        };
      });

      expect(ran(await collectContentForAllTenants())).toEqual([
        expect.objectContaining({
          step: "youtube",
          status: "failed",
          reason: "content_config_changed",
        }),
      ]);
      expect(await rows("SELECT id FROM analytics_content_items")).toEqual([]);
    });

    it("records YouTube without channels, or without a saved key, as not set up", async () => {
      await onlySteps({ youtube: true }, [], {}, {}, {}, []);
      expect(ran(await collectContentForAllTenants())).toEqual([
        expect.objectContaining({
          step: "youtube",
          status: "not_configured",
          reason: "youtube_channels_not_configured",
        }),
      ]);
      expect(mocks.listYouTubeChannelVideos).not.toHaveBeenCalled();

      await onlySteps({ youtube: true });
      mocks.listYouTubeChannelVideos.mockRejectedValueOnce(
        Object.assign(
          new Error(
            "No YouTube Data API key is saved. Add one under Data Sources → YouTube.",
          ),
          { errorCode: "youtube_api_key_missing", statusCode: 424 },
        ),
      );
      expect(
        ran(
          await collectContentForAllTenants({
            now: new Date(Date.now() + 86_400_000),
          }),
        ),
      ).toEqual([
        expect.objectContaining({
          step: "youtube",
          status: "not_configured",
          reason: "youtube_api_key_missing",
        }),
      ]);
      expect(await rows("SELECT id FROM analytics_content_items")).toEqual([]);
    });
  });

  describe("X", () => {
    type FakePost = {
      id: string;
      authorId: string;
      createdAt: string;
      text: string;
      links?: Array<{ url: string; expanded_url: string; display_url: string }>;
      views: number;
    };
    const SPACED_BRAND = ["Agent", "Native"].join(" ");
    const USERS = new Map([
      ["builderio", { id: "1", username: "builderio" }],
      ["steve8708", { id: "2", username: "Steve8708" }],
    ]);
    let posts: FakePost[] = [];
    let requests: URL[] = [];
    let failWith: (url: URL) => { status: number; body: unknown } | null = () =>
      null;

    function first<T>(items: readonly T[]): T {
      const [item] = items;
      if (item === undefined) throw new Error("expected at least one item");
      return item;
    }

    function json(body: unknown, status = 200) {
      return new Response(JSON.stringify(body), { status });
    }

    function raw(post: FakePost) {
      return {
        id: post.id,
        text: post.text,
        created_at: post.createdAt,
        ...(post.links ? { entities: { urls: post.links } } : {}),
        public_metrics: {
          impression_count: post.views,
          like_count: 2,
          retweet_count: 1,
          reply_count: 1,
          quote_count: 0,
          bookmark_count: 0,
        },
      };
    }

    function newestFirst(a: FakePost, b: FakePost) {
      return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
    }

    function serveX() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL) => {
          const url = new URL(input);
          requests.push(url);
          const failure = failWith(url);
          if (failure) return json(failure.body, failure.status);
          if (url.pathname === "/2/users/by") {
            const names = (url.searchParams.get("usernames") ?? "").split(",");
            const found = names.flatMap((name) => {
              const user = USERS.get(name.toLowerCase());
              return user ? [{ ...user, name: user.username }] : [];
            });
            const missing = names.filter(
              (name) => !USERS.has(name.toLowerCase()),
            );
            return json({
              data: found,
              ...(missing.length > 0
                ? {
                    errors: missing.map((value) => ({
                      value,
                      title: "Not Found Error",
                    })),
                  }
                : {}),
            });
          }
          const timeline = /^\/2\/users\/(\d+)\/tweets$/.exec(url.pathname);
          if (timeline) {
            const sinceId = url.searchParams.get("since_id");
            const startTime = Date.parse(
              url.searchParams.get("start_time") ?? "",
            );
            const page = Number(url.searchParams.get("pagination_token") ?? 0);
            const size = Number(url.searchParams.get("max_results"));
            const matching = posts
              .filter(
                (post) =>
                  post.authorId === timeline[1] &&
                  (sinceId
                    ? BigInt(post.id) > BigInt(sinceId)
                    : Date.parse(post.createdAt) >= startTime),
              )
              .sort(newestFirst);
            const slice = matching.slice(page * size, (page + 1) * size);
            return json({
              ...(slice.length > 0 ? { data: slice.map(raw) } : {}),
              meta: {
                result_count: slice.length,
                ...(matching.length > (page + 1) * size
                  ? { next_token: String(page + 1) }
                  : {}),
              },
            });
          }
          if (url.pathname === "/2/tweets") {
            const ids = (url.searchParams.get("ids") ?? "").split(",");
            const found = posts.filter((post) => ids.includes(post.id));
            const missing = ids.filter(
              (id) => !found.some((post) => post.id === id),
            );
            return json({
              data: found.map(raw),
              ...(missing.length > 0
                ? {
                    errors: missing.map((id) => ({
                      resource_id: id,
                      title: "Not Found Error",
                    })),
                  }
                : {}),
            });
          }
          return json({ title: "Not Found" }, 404);
        }),
      );
    }

    function xOnly(x: Partial<ContentCollectionConfig["x"]> = {}) {
      return writeContentCollection(ORG_A, {
        enabled: true,
        config: {
          ...defaultContentCollectionConfig(),
          x: {
            enabled: true,
            accounts: [
              { handle: "@builderio", allPosts: true },
              { handle: "@Steve8708", allPosts: false },
            ],
            links: ["builder.io/blog", "agent-native.com"],
            terms: ["Builder.io", "@builderio", "Agent-Native", SPACED_BRAND],
            ...x,
          },
        },
      });
    }

    async function runX(now: string) {
      const collection = await readContentCollection(ORG_A);
      if (!collection) throw new Error("no content collection");
      return collectContentForCollection(collection, {
        trigger: "scheduled",
        now: new Date(now),
        steps: ["x"],
      });
    }

    async function spentBefore(costUsd: number, startedAt: string) {
      await client.query(
        "INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at, cost_usd) VALUES ($1, 'org:org_a', 'alice@example.test', 'org_a', 'x', 'scheduled', 'succeeded', $2, $3)",
        [`prior-${startedAt}`, startedAt, costUsd],
      );
    }

    function storedItemId(externalId: string) {
      const digest = createHash("sha256")
        .update(`org:org_a\u0000x\u0000${externalId}`)
        .digest("base64url");
      return `cci_${digest}`;
    }

    async function storeCountedPosts(
      entries: Array<{ id: string; publishedAt: string; lastReadAt: string }>,
    ) {
      for (const entry of entries) {
        await client.query(
          "INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, url, title, author, authors, published_at, metadata, relevance, first_seen_at, updated_at) VALUES ($1, 'org:org_a', 'alice@example.test', 'org_a', 'x', $2, $3, $4, '@builderio', '[\"@builderio\"]', $5, $6, 'counted', $7, $7)",
          [
            storedItemId(entry.id),
            entry.id,
            `https://x.com/builderio/status/${entry.id}`,
            `Post ${entry.id}`,
            entry.publishedAt,
            JSON.stringify({
              authorId: "1",
              username: "builderio",
              countedBy: "account",
              lastReadAt: entry.lastReadAt,
            }),
            entry.lastReadAt,
          ],
        );
        posts.push({
          id: entry.id,
          authorId: "1",
          createdAt: entry.publishedAt,
          text: `Post ${entry.id}`,
          views: 10,
        });
      }
    }

    function lookups() {
      return requests.filter((url) => url.pathname === "/2/tweets");
    }

    async function xRun() {
      return first(
        await rows(
          "SELECT status, error_code, error_message, cost_usd, detail, row_count FROM analytics_content_collection_runs WHERE step = 'x' AND id NOT LIKE 'prior-%' ORDER BY started_at DESC LIMIT 1",
        ),
      );
    }

    beforeEach(() => {
      posts = [];
      requests = [];
      failWith = () => null;
      serveX();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("stays off until an admin turns it on", async () => {
      await onlySteps({});
      const collection = await readContentCollection(ORG_A);
      if (!collection) throw new Error("no content collection");
      expect(
        await collectContentForCollection(collection, {
          trigger: "scheduled",
          now: new Date("2026-11-26T08:00:00.000Z"),
          steps: ["x"],
        }),
      ).toEqual([
        expect.objectContaining({
          step: "x",
          status: "skipped",
          reason: "step_disabled",
        }),
      ]);
      expect(requests).toEqual([]);
    });

    it("backfills 30 days of each account, counting every @builderio post and others only by the rule", async () => {
      await xOnly();
      posts = [
        {
          id: "1000",
          authorId: "1",
          createdAt: "2026-11-24T08:00:00.000Z",
          text: "Happy Thanksgiving from the team",
          views: 500,
        },
        {
          id: "1001",
          authorId: "1",
          createdAt: "2026-11-21T08:00:00.000Z",
          text: "Ship log",
          views: 900,
        },
        {
          id: "2000",
          authorId: "2",
          createdAt: "2026-11-25T08:00:00.000Z",
          text: "New article https://t.co/a",
          links: [
            {
              url: "https://t.co/a",
              expanded_url: "https://www.builder.io/blog/fusion",
              display_url: "builder.io/blog/fusion",
            },
          ],
          views: 300,
        },
        {
          id: "2001",
          authorId: "2",
          createdAt: "2026-11-23T08:00:00.000Z",
          text: "Every builder should read this",
          views: 50,
        },
        {
          id: "900",
          authorId: "2",
          createdAt: "2026-10-01T08:00:00.000Z",
          text: "An old Builder.io post",
          views: 10,
        },
      ];

      expect(await runX("2026-11-26T08:00:00.000Z")).toEqual([
        expect.objectContaining({ step: "x", status: "succeeded" }),
      ]);

      expect(requests.map((url) => url.pathname)).toEqual([
        "/2/users/by",
        "/2/users/1/tweets",
        "/2/users/2/tweets",
      ]);
      expect(first(requests).searchParams.get("usernames")).toBe(
        "builderio,Steve8708",
      );
      expect(Object.fromEntries(first(requests.slice(2)).searchParams)).toEqual(
        {
          max_results: "100",
          exclude: "retweets,replies",
          "tweet.fields": "created_at,public_metrics,entities,note_tweet",
          start_time: "2026-10-27T08:00:00Z",
        },
      );
      expect(
        await rows(
          "SELECT external_id, url, title, author, relevance, metadata FROM analytics_content_items ORDER BY external_id",
        ),
      ).toEqual([
        {
          external_id: "1000",
          url: "https://x.com/builderio/status/1000",
          title: "Happy Thanksgiving from the team",
          author: "@builderio",
          relevance: "counted",
          metadata:
            '{"authorId":"1","username":"builderio","countedBy":"account","lastReadAt":"2026-11-26T08:00:00.000Z"}',
        },
        expect.objectContaining({ external_id: "1001", relevance: "counted" }),
        {
          external_id: "2000",
          url: "https://x.com/Steve8708/status/2000",
          title: "New article builder.io/blog/fusion",
          author: "@Steve8708",
          relevance: "counted",
          metadata:
            '{"authorId":"2","username":"Steve8708","countedBy":"link:builder.io/blog","lastReadAt":"2026-11-26T08:00:00.000Z"}',
        },
        {
          external_id: "2001",
          url: "https://x.com/Steve8708/status/2001",
          title: "Every builder should read this",
          author: "@Steve8708",
          relevance: "not_counted",
          metadata: '{"authorId":"2","username":"Steve8708","countedBy":null}',
        },
      ]);
      expect(
        await rows(
          "SELECT i.external_id, s.metric_date, s.metric, s.value FROM analytics_content_metric_snapshots s JOIN analytics_content_items i ON i.id = s.item_id WHERE s.metric IN ('x_views', 'x_age_hours') ORDER BY i.external_id, s.metric",
        ),
      ).toEqual([
        {
          external_id: "1000",
          metric_date: "2026-11-26",
          metric: "x_age_hours",
          value: 48,
        },
        {
          external_id: "1000",
          metric_date: "2026-11-26",
          metric: "x_views",
          value: 500,
        },
        {
          external_id: "1001",
          metric_date: "2026-11-26",
          metric: "x_age_hours",
          value: 120,
        },
        {
          external_id: "1001",
          metric_date: "2026-11-26",
          metric: "x_views",
          value: 900,
        },
        {
          external_id: "2000",
          metric_date: "2026-11-26",
          metric: "x_age_hours",
          value: 24,
        },
        {
          external_id: "2000",
          metric_date: "2026-11-26",
          metric: "x_views",
          value: 300,
        },
      ]);
      expect(
        await rows(
          "SELECT DISTINCT metric FROM analytics_content_metric_snapshots ORDER BY metric",
        ),
      ).toEqual(
        [
          "x_age_hours",
          "x_bookmarks",
          "x_likes",
          "x_quotes",
          "x_replies",
          "x_reposts",
          "x_views",
        ].map((metric) => ({ metric })),
      );
      const run = await xRun();
      expect(run).toEqual(
        expect.objectContaining({
          status: "succeeded",
          row_count: 21,
          detail:
            "Read 4 posts and 2 accounts ($0.04): 3 of 4 new posts counted, 0 re-reads. This month: $0.04 of the $25.00 cap; month-end projection $0.06.",
        }),
      );
      expect(run.cost_usd).toBeCloseTo(0.04, 5);
    });

    it("reads on from the newest stored post and re-reads a counted post at 1, 3, 7 and 30 days old, then never again", async () => {
      await xOnly({ accounts: [{ handle: "@builderio", allPosts: true }] });
      posts = [
        {
          id: "3000",
          authorId: "1",
          createdAt: "2026-11-02T03:00:00.000Z",
          text: "Launch day",
          views: 0,
        },
      ];
      const days = [0, 1, 2, 3, 7, 30, 31];
      for (const [index, day] of days.entries()) {
        first(posts).views = (index + 1) * 100;
        const now = new Date(
          Date.parse("2026-11-02T08:00:00.000Z") + day * 86_400_000,
        ).toISOString();
        expect(await runX(now)).toEqual([
          expect.objectContaining({ step: "x", status: "succeeded" }),
        ]);
      }

      expect(
        requests.filter((url) => url.pathname === "/2/users/by"),
      ).toHaveLength(1);
      expect(
        requests
          .filter((url) => url.pathname === "/2/users/1/tweets")
          .slice(1)
          .map((url) => url.searchParams.get("since_id")),
      ).toEqual(["3000", "3000", "3000", "3000", "3000", "3000"]);
      expect(lookups().map((url) => url.searchParams.get("ids"))).toEqual([
        "3000",
        "3000",
        "3000",
        "3000",
      ]);
      expect(
        await rows(
          "SELECT s.metric_date, MAX(s.value) FILTER (WHERE s.metric = 'x_age_hours') AS age_hours, MAX(s.value) FILTER (WHERE s.metric = 'x_views') AS views FROM analytics_content_metric_snapshots s GROUP BY s.metric_date ORDER BY s.metric_date",
        ),
      ).toEqual([
        { metric_date: "2026-11-02", age_hours: 5, views: 100 },
        { metric_date: "2026-11-03", age_hours: 29, views: 200 },
        { metric_date: "2026-11-05", age_hours: 77, views: 400 },
        { metric_date: "2026-11-09", age_hours: 173, views: 500 },
        { metric_date: "2026-12-02", age_hours: 725, views: 600 },
      ]);
    });

    it("stops before the month's $25 with the finished accounts saved, counting only this month's runs", async () => {
      await xOnly();
      await spentBefore(5, "2026-10-31T08:00:00.000Z");
      await spentBefore(24.3, "2026-11-03T08:00:00.000Z");
      posts = [
        ...[0, 1, 2].map((n) => ({
          id: String(1000 + n),
          authorId: "1",
          createdAt: `2026-11-2${n}T08:00:00.000Z`,
          text: `Builder post ${n}`,
          views: 10,
        })),
        ...Array.from({ length: 150 }, (_, n) => ({
          id: String(2000 + n),
          authorId: "2",
          createdAt: "2026-11-10T08:00:00.000Z",
          text: `Builder.io tip ${n}`,
          views: 10,
        })),
      ];

      expect(await runX("2026-11-26T08:00:00.000Z")).toEqual([
        expect.objectContaining({
          step: "x",
          status: "cost_limited",
          reason: "x_monthly_cap",
        }),
      ]);

      expect(
        requests.filter((url) => url.pathname === "/2/users/2/tweets"),
      ).toHaveLength(1);
      expect(
        await rows(
          "SELECT external_id FROM analytics_content_items ORDER BY external_id",
        ),
      ).toEqual([
        { external_id: "1000" },
        { external_id: "1001" },
        { external_id: "1002" },
      ]);
      const run = await xRun();
      expect(run).toEqual(
        expect.objectContaining({
          status: "cost_limited",
          error_code: "x_monthly_cap",
          row_count: 21,
          error_message: expect.stringMatching(
            /^Stopped before the \$25\.00 monthly X cap: \$24\.8\d spent this month, \$0\.5\d of it in this run\.$/,
          ),
          detail: expect.stringContaining("Read 103 posts and 2 accounts"),
        }),
      );
      expect(run.cost_usd).toBeCloseTo(0.535, 5);
      expect(await runX("2026-11-26T09:00:00.000Z")).toEqual([
        expect.objectContaining({
          status: "skipped",
          reason: "already_ran_today",
        }),
      ]);
    });

    it("drops the 30-day re-reads when the month-end projection with them passes $25", async () => {
      await xOnly({ accounts: [{ handle: "@builderio", allPosts: true }] });
      await spentBefore(24.4, "2026-11-02T08:00:00.000Z");
      await storeCountedPosts([
        ...Array.from({ length: 130 }, (_, n) => ({
          id: String(5000 + n),
          publishedAt: "2026-10-27T03:00:00.000Z",
          lastReadAt: "2026-11-03T08:00:00.000Z",
        })),
        ...["6000", "6001"].map((id) => ({
          id,
          publishedAt: "2026-11-19T03:00:00.000Z",
          lastReadAt: "2026-11-22T08:00:00.000Z",
        })),
      ]);

      expect(await runX("2026-11-26T08:00:00.000Z")).toEqual([
        expect.objectContaining({ step: "x", status: "succeeded" }),
      ]);

      expect(lookups().map((url) => url.searchParams.get("ids"))).toEqual([
        "6000,6001",
      ]);
      expect((await xRun()).detail).toBe(
        "Read 2 posts and 0 accounts ($0.01): 0 of 0 new posts counted, 2 re-reads. This month: $24.41 of the $25.00 cap; month-end projection $24.41. Skipped 130 30-day re-reads to keep the projection under the cap.",
      );
    });

    it("keeps the 30-day re-reads while the projection stays under $25, 100 posts a request", async () => {
      await xOnly({ accounts: [{ handle: "@builderio", allPosts: true }] });
      await spentBefore(20, "2026-11-02T08:00:00.000Z");
      await storeCountedPosts([
        ...Array.from({ length: 130 }, (_, n) => ({
          id: String(5000 + n),
          publishedAt: "2026-10-27T03:00:00.000Z",
          lastReadAt: "2026-11-03T08:00:00.000Z",
        })),
        ...["6000", "6001"].map((id) => ({
          id,
          publishedAt: "2026-11-19T03:00:00.000Z",
          lastReadAt: "2026-11-22T08:00:00.000Z",
        })),
      ]);

      await runX("2026-11-26T08:00:00.000Z");

      const batches = lookups().map((url) =>
        (url.searchParams.get("ids") ?? "").split(","),
      );
      expect(batches.map((ids) => ids.length)).toEqual([100, 32]);
      expect(first(batches).slice(0, 2)).toEqual(["6000", "6001"]);
      const run = await xRun();
      expect(run.detail).toContain("132 re-reads");
      expect(run.cost_usd).toBeCloseTo(0.66, 5);
      expect(
        await rows(
          "SELECT COUNT(*)::int AS reads FROM analytics_content_metric_snapshots WHERE metric = 'x_age_hours' AND value = 725",
        ),
      ).toEqual([{ reads: 130 }]);
    });

    it("stops at X's own spending limit with the finished accounts saved", async () => {
      await xOnly();
      posts = [
        {
          id: "1000",
          authorId: "1",
          createdAt: "2026-11-24T08:00:00.000Z",
          text: "Ship log",
          views: 10,
        },
      ];
      failWith = (url) =>
        url.pathname === "/2/users/2/tweets"
          ? {
              status: 402,
              body: { title: "Payment Required", detail: "Spend cap reached." },
            }
          : null;

      expect(await runX("2026-11-26T08:00:00.000Z")).toEqual([
        expect.objectContaining({
          status: "cost_limited",
          reason: "x_spending_limit_reached",
        }),
      ]);
      expect(
        await rows("SELECT external_id FROM analytics_content_items"),
      ).toEqual([{ external_id: "1000" }]);
      const run = await xRun();
      expect(run.error_message).toContain("Spend cap reached.");
      expect(run.cost_usd).toBeCloseTo(0.025, 5);
    });

    it("records what a failed run spent and saves none of its posts", async () => {
      await xOnly();
      posts = [
        {
          id: "1000",
          authorId: "1",
          createdAt: "2026-11-24T08:00:00.000Z",
          text: "Ship log",
          views: 10,
        },
      ];
      failWith = (url) =>
        url.pathname === "/2/users/2/tweets"
          ? { status: 503, body: { title: "Service Unavailable" } }
          : null;

      expect(await runX("2026-11-26T08:00:00.000Z")).toEqual([
        expect.objectContaining({
          status: "failed",
          reason: "x_request_failed",
        }),
      ]);
      expect(
        await rows("SELECT external_id FROM analytics_content_items"),
      ).toEqual([]);
      expect((await xRun()).cost_usd).toBeCloseTo(0.025, 5);
    });

    it("fails a run that names an account X lacks", async () => {
      await xOnly({
        accounts: [
          { handle: "@builderio", allPosts: true },
          { handle: "@nobody_here", allPosts: false },
        ],
      });
      expect(await runX("2026-11-26T08:00:00.000Z")).toEqual([
        expect.objectContaining({
          status: "failed",
          reason: "x_account_not_found",
        }),
      ]);
      const run = await xRun();
      expect(run.error_message).toBe(
        "X has no account @nobody_here. Check the collection's X accounts.",
      );
      expect(run.cost_usd).toBeCloseTo(0.01, 5);
    });

    it("names a missing Bearer token, accounts or counting rule as not set up, without calling X", async () => {
      mocks.xToken = null;
      await xOnly();
      expect(await runX("2026-11-24T08:00:00.000Z")).toEqual([
        expect.objectContaining({
          status: "not_configured",
          reason: "x_bearer_token_missing",
        }),
      ]);
      mocks.xToken = "test-x-token";
      await xOnly({ accounts: [] });
      expect(await runX("2026-11-25T08:00:00.000Z")).toEqual([
        expect.objectContaining({
          status: "not_configured",
          reason: "x_accounts_not_configured",
        }),
      ]);
      await xOnly({
        accounts: [{ handle: "@Steve8708", allPosts: false }],
        links: [],
        terms: [],
      });
      expect(await runX("2026-11-26T08:00:00.000Z")).toEqual([
        expect.objectContaining({
          status: "not_configured",
          reason: "x_counting_rule_not_configured",
        }),
      ]);
      expect(requests).toEqual([]);
    });
  });
});
