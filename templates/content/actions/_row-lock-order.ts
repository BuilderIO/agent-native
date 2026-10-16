import { ActionContractError } from "@agent-native/core/action";
import { eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";

/**
 * Content locks rows in one order: collections, then memberships, then pages,
 * each by id in byte order. Two transactions that both follow it never wait on
 * each other in a cycle, so PostgreSQL never aborts one with 40P01. A write
 * that locks a row implicitly (an UPDATE) counts: lock the row in order first.
 *
 * Byte order, not the database collation: JavaScript sorts and
 * `COLLATE "C"` agree on it, so ids sorted here lock in the same sequence as
 * ids sorted by PostgreSQL.
 */
export function compareRowIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export function sortRowIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compareRowIds);
}

/**
 * Serializes reparents within one owner's page tree. A move checks that its new
 * parent is not under the moved page, but two moves whose row locks don't
 * overlap (P under S while R under Q, where Q is under P and S under R) would
 * each pass that check before the other commits, and together make a cycle.
 * Take it before any row lock; nothing that holds a row lock waits on it.
 */
export async function lockOwnerPageTree(
  db: ReturnType<typeof getDb>,
  ownerEmail: string,
) {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`content-page-tree:${ownerEmail}`}, 0::bigint))`,
  );
}

/**
 * Re-reads a new page's parent with a share lock, and refuses when the parent
 * moved to Trash or changed owner, space, org or visibility since the page
 * copied them. A move or Trash of the parent holds its row until it commits,
 * so this reads the result; a move that locks the parent after this sees the
 * new page in its child scan. Take it last in the creating transaction.
 */
export async function lockParentOfNewPage(
  db: ReturnType<typeof getDb>,
  parentId: string,
  expected: {
    ownerEmail: string;
    spaceId: string | null;
    orgId: string | null;
    visibility: string;
  },
) {
  // guard:allow-unscoped — re-reads the parent the caller already access-checked, to refuse a create it moved away from.
  const [parent] = await db
    .select({
      ownerEmail: schema.documents.ownerEmail,
      spaceId: schema.documents.spaceId,
      orgId: schema.documents.orgId,
      visibility: schema.documents.visibility,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, parentId))
    .for("share");
  if (!parent) {
    throw new ActionContractError("Parent document not found.", {
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (parent.trashedAt) {
    throw new ActionContractError("Parent document is in Trash", {
      errorCode: "PARENT_TRASHED",
      statusCode: 409,
    });
  }
  if (
    parent.ownerEmail !== expected.ownerEmail ||
    (parent.spaceId ?? null) !== expected.spaceId ||
    (parent.orgId ?? null) !== expected.orgId ||
    parent.visibility !== expected.visibility
  ) {
    throw new ActionContractError(
      "The parent page moved or changed access while this page was being created. Read it again and retry.",
      { errorCode: "PARENT_SCOPE_CHANGED", statusCode: 409 },
    );
  }
}

const LOCK_BATCH_SIZE = 90;

/** Locks the page rows that exist, in id order, and returns their ids. */
export async function lockDocumentRows(
  db: ReturnType<typeof getDb>,
  documentIds: Iterable<string>,
): Promise<string[]> {
  const locked: string[] = [];
  for (const batch of chunks(sortRowIds(documentIds), LOCK_BATCH_SIZE)) {
    // guard:allow-unscoped — takes row locks on ids the caller already resolved under its access check and returns only those ids.
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(inArray(schema.documents.id, batch))
      .orderBy(sql`${schema.documents.id} COLLATE "C"`)
      .for("update");
    locked.push(...rows.map((row) => row.id));
  }
  return locked;
}
