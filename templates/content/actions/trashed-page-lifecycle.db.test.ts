import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  countOutcome: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/core/collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/collab")>()),
  agentTouchDocument: vi.fn(),
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-trashed-page-lifecycle-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "trashed-page-owner@example.com";
const SPACE_ID = "trashed-page-space";
const STAMP = "2026-01-01T00:00:00.000Z";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;
let deleteDocument: typeof import("./delete-document.js").default;
let restoreDocument: typeof import("./restore-document.js").default;
let removeDatabaseItems: typeof import("./remove-database-items.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let editDocument: typeof import("./edit-document.js").default;

const asOwner = async <T>(run: () => T | Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
  deleteDocument = (await import("./delete-document.js")).default;
  restoreDocument = (await import("./restore-document.js")).default;
  removeDatabaseItems = (await import("./remove-database-items.js")).default;
  getContentDatabase = (await import("./get-content-database.js")).default;
  editDocument = (await import("./edit-document.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  await getDb()
    .insert(schema.contentSpaces)
    .values({
      id: SPACE_ID,
      name: "Trashed page space",
      kind: "personal",
      ownerEmail: OWNER,
      orgId: null,
      filesDatabaseId: `${SPACE_ID}-files`,
      createdBy: OWNER,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function pageValues(
  id: string,
  parentId: string | null,
  extra: Partial<typeof schema.documents.$inferInsert> = {},
): typeof schema.documents.$inferInsert {
  return {
    id,
    ownerEmail: OWNER,
    spaceId: SPACE_ID,
    parentId,
    title: id,
    content: "",
    visibility: "private",
    createdBy: OWNER,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

async function readPage(id: string) {
  const [page] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return page;
}

describe("restore", () => {
  it("brings a collection row back to its place after the collection is renumbered", async () => {
    const collectionPage = "order-collection-page";
    const collection = "order-collection";
    const rows = ["a", "b", "t", "c", "d"];
    await getDb()
      .insert(schema.documents)
      .values([
        pageValues(collectionPage, null),
        ...rows.map((row, position) =>
          pageValues(`order-row-${row}`, collectionPage, { position }),
        ),
      ]);
    await getDb().insert(schema.contentDatabases).values({
      id: collection,
      ownerEmail: OWNER,
      spaceId: SPACE_ID,
      documentId: collectionPage,
      title: "Ordered collection",
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    // Equal createdAt, so a tie in position falls to the item id, and the
    // trashed row's item id sorts after its later siblings'.
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values(
        rows.map((row, position) => ({
          id: `order-item-${row}`,
          ownerEmail: OWNER,
          databaseId: collection,
          documentId: `order-row-${row}`,
          position,
          createdAt: STAMP,
          updatedAt: STAMP,
        })),
      );

    await asOwner(() => deleteDocument.run({ id: "order-row-t" }));
    await asOwner(() =>
      removeDatabaseItems.run({
        databaseId: collection,
        itemIds: ["order-item-a"],
      }),
    );
    await asOwner(() => restoreDocument.run({ id: "order-row-t" }));

    const read = await asOwner(() =>
      getContentDatabase.run({ databaseId: collection }),
    );
    if (!("items" in read)) throw new Error("The collection is unavailable.");
    const order = ["order-row-b", "order-row-t", "order-row-c", "order-row-d"];
    expect(read.items.map((item) => item.document.id)).toEqual(order);
    const pages = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(inArray(schema.documents.id, order))
      .orderBy(asc(schema.documents.position), asc(schema.documents.id));
    expect(pages.map((page) => page.id)).toEqual(order);
  });
});

describe("edit-document", () => {
  async function trashedPage(id: string) {
    await getDb()
      .insert(schema.documents)
      .values(pageValues(id, null, { content: "Body in Trash" }));
    await asOwner(() => deleteDocument.run({ id }));
    const page = await readPage(id);
    expect(page?.trashedAt).toBeTruthy();
    return page!;
  }

  it("refuses a revisioned edit to a page in Trash, as get-document refuses to read it", async () => {
    const before = await trashedPage("edit-trashed-guarded");
    await expect(
      asOwner(() =>
        editDocument.run(
          {
            id: before.id,
            baseRevision: documentRevisionToken(
              before.bodyRevision,
              before.content,
            ),
            idempotencyKey: "edit-trashed-guarded",
            find: "Body in Trash",
            replace: "Edited in Trash",
          },
          { caller: "mcp", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
    expect(await readPage(before.id)).toMatchObject({
      content: before.content,
      bodyRevision: before.bodyRevision,
      updatedAt: before.updatedAt,
    });
  });

  it("refuses an unrevisioned edit to a page in Trash", async () => {
    const before = await trashedPage("edit-trashed-legacy");
    await expect(
      asOwner(() =>
        editDocument.run({
          id: before.id,
          find: "Body in Trash",
          replace: "Edited in Trash",
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
    expect(await readPage(before.id)).toMatchObject({
      content: before.content,
      bodyRevision: before.bodyRevision,
      updatedAt: before.updatedAt,
    });
  });
});
