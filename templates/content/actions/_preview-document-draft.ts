import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export async function readPreviewDocumentDraft(
  ownerEmail: string,
  orgId: string,
  documentId: string,
) {
  const [draft] = await getDb()
    .select({
      documentId: schema.documentPreviewDrafts.documentId,
      title: schema.documentPreviewDrafts.title,
      content: schema.documentPreviewDrafts.content,
      baseDocumentUpdatedAt: schema.documentPreviewDrafts.baseDocumentUpdatedAt,
      loadedContentWasEmpty: schema.documentPreviewDrafts.loadedContentWasEmpty,
      deferredReason: schema.documentPreviewDrafts.deferredReason,
      version: schema.documentPreviewDrafts.version,
      updatedAt: schema.documentPreviewDrafts.updatedAt,
    })
    .from(schema.documentPreviewDrafts)
    .where(
      and(
        eq(schema.documentPreviewDrafts.ownerEmail, ownerEmail),
        eq(schema.documentPreviewDrafts.orgId, orgId),
        eq(schema.documentPreviewDrafts.documentId, documentId),
      ),
    )
    .limit(1);
  return draft ?? null;
}
