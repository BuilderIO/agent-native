import { fail, type ActionRunContext } from "@agent-native/core/action";
import type { DbExec } from "@agent-native/core/db";
import {
  deleteMirroredReviewComments,
  getReviewCommentById,
  getReviewDiscussionStateForComments,
  lockMirroredReviewThreads,
  queryReviewComments,
  reviewReactionActor,
  type ReviewComment,
  type ReviewCommentPosition,
  type ReviewResourceContext,
} from "@agent-native/core/review";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { resolveUserProfileName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import type { z } from "zod";

import {
  AGENT_AUTHOR_NAME,
  commentAuthorKind,
} from "../../shared/comment-author.js";
import {
  DECK_REVIEW_RESOURCE,
  SLIDE_POINT_ANCHOR,
} from "../../shared/deck-review.js";
import { slideCommentAnchorSchema } from "../../shared/slide-comment-anchor.js";
import type { SlideCommentReaction } from "../../shared/slide-comment-reactions.js";
import { withUniqueSlideIds } from "../../shared/slide-ids.js";

export { DECK_REVIEW_RESOURCE, SLIDE_POINT_ANCHOR };

export function slideReviewContext(
  ctx: ActionRunContext | undefined,
): ActionRunContext & ReviewResourceContext {
  const userEmail = ctx?.userEmail ?? getRequestUserEmail();
  return {
    ...ctx,
    caller:
      commentAuthorKind(ctx?.caller) === "agent"
        ? "tool"
        : (ctx?.caller ?? "frontend"),
    ...(userEmail ? { userEmail } : {}),
    orgId: ctx?.orgId ?? getRequestOrgId() ?? null,
  };
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function slideCommentAuthorName(
  ctx: ActionRunContext | undefined,
  email: string,
): string {
  return commentAuthorKind(ctx?.caller) === "agent"
    ? AGENT_AUTHOR_NAME
    : getRequestUserName()?.trim() || displayNameFromEmail(email);
}

export async function findSlideComment(
  deckId: string,
  id: string,
): Promise<ReviewComment | null> {
  const comment = await getReviewCommentById(id, {}, { bypassScope: true });
  return comment &&
    comment.resourceType === DECK_REVIEW_RESOURCE &&
    comment.resourceId === deckId &&
    comment.status !== "deleted"
    ? comment
    : null;
}

export async function slideCommentThread(
  deckId: string,
  threadId: string,
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = [];
  let after: ReviewCommentPosition | undefined;
  for (;;) {
    const page = await queryReviewComments({
      ...deckComments(deckId),
      threadId,
      after,
      limit: KIT_PAGE_SIZE,
    });
    comments.push(...page);
    const last = page.at(-1);
    if (page.length < KIT_PAGE_SIZE || !last) return comments;
    after = { createdAt: last.createdAt, id: last.id };
  }
}

const KIT_PAGE_SIZE = 500;

function deckComments(deckId: string) {
  return {
    resourceType: DECK_REVIEW_RESOURCE,
    resourceId: deckId,
    scope: {},
    bypassScope: true,
    includeResolved: true,
  };
}

export async function listSlideComments(input: {
  deckId: string;
  slideId?: string | undefined;
  limit: number;
  offset?: number | undefined;
  cursor?: ReviewCommentPosition | undefined;
}): Promise<{ comments: ReviewComment[]; hasMore: boolean }> {
  const rows = await queryReviewComments({
    ...deckComments(input.deckId),
    ...(input.slideId ? { surfaceId: input.slideId } : {}),
    after: input.cursor,
    offset: input.cursor ? 0 : (input.offset ?? 0),
    limit: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  return { comments: hasMore ? rows.slice(0, input.limit) : rows, hasMore };
}

type SlideCommentAnchor = z.infer<typeof slideCommentAnchorSchema>;

export interface SlideCommentRow {
  id: string;
  deck_id: string;
  slide_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  quoted_text: string | null;
  anchor: SlideCommentAnchor | null;
  reactions: SlideCommentReaction[];
  author_email: string;
  author_kind: "agent" | "person";
  author_name: string | null;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

function quotedText(comment: ReviewComment): string | null {
  const quoted = comment.metadata?.quotedText;
  return typeof quoted === "string" ? quoted : null;
}

function slideAnchor(comment: ReviewComment): SlideCommentAnchor | null {
  const parsed = slideCommentAnchorSchema.safeParse(comment.anchor);
  return parsed.success ? parsed.data : null;
}

export async function slideCommentReactions(
  comments: ReviewComment[],
  ctx: ActionRunContext | undefined,
): Promise<Record<string, SlideCommentReaction[]>> {
  const reviewCtx = slideReviewContext(ctx);
  const { reactions } = await getReviewDiscussionStateForComments(
    comments,
    reviewCtx.userEmail ?? null,
    reviewReactionActor(reviewCtx),
  );
  return Object.fromEntries(
    Object.entries(reactions).map(([id, list]) => [
      id,
      list
        .filter((reaction) => reaction.count > 0)
        .map((reaction) => ({
          emoji: reaction.reaction,
          count: reaction.count,
          reacted: reaction.reactedByMe,
        }))
        .sort((a, b) => a.emoji.localeCompare(b.emoji)),
    ]),
  );
}

export async function toSlideCommentRows(
  comments: ReviewComment[],
  ctx: ActionRunContext | undefined,
): Promise<SlideCommentRow[]> {
  const [reactions, profiles] = await Promise.all([
    slideCommentReactions(comments, ctx),
    getUserProfiles(comments.map((comment) => comment.authorEmail ?? "")),
  ]);
  return comments.map((comment) => {
    const authorEmail = comment.authorEmail ?? "";
    return {
      id: comment.id,
      deck_id: comment.resourceId,
      slide_id: comment.surfaceId ?? "",
      thread_id: comment.threadId,
      parent_id: comment.parentCommentId,
      content: comment.body,
      quoted_text: quotedText(comment),
      anchor: slideAnchor(comment),
      reactions: reactions[comment.id] ?? [],
      author_email: authorEmail,
      author_kind: comment.createdBy === "agent" ? "agent" : "person",
      author_name: resolveUserProfileName(
        authorEmail,
        comment.authorName,
        profiles.get(authorEmail.toLowerCase())?.name,
      ),
      resolved: comment.status === "resolved",
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
    };
  });
}

export async function lockDeckCommentThreads(deckId: string): Promise<void> {
  await lockMirroredReviewThreads({
    resourceType: DECK_REVIEW_RESOURCE,
    resourceId: deckId,
  });
}

export async function deleteDeckComments(
  deckId: string,
  deletedBy?: string | null,
): Promise<void> {
  await deleteMirroredReviewComments(
    { resourceType: DECK_REVIEW_RESOURCE, resourceId: deckId },
    "all",
    deletedBy,
  );
}

export async function assertCommentSlideInDeck(
  tx: DbExec,
  comment: ReviewComment,
): Promise<void> {
  const slideId = comment.surfaceId;
  if (!slideId) {
    fail("A deck comment needs the slide it's on", {
      errorCode: "invalid_request",
      statusCode: 400,
    });
  }
  // guard:allow-unscoped — the kit has already let the writer comment on this deck; this reads only its slide IDs.
  // raw-sql-ok: the statement is constant text; the deck ID is bound.
  const { rows } = await tx.execute({
    sql: "SELECT data FROM decks WHERE id = ? FOR KEY SHARE",
    args: [comment.resourceId],
  });
  const data = rows[0]?.data;
  if (typeof data !== "string") {
    fail(`Deck not found: ${comment.resourceId}`, {
      errorCode: "not_found",
      statusCode: 404,
    });
  }
  const slides = (
    withUniqueSlideIds(comment.resourceId, JSON.parse(data)) as {
      slides?: unknown;
    } | null
  )?.slides;
  const found =
    Array.isArray(slides) &&
    slides.some(
      (slide) =>
        Boolean(slide) &&
        typeof slide === "object" &&
        (slide as { id?: unknown }).id === slideId,
    );
  if (!found) {
    fail(`Slide not found in deck: ${slideId}`, {
      errorCode: "not_found",
      statusCode: 404,
    });
  }
}
