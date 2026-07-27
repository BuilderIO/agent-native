import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function positionCaseSql(
  idColumn: unknown,
  fallbackColumn: unknown,
  orderedIds: string[],
) {
  const cases = orderedIds.map((id, index) => sql`WHEN ${id} THEN ${index}`);
  return sql<number>`CASE ${idColumn} ${sql.join(cases, sql` `)} ELSE ${fallbackColumn} END`;
}

export default defineAction({
  description: "Move a page row to a new position in a content database.",
  schema: z.object({
    itemId: z.string().optional().describe("Database item ID"),
    documentId: z.string().optional().describe("Database row document ID"),
    position: z.coerce.number().int().describe("New zero-based row position"),
  }),
  run: async ({ itemId, documentId, position }) => {
    if (!itemId && !documentId) {
      throw new Error("Either itemId or documentId is required.");
    }

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
      .where(
        and(
          itemId
            ? eq(schema.contentDatabaseItems.id, itemId)
            : eq(schema.contentDatabaseItems.documentId, documentId!),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );

    if (!row) throw new Error("Database row not found.");

    await assertAccess("document", row.database.documentId, "editor");

    const items = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, row.item.databaseId))
      .orderBy(asc(schema.contentDatabaseItems.position));

    const currentIndex = items.findIndex((item) => item.id === row.item.id);
    if (currentIndex < 0) throw new Error("Database row not found.");

    const nextIndex = clamp(position, 0, items.length - 1);
    if (nextIndex === currentIndex) {
      return getContentDatabaseResponse(row.item.databaseId);
    }

    const nextItems = [...items];
    const [moved] = nextItems.splice(currentIndex, 1);
    nextItems.splice(nextIndex, 0, moved);
    const now = new Date().toISOString();
    const itemIds = nextItems.map((item) => item.id);
    const documentIds = nextItems.map((item) => item.documentId);

    await db.transaction(async (tx) => {
      await tx
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
            eq(schema.contentDatabaseItems.databaseId, row.item.databaseId),
            inArray(schema.contentDatabaseItems.id, itemIds),
          ),
        );

      await tx
        .update(schema.documents)
        .set({
          position: positionCaseSql(
            schema.documents.id,
            schema.documents.position,
            documentIds,
          ),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.documents.ownerEmail, row.database.ownerEmail),
            eq(schema.documents.parentId, row.database.documentId),
            inArray(schema.documents.id, documentIds),
          ),
        );
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return getContentDatabaseResponse(row.item.databaseId);
  },
});
