import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export async function readPreviewDocumentDraft(
  ownerEmail: string,
  orgId: string,
  documentId: string,
  db: any = getDb(),
) {
  const [draft] = await db
    .select({
      documentId: schema.documentPreviewDrafts.documentId,
      title: schema.documentPreviewDrafts.title,
      content: schema.documentPreviewDrafts.content,
      baseDocumentUpdatedAt: schema.documentPreviewDrafts.baseDocumentUpdatedAt,
      loadedContentWasEmpty: schema.documentPreviewDrafts.loadedContentWasEmpty,
      deferredReason: schema.documentPreviewDrafts.deferredReason,
      editorSessionId: schema.documentPreviewDrafts.editorSessionId,
      editGeneration: schema.documentPreviewDrafts.editGeneration,
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
