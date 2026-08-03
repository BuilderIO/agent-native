import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ContentDatabaseItem } from "../shared/api.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `database-row-batch-actions-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let duplicateDatabaseItemsAction: typeof import("./duplicate-database-items.js").default;
let duplicateDatabaseItemAction: typeof import("./duplicate-database-item.js").default;
let duplicateDocumentPropertyAction: typeof import("./duplicate-document-property.js").default;
let removeDatabaseItemsAction: typeof import("./remove-database-items.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;
let lockDatabaseMemberships: typeof import("./_database-membership-lock.js").lockDatabaseMemberships;
let replaceMockSourceRows: typeof import("./_database-source-utils.js").replaceMockSourceRows;
let setDocumentPropertyAction: typeof import("./set-document-property.js").default;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;
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
  duplicateDocumentPropertyAction = (
    await import("./duplicate-document-property.js")
  ).default;
  removeDatabaseItemsAction = (await import("./remove-database-items.js"))
    .default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  ({ lockDatabaseMemberships } =
    await import("./_database-membership-lock.js"));
  ({ replaceMockSourceRows } = await import("./_database-source-utils.js"));
  setDocumentPropertyAction = (await import("./set-document-property.js"))
    .default;
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
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
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, databaseId),
        isNull(schema.documents.trashedAt),
      ),
    )
    .orderBy(asc(schema.contentDatabaseItems.position));
}

