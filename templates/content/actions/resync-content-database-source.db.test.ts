// Integration test for the row-union resync over-claim fix (slice 6b). Boots a
// real in-memory libsql DB, simulates the PRE-FIX corrupted state where source
// A over-claimed every database item (including source B's row), then resyncs
// A against a mocked live Builder read and asserts the self-heal: A keeps only
// its own remote-backed rows and never re-claims B's row.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, ne } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api";
import { builderBlocksHash } from "../shared/builder-mdx";
import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LAST_UPDATED_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
} from "./_builder-cms-source-adapter";
import { buildBuilderCmsExecutionPlan } from "./_builder-cms-write-adapter";

const builderReadMock = vi.hoisted(() => ({
  mode: "full" as "full" | "paged",
  calls: [] as Array<{
    model: string;
    fieldPaths?: readonly string[];
    maxPages?: number;
    offset?: number;
  }>,
  modelFieldsErrorFor: null as string | null,
  singleEntryCalls: [] as Array<{ model: string; entryId: string }>,
  singleEntryErrorFor: null as string | null,
  beforeSingleEntryRead: null as
    | ((args: { model: string; entryId: string }) => Promise<void> | void)
    | null,
}));

// Mock the Builder read client so resync runs "live" with deterministic entries
// (no network). Real exports are preserved; only the two reads are overridden.
vi.mock("./_builder-cms-read-client.js", async () => {
  const actual = await vi.importActual<
    typeof import("./_builder-cms-read-client.js")
  >("./_builder-cms-read-client.js");
  return {
    ...actual,
    readBuilderCmsModelFields: vi.fn(async ({ model }: { model: string }) => {
      if (builderReadMock.modelFieldsErrorFor === model) {
        throw new Error("read ECONNRESET");
      }
      if (model === "collection-mapped-fields") {
        return [
          { name: "topics", type: "list", required: false },
          { name: "tags", type: "list", required: false },
          { name: "customModelField", type: "string", required: false },
          { name: "published", type: "boolean", required: false },
          { name: "Status", type: "string", required: false },
          { name: "status", type: "string", required: false },
        ];
      }
      if (model === BUILDER_CMS_SAFE_WRITE_MODEL) {
        return [
          { name: "title", type: "string", required: true },
          { name: "author", type: "reference", required: true },
        ];
      }
      return [];
    }),
    readBuilderCmsContentEntry: vi.fn(
      async ({ model, entryId }: { model: string; entryId: string }) => {
        builderReadMock.singleEntryCalls.push({ model, entryId });
        await builderReadMock.beforeSingleEntryRead?.({ model, entryId });
        if (builderReadMock.singleEntryErrorFor === model) {
          throw new Error(`read failed for ${model}`);
        }
        if (
          model !== "collection-open-hydration-live" &&
          model !== "collection-metadata-only" &&
          model !== "collection-large-597" &&
          model !== "collection-canonical-hash-repair" &&
          model !== "collection-same-version-conflict"
        ) {
          return null;
        }
        if (model === "collection-large-597") {
          const index = Number(entryId.replace("entry-large-", ""));
          return {
            id: entryId,
            model,
            title: `Large entry ${index}`,
            urlPath: `/large-entry-${index}`,
            updatedAt: "2026-02-01T00:00:00.000Z",
            sourceValues: {
              "data.title": `Large entry ${index}`,
              "data.url": `/large-entry-${index}`,
              [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: `large-hash-${index}`,
              [BUILDER_CMS_BODY_CONTENT_KEY]: `Persisted body ${index}`,
            },
          };
        }
        const title =
          model === "collection-same-version-conflict"
            ? "Same version conflict"
            : model === "collection-canonical-hash-repair"
              ? "Canonical hash repair"
              : model === "collection-metadata-only"
                ? "Metadata-only hydration"
                : "Open live hydration";
        const urlPath =
          model === "collection-same-version-conflict"
            ? "/blog/same-version-conflict"
            : model === "collection-canonical-hash-repair"
              ? "/blog/canonical-hash-repair"
              : model === "collection-metadata-only"
                ? "/blog/metadata-only-hydration"
                : "/blog/open-live-hydration";
        const body =
          model === "collection-same-version-conflict"
            ? "Stale public body variant."
            : model === "collection-canonical-hash-repair"
              ? "Fresh live remote baseline."
              : model === "collection-metadata-only"
                ? "Metadata-only row hydrated from a single-entry Builder read."
                : "Live opened row body from Builder.";
        return {
          id: entryId,
          model,
          title,
          urlPath,
          updatedAt: "2026-01-01T00:00:00.000Z",
          sourceValues: {
            "data.title": title,
            "data.url": urlPath,
            lastUpdated: "2026-01-01T00:00:00.000Z",
          },
          rawEntry: {
            id: entryId,
            model,
            name: title,
            lastUpdated: "2026-01-01T00:00:00.000Z",
            data: {
              title,
              url: urlPath,
              blocks: [
                {
                  "@type": "@builder.io/sdk:Element",
                  "@version": 2,
                  id:
                    model === "collection-same-version-conflict"
                      ? "text-stale-public"
                      : model === "collection-canonical-hash-repair"
                        ? "text-canonical-live"
                        : "text-open-live",
                  component: {
                    name: "Text",
                    options: {
                      text: `<p>${body}</p>`,
                    },
                  },
                },
              ],
            },
          },
        };
      },
    ),
    readBuilderCmsContentEntries: vi.fn(
      async ({
        model,
        fieldPaths,
        maxPages,
        offset,
      }: {
        model: string;
        fieldPaths?: readonly string[];
        maxPages?: number;
        offset?: number;
      }) => {
        builderReadMock.calls.push({ model, fieldPaths, maxPages, offset });
        if (model === "collection-suspicious-empty") {
          return {
            state: "live",
            entries: [],
            fetchedAt: "2026-02-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 500,
              pageSize: 100,
              startOffset: 0,
              nextOffset: 0,
              fetchedEntryCount: 0,
              hasMore: false,
              partial: false,
              readMode: "builder-api",
            },
          };
        }
        if (model === "collection-suspicious-empty-continuation") {
          const startOffset = offset ?? 1;
          return {
            state: "live",
            entries: [],
            fetchedAt: "2026-02-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 500,
              pageSize: 100,
              startOffset,
              nextOffset: startOffset,
              fetchedEntryCount: startOffset,
              hasMore: false,
              partial: false,
              readMode: "builder-api",
            },
          };
        }
        if (model === "collection-large-597") {
          const allEntries = Array.from({ length: 597 }, (_, index) => ({
            id: `entry-large-${index + 1}`,
            model,
            title: `Large entry ${index + 1}`,
            urlPath: `/large-entry-${index + 1}`,
            updatedAt: "2026-02-01T00:00:00.000Z",
            sourceValues: {
              "data.title": `Large entry ${index + 1}`,
              "data.url": `/large-entry-${index + 1}`,
              [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: `large-hash-${index + 1}`,
            },
          }));
          const startOffset = offset ?? 0;
          const pageEntries = maxPages
            ? allEntries.slice(startOffset, startOffset + 100)
            : allEntries.slice(startOffset);
          const nextOffset = startOffset + pageEntries.length;
          const hasMore = nextOffset < allEntries.length;
          return {
            state: "live",
            entries: pageEntries,
            fetchedAt: "2026-02-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: maxPages ? 500 : 10_000,
              pageSize: 100,
              startOffset,
              nextOffset,
              fetchedEntryCount: nextOffset,
              hasMore,
              partial: hasMore,
              readMode: "builder-api",
            },
          };
        }
        if (model === "collection-mapped-fields") {
          const entries = [
            {
              id: "entry-mapped-fields",
              model,
              title: "Mapped fields",
              urlPath: "/blog/mapped-fields",
              updatedAt: "2026-02-01T00:00:00.000Z",
              sourceValues: {
                "data.title": "Mapped fields",
                "data.topics": ["AI", "CMS"],
                "data.tags": ["Agents", "Content"],
                "data.customModelField": "Arbitrary value",
                "data.published": true,
                "data.Status": "Editorial",
                "data.status": "published",
              },
            },
          ];
          return {
            state: "live",
            entries,
            fetchedAt: "2026-02-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 500,
              pageSize: 100,
              startOffset: 0,
              nextOffset: entries.length,
              fetchedEntryCount: entries.length,
              hasMore: false,
              partial: false,
              readMode: "builder-api",
            },
          };
        }
        if (model === "collection-duplicates") {
          return {
            state: "live",
            entries: [
              {
                id: "entry-dup-1",
                model: "collection-duplicates",
                title: "Best AI Coding Tools for Developers in 2024",
                urlPath: "/blog/builder-best-ai-coding-tools",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceValues: {
                  "data.title": "Best AI Coding Tools for Developers in 2024",
                },
              },
              {
                id: "entry-dup-2",
                model: "collection-duplicates",
                title: "Best AI Coding Tools for Developers in 2024",
                urlPath: "/blog/builder-best-ai-coding-tools",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceValues: {
                  "data.title": "Best AI Coding Tools for Developers in 2024",
                },
              },
            ],
            fetchedAt: "2026-01-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 500,
              pageSize: 100,
              startOffset: 0,
              nextOffset: 2,
              fetchedEntryCount: 2,
              hasMore: false,
              partial: false,
              readMode: "builder-api",
            },
          };
        }
        if (model === "collection-metadata-only") {
          return {
            state: "live",
            entries: [
              {
                id: "entry-metadata-only-1",
                model: "collection-metadata-only",
                title: "Metadata-only hydration",
                urlPath: "/blog/metadata-only-hydration",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceValues: {
                  "data.title": "Metadata-only hydration",
                  "data.url": "/blog/metadata-only-hydration",
                  lastUpdated: "2026-01-01T00:00:00.000Z",
                },
              },
            ],
            fetchedAt: "2026-01-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 500,
              pageSize: 100,
              startOffset: 0,
              nextOffset: 1,
              fetchedEntryCount: 1,
              hasMore: false,
              partial: false,
              readMode: "builder-api",
            },
          };
        }
        if (model === "collection-hydration") {
          const entries = ["One", "Two"].map((title, index) => ({
            id: `entry-hydration-${index + 1}`,
            model: "collection-hydration",
            title: `Hydration ${title}`,
            urlPath: `/blog/hydration-${title.toLowerCase()}`,
            updatedAt: `2026-01-01T00:0${index}:00.000Z`,
            sourceValues: {
              "data.title": `Hydration ${title}`,
              "data.url": `/blog/hydration-${title.toLowerCase()}`,
              lastUpdated: `2026-01-01T00:0${index}:00.000Z`,
            },
            rawEntry: {
              id: `entry-hydration-${index + 1}`,
              model: "collection-hydration",
              name: `Hydration ${title}`,
              lastUpdated: `2026-01-01T00:0${index}:00.000Z`,
              data: {
                title: `Hydration ${title}`,
                url: `/blog/hydration-${title.toLowerCase()}`,
                blocks: [
                  {
                    "@type": "@builder.io/sdk:Element",
                    "@version": 2,
                    id: `text-${index + 1}`,
                    component: {
                      name: "Text",
                      options: {
                        text: `<p>Hydrated body ${title} with &lt;5 and {braces}.</p>`,
                      },
                    },
                  },
                ],
              },
            },
          }));
          return {
            state: "live",
            entries,
            fetchedAt: "2026-01-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 500,
              pageSize: 100,
              startOffset: 0,
              nextOffset: entries.length,
              fetchedEntryCount: entries.length,
              hasMore: false,
              partial: false,
              readMode: "builder-api",
            },
          };
        }
        if (model === BUILDER_CMS_SAFE_WRITE_MODEL) {
          const entries = [
            {
              id: "entry-required-reference-refresh",
              model,
              title: "Required reference refresh",
              urlPath: "/blog/required-reference-refresh",
              updatedAt: "2026-02-01T00:00:00.000Z",
              sourceValues: {
                "data.title": "Required reference refresh",
                "data.author": "Apoorva",
              },
              rawEntry: {
                id: "entry-required-reference-refresh",
                model,
                name: "Required reference refresh",
                data: {
                  title: "Required reference refresh",
                  author: {
                    "@type": "@builder.io/core:Reference",
                    id: "author-apoorva",
                    model: "blog-author",
                  },
                },
              },
            },
          ];
          return {
            state: "live",
            entries,
            fetchedAt: "2026-02-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 10_000,
              pageSize: 100,
              startOffset: 0,
              nextOffset: 1,
              fetchedEntryCount: 1,
              hasMore: false,
              partial: false,
              readMode: "builder-api",
            },
          };
        }
        if (model !== "collection-a") {
          return {
            state: "unconfigured",
            entries: [],
            fetchedAt: "2026-01-01T00:00:00.000Z",
            message: null,
            progress: {
              requestedLimit: 500,
              pageSize: 100,
              startOffset: 0,
              nextOffset: 0,
              fetchedEntryCount: 0,
              hasMore: false,
              partial: false,
              readMode: "none",
            },
          };
        }
        const entries = [
          {
            id: "entry-a1",
            model: "collection-a",
            title: "A One",
            urlPath: "/a-one",
            updatedAt: "2026-01-01T00:00:00.000Z",
            sourceValues: {
              "data.title": "A One",
              "data.author": "Ada Lovelace",
              "data.date": 1781546400000,
            },
          },
          {
            id: "entry-a2",
            model: "collection-a",
            title: "A Two",
            urlPath: "/a-two",
            updatedAt: "2026-01-01T00:00:00.000Z",
            sourceValues: {
              "data.title": "A Two",
              "data.author": "Grace Hopper",
              "data.date": 1781632800000,
            },
          },
        ];
        const shouldPage =
          builderReadMock.mode === "paged" && typeof maxPages === "number";
        const startOffset = shouldPage ? (offset ?? 0) : 0;
        const pageEntries = shouldPage
          ? entries.slice(startOffset, startOffset + 1)
          : entries;
        const hasMore = startOffset + pageEntries.length < entries.length;
        return {
          state: "live",
          entries: pageEntries,
          fetchedAt: "2026-01-01T00:00:00.000Z",
          message: null,
          progress: {
            requestedLimit: 500,
            pageSize: shouldPage ? 1 : 100,
            startOffset,
            nextOffset: startOffset + pageEntries.length,
            fetchedEntryCount: startOffset + pageEntries.length,
            hasMore,
            partial: shouldPage && hasMore,
            readMode: "builder-api",
          },
        };
      },
    ),
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `resync-source-test-${process.pid}-${Date.now()}.sqlite`,
);

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let resync: typeof import("./_database-source-utils.js").resyncBuilderCmsSourceSnapshot;
let importBuilderEntries: typeof import("./_database-source-utils.js").importBuilderCmsEntriesAsDatabaseItems;
let seedSourceRows: typeof import("./_database-source-utils.js").seedMockSourceRows;
let materializeSourceFields: typeof import("./_database-source-utils.js").materializeSourceFieldPropertyValues;
let getSnapshot: typeof import("./_database-source-utils.js").getContentDatabaseSourceSnapshotById;
let getWriteSnapshot: typeof import("./_database-source-utils.js").getContentDatabaseSourceSnapshotForWrite;
let hydrateQueuedBodies: typeof import("./_database-source-utils.js").processBuilderBodyHydrationQueue;
let withBuilderBodyValues: typeof import("./_database-source-utils.js").withBuilderBodySourceValues;
let seedCollabFromText: typeof import("@agent-native/core/collab").seedFromText;
let getCollabText: typeof import("@agent-native/core/collab").getText;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  resync = (await import("./_database-source-utils.js"))
    .resyncBuilderCmsSourceSnapshot;
  importBuilderEntries = (await import("./_database-source-utils.js"))
    .importBuilderCmsEntriesAsDatabaseItems;
  seedSourceRows = (await import("./_database-source-utils.js"))
    .seedMockSourceRows;
  materializeSourceFields = (await import("./_database-source-utils.js"))
    .materializeSourceFieldPropertyValues;
  getSnapshot = (await import("./_database-source-utils.js"))
    .getContentDatabaseSourceSnapshotById;
  getWriteSnapshot = (await import("./_database-source-utils.js"))
    .getContentDatabaseSourceSnapshotForWrite;
  hydrateQueuedBodies = (await import("./_database-source-utils.js"))
    .processBuilderBodyHydrationQueue;
  withBuilderBodyValues = (await import("./_database-source-utils.js"))
    .withBuilderBodySourceValues;
  const collab = await import("@agent-native/core/collab");
  seedCollabFromText = collab.seedFromText;
  getCollabText = collab.getText;
}, 60000);

