import { inArray, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";
import { sortRowIds } from "./_row-lock-order.js";

export async function lockDatabaseMemberships(db: any, itemIds: string[]) {
  const uniqueItemIds = sortRowIds(itemIds);
  if (uniqueItemIds.length === 0) return;
  const lockedIds = new Set<string>();
  for (const itemIdChunk of chunks(uniqueItemIds, 90)) {
    // ORDER BY puts the row locks in id order; an UPDATE would take them in
    // whatever order its scan visits the rows.
    const lockedRows = await db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(inArray(schema.contentDatabaseItems.id, itemIdChunk))
      .orderBy(sql`${schema.contentDatabaseItems.id} COLLATE "C"`)
      .for("no key update");
    for (const row of lockedRows) lockedIds.add(row.id);
  }
  if (lockedIds.size !== uniqueItemIds.length) {
    throw new Error(
      "Database memberships changed before the operation completed.",
    );
  }
}
