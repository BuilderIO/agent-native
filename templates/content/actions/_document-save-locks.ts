import { eq } from "drizzle-orm";

import { schema, type getDb } from "../server/db/index.js";
import {
  lockDocumentBodyDatabases,
  lockDocumentMetadataDatabase,
} from "../server/lib/document-metadata-updated-at.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import { lockDocumentRows } from "./_row-lock-order.js";

/**
 * Locks a page for a save in Content's row-lock order (`_row-lock-order.ts`):
 * the collection the page backs and, for a body write, the inline collections
 * it owns, in one id-ordered pass; then its memberships; then the page row.
 * Taking the inline collections in a separate pass would hold one out of
 * order against the page's own collection.
 *
 * Returns the id of the collection the page backs, or null, and every
 * collection and membership it locked. Pass `lockedDatabaseIds` to the
 * inline-collection reconcile and `lockedMembershipIds` to
 * `lockPrimaryBlocksFields` as `heldMembershipIds`: both refuse a row added
 * after this ran rather than lock it after the page.
 */
export async function lockDocumentForSave(
  db: ReturnType<typeof getDb>,
  args: { documentId: string; ownerEmail: string; body: boolean },
): Promise<{
  databaseId: string | null;
  lockedDatabaseIds: ReadonlySet<string>;
  lockedMembershipIds: ReadonlySet<string>;
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
  const membershipIds = args.body
    ? (
        await db
          .select({ id: schema.contentDatabaseItems.id })
          .from(schema.contentDatabaseItems)
          .where(eq(schema.contentDatabaseItems.documentId, args.documentId))
      ).map((membership) => membership.id)
    : [];
  await lockDatabaseMemberships(db, membershipIds);
  await lockDocumentRows(db, [args.documentId]);
  return { ...locked, lockedMembershipIds: new Set(membershipIds) };
}
