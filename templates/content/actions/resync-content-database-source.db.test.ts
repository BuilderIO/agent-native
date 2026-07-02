// Integration test for the row-union resync over-claim fix (slice 6b). Boots a
// real in-memory libsql DB, simulates the PRE-FIX corrupted state where source
// A over-claimed every database item (including source B's row), then resyncs
// A against a mocked live Builder read and asserts the self-heal: A keeps only
// its own remote-backed rows and never re-claims B's row.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
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
            sourceValues: { "data.title": "A One" },
          },
          {
            id: "entry-a2",
            model: "collection-a",
            title: "A Two",
            urlPath: "/a-two",
            updatedAt: "2026-01-01T00:00:00.000Z",
            sourceValues: { "data.title": "A Two" },
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
