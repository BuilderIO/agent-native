import { ActionContractError } from "@agent-native/core";
import { eq, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

type Db = ReturnType<typeof getDb>;

export function documentTrashedError() {
  return new ActionContractError("This page is in Trash.", {
    errorCode: "DOCUMENT_TRASHED",
    statusCode: 409,
  });
}

// Acquire database and membership locks first. Individual updates impose the
// same document lock order on PostgreSQL and SQLite, unlike an IN predicate.
export async function lockDocumentsForLifecycle(db: Db, documentIds: string[]) {
  const documents = [];
  for (const id of [...new Set(documentIds)].sort()) {
    const [document] = await db
      .update(schema.documents)
      .set({ updatedAt: sql`${schema.documents.updatedAt}` })
      .where(eq(schema.documents.id, id))
      .returning();
    if (!document) {
      throw new ActionContractError("Document not found.", {
        errorCode: "DOCUMENT_NOT_FOUND",
        statusCode: 404,
      });
    }
    documents.push(document);
  }
  return documents;
}

export async function lockLiveDocuments(db: Db, documentIds: string[]) {
  const documents = await lockDocumentsForLifecycle(db, documentIds);
  if (documents.some((document) => document.trashedAt !== null)) {
    throw documentTrashedError();
  }
  return documents;
}