afterEach(() => {
  builderReadMock.modelFieldsErrorFor = null;
  builderReadMock.singleEntryErrorFor = null;
  builderReadMock.beforeSingleEntryRead = null;
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

it("preserves an established source snapshot when Builder unexpectedly returns zero entries", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const createdAt = "2026-01-01T00:00:00.000Z";
  const refreshAt = "2026-02-01T00:05:00.000Z";
  const sourceValues = {
    "data.title": "Existing Builder row",
    "data.tags": ["preserve-me"],
    [BUILDER_CMS_BODY_CONTENT_KEY]: "A large hydrated body stays stored.",
    [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "body-hash",
  };

  await db.insert(schema.documents).values([
    {
      id: "doc-suspicious-db",
      ownerEmail: OWNER,
      title: "Suspicious empty DB",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "doc-suspicious-row",
      ownerEmail: OWNER,
      parentId: "doc-suspicious-db",
      title: "Existing Builder row",
      content: "A large hydrated body stays stored.",
      createdAt,
      updatedAt: createdAt,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: "db-suspicious-empty",
    ownerEmail: OWNER,
    documentId: "doc-suspicious-db",
    title: "Suspicious empty DB",
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: "item-suspicious-row",
    ownerEmail: OWNER,
    databaseId: "db-suspicious-empty",
    documentId: "doc-suspicious-row",
    bodyHydrationStatus: "hydrated" as const,
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: "source-suspicious-empty",
    ownerEmail: OWNER,
    databaseId: "db-suspicious-empty",
    sourceType: "builder-cms",
    sourceName: "Suspicious Builder source",
    sourceTable: "collection-suspicious-empty",
    syncState: "idle",
    freshness: "fresh",
    lastSourceUpdatedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "source-row-suspicious-empty",
    ownerEmail: OWNER,
    sourceId: "source-suspicious-empty",
    databaseItemId: "item-suspicious-row",
    documentId: "doc-suspicious-row",
    sourceRowId: "builder-entry-existing",
    sourceQualifiedId:
      "builder-cms://collection-suspicious-empty/builder-entry-existing",
    sourceDisplayKey: "Existing Builder row",
    sourceValuesJson: JSON.stringify(sourceValues),
    provenance: "Builder CMS read adapter",
    freshness: "fresh",
    createdAt,
    updatedAt: createdAt,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, "db-suspicious-empty"));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "source-suspicious-empty"));

  await resync({ database, source, now: refreshAt });

  const rows = await db
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(
      eq(schema.contentDatabaseSourceRows.sourceId, "source-suspicious-empty"),
    );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: "source-row-suspicious-empty",
    sourceValuesJson: JSON.stringify(sourceValues),
    updatedAt: createdAt,
  });
  const [updatedSource] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "source-suspicious-empty"));
  expect(updatedSource).toMatchObject({
    freshness: "stale",
    syncState: "error",
    lastSourceUpdatedAt: createdAt,
  });
  expect(updatedSource.lastError).toContain("previous snapshot was preserved");
  expect(JSON.parse(updatedSource.metadataJson)).toMatchObject({
    lastReadEntryCount: 0,
    lastReadSuspiciousEmpty: true,
    sourceFetchState: "error",
    activeReadSourceRowIds: [],
  });

  const snapshot = await getSnapshot(database, source.id);
  expect(snapshot?.rows[0]?.sourceValues).toMatchObject({
    "data.title": "Existing Builder row",
    "data.tags": ["preserve-me"],
    [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "body-hash",
  });
  expect(snapshot?.rows[0]?.sourceValues).not.toHaveProperty(
    BUILDER_CMS_BODY_CONTENT_KEY,
  );
  const writeSnapshot = await getWriteSnapshot(database, source.id);
  expect(writeSnapshot?.rows[0]?.sourceValues).toMatchObject({
    [BUILDER_CMS_BODY_CONTENT_KEY]: "A large hydrated body stays stored.",
    [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "body-hash",
  });
});

it("preserves unvisited rows when an empty continuation page would prune them", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const createdAt = "2026-01-01T00:00:00.000Z";
  const refreshAt = "2026-02-01T00:10:00.000Z";
  await db.insert(schema.documents).values([
    {
      id: "doc-continuation-empty-db",
      ownerEmail: OWNER,
      title: "Continuation empty DB",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "doc-continuation-seen",
      ownerEmail: OWNER,
      parentId: "doc-continuation-empty-db",
      title: "Seen on the first page",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "doc-continuation-unvisited",
      ownerEmail: OWNER,
      parentId: "doc-continuation-empty-db",
      title: "Not yet revisited",
      createdAt,
      updatedAt: createdAt,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: "db-continuation-empty",
    ownerEmail: OWNER,
    documentId: "doc-continuation-empty-db",
    title: "Continuation empty DB",
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(schema.contentDatabaseItems).values([
    {
      id: "item-continuation-seen",
      ownerEmail: OWNER,
      databaseId: "db-continuation-empty",
      documentId: "doc-continuation-seen",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "item-continuation-unvisited",
      ownerEmail: OWNER,
      databaseId: "db-continuation-empty",
      documentId: "doc-continuation-unvisited",
      createdAt,
      updatedAt: createdAt,
    },
  ]);
  await db.insert(schema.contentDatabaseSources).values({
    id: "source-continuation-empty",
    ownerEmail: OWNER,
    databaseId: "db-continuation-empty",
    sourceType: "builder-cms",
    sourceName: "Continuation Builder source",
    sourceTable: "collection-suspicious-empty-continuation",
    syncState: "refreshing",
    freshness: "stale",
    lastSourceUpdatedAt: createdAt,
    metadataJson: JSON.stringify({
      sourceFetchState: "fetching",
      lastReadHasMore: true,
      lastReadNextOffset: 1,
      activeReadSourceRowIds: ["entry-seen"],
    }),
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(schema.contentDatabaseSourceRows).values([
    {
      id: "source-row-continuation-seen",
      ownerEmail: OWNER,
      sourceId: "source-continuation-empty",
      databaseItemId: "item-continuation-seen",
      documentId: "doc-continuation-seen",
      sourceRowId: "entry-seen",
      sourceQualifiedId:
        "builder-cms://collection-suspicious-empty-continuation/entry-seen",
      sourceDisplayKey: "Seen on the first page",
      sourceValuesJson: JSON.stringify({
        "data.title": "Seen on the first page",
      }),
      provenance: "Builder CMS read adapter",
      freshness: "fresh",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "source-row-continuation-unvisited",
      ownerEmail: OWNER,
      sourceId: "source-continuation-empty",
      databaseItemId: "item-continuation-unvisited",
      documentId: "doc-continuation-unvisited",
      sourceRowId: "entry-unvisited",
      sourceQualifiedId:
        "builder-cms://collection-suspicious-empty-continuation/entry-unvisited",
      sourceDisplayKey: "Not yet revisited",
      sourceValuesJson: JSON.stringify({
        "data.title": "Not yet revisited",
      }),
      provenance: "Builder CMS read adapter",
      freshness: "fresh",
      createdAt,
      updatedAt: createdAt,
    },
  ]);

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, "db-continuation-empty"));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "source-continuation-empty"));
  await resync({ database, source, now: refreshAt });

  const rows = await db
    .select({
      id: schema.contentDatabaseSourceRows.id,
      sourceRowId: schema.contentDatabaseSourceRows.sourceRowId,
      updatedAt: schema.contentDatabaseSourceRows.updatedAt,
    })
    .from(schema.contentDatabaseSourceRows)
    .where(
      eq(
        schema.contentDatabaseSourceRows.sourceId,
        "source-continuation-empty",
      ),
    );
  expect(rows).toEqual(
    expect.arrayContaining([
      {
        id: "source-row-continuation-seen",
        sourceRowId: "entry-seen",
        updatedAt: createdAt,
      },
      {
        id: "source-row-continuation-unvisited",
        sourceRowId: "entry-unvisited",
        updatedAt: createdAt,
      },
    ]),
  );
  expect(rows).toHaveLength(2);
  const [updatedSource] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "source-continuation-empty"));
  expect(updatedSource).toMatchObject({
    freshness: "stale",
    syncState: "error",
    lastSourceUpdatedAt: createdAt,
  });
  expect(updatedSource.lastError).toContain("previous snapshot was preserved");
  expect(JSON.parse(updatedSource.metadataJson)).toMatchObject({
    lastReadSuspiciousEmpty: true,
    sourceFetchState: "error",
    activeReadSourceRowIds: [],
  });
  expect(
    builderReadMock.calls.find(
      (call) => call.model === "collection-suspicious-empty-continuation",
    )?.offset,
  ).toBe(1);
});

