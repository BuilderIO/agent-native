import {
  importReviewComments,
  type ImportReviewCommentInput,
} from "@agent-native/core/review";
import { and, asc, eq, gt, or } from "drizzle-orm";

import { parseSlideCommentAnchor } from "../../shared/slide-comment-anchor.js";
import { parseSlideCommentReactionBuckets } from "../../shared/slide-comment-reactions.js";
import {
  SLIDE_REVIEW_RESOURCE_TYPE,
  slideReviewAnchor,
} from "../../shared/slide-review.js";
import { getDb, schema } from "../db/index.js";

const PAGE_SIZE = 500;
/** The name `add-slide-comment` stored for agent-written comments. */
const LEGACY_AGENT_AUTHOR = "AI Agent";

type LegacyRow = typeof schema.slideComments.$inferSelect;

export interface SlideReviewDeckOwnership {
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: "private" | "org" | "public" | null;
}

// Decks already copied in this process; the marker row is the durable record.
const migratedDecks = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Copy a deck's `slide_comments` into the shared review store the first time
 * anything reads or writes that deck's review threads. The old rows stay in
 * place. The copy keeps ids, so a rerun after a crash inserts only what is
 * missing, and the marker is written only after every page landed.
 */
export function ensureSlideReviewMigrated(
  deckId: string,
  deck: SlideReviewDeckOwnership,
): Promise<void> {
  if (migratedDecks.has(deckId)) return Promise.resolve();
  const running = inFlight.get(deckId);
  if (running) return running;
  const run = migrateDeck(deckId, deck)
    .then(() => {
      migratedDecks.add(deckId);
    })
    .finally(() => inFlight.delete(deckId));
  inFlight.set(deckId, run);
  return run;
}

async function migrateDeck(
  deckId: string,
  deck: SlideReviewDeckOwnership,
): Promise<void> {
  const db = getDb();
  const marker = (
    await db
      .select({ deckId: schema.slideCommentReviewMigrations.deckId })
      .from(schema.slideCommentReviewMigrations)
      .where(eq(schema.slideCommentReviewMigrations.deckId, deckId))
      .limit(1)
  ).at(0);
  if (marker) return;

  const rows = await readLegacyComments(deckId);
  const { inserted } = await importReviewComments(
    legacyCommentsToReview(deckId, rows, deck),
  );
  await db
    .insert(schema.slideCommentReviewMigrations)
    .values({
      deckId,
      importedCount: inserted,
      migratedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

async function readLegacyComments(deckId: string): Promise<LegacyRow[]> {
  const db = getDb();
  const rows: LegacyRow[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  for (;;) {
    const page: LegacyRow[] = await db
      .select()
      .from(schema.slideComments)
      .where(
        cursor
          ? and(
              eq(schema.slideComments.deckId, deckId),
              or(
                gt(schema.slideComments.createdAt, cursor.createdAt),
                and(
                  eq(schema.slideComments.createdAt, cursor.createdAt),
                  gt(schema.slideComments.id, cursor.id),
                ),
              ),
            )
          : eq(schema.slideComments.deckId, deckId),
      )
      .orderBy(
        asc(schema.slideComments.createdAt),
        asc(schema.slideComments.id),
      )
      .limit(PAGE_SIZE);
    rows.push(...page);
    const last = page.at(-1);
    if (page.length < PAGE_SIZE || !last) return rows;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

/**
 * A legacy thread's resolved flag is written on every row, but the root is
 * what the old UI read, so the root decides for the whole thread. Replies whose
 * root is gone are attached to the earliest surviving comment in the thread.
 */
export function legacyCommentsToReview(
  deckId: string,
  rows: readonly LegacyRow[],
  deck: SlideReviewDeckOwnership,
): ImportReviewCommentInput[] {
  const byThread = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const thread = byThread.get(row.threadId) ?? [];
    thread.push(row);
    byThread.set(row.threadId, thread);
  }
  const comments: ImportReviewCommentInput[] = [];
  for (const [threadId, thread] of byThread) {
    const root =
      thread.find((row) => row.parentId === null) ?? (thread[0] as LegacyRow);
    const ids = new Set(thread.map((row) => row.id));
    const point = readLegacy(() => parseSlideCommentAnchor(root.anchor));
    const anchor = slideReviewAnchor({
      slideId: root.slideId,
      quotedText: root.quotedText,
      point: point.ok ? point.value : null,
    });
    for (const row of thread) {
      const isRoot = row.id === root.id;
      const parentId = isRoot
        ? null
        : row.parentId && ids.has(row.parentId) && row.parentId !== row.id
          ? row.parentId
          : root.id;
      const agent = row.authorName?.trim() === LEGACY_AGENT_AUTHOR;
      const reactions = readLegacy(() =>
        parseSlideCommentReactionBuckets(row.emojiReactionsJson),
      );
      const unreadable = [
        ...(isRoot && !point.ok ? ["anchor"] : []),
        ...(!reactions.ok ? ["reactions"] : []),
      ];
      comments.push({
        id: row.id,
        resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
        resourceId: deckId,
        threadId,
        parentCommentId: parentId,
        targetId: root.slideId,
        status: root.resolved ? "resolved" : "open",
        anchor: isRoot ? anchor : null,
        body: row.content,
        authorEmail: row.authorEmail,
        authorName: row.authorName,
        createdBy: agent ? "agent" : "human",
        resolutionTarget: "human",
        ownerEmail: deck.ownerEmail ?? null,
        orgId: deck.orgId ?? null,
        visibility: deck.visibility ?? "private",
        resolvedAt: root.resolved ? root.updatedAt : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        metadata: {
          source: "slide_comments",
          ...(unreadable.length ? { unreadableLegacyFields: unreadable } : {}),
        },
        reactions: reactions.ok
          ? Object.entries(reactions.value).flatMap(([reaction, emails]) =>
              emails.map((actorEmail) => ({ actorEmail, reaction })),
            )
          : [],
      });
    }
  }
  return comments;
}

/**
 * One corrupt legacy field must not keep a deck's whole discussion from
 * moving; the comment is kept and the field is named in its metadata.
 */
function readLegacy<T>(
  read: () => T,
): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[slides] unreadable legacy comment field:", message);
    return { ok: false, error: message };
  }
}

export function __resetSlideReviewMigrationForTests(): void {
  migratedDecks.clear();
  inFlight.clear();
}
