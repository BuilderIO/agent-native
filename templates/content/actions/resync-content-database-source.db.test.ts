// Integration test for the row-union resync over-claim fix (slice 6b). Boots a
// real in-memory libsql DB, simulates the PRE-FIX corrupted state where source
// A over-claimed every database item (including source B's row), then resyncs
// A against a mocked live Builder read and asserts the self-heal: A keeps only
// its own remote-backed rows and never re-claims B's row.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const builderReadMock = vi.hoisted(() => ({
  mode: "full" as "full" | "paged",
  calls: [] as Array<{ model: string; maxPages?: number; offset?: number }>,
}));

// Mock the Builder read client so resync runs "live" with deterministic entries
// (no network). Real exports are preserved; only the two reads are overridden.
vi.mock("./_builder-cms-read-client.js", async () => {
  const actual = await vi.importActual<
    typeof import("./_builder-cms-read-client.js")
  >("./_builder-cms-read-client.js");
  return {
    ...actual,
    readBuilderCmsModelFields: vi.fn(async () => []),
    readBuilderCmsContentEntries: vi.fn(
      async ({
        model,
        maxPages,
        offset,
      }: {
        model: string;
        maxPages?: number;
        offset?: number;
      }) => {
        builderReadMock.calls.push({ model, maxPages, offset });
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
let getSnapshot: typeof import("./_database-source-utils.js").getContentDatabaseSourceSnapshotById;
let hydrateQueuedBodies: typeof import("./_database-source-utils.js").processBuilderBodyHydrationQueue;

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
  getSnapshot = (await import("./_database-source-utils.js"))
    .getContentDatabaseSourceSnapshotById;
  hydrateQueuedBodies = (await import("./_database-source-utils.js"))
    .processBuilderBodyHydrationQueue;
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
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
    skipTitleDedup: true,
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
  expect(builderReadMock.calls).toEqual([
    { model: "collection-a", maxPages: undefined, offset: 0 },
  ]);
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