it("accepts a zero-entry read for a source that has never had rows", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const now = "2026-02-01T00:30:00.000Z";
  await db.insert(schema.documents).values({
    id: "doc-new-empty-db",
    ownerEmail: OWNER,
    title: "New empty DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: "db-new-empty",
    ownerEmail: OWNER,
    documentId: "doc-new-empty-db",
    title: "New empty DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: "source-new-empty",
    ownerEmail: OWNER,
    databaseId: "db-new-empty",
    sourceType: "builder-cms",
    sourceName: "New empty Builder source",
    sourceTable: "collection-suspicious-empty",
    syncState: "linked",
    freshness: "unknown",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, "db-new-empty"));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "source-new-empty"));
  await resync({ database, source, now });

  const [updatedSource] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, source.id));
  expect(updatedSource).toMatchObject({
    freshness: "fresh",
    syncState: "idle",
    lastError: null,
    lastSourceUpdatedAt: "2026-02-01T00:00:00.000Z",
  });
  expect(JSON.parse(updatedSource.metadataJson)).toMatchObject({
    lastReadEntryCount: 0,
    lastReadSuspiciousEmpty: false,
    sourceFetchState: "idle",
  });
});

it("materializes topics, tags, and arbitrary Builder model fields", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const now = "2026-02-01T01:00:00.000Z";
  await db.insert(schema.documents).values({
    id: "doc-mapped-fields-db",
    ownerEmail: OWNER,
    title: "Mapped fields DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: "db-mapped-fields",
    ownerEmail: OWNER,
    documentId: "doc-mapped-fields-db",
    title: "Mapped fields DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values([
    {
      id: "prop-topics",
      ownerEmail: OWNER,
      databaseId: "db-mapped-fields",
      name: "Topics",
      type: "multi_select",
      optionsJson: JSON.stringify({
        options: [
          { id: "ai", name: "AI", color: "blue" },
          { id: "cms", name: "CMS", color: "green" },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prop-tags",
      ownerEmail: OWNER,
      databaseId: "db-mapped-fields",
      name: "Tags",
      type: "multi_select",
      optionsJson: JSON.stringify({
        options: [
          { id: "agents", name: "Agents", color: "blue" },
          { id: "content", name: "Content", color: "green" },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prop-custom",
      ownerEmail: OWNER,
      databaseId: "db-mapped-fields",
      name: "Custom model field",
      type: "text",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prop-status-upper",
      ownerEmail: OWNER,
      databaseId: "db-mapped-fields",
      name: "Status",
      type: "text",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prop-status-lower",
      ownerEmail: OWNER,
      databaseId: "db-mapped-fields",
      name: "Status",
      type: "text",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabaseSources).values({
    id: "source-mapped-fields",
    ownerEmail: OWNER,
    databaseId: "db-mapped-fields",
    sourceType: "builder-cms",
    sourceName: "Mapped Builder source",
    sourceTable: "collection-mapped-fields",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values([
    {
      id: "field-topics",
      ownerEmail: OWNER,
      sourceId: "source-mapped-fields",
      propertyId: "prop-topics",
      localFieldKey: "prop-topics",
      sourceFieldKey: "data.topics",
      sourceFieldLabel: "Topics",
      sourceFieldType: "list",
      mappingType: "property",
      writeOwner: "source",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "field-tags",
      ownerEmail: OWNER,
      sourceId: "source-mapped-fields",
      propertyId: "prop-tags",
      localFieldKey: "prop-tags",
      sourceFieldKey: "data.tags",
      sourceFieldLabel: "Tags",
      sourceFieldType: "list",
      mappingType: "property",
      writeOwner: "source",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "field-custom",
      ownerEmail: OWNER,
      sourceId: "source-mapped-fields",
      propertyId: "prop-custom",
      localFieldKey: "prop-custom",
      sourceFieldKey: "data.customModelField",
      sourceFieldLabel: "Custom model field",
      sourceFieldType: "text",
      mappingType: "property",
      writeOwner: "source",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "field-status-upper",
      ownerEmail: OWNER,
      sourceId: "source-mapped-fields",
      propertyId: "prop-status-upper",
      localFieldKey: "prop-status-upper",
      sourceFieldKey: "data.Status",
      sourceFieldLabel: "Status upper",
      sourceFieldType: "text",
      mappingType: "property",
      writeOwner: "source",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "field-status-lower",
      ownerEmail: OWNER,
      sourceId: "source-mapped-fields",
      propertyId: "prop-status-lower",
      localFieldKey: "prop-status-lower",
      sourceFieldKey: "data.status",
      sourceFieldLabel: "Status lower",
      sourceFieldType: "text",
      mappingType: "property",
      writeOwner: "source",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, "db-mapped-fields"));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "source-mapped-fields"));
  await resync({ database, source, now });

  const [sourceRow] = await db
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
  expect(JSON.parse(sourceRow.sourceValuesJson)).toMatchObject({
    "data.topics": ["AI", "CMS"],
    "data.tags": ["Agents", "Content"],
    "data.customModelField": "Arbitrary value",
    "data.published": true,
    "data.Status": "Editorial",
    "data.status": "published",
  });
  const values = await db
    .select({
      propertyId: schema.documentPropertyValues.propertyId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(eq(schema.documentPropertyValues.documentId, sourceRow.documentId));
  expect(
    Object.fromEntries(
      values.map((value: { propertyId: string; valueJson: string }) => [
        value.propertyId,
        JSON.parse(value.valueJson),
      ]),
    ),
  ).toMatchObject({
    "prop-topics": ["ai", "cms"],
    "prop-tags": ["agents", "content"],
    "prop-custom": "Arbitrary value",
    "prop-status-upper": "Editorial",
    "prop-status-lower": "published",
  });
  const unchangedSnapshot = await getSnapshot(database, source.id);
  expect(
    unchangedSnapshot?.changeSets.filter(
      (changeSet) => changeSet.direction === "outbound",
    ),
  ).toHaveLength(0);

  await db
    .update(schema.documentPropertyValues)
    .set({ valueJson: JSON.stringify(["agents", "content", "local-edit"]) })
    .where(
      and(
        eq(schema.documentPropertyValues.documentId, sourceRow.documentId),
        eq(schema.documentPropertyValues.propertyId, "prop-tags"),
      ),
    );
  const editedSnapshot = await getSnapshot(database, source.id);
  expect(
    editedSnapshot?.changeSets.filter(
      (changeSet) => changeSet.direction === "outbound",
    ),
  ).toMatchObject([
    {
      fieldChanges: [
        {
          propertyId: "prop-tags",
          currentValue: ["agents", "content"],
          proposedValue: ["Agents", "Content", "local-edit"],
        },
      ],
    },
  ]);
  const statusFieldMappings = await db
    .select({
      id: schema.contentDatabaseSourceFields.id,
      propertyId: schema.contentDatabaseSourceFields.propertyId,
      sourceFieldKey: schema.contentDatabaseSourceFields.sourceFieldKey,
    })
    .from(schema.contentDatabaseSourceFields)
    .where(
      eq(schema.contentDatabaseSourceFields.sourceId, "source-mapped-fields"),
    );
  expect(
    statusFieldMappings
      .filter((field: { propertyId: string | null }) =>
        ["prop-status-upper", "prop-status-lower"].includes(
          field.propertyId ?? "",
        ),
      )
      .sort((a, b) => String(a.propertyId).localeCompare(String(b.propertyId))),
  ).toEqual([
    {
      id: "field-status-lower",
      propertyId: "prop-status-lower",
      sourceFieldKey: "data.status",
    },
    {
      id: "field-status-upper",
      propertyId: "prop-status-upper",
      sourceFieldKey: "data.Status",
    },
  ]);
  const readCall = builderReadMock.calls.find(
    (call) => call.model === "collection-mapped-fields",
  );
  expect(readCall?.fieldPaths).toEqual(
    expect.arrayContaining([
      "data.topics",
      "data.tags",
      "data.customModelField",
      "data.published",
      "data.Status",
      "data.status",
    ]),
  );
});

it("resync re-links only the source's own rows, never another collection's (self-heal)", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_resync";
  const databaseDocId = "doc_db_resync";
  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB",
    createdAt: now,
    updatedAt: now,
  });
  // Two sources so the multi-source restriction applies.
  await db.insert(schema.contentDatabaseSources).values([
    {
      id: "src-a",
      ownerEmail: OWNER,
      databaseId,
      sourceType: "builder-cms",
      sourceName: "collection-a",
      sourceTable: "collection-a",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: now,
    },
    {
      id: "src-b",
      ownerEmail: OWNER,
      databaseId,
      sourceType: "builder-cms",
      sourceName: "collection-b",
      sourceTable: "collection-b",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: now,
    },
  ]);

  async function addDoc(id: string, title: string, position: number) {
    await db.insert(schema.documents).values({
      id,
      ownerEmail: OWNER,
      title,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `item_${id}`,
      ownerEmail: OWNER,
      databaseId,
      documentId: id,
      position,
      createdAt: now,
      updatedAt: now,
    });
  }
  await addDoc("doc-a1", "A One", 0);
  await addDoc("doc-a2", "A Two", 1);
  await addDoc("doc-b1", "B Item", 2);

  function srcRow(
    id: string,
    sourceId: string,
    documentId: string,
    sourceRowId: string,
  ) {
    return {
      id,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: `item_${documentId}`,
      documentId,
      sourceRowId,
      sourceQualifiedId: `q_${sourceRowId}`,
      sourceDisplayKey: documentId,
      sourceValuesJson: "{}",
      provenance: "Builder CMS read adapter",
      createdAt: now,
      updatedAt: now,
    };
  }
  // Source B legitimately owns doc-b1.
  await db
    .insert(schema.contentDatabaseSourceRows)
    .values(srcRow("row-b1", "src-b", "doc-b1", "entry-b1"));
  // PRE-FIX over-claim: source A claims ALL THREE docs, including B's row.
  await db
    .insert(schema.contentDatabaseSourceRows)
    .values([
      srcRow("row-a1", "src-a", "doc-a1", "entry-a1"),
      srcRow("row-a2", "src-a", "doc-a2", "entry-a2"),
      srcRow("row-a-bogus", "src-a", "doc-b1", "bogus-claim"),
    ]);

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [sourceA] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-a"));

  await resync({ database, source: sourceA, now });

  const aRows = await db
    .select({ documentId: schema.contentDatabaseSourceRows.documentId })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, "src-a"));
  const aDocIds = aRows.map((r: { documentId: string }) => r.documentId).sort();

  // A keeps only its own two remote-backed rows; the over-claimed B row is gone.
  expect(aDocIds).toEqual(["doc-a1", "doc-a2"]);
  expect(aDocIds).not.toContain("doc-b1");

  // Source B's own row is untouched.
  const bRows = await db
    .select({ documentId: schema.contentDatabaseSourceRows.documentId })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, "src-b"));
  expect(bRows.map((r: { documentId: string }) => r.documentId)).toEqual([
    "doc-b1",
  ]);
});

it("records freshly imported Builder row identities even when title and URL keys collide", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_resync_duplicate_keys";
  const databaseDocId = "doc_db_resync_duplicate_keys";
  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "DB duplicate keys",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB duplicate keys",
    createdAt: now,
    updatedAt: now,
  });
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const read = await (
    await import("./_builder-cms-read-client.js")
  ).readBuilderCmsContentEntries({ model: "collection-duplicates" });
  const entries = read.state === "live" ? read.entries : [];
  const importResult = await importBuilderEntries({
    database,
    entries,
    now,
    sourceTable: "collection-duplicates",
    existingSourceRows: [],
  });
  const importedIds = Array.from(
    importResult.importedEntriesByDocumentId.values(),
  ).map((entry) => entry.id);

  expect(importResult.imported).toBe(2);
  expect(importedIds.sort()).toEqual(["entry-dup-1", "entry-dup-2"]);
  const documents = await db
    .select({ title: schema.documents.title })
    .from(schema.documents)
    .where(eq(schema.documents.parentId, databaseDocId));
  expect(documents.map((row: { title: string }) => row.title).sort()).toEqual([
    "Best AI Coding Tools for Developers in 2024",
    "Best AI Coding Tools for Developers in 2024",
  ]);
  const existingSourceRows = Array.from(
    importResult.importedEntriesByDocumentId.entries(),
  ).map(([documentId, entry], index) => ({
    id: `existing-row-${index}`,
    ownerEmail: OWNER,
    sourceId: "src-duplicates",
    databaseItemId: `item-existing-row-${index}`,
    documentId,
    sourceRowId: entry.id,
    sourceQualifiedId: `builder-cms://collection-duplicates/${entry.id}`,
    sourceDisplayKey: entry.title,
    sourceValuesJson: "{}",
    provenance: "Builder CMS read adapter",
    syncState: "linked",
    freshness: "fresh",
    lastSyncedAt: now,
    lastSourceUpdatedAt: entry.updatedAt,
    createdAt: now,
    updatedAt: now,
  }));
  const retryResult = await importBuilderEntries({
    database,
    entries,
    now,
    sourceTable: "collection-duplicates",
    existingSourceRows,
  });
  const retryDocuments = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.parentId, databaseDocId));
  const retryItems = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));

  expect(retryResult.imported).toBe(0);
  expect(retryDocuments).toHaveLength(2);
  expect(retryItems).toHaveLength(2);

  // Attach and its background continuation can overlap before source rows are
  // visible to the second importer. Stable Builder-derived local IDs make the
  // two writes converge instead of duplicating every remote entry.
  await Promise.all([
    importBuilderEntries({
      database,
      entries,
      now,
      sourceTable: "collection-duplicates",
      existingSourceRows: [],
      skipTitleDedup: true,
    }),
    importBuilderEntries({
      database,
      entries,
      now,
      sourceTable: "collection-duplicates",
      existingSourceRows: [],
      skipTitleDedup: true,
    }),
  ]);
  const concurrentRetryDocuments = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.parentId, databaseDocId));
  const concurrentRetryItems = await db
    .select({
      id: schema.contentDatabaseItems.id,
      documentId: schema.contentDatabaseItems.documentId,
    })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
  expect(concurrentRetryDocuments).toHaveLength(2);
  expect(concurrentRetryItems).toHaveLength(2);

  const importedItems = concurrentRetryItems.map(
    (item: { id: string; documentId: string }, index: number) => ({
      id: item.id,
      databaseId,
      document: {
        id: item.documentId,
        title:
          importResult.importedEntriesByDocumentId.get(item.documentId)
            ?.title ?? `Entry ${index + 1}`,
        content: "",
      },
      position: index,
      properties: [],
    }),
  );
  const seedArgs = {
    sourceId: "src-duplicates",
    ownerEmail: OWNER,
    sourceType: "builder-cms" as const,
    sourceTable: "collection-duplicates",
    items: importedItems,
    now,
    builderEntriesByDocumentId: importResult.importedEntriesByDocumentId,
  };
  await Promise.all([seedSourceRows(seedArgs), seedSourceRows(seedArgs)]);
  const concurrentSourceRows = await db
    .select({ id: schema.contentDatabaseSourceRows.id })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, "src-duplicates"));
  expect(concurrentSourceRows).toHaveLength(2);
});

