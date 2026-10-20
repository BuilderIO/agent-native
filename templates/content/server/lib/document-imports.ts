import {
  deletePrivateBlob,
  isPrivateBlobError,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { inArray } from "drizzle-orm";

import { type getDb, schema } from "../db/index.js";

/**
 * Removes import records with their pages, and the original files they kept.
 * A provider outage stops the deletion so it can be retried; a blob that no
 * provider here can ever remove is logged rather than blocking deletion of
 * the page forever.
 */
export async function deleteDocumentImports(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
): Promise<void> {
  if (documentIds.length === 0) return;
  const rows = await db
    .select({
      documentId: schema.documentImports.documentId,
      originalBlob: schema.documentImports.originalBlob,
    })
    .from(schema.documentImports)
    .where(inArray(schema.documentImports.documentId, documentIds));
  for (const row of rows) {
    const handle = JSON.parse(row.originalBlob) as PrivateBlobHandle;
    try {
      const result = await deletePrivateBlob(handle);
      if (!result.deleted) {
        console.error(
          `[content] Original import file ${handle.id} for page ${row.documentId} was not deleted: ${result.reason ?? "the provider kept it"}`,
        );
      }
    } catch (error) {
      if (!isPrivateBlobError(error) || error.kind === "unavailable") {
        throw error;
      }
      if (error.kind !== "not_found" && error.kind !== "gone") {
        console.error(
          `[content] Original import file ${handle.id} for page ${row.documentId} cannot be deleted (${error.kind}): ${error.message}`,
        );
      }
    }
  }
  await db
    .delete(schema.documentImports)
    .where(inArray(schema.documentImports.documentId, documentIds));
}
