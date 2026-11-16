import {
  compareMirroredReviewComments,
  deleteMirroredReviewComments,
  ensureReviewTables,
  listMirroredResourceIds,
  mirrorReviewComments,
  type ReviewCommentCopy,
  type ReviewMirrorDifference,
  type ReviewMirrorResource,
} from "@agent-native/core/review";
import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { isAgentAuthoredComment } from "../../shared/comment-author.js";
import { parseSlideCommentReactionBuckets } from "../../shared/slide-comment-reactions.js";
import { getDb, schema } from "../db/index.js";

/**
 * Slides is moving its comments onto the shared Comments & Review Kit. For
 * now `slide_comments` stays what Slides reads, and every comment write also
 * copies the comments it changed into the kit's tables in the same
 * transaction, so the kit holds a copy that a later release switches to.
 */

/** The kit's resource type for a deck's comments. */
export const DECK_REVIEW_RESOURCE = "deck";
/** A point on a slide, or on an object on it: Slides' one anchor kind. */
export const SLIDE_POINT_ANCHOR = "slide-point";

type SlideCommentRow = typeof schema.slideComments.$inferSelect;
/** The app's database or the transaction a comment action runs in. */
type SlidesReader = Pick<ReturnType<typeof getDb>, "select">;

export function slideCommentCopy(row: SlideCommentRow): ReviewCommentCopy {
  const anchor: unknown = row.anchor ? JSON.parse(row.anchor) : null;
  const reactions = Object.entries(
    parseSlideCommentReactionBuckets(row.emojiReactionsJson),
  ).flatMap(([reaction, actors]) =>
    actors.map((actorEmail) => ({ actorEmail, reaction })),
  );
  return {
    id: row.id,
    threadId: row.threadId,
    parentCommentId: row.parentId,
    surfaceId: row.slideId,
    anchor,
    anchorKind: anchor === null ? null : SLIDE_POINT_ANCHOR,
    anchorVersion: anchor === null ? null : 1,
    body: row.content,
    authorEmail: row.authorEmail,
    authorName: row.authorName,
    createdBy: isAgentAuthoredComment(row) ? "agent" : "human",
    resolved: row.resolved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.quotedText ? { quotedText: row.quotedText } : null,
    reactions,
  };
}

// A deck's sharing, which the kit keeps on each comment.
const DECK_SHARING = {
  ownerEmail: schema.decks.ownerEmail,
  orgId: schema.decks.orgId,
  visibility: schema.decks.visibility,
};

async function deckResource(
  db: SlidesReader,
  deckId: string,
): Promise<ReviewMirrorResource | null> {
  const rows = await db
    .select(DECK_SHARING)
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .limit(1);
  const deck = rows.at(0);
  return deck
    ? { resourceType: DECK_REVIEW_RESOURCE, resourceId: deckId, ...deck }
    : null;
}

/**
 * Copies these comments, as `slide_comments` now has them, into the kit.
 * Call it inside the transaction that changed them, after the change, while
 * that transaction holds their rows: another write to the same comment then
 * waits, so the kit always ends with the latest version.
 */
export async function mirrorSlideComments(
  db: SlidesReader,
  deckId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const resource = await deckResource(db, deckId);
  if (!resource) return;
  const rows = await db
    .select()
    .from(schema.slideComments)
    .where(
      and(
        eq(schema.slideComments.deckId, deckId),
        inArray(schema.slideComments.id, [...ids]),
      ),
    );
  await mirrorReviewComments(resource, rows.map(slideCommentCopy));
}

/** Marks deleted slide comments deleted in the kit, or all of a deck's. */
export async function deleteMirroredSlideComments(
  deckId: string,
  ids: readonly string[] | "all",
  deletedBy?: string | null,
): Promise<void> {
  await deleteMirroredReviewComments(
    { resourceType: DECK_REVIEW_RESOURCE, resourceId: deckId },
    ids,
    deletedBy,
  );
}

export interface SlideCommentCopyReport {
  decks: number;
  comments: number;
  /** Decks whose copy failed; the copy runs again on a later start. */
  failedDecks: string[];
  /**
   * What still differs after the copy, by deck. IDs only, never text. Like a
   * failed deck, a difference leaves the copy to run again on a later start.
   */
  differences: Array<{ deckId: string } & ReviewMirrorDifference>;
}

const DECK_PAGE_SIZE = 200;

/**
 * Copies every deck's comments into the kit and checks each deck's two
 * stores agree, while its comments are still locked. Decks with comments
 * only the kit has are checked too, and reported, not deleted. Safe to run
 * again: each run brings the kit up to date with `slide_comments`.
 */
export async function copySlideCommentsToReviewKit(): Promise<SlideCommentCopyReport> {
  await ensureReviewTables();
  const db = getDb();
  const report: SlideCommentCopyReport = {
    decks: 0,
    comments: 0,
    failedDecks: [],
    differences: [],
  };
  let after = "";
  for (;;) {
    // guard:allow-unscoped — the startup copy covers every deck with comments.
    const page = await db
      .selectDistinct({ deckId: schema.slideComments.deckId })
      .from(schema.slideComments)
      .where(gt(schema.slideComments.deckId, after))
      .orderBy(asc(schema.slideComments.deckId))
      .limit(DECK_PAGE_SIZE);
    for (const { deckId } of page) {
      await copyDeck(deckId, report);
    }
    const last = page.at(-1);
    if (page.length < DECK_PAGE_SIZE || !last) break;
    after = last.deckId;
  }
  // The pass above only reaches decks with comments in `slide_comments`.
  after = "";
  for (;;) {
    const page = await listMirroredResourceIds(DECK_REVIEW_RESOURCE, {
      after,
      limit: DECK_PAGE_SIZE,
    });
    const last = page.at(-1);
    if (last === undefined) break;
    const copied = await db
      .selectDistinct({ deckId: schema.slideComments.deckId })
      .from(schema.slideComments)
      .where(inArray(schema.slideComments.deckId, page));
    const seen = new Set(copied.map((row) => row.deckId));
    for (const deckId of page) {
      if (!seen.has(deckId)) await copyDeck(deckId, report);
    }
    if (page.length < DECK_PAGE_SIZE) break;
    after = last;
  }
  return report;
}

async function copyDeck(
  deckId: string,
  report: SlideCommentCopyReport,
): Promise<void> {
  try {
    const copied = await getDb().transaction(async (tx) => {
      // Comment actions lock the deck or the comments they change, so
      // holding both here keeps a write on another server from landing
      // between this read and the check.
      const decks = await tx
        .select(DECK_SHARING)
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .for("update");
      const deck = decks.at(0);
      // Comments left behind by a deck that's gone have nothing to sit on.
      if (!deck) return null;
      const resource = {
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        ...deck,
      };
      const rows = await tx
        .select()
        .from(schema.slideComments)
        .where(eq(schema.slideComments.deckId, deckId))
        .orderBy(
          asc(schema.slideComments.createdAt),
          asc(schema.slideComments.id),
        )
        .for("update");
      const copies = rows.map(slideCommentCopy);
      await mirrorReviewComments(resource, copies);
      const { differences } = await compareMirroredReviewComments(
        resource,
        copies,
      );
      return { comments: copies.length, differences };
    });
    if (!copied) return;
    report.decks += 1;
    report.comments += copied.comments;
    for (const difference of copied.differences) {
      report.differences.push({ deckId, ...difference });
    }
  } catch (error) {
    report.failedDecks.push(deckId);
    console.error(
      `[slides] Couldn't copy deck ${deckId}'s comments to the review kit:`,
      error instanceof Error ? error.message : error,
    );
  }
}