it("resync advances Builder partial reads with a cursor and converges on the final page", async () => {
  builderReadMock.mode = "paged";
  builderReadMock.calls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_resync_partial";
  const databaseDocId = "doc_db_resync_partial";
  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "DB partial",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB partial",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: "src-partial",
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-a",
    sourceTable: "collection-a",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values([
    {
      id: "prop-author",
      ownerEmail: OWNER,
      databaseId,
      name: "Author",
      type: "text",
      position: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prop-date",
      ownerEmail: OWNER,
      databaseId,
      name: "Date",
      type: "date",
      position: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabaseSourceFields).values([
    {
      id: "field-author",
      ownerEmail: OWNER,
      sourceId: "src-partial",
      propertyId: "prop-author",
      localFieldKey: "prop-author",
      sourceFieldKey: "data.author",
      sourceFieldLabel: "Author",
      sourceFieldType: "text",
      mappingType: "property",
      writeOwner: "source",
      readOnly: 0,
      provenance: "Builder model field",
      freshness: "fresh",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "field-date",
      ownerEmail: OWNER,
      sourceId: "src-partial",
      propertyId: "prop-date",
      localFieldKey: "prop-date",
      sourceFieldKey: "data.date",
      sourceFieldLabel: "Date",
      sourceFieldType: "datetime",
      mappingType: "property",
      writeOwner: "source",
      readOnly: 0,
      provenance: "Builder model field",
      freshness: "fresh",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(schema.documents).values({
    id: "doc-stale",
    ownerEmail: OWNER,
    parentId: databaseDocId,
    title: "Stale",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: "item_doc-stale",
    ownerEmail: OWNER,
    databaseId,
    documentId: "doc-stale",
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row-stale",
    ownerEmail: OWNER,
    sourceId: "src-partial",
    databaseItemId: "item_doc-stale",
    documentId: "doc-stale",
    sourceRowId: "entry-stale",
    sourceQualifiedId: "q_entry-stale",
    sourceDisplayKey: "Stale",
    sourceValuesJson: "{}",
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  let [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-partial"));

  await resync({ database, source, now: "2026-01-01T00:00:00.000Z" });
  let [afterFirst] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-partial"));
  let metadata = JSON.parse(afterFirst.metadataJson ?? "{}");
  expect(afterFirst.syncState).toBe("refreshing");
  expect(afterFirst.freshness).toBe("stale");
  expect(metadata.lastReadNextOffset).toBe(1);
  expect(metadata.lastReadFetchedEntryCount).toBe(1);
  expect(metadata.lastReadPartial).toBe(true);
  expect(metadata.sourceFetchState).toBe("fetching");
  expect(metadata.activeReadSourceRowIds).toEqual(["entry-a1"]);

  let rows = await db
    .select({ sourceRowId: schema.contentDatabaseSourceRows.sourceRowId })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, "src-partial"));
  expect(
    rows.map((row: { sourceRowId: string }) => row.sourceRowId).sort(),
  ).toEqual(["entry-a1", "entry-stale"]);
  let fields = await db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, "src-partial"));
  expect(
    fields
      .filter((field: { sourceFieldKey: string }) =>
        ["data.author", "data.date"].includes(field.sourceFieldKey),
      )
      .map(
        (field: {
          id: string;
          propertyId: string | null;
          localFieldKey: string;
          sourceFieldKey: string;
        }) => ({
          id: field.id,
          propertyId: field.propertyId,
          localFieldKey: field.localFieldKey,
          sourceFieldKey: field.sourceFieldKey,
        }),
      )
      .sort((a, b) => a.sourceFieldKey.localeCompare(b.sourceFieldKey)),
  ).toEqual([
    {
      id: "field-author",
      propertyId: "prop-author",
      localFieldKey: "prop-author",
      sourceFieldKey: "data.author",
    },
    {
      id: "field-date",
      propertyId: "prop-date",
      localFieldKey: "prop-date",
      sourceFieldKey: "data.date",
    },
  ]);
  const [firstUnboundUrlField] = fields.filter(
    (field: { sourceFieldKey: string; propertyId: string | null }) =>
      field.sourceFieldKey === "data.url" && !field.propertyId,
  );
  expect(firstUnboundUrlField?.id).toBeTruthy();
  let values = await db
    .select({
      documentId: schema.documentPropertyValues.documentId,
      propertyId: schema.documentPropertyValues.propertyId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues);
  expect(
    values.map(
      (value: { propertyId: string; valueJson: string }) =>
        `${value.propertyId}:${value.valueJson}`,
    ),
  ).toContain('prop-author:"Ada Lovelace"');
  expect(
    values.some(
      (value: { propertyId: string; valueJson: string }) =>
        value.propertyId === "prop-date" && JSON.parse(value.valueJson),
    ),
  ).toBe(true);

  source = afterFirst;
  await resync({ database, source, now: "2026-01-01T00:01:00.000Z" });
  const [afterSecond] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-partial"));
  metadata = JSON.parse(afterSecond.metadataJson ?? "{}");
  expect(afterSecond.syncState).toBe("idle");
  expect(afterSecond.freshness).toBe("fresh");
  expect(metadata.lastReadNextOffset).toBe(2);
  expect(metadata.lastReadFetchedEntryCount).toBe(2);
  expect(metadata.lastReadPartial).toBe(false);
  expect(metadata.sourceFetchState).toBe("idle");
  expect(metadata.activeReadSourceRowIds).toBeUndefined();

  rows = await db
    .select({ sourceRowId: schema.contentDatabaseSourceRows.sourceRowId })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, "src-partial"));
  expect(
    rows.map((row: { sourceRowId: string }) => row.sourceRowId).sort(),
  ).toEqual(["entry-a1", "entry-a2"]);
  fields = await db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, "src-partial"));
  const [secondUnboundUrlField] = fields.filter(
    (field: { sourceFieldKey: string; propertyId: string | null }) =>
      field.sourceFieldKey === "data.url" && !field.propertyId,
  );
  expect(secondUnboundUrlField?.id).toBe(firstUnboundUrlField.id);
  expect(
    fields
      .filter((field: { sourceFieldKey: string }) =>
        ["data.author", "data.date"].includes(field.sourceFieldKey),
      )
      .every((field: { propertyId: string | null }) => field.propertyId),
  ).toBe(true);
  values = await db
    .select({
      propertyId: schema.documentPropertyValues.propertyId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues);
  expect(
    values.map(
      (value: { propertyId: string; valueJson: string }) =>
        `${value.propertyId}:${value.valueJson}`,
    ),
  ).toEqual(
    expect.arrayContaining([
      'prop-author:"Ada Lovelace"',
      'prop-author:"Grace Hopper"',
    ]),
  );
  expect(builderReadMock.calls.map((call) => call.offset ?? 0)).toEqual([0, 1]);
});

it("full Builder refresh reads every page in one resync call", async () => {
  builderReadMock.mode = "paged";
  builderReadMock.calls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_resync_full_refresh";
  const databaseDocId = "doc_db_resync_full_refresh";
  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "DB full refresh",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB full refresh",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: "src-full-refresh",
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-a",
    sourceTable: "collection-a",
    metadataJson: JSON.stringify({
      sourceFetchState: "fetching",
      lastReadHasMore: true,
      lastReadNextOffset: 1,
      activeReadSourceRowIds: ["entry-a1"],
    }),
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-full-refresh"));

  await resync({
    database,
    source,
    now: "2026-01-01T00:02:00.000Z",
    runFullRefresh: true,
  });

  const [after] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-full-refresh"));
  const metadata = JSON.parse(after.metadataJson ?? "{}");
  expect(after.syncState).toBe("idle");
  expect(after.freshness).toBe("fresh");
  expect(metadata.lastReadFetchedEntryCount).toBe(2);
  expect(metadata.lastReadPartial).toBe(false);
  expect(metadata.sourceFetchState).toBe("idle");
  expect(metadata.activeReadSourceRowIds).toBeUndefined();

  const rows = await db
    .select({ sourceRowId: schema.contentDatabaseSourceRows.sourceRowId })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, "src-full-refresh"));
  expect(
    rows.map((row: { sourceRowId: string }) => row.sourceRowId).sort(),
  ).toEqual(["entry-a1", "entry-a2"]);
  expect(
    builderReadMock.calls.map(({ model, maxPages, offset }) => ({
      model,
      maxPages,
      offset,
    })),
  ).toEqual([{ model: "collection-a", maxPages: undefined, offset: 0 }]);
});

