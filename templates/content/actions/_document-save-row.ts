import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { ClaimedEditorSave } from "../shared/editor-save-state.js";
import {
  documentContentHash,
  parseDocumentRevisionToken,
} from "./_document-edit-mutation.js";

export type DocumentSaveRow = {
  bodyRevision: number;
  content: string;
  title: string;
  updatedAt: string;
};

export async function readDocumentSaveRow(
  documentId: string,
): Promise<DocumentSaveRow | null> {
  // guard:allow-unscoped — every flush caller resolves document access first; this read only compares the saved revision and title with what an open editor reports, and returns nothing to the caller.
  const [row] = await getDb()
    .select({
      bodyRevision: schema.documents.bodyRevision,
      content: schema.documents.content,
      title: schema.documents.title,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  return row ?? null;
}

// True only when SQL is at or past the save an editor reports: the same body
// revision with the same text, or a later one, and the same title or a title
// another writer saved after it. Anything else, including a claim SQL has not
// reached yet, means the editor must be asked to save.
export function editorSaveIsInSql(
  row: DocumentSaveRow,
  claim: ClaimedEditorSave,
): boolean {
  const claimed = parseDocumentRevisionToken(claim.revision);
  if (!claimed || row.bodyRevision < claimed.revision) return false;
  if (
    row.bodyRevision === claimed.revision &&
    documentContentHash(row.content) !== claimed.contentHash
  ) {
    return false;
  }
  if (row.title === claim.title) return true;
  if (claim.titleUpdatedAt === null) return false;
  const sqlUpdatedAt = Date.parse(row.updatedAt);
  const claimUpdatedAt = Date.parse(claim.titleUpdatedAt);
  return (
    Number.isFinite(sqlUpdatedAt) &&
    Number.isFinite(claimUpdatedAt) &&
    sqlUpdatedAt > claimUpdatedAt
  );
}
