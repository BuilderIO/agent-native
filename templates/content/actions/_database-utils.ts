import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type {
  ContentDatabaseMembership,
  ContentDatabaseResponse,
} from "../shared/api.js";
import {
  listPropertiesForDatabase,
  serializeDatabase,
} from "./_property-utils.js";

function canManageRole(role: string) {
  return role === "owner" || role === "admin";
}

type DatabaseMembershipRow = {
  item: typeof schema.contentDatabaseItems.$inferSelect;
  database: typeof schema.contentDatabases.$inferSelect;
};

export function serializeDatabaseMembership(
  row: DatabaseMembershipRow,
): ContentDatabaseMembership {
  return {
    databaseId: row.database.id,
    databaseDocumentId: row.database.documentId,
    databaseTitle: row.database.title || "Untitled database",
    position: row.item.position,
  };
}

export function filterDatabaseContainedDocuments<
  TDocument extends { id: string; parentId: string | null },
>(
  documents: TDocument[],
  databaseItemDocumentIds: Iterable<string>,
): TDocument[] {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const hiddenIds = new Set(databaseItemDocumentIds);

  function isContained(doc: TDocument) {
    if (hiddenIds.has(doc.id)) return true;

    const seen = new Set([doc.id]);
    let parentId = doc.parentId;

    while (parentId && byId.has(parentId)) {
      if (seen.has(parentId)) return false;
      seen.add(parentId);

      if (hiddenIds.has(parentId)) {
        hiddenIds.add(doc.id);
        return true;
      }

      parentId = byId.get(parentId)?.parentId ?? null;
    }

    return false;
  }

  return documents.filter((doc) => !isContained(doc));
}

function serializeDocument(
  doc: typeof schema.documents.$inferSelect,
  membership?: DatabaseMembershipRow,
) {
  return {
    id: doc.id,
    parentId: doc.parentId,
    title: doc.title,
    content: doc.content,
    icon: doc.icon,
    position: doc.position,
    isFavorite: parseDocumentFavorite(doc.isFavorite),
    hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
    visibility: doc.visibility,
    accessRole: "owner" as const,
    canEdit: true,
    canManage: canManageRole("owner"),
    databaseMembership: membership
      ? serializeDatabaseMembership(membership)
      : undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function getContentDatabaseResponse(
  databaseId: string,
): Promise<ContentDatabaseResponse> {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));

  if (!database) throw new Error(`Database "${databaseId}" not found`);

  const items = await db
    .select()
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
    .orderBy(asc(schema.contentDatabaseItems.position));

  const documents =
    items.length > 0
      ? await db
          .select()
          .from(schema.documents)
          .where(
            and(
              inArray(
                schema.documents.id,
                items.map((item) => item.documentId),
              ),
              eq(schema.documents.ownerEmail, database.ownerEmail),
            ),
          )
      : [];
  const documentById = new Map(documents.map((doc) => [doc.id, doc]));

  const serializedItems = [];
  for (const item of items) {
    const document = documentById.get(item.documentId);
    if (!document) continue;
    serializedItems.push({
      id: item.id,
      databaseId: item.databaseId,
      document: serializeDocument(document, { item, database }),
      position: item.position,
      properties: await listPropertiesForDatabase(databaseId, document),
    });
  }

  return {
    database: serializeDatabase(database),
    properties: await listPropertiesForDatabase(databaseId),
    items: serializedItems,
  };
}

export async function getDatabaseByDocumentId(documentId: string) {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.documentId, documentId));
  return database ?? null;
}

export async function getDatabaseItemByDocumentId(documentId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      item: schema.contentDatabaseItems,
      database: schema.contentDatabases,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(eq(schema.contentDatabaseItems.documentId, documentId));
  return row ?? null;
}

export async function deleteDatabaseDataForDocument(
  documentId: string,
  ownerEmail: string,
) {
  const db = getDb();
  const database = await getDatabaseByDocumentId(documentId);
  if (database) {
    const definitions = await db
      .select({ id: schema.documentPropertyDefinitions.id })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, database.id));

    for (const definition of definitions) {
      await db
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, definition.id));
    }
    await db
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, database.id));
    await db
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, database.id));
    await db
      .delete(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, database.id));
  }

  const item = await getDatabaseItemByDocumentId(documentId);
  if (item) {
    await db
      .delete(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.ownerEmail, ownerEmail),
        ),
      );
    await db
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, documentId));
  }
}
