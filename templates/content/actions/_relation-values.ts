import { ActionContractError } from "@agent-native/core/action";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, exists, inArray, isNull, or } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import type {
  DocumentProperty,
  DocumentPropertyRelationTarget,
} from "../shared/api.js";
import {
  MAX_RELATION_TARGETS,
  normalizeRelationIds,
  parsePropertyOptions,
} from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";

// Relation values are stored as a JSON array of row document IDs. Every read
// and write of them goes through this module so a canonical relationship edge
// store (docs/product/capabilities/content.relationship.edge.md) can replace
// the array later without touching callers.

type Db = any;
type ContentDatabaseRow = typeof schema.contentDatabases.$inferSelect;

function relationError(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ActionContractError(message, {
    errorCode,
    statusCode: 400,
    details,
  });
}

async function liveDatabase(
  db: Db,
  databaseId: string,
): Promise<ContentDatabaseRow | null> {
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.id, databaseId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    )
    .limit(1);
  return database ?? null;
}

async function canReadDatabase(database: ContentDatabaseRow) {
  return !!(await resolveAccess("document", database.documentId));
}

/**
 * Check that `targetDatabaseId` may be the target of a relation property on
 * `sourceDatabase`: it must be a live, ordinary database the caller can read,
 * in the same space. Linking a database to itself is allowed.
 */
export async function assertRelationTargetDatabase(
  db: Db,
  {
    sourceDatabase,
    targetDatabaseId,
  }: {
    sourceDatabase: Pick<ContentDatabaseRow, "id" | "spaceId" | "orgId">;
    targetDatabaseId: string | null | undefined;
  },
): Promise<ContentDatabaseRow> {
  if (!targetDatabaseId) {
    relationError("RELATION_TARGET_MISSING", "Choose a related database first");
  }
  const target = await liveDatabase(db, targetDatabaseId);
  if (!target || target.systemRole || !(await canReadDatabase(target))) {
    relationError(
      "INVALID_RELATION_TARGET_DATABASE",
      "The related database was not found",
    );
  }
  if (
    (target.spaceId ?? null) !== (sourceDatabase.spaceId ?? null) ||
    (target.orgId ?? null) !== (sourceDatabase.orgId ?? null)
  ) {
    relationError(
      "RELATION_TARGET_OTHER_SPACE",
      "A relation can only link to a database in the same space",
    );
  }
  return target;
}

/**
 * Resolve linked row IDs to titles the current viewer may see. A row is
 * visible when the viewer can read the row itself, or can read the target
 * database and the row is a live member of it. Unknown, trashed and
 * restricted rows are simply absent from the result.
 */
export async function resolveRelationTargets(
  db: Db,
  {
    targetDatabaseId,
    documentIds,
  }: { targetDatabaseId: string; documentIds: string[] },
): Promise<Map<string, DocumentPropertyRelationTarget>> {
  const result = new Map<string, DocumentPropertyRelationTarget>();
  const ids = normalizeRelationIds(documentIds);
  if (ids.length === 0) return result;
  const target = await liveDatabase(db, targetDatabaseId);
  if (!target || target.systemRole) return result;
  const targetReadable = await canReadDatabase(target);
  const membership = exists(
    db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, target.id),
          eq(schema.contentDatabaseItems.documentId, schema.documents.id),
        ),
      ),
  );
  const visible = accessFilter(schema.documents, schema.documentShares);

  for (const chunk of chunks(ids, 200)) {
    const rows = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        icon: schema.documents.icon,
      })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, chunk),
          isNull(schema.documents.trashedAt),
          targetReadable ? or(visible, membership) : visible,
        ),
      );
    for (const row of rows) {
      result.set(row.id, {
        documentId: row.id,
        title: row.title || "Untitled",
        icon: row.icon ?? null,
        databaseId: targetReadable ? target.id : null,
        databaseDocumentId: targetReadable ? target.documentId : null,
      });
    }
  }
  return result;
}

/** The relation target database configured on a property definition. */
export function relationTargetDatabaseId(definition: {
  optionsJson?: string | null;
}): string | null {
  return (
    parsePropertyOptions(definition.optionsJson).relation?.databaseId ?? null
  );
}

