import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

export const CONTENT_TRASH_PROTECTION_GROUP_BUDGET = 200;

export type TrashGroupProtection =
  | "clear"
  | "protected"
  | "over-budget"
  | "out-of-time";

export async function inspectTrashGroupProtection(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  limits: { maxGroups: number; deadlineAt: number },
): Promise<TrashGroupProtection> {
  const visited = new Set(documentIds);
  const groups = [documentIds];
  for (const ids of groups) {
    if (Date.now() > limits.deadlineAt) return "out-of-time";
    // guard:allow-unscoped — Empty Trash's blockers, checked for the system across owners before anything is planned.
    const sourceBacked = firstRow(
      await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.id, ids),
            isNotNull(schema.documents.sourceMode),
          ),
        )
        .limit(1),
    );
    if (sourceBacked) return "protected";
    // guard:allow-unscoped — the collections these Pages host; Empty Trash blocks the same ones.
    const databases = await db
      .select({
        id: schema.contentDatabases.id,
        systemRole: schema.contentDatabases.systemRole,
      })
      .from(schema.contentDatabases)
      .where(inArray(schema.contentDatabases.documentId, ids));
    if (databases.some((database) => database.systemRole)) return "protected";
    const databaseIds = databases.map(({ id }) => id);
    if (databaseIds.length > 0) {
      // guard:allow-unscoped — a source-connected collection blocks its whole Trash group, whoever connected it.
      const source = firstRow(
        await db
          .select({ id: schema.contentDatabaseSources.id })
          .from(schema.contentDatabaseSources)
          .where(inArray(schema.contentDatabaseSources.databaseId, databaseIds))
          .limit(1),
      );
      if (source) return "protected";
    }
    // guard:allow-unscoped — Pages a blocker reaches this group through: its sub-pages and its collections' members.
    const dependents = await db
      .select({
        id: schema.documents.id,
        trashRootId: schema.documents.trashRootId,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(
        or(
          inArray(schema.documents.parentId, ids),
          databaseIds.length > 0
            ? inArray(
                schema.documents.id,
                db
                  .select({ id: schema.contentDatabaseItems.documentId })
                  .from(schema.contentDatabaseItems)
                  .where(
                    inArray(
                      schema.contentDatabaseItems.databaseId,
                      databaseIds,
                    ),
                  ),
              )
            : undefined,
        ),
      );
    const outside = dependents.filter(({ id }) => !visited.has(id));
    const liveIds = outside
      .filter((dependent) => !dependent.trashedAt)
      .map(({ id }) => id);
    if (liveIds.length > 0) {
      // guard:allow-unscoped — a live Page whose collection sits in legacy database Trash; Empty Trash blocks the group above it.
      const legacy = firstRow(
        await db
          .select({ id: schema.contentDatabases.id })
          .from(schema.contentDatabases)
          .where(
            and(
              inArray(schema.contentDatabases.documentId, liveIds),
              isNotNull(schema.contentDatabases.deletedAt),
            ),
          )
          .limit(1),
      );
      if (legacy) return "protected";
    }
    const groupRoots = new Set(
      outside
        .filter((dependent) => dependent.trashedAt)
        .map((dependent) => dependent.trashRootId ?? dependent.id),
    );
    for (const rootId of groupRoots) {
      if (Date.now() > limits.deadlineAt) return "out-of-time";
      // guard:allow-unscoped — the rest of a dependent Page's Trash group, checked with the same blockers.
      const group = await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            or(
              eq(schema.documents.trashRootId, rootId),
              eq(schema.documents.id, rootId),
            ),
            isNotNull(schema.documents.trashedAt),
          ),
        );
      const groupIds = group
        .map(({ id }) => id)
        .filter((id) => !visited.has(id));
      if (groupIds.length === 0) continue;
      if (groups.length >= limits.maxGroups) return "over-budget";
      for (const id of groupIds) visited.add(id);
      groups.push(groupIds);
    }
  }
  return "clear";
}
