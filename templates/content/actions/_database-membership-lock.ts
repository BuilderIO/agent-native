import { inArray, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";

export async function lockDatabaseMemberships(db: any, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return;
  const lockedRows = await db
    .update(schema.contentDatabaseItems)
    .set({
      updatedAt: sql`${schema.contentDatabaseItems.updatedAt}`,
    })
    .where(inArray(schema.contentDatabaseItems.id, uniqueItemIds))
    .returning({ id: schema.contentDatabaseItems.id });
  if (lockedRows.length !== uniqueItemIds.length) {
    throw new Error(
      "Database memberships changed before the operation completed.",
    );
  }
}
