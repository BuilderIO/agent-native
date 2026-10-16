import type { getDb } from "../server/db/index.js";
import { lockDocumentMetadataDatabase } from "../server/lib/document-metadata-updated-at.js";
import { lockPrimaryBlocksFields } from "./_blocks-field-identity.js";
import { lockDocumentRows } from "./_row-lock-order.js";

/**
 * Locks a page for a save in Content's row-lock order (`_row-lock-order.ts`):
 * the collection the page backs and, for a body write, the inline collections
 * it owns, in one id-ordered pass; then its memberships; then the page row.
 * Taking the inline collections in a separate pass would hold one out of
 * order against the page's own collection.
 *
 * Returns the id of the collection the page backs, or null.
 */
export async function lockDocumentForSave(
  db: ReturnType<typeof getDb>,
  args: { documentId: string; ownerEmail: string; body: boolean },
): Promise<string | null> {
  const lockedDatabaseId = await lockDocumentMetadataDatabase({
    db,
    documentId: args.documentId,
    ownerEmail: args.ownerEmail,
    includeInlineDatabases: args.body,
  });
  // The body write re-locks these memberships with any added since.
  if (args.body) await lockPrimaryBlocksFields(db, args.documentId);
  await lockDocumentRows(db, [args.documentId]);
  return lockedDatabaseId;
}
