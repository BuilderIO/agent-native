import { ActionContractError } from "@agent-native/core/action";
import {
  and,
  eq,
  inArray,
  isNull,
  like,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { parsePropertyOptions } from "../shared/properties.js";
import { sortRowIds } from "./_row-lock-order.js";

type ContentDb = ReturnType<typeof getDb>;
export type SpaceMoveCollection = typeof schema.contentDatabases.$inferSelect;

function groups<T>(values: T[], size = 90): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function blocked(message: string, errorCode: string): never {
  throw new ActionContractError(message, { errorCode, statusCode: 409 });
}

/**
 * The collections that move to another space with a page subtree: those whose
 * page, or the page they sit in, is in it. Refuses one that can't move whole:
 * its page or a row outside the subtree, an outside source, webhooks, or a
 * relation to or from a collection that stays behind. On a `recheck` under the
 * move's locks, a page or row outside the subtree means it changed since the
 * move read it.
 */
export async function readCollectionsForSpaceMove(
  db: ContentDb,
  ids: string[],
  { recheck = false }: { recheck?: boolean } = {},
): Promise<SpaceMoveCollection[]> {
  const outside = (message: string, errorCode: string) =>
    recheck
      ? blocked(
          "This page changed while it was being moved. Try again.",
          "PAGE_SUBTREE_CHANGED",
        )
      : blocked(message, errorCode);
  const idSet = new Set(ids);
  const found = new Map<string, SpaceMoveCollection>();
  for (const idGroup of groups(ids)) {
    const rows: SpaceMoveCollection[] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          isNull(schema.contentDatabases.systemRole),
          or(
            inArray(schema.contentDatabases.documentId, idGroup),
            inArray(schema.contentDatabases.ownerDocumentId, idGroup),
          ),
        ),
      );
    for (const row of rows) found.set(row.id, row);
  }
  const collections = [...found.values()];
  if (collections.length === 0) return collections;
  if (
    collections.some(
      (collection) =>
        !idSet.has(collection.documentId) ||
        (collection.ownerDocumentId !== null &&
          !idSet.has(collection.ownerDocumentId)),
    )
  ) {
    outside(
      "A collection can only move to another workspace with the page it's in.",
      "COLLECTION_OUTSIDE_PAGE",
    );
  }
  const collectionIds = collections.map((collection) => collection.id);
  const collectionIdSet = new Set(collectionIds);
  for (const idGroup of groups(collectionIds)) {
    const outsideRows = await db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          inArray(schema.contentDatabaseItems.databaseId, idGroup),
          notInArray(schema.contentDatabaseItems.documentId, ids),
        ),
      )
      .limit(1);
    if (outsideRows.length > 0) {
      outside(
        "This collection has rows whose pages are somewhere else, so it can't move to another workspace.",
        "COLLECTION_ROWS_OUTSIDE",
      );
    }
    const sources = await db
      .select({ id: schema.contentDatabaseSources.id })
      .from(schema.contentDatabaseSources)
      .where(inArray(schema.contentDatabaseSources.databaseId, idGroup))
      .limit(1);
    if (sources.length > 0) {
      blocked(
        "Collections linked to an outside source can't move to another workspace. Disconnect the source first.",
        "COLLECTION_SOURCE_LINKED",
      );
    }
    const webhooks = await db
      .select({ id: schema.contentWebhooks.id })
      .from(schema.contentWebhooks)
      .where(
        and(
          eq(schema.contentWebhooks.scopeType, "database"),
          inArray(schema.contentWebhooks.scopeId, idGroup),
        ),
      )
      .limit(1);
    if (webhooks.length > 0) {
      blocked(
        "Collections with webhooks can't move to another workspace. Remove the webhooks first.",
        "COLLECTION_HAS_WEBHOOKS",
      );
    }
  }
  // Relations out of a moving collection name their collection in its options;
  // relations into one are found by its id in theirs, then parsed to confirm.
  const relations: Array<{ databaseId: string | null; optionsJson: string }> =
    [];
  for (const idGroup of groups(collectionIds)) {
    relations.push(
      ...(await db
        .select({
          databaseId: schema.documentPropertyDefinitions.databaseId,
          optionsJson: schema.documentPropertyDefinitions.optionsJson,
        })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.type, "relation"),
            or(
              inArray(schema.documentPropertyDefinitions.databaseId, idGroup),
              ...idGroup.map((id) =>
                like(schema.documentPropertyDefinitions.optionsJson, `%${id}%`),
              ),
            ),
          ),
        )),
    );
  }
  for (const relation of relations) {
    const target = parsePropertyOptions(relation.optionsJson).relation
      ?.databaseId;
    if (!target) continue;
    const fromMoving =
      relation.databaseId !== null && collectionIdSet.has(relation.databaseId);
    if (fromMoving !== collectionIdSet.has(target)) {
      blocked(
        "This collection is related to a collection that isn't moving, so it can't move to another workspace yet.",
        "COLLECTION_RELATION_OUTSIDE",
      );
    }
  }
  return collections;
}

/**
 * Locks the moving collections in id order, as a row write locks its
 * collection, and refuses when one is gone. Take it after the owners' page
 * trees and before any membership or page lock.
 */
export async function lockCollectionsForSpaceMove(
  tx: ContentDb,
  collectionIds: string[],
) {
  for (const id of sortRowIds(collectionIds)) {
    const locked = await tx
      .update(schema.contentDatabases)
      .set({ updatedAt: sql`${schema.contentDatabases.updatedAt}` })
      .where(eq(schema.contentDatabases.id, id))
      .returning({ id: schema.contentDatabases.id });
    if (locked.length !== 1) {
      blocked(
        "This page changed while it was being moved. Try again.",
        "PAGE_SUBTREE_CHANGED",
      );
    }
  }
}

/**
 * Gives the moving collections, their rows, Properties and key claims to the
 * destination space and its new owner, in place: every id stays the same.
 */
export async function moveCollectionsToSpace(args: {
  tx: ContentDb;
  collectionIds: string[];
  spaceId: string;
  ownerEmail: string;
  orgId: string | null;
  now: string;
}) {
  const { tx, spaceId, ownerEmail, orgId, now } = args;
  for (const idGroup of groups(args.collectionIds)) {
    await tx
      .update(schema.contentDatabases)
      .set({ spaceId, ownerEmail, orgId, updatedAt: now })
      .where(inArray(schema.contentDatabases.id, idGroup));
    for (const table of [
      schema.contentDatabaseItems,
      schema.contentDatabaseItemKeyClaims,
      schema.documentPropertyDefinitions,
    ]) {
      await tx
        .update(table)
        .set({ ownerEmail, orgId })
        .where(inArray(table.databaseId, idGroup));
    }
  }
}
