import { ActionContractError } from "@agent-native/core/action";
import { inArray, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";
import { sortRowIds } from "./_row-lock-order.js";

export async function lockDatabaseMemberships(db: any, itemIds: string[]) {
  const uniqueItemIds = sortRowIds(itemIds);
  const lockedIds = await lockExistingDatabaseMemberships(db, uniqueItemIds);
  if (lockedIds.size !== uniqueItemIds.length) {
    throw new ActionContractError(
      "Database memberships changed before the operation completed.",
      { errorCode: "DATABASE_MEMBERSHIPS_CHANGED", statusCode: 409 },
    );
  }
}

/**
 * For writers that report a missing membership themselves: locks those that
 * still exist, in the same order, and returns their ids.
 */
export async function lockExistingDatabaseMemberships(
  db: any,
  itemIds: string[],
): Promise<Set<string>> {
  const uniqueItemIds = sortRowIds(itemIds);
  const lockedIds = new Set<string>();
  for (const itemIdChunk of chunks(uniqueItemIds, 90)) {
    // The sub-select takes the row locks in id order; an UPDATE alone would
    // take them in whatever order its scan visits the rows. It stays an
    // UPDATE for its ROW EXCLUSIVE table lock: suggestion acceptance locks a
    // page, then refuses with `LOCK TABLE ... SHARE ROW EXCLUSIVE NOWAIT`
    // while anyone may hold a membership, and a locking SELECT's ROW SHARE
    // doesn't conflict with that.
    const lockedRows = await db
      .update(schema.contentDatabaseItems)
      .set({
        updatedAt: sql`${schema.contentDatabaseItems.updatedAt}`,
      })
      .where(
        inArray(
          schema.contentDatabaseItems.id,
          db
            .select({ id: schema.contentDatabaseItems.id })
            .from(schema.contentDatabaseItems)
            .where(inArray(schema.contentDatabaseItems.id, itemIdChunk))
            .orderBy(sql`${schema.contentDatabaseItems.id} COLLATE "C"`)
            .for("no key update"),
        ),
      )
      .returning({ id: schema.contentDatabaseItems.id });
    for (const row of lockedRows) lockedIds.add(row.id);
  }
  return lockedIds;
}
