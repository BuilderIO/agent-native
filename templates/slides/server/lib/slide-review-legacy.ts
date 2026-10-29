import type { ActionRunContext } from "@agent-native/core/action";
import {
  assertReviewableResourceAccess,
  type ReviewComment,
  type ReviewCommentReaction,
  type ReviewResourceContext,
  type ReviewResourceRole,
} from "@agent-native/core/review";
import listReviewComments from "@agent-native/core/review/actions/list-review-comments";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";

import type { SlideCommentAnchor } from "../../shared/slide-comment-anchor.js";
import type { SlideCommentReaction } from "../../shared/slide-comment-reactions.js";
import {
  parseSlideReviewAnchor,
  SLIDE_REVIEW_RESOURCE_TYPE,
} from "../../shared/slide-review.js";
import "./slide-review.js";

/** The row shape `list-slide-comments` returned before the review store. */
export interface LegacySlideComment {
  id: string;
  deck_id: string;
  slide_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  quoted_text: string | null;
  anchor: SlideCommentAnchor | null;
  reactions: SlideCommentReaction[];
  author_email: string | null;
  author_name: string | null;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

// The most comments core's list action returns in one call.
const REVIEW_LIST_LIMIT = 500;

/**
 * The shims run core's review actions directly, so they hand over the caller
 * the request established rather than trusting a nested default.
 */
export function slideReviewActionContext(
  ctx: ActionRunContext | undefined,
): ActionRunContext & { userName?: string } {
  const userName = getRequestUserName()?.trim();
  const userEmail = ctx?.userEmail ?? getRequestUserEmail();
  return {
    ...ctx,
    caller: ctx?.caller ?? "http",
    ...(userEmail ? { userEmail } : {}),
    orgId: ctx?.orgId ?? getRequestOrgId() ?? null,
    ...(userName ? { userName } : {}),
  };
}

/** Deck access through the review registration, which migrates legacy comments first. */
export function assertSlideReviewAccess(
  deckId: string,
  ctx: ActionRunContext | undefined,
  role: ReviewResourceRole,
) {
  return assertReviewableResourceAccess(
    SLIDE_REVIEW_RESOURCE_TYPE,
    deckId,
    slideReviewActionContext(ctx) as ReviewResourceContext,
    role,
  );
}

export async function listSlideReviewComments(
  deckId: string,
  ctx: ActionRunContext | undefined,
  options: { slideId?: string | undefined } = {},
): Promise<{
  comments: ReviewComment[];
  reactions: Record<string, ReviewCommentReaction[]>;
  /** Core returned a full page: comments past it exist and are not here. */
  truncated: boolean;
}> {
  const result = (await listReviewComments.run(
    {
      resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
      resourceId: deckId,
      includeResolved: true,
      ...(options.slideId ? { targetId: options.slideId } : {}),
      limit: REVIEW_LIST_LIMIT,
    },
    slideReviewActionContext(ctx),
  )) as {
    comments: ReviewComment[];
    discussion?: { reactions?: Record<string, ReviewCommentReaction[]> };
  };
  return {
    comments: result.comments,
    reactions: result.discussion?.reactions ?? {},
    truncated: result.comments.length >= REVIEW_LIST_LIMIT,
  };
}

export function legacySlideComment(
  comment: ReviewComment,
  root: ReviewComment | undefined,
  reactions: readonly ReviewCommentReaction[],
): LegacySlideComment {
  const anchor = parseSlideReviewAnchor((root ?? comment).anchor);
  return {
    id: comment.id,
    deck_id: comment.resourceId,
    slide_id: anchor?.slideId ?? comment.targetId ?? "",
    thread_id: comment.threadId,
    parent_id: comment.parentCommentId,
    content: comment.body,
    quoted_text: anchor?.quotedText ?? null,
    anchor: anchor?.point ?? null,
    reactions: reactions.map((reaction) => ({
      emoji: reaction.reaction,
      count: reaction.count,
      reacted: reaction.reactedByMe,
    })),
    author_email: comment.authorEmail,
    author_name: comment.authorName,
    resolved: comment.status === "resolved",
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
  };
}

export function legacySlideComments(
  comments: readonly ReviewComment[],
  reactions: Record<string, ReviewCommentReaction[]>,
): LegacySlideComment[] {
  const roots = new Map(
    comments
      .filter((comment) => comment.parentCommentId === null)
      .map((comment) => [comment.threadId, comment]),
  );
  return comments.map((comment) =>
    legacySlideComment(
      comment,
      roots.get(comment.threadId),
      reactions[comment.id] ?? [],
    ),
  );
}