it("keeps a materialized required Builder reference dispatchable after full refresh", async () => {
  const db = getDb();
  const now = "2026-07-14T05:00:00.000Z";
  const databaseId = "db-required-reference-refresh";
  const databaseDocumentId = "doc-db-required-reference-refresh";
  const rowDocumentId = "doc-required-reference-refresh";
  const itemId = "item-required-reference-refresh";
  const sourceId = "source-required-reference-refresh";
  const propertyId = "property-required-reference-author";
  const entryId = "entry-required-reference-refresh";

  await db.insert(schema.documents).values([
    {
      id: databaseDocumentId,
      ownerEmail: OWNER,
      title: "Required reference database",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: rowDocumentId,
      ownerEmail: OWNER,
      parentId: databaseDocumentId,
      title: "Required reference refresh",
      content: "A local body change.",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: "Required reference database",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId: rowDocumentId,
    position: 0,
    bodyHydrationStatus: "complete",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail: OWNER,
    databaseId,
    name: "Author",
    type: "select",
    visibility: "always_show",
    optionsJson: JSON.stringify({
      options: [{ id: "author-apoorva", name: "Apoorva", color: "blue" }],
    }),
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyValues).values({
    id: "value-required-reference-author",
    ownerEmail: OWNER,
    documentId: rowDocumentId,
    propertyId,
    valueJson: JSON.stringify("author-apoorva"),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: BUILDER_CMS_SAFE_WRITE_MODEL,
    sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
    capabilitiesJson: JSON.stringify({
      canRefresh: true,
      canCreateChangeSets: true,
      canWriteFields: true,
      canWriteBody: true,
      canPush: true,
      canPull: true,
      canPublish: true,
      canDelete: false,
      canStageLocalRevision: true,
      liveWritesEnabled: true,
      readOnlyRefresh: true,
    }),
    metadataJson: JSON.stringify({
      writeMode: "publish_updates",
      pushMode: "publish",
      allowedWriteModes: ["publish"],
      allowPublicationTransitions: true,
      liveReadConfigured: true,
      builderModelFields: [
        { name: "title", type: "string", required: true },
        {
          name: "author",
          type: "reference",
          required: true,
          model: "blog-author",
        },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  });
  // This is the persisted state after required-field materialization: the
  // property is bound and stores the canonical Builder author entry id, while
  // the older projected mapping still says `select`.
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: "field-required-reference-author",
    ownerEmail: OWNER,
    sourceId,
    propertyId,
    localFieldKey: propertyId,
    sourceFieldKey: "data.author",
    sourceFieldLabel: "Author",
    sourceFieldType: "select",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "Builder model field",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row-required-reference-refresh",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId: rowDocumentId,
    sourceRowId: entryId,
    sourceQualifiedId: `builder-cms://${BUILDER_CMS_SAFE_WRITE_MODEL}/${entryId}`,
    sourceDisplayKey: "Required reference refresh",
    sourceValuesJson: JSON.stringify({
      "data.title": "Required reference refresh",
      "data.author": "Apoorva",
      "__agent_native_builder_reference_id:data.author": "author-apoorva",
    }),
    provenance: "Builder CMS read adapter",
    syncState: "linked",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  await resync({
    database,
    source,
    now: "2026-07-14T05:01:00.000Z",
    runFullRefresh: true,
  });

  const [refreshedSource] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  expect(
    JSON.parse(refreshedSource.metadataJson).builderModelFields.find(
      (field: { name: string }) => field.name === "author",
    ),
  ).toMatchObject({ type: "reference", model: "blog-author" });
  const [refreshedField] = await db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(
      and(
        eq(schema.contentDatabaseSourceFields.sourceId, sourceId),
        eq(schema.contentDatabaseSourceFields.sourceFieldKey, "data.author"),
      ),
    );
  expect(refreshedField).toMatchObject({
    propertyId,
    localFieldKey: propertyId,
    sourceFieldType: "reference",
  });

  const snapshot = await getWriteSnapshot(database);
  const refreshedRow = snapshot?.rows.find(
    (row) => row.sourceRowId === entryId,
  );
  expect(
    refreshedRow?.sourceValues[
      "__agent_native_builder_reference_id:data.author"
    ],
  ).toBe("author-apoorva");
  const plan = buildBuilderCmsExecutionPlan({
    source: snapshot!,
    changeSet: {
      id: "change-required-reference-refresh",
      databaseItemId: itemId,
      documentId: rowDocumentId,
      kind: "body_update",
      direction: "outbound",
      state: "approved",
      pushMode: "publish",
      localOnly: true,
      summary: "Publish body after full refresh.",
      fieldChanges: [],
      bodyChange: {
        summary: "Body changed",
        currentExcerpt: null,
        proposedExcerpt: "Fresh body",
        proposedBlocksJson: "[]",
      },
      riskLevel: "low",
      riskReasons: [],
      conflictState: "none",
      reviewEvents: [],
      executions: [],
      createdAt: now,
      updatedAt: now,
    },
    pushModeConfirmation: "publish",
    publicationTransition: "publish",
  });
  expect(plan.state).toBe("ready");
  expect(plan.payload.request.body).toMatchObject({
    data: {
      author: {
        "@type": "@builder.io/core:Reference",
        id: "author-apoorva",
        model: "blog-author",
      },
    },
  });
  expect(plan.payload.safety.blockers).toEqual([]);
});

it("finishes a Builder continuation when optional model field metadata fails", async () => {
  builderReadMock.mode = "paged";
  builderReadMock.calls = [];
  builderReadMock.modelFieldsErrorFor = "collection-a";
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_resync_model_fields_error";
  const databaseDocId = "doc_db_resync_model_fields_error";
  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "DB model fields error",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB model fields error",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: "src-model-fields-error",
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-a",
    sourceTable: "collection-a",
    metadataJson: JSON.stringify({
      sourceFetchState: "fetching",
      lastReadHasMore: true,
      lastReadNextOffset: 1,
      activeReadSourceRowIds: ["entry-a1"],
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: "field-model-fields-error-author",
    ownerEmail: OWNER,
    sourceId: "src-model-fields-error",
    propertyId: null,
    localFieldKey: "data.author",
    sourceFieldKey: "data.author",
    sourceFieldLabel: "Author",
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "Builder model field",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-model-fields-error"));

  await expect(
    resync({
      database,
      source,
      now: "2026-01-01T00:03:00.000Z",
    }),
  ).resolves.toBeUndefined();

  const [after] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, "src-model-fields-error"));
  const metadata = JSON.parse(after.metadataJson ?? "{}");
  expect(after.syncState).toBe("idle");
  expect(after.lastError).toBeNull();
  expect(metadata.lastReadFetchedEntryCount).toBe(2);
  expect(metadata.lastReadPartial).toBe(false);
  expect(metadata.sourceFetchState).toBe("idle");
  expect(metadata.activeReadSourceRowIds).toBeUndefined();
  expect(
    builderReadMock.calls.map(({ model, maxPages, offset }) => ({
      model,
      maxPages,
      offset,
    })),
  ).toEqual([{ model: "collection-a", maxPages: 1, offset: 1 }]);
  const preservedFields = await db
    .select({
      id: schema.contentDatabaseSourceFields.id,
      sourceFieldKey: schema.contentDatabaseSourceFields.sourceFieldKey,
    })
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id));
  expect(preservedFields).toContainEqual({
    id: "field-model-fields-error-author",
    sourceFieldKey: "data.author",
  });

  builderReadMock.modelFieldsErrorFor = null;
});

it("continues a 597-row snapshot past offset 500 without pruning or restarting", async () => {
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = "2026-07-10T12:00:00.000Z";
  const databaseId = "db-large-597";
  const databaseDocumentId = "doc-db-large-597";
  const sourceId = "source-large-597";
  await db.insert(schema.documents).values({
    id: databaseDocumentId,
    ownerEmail: OWNER,
    title: "Large database",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: "Large database",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "Large Builder source",
    sourceTable: "collection-large-597",
    createdAt: now,
    updatedAt: now,
  });
  const persistedDocuments = Array.from({ length: 597 }, (_, index) => ({
    id: `doc-large-${index + 1}`,
    ownerEmail: OWNER,
    parentId: databaseDocumentId,
    title: `Large entry ${index + 1}`,
    content: `Persisted body ${index + 1}`,
    position: index,
    createdAt: now,
    updatedAt: now,
  }));
  const persistedItems = persistedDocuments.map((document, index) => ({
    id: `item-large-${index + 1}`,
    ownerEmail: OWNER,
    databaseId,
    documentId: document.id,
    position: index,
    bodyHydrationStatus: "hydrated" as const,
    bodyHydrationVersion: `large-hash-${index + 1}:readable-native-images-v5`,
    createdAt: now,
    updatedAt: now,
  }));
  const persistedRows = persistedDocuments.map((document, index) => ({
    id: `row-large-${index + 1}`,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: persistedItems[index]!.id,
    documentId: document.id,
    sourceRowId: `entry-large-${index + 1}`,
    sourceQualifiedId: `builder-cms://collection-large-597/entry-large-${index + 1}`,
    sourceDisplayKey: document.title,
    sourceValuesJson: JSON.stringify({
      "data.title": document.title,
      "data.url": `/large-entry-${index + 1}`,
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: `large-hash-${index + 1}`,
    }),
    provenance: "Builder CMS read adapter",
    lastSourceUpdatedAt: "2026-02-01T00:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  }));
  for (let start = 0; start < persistedDocuments.length; start += 100) {
    await db
      .insert(schema.documents)
      .values(persistedDocuments.slice(start, start + 100));
    await db
      .insert(schema.contentDatabaseItems)
      .values(persistedItems.slice(start, start + 100));
    await db
      .insert(schema.contentDatabaseSourceRows)
      .values(persistedRows.slice(start, start + 100));
  }
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const partialRowCounts: number[] = [];
  for (let page = 0; page < 6; page += 1) {
    const [source] = await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, sourceId));
    await resync({
      database,
      source,
      now: `2026-07-10T12:0${page}:00.000Z`,
    });
    for (let drain = 0; drain < 4; drain += 1) {
      const queuedBodies = await db
        .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
        .from(schema.contentDatabaseBodyHydrationQueue)
        .where(eq(schema.contentDatabaseBodyHydrationQueue.sourceId, sourceId));
      if (queuedBodies.length === 0) break;
      await hydrateQueuedBodies({ sourceId, limit: 50 });
    }
    const rows = await db
      .select({ sourceRowId: schema.contentDatabaseSourceRows.sourceRowId })
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
    partialRowCounts.push(rows.length);
    expect(rows.some((row) => row.sourceRowId === "entry-large-1")).toBe(true);
    const queuedBodies = await db
      .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
      .from(schema.contentDatabaseBodyHydrationQueue)
      .where(eq(schema.contentDatabaseBodyHydrationQueue.sourceId, sourceId));
    expect(queuedBodies).toHaveLength(0);
  }

  expect(partialRowCounts).toEqual([597, 597, 597, 597, 597, 597]);
  expect(
    builderReadMock.calls
      .filter((call) => call.model === "collection-large-597")
      .map((call) => call.offset),
  ).toEqual([0, 100, 200, 300, 400, 500]);
  const [finishedSource] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  const metadata = JSON.parse(finishedSource.metadataJson ?? "{}");
  expect(finishedSource.syncState).toBe("idle");
  expect(finishedSource.lastError).toBeNull();
  expect(metadata).toMatchObject({
    lastReadFetchedEntryCount: 597,
    lastReadNextOffset: 597,
    lastReadHasMore: false,
    lastReadPartial: false,
    lastReadSuspiciousEmpty: false,
    sourceFetchState: "idle",
  });
  expect(metadata.activeReadSourceRowIds).toBeUndefined();
  const persistedChangeSets = await db
    .select({ id: schema.contentDatabaseSourceChangeSets.id })
    .from(schema.contentDatabaseSourceChangeSets)
    .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, sourceId));
  expect(persistedChangeSets).toHaveLength(0);
});

it("materializes duplicate source rows with last value winning for new property values", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_materialize_last_new";
  const databaseDocId = "doc_db_materialize_last_new";
  const documentId = "doc_materialize_last_new";
  const sourceId = "src_materialize_last_new";
  const propertyId = "prop_materialize_last_new_author";
  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB materialize last new",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Materialize last new",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB materialize last new",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-materialize-last-new",
    sourceTable: "collection-materialize-last-new",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail: OWNER,
    databaseId,
    name: "Author",
    type: "text",
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  const field = {
    id: "field_materialize_last_new_author",
    ownerEmail: OWNER,
    sourceId,
    propertyId,
    localFieldKey: propertyId,
    sourceFieldKey: "data.author",
    sourceFieldLabel: "Author",
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "test",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.contentDatabaseSourceFields).values(field);
  await db.insert(schema.contentDatabaseSourceRows).values([
    {
      id: "row_materialize_last_new_second",
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: "item_materialize_last_new",
      documentId,
      sourceRowId: "entry_materialize_last_new_second",
      sourceQualifiedId: "builder-cms://collection-materialize-last-new/second",
      sourceDisplayKey: "Second",
      sourceValuesJson: JSON.stringify({ "data.author": "Second author" }),
      provenance: "test",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "row_materialize_last_new_first",
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: "item_materialize_last_new",
      documentId,
      sourceRowId: "entry_materialize_last_new_first",
      sourceQualifiedId: "builder-cms://collection-materialize-last-new/first",
      sourceDisplayKey: "First",
      sourceValuesJson: JSON.stringify({ "data.author": "First author" }),
      provenance: "test",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  await materializeSourceFields({
    database,
    sourceId,
    fields: [field],
    now: "2026-01-01T00:01:00.000Z",
  });

  const values = await db
    .select({ valueJson: schema.documentPropertyValues.valueJson })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.documentId, documentId),
        eq(schema.documentPropertyValues.propertyId, propertyId),
      ),
    );
  expect(values).toHaveLength(1);
  expect(JSON.parse(values[0]!.valueJson)).toBe("Second author");
});

it("materializes duplicate source rows with last value winning for existing property values", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_materialize_last_existing";
  const databaseDocId = "doc_db_materialize_last_existing";
  const documentId = "doc_materialize_last_existing";
  const sourceId = "src_materialize_last_existing";
  const propertyId = "prop_materialize_last_existing_author";
  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB materialize last existing",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Materialize last existing",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB materialize last existing",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-materialize-last-existing",
    sourceTable: "collection-materialize-last-existing",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail: OWNER,
    databaseId,
    name: "Author",
    type: "text",
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyValues).values({
    id: "value_materialize_last_existing_author",
    ownerEmail: OWNER,
    documentId,
    propertyId,
    valueJson: JSON.stringify("Original author"),
    createdAt: now,
    updatedAt: now,
  });
  const field = {
    id: "field_materialize_last_existing_author",
    ownerEmail: OWNER,
    sourceId,
    propertyId,
    localFieldKey: propertyId,
    sourceFieldKey: "data.author",
    sourceFieldLabel: "Author",
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "test",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.contentDatabaseSourceFields).values(field);
  await db.insert(schema.contentDatabaseSourceRows).values([
    {
      id: "row_materialize_last_existing_second",
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: "item_materialize_last_existing",
      documentId,
      sourceRowId: "entry_materialize_last_existing_second",
      sourceQualifiedId:
        "builder-cms://collection-materialize-last-existing/second",
      sourceDisplayKey: "Second",
      sourceValuesJson: JSON.stringify({ "data.author": "Second author" }),
      provenance: "test",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "row_materialize_last_existing_first",
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: "item_materialize_last_existing",
      documentId,
      sourceRowId: "entry_materialize_last_existing_first",
      sourceQualifiedId:
        "builder-cms://collection-materialize-last-existing/first",
      sourceDisplayKey: "First",
      sourceValuesJson: JSON.stringify({ "data.author": "First author" }),
      provenance: "test",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  await materializeSourceFields({
    database,
    sourceId,
    fields: [field],
    now: "2026-01-01T00:01:00.000Z",
  });

  const values = await db
    .select({
      id: schema.documentPropertyValues.id,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.documentId, documentId),
        eq(schema.documentPropertyValues.propertyId, propertyId),
      ),
    );
  expect(values).toHaveLength(1);
  expect(values[0]!.id).toBe("value_materialize_last_existing_author");
  expect(JSON.parse(values[0]!.valueJson)).toBe("Second author");
});

it("does not let open-row hydration promotion downgrade a queued full Builder body", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_open_hydration_downgrade";
  const databaseDocId = "doc_db_open_hydration_downgrade";
  const documentId = "doc_open_hydration_downgrade";
  const itemId = "item_open_hydration_downgrade";
  const sourceId = "src_open_hydration_downgrade";
  const rowId = "row_open_hydration_downgrade";
  const queueId = "queue_open_hydration_downgrade";
  const sourceRowId = "entry_open_hydration_downgrade";
  const fullBody = "This full Builder body must survive open-row promotion.";

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB open hydration downgrade",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Open hydration downgrade",
      content: "<empty-block/>",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB open hydration downgrade",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationError: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-open-hydration",
    sourceTable: "collection-open-hydration",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: rowId,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-open-hydration/${sourceRowId}`,
    sourceDisplayKey: "Open hydration downgrade",
    sourceValuesJson: JSON.stringify({
      "data.title": "Open hydration downgrade",
      "data.url": "/blog/open-hydration-downgrade",
      lastUpdated: "2026-01-01T00:00:00.000Z",
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
    id: queueId,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceTable: "collection-open-hydration",
    sourceEntryJson: JSON.stringify({
      id: sourceRowId,
      model: "collection-open-hydration",
      title: "Open hydration downgrade",
      urlPath: "/blog/open-hydration-downgrade",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourceValues: {
        "data.title": "Open hydration downgrade",
        "data.url": "/blog/open-hydration-downgrade",
        lastUpdated: "2026-01-01T00:00:00.000Z",
        [BUILDER_CMS_BODY_CONTENT_KEY]: fullBody,
      },
    }),
    priority: 10,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });

  await hydrateQueuedBodies({ sourceId, documentId, limit: 1 });

  const [after] = await db
    .select({
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      queued: schema.contentDatabaseBodyHydrationQueue.id,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.documents.id, documentId));

  expect(after.content).toBe(fullBody);
  expect(after.status).toBe("hydrated");
  expect(after.queued).toBeNull();
});

it("fetches a live Builder body when an opened row only has stored body metadata", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_open_hydration_live_body";
  const databaseDocId = "doc_db_open_hydration_live_body";
  const documentId = "doc_open_hydration_live_body";
  const itemId = "item_open_hydration_live_body";
  const sourceId = "src_open_hydration_live_body";
  const sourceRowId = "entry_open_hydration_live_body";

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB open hydration live body",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Open live hydration",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB open hydration live body",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-open-hydration-live",
    sourceTable: "collection-open-hydration-live",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationError: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_open_hydration_live_body",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-open-hydration-live/${sourceRowId}`,
    sourceDisplayKey: "Open live hydration",
    sourceValuesJson: JSON.stringify({
      "data.title": "Open live hydration",
      "data.url": "/blog/open-live-hydration",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "stored-blocks-hash",
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });

  await seedCollabFromText(documentId, "Existing collab state");

  const result = await hydrateQueuedBodies({ sourceId, documentId, limit: 1 });

  const [after] = await db
    .select({
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      error: schema.contentDatabaseItems.bodyHydrationError,
      queued: schema.contentDatabaseBodyHydrationQueue.id,
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .innerJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.documents.id, documentId));
  const sourceValues = JSON.parse(after.sourceValuesJson ?? "{}");

  expect(result.processed).toBe(1);
  expect(result.succeeded).toBe(1);
  expect(after.content).toContain("Live opened row body from Builder.");
  expect(after.status).toBe("hydrated");
  expect(after.error).toBeNull();
  expect(after.queued).toBeNull();
  expect(sourceValues[BUILDER_CMS_BODY_CONTENT_KEY]).toContain(
    "Live opened row body from Builder.",
  );
  expect(sourceValues[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).not.toBe(
    "stored-blocks-hash",
  );
  expect(builderReadMock.singleEntryCalls).toEqual([
    {
      model: "collection-open-hydration-live",
      entryId: sourceRowId,
    },
  ]);
  expect(await getCollabText(documentId)).toBe("Existing collab state");
});

it("queues body hydration for metadata-only Builder row reads", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_metadata_only_hydration";
  const databaseDocId = "doc_db_metadata_only_hydration";
  const sourceId = "src_metadata_only_hydration";

  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "Metadata-only hydration DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "Metadata-only hydration DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-metadata-only",
    sourceTable: "collection-metadata-only",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));

  await resync({
    database,
    source,
    now: "2026-01-01T00:10:00.000Z",
    runFullRefresh: true,
  });

  const readImported = async () => {
    const [row] = await db
      .select({
        content: schema.documents.content,
        status: schema.contentDatabaseItems.bodyHydrationStatus,
        queued: schema.contentDatabaseBodyHydrationQueue.id,
        sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .innerJoin(
        schema.contentDatabaseSourceRows,
        eq(
          schema.contentDatabaseSourceRows.databaseItemId,
          schema.contentDatabaseItems.id,
        ),
      )
      .leftJoin(
        schema.contentDatabaseBodyHydrationQueue,
        eq(
          schema.contentDatabaseBodyHydrationQueue.databaseItemId,
          schema.contentDatabaseItems.id,
        ),
      )
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    return row;
  };

  let after = await readImported();
  for (
    let attempt = 0;
    after.status !== "hydrated" && attempt < 10;
    attempt++
  ) {
    await hydrateQueuedBodies({ sourceId, limit: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    after = await readImported();
  }
  const sourceValues = JSON.parse(after.sourceValuesJson ?? "{}");

  expect(after.status).toBe("hydrated");
  expect(after.queued).toBeNull();
  expect(after.content).toContain(
    "Metadata-only row hydrated from a single-entry Builder read.",
  );
  expect(sourceValues[BUILDER_CMS_BODY_CONTENT_KEY]).toContain(
    "Metadata-only row hydrated from a single-entry Builder read.",
  );
  expect(builderReadMock.singleEntryCalls).toContainEqual({
    model: "collection-metadata-only",
    entryId: "entry-metadata-only-1",
  });
});

it("repairs metadata-only Builder rows incorrectly marked hydrated with an empty document body", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_metadata_only_hydration_repair";
  const databaseDocId = "doc_db_metadata_only_hydration_repair";
  const documentId = "doc_metadata_only_hydration_repair";
  const itemId = "item_metadata_only_hydration_repair";
  const sourceId = "src_metadata_only_hydration_repair";
  const rowId = "row_metadata_only_hydration_repair";
  const sourceRowId = "entry-metadata-only-1";

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "Metadata-only hydration repair DB",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Metadata-only hydration",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "Metadata-only hydration repair DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "hydrated",
    bodyHydrationError: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-metadata-only",
    sourceTable: "collection-metadata-only",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: rowId,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-metadata-only/${sourceRowId}`,
    sourceDisplayKey: "Metadata-only hydration",
    sourceValuesJson: JSON.stringify({
      "data.title": "Metadata-only hydration",
      "data.url": "/blog/metadata-only-hydration",
      lastUpdated: "2026-01-01T00:00:00.000Z",
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));

  await resync({
    database,
    source,
    now: "2026-01-01T00:10:00.000Z",
    runFullRefresh: false,
  });

  let [after] = await db
    .select({
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .innerJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
  for (
    let attempt = 0;
    after.status !== "hydrated" ||
    !after.content?.includes(
      "Metadata-only row hydrated from a single-entry Builder read.",
    );
    attempt++
  ) {
    expect(attempt).toBeLessThan(10);
    await hydrateQueuedBodies({ sourceId, limit: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    [after] = await db
      .select({
        content: schema.documents.content,
        status: schema.contentDatabaseItems.bodyHydrationStatus,
        sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .innerJoin(
        schema.contentDatabaseSourceRows,
        eq(
          schema.contentDatabaseSourceRows.databaseItemId,
          schema.contentDatabaseItems.id,
        ),
      )
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
  }
  const sourceValues = JSON.parse(after.sourceValuesJson ?? "{}");

  expect(after.status).toBe("hydrated");
  expect(after.content).toContain(
    "Metadata-only row hydrated from a single-entry Builder read.",
  );
  expect(sourceValues[BUILDER_CMS_BODY_CONTENT_KEY]).toContain(
    "Metadata-only row hydrated from a single-entry Builder read.",
  );
  expect(builderReadMock.singleEntryCalls).toContainEqual({
    model: "collection-metadata-only",
    entryId: sourceRowId,
  });
});

it("rebuilds an empty queued Builder body from the current source row before giving up", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_rebuild_from_source";
  const databaseDocId = "doc_db_hydration_rebuild_from_source";
  const documentId = "doc_hydration_rebuild_from_source";
  const itemId = "item_hydration_rebuild_from_source";
  const sourceId = "src_hydration_rebuild_from_source";
  const sourceRowId = "entry_hydration_rebuild_from_source";
  const fullBody = "Current source row body should hydrate the opened row.";

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB hydration rebuild",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Hydration rebuild",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration rebuild",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration-rebuild",
    sourceTable: "collection-hydration-rebuild",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationError: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_hydration_rebuild_from_source",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-hydration-rebuild/${sourceRowId}`,
    sourceDisplayKey: "Hydration rebuild",
    sourceValuesJson: JSON.stringify({
      "data.title": "Hydration rebuild",
      "data.url": "/blog/hydration-rebuild",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      [BUILDER_CMS_BODY_CONTENT_KEY]: fullBody,
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
    id: "queue_hydration_rebuild_from_source",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceTable: "collection-hydration-rebuild",
    sourceEntryJson: JSON.stringify({
      id: sourceRowId,
      model: "collection-hydration-rebuild",
      title: "Hydration rebuild",
      urlPath: "/blog/hydration-rebuild",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourceValues: {
        "data.title": "Hydration rebuild",
        "data.url": "/blog/hydration-rebuild",
        lastUpdated: "2026-01-01T00:00:00.000Z",
        [BUILDER_CMS_BODY_CONTENT_KEY]: "",
      },
    }),
    priority: 0,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  });

  const first = await hydrateQueuedBodies({ sourceId, limit: 1 });
  const second = await hydrateQueuedBodies({ sourceId, limit: 1 });

  const [after] = await db
    .select({
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      error: schema.contentDatabaseItems.bodyHydrationError,
      queued: schema.contentDatabaseBodyHydrationQueue.id,
      attempts: schema.contentDatabaseBodyHydrationQueue.attempts,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.documents.id, documentId));

  expect(first.processed).toBe(1);
  expect(second.processed).toBe(0);
  expect(after.content).toBe(fullBody);
  expect(after.status).toBe("hydrated");
  expect(after.error).toBeNull();
  expect(after.queued).toBeNull();
  expect(after.attempts).toBeNull();
});

it("repairs a stale remote body hash without overwriting a locally diverged document", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_canonical_hash_repair";
  const databaseDocId = "doc_db_hydration_canonical_hash_repair";
  const documentId = "doc_hydration_canonical_hash_repair";
  const itemId = "item_hydration_canonical_hash_repair";
  const sourceId = "src_hydration_canonical_hash_repair";
  const sourceRowId = "entry_hydration_canonical_hash_repair";
  const localAuthoredBody = "Remote baseline with a deliberate local edit.";
  const authoredBlock = {
    "@type": "@builder.io/sdk:Element",
    "@version": 2,
    id: "authored-text-1",
    component: {
      name: "Text",
      options: { text: "<p>Remote baseline.</p>" },
    },
  };
  const trackingPixel = {
    "@type": "@builder.io/sdk:Element",
    id: "builder-pixel-old-response",
    tagName: "img",
    properties: {
      src: "https://cdn.builder.io/api/v1/pixel?apiKey=public-key",
      "aria-hidden": "true",
      alt: "",
      role: "presentation",
      width: "0",
      height: "0",
    },
  };
  const liveAuthoredBlock = {
    "@type": "@builder.io/sdk:Element",
    "@version": 2,
    id: "text-canonical-live",
    component: {
      name: "Text",
      options: { text: "<p>Fresh live remote baseline.</p>" },
    },
  };
  const canonicalHash = builderBlocksHash([liveAuthoredBlock]);
  const storedRemote = await withBuilderBodyValues({
    id: sourceRowId,
    model: "collection-canonical-hash-repair",
    title: "Canonical hash repair",
    urlPath: "/canonical-hash-repair",
    updatedAt: "2026-07-14T00:00:00.000Z",
    sourceValues: {
      "data.title": "Canonical hash repair",
      "data.url": "/canonical-hash-repair",
      lastUpdated: "2026-07-14T00:00:00.000Z",
    },
    rawEntry: {
      id: sourceRowId,
      model: "collection-canonical-hash-repair",
      data: { blocks: [authoredBlock, trackingPixel] },
    },
  });
  const staleSourceValues = {
    ...storedRemote.sourceValues,
    [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "legacy-pixel-sensitive-hash",
  };

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB canonical hash repair",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Canonical hash repair",
      content: localAuthoredBody,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB canonical hash repair",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-canonical-hash-repair",
    sourceTable: "collection-canonical-hash-repair",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationVersion:
      "2abdywxepbd:readable-native-images-fresh-raw-baseline-v8",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_hydration_canonical_hash_repair",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-canonical-hash-repair/${sourceRowId}`,
    sourceDisplayKey: "Canonical hash repair",
    sourceValuesJson: JSON.stringify(staleSourceValues),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
    id: "queue_hydration_canonical_hash_repair",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceTable: "collection-canonical-hash-repair",
    sourceEntryJson: JSON.stringify({
      ...storedRemote,
      rawEntry: undefined,
      sourceValues: staleSourceValues,
    }),
    priority: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });

  const result = await hydrateQueuedBodies({ sourceId, limit: 1 });
  const [after] = await db
    .select({
      content: schema.documents.content,
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      version: schema.contentDatabaseItems.bodyHydrationVersion,
      queued: schema.contentDatabaseBodyHydrationQueue.id,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .innerJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.documents.id, documentId));
  const repairedValues = JSON.parse(after.sourceValuesJson) as Record<
    string,
    unknown
  >;

  expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
  expect(after.content).toBe(localAuthoredBody);
  expect(repairedValues[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).toBe(canonicalHash);
  expect(repairedValues[BUILDER_CMS_BODY_CONTENT_KEY]).toContain(
    "Fresh live remote baseline.",
  );
  expect(repairedValues[BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]).toBeTruthy();
  expect(repairedValues[BUILDER_CMS_BODY_SIDECARS_KEY]).toBeTruthy();
  expect(after.status).toBe("hydrated");
  expect(after.version).toBe(
    `${canonicalHash}:readable-native-images-authoritative-raw-baseline-v9`,
  );
  expect(after.queued).toBeNull();
  expect(builderReadMock.singleEntryCalls).toContainEqual({
    model: "collection-canonical-hash-repair",
    entryId: sourceRowId,
  });
});

