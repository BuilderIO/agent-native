import { useReviewComments } from "@agent-native/core/client/review";
import type {
  ReviewComment,
  ReviewDiscussionState,
} from "@agent-native/core/review";
import {
  buildReviewThreads,
  type ReviewThread,
} from "@agent-native/toolkit/app/review";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  parseSlideReviewAnchor,
  SLIDE_REVIEW_RESOURCE_TYPE,
} from "@shared/slide-review";
import { useMemo } from "react";

export interface CommentThread {
  threadId: string;
  /** Null for a thread with no slide anchor, such as one from another client. */
  slideId: string | null;
  quotedText: string | null;
  anchor: SlideCommentAnchor | null;
  resolved: boolean;
  review: ReviewThread;
}

/** Core's list caps one read at 500 comments. */
const SLIDE_REVIEW_LIMIT = 500;

/**
 * Every Slides comment surface reads this one query, so the panel, the pins
 * and the toolbar count share a single cache entry and one optimistic update.
 */
export function slideReviewQueryParams(deckId: string) {
  return {
    resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
    resourceId: deckId,
    includeResolved: true,
    limit: SLIDE_REVIEW_LIMIT,
  };
}

export function slideCommentThreads(
  comments: readonly ReviewComment[],
): CommentThread[] {
  return buildReviewThreads([...comments]).map((review) => {
    const anchor = parseSlideReviewAnchor(review.root.anchor);
    return {
      threadId: review.root.threadId,
      slideId: anchor?.slideId ?? review.root.targetId,
      quotedText: anchor?.quotedText ?? null,
      anchor: anchor?.point ?? null,
      resolved: review.root.status === "resolved",
      review,
    };
  });
}

export interface SlideCommentsResult {
  data: CommentThread[] | undefined;
  discussion: ReviewDiscussionState | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useSlideComments(
  deckId: string | null,
  slideId: string | null,
  scope: "slide" | "deck" = "slide",
): SlideCommentsResult {
  const query = useReviewComments(slideReviewQueryParams(deckId ?? ""), {
    enabled: Boolean(deckId),
  });
  const comments = query.data?.comments;
  const data = useMemo(() => {
    if (!comments) return undefined;
    const threads = slideCommentThreads(comments);
    return scope === "deck"
      ? threads
      : threads.filter((thread) => thread.slideId === slideId);
  }, [comments, scope, slideId]);
  return {
    data,
    discussion: query.data?.discussion,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
