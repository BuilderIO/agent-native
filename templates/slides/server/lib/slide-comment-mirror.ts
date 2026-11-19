import {
  ensureReviewTables,
  linkMirroredReviewReplies,
  mirrorReviewComments,
  type ReviewCommentCopy,
} from "@agent-native/core/review";
import { asc, eq, gt } from "drizzle-orm";

import { isAgentAuthoredComment } from "../../shared/comment-author.js";
import { parseSlideCommentReactionBuckets } from "../../shared/slide-comment-reactions.js";
import { getDb, schema } from "../db/index.js";
import {
  DECK_REVIEW_RESOURCE,
  lockDeckCommentThreads,
  SLIDE_POINT_ANCHOR,
} from "./slide-comments.js";

type SlideCommentRow = typeof schema.slideComments.$inferSelect;
export function slideCommentCopy(
  row: SlideCommentRow,
  parentCommentId = row.parentId,
): ReviewCommentCopy {
  const anchor: unknown = row.anchor ? JSON.parse(row.anchor) : null;
  const reactions = Object.entries(
    parseSlideCommentReactionBuckets(row.emojiReactionsJson),
  ).flatMap(([reaction, actors]) =>
    actors.map((actorEmail) => ({ actorEmail, reaction })),
  );
  return {
    id: row.id,
    threadId: row.threadId,
    parentCommentId,
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

export function unlinkedReplyParents(
  rows: readonly SlideCommentRow[],
): Map<string, string> {
  const threadKey = (row: SlideCommentRow) =>
    JSON.stringify([row.slideId, row.threadId]);
  const firsts = new Map<string, SlideCommentRow>();
  for (const row of rows) {
    const first = firsts.get(threadKey(row));
    if (!first || (row.id === row.threadId && first.id !== row.threadId)) {
      firsts.set(threadKey(row), row);
    }
  }
  const parents = new Map<string, string>();
  for (const row of rows) {
    const first = firsts.get(threadKey(row));
    if (!row.parentId && first && first.id !== row.id) {
      parents.set(row.id, first.id);
    }
  }
  return parents;
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
  added: number;
  linked: number;
  /** Decks whose copy failed; the copy runs again on a later start. */
  failedDecks: string[];
}

const DECK_PAGE_SIZE = 200;

export async function addMissingSlideCommentsToReviewKit(): Promise<SlideCommentCopyReport> {
  await ensureReviewTables();
  const db = getDb();
  const report: SlideCommentCopyReport = {
    decks: 0,
    comments: 0,
    added: 0,
    linked: 0,
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
      await lockDeckCommentThreads(deckId);
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
      const resource = {
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        ...deck,
      };
      const parents = unlinkedReplyParents(rows);
      const { written } = await mirrorReviewComments(
        resource,
        rows.map((row) => slideCommentCopy(row, parents.get(row.id))),
        { onlyMissing: true },
      );
      const { linked } = await linkMirroredReviewReplies(
        resource,
        [...parents].map(([id, parentCommentId]) => ({ id, parentCommentId })),
      );
      return { comments: rows.length, added: written, linked };
    });
    if (!copied) return;
    report.decks += 1;
    report.comments += copied.comments;
    report.added += copied.added;
    report.linked += copied.linked;
  } catch (error) {
    report.failedDecks.push(deckId);
    console.error(
      `[slides] Couldn't copy deck ${deckId}'s comments to the review kit:`,
      error instanceof Error ? error.message : error,
    );
  }
}