/**
 * Validate and normalize a relation value before it is stored. IDs that were
 * already stored are kept without re-checking, so an editor who cannot see
 * some links does not silently drop them. Newly added IDs must be live rows of
 * the target database, which the caller must be able to read.
 */
export async function validateRelationWrite(
  db: Db,
  {
    definition,
    nextValue,
    previousValue,
  }: {
    definition: { optionsJson?: string | null };
    nextValue: unknown;
    previousValue: unknown;
  },
): Promise<string[] | null> {
  const targetDatabaseId = relationTargetDatabaseId(definition);
  if (!targetDatabaseId) {
    relationError("RELATION_TARGET_MISSING", "Choose a related database first");
  }
  const ids = normalizeRelationIds(nextValue);
  if (ids.length === 0) return null;
  if (ids.length > MAX_RELATION_TARGETS) {
    relationError(
      "RELATION_LIMIT_EXCEEDED",
      `A relation can link to at most ${MAX_RELATION_TARGETS} pages`,
    );
  }
  const previous = new Set(normalizeRelationIds(previousValue));
  const added = ids.filter((id) => !previous.has(id));
  if (added.length === 0) return ids;

  const target = await liveDatabase(db, targetDatabaseId);
  if (
    !target ||
    target.systemRole ||
    !(await resolveAccess("document", target.documentId))
  ) {
    relationError(
      "INVALID_RELATION_TARGET",
      "The related database is not available",
      { invalidIds: added },
    );
  }
  const found = new Set<string>();
  for (const chunk of chunks(added, 200)) {
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .innerJoin(
        schema.contentDatabaseItems,
        eq(schema.contentDatabaseItems.documentId, schema.documents.id),
      )
      .where(
        and(
          inArray(schema.documents.id, chunk),
          eq(schema.contentDatabaseItems.databaseId, target.id),
          isNull(schema.documents.trashedAt),
        ),
      );
    for (const row of rows) found.add(row.id);
  }
  const invalidIds = added.filter((id) => !found.has(id));
  if (invalidIds.length > 0) {
    relationError(
      "INVALID_RELATION_TARGET",
      "Some linked pages are not rows of the related database",
      { invalidIds },
    );
  }
  return ids;
}

/**
 * Attach `relationTargets` to every relation property in `propertyLists`
 * (one list per row). Linked rows are resolved with one lookup per target
 * database across all rows, so a table view does not query per cell.
 */
export async function withRelationTargets(
  db: Db,
  propertyLists: DocumentProperty[][],
): Promise<DocumentProperty[][]> {
  const idsByTarget = new Map<string, Set<string>>();
  for (const properties of propertyLists) {
    for (const property of properties) {
      if (property.definition.type !== "relation") continue;
      const targetId = property.definition.options.relation?.databaseId;
      if (!targetId) continue;
      const ids = normalizeRelationIds(property.value);
      if (ids.length === 0) continue;
      let set = idsByTarget.get(targetId);
      if (!set) idsByTarget.set(targetId, (set = new Set()));
      for (const id of ids) set.add(id);
    }
  }
  if (idsByTarget.size === 0) return propertyLists;

  const resolvedByTarget = new Map<
    string,
    Map<string, DocumentPropertyRelationTarget>
  >();
  for (const [targetDatabaseId, ids] of idsByTarget) {
    resolvedByTarget.set(
      targetDatabaseId,
      await resolveRelationTargets(db, {
        targetDatabaseId,
        documentIds: [...ids],
      }),
    );
  }

  return propertyLists.map((properties) =>
    properties.map((property) => {
      if (property.definition.type !== "relation") return property;
      const targetId = property.definition.options.relation?.databaseId;
      const resolved = targetId ? resolvedByTarget.get(targetId) : undefined;
      return {
        ...property,
        relationTargets: normalizeRelationIds(property.value).flatMap((id) => {
          const target = resolved?.get(id);
          return target ? [target] : [];
        }),
      };
    }),
  );
}
