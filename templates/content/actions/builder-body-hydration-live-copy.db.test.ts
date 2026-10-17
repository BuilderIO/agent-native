import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { BuilderCmsReadResult } from "./_builder-cms-read-client";
import {
  BUILDER_CMS_BODY_CONTENT_KEY,
  type BuilderCmsSourceEntry,
} from "./_builder-cms-source-adapter";
import { processBuilderBodyHydrationQueue } from "./_database-source-utils";

const builderBodyReads = vi.hoisted(
  () => new Map<string, BuilderCmsSourceEntry[]>(),
);

vi.mock("./_builder-cms-read-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_builder-cms-read-client.js")>();
  return {
    ...actual,
    readBuilderCmsContentEntries: async (
      args: Parameters<typeof actual.readBuilderCmsContentEntries>[0],
    ): Promise<BuilderCmsReadResult> => {
      const entries = builderBodyReads.get(args.model);
      if (!entries) return actual.readBuilderCmsContentEntries(args);
      return {
        state: "live",
        entries,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        message: null,
        progress: {
          requestedLimit: entries.length,
          pageSize: entries.length,
          startOffset: 0,
          nextOffset: entries.length,
          fetchedEntryCount: entries.length,
          hasMore: false,
          partial: false,
          readMode: "builder-api",
        },
      };
    },
  };
});

