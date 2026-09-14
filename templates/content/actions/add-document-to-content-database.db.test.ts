import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `add-document-to-content-database-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let addDocumentToContentDatabase: typeof import("./add-document-to-content-database.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  addDocumentToContentDatabase = (
    await import("./add-document-to-content-database.js")
  ).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}`;
}

async function createSpace(label: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const spaceId = nextId(`${label}_space`);
  const filesDatabaseId = nextId(`${label}_files_database`);
  const filesDocumentId = nextId(`${label}_files_document`);
  await db.insert(schema.documents).values({
    id: filesDocumentId,
    spaceId,
    ownerEmail: OWNER,
    parentId: null,
    title: `${label} files`,
    content: "",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: filesDatabaseId,
    spaceId,
    ownerEmail: OWNER,
    documentId: filesDocumentId,
    title: `${label} files`,
    systemRole: "files",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentSpaces).values({
    id: spaceId,
    name: `${label} space`,
    kind: "personal",
    ownerEmail: OWNER,
    filesDatabaseId,
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  return { spaceId, filesDatabaseId, filesDocumentId };
}

async function createCollection(label: string, spaceId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = nextId(`${label}_database`);
  const databaseDocumentId = nextId(`${label}_database_document`);
  await db.insert(schema.documents).values({
    id: databaseDocumentId,
    spaceId,
    ownerEmail: OWNER,
    parentId: null,
    title: `${label} collection`,
    content: "",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    spaceId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: `${label} collection`,
    createdAt: now,
    updatedAt: now,
  });
  return { databaseId, databaseDocumentId };
}

async function createPage(label: string, spaceId: string, parentId?: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const documentId = nextId(`${label}_page`);
  await db.insert(schema.documents).values({
    id: documentId,
    spaceId,
    ownerEmail: OWNER,
    parentId: parentId ?? null,
    title: `${label} page`,
    content: "# Already written",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  return documentId;
}

function asOwner<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

async function membership(databaseId: string, documentId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, databaseId),
        eq(schema.contentDatabaseItems.documentId, documentId),
      ),
    );
  return row;
}

async function parentOf(documentId: string) {
  const [row] = await getDb()
    .select({ parentId: schema.documents.parentId })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return row?.parentId ?? null;
}

describe("add-document-to-content-database", () => {
  it("makes an existing page a durable row of the collection", async () => {
    const space = await createSpace("adopt");
    const collection = await createCollection("adopt", space.spaceId);
    const documentId = await createPage("adopt", space.spaceId);

    const result = await asOwner(() =>
      addDocumentToContentDatabase.run(
        { databaseId: collection.databaseId, documentId },
        {} as any,
      ),
    );

    // Assert on the data model, not the response text: both halves of
    // membership must be persisted, or the page is not really in the
    // collection.
    const item = await membership(collection.databaseId, documentId);
    expect(item).toBeTruthy();
    expect(await parentOf(documentId)).toBe(collection.databaseDocumentId);
    expect(result.receipt.alreadyMember).toBe(false);
    expect(result.receipt.itemId).toBe(item.id);
    expect(
      result.items.some((row: any) => row.document.id === documentId),
    ).toBe(true);
  });

  it("resolves the collection by its backing document id", async () => {
    const space = await createSpace("bydoc");
    const collection = await createCollection("bydoc", space.spaceId);
    const documentId = await createPage("bydoc", space.spaceId);

    await asOwner(() =>
      addDocumentToContentDatabase.run(
        { databaseDocumentId: collection.databaseDocumentId, documentId },
        {} as any,
      ),
    );

    expect(await membership(collection.databaseId, documentId)).toBeTruthy();
    expect(await parentOf(documentId)).toBe(collection.databaseDocumentId);
  });

  it("is idempotent for a page that is already a row", async () => {
    const space = await createSpace("idem");
    const collection = await createCollection("idem", space.spaceId);
    const documentId = await createPage("idem", space.spaceId);

    const first = await asOwner(() =>
      addDocumentToContentDatabase.run(
        { databaseId: collection.databaseId, documentId },
        {} as any,
      ),
    );
    const second = await asOwner(() =>
      addDocumentToContentDatabase.run(
        { databaseId: collection.databaseId, documentId },
        {} as any,
      ),
    );

    expect(second.receipt.alreadyMember).toBe(true);
    expect(second.receipt.itemId).toBe(first.receipt.itemId);
    const rows = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, collection.databaseId),
          eq(schema.contentDatabaseItems.documentId, documentId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("repairs a page that was reparented under the collection without membership", async () => {
    const space = await createSpace("halfway");
    const collection = await createCollection("halfway", space.spaceId);
    // Exactly the half-associated state a bare reparent produces.
    const documentId = await createPage(
      "halfway",
      space.spaceId,
      collection.databaseDocumentId,
    );
    expect(await membership(collection.databaseId, documentId)).toBeUndefined();

    await asOwner(() =>
      addDocumentToContentDatabase.run(
        { databaseId: collection.databaseId, documentId },
        {} as any,
      ),
    );

    expect(await membership(collection.databaseId, documentId)).toBeTruthy();
  });

  it("refuses a page from a different Content space", async () => {
    const spaceA = await createSpace("crossa");
    const spaceB = await createSpace("crossb");
    const collection = await createCollection("crossa", spaceA.spaceId);
    const documentId = await createPage("crossb", spaceB.spaceId);

    await expect(
      asOwner(() =>
        addDocumentToContentDatabase.run(
          { databaseId: collection.databaseId, documentId },
          {} as any,
        ),
      ),
    ).rejects.toThrow(/same Content space/);
    expect(await membership(collection.databaseId, documentId)).toBeUndefined();
  });

  it("refuses to adopt a collection's own backing page", async () => {
    const space = await createSpace("self");
    const collection = await createCollection("self", space.spaceId);

    await expect(
      asOwner(() =>
        addDocumentToContentDatabase.run(
          {
            databaseId: collection.databaseId,
            documentId: collection.databaseDocumentId,
          },
          {} as any,
        ),
      ),
    ).rejects.toThrow(/own page/);
  });

  it("refuses to adopt another collection's backing page", async () => {
    const space = await createSpace("nested");
    const target = await createCollection("nestedtarget", space.spaceId);
    const other = await createCollection("nestedother", space.spaceId);

    await expect(
      asOwner(() =>
        addDocumentToContentDatabase.run(
          {
            databaseId: target.databaseId,
            documentId: other.databaseDocumentId,
          },
          {} as any,
        ),
      ),
    ).rejects.toThrow(/collection page cannot become a row/);
  });

  it("refuses system collections", async () => {
    const space = await createSpace("system");
    const documentId = await createPage("system", space.spaceId);

    await expect(
      asOwner(() =>
        addDocumentToContentDatabase.run(
          { databaseId: space.filesDatabaseId, documentId },
          {} as any,
        ),
      ),
    ).rejects.toThrow(/System collections/);
  });

  it("refuses a page that is an ancestor of the collection", async () => {
    const space = await createSpace("ancestor");
    const parentPage = await createPage("ancestor", space.spaceId);
    const db = getDb();
    const collection = await createCollection("ancestor", space.spaceId);
    await db
      .update(schema.documents)
      .set({ parentId: parentPage })
      .where(eq(schema.documents.id, collection.databaseDocumentId));

    await expect(
      asOwner(() =>
        addDocumentToContentDatabase.run(
          { databaseId: collection.databaseId, documentId: parentPage },
          {} as any,
        ),
      ),
    ).rejects.toThrow(/nested inside itself/);
  });

  it("refuses source-backed collections", async () => {
    const space = await createSpace("sourced");
    const collection = await createCollection("sourced", space.spaceId);
    const documentId = await createPage("sourced", space.spaceId);
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabaseSources)
      .values({
        id: nextId("source"),
        ownerEmail: OWNER,
        databaseId: collection.databaseId,
        sourceType: "notion",
        sourceName: "Notion",
        sourceTable: "pages",
        createdAt: now,
        updatedAt: now,
      });

    await expect(
      asOwner(() =>
        addDocumentToContentDatabase.run(
          { databaseId: collection.databaseId, documentId },
          {} as any,
        ),
      ),
    ).rejects.toThrow(/Source-backed collections/);
    expect(await membership(collection.databaseId, documentId)).toBeUndefined();
  });
});
