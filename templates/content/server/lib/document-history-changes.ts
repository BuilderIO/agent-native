import { and, asc, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";

import type { DocumentHistoryChange } from "../../shared/document-history.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

type ContentDb = ReturnType<typeof getDb>;

/**
 * The changes a History entry recorded, oldest first, at most `limit`. Each of
 * the entry's "after" checkpoints ends one; the page before it is the
 * checkpoint History wrote just before, in this entry or the one before it,
 * since History skips a "before" checkpoint that would repeat its latest. A
 * recovery checkpoint holds an edit that didn't land, not the page, and can
 * share a displaced edit's "before" timestamp, so it is never the page
 * before. The page's first checkpoint records it being made, which is no
 * change. `hasMore` when the entry holds more than `limit`.
 */
export async function listHistoryEntryChanges(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  groupId: string;
  limit: number;
}): Promise<{ changes: DocumentHistoryChange[]; hasMore: boolean }> {
  const { db, ownerEmail, documentId } = args;
  const checkpoint = {
    checkpointId: schema.documentVersions.id,
    title: schema.documentVersions.title,
    content: schema.documentVersions.content,
    createdAt: schema.documentVersions.createdAt,
  };
  const afters = await db
    .select(checkpoint)
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, ownerEmail),
        eq(schema.documentVersions.documentId, documentId),
        eq(schema.documentVersions.groupId, args.groupId),
        eq(schema.documentVersions.checkpointKind, "after"),
      ),
    )
    .orderBy(
      asc(schema.documentVersions.createdAt),
      asc(schema.documentVersions.id),
    )
    .limit(args.limit + 1);
  const changes: DocumentHistoryChange[] = [];
  for (const after of afters.slice(0, args.limit)) {
    const before = firstRow(
      await db
        .select(checkpoint)
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.ownerEmail, ownerEmail),
            eq(schema.documentVersions.documentId, documentId),
            lt(schema.documentVersions.createdAt, after.createdAt),
            or(
              isNull(schema.documentVersions.checkpointKind),
              ne(schema.documentVersions.checkpointKind, "recovery"),
            ),
          ),
        )
        .orderBy(
          desc(schema.documentVersions.createdAt),
          sql`case when ${schema.documentVersions.checkpointKind} = 'after' then 0 else 1 end`,
          desc(schema.documentVersions.id),
        )
        .limit(1),
    );
    if (before) changes.push({ before, after });
  }
  return { changes, hasMore: afters.length > args.limit };
}
