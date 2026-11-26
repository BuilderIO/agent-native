import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export async function bodyBlocksPropertyIds(
  documentId: string,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<string[]> {
  // guard:allow-unscoped — reads which collections' primary fields a page the caller may read backs.
  const rows = await db
    .select({
      propertyId: schema.contentDatabases.primaryBlocksPropertyId,
      systemRole: schema.contentDatabases.systemRole,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    )
    .orderBy(schema.contentDatabases.id);
  const ordered = [
    ...rows.filter((row) => row.systemRole === "files"),
    ...rows.filter((row) => row.systemRole !== "files"),
  ];
  return [
    ...new Set(
      ordered.flatMap((row) => (row.propertyId ? [row.propertyId] : [])),
    ),
  ];
}
