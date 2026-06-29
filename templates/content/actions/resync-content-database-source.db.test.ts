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
      async ({ model }: { model: string }) => ({
        state: model === "collection-a" ? "live" : "unconfigured",
        entries:
          model === "collection-a"
            ? [
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
              ]
            : [],
        fetchedAt: "2026-01-01T00:00:00.000Z",
        message: null,
      }),
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