describe("Builder body hydration of a page that takes body writes through its live copy", () => {
  const OWNER = "hydration-owner@example.com";
  const TEST_DB_PATH = join(
    tmpdir(),
    `builder-body-hydration-${process.pid}-${Date.now()}.pglite`,
  );
  let getDb: typeof import("../server/db/index.js").getDb;
  let schema: typeof import("../server/db/schema.js");
  let liveCopy: typeof import("../server/test-support/live-copy-page.js");

  beforeAll(async () => {
    process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
    const dbModule = await import("../server/db/index.js");
    getDb = dbModule.getDb;
    schema = dbModule.schema;
    const plugin = (await import("../server/plugins/db.js")).default;
    await plugin(undefined as never);
    liveCopy = await import("../server/test-support/live-copy-page.js");
  }, 60_000);

  afterEach(async () => {
    builderBodyReads.clear();
    await liveCopy.turnLiveCopyFlagsOff();
  });

  afterAll(() => {
    rmSync(TEST_DB_PATH, { force: true, recursive: true });
  });

  function rowIds(model: string, position: number) {
    return {
      documentId: `doc_${model}_${position}`,
      itemId: `item_${model}_${position}`,
      entryId: `entry-${model}-${position}`,
      title: `${model} ${position}`,
    };
  }

  /** Empty pages in a Builder source, each with a first hydration queued. */
  async function seedHydrationQueue(
    model: string,
    count: number,
    queuedBody?: (position: number) => string,
  ) {
    const db = getDb();
    const now = new Date().toISOString();
    const databaseId = `db_${model}`;
    const sourceId = `src_${model}`;
    const positions = Array.from({ length: count }, (_, index) => index + 1);
    const sourceValues = (position: number) => ({
      "data.title": rowIds(model, position).title,
      lastUpdated: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(schema.documents).values([
      {
        id: `doc_${databaseId}`,
        ownerEmail: OWNER,
        title: model,
        createdAt: now,
        updatedAt: now,
      },
      ...positions.map((position) => ({
        id: rowIds(model, position).documentId,
        ownerEmail: OWNER,
        parentId: `doc_${databaseId}`,
        title: rowIds(model, position).title,
        content: "",
        createdAt: now,
        updatedAt: now,
      })),
    ]);
    await db.insert(schema.contentDatabases).values({
      id: databaseId,
      ownerEmail: OWNER,
      documentId: `doc_${databaseId}`,
      title: model,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "builder-cms",
      sourceName: model,
      sourceTable: model,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values(
      positions.map((position) => ({
        id: rowIds(model, position).itemId,
        ownerEmail: OWNER,
        databaseId,
        documentId: rowIds(model, position).documentId,
        position,
        bodyHydrationStatus: "pending",
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(schema.contentDatabaseSourceRows).values(
      positions.map((position) => ({
        id: `row_${model}_${position}`,
        ownerEmail: OWNER,
        sourceId,
        databaseItemId: rowIds(model, position).itemId,
        documentId: rowIds(model, position).documentId,
        sourceRowId: rowIds(model, position).entryId,
        sourceQualifiedId: `builder-cms://${model}/${rowIds(model, position).entryId}`,
        sourceDisplayKey: rowIds(model, position).title,
        sourceValuesJson: JSON.stringify(sourceValues(position)),
        provenance: "Builder CMS read adapter",
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(schema.contentDatabaseBodyHydrationQueue).values(
      positions.map((position) => ({
        id: `queue_${model}_${position}`,
        ownerEmail: OWNER,
        sourceId,
        databaseItemId: rowIds(model, position).itemId,
        documentId: rowIds(model, position).documentId,
        sourceRowId: rowIds(model, position).entryId,
        sourceTable: model,
        sourceEntryJson: JSON.stringify({
          id: rowIds(model, position).entryId,
          model,
          title: rowIds(model, position).title,
          urlPath: `/${rowIds(model, position).entryId}`,
          updatedAt: "2026-01-01T00:00:00.000Z",
          sourceValues: {
            ...sourceValues(position),
            ...(queuedBody
              ? { [BUILDER_CMS_BODY_CONTENT_KEY]: queuedBody(position) }
              : {}),
          },
        }),
        priority: 10,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })),
    );
    return { sourceId, databaseId };
  }

  function builderBodyEntries(
    model: string,
    count: number,
  ): BuilderCmsSourceEntry[] {
    return Array.from({ length: count }, (_, index) => {
      const { entryId, title } = rowIds(model, index + 1);
      return {
        id: entryId,
        model,
        title,
        urlPath: `/${entryId}`,
        updatedAt: "2026-01-01T00:00:00.000Z",
        sourceValues: {
          "data.title": title,
          lastUpdated: "2026-01-01T00:00:00.000Z",
        },
        rawEntry: {
          id: entryId,
          model,
          name: title,
          lastUpdated: "2026-01-01T00:00:00.000Z",
          data: {
            title,
            blocks: [
              {
                "@type": "@builder.io/sdk:Element",
                "@version": 2,
                id: `text-${entryId}`,
                component: {
                  name: "Text",
                  options: { text: `<p>Builder body ${index + 1}.</p>` },
                },
              },
            ],
          },
        },
      };
    });
  }

  async function pageState(documentId: string) {
    const [page] = await getDb()
      .select({
        content: schema.documents.content,
        bodyRevision: schema.documents.bodyRevision,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    return {
      ...page,
      liveCopyVersion: await liveCopy.liveCopyVersionOf(documentId),
    };
  }

  async function expectRefusedHydration(itemId: string) {
    const db = getDb();
    const [item] = await db
      .select({
        bodyHydrationStatus: schema.contentDatabaseItems.bodyHydrationStatus,
        bodyHydrationError: schema.contentDatabaseItems.bodyHydrationError,
        bodyHydrationReason: schema.contentDatabaseItems.bodyHydrationReason,
        bodyHydrationProviderStatus:
          schema.contentDatabaseItems.bodyHydrationProviderStatus,
        bodyHydrationRetryable:
          schema.contentDatabaseItems.bodyHydrationRetryable,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.id, itemId));
    expect(item).toEqual({
      bodyHydrationStatus: "error",
      bodyHydrationError: expect.stringContaining(
        "Builder body hydration can't write a body there yet",
      ),
      bodyHydrationReason: "unsupported_content",
      bodyHydrationProviderStatus: "live_copy",
      bodyHydrationRetryable: 0,
    });
    const queued = await db
      .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
      .from(schema.contentDatabaseBodyHydrationQueue)
      .where(
        eq(schema.contentDatabaseBodyHydrationQueue.databaseItemId, itemId),
      );
    expect(queued).toEqual([]);
  }

  it("ends the page's per-row job for good and leaves its body as it was", async () => {
    const model = "live-copy-row";
    const { sourceId } = await seedHydrationQueue(
      model,
      1,
      (position) => `Queued Builder body ${position}.`,
    );
    const page = rowIds(model, 1);
    await liveCopy.putPageOnLiveCopy(page.documentId);
    const before = await pageState(page.documentId);

    const result = await processBuilderBodyHydrationQueue({
      sourceId,
      limit: 1,
    });

    expect(result).toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 1,
      remaining: 0,
    });
    await expectRefusedHydration(page.itemId);
    expect(await pageState(page.documentId)).toEqual(before);
  });

  it("hydrates the rest of a bulk batch and fails only the page's job", async () => {
    const model = "live-copy-bulk";
    // The bulk path takes only batches of at least 20 jobs.
    const count = 20;
    const { sourceId, databaseId } = await seedHydrationQueue(model, count);
    builderBodyReads.set(model, builderBodyEntries(model, count));
    const page = rowIds(model, 1);
    await liveCopy.putPageOnLiveCopy(page.documentId);
    const before = await pageState(page.documentId);

    const result = await processBuilderBodyHydrationQueue({
      sourceId,
      limit: count,
      preloadBodies: true,
    });

    expect(result).toMatchObject({
      processed: count,
      succeeded: count - 1,
      failed: 1,
      remaining: 0,
    });
    await expectRefusedHydration(page.itemId);
    expect(await pageState(page.documentId)).toEqual(before);
    const pages = await getDb()
      .select({
        documentId: schema.documents.id,
        content: schema.documents.content,
        bodyHydrationStatus: schema.contentDatabaseItems.bodyHydrationStatus,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
      .orderBy(schema.contentDatabaseItems.position);
    expect(pages.slice(1)).toEqual(
      Array.from({ length: count - 1 }, (_, index) => ({
        documentId: rowIds(model, index + 2).documentId,
        content: expect.stringContaining(`Builder body ${index + 2}.`),
        bodyHydrationStatus: "hydrated",
      })),
    );
  });
});
