import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { ContentDatabaseItemComments } from "../shared/api.js";

/**
 * Open Comment threads on each of these Pages, counting only Pages the
 * current viewer can read. A Page they can't open contributes nothing, so the
 * count never reveals its threads. Pages with no open threads are absent.
 */
export async function readOpenCommentSummaries(
  documentIds: readonly string[],
): Promise<Map<string, ContentDatabaseItemComments>> {
  const summaries = new Map<string, ContentDatabaseItemComments>();
  if (documentIds.length === 0) return summaries;
  const roots = await getDb()
    .select({
      documentId: schema.documentComments.documentId,
      threadId: schema.documentComments.threadId,
      propertyId: schema.documentComments.propertyId,
    })
    .from(schema.documentComments)
    .innerJoin(
      schema.documents,
      and(
        eq(schema.documents.id, schema.documentComments.documentId),
        eq(schema.documents.ownerEmail, schema.documentComments.ownerEmail),
      ),
    )
    .where(
      and(
        inArray(schema.documentComments.documentId, [...new Set(documentIds)]),
        isNull(schema.documentComments.parentId),
        eq(schema.documentComments.resolved, 0),
        isNull(schema.documents.trashedAt),
        accessFilter(
          schema.documents,
          schema.documentShares,
          undefined,
          "viewer",
          { includePublic: true },
        ),
      ),
    )
    .orderBy(
      asc(schema.documentComments.createdAt),
      asc(schema.documentComments.id),
    );
  for (const root of roots) {
    const summary = summaries.get(root.documentId) ?? {
      open: 0,
      properties: {},
    };
    summary.open += 1;
    if (root.propertyId) {
      const property = summary.properties[root.propertyId];
      summary.properties[root.propertyId] = {
        open: (property?.open ?? 0) + 1,
        latestThreadId: root.threadId,
      };
    }
    summaries.set(root.documentId, summary);
  }
  return summaries;
}
