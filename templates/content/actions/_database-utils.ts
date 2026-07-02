import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type {
  ContentDatabaseBodyHydration,
  ContentDatabaseMembership,
  ContentDatabaseResponse,
} from "../shared/api.js";
import { getAllContentDatabaseSourceSnapshots } from "./_database-source-utils.js";
import {
  applyFederatedOverlayValues,
  federateSources,
} from "./_federation-join.js";
import {
  listPropertiesForDatabase,
  serializeDatabase,
} from "./_property-utils.js";

export const CONTENT_DATABASE_MAX_READ_LIMIT = 5_000;

function canManageRole(role: string) {
  return role === "owner" || role === "admin";
}

type DatabaseMembershipRow = {
  item: typeof schema.contentDatabaseItems.$inferSelect;
  database: typeof schema.contentDatabases.$inferSelect;
  sourceId?: string | null;
};

export function serializeBodyHydration(
  item: typeof schema.contentDatabaseItems.$inferSelect,
): ContentDatabaseBodyHydration {
  const status = item.bodyHydrationStatus;
  return {
    status:
      status === "pending" ||
      status === "hydrating" ||
      status === "hydrated" ||
      status === "error"
        ? status
        : "hydrated",
    attemptedAt: item.bodyHydrationAttemptedAt,
    error: item.bodyHydrationError,
    version: item.bodyHydrationVersion,
  };
}

export function serializeDatabaseMembership(
  row: DatabaseMembershipRow,
): ContentDatabaseMembership {
  return {
    databaseId: row.database.id,
    databaseDocumentId: row.database.documentId,
    databaseTitle: row.database.title || "Untitled database",
    position: row.item.position,
    sourceId: row.sourceId ?? null,
    bodyHydration: serializeBodyHydration(row.item),
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

export function normalizeContentDatabasePageOptions(options: {
  limit?: number;
  offset?: number;
}) {
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(
          1,
          Math.min(Math.floor(options.limit), CONTENT_DATABASE_MAX_READ_LIMIT),
        )
      : null;
  const offset =
    typeof options.offset === "number" && Number.isFinite(options.offset)
      ? Math.max(0, Math.floor(options.offset))
      : 0;
  return { limit, offset };
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
  options: { limit?: number; offset?: number } = {},
): Promise<ContentDatabaseResponse> {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));

  if (!database || database.deletedAt) {
    throw new Error(`Database "${databaseId}" not found`);
  }

  // PURE read: the primary "Content" Blocks field is seeded at create time and
  // by the one-time startup repair — never here. Reading a database (including a
  // shared one a viewer is opening) must not mutate schema.

  const { limit, offset } = normalizeContentDatabasePageOptions(options);
  const [itemCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));

  let itemsQuery = db
    .select()
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
    .orderBy(asc(schema.contentDatabaseItems.position))
    .$dynamic();
  if (limit !== null) {
    itemsQuery = itemsQuery.limit(limit).offset(offset);
  }
  const items = await itemsQuery;

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
      bodyHydration: serializeBodyHydration(item),
      properties: await listPropertiesForDatabase(databaseId, document),
    });
  }

  const sources = await getAllContentDatabaseSourceSnapshots(database);
  const serializedDocumentIds = new Set(
    serializedItems.map((item) => item.document.id),
  );
  // When paginating, scope every DOCUMENT-BACKED source's rows to the visible
  // page — that's the primary AND any row-union secondary (each row maps to a
  // real document). Federated join rows carry no document (empty documentId),
  // so they're kept intact — only matched ones overlay anyway.
  const pagedSources =
    limit !== null
      ? sources.map((source) => ({
          ...source,
          rows: source.rows.filter(
            (row) =>
              !row.documentId || serializedDocumentIds.has(row.documentId),
          ),
        }))
      : sources;
  const pagedPrimary = pagedSources[0] ?? null;

  const federatedItems = federateSources({
    items: serializedItems,
    sources: pagedSources,
  });
  // Opt-in federated columns (a secondary field the user added via the picker)
  // get their per-row values from the matched overlay at read time.
  const itemsWithOverlay = applyFederatedOverlayValues(federatedItems);

  return {
    database: serializeDatabase(database),
    properties: await listPropertiesForDatabase(databaseId),
    items: itemsWithOverlay,
    source: pagedPrimary,
    sources: pagedSources,
    pagination:
      limit !== null
        ? {
            offset,
            limit,
            totalItems: Number(itemCount?.count ?? 0),
            returnedItems: serializedItems.length,
            hasMore:
              offset + serializedItems.length < Number(itemCount?.count ?? 0),
          }
        : undefined,
  };
}

