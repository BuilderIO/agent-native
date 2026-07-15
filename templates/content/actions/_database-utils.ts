import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { getDocumentContextPath } from "../server/lib/document-context.js";
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
  listPropertiesForDatabaseDocuments,
  listPropertiesForDatabase,
  serializeDatabase,
} from "./_property-utils.js";
export { getDocumentContextPath };

export const CONTENT_DATABASE_MAX_READ_LIMIT = 5_000;

function canManageRole(role: string) {
  return role === "owner" || role === "admin";
}

type DatabaseMembershipRow = {
  item: typeof schema.contentDatabaseItems.$inferSelect;
  database: typeof schema.contentDatabases.$inferSelect;
  sourceId?: string | null;
  bodyHydrationQueueId?: string | null;
};

type DocumentListRow = Omit<typeof schema.documents.$inferSelect, "content">;

// Database grids render row metadata and properties. Fetching the document body
// here would transfer it only for serializeDocument to replace it with an empty
// string below; opened documents use their dedicated document read path instead.
export const contentDatabaseListDocumentSelection = {
  id: schema.documents.id,
  parentId: schema.documents.parentId,
  title: schema.documents.title,
  description: schema.documents.description,
  icon: schema.documents.icon,
  position: schema.documents.position,
  isFavorite: schema.documents.isFavorite,
  hideFromSearch: schema.documents.hideFromSearch,
  sourceMode: schema.documents.sourceMode,
  sourceKind: schema.documents.sourceKind,
  sourcePath: schema.documents.sourcePath,
  sourceRootPath: schema.documents.sourceRootPath,
  sourceUpdatedAt: schema.documents.sourceUpdatedAt,
  visibility: schema.documents.visibility,
  ownerEmail: schema.documents.ownerEmail,
  orgId: schema.documents.orgId,
  createdAt: schema.documents.createdAt,
  updatedAt: schema.documents.updatedAt,
};

export function serializeBodyHydration(
  item: typeof schema.contentDatabaseItems.$inferSelect,
  options: { queued?: boolean } = {},
): ContentDatabaseBodyHydration {
  const status = item.bodyHydrationStatus;
  return {
    status:
      status === "pending" ||
      status === "hydrating" ||
      status === "hydrated" ||
      status === "unavailable" ||
      status === "error"
        ? status
        : options.queued
          ? "pending"
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
    bodyHydration: serializeBodyHydration(row.item, {
      queued: !!row.bodyHydrationQueueId,
    }),
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

export function filterContentDatabaseSourceRowsForPage<
  TRow extends { documentId: string; databaseItemId: string },
  TChangeSet extends {
    documentId: string | null;
    databaseItemId: string | null;
    direction: string;
    state: string;
    executions: Array<{ state: string }>;
  },
>(args: {
  rows: TRow[];
  changeSets: TChangeSet[];
  visibleDocumentIds: ReadonlySet<string>;
}) {
  const actionableChangeSets = args.changeSets.filter(
    (changeSet) =>
      changeSet.direction === "outbound" &&
      !changeSet.executions.some(
        (execution) => execution.state === "succeeded",
      ) &&
      (changeSet.state === "pending_push" ||
        changeSet.state === "staged_revision" ||
        changeSet.state === "approved"),
  );
  const actionableDocumentIds = new Set(
    actionableChangeSets.flatMap((changeSet) =>
      changeSet.documentId ? [changeSet.documentId] : [],
    ),
  );
  const actionableItemIds = new Set(
    actionableChangeSets.flatMap((changeSet) =>
      changeSet.databaseItemId ? [changeSet.databaseItemId] : [],
    ),
  );

  return args.rows.filter(
    (row) =>
      !row.documentId ||
      args.visibleDocumentIds.has(row.documentId) ||
      actionableDocumentIds.has(row.documentId) ||
      actionableItemIds.has(row.databaseItemId),
  );
}

function serializeDocument(
  doc: DocumentListRow,
  membership?: DatabaseMembershipRow,
) {
  return {
    id: doc.id,
    parentId: doc.parentId,
    title: doc.title,
    // List reads deliberately project no `documents.content`; opened documents
    // use their dedicated read path.
    content: "",
    description: doc.description,
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
  const [databaseDocument] = await db
    .select({
      id: schema.documents.id,
      parentId: schema.documents.parentId,
      description: schema.documents.description,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, database.documentId));

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
          .select(contentDatabaseListDocumentSelection)
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
  const propertiesByDocumentId = await listPropertiesForDatabaseDocuments(
    databaseId,
    // Property serialization uses metadata only; this list projection carries
    // every document field it consumes except the deliberately omitted body.
    documents as Array<typeof schema.documents.$inferSelect>,
  );
  const queuedBodyHydrationItemIds =
    items.length > 0
      ? new Set(
          (
            await db
              .select({
                databaseItemId:
                  schema.contentDatabaseBodyHydrationQueue.databaseItemId,
              })
              .from(schema.contentDatabaseBodyHydrationQueue)
              .where(
                inArray(
                  schema.contentDatabaseBodyHydrationQueue.databaseItemId,
                  items.map((item) => item.id),
                ),
              )
          ).map((row) => row.databaseItemId),
        )
      : new Set<string>();

  const serializedItems = [];
  for (const item of items) {
    const document = documentById.get(item.documentId);
    if (!document) continue;
    const bodyHydrationQueued = queuedBodyHydrationItemIds.has(item.id);
    serializedItems.push({
      id: item.id,
      databaseId: item.databaseId,
      document: serializeDocument(document, {
        item,
        database,
        bodyHydrationQueueId: bodyHydrationQueued ? item.id : null,
      }),
      position: item.position,
      bodyHydration: serializeBodyHydration(item, {
        queued: bodyHydrationQueued,
      }),
      properties: propertiesByDocumentId.get(document.id) ?? [],
    });
  }

  const sources = await getAllContentDatabaseSourceSnapshots(database);
  const serializedDocumentIds = new Set(
    serializedItems.map((item) => item.document.id),
  );
  // When paginating, scope every DOCUMENT-BACKED source's rows to the visible
  // page, plus the small set referenced by actionable reviews. The dialog gets
  // change sets independently of the item page and needs those rows to retain
  // the linked provider target instead of misclassifying an off-page update as
  // a create. Federated join rows carry no document (empty documentId), so
  // they're kept intact — only matched ones overlay anyway.
  const pagedSources =
    limit !== null
      ? sources.map((source) => ({
          ...source,
          rows: filterContentDatabaseSourceRowsForPage({
            rows: source.rows,
            changeSets: source.changeSets,
            visibleDocumentIds: serializedDocumentIds,
          }),
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
    database: serializeDatabase(database, databaseDocument?.description ?? ""),
    contextPath: databaseDocument
      ? await getDocumentContextPath(databaseDocument)
      : [],
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
      bodyHydrationQueueId: schema.contentDatabaseBodyHydrationQueue.id,
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
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
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
