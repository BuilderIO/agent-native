import { inArray, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";

export async function lockDatabaseMemberships(db: any, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)].sort();
  if (uniqueItemIds.length === 0) return;
  const lockedIds = new Set<string>();
  for (const itemIdChunk of chunks(uniqueItemIds, 90)) {
    const lockedRows = await db
      .update(schema.contentDatabaseItems)
      .set({
        updatedAt: sql`${schema.contentDatabaseItems.updatedAt}`,
      })
      .where(inArray(schema.contentDatabaseItems.id, itemIdChunk))
      .returning({ id: schema.contentDatabaseItems.id });
    for (const row of lockedRows) lockedIds.add(row.id);
  }
  if (lockedIds.size !== uniqueItemIds.length) {
    throw new Error(
      "Database memberships changed before the operation completed.",
    );
  }
}
