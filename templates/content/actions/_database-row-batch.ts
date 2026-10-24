import { ActionContractError } from "@agent-native/core/action";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import { lockDocumentRows } from "./_row-lock-order.js";

export const DATABASE_ROW_BATCH_LIMIT = 100;

export const databaseRowBatchSchema = z
  .object({
    databaseId: z.string().optional().describe("Content collection ID"),
    documentId: z
      .string()
      .optional()
      .describe("Content collection backing document ID"),
    itemIds: z
      .array(z.string())
      .max(DATABASE_ROW_BATCH_LIMIT)
      .optional()
      .describe(
        'Native JSON array of collection row item IDs to mutate in one batch, for example ["item_1", "item_2"].',
      ),
    documentIds: z
      .array(z.string())
      .max(DATABASE_ROW_BATCH_LIMIT)
      .optional()
      .describe(
        'Native JSON array of collection row document IDs to mutate in one batch, for example ["doc_1", "doc_2"].',
      ),
  })
  .superRefine((value, ctx) => {
    if (!value.databaseId && !value.documentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either databaseId or documentId is required.",
      });
    }
    const total =
      (value.itemIds?.length ?? 0) + (value.documentIds?.length ?? 0);
    if (total === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one itemId or documentId is required.",
      });
    }
    if (total > DATABASE_ROW_BATCH_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Database row batch is limited to ${DATABASE_ROW_BATCH_LIMIT} rows.`,
      });
    }
  });

export type DatabaseRowBatchInput = z.infer<typeof databaseRowBatchSchema>;

export type DatabaseRowBatchRow = {
  item: typeof schema.contentDatabaseItems.$inferSelect;
  database: typeof schema.contentDatabases.$inferSelect;
  document: typeof schema.documents.$inferSelect;
};

function findDuplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function positionCaseSql(
  idColumn: unknown,
  fallbackColumn: unknown,
  orderedIds: string[],
) {
  const cases = orderedIds.map((id, index) => sql`WHEN ${id} THEN ${index}`);
  return sql<number>`CASE ${idColumn} ${sql.join(cases, sql` `)} ELSE ${fallbackColumn} END`;
}

export async function resolveDatabaseRowsForBatch(
  input: DatabaseRowBatchInput,
  options: { includeTrashed?: boolean } = {},
): Promise<{
  database: typeof schema.contentDatabases.$inferSelect;
  rows: DatabaseRowBatchRow[];
}> {
  const itemIds = input.itemIds ?? [];
  const documentIds = input.documentIds ?? [];
  const requestedCount = itemIds.length + documentIds.length;
  if (!input.databaseId && !input.documentId) {
    throw new Error("Either databaseId or documentId is required.");
  }
  if (requestedCount === 0) {
    throw new Error("At least one itemId or documentId is required.");
  }
  if (requestedCount > DATABASE_ROW_BATCH_LIMIT) {
    throw new Error(
      `Database row batch is limited to ${DATABASE_ROW_BATCH_LIMIT} rows.`,
    );
  }
  const duplicateItemIds = findDuplicates(itemIds);
  const duplicateDocumentIds = findDuplicates(documentIds);
  if (duplicateItemIds.length > 0 || duplicateDocumentIds.length > 0) {
    throw new Error("Duplicate database row IDs are not allowed in one batch.");
  }

  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        input.databaseId
          ? eq(schema.contentDatabases.id, input.databaseId)
          : undefined,
        input.documentId
          ? eq(schema.contentDatabases.documentId, input.documentId)
          : undefined,
        isNull(schema.contentDatabases.deletedAt),
      ),
    );

  if (!database) throw new Error("Database not found.");

  const rowPredicates = [];
  if (itemIds.length > 0) {
    rowPredicates.push(inArray(schema.contentDatabaseItems.id, itemIds));
  }
  if (documentIds.length > 0) {
    rowPredicates.push(
      inArray(schema.contentDatabaseItems.documentId, documentIds),
    );
  }

  const requestedRows = await db
    .select({
      item: schema.contentDatabaseItems,
      database: schema.contentDatabases,
      document: schema.documents,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, database.id),
        rowPredicates.length === 1 ? rowPredicates[0] : or(...rowPredicates),
        isNull(schema.contentDatabases.deletedAt),
        options.includeTrashed ? undefined : isNull(schema.documents.trashedAt),
      ),
    )
    .orderBy(asc(schema.contentDatabaseItems.position));

  const itemIdMatches = new Set(requestedRows.map((row) => row.item.id));
  const documentIdMatches = new Set(
    requestedRows.map((row) => row.item.documentId),
  );
  const missingItemIds = itemIds.filter((id) => !itemIdMatches.has(id));
  const missingDocumentIds = documentIds.filter(
    (id) => !documentIdMatches.has(id),
  );
  if (missingItemIds.length > 0 || missingDocumentIds.length > 0) {
    throw new Error("All requested rows must exist in the target database.");
  }

  if (requestedRows.length !== requestedCount) {
    throw new Error("Duplicate database row references are not allowed.");
  }

  const rowIds = requestedRows.map((row) => row.item.id);
  if (new Set(rowIds).size !== rowIds.length) {
    throw new Error("Duplicate database row references are not allowed.");
  }

  return {
    database,
    rows: requestedRows,
  };
}

/**
 * Pass `heldMembershipIds` when the caller locked the collection's
 * memberships before any page: a membership outside that set was added since,
 * and locking it now would come after pages the caller holds.
 */
export async function renumberDatabaseRows(
  db: ReturnType<typeof getDb>,
  database: typeof schema.contentDatabases.$inferSelect,
  now: string,
  heldMembershipIds?: ReadonlySet<string>,
) {
  // Trashed rows keep their slot: renumbering only the visible rows lets a
  // visible row take a trashed row's number, and the restored row then sorts
  // after it. The tiebreaks match the collection read's.
  const rows = await db
    .select({
      id: schema.contentDatabaseItems.id,
      documentId: schema.contentDatabaseItems.documentId,
    })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, database.id))
    .orderBy(
      asc(schema.contentDatabaseItems.position),
      asc(schema.contentDatabaseItems.createdAt),
      asc(schema.contentDatabaseItems.id),
    );
  if (rows.length === 0) return;
  if (heldMembershipIds && rows.some((row) => !heldMembershipIds.has(row.id)))
    throw new ActionContractError(
      "Database memberships changed before the operation completed.",
      { errorCode: "DATABASE_MEMBERSHIPS_CHANGED", statusCode: 409 },
    );

  const itemIds = rows.map((row) => row.id);
  const documentIds = rows.map((row) => row.documentId);
  const renumberedPages = and(
    eq(schema.documents.ownerEmail, database.ownerEmail),
    eq(schema.documents.parentId, database.documentId),
    inArray(schema.documents.id, documentIds),
  );
  // An UPDATE locks rows in scan order. Take them in Content's row-lock order
  // first; callers already hold the collection.
  await lockDatabaseMemberships(db, itemIds);
  await lockDocumentRows(
    db,
    (
      await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(renumberedPages)
    ).map((page) => page.id),
  );
  await db
    .update(schema.contentDatabaseItems)
    .set({
      position: positionCaseSql(
        schema.contentDatabaseItems.id,
        schema.contentDatabaseItems.position,
        itemIds,
      ),
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, database.id),
        inArray(schema.contentDatabaseItems.id, itemIds),
      ),
    );

  await db
    .update(schema.documents)
    .set({
      position: positionCaseSql(
        schema.documents.id,
        schema.documents.position,
        documentIds,
      ),
      updatedAt: now,
    })
    .where(renumberedPages);
}
