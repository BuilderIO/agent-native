import { assertAccess, roleSatisfies } from "@agent-native/core/sharing";
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

// The answer page recovery waits on, for get-preview-document-draft and for
// the page read that carries it, so both decide who can recover the same way.
export async function previewDocumentDraftAnswer(
  userEmail: string,
  orgId: string,
  documentId: string,
) {
  // Page opens read this alongside the document, before they know whether
  // the reader can edit, so a reader without edit access is an answer here
  // rather than a 403.
  const access = await assertAccess(
    "document",
    documentId,
    "viewer",
    undefined,
    {
      skipResourceBody: true,
    },
  );
  if (!roleSatisfies(access.role, "editor")) {
    return { editable: false, draft: null };
  }
  return {
    editable: true,
    draft: await readPreviewDocumentDraft(userEmail, orgId, documentId),
  };
}
