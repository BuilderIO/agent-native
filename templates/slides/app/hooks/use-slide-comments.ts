import { agentNativeApiDisabledReason } from "@agent-native/core/client/api-surface";
import { callActionWithRetry } from "@agent-native/core/client/hooks";
import type { ListReviewCommentsResult } from "@agent-native/core/client/review";
import type { ReviewComment } from "@agent-native/core/review";
import { buildReviewThreads } from "@agent-native/toolkit/app/review";
import { DECK_REVIEW_RESOURCE } from "@shared/deck-review";
import {
  slideCommentAnchorSchema,
  type SlideCommentAnchor,
} from "@shared/slide-comment-anchor";
import { useQuery } from "@tanstack/react-query";

export interface CommentThread {
  threadId: string;
  slideId: string | null;
  quotedText: string | null;
  anchor: SlideCommentAnchor | null;
  resolved: boolean;
  root: ReviewComment;
  replies: ReviewComment[];
}

export interface SlideCommentsData {
  threads: CommentThread[];
  discussion: ListReviewCommentsResult["discussion"];
}

const SLIDE_COMMENT_PAGE_SIZE = 500;

export function slideCommentsQueryParams(deckId: string, slideId?: string) {
  return {
    resourceType: DECK_REVIEW_RESOURCE,
    resourceId: deckId,
    ...(slideId ? { surfaceId: slideId } : {}),
    includeResolved: true,
    limit: SLIDE_COMMENT_PAGE_SIZE,
  };
}

type SlideCommentsQueryParams = ReturnType<typeof slideCommentsQueryParams>;

function invalidPage(page: ListReviewCommentsResult | null | undefined) {
  return !page || !Array.isArray(page.comments) || !page.discussion;
}

async function listDeckComments(
  params: SlideCommentsQueryParams,
  signal: AbortSignal,
): Promise<ListReviewCommentsResult> {
  const first = await callActionWithRetry<ListReviewCommentsResult>(
    "list-review-comments",
    params,
    { signal },
  );
  if (invalidPage(first)) {
    throw new Error("Could not load slide comments: invalid page response.");
  }
  const comments = [...first.comments];
  const reactions = { ...first.discussion.reactions };
  const threadPreferences = { ...first.discussion.threadPreferences };
  const seenCursors = new Set<string>();
  let cursor = first.nextCursor ?? null;
  while (cursor) {
    if (seenCursors.has(cursor)) {
      throw new Error(
        "Could not load all slide comments: invalid pagination response.",
      );
    }
    seenCursors.add(cursor);
    const page = await callActionWithRetry<ListReviewCommentsResult>(
      "list-review-comments",
      { ...params, cursor },
      { signal },
    );
    if (invalidPage(page)) {
      throw new Error(
        "Could not load all slide comments: invalid pagination response.",
      );
    }
    comments.push(...page.comments);
    Object.assign(reactions, page.discussion.reactions);
    Object.assign(threadPreferences, page.discussion.threadPreferences);
    cursor = page.nextCursor ?? null;
  }
  return {
    ...first,
    comments,
    nextCursor: null,
    discussion: { ...first.discussion, reactions, threadPreferences },
  };
}

function slideAnchor(comment: ReviewComment): SlideCommentAnchor | null {
  const parsed = slideCommentAnchorSchema.safeParse(comment.anchor);
  if (!parsed.success) return null;
  const {
    x,
    y,
    targetText,
    objectId,
    objectX,
    objectY,
    textStartOffset,
    textEndOffset,
  } = parsed.data;
  return {
    x,
    y,
    ...(targetText !== undefined ? { targetText } : {}),
    ...(objectId !== undefined ? { objectId } : {}),
    ...(objectX !== undefined ? { objectX } : {}),
    ...(objectY !== undefined ? { objectY } : {}),
    ...(textStartOffset !== undefined ? { textStartOffset } : {}),
    ...(textEndOffset !== undefined ? { textEndOffset } : {}),
  };
}

export function slideCommentQuotedText(comment: ReviewComment): string | null {
  const quoted = comment.metadata?.quotedText;
  return typeof quoted === "string" && quoted ? quoted : null;
}

export function slideCommentThreads(
  comments: ReviewComment[],
): CommentThread[] {
  return buildReviewThreads(comments).map(({ root, replies }) => ({
    threadId: root.threadId,
    slideId: root.surfaceId ?? null,
    quotedText: slideCommentQuotedText(root),
    anchor: slideAnchor(root),
    resolved: root.status === "resolved",
    root,
    replies,
  }));
}

function selectSlideComments(
  result: ListReviewCommentsResult,
): SlideCommentsData {
  return {
    threads: slideCommentThreads(result.comments),
    discussion: result.discussion,
  };
}

export function useSlideComments(
  deckId: string | null,
  slideId: string | null,
  scope: "slide" | "deck" = "slide",
) {
  const enabled = Boolean(deckId && (scope === "deck" || slideId));
  const params =
    deckId && enabled
      ? slideCommentsQueryParams(
          deckId,
          scope === "slide" ? (slideId ?? undefined) : undefined,
        )
      : undefined;
  const apiDisabled = Boolean(agentNativeApiDisabledReason());

  return useQuery({
    queryKey: ["action", "list-review-comments", params],
    queryFn: ({ signal }) => {
      if (!params) {
        throw new Error("Slide comments require a deck ID.");
      }
      return listDeckComments(params, signal);
    },
    select: selectSlideComments,
    enabled: enabled && !apiDisabled,
    retry: false,
  });
}
