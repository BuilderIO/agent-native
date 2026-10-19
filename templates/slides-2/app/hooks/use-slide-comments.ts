import { agentNativeApiDisabledReason } from "@agent-native/core/client/api-surface";
import { emailToColor } from "@agent-native/core/client/collab";
import {
  callActionWithRetry,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import type { SlideCommentReaction } from "@shared/slide-comment-reactions";
import { useQuery } from "@tanstack/react-query";

export interface SlideComment {
  id: string;
  deck_id: string;
  slide_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  quoted_text: string | null;
  anchor?: SlideCommentAnchor | null;
  reactions?: SlideCommentReaction[];
  author_email: string;
  author_name: string | null;
  resolved: number | boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentThread {
  threadId: string;
  slideId?: string;
  quotedText: string | null;
  anchor?: SlideCommentAnchor | null;
  resolved: boolean;
  comments: SlideComment[];
}

function isResolved(
  val: number | boolean | string | null | undefined,
): boolean {
  return val === true || val === 1 || val === "1" || val === "true";
}

function groupIntoThreads(comments: SlideComment[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  for (const c of comments) {
    if (!map.has(c.thread_id)) {
      map.set(c.thread_id, {
        threadId: c.thread_id,
        slideId: c.slide_id,
        quotedText: c.quoted_text,
        anchor: c.anchor,
        resolved: isResolved(c.resolved),
        comments: [],
      });
    }
    map.get(c.thread_id)!.comments.push(c);
  }
  return Array.from(map.values());
}

interface SlideCommentPage {
  comments: SlideComment[];
  has_more: boolean;
  next_cursor: { createdAt: string; id: string } | null;
}

const SLIDE_COMMENT_PAGE_SIZE = 200;

async function listAllSlideComments(
  params: { deckId: string; slideId?: string },
  signal: AbortSignal,
): Promise<SlideComment[]> {
  const comments: SlideComment[] = [];
  let cursor: { createdAt: string; id: string } | null = null;

  for (;;) {
    const page: SlideCommentPage | SlideComment[] = await callActionWithRetry<
      SlideCommentPage | SlideComment[]
    >(
      "list-slide-comments",
      {
        ...params,
        limit: SLIDE_COMMENT_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      },
      { signal },
    );

    if (Array.isArray(page)) return page;
    if (!page || !Array.isArray(page.comments)) {
      throw new Error("Could not load slide comments: invalid page response.");
    }

    comments.push(...page.comments);
    if (page.has_more === false) return comments;

    const nextCursor: SlideCommentPage["next_cursor"] = page.next_cursor;
    const lastComment = page.comments[page.comments.length - 1];
    const cursorDidNotAdvance = Boolean(
      cursor &&
      nextCursor &&
      cursor.createdAt === nextCursor.createdAt &&
      cursor.id === nextCursor.id,
    );
    if (
      page.has_more !== true ||
      !nextCursor ||
      typeof nextCursor.createdAt !== "string" ||
      typeof nextCursor.id !== "string" ||
      !lastComment ||
      nextCursor.createdAt !== lastComment.created_at ||
      nextCursor.id !== lastComment.id ||
      cursorDidNotAdvance ||
      page.comments.length !== SLIDE_COMMENT_PAGE_SIZE
    ) {
      throw new Error(
        "Could not load all slide comments: invalid pagination response.",
      );
    }

    cursor = nextCursor;
  }
}

export function useSlideComments(
  deckId: string | null,
  slideId: string | null,
  scope: "slide" | "deck" = "slide",
) {
  const enabled = Boolean(deckId && (scope === "deck" || slideId));
  const queryArgs =
    deckId && enabled
      ? {
          deckId,
          ...(scope === "slide" && slideId ? { slideId } : {}),
        }
      : undefined;
  const apiDisabled = Boolean(agentNativeApiDisabledReason());

  return useQuery<CommentThread[]>({
    queryKey: ["action", "list-slide-comments", queryArgs],
    queryFn: async ({ signal }) => {
      if (!queryArgs) {
        throw new Error("Slide comments require a deck ID.");
      }
      return groupIntoThreads(await listAllSlideComments(queryArgs, signal));
    },
    enabled: enabled && !apiDisabled,
    retry: false,
  });
}

export function useCreateSlideComment() {
  return useActionMutation("add-slide-comment");
}

export function useResolveSlideComment() {
  return useActionMutation<
    { ok: boolean; resolved?: boolean },
    { id: string; deckId: string; resolved?: boolean }
  >("update-slide-comment");
}

export function useUpdateSlideComment() {
  return useActionMutation<
    { ok: boolean },
    { id: string; deckId: string; content: string }
  >("update-slide-comment");
}

export function useDeleteSlideComment() {
  return useActionMutation<{ ok: boolean }, { id: string; deckId: string }>(
    "delete-slide-comment",
  );
}

export function useToggleSlideCommentReaction() {
  return useActionMutation<
    {
      id: string;
      emoji: string;
      reacted: boolean;
      reactions: SlideCommentReaction[];
    },
    { commentId: string; deckId: string; emoji: string }
  >("toggle-slide-comment-reaction");
}

export { emailToColor };

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
