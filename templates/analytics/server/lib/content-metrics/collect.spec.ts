import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listBuilderBlogArticles: vi.fn(),
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

import * as dbModule from "../../db/index.js";
import {
  collectContentForAllTenants,
  collectContentForCollection,
} from "./collect.js";
import { defaultContentCollectionConfig } from "./config.js";
import { CONTENT_METRICS_MIGRATION_SQL } from "./migration.js";
import { readContentCollection, writeContentCollection } from "./store.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const ORG_A = { ownerEmail: "alice@example.test", orgId: "org_a" };

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
    mocks.contexts.length = 0;
    for (const statement of CONTENT_METRICS_MIGRATION_SQL) {
      await client.exec(statement);
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it("writes the article list with authors under the stored owner and marks the run succeeded", async () => {
    await writeContentCollection(ORG_A, { enabled: true });
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

    expect(result).toEqual([
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
    await writeContentCollection(ORG_A, { enabled: true });
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
    await writeContentCollection(ORG_A, { enabled: true });
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
    await writeContentCollection(ORG_A, { enabled: true });
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
    await writeContentCollection(ORG_A, { enabled: true });
    mocks.listBuilderBlogArticles.mockResolvedValue({
      articles: [article("a1")],
      total: 1,
      truncated: false,
      nextOffset: null,
    });
    const morning = new Date();

    await collectContentForAllTenants({ now: morning });
    const second = await collectContentForAllTenants({ now: morning });
    expect(second).toEqual([
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
    expect(manual).toEqual([expect.objectContaining({ status: "succeeded" })]);
    expect(mocks.listBuilderBlogArticles).toHaveBeenCalledTimes(2);
  });

  it("retries a failed step on the next scheduled pass the same day", async () => {
    await writeContentCollection(ORG_A, { enabled: true });
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
    await writeContentCollection(ORG_A, { enabled: true });
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

  it("skips tenants that turned collection off and steps they turned off", async () => {
    await writeContentCollection(ORG_A, { enabled: false });
    expect(await collectContentForAllTenants()).toEqual([]);

    await writeContentCollection(ORG_A, {
      enabled: true,
      config: {
        ...defaultContentCollectionConfig(),
        builderBlog: { enabled: false },
      },
    });
    expect(await collectContentForAllTenants()).toEqual([
      expect.objectContaining({ status: "skipped", reason: "step_disabled" }),
    ]);
    expect(mocks.listBuilderBlogArticles).not.toHaveBeenCalled();
  });
});