describe("database row batch actions", () => {
  it("reports truthful page-view capability for database rows", async () => {
    const { databaseId, databaseDocumentId, rows } =
      await createDatabaseWithRows(6);
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documentShares)
      .values([
        {
          id: nextId("share"),
          resourceId: databaseDocumentId,
          principalType: "user",
          principalId: COLLABORATOR,
          role: "admin",
          createdBy: OWNER,
          createdAt: now,
        },
        ...(["viewer", "editor", "admin"] as const).map((role, index) => ({
          id: nextId("share"),
          resourceId: rows[index + 1].documentId,
          principalType: "user" as const,
          principalId: COLLABORATOR,
          role,
          createdBy: OWNER,
          createdAt: now,
        })),
      ]);
    await getDb()
      .update(schema.documents)
      .set({ visibility: "public" })
      .where(eq(schema.documents.id, rows[4].documentId));
    await getDb()
      .update(schema.documents)
      .set({ visibility: "org", orgId: "org-1" })
      .where(eq(schema.documents.id, rows[5].documentId));

    const collaboratorResult = await runWithRequestContext(
      { userEmail: COLLABORATOR, orgId: "org-1" },
      () => getContentDatabaseAction.run({ databaseId }),
    );
    if (!("items" in collaboratorResult)) {
      throw new Error("Expected a database response");
    }
    expect(
      collaboratorResult.items.map((item) => ({
        id: item.document.id,
        role: item.document.accessRole,
        canView: item.document.canView,
      })),
    ).toEqual([
      { id: rows[0].documentId, role: undefined, canView: false },
      { id: rows[1].documentId, role: "viewer", canView: true },
      { id: rows[2].documentId, role: "editor", canView: true },
      { id: rows[3].documentId, role: "admin", canView: true },
      { id: rows[4].documentId, role: "viewer", canView: true },
      { id: rows[5].documentId, role: "viewer", canView: true },
    ]);

    const ownerResult = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabaseAction.run({ databaseId }),
    );
    if (!("items" in ownerResult)) throw new Error("Expected owner rows");
    expect(
      ownerResult.items.every(
        (item) =>
          item.document.accessRole === "owner" &&
          item.document.canView === true,
      ),
    ).toBe(true);
  });

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
    expect(result.duplicatedItems?.map((item) => item.id)).toEqual(
      result.duplicatedItemIds,
    );
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

  it("returns exact duplicate projections when stored positions are sparse", async () => {
    const db = getDb();
    const { databaseId, rows } = await createDatabaseWithRows(3);
    await Promise.all(
      rows.map((row, index) =>
        db
          .update(schema.contentDatabaseItems)
          .set({ position: [10, 30, 50][index] })
          .where(eq(schema.contentDatabaseItems.id, row.itemId)),
      ),
    );
    await Promise.all(
      rows.map((row, index) =>
        db
          .update(schema.documents)
          .set({ position: [10, 30, 50][index] })
          .where(eq(schema.documents.id, row.documentId)),
      ),
    );

    const single = await runWithRequestContext({ userEmail: OWNER }, () =>
      duplicateDatabaseItemAction.run({ itemId: rows[0].itemId }),
    );
    expect(single.duplicatedItems).toHaveLength(1);
    expect(single.duplicatedItems?.[0]).toMatchObject({
      id: single.duplicatedItemId,
      document: { id: single.duplicatedDocumentId },
    });

    const batch = await runWithRequestContext({ userEmail: OWNER }, () =>
      duplicateDatabaseItemsAction.run({
        databaseId,
        itemIds: [rows[1].itemId, rows[2].itemId],
      }),
    );
    expect(batch.duplicatedItems?.map((item) => item.id)).toEqual(
      batch.duplicatedItemIds,
    );
    expect(batch.duplicatedItems?.map((item) => item.document.id)).toEqual(
      batch.duplicatedDocumentIds,
    );
  });

  it("removes memberships and database-local values while preserving pages", async () => {
    const db = getDb();
    const { databaseId, databaseDocumentId, rows } =
      await createDatabaseWithRows(4);
    const childDocumentId = await createDocument({
      parentId: rows[1].documentId,
      title: "Child",
    });
    const now = new Date().toISOString();
    const propertyId = nextId("property");
    const blocksPropertyId = nextId("blocks_property");
    await db.insert(schema.documentPropertyDefinitions).values([
      {
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
      },
      {
        id: blocksPropertyId,
        ownerEmail: OWNER,
        databaseId,
        name: "Research",
        type: "blocks",
        visibility: "always_show",
        optionsJson: JSON.stringify({ blocksStorage: "field" }),
        position: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const other = await createDatabaseWithRows(0);
    const otherItemId = nextId("other_item");
    const otherPropertyId = nextId("other_property");
    await db.insert(schema.contentDatabaseItems).values({
      id: otherItemId,
      ownerEmail: OWNER,
      databaseId: other.databaseId,
      documentId: rows[1].documentId,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.documentPropertyDefinitions).values({
      id: otherPropertyId,
      ownerEmail: OWNER,
      databaseId: other.databaseId,
      name: "Other notes",
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
        valueJson: JSON.stringify("Remove me"),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nextId("value"),
        ownerEmail: OWNER,
        documentId: rows[1].documentId,
        propertyId: otherPropertyId,
        valueJson: JSON.stringify("Preserve me"),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.documentBlockFieldContents).values({
      id: nextId("blocks_value"),
      ownerEmail: OWNER,
      documentId: rows[1].documentId,
      propertyId: blocksPropertyId,
      content: "Remove this database-local Blocks value",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      removeDatabaseItemsAction.run({
        documentId: databaseDocumentId,
        itemIds: [rows[1].itemId, rows[2].itemId],
      }),
    );

    expect(result.removedItemIds).toEqual([rows[1].itemId, rows[2].itemId]);
    expect(result.removedDocumentIds).toEqual([
      rows[1].documentId,
      rows[2].documentId,
    ]);
    expect(result.removedCount).toBe(2);
    const remainingRows = await orderedRows(databaseId);
    expect(remainingRows.map((row) => row.title)).toEqual(["Row 0", "Row 3"]);
    expect(remainingRows.map((row) => row.itemPosition)).toEqual([0, 1]);

    const preservedDocs = await db
      .select({
        id: schema.documents.id,
        trashedAt: schema.documents.trashedAt,
        content: schema.documents.content,
      })
      .from(schema.documents)
      .where(
        inArray(schema.documents.id, [
          rows[1].documentId,
          rows[2].documentId,
          childDocumentId,
        ]),
      );
    expect(preservedDocs).toHaveLength(3);
    expect(preservedDocs.every((document) => document.trashedAt === null)).toBe(
      true,
    );
    expect(
      preservedDocs.find((document) => document.id === rows[1].documentId)
        ?.content,
    ).toBe("Content 1");
    expect(await orderedRows(other.databaseId)).toEqual([
      expect.objectContaining({
        itemId: otherItemId,
        documentId: rows[1].documentId,
      }),
    ]);
    const preservedValues = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, rows[1].documentId));
    expect(preservedValues).toEqual([
      expect.objectContaining({ propertyId: otherPropertyId }),
    ]);
    await expect(
      db
        .select()
        .from(schema.documentBlockFieldContents)
        .where(
          eq(schema.documentBlockFieldContents.documentId, rows[1].documentId),
        ),
    ).resolves.toEqual([]);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        removeDatabaseItemsAction.run({
          databaseId,
          documentIds: [rows[1].documentId, rows[2].documentId],
        }),
      ),
    ).rejects.toThrow("All requested rows must exist in the target database");
    expect(await orderedRows(databaseId)).toHaveLength(2);
  });

  it("rejects removal from system databases whose memberships are canonical", async () => {
    const [filesDatabase] = await getDb()
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.systemRole, "files"));
    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      addDatabaseItemAction.run({
        databaseId: filesDatabase.id,
        title: "Canonical file",
      }),
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        removeDatabaseItemsAction.run({
          databaseId: filesDatabase.id,
          itemIds: [created.createdItemId],
        }),
      ),
    ).rejects.toThrow(
      "System database memberships cannot be removed from this surface.",
    );
    expect(await orderedRows(filesDatabase.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: created.createdItemId }),
      ]),
    );
  });

  it("keeps Favorites membership removal while preserving the Page and Files membership", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const [filesDatabase] = await db
      .select({
        id: schema.contentDatabases.id,
        documentId: schema.contentDatabases.documentId,
      })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.systemRole, "files"));
    const favoritesDocumentId = await createDocument({
      title: "Favorites",
    });
    const favoritesDatabaseId = nextId("favorites_db");
    await db.insert(schema.contentDatabases).values({
      id: favoritesDatabaseId,
      spaceId,
      systemRole: "favorites",
      ownerEmail: OWNER,
      documentId: favoritesDocumentId,
      title: "Favorites",
      createdAt: now,
      updatedAt: now,
    });
    const pageId = await createDocument({
      parentId: filesDatabase.documentId,
      title: "Pinned page",
    });
    const filesItemId = nextId("files_item");
    const favoriteItemId = nextId("favorite_item");
    await db.insert(schema.contentDatabaseItems).values([
      {
        id: filesItemId,
        ownerEmail: OWNER,
        databaseId: filesDatabase.id,
        documentId: pageId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: favoriteItemId,
        ownerEmail: OWNER,
        databaseId: favoritesDatabaseId,
        documentId: pageId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      removeDatabaseItemsAction.run({
        databaseId: favoritesDatabaseId,
        itemIds: [favoriteItemId],
      }),
    );

    expect(await orderedRows(favoritesDatabaseId)).toEqual([]);
    expect(await orderedRows(filesDatabase.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: filesItemId, documentId: pageId }),
      ]),
    );
    expect(
      await db
        .select({
          id: schema.documents.id,
          trashedAt: schema.documents.trashedAt,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, pageId)),
    ).toEqual([{ id: pageId, trashedAt: null }]);
  });

  it("keeps removed pages out of duplicate actions", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(2);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      removeDatabaseItemsAction.run({
        databaseId,
        itemIds: [rows[0].itemId],
      }),
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        duplicateDatabaseItemAction.run({ itemId: rows[0].itemId }),
      ),
    ).rejects.toThrow("Database row not found");
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        duplicateDatabaseItemsAction.run({
          databaseId,
          itemIds: [rows[0].itemId],
        }),
      ),
    ).rejects.toThrow("All requested rows must exist in the target database");

    const [page] = await getDb()
      .select({ trashedAt: schema.documents.trashedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, rows[0].documentId));
    expect(page.trashedAt).toBeNull();
  });

  it("rejects Can edit entries removal before writing", async () => {
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
        removeDatabaseItemsAction.run({
          databaseId,
          itemIds: [rows[0].itemId, rows[1].itemId],
        }),
      ),
    ).rejects.toThrow(
      `Requires admin role on document ${databaseDocumentId} (have editor)`,
    );

    expect(await orderedRows(databaseId)).toHaveLength(2);
  });

  it("rejects mixed target and foreign memberships before writing", async () => {
    const target = await createDatabaseWithRows(2);
    const foreign = await createDatabaseWithRows(1);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        removeDatabaseItemsAction.run({
          databaseId: target.databaseId,
          itemIds: [target.rows[0].itemId, foreign.rows[0].itemId],
        }),
      ),
    ).rejects.toThrow("All requested rows must exist in the target database");

    expect(await orderedRows(target.databaseId)).toHaveLength(2);
    expect(await orderedRows(foreign.databaseId)).toHaveLength(1);
  });

  it("allows Can edit database with view-only access to the row pages", async () => {
    const { databaseId, databaseDocumentId, rows } =
      await createDatabaseWithRows(2);
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documentShares)
      .values([
        {
          id: nextId("share"),
          resourceId: databaseDocumentId,
          principalType: "user",
          principalId: COLLABORATOR,
          role: "admin",
          createdBy: OWNER,
          createdAt: now,
        },
        ...rows.map((row) => ({
          id: nextId("share"),
          resourceId: row.documentId,
          principalType: "user" as const,
          principalId: COLLABORATOR,
          role: "viewer" as const,
          createdBy: OWNER,
          createdAt: now,
        })),
      ]);

    const result = await runWithRequestContext(
      { userEmail: COLLABORATOR },
      () =>
        removeDatabaseItemsAction.run({
          databaseId,
          documentIds: [rows[0].documentId],
        }),
    );

    expect(result.removedDocumentIds).toEqual([rows[0].documentId]);
    expect(await orderedRows(databaseId)).toHaveLength(1);
    const [page] = await getDb()
      .select({ trashedAt: schema.documents.trashedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, rows[0].documentId));
    expect(page.trashedAt).toBeNull();
  });

  it("rejects source-backed row removal before writing", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(1);
    const now = new Date().toISOString();
    const sourceId = nextId("source");
    await getDb().insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "notion",
      sourceName: "Read-only source",
      sourceTable: "pages",
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(schema.contentDatabaseSourceRows)
      .values({
        id: nextId("source_row"),
        ownerEmail: OWNER,
        sourceId,
        databaseItemId: rows[0].itemId,
        documentId: rows[0].documentId,
        sourceRowId: "source-row-1",
        sourceQualifiedId: "notion:source-row-1",
        sourceDisplayKey: "Source row",
        createdAt: now,
        updatedAt: now,
      });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        removeDatabaseItemsAction.run({
          databaseId,
          itemIds: [rows[0].itemId],
        }),
      ),
    ).rejects.toThrow("Source-backed rows cannot be removed");
    expect(await orderedRows(databaseId)).toHaveLength(1);

    await getDb()
      .delete(schema.contentDatabaseSourceRows)
      .where(
        eq(schema.contentDatabaseSourceRows.databaseItemId, rows[0].itemId),
      );
    await getDb()
      .insert(schema.contentDatabaseBodyHydrationQueue)
      .values({
        id: nextId("hydration"),
        ownerEmail: OWNER,
        sourceId,
        databaseItemId: rows[0].itemId,
        documentId: rows[0].documentId,
        sourceRowId: "source-row-1",
        sourceTable: "pages",
        createdAt: now,
        updatedAt: now,
      });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        removeDatabaseItemsAction.run({
          databaseId,
          itemIds: [rows[0].itemId],
        }),
      ),
    ).rejects.toThrow("Source-backed rows cannot be removed");
    expect(await orderedRows(databaseId)).toHaveLength(1);
  });

  it("serializes a racing source association before membership removal", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(1);
    const now = new Date().toISOString();
    const sourceId = nextId("source");
    await getDb().insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "notion",
      sourceName: "Racing source",
      sourceTable: "pages",
      createdAt: now,
      updatedAt: now,
    });

    let releaseWriter!: () => void;
    const writerCanFinish = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let writerLocked!: () => void;
    const writerHasLock = new Promise<void>((resolve) => {
      writerLocked = resolve;
    });
    const writer = getDb().transaction(async (tx: any) => {
      await lockDatabaseMemberships(tx, [rows[0].itemId]);
      writerLocked();
      await writerCanFinish;
      await tx.insert(schema.contentDatabaseSourceRows).values({
        id: nextId("source_row"),
        ownerEmail: OWNER,
        sourceId,
        databaseItemId: rows[0].itemId,
        documentId: rows[0].documentId,
        sourceRowId: "racing-row",
        sourceQualifiedId: "notion:racing-row",
        sourceDisplayKey: "Racing row",
        createdAt: now,
        updatedAt: now,
      });
    });
    await writerHasLock;

    const removal = runWithRequestContext({ userEmail: OWNER }, () =>
      removeDatabaseItemsAction.run({
        databaseId,
        itemIds: [rows[0].itemId],
      }),
    );
    releaseWriter();
    await writer;

    await expect(removal).rejects.toThrow(
      "Source-backed rows cannot be removed",
    );
    expect(await orderedRows(databaseId)).toHaveLength(1);
  });

  it("rolls back a source-row replacement when any target membership is stale", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(1);
    const now = new Date().toISOString();
    const sourceId = nextId("source");
    const oldSourceRowId = nextId("source_row");
    await getDb().insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "mock-local",
      sourceName: "Atomic source",
      sourceTable: "rows",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabaseSourceRows).values({
      id: oldSourceRowId,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: rows[0].itemId,
      documentId: rows[0].documentId,
      sourceRowId: "old-row",
      sourceQualifiedId: "mock-local://rows/old-row",
      sourceDisplayKey: "Old row",
      createdAt: now,
      updatedAt: now,
    });

    const replacementItems = [
      {
        id: rows[0].itemId,
        databaseId,
        document: { id: rows[0].documentId, title: "Existing" },
        position: 0,
        properties: [],
      },
      {
        id: nextId("missing_item"),
        databaseId,
        document: { id: nextId("missing_document"), title: "Missing" },
        position: 1,
        properties: [],
      },
    ] as ContentDatabaseItem[];

    await expect(
      replaceMockSourceRows({
        sourceId,
        ownerEmail: OWNER,
        sourceType: "mock-local",
        sourceTable: "rows",
        items: replacementItems,
        now,
      }),
    ).rejects.toThrow("Database memberships changed");

    const sourceRows = await getDb()
      .select({ id: schema.contentDatabaseSourceRows.id })
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
    expect(sourceRows).toEqual([{ id: oldSourceRowId }]);
  });

  it("leaves no database-local value after property set races membership removal", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(1);
    const now = new Date().toISOString();
    const propertyId = nextId("property");
    await getDb().insert(schema.documentPropertyDefinitions).values({
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

    const [propertyResult, removalResult] = await Promise.allSettled([
      runWithRequestContext({ userEmail: OWNER }, () =>
        setDocumentPropertyAction.run({
          documentId: rows[0].documentId,
          databaseId,
          propertyId,
          value: "Ready",
        }),
      ),
      runWithRequestContext({ userEmail: OWNER }, () =>
        removeDatabaseItemsAction.run({
          databaseId,
          itemIds: [rows[0].itemId],
        }),
      ),
    ]);

    expect(removalResult.status).toBe("fulfilled");
    expect(["fulfilled", "rejected"]).toContain(propertyResult.status);
    expect(
      await getDb()
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.id, rows[0].itemId)),
    ).toEqual([]);
    expect(
      await getDb()
        .select({ id: schema.documentPropertyValues.id })
        .from(schema.documentPropertyValues)
        .where(
          and(
            eq(schema.documentPropertyValues.documentId, rows[0].documentId),
            eq(schema.documentPropertyValues.propertyId, propertyId),
          ),
        ),
    ).toEqual([]);
  });

  it("leaves no copied value when property duplication races membership removal", async () => {
    const { databaseId, rows } = await createDatabaseWithRows(1);
    const now = new Date().toISOString();
    const propertyId = nextId("property");
    await getDb().insert(schema.documentPropertyDefinitions).values({
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
    await getDb()
      .insert(schema.documentPropertyValues)
      .values({
        id: nextId("value"),
        ownerEmail: OWNER,
        documentId: rows[0].documentId,
        propertyId,
        valueJson: JSON.stringify("Ready"),
        createdAt: now,
        updatedAt: now,
      });

    const [duplicateResult, removalResult] = await Promise.allSettled([
      runWithRequestContext({ userEmail: OWNER }, () =>
        duplicateDocumentPropertyAction.run({
          documentId: rows[0].documentId,
          databaseId,
          propertyId,
        }),
      ),
      runWithRequestContext({ userEmail: OWNER }, () =>
        removeDatabaseItemsAction.run({
          databaseId,
          itemIds: [rows[0].itemId],
        }),
      ),
    ]);

    expect(removalResult.status).toBe("fulfilled");
    expect(["fulfilled", "rejected"]).toContain(duplicateResult.status);

    expect(
      await getDb()
        .select({ id: schema.documentPropertyValues.id })
        .from(schema.documentPropertyValues)
        .innerJoin(
          schema.documentPropertyDefinitions,
          eq(
            schema.documentPropertyDefinitions.id,
            schema.documentPropertyValues.propertyId,
          ),
        )
        .where(
          and(
            eq(schema.documentPropertyValues.documentId, rows[0].documentId),
            eq(schema.documentPropertyDefinitions.databaseId, databaseId),
          ),
        ),
    ).toEqual([]);
  });

  it("keeps copied property values inside the membership-locked transaction", () => {
    const source = readFileSync(
      new URL("./duplicate-document-property.ts", import.meta.url),
      "utf8",
    );
    const transactionStart = source.indexOf(
      "await db.transaction(async (tx) => {",
    );
    const transactionEnd = source.indexOf(
      "\n        });\n      },\n    );",
      transactionStart,
    );
    expect(transactionStart).toBeGreaterThan(-1);
    expect(transactionEnd).toBeGreaterThan(transactionStart);

    const transactionBody = source.slice(transactionStart, transactionEnd);
    const membershipLock = transactionBody.indexOf(
      "await lockDatabaseMemberships(",
    );
    const definitionInsert = transactionBody.indexOf(
      "await tx.insert(schema.documentPropertyDefinitions)",
    );
    const valueRead = transactionBody.indexOf(
      ".from(schema.documentPropertyValues)",
    );
    const valueInsert = transactionBody.indexOf(
      "await tx.insert(schema.documentPropertyValues)",
    );

    expect(membershipLock).toBeGreaterThan(-1);
    expect(definitionInsert).toBeGreaterThan(membershipLock);
    expect(valueRead).toBeGreaterThan(definitionInsert);
    expect(valueInsert).toBeGreaterThan(valueRead);
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
    for (const result of results) {
      expect(result.createdItem).toMatchObject({
        id: result.createdItemId,
        document: { id: result.createdDocumentId },
      });
      const [createdDocument] = await getDb()
        .select({ updatedAt: schema.documents.updatedAt })
        .from(schema.documents)
        .where(eq(schema.documents.id, result.createdDocumentId));
      expect(result.createdDocumentUpdatedAt).toBe(createdDocument.updatedAt);
    }

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
