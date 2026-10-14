import { ActionContractError } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";

type ContentDb = ReturnType<typeof getDb>;
export type PageSubtreeDocument = typeof schema.documents.$inferSelect;

export const PAGE_SUBTREE_LIMIT = 500;

function groups<T>(values: T[], size = 90): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function loadPageSubtree(
  db: ContentDb,
  root: PageSubtreeDocument,
  {
    includeTrashed,
    requireComplete = true,
  }: { includeTrashed: boolean; requireComplete?: boolean },
): Promise<PageSubtreeDocument[]> {
  const documents: PageSubtreeDocument[] = [root];
  const seen = new Set([root.id]);
  let frontier = [root.id];
  const userEmail = getRequestUserEmail();
  const memberships = userEmail
    ? await listContentOrganizationMemberships(userEmail)
    : [];
  const orgIds = new Set([
    ...memberships.map((membership) => membership.orgId),
    ...(getRequestOrgId() ? [getRequestOrgId()!] : []),
  ]);
  const accessContexts = [
    { userEmail: userEmail ?? undefined },
    ...[...orgIds].map((orgId) => ({
      userEmail: userEmail ?? undefined,
      orgId,
    })),
  ];
  while (frontier.length > 0) {
    const next: PageSubtreeDocument[] = [];
    const nextFrontier: string[] = [];
    for (const idGroup of groups(frontier)) {
      const relationshipFilter = includeTrashed
        ? or(
            inArray(schema.documents.parentId, idGroup),
            inArray(schema.documents.trashParentId, idGroup),
          )
        : and(
            inArray(schema.documents.parentId, idGroup),
            isNull(schema.documents.trashedAt),
          );
      // guard:allow-unscoped — read descendant ids only to reject an incomplete move or duplicate; document bodies are fetched below only after accessFilter succeeds.
      const childIds = await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(relationshipFilter);
      if (childIds.length === 0) continue;

      const children: PageSubtreeDocument[] = await db
        .select()
        .from(schema.documents)
        .where(
          and(
            relationshipFilter,
            inArray(
              schema.documents.id,
              childIds.map((child) => child.id),
            ),
            or(
              ...accessContexts.map((context) =>
                accessFilter(
                  schema.documents,
                  schema.documentShares,
                  context,
                  "viewer",
                  { includePublic: true },
                ),
              ),
            ),
          ),
        );
      if (requireComplete && children.length !== childIds.length) {
        throw new ActionContractError(
          "This page has sub-pages you can't open, so it can't be moved or duplicated completely.",
          { errorCode: "PAGE_SUBTREE_INACCESSIBLE", statusCode: 403 },
        );
      }
      const accessibleChildren = new Map(
        children.map((child) => [child.id, child]),
      );
      for (const { id } of childIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        nextFrontier.push(id);
        const child = accessibleChildren.get(id);
        if (child) next.push(child);
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
    frontier = nextFrontier;
  }
  return documents;
}

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
