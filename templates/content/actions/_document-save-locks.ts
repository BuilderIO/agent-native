import type { getDb } from "../server/db/index.js";
import {
  lockDocumentBodyDatabases,
  lockDocumentMetadataDatabase,
} from "../server/lib/document-metadata-updated-at.js";
import { lockPrimaryBlocksFields } from "./_blocks-field-identity.js";
import { lockDocumentRows } from "./_row-lock-order.js";

/**
 * Locks a page for a save in Content's row-lock order (`_row-lock-order.ts`):
 * the collection the page backs and, for a body write, the inline collections
 * it owns, in one id-ordered pass; then its memberships; then the page row.
 * Taking the inline collections in a separate pass would hold one out of
 * order against the page's own collection.
 *
 * Returns the id of the collection the page backs, or null, and every
 * collection it locked. Pass `lockedDatabaseIds` to the inline-collection
 * reconcile, which refuses to touch a collection created after this ran.
 */
export async function lockDocumentForSave(
  db: ReturnType<typeof getDb>,
  args: { documentId: string; ownerEmail: string; body: boolean },
): Promise<{
  databaseId: string | null;
  lockedDatabaseIds: ReadonlySet<string>;
}> {
  const scope = {
    db,
    documentId: args.documentId,
    ownerEmail: args.ownerEmail,
  };
  const locked = args.body
    ? await lockDocumentBodyDatabases(scope)
    : await lockDocumentMetadataDatabase(scope).then((databaseId) => ({
        databaseId,
        lockedDatabaseIds: new Set(databaseId ? [databaseId] : []),
      }));
  // The body write re-locks these memberships with any added since.
  if (args.body) await lockPrimaryBlocksFields(db, args.documentId);
  await lockDocumentRows(db, [args.documentId]);
  return locked;
}
