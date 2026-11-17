import {
  ensureReviewTables,
  mirrorReviewComments,
  type ReviewCommentCopy,
} from "@agent-native/core/review";
import { asc, eq, gt } from "drizzle-orm";

import { isAgentAuthoredComment } from "../../shared/comment-author.js";
import { parseSlideCommentReactionBuckets } from "../../shared/slide-comment-reactions.js";
import { getDb, schema } from "../db/index.js";
import { DECK_REVIEW_RESOURCE, SLIDE_POINT_ANCHOR } from "./slide-comments.js";

/**
 * Slides kept its comments in `slide_comments`, and copied each change into
 * the shared Comments & Review Kit, until it switched to the kit. The old
 * table now goes unwritten until a later release drops it. This adds any of
 * its comments the kit still lacks, and never changes one the kit has, so a
 * comment edited, resolved or deleted through the kit stays that way.
 */

type SlideCommentRow = typeof schema.slideComments.$inferSelect;
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

export interface SlideCommentCopyReport {
  decks: number;
  comments: number;
  /** Comments the kit lacked, now added. */
  added: number;
  /** Decks whose copy failed; the copy runs again on a later start. */
  failedDecks: string[];
}

const DECK_PAGE_SIZE = 200;

/** Adds every deck's comments the kit lacks. Safe to run again. */
export async function addMissingSlideCommentsToReviewKit(): Promise<SlideCommentCopyReport> {
  await ensureReviewTables();
  const db = getDb();
  const report: SlideCommentCopyReport = {
    decks: 0,
    comments: 0,
    added: 0,
    failedDecks: [],
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
  return report;
}

async function copyDeck(
  deckId: string,
  report: SlideCommentCopyReport,
): Promise<void> {
  try {
    const copied = await getDb().transaction(async (tx) => {
      // A server still on the release before the switch locks the deck to
      // write a comment, so holding it here keeps one of its writes from
      // landing between this read and the copy.
      const decks = await tx
        .select(DECK_SHARING)
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .for("update");
      const deck = decks.at(0);
      // Comments left behind by a deck that's gone have nothing to sit on.
      if (!deck) return null;
      const rows = await tx
        .select()
        .from(schema.slideComments)
        .where(eq(schema.slideComments.deckId, deckId))
        .orderBy(
          asc(schema.slideComments.createdAt),
          asc(schema.slideComments.id),
        );
      const { written } = await mirrorReviewComments(
        { resourceType: DECK_REVIEW_RESOURCE, resourceId: deckId, ...deck },
        rows.map(slideCommentCopy),
        { onlyMissing: true },
      );
      return { comments: rows.length, added: written };
    });
    if (!copied) return;
    report.decks += 1;
    report.comments += copied.comments;
    report.added += copied.added;
  } catch (error) {
    report.failedDecks.push(deckId);
    console.error(
      `[slides] Couldn't copy deck ${deckId}'s comments to the review kit:`,
      error instanceof Error ? error.message : error,
    );
  }
}
