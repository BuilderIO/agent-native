import { and, asc, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";

import type { DocumentHistoryChange } from "../../shared/document-history.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

type ContentDb = ReturnType<typeof getDb>;

// agent-chat's snapshot of the page when a chat starts.
const CHAT_START_OPERATION = "chat start";

type HistoryEntry = {
  ownerEmail: string;
  documentId: string;
  groupId: string;
};

// The checkpoints that end an entry's changes.
function entryChangeEnds(entry: HistoryEntry) {
  return and(
    eq(schema.documentVersions.ownerEmail, entry.ownerEmail),
    eq(schema.documentVersions.documentId, entry.documentId),
    eq(schema.documentVersions.groupId, entry.groupId),
    eq(schema.documentVersions.checkpointKind, "after"),
    or(
      isNull(schema.documentVersions.operation),
      ne(schema.documentVersions.operation, CHAT_START_OPERATION),
    ),
  );
}

/**
 * The changes a History entry recorded, oldest first, at most `limit`. Each of
 * the entry's "after" checkpoints ends one; the page before it is the
 * checkpoint History wrote just before, in this entry or the one before it,
 * since History skips a "before" checkpoint that would repeat its latest. A
 * recovery checkpoint holds an edit that didn't land, not the page, and can
 * share a displaced edit's "before" timestamp, so it is never the page
 * before. The page's first checkpoint records it being made, which is no
 * change. Nor is a chat's start: it records the page as the agent found it,
 * with no "before" checkpoint, so whatever someone wrote since History's
 * latest checkpoint would read as the agent's. It stays the page before the
 * agent's first change. `hasMore` when the entry holds more than `limit`.
 */
export async function listHistoryEntryChanges(
  args: HistoryEntry & { db: ContentDb; limit: number },
): Promise<{ changes: DocumentHistoryChange[]; hasMore: boolean }> {
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
    .where(entryChangeEnds(args))
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

/**
 * The checkpoint that ends an entry's newest change, the last change's
 * `after` in `listHistoryEntryChanges`, or null for an entry with none. A
 * change that joins the entry moves it.
 */
export async function latestHistoryEntryChange(
  args: HistoryEntry & { db: ContentDb },
): Promise<string | null> {
  const latest = firstRow(
    await args.db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(entryChangeEnds(args))
      .orderBy(
        desc(schema.documentVersions.createdAt),
        desc(schema.documentVersions.id),
      )
      .limit(1),
  );
  return latest?.id ?? null;
}