it("preserves local content and the source baseline when Builder returns a conflicting same-version body", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_same_version_conflict";
  const databaseDocId = "doc_db_same_version_conflict";
  const documentId = "doc_same_version_conflict";
  const itemId = "item_same_version_conflict";
  const sourceId = "src_same_version_conflict";
  const sourceRowId = "entry_same_version_conflict";
  const lastUpdated = "2026-01-01T00:00:00.000Z";
  const publishedBlock = {
    "@type": "@builder.io/sdk:Element",
    id: "text-published-rich",
    component: {
      name: "Text",
      options: { text: "<p>Published rich body.</p>" },
    },
  };
  const publishedHash = builderBlocksHash([publishedBlock]);
  const publishedBaseline = await withBuilderBodyValues({
    id: sourceRowId,
    model: "collection-same-version-conflict",
    title: "Same version conflict",
    urlPath: "/blog/same-version-conflict",
    updatedAt: lastUpdated,
    sourceValues: {
      "data.title": "Same version conflict",
      "data.url": "/blog/same-version-conflict",
      lastUpdated,
    },
    rawEntry: {
      id: sourceRowId,
      model: "collection-same-version-conflict",
      lastUpdated,
      data: { blocks: [publishedBlock] },
    },
  });
  const localContent = `${String(
    publishedBaseline.sourceValues[BUILDER_CMS_BODY_CONTENT_KEY],
  )}\n\nLocal edit that must survive a conflicting response.`;

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB same version conflict",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Same version conflict",
      content: localContent,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB same version conflict",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-same-version-conflict",
    sourceTable: "collection-same-version-conflict",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationVersion: `${publishedHash}:readable-native-images-authoritative-raw-baseline-v9`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_same_version_conflict",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-same-version-conflict/${sourceRowId}`,
    sourceDisplayKey: "Same version conflict",
    sourceValuesJson: JSON.stringify({
      ...publishedBaseline.sourceValues,
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: publishedHash,
      [BUILDER_CMS_BODY_LAST_UPDATED_KEY]: lastUpdated,
    }),
    provenance: "Builder CMS read adapter",
    lastSourceUpdatedAt: lastUpdated,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
    id: "queue_same_version_conflict",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceTable: "collection-same-version-conflict",
    sourceEntryJson: JSON.stringify({
      id: sourceRowId,
      model: "collection-same-version-conflict",
      title: "Same version conflict",
      urlPath: "/blog/same-version-conflict",
      updatedAt: lastUpdated,
      sourceValues: {
        "data.title": "Same version conflict",
        lastUpdated,
      },
    }),
    priority: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });

  const result = await hydrateQueuedBodies({ sourceId, limit: 1 });
  const [after] = await db
    .select({
      content: schema.documents.content,
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      error: schema.contentDatabaseItems.bodyHydrationError,
      queued: schema.contentDatabaseBodyHydrationQueue.id,
      queueError: schema.contentDatabaseBodyHydrationQueue.lastError,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .innerJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.documents.id, documentId));
  const afterValues = JSON.parse(after.sourceValuesJson) as Record<
    string,
    unknown
  >;

  expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
  expect(after.content).toBe(localContent);
  expect(afterValues[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).toBe(publishedHash);
  expect(after.status).toBe("error");
  expect(after.error).toContain("inconsistent body variants");
  expect(after.queued).toBe("queue_same_version_conflict");
  expect(after.queueError).toContain("inconsistent body variants");
});

