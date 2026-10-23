import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  documentContentHash,
  parseDocumentRevisionToken,
} from "../server/lib/document-revision.js";
import type { ClaimedEditorSave } from "../shared/editor-save-state.js";

export type DocumentSaveRow = {
  bodyRevision: number;
  content: string;
  title: string;
  updatedAt: string;
};

export async function readDocumentSaveRow(
  documentId: string,
): Promise<DocumentSaveRow | null> {
  // guard:allow-unscoped — every barrier caller authorizes the document first and rechecks access before returning the captured content.
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
  contentHash = documentContentHash(row.content),
): boolean {
  const claimed = parseDocumentRevisionToken(claim.revision);
  if (!claimed || row.bodyRevision < claimed.revision) return false;
  if (
    row.bodyRevision === claimed.revision &&
    contentHash !== claimed.contentHash
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

export type DocumentFlushSnapshot =
  | (DocumentSaveRow & { kind: "document"; contentHash: string })
  | {
      kind: "property";
      propertyId: string;
      content: string;
      title: string;
      updatedAt: string;
      contentHash: string;
    };

export function createDocumentFlushCapture() {
  const bodies = new Map<number, { content: string; contentHash: string }>();
  return async (
    documentId: string,
    propertyId?: string,
  ): Promise<DocumentFlushSnapshot | null> => {
    if (propertyId) {
      // guard:allow-unscoped — the caller authorizes the exact document/property before the barrier and rechecks access before returning its captured value.
      const [row] = await getDb()
        .select({
          title: schema.documents.title,
          updatedAt: schema.documents.updatedAt,
          content: schema.documentBlockFieldContents.content,
        })
        .from(schema.documents)
        .leftJoin(
          schema.documentBlockFieldContents,
          and(
            eq(
              schema.documentBlockFieldContents.documentId,
              schema.documents.id,
            ),
            eq(schema.documentBlockFieldContents.propertyId, propertyId),
          ),
        )
        .where(eq(schema.documents.id, documentId))
        .limit(1);
      if (!row) return null;
      const content = row.content ?? "";
      return {
        ...row,
        content,
        kind: "property",
        propertyId,
        contentHash: documentContentHash(content),
      };
    }

    // guard:allow-unscoped — document access is established by every barrier caller; this metadata read avoids reloading a previously captured immutable body revision.
    const [metadata] = await getDb()
      .select({
        bodyRevision: schema.documents.bodyRevision,
        title: schema.documents.title,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .limit(1);
    if (!metadata) return null;
    const cached = bodies.get(metadata.bodyRevision);
    if (cached) return { ...metadata, ...cached, kind: "document" };
    const row = await readDocumentSaveRow(documentId);
    if (!row) return null;
    const body = {
      content: row.content,
      contentHash: documentContentHash(row.content),
    };
    bodies.set(row.bodyRevision, body);
    return { ...row, kind: "document", contentHash: body.contentHash };
  };
}
