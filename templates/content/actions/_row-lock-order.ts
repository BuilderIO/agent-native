import { inArray, sql } from "drizzle-orm";

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