it("terminates an unbuildable empty Builder body job at the hydration cap", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_empty_terminal";
  const databaseDocId = "doc_db_hydration_empty_terminal";
  const documentId = "doc_hydration_empty_terminal";
  const itemId = "item_hydration_empty_terminal";
  const sourceId = "src_hydration_empty_terminal";
  const sourceRowId = "entry_hydration_empty_terminal";

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB hydration empty terminal",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Hydration empty terminal",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration empty terminal",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration-empty-terminal",
    sourceTable: "collection-hydration-empty-terminal",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationError: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_hydration_empty_terminal",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-hydration-empty-terminal/${sourceRowId}`,
    sourceDisplayKey: "Hydration empty terminal",
    sourceValuesJson: JSON.stringify({
      "data.title": "Hydration empty terminal",
      "data.url": "/blog/hydration-empty-terminal",
      lastUpdated: "2026-01-01T00:00:00.000Z",
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
    id: "queue_hydration_empty_terminal",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceTable: "collection-hydration-empty-terminal",
    sourceEntryJson: JSON.stringify({
      id: sourceRowId,
      model: "collection-hydration-empty-terminal",
      title: "Hydration empty terminal",
      urlPath: "/blog/hydration-empty-terminal",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourceValues: {
        "data.title": "Hydration empty terminal",
        "data.url": "/blog/hydration-empty-terminal",
        lastUpdated: "2026-01-01T00:00:00.000Z",
      },
    }),
    priority: 0,
    attempts: 4,
    createdAt: now,
    updatedAt: now,
  });

  await hydrateQueuedBodies({ sourceId, limit: 1 });

  const [after] = await db
    .select({
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      error: schema.contentDatabaseItems.bodyHydrationError,
      queued: schema.contentDatabaseBodyHydrationQueue.id,
      attempts: schema.contentDatabaseBodyHydrationQueue.attempts,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.documents.id, documentId));

  expect(after.content).toBe("");
  expect(after.status).toBe("unavailable");
  expect(after.error).toBeNull();
  expect(after.queued).toBeNull();
  expect(after.attempts).toBeNull();
});