export async function isSoftDeletedDatabaseDocument(documentId: string) {
  const db = getDb();
  const [ownedDatabase] = await db
    .select({ id: schema.contentDatabases.id })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.documentId, documentId),
        sql`${schema.contentDatabases.deletedAt} IS NOT NULL`,
      ),
    );
  if (ownedDatabase) return true;

  const [databaseItem] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        sql`${schema.contentDatabases.deletedAt} IS NOT NULL`,
      ),
    );
  return !!databaseItem;
}

export async function getDatabaseByDocumentId(
  documentId: string,
  options: { includeDeleted?: boolean } = {},
  db = getDb(),
) {
  const clauses = [eq(schema.contentDatabases.documentId, documentId)];
  if (!options.includeDeleted) {
    clauses.push(isNull(schema.contentDatabases.deletedAt));
  }
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(and(...clauses));
  return database ?? null;
}

export async function getDatabaseItemByDocumentId(
  documentId: string,
  options: { includeDeleted?: boolean } = {},
  db = getDb(),
) {
  const clauses = [eq(schema.contentDatabaseItems.documentId, documentId)];
  if (!options.includeDeleted) {
    clauses.push(isNull(schema.contentDatabases.deletedAt));
  }
  const [row] = await db
    .select({
      item: schema.contentDatabaseItems,
      database: schema.contentDatabases,
      sourceId: schema.contentDatabaseSourceRows.sourceId,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .leftJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .where(and(...clauses));
  return row ?? null;
}

export async function deleteDatabaseDataForDocument(
  documentId: string,
  ownerEmail: string,
  db = getDb(),
) {
  const database = await getDatabaseByDocumentId(
    documentId,
    {
      includeDeleted: true,
    },
    db,
  );
  if (database) {
    const definitions = await db
      .select({ id: schema.documentPropertyDefinitions.id })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, database.id));

    for (const definition of definitions) {
      await db
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, definition.id));
      // Independent Blocks-field content is keyed by property id; drop it so
      // deleting a database leaves no orphaned document_block_field_contents.
      await db
        .delete(schema.documentBlockFieldContents)
        .where(eq(schema.documentBlockFieldContents.propertyId, definition.id));
    }
    const sources = await db
      .select({ id: schema.contentDatabaseSources.id })
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, database.id));
    for (const source of sources) {
      await db
        .delete(schema.contentDatabaseBodyHydrationQueue)
        .where(
          eq(schema.contentDatabaseBodyHydrationQueue.sourceId, source.id),
        );
      await db
        .delete(schema.contentDatabaseSourceExecutions)
        .where(eq(schema.contentDatabaseSourceExecutions.sourceId, source.id));
      await db
        .delete(schema.contentDatabaseSourceChangeReviews)
        .where(
          eq(schema.contentDatabaseSourceChangeReviews.sourceId, source.id),
        );
      await db
        .delete(schema.contentDatabaseSourceChangeSets)
        .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, source.id));
      await db
        .delete(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
      await db
        .delete(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id));
    }
    await db
      .delete(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, database.id));
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

  const item = await getDatabaseItemByDocumentId(
    documentId,
    {
      includeDeleted: true,
    },
    db,
  );
  if (item) {
    await db
      .delete(schema.contentDatabaseBodyHydrationQueue)
      .where(
        eq(schema.contentDatabaseBodyHydrationQueue.documentId, documentId),
      );
    await db
      .delete(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.ownerEmail, ownerEmail),
        ),
      );
    // A deleted row document's independent Blocks-field content is keyed by
    // document id; drop it so no document_block_field_contents rows are
    // orphaned when the row is removed.
    await db
      .delete(schema.documentBlockFieldContents)
      .where(eq(schema.documentBlockFieldContents.documentId, documentId));
    await db
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, documentId));
  }
}
