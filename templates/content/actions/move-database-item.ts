import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
        itemId
          ? eq(schema.contentDatabaseItems.id, itemId)
          : eq(schema.contentDatabaseItems.documentId, documentId!),
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

    for (const [index, item] of nextItems.entries()) {
      await db
        .update(schema.contentDatabaseItems)
        .set({ position: index, updatedAt: now })
        .where(eq(schema.contentDatabaseItems.id, item.id));

      await db
        .update(schema.documents)
        .set({ position: index, updatedAt: now })
        .where(eq(schema.documents.id, item.documentId));
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return getContentDatabaseResponse(row.item.databaseId);
  },
});