it("re-enqueues hydrated Builder rows with empty document content on resync", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_empty_repair";
  const databaseDocId = "doc_db_hydration_empty_repair";
  const documentId = "doc_hydration_empty_repair";
  const itemId = "item_hydration_empty_repair";
  const sourceId = "src_hydration_empty_repair";
  const sourceRowId = "entry-hydration-1";
  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB hydration empty repair",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Hydration One",
      content: "   ",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration empty repair",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration-repair-offline",
    sourceTable: "collection-hydration-repair-offline",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "hydrated",
    bodyHydrationError: null,
    bodyHydrationVersion: "2026-01-01T00:00:00.000Z:readable-native-images-v5",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_hydration_empty_repair",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-hydration-repair-offline/${sourceRowId}`,
    sourceDisplayKey: "Hydration One",
    sourceValuesJson: JSON.stringify({
      "data.title": "Hydration One",
      "data.url": "/blog/hydration-one",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Hydrated body One baseline.",
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));

  await resync({
    database,
    source,
    now: "2026-01-01T00:20:00.000Z",
    runFullRefresh: true,
  });

  let [after] = await db
    .select({
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .where(eq(schema.documents.id, documentId));
  for (
    let attempt = 0;
    after.status !== "hydrated" ||
    after.content !== "Hydrated body One baseline.";
    attempt++
  ) {
    expect(attempt).toBeLessThan(10);
    await hydrateQueuedBodies({ sourceId, limit: 10 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    [after] = await db
      .select({
        content: schema.documents.content,
        status: schema.contentDatabaseItems.bodyHydrationStatus,
      })
      .from(schema.documents)
      .innerJoin(
        schema.contentDatabaseItems,
        eq(schema.contentDatabaseItems.documentId, schema.documents.id),
      )
      .where(eq(schema.documents.id, documentId));
  }

  expect(after.status).toBe("hydrated");
  expect(after.content).toBe("Hydrated body One baseline.");
});

it("does not claim a preloaded Builder body job after it is superseded", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_superseded_claim";
  const databaseDocId = "doc_db_hydration_superseded_claim";
  const documentId = "doc_hydration_superseded_claim";
  const itemId = "item_hydration_superseded_claim";
  const sourceId = "src_hydration_superseded_claim";
  const sourceRowId = "entry_hydration_superseded_claim";
  const queueId = "queue_hydration_superseded_claim";
  const originalEntry = {
    id: sourceRowId,
    model: "collection-hydration-superseded",
    title: "Hydration superseded",
    urlPath: "/blog/hydration-superseded",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceValues: {
      "data.title": "Hydration superseded",
      "data.url": "/blog/hydration-superseded",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Original body",
    },
  };
  const supersedingEntry = {
    ...originalEntry,
    updatedAt: "2026-01-01T00:05:00.000Z",
    sourceValues: {
      ...originalEntry.sourceValues,
      lastUpdated: "2026-01-01T00:05:00.000Z",
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Superseding body",
    },
  };

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB hydration superseded",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Hydration superseded",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration superseded",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration-superseded",
    sourceTable: "collection-hydration-superseded",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationError: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_hydration_superseded_claim",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-hydration-superseded/${sourceRowId}`,
    sourceDisplayKey: "Hydration superseded",
    sourceValuesJson: JSON.stringify({
      "data.title": "Hydration superseded",
      "data.url": "/blog/hydration-superseded",
      lastUpdated: "2026-01-01T00:00:00.000Z",
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
    id: queueId,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceTable: "collection-hydration-superseded",
    sourceEntryJson: JSON.stringify(originalEntry),
    priority: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  const [staleJob] = await db
    .select()
    .from(schema.contentDatabaseBodyHydrationQueue)
    .where(eq(schema.contentDatabaseBodyHydrationQueue.id, queueId));
  await db
    .update(schema.contentDatabaseBodyHydrationQueue)
    .set({
      sourceEntryJson: JSON.stringify(supersedingEntry),
      updatedAt: "2026-01-01T00:05:00.000Z",
    })
    .where(eq(schema.contentDatabaseBodyHydrationQueue.id, queueId));

  const result = await hydrateQueuedBodies({
    sourceId,
    limit: 1,
    preloadedJobs: [staleJob],
  });

  const [after] = await db
    .select({
      attempts: schema.contentDatabaseBodyHydrationQueue.attempts,
      sourceEntryJson: schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
    })
    .from(schema.contentDatabaseBodyHydrationQueue)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(
        schema.contentDatabaseItems.id,
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
      ),
    )
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(eq(schema.contentDatabaseBodyHydrationQueue.id, queueId));

  expect(result.processed).toBe(0);
  expect(result.succeeded).toBe(0);
  expect(after.attempts).toBe(0);
  expect(JSON.parse(after.sourceEntryJson).sourceValues).toMatchObject({
    [BUILDER_CMS_BODY_CONTENT_KEY]: "Superseding body",
  });
  expect(after.content).toBe("");
  expect(after.status).toBe("pending");
});

it("supplements preloaded Builder body jobs with older persisted queue rows", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_preloaded_supplement";
  const databaseDocId = "doc_db_hydration_preloaded_supplement";
  const sourceId = "src_hydration_preloaded_supplement";
  const olderDocumentId = "doc_hydration_preloaded_supplement_older";
  const freshDocumentId = "doc_hydration_preloaded_supplement_fresh";
  const olderItemId = "item_hydration_preloaded_supplement_older";
  const freshItemId = "item_hydration_preloaded_supplement_fresh";
  const olderQueueId = "queue_hydration_preloaded_supplement_older";
  const freshQueueId = "queue_hydration_preloaded_supplement_fresh";
  const entry = (id: string, body: string) => ({
    id,
    model: "collection-hydration-preloaded-supplement",
    title: id,
    urlPath: `/blog/${id}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceValues: {
      "data.title": id,
      "data.url": `/blog/${id}`,
      lastUpdated: "2026-01-01T00:00:00.000Z",
      [BUILDER_CMS_BODY_CONTENT_KEY]: body,
    },
  });
  const olderEntry = entry("entry-hydration-preloaded-older", "Older body");
  const freshEntry = entry("entry-hydration-preloaded-fresh", "Fresh body");

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB hydration preloaded supplement",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: olderDocumentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Older hydration",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: freshDocumentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Fresh hydration",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration preloaded supplement",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration-preloaded-supplement",
    sourceTable: "collection-hydration-preloaded-supplement",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values([
    {
      id: olderItemId,
      ownerEmail: OWNER,
      databaseId,
      documentId: olderDocumentId,
      position: 0,
      bodyHydrationStatus: "pending",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: freshItemId,
      ownerEmail: OWNER,
      databaseId,
      documentId: freshDocumentId,
      position: 1,
      bodyHydrationStatus: "pending",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabaseSourceRows).values([
    {
      id: "row_hydration_preloaded_supplement_older",
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: olderItemId,
      documentId: olderDocumentId,
      sourceRowId: olderEntry.id,
      sourceQualifiedId: `builder-cms://collection-hydration-preloaded-supplement/${olderEntry.id}`,
      sourceDisplayKey: "Older hydration",
      sourceValuesJson: JSON.stringify(olderEntry.sourceValues),
      provenance: "Builder CMS read adapter",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "row_hydration_preloaded_supplement_fresh",
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: freshItemId,
      documentId: freshDocumentId,
      sourceRowId: freshEntry.id,
      sourceQualifiedId: `builder-cms://collection-hydration-preloaded-supplement/${freshEntry.id}`,
      sourceDisplayKey: "Fresh hydration",
      sourceValuesJson: JSON.stringify(freshEntry.sourceValues),
      provenance: "Builder CMS read adapter",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values([
    {
      id: olderQueueId,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: olderItemId,
      documentId: olderDocumentId,
      sourceRowId: olderEntry.id,
      sourceTable: "collection-hydration-preloaded-supplement",
      sourceEntryJson: JSON.stringify(olderEntry),
      priority: 0,
      attempts: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: freshQueueId,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: freshItemId,
      documentId: freshDocumentId,
      sourceRowId: freshEntry.id,
      sourceTable: "collection-hydration-preloaded-supplement",
      sourceEntryJson: JSON.stringify(freshEntry),
      priority: 0,
      attempts: 0,
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
    },
  ]);
  const [freshJob] = await db
    .select()
    .from(schema.contentDatabaseBodyHydrationQueue)
    .where(eq(schema.contentDatabaseBodyHydrationQueue.id, freshQueueId));

  const result = await hydrateQueuedBodies({
    sourceId,
    limit: 10,
    preloadedJobs: [freshJob],
  });

  const documents = await db
    .select({
      id: schema.documents.id,
      content: schema.documents.content,
    })
    .from(schema.documents)
    .where(eq(schema.documents.parentId, databaseDocId));
  expect(result.processed).toBe(2);
  expect(documents).toEqual(
    expect.arrayContaining([
      { id: olderDocumentId, content: "Older body" },
      { id: freshDocumentId, content: "Fresh body" },
    ]),
  );
});

it("does not let failed stale hydration retries clobber superseding queue rows", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  builderReadMock.singleEntryCalls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_failed_superseded";
  const databaseDocId = "doc_db_hydration_failed_superseded";
  const documentId = "doc_hydration_failed_superseded";
  const itemId = "item_hydration_failed_superseded";
  const sourceId = "src_hydration_failed_superseded";
  const sourceRowId = "entry-hydration-failed-superseded";
  const queueId = "queue_hydration_failed_superseded";
  const originalEntry = {
    id: sourceRowId,
    model: "collection-hydration-failed-superseded",
    title: "Hydration failed superseded",
    urlPath: "/blog/hydration-failed-superseded",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceValues: {
      "data.title": "Hydration failed superseded",
      "data.url": "/blog/hydration-failed-superseded",
      lastUpdated: "2026-01-01T00:00:00.000Z",
    },
  };
  const supersedingEntry = {
    ...originalEntry,
    sourceValues: {
      ...originalEntry.sourceValues,
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Superseding retry body",
    },
  };

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB hydration failed superseded",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Hydration failed superseded",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration failed superseded",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration-failed-superseded",
    sourceTable: "collection-hydration-failed-superseded",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationError: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_hydration_failed_superseded",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-hydration-failed-superseded/${sourceRowId}`,
    sourceDisplayKey: "Hydration failed superseded",
    sourceValuesJson: JSON.stringify(originalEntry.sourceValues),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
    id: queueId,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceTable: "collection-hydration-failed-superseded",
    sourceEntryJson: JSON.stringify(originalEntry),
    priority: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  builderReadMock.beforeSingleEntryRead = async () => {
    await db
      .update(schema.contentDatabaseBodyHydrationQueue)
      .set({
        sourceEntryJson: JSON.stringify(supersedingEntry),
        attempts: 0,
        lastError: null,
        priority: 0,
        updatedAt: "2026-01-01T00:05:00.000Z",
      })
      .where(eq(schema.contentDatabaseBodyHydrationQueue.id, queueId));
  };
  builderReadMock.singleEntryErrorFor =
    "collection-hydration-failed-superseded";

  const result = await hydrateQueuedBodies({ sourceId, limit: 1 });

  const [after] = await db
    .select({
      attempts: schema.contentDatabaseBodyHydrationQueue.attempts,
      sourceEntryJson: schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
      lastError: schema.contentDatabaseBodyHydrationQueue.lastError,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      itemError: schema.contentDatabaseItems.bodyHydrationError,
    })
    .from(schema.contentDatabaseBodyHydrationQueue)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(
        schema.contentDatabaseItems.id,
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
      ),
    )
    .where(eq(schema.contentDatabaseBodyHydrationQueue.id, queueId));

  expect(result.processed).toBe(1);
  expect(result.failed).toBe(1);
  expect(after.attempts).toBe(0);
  expect(after.lastError).toBeNull();
  expect(JSON.parse(after.sourceEntryJson).sourceValues).toMatchObject({
    [BUILDER_CMS_BODY_CONTENT_KEY]: "Superseding retry body",
  });
  expect(after.status).toBe("pending");
  expect(after.itemError).toBeNull();
});

it("re-enqueues pending Builder rows with empty document content on resync", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_pending_empty_repair";
  const databaseDocId = "doc_db_hydration_pending_empty_repair";
  const documentId = "doc_hydration_pending_empty_repair";
  const itemId = "item_hydration_pending_empty_repair";
  const sourceId = "src_hydration_pending_empty_repair";
  const sourceRowId = "entry-hydration-1";
  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "DB hydration pending empty repair",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocId,
      title: "Hydration One",
      content: "<empty-block/>",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration pending empty repair",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration-repair-pending",
    sourceTable: "collection-hydration-repair-pending",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    bodyHydrationStatus: "pending",
    bodyHydrationError: null,
    bodyHydrationVersion: "2026-01-01T00:00:00.000Z:readable-native-images-v5",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: "row_hydration_pending_empty_repair",
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId,
    sourceRowId,
    sourceQualifiedId: `builder-cms://collection-hydration-repair-pending/${sourceRowId}`,
    sourceDisplayKey: "Hydration One",
    sourceValuesJson: JSON.stringify({
      "data.title": "Hydration One",
      "data.url": "/blog/hydration-one",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      [BUILDER_CMS_BODY_CONTENT_KEY]: "Hydrated body One baseline.",
    }),
    provenance: "Builder CMS read adapter",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));

  await resync({
    database,
    source,
    now: "2026-01-01T00:20:00.000Z",
    runFullRefresh: true,
  });

  let [after] = await db
    .select({
      content: schema.documents.content,
      status: schema.contentDatabaseItems.bodyHydrationStatus,
    })
    .from(schema.documents)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(schema.contentDatabaseItems.documentId, schema.documents.id),
    )
    .where(eq(schema.documents.id, documentId));
  for (
    let attempt = 0;
    after.status !== "hydrated" ||
    after.content !== "Hydrated body One baseline.";
    attempt++
  ) {
    expect(attempt).toBeLessThan(10);
    await hydrateQueuedBodies({ sourceId, limit: 10 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    [after] = await db
      .select({
        content: schema.documents.content,
        status: schema.contentDatabaseItems.bodyHydrationStatus,
      })
      .from(schema.documents)
      .innerJoin(
        schema.contentDatabaseItems,
        eq(schema.contentDatabaseItems.documentId, schema.documents.id),
      )
      .where(eq(schema.documents.id, documentId));
  }

  expect(after.status).toBe("hydrated");
  expect(after.content).toBe("Hydrated body One baseline.");
});

it("keeps Builder outbound change sets empty while body hydration streams", async () => {
  builderReadMock.mode = "full";
  builderReadMock.calls = [];
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = "db_hydration_zero_changes";
  const databaseDocId = "doc_db_hydration_zero_changes";
  const sourceId = "src-hydration-zero-changes";
  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "DB hydration zero changes",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "DB hydration zero changes",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "collection-hydration",
    sourceTable: "collection-hydration",
    createdAt: now,
    updatedAt: now,
  });

  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));

  await resync({
    database,
    source,
    now: "2026-01-01T00:10:00.000Z",
    runFullRefresh: true,
  });

  async function expectZeroOutboundChangeSets(label: string) {
    const snapshot = await getSnapshot(database, sourceId);
    expect(
      snapshot?.changeSets.filter((changeSet: { direction: string }) => {
        return changeSet.direction === "outbound";
      }),
      label,
    ).toEqual([]);
  }

  await expectZeroOutboundChangeSets("after enqueue, before hydration");

  await hydrateQueuedBodies({
    sourceId,
    limit: 1,
  });
  await expectZeroOutboundChangeSets("immediately after first hydrated body");

  await hydrateQueuedBodies({
    sourceId,
    limit: 10,
  });
  // The resync fires an unawaited background hydration kick; drain until the
  // queue and item statuses settle so the completion assertions are
  // deterministic. Change sets must stay empty at every drain step.
  for (let attempt = 0; attempt < 20; attempt++) {
    await expectZeroOutboundChangeSets(`during drain step ${attempt}`);
    const pendingItems = await db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, databaseId),
          ne(schema.contentDatabaseItems.bodyHydrationStatus, "hydrated"),
        ),
      );
    if (pendingItems.length === 0) break;
    await hydrateQueuedBodies({ sourceId, limit: 10 });
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await expectZeroOutboundChangeSets("after hydration completes");

  const items = await db
    .select({
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      content: schema.documents.content,
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .innerJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));

  expect(items).toHaveLength(2);
  // Hydrated content is the CONVERTED readable body, not the raw source
  // value — assert completion and non-empty bodies, not raw equality.
  for (const item of items) {
    expect(item.status).toBe("hydrated");
    expect((item.content ?? "").trim().length).toBeGreaterThan(0);
  }
});
