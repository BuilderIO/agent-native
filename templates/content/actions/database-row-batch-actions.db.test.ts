import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `database-row-batch-actions-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let duplicateDatabaseItemsAction: typeof import("./duplicate-database-items.js").default;
let deleteDatabaseItemsAction: typeof import("./delete-database-items.js").default;

const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  duplicateDatabaseItemsAction = (await import("./duplicate-database-items.js"))
    .default;
  deleteDatabaseItemsAction = (await import("./delete-database-items.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let counter = 0;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createDocument(args: {
  id?: string;
  parentId?: string | null;
  title?: string;
  content?: string;
  position?: number;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
    parentId: args.parentId ?? null,
    title: args.title ?? "Untitled",
    content: args.content ?? "",
    position: args.position ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createDatabaseWithRows(rowCount: number) {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = nextId("db");
  const databaseDocumentId = await createDocument({
    id: nextId("dbdoc"),
    title: "Database",
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: "Database",
    createdAt: now,
    updatedAt: now,
  });

  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const documentId = await createDocument({
      id: nextId("rowdoc"),
      parentId: databaseDocumentId,
      title: `Row ${index}`,
      content: `Content ${index}`,
      position: index,
    });
    const itemId = nextId("item");
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId,
      documentId,
      position: index,
      createdAt: now,
      updatedAt: now,
    });
    rows.push({ itemId, documentId });
  }

  return { databaseId, databaseDocumentId, rows };
}

async function orderedRows(databaseId: string) {
  const db = getDb();
  return db
    .select({
      itemId: schema.contentDatabaseItems.id,
      documentId: schema.documents.id,
      title: schema.documents.title,
      content: schema.documents.content,
      itemPosition: schema.contentDatabaseItems.position,
      documentPosition: schema.documents.position,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
    .orderBy(asc(schema.contentDatabaseItems.position));
}

describe("database row batch actions", () => {
  it("duplicates selected rows as one ordered block with copied values and inherited shares", async () => {
    const db = getDb();
    const { databaseId, databaseDocumentId, rows } =
      await createDatabaseWithRows(4);
    const now = new Date().toISOString();
    const propertyId = nextId("property");
    await db.insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Status",
      type: "text",
      visibility: "always_show",
      optionsJson: "{}",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.documentPropertyValues).values([
      {
        id: nextId("value"),
        ownerEmail: OWNER,
        documentId: rows[1].documentId,
        propertyId,
        valueJson: JSON.stringify("Review"),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nextId("value"),
        ownerEmail: OWNER,
        documentId: rows[2].documentId,
        propertyId,
        valueJson: JSON.stringify("Ready"),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: databaseDocumentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      duplicateDatabaseItemsAction.run({
        databaseId,
        itemIds: [rows[2].itemId, rows[1].itemId],
      }),
    );

    expect(result.duplicatedItemIds).toHaveLength(2);
    expect(result.duplicatedDocumentIds).toHaveLength(2);
    expect(result.duplicatedItemId).toBe(result.duplicatedItemIds?.[0]);
    expect(result.duplicatedDocumentId).toBe(result.duplicatedDocumentIds?.[0]);
    expect(result.sourceItemIds).toEqual([rows[1].itemId, rows[2].itemId]);
    expect(result.sourceDocumentIds).toEqual([
      rows[1].documentId,
      rows[2].documentId,
    ]);
    const allRows = await orderedRows(databaseId);
    expect(allRows.map((row) => row.title)).toEqual([
      "Row 0",
      "Row 1",
      "Row 2",
      "Copy of Row 1",
      "Copy of Row 2",
      "Row 3",
    ]);
    expect(allRows.map((row) => row.itemPosition)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(allRows.map((row) => row.documentPosition)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);

    const copiedValues = await db
      .select({
        documentId: schema.documentPropertyValues.documentId,
        valueJson: schema.documentPropertyValues.valueJson,
      })
      .from(schema.documentPropertyValues)
      .where(
        inArray(
          schema.documentPropertyValues.documentId,
          result.duplicatedDocumentIds ?? [],
        ),
      );
    const copiedValuesByDocumentId = new Map(
      copiedValues.map((value) => [
        value.documentId,
        JSON.parse(value.valueJson) as unknown,
      ]),
    );
    expect(
      (result.duplicatedDocumentIds ?? []).map((documentId) =>
        copiedValuesByDocumentId.get(documentId),
      ),
    ).toEqual(["Review", "Ready"]);

    const inheritedShares = await db
      .select()
      .from(schema.documentShares)
      .where(
        inArray(
          schema.documentShares.resourceId,
          result.duplicatedDocumentIds ?? [],
        ),
      );
    expect(inheritedShares).toHaveLength(2);
    expect(inheritedShares.map((share) => share.principalId)).toEqual([
      COLLABORATOR,
      COLLABORATOR,
    ]);
  });

  it("rejects mixed database duplicate batches before writing", async () => {
    const first = await createDatabaseWithRows(2);
    const second = await createDatabaseWithRows(1);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        duplicateDatabaseItemsAction.run({
          databaseId: first.databaseId,
          itemIds: [first.rows[0].itemId, second.rows[0].itemId],
        }),
      ),
    ).rejects.toThrow("All requested rows must exist in the target database");

    expect(await orderedRows(first.databaseId)).toHaveLength(2);
    expect(await orderedRows(second.databaseId)).toHaveLength(1);
  });

  it("deletes selected rows recursively in one batch and renumbers survivors", async () => {
    const db = getDb();
    const { databaseId, databaseDocumentId, rows } =
      await createDatabaseWithRows(4);
    const childDocumentId = await createDocument({
      parentId: rows[1].documentId,
      title: "Child",
    });
    const now = new Date().toISOString();
    const propertyId = nextId("property");
    await db.insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Notes",
      type: "text",
      visibility: "always_show",
      optionsJson: "{}",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.documentPropertyValues).values({
      id: nextId("value"),
      ownerEmail: OWNER,
      documentId: rows[1].documentId,
      propertyId,
      valueJson: JSON.stringify("Delete me"),
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDatabaseItemsAction.run({
        documentId: databaseDocumentId,
        itemIds: [rows[1].itemId, rows[2].itemId],
      }),
    );

    expect(result.deletedItemIds).toEqual([rows[1].itemId, rows[2].itemId]);
    expect(result.deletedDocumentIds).toEqual([
      rows[1].documentId,
      rows[2].documentId,
    ]);
    expect(result.deletedCount).toBe(2);
    const remainingRows = await orderedRows(databaseId);
    expect(remainingRows.map((row) => row.title)).toEqual(["Row 0", "Row 3"]);
    expect(remainingRows.map((row) => row.itemPosition)).toEqual([0, 1]);

    const deletedDocs = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        inArray(schema.documents.id, [
          rows[1].documentId,
          rows[2].documentId,
          childDocumentId,
        ]),
      );
    expect(deletedDocs).toEqual([]);
    const deletedValues = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, rows[1].documentId));
    expect(deletedValues).toEqual([]);
  });

  it("rejects unauthorized delete batches before writing", async () => {
    const { databaseId, databaseDocumentId, rows } =
      await createDatabaseWithRows(2);
    const db = getDb();
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: databaseDocumentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        deleteDatabaseItemsAction.run({
          databaseId,
          itemIds: [rows[0].itemId, rows[1].itemId],
        }),
      ),
    ).rejects.toThrow(`No access to document ${rows[0].documentId}`);

    expect(await orderedRows(databaseId)).toHaveLength(2);
  });

  it("rejects oversized batches before mutation", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(1);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        duplicateDatabaseItemsAction.run({
          databaseId,
          itemIds: Array.from({ length: 101 }, (_, index) =>
            index === 0 ? rows[0].itemId : nextId("missing_item"),
          ),
        }),
      ),
    ).rejects.toThrow("Database row batch is limited to 100 rows.");

    expect(await orderedRows(databaseId)).toHaveLength(1);
  });
});
