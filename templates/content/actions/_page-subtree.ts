import { ActionContractError } from "@agent-native/core/action";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

type ContentDb = ReturnType<typeof getDb>;
export type PageSubtreeDocument = typeof schema.documents.$inferSelect;

/** Upper bound on how many Pages one move or duplicate may touch. */
export const PAGE_SUBTREE_LIMIT = 500;

function groups<T>(values: T[], size = 90): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/**
 * A Page and every Page beneath it, root first and each level in sibling
 * order. Unlike the owner-scoped tree walkers, this follows `parentId`
 * regardless of owner, and trashed descendants follow the Page they would be
 * restored under, so nothing is left behind in the old place.
 */
export async function loadPageSubtree(
  db: ContentDb,
  root: PageSubtreeDocument,
  { includeTrashed }: { includeTrashed: boolean },
): Promise<PageSubtreeDocument[]> {
  const documents: PageSubtreeDocument[] = [root];
  const seen = new Set([root.id]);
  let frontier = [root.id];
  while (frontier.length > 0) {
    const next: PageSubtreeDocument[] = [];
    for (const idGroup of groups(frontier)) {
      const children: PageSubtreeDocument[] = await db
        .select()
        .from(schema.documents)
        .where(
          includeTrashed
            ? or(
                inArray(schema.documents.parentId, idGroup),
                inArray(schema.documents.trashParentId, idGroup),
              )
            : and(
                inArray(schema.documents.parentId, idGroup),
                isNull(schema.documents.trashedAt),
              ),
        );
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        next.push(child);
      }
    }
    next.sort(
      (left, right) =>
        left.position - right.position ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    );
    documents.push(...next);
    if (documents.length > PAGE_SUBTREE_LIMIT) {
      throw new ActionContractError(
        `This page has more than ${PAGE_SUBTREE_LIMIT} sub-pages, which is too many to move or duplicate at once.`,
        { errorCode: "PAGE_SUBTREE_TOO_LARGE", statusCode: 409 },
      );
    }
    frontier = next.map((document) => document.id);
  }
  return documents;
}

/** Collections whose backing document sits in (or is owned by) the subtree. */
export async function subtreeCollectionDocumentIds(
  db: ContentDb,
  documentIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const idGroup of groups(documentIds)) {
    const rows: Array<{ documentId: string }> = await db
      .select({ documentId: schema.contentDatabases.documentId })
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
    for (const row of rows) ids.add(row.documentId);
  }
  return ids;
}

function blocked(message: string, errorCode: string): never {
  throw new ActionContractError(message, { errorCode, statusCode: 409 });
}

/**
 * Refuse subtrees whose data is tied to their current space or owner in ways
 * a move cannot carry yet: Collections (rows, properties, views, sources),
 * rows of a Collection, local-folder files, and Notion or Builder links.
 */
export async function assertSubtreeCanChangeSpace(
  db: ContentDb,
  documents: PageSubtreeDocument[],
) {
  const ids = documents.map((document) => document.id);
  if (
    documents.some(
      (document) =>
        document.sourceMode || document.sourceKind || document.sourcePath,
    )
  ) {
    blocked(
      "Pages synced from a local folder can't move to another workspace.",
      "PAGE_SOURCE_OWNED",
    );
  }
  if ((await subtreeCollectionDocumentIds(db, ids)).size > 0) {
    blocked(
      "Pages that contain collections can't move to another workspace yet.",
      "PAGE_CONTAINS_COLLECTION",
    );
  }
  for (const idGroup of groups(ids)) {
    const [rowMembership] = await db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
      )
      .where(
        and(
          inArray(schema.contentDatabaseItems.documentId, idGroup),
          isNull(schema.contentDatabases.systemRole),
        ),
      )
      .limit(1);
    if (rowMembership) {
      blocked(
        "Collection rows can't move to another workspace yet.",
        "PAGE_IS_COLLECTION_ROW",
      );
    }
    const [syncLink] = await db
      .select({ id: schema.documentSyncLinks.documentId })
      .from(schema.documentSyncLinks)
      .where(inArray(schema.documentSyncLinks.documentId, idGroup))
      .limit(1);
    if (syncLink) {
      blocked(
        "Pages linked to Notion can't move to another workspace. Unlink them first.",
        "PAGE_NOTION_LINKED",
      );
    }
    const [sidecar] = await db
      .select({ id: schema.builderDocSidecars.id })
      .from(schema.builderDocSidecars)
      .where(inArray(schema.builderDocSidecars.documentId, idGroup))
      .limit(1);
    if (sidecar) {
      blocked(
        "Pages connected to Builder can't move to another workspace.",
        "PAGE_BUILDER_LINKED",
      );
    }
  }
}
