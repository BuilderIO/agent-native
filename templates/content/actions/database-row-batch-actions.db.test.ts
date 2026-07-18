import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `database-row-batch-actions-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let duplicateDatabaseItemsAction: typeof import("./duplicate-database-items.js").default;
let duplicateDatabaseItemAction: typeof import("./duplicate-database-item.js").default;
let deleteDatabaseItemsAction: typeof import("./delete-database-items.js").default;
let moveDatabaseItemAction: typeof import("./move-database-item.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;
let spaceId: string;

const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  duplicateDatabaseItemsAction = (await import("./duplicate-database-items.js"))
    .default;
  duplicateDatabaseItemAction = (await import("./duplicate-database-item.js"))
    .default;
  deleteDatabaseItemsAction = (await import("./delete-database-items.js"))
    .default;
  moveDatabaseItemAction = (await import("./move-database-item.js")).default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  const { systemIdsForContentSpace } = await import("./_content-spaces.js");
  spaceId = `batch_space_${Date.now()}`;
  const filesIds = systemIdsForContentSpace(spaceId, "files");
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: filesIds.documentId,
    spaceId,
    ownerEmail: OWNER,
    title: "Files",
    content: "",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabases).values({
    id: filesIds.databaseId,
    spaceId,
    systemRole: "files",
    ownerEmail: OWNER,
    documentId: filesIds.documentId,
    title: "Files",
    createdAt: now,
    updatedAt: now,
  });
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
    spaceId,
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
    spaceId,
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

async function workflowEventsForSubjects(topic: string, subjectIds: string[]) {
  const rows = await getDb()
    .select()
    .from(schema.workflowEvents)
    .where(
      and(
        eq(schema.workflowEvents.topic, topic),
        inArray(schema.workflowEvents.subjectId, subjectIds),
      ),
    );
  return rows
    .map((row: any) => ({
      ...row,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      actorContext: JSON.parse(row.actorContext) as Record<string, unknown>,
    }))
    .sort(
      (left, right) =>
        Number(left.payload.position ?? left.payload.previousPosition ?? 0) -
        Number(right.payload.position ?? right.payload.previousPosition ?? 0),
    );
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
    await expect(
      db
        .select({ spaceId: schema.documents.spaceId })
        .from(schema.documents)
        .where(
          inArray(schema.documents.id, result.duplicatedDocumentIds ?? []),
        ),
    ).resolves.toEqual([{ spaceId }, { spaceId }]);
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
    const events = await workflowEventsForSubjects(
      "content.database.item.created",
      result.duplicatedDocumentIds ?? [],
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.payload)).toEqual(
      result.sourceToDuplicate?.map((duplicate, index) =>
        expect.objectContaining({
          databaseId,
          documentId: duplicate.duplicatedDocumentId,
          itemId: duplicate.duplicatedItemId,
          sourceItemId: duplicate.sourceItemId,
          sourceDocumentId: duplicate.sourceDocumentId,
          position: 3 + index,
        }),
      ),
    );
    expect(events.every((event) => !("content" in event.payload))).toBe(true);
  });

  it("rejects mixed database duplicate batches before writing", async () => {
    const first = await createDatabaseWithRows(2);
    const second = await createDatabaseWithRows(1);
    const eventCountBefore = (
      await getDb().select().from(schema.workflowEvents)
    ).length;

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
    expect((await getDb().select().from(schema.workflowEvents)).length).toBe(
      eventCountBefore,
    );
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

    const events = await workflowEventsForSubjects(
      "content.database.item.deleted",
      result.deletedDocumentIds,
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        databaseId,
        documentId: rows[1].documentId,
        itemId: rows[1].itemId,
        previousPosition: 1,
      }),
      expect.objectContaining({
        databaseId,
        documentId: rows[2].documentId,
        itemId: rows[2].itemId,
        previousPosition: 2,
      }),
    ]);

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

  it("emits one bounded create event for a single duplicate and one move event only for a real move", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(2);
    const duplicated = await runWithRequestContext(
      {
        userEmail: OWNER,
        run: { owner: OWNER, threadId: "mutation-thread", model: "test-model" },
      },
      () => duplicateDatabaseItemAction.run({ itemId: rows[0].itemId }),
    );
    const createdEvents = await workflowEventsForSubjects(
      "content.database.item.created",
      [duplicated.duplicatedDocumentId],
    );
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toMatchObject({
      payload: {
        databaseId,
        documentId: duplicated.duplicatedDocumentId,
        itemId: duplicated.duplicatedItemId,
        sourceItemId: rows[0].itemId,
        sourceDocumentId: rows[0].documentId,
        position: 1,
      },
      actorContext: {
        executor: { kind: "agent", id: "mutation-thread", model: "test-model" },
      },
    });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      moveDatabaseItemAction.run({ itemId: rows[1].itemId, position: 0 }),
    );
    let movedEvents = await workflowEventsForSubjects(
      "content.database.item.moved",
      [rows[1].documentId],
    );
    expect(movedEvents).toHaveLength(1);
    expect(movedEvents[0].payload).toMatchObject({
      databaseId,
      documentId: rows[1].documentId,
      itemId: rows[1].itemId,
      beforePosition: 2,
      afterPosition: 0,
    });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      moveDatabaseItemAction.run({ itemId: rows[1].itemId, position: 0 }),
    );
    movedEvents = await workflowEventsForSubjects(
      "content.database.item.moved",
      [rows[1].documentId],
    );
    expect(movedEvents).toHaveLength(1);
  });

  it("rejects unauthorized delete batches before writing", async () => {
    const { databaseId, databaseDocumentId, rows } =
      await createDatabaseWithRows(2);
    const eventCountBefore = (
      await getDb().select().from(schema.workflowEvents)
    ).length;
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
    expect((await getDb().select().from(schema.workflowEvents)).length).toBe(
      eventCountBefore,
    );
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

  it("assigns distinct positions when items are added to the same database concurrently", async () => {
    const { databaseId, databaseDocumentId } = await createDatabaseWithRows(0);

    const concurrentAdds = 6;
    const results = await Promise.all(
      Array.from({ length: concurrentAdds }, (_, index) =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          addDatabaseItemAction.run({
            databaseId,
            title: `Concurrent ${index}`,
          }),
        ),
      ),
    );

    expect(results).toHaveLength(concurrentAdds);
    const createdItemIds = results.map((result) => result.createdItemId);
    expect(new Set(createdItemIds).size).toBe(concurrentAdds);

    const rows = await orderedRows(databaseId);
    expect(rows).toHaveLength(concurrentAdds);
    // Every row's database-item position and backing document position must
    // be unique — two concurrent adds reading the same MAX(position) would
    // otherwise collide on the same value.
    expect(new Set(rows.map((row) => row.itemPosition)).size).toBe(
      concurrentAdds,
    );
    expect(new Set(rows.map((row) => row.documentPosition)).size).toBe(
      concurrentAdds,
    );
    expect(rows.map((row) => row.itemPosition).sort((a, b) => a - b)).toEqual(
      Array.from({ length: concurrentAdds }, (_, index) => index),
    );

    const siblingDocPositions = await getDb()
      .select({ position: schema.documents.position })
      .from(schema.documents)
      .where(eq(schema.documents.parentId, databaseDocumentId));
    expect(
      siblingDocPositions
        .map((row: { position: number }) => row.position)
        .sort((a: number, b: number) => a - b),
    ).toEqual(Array.from({ length: concurrentAdds }, (_, index) => index));
  });
});
