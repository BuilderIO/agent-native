import { reanchoredCommentQuote } from "@shared/comment-reanchor";
import type { QueryClient } from "@tanstack/react-query";

import type { Comment } from "@/hooks/use-comments";

type CommentListResponse = { comments: Comment[] } | Comment[];

/**
 * Moves a thread's quote in the page's loaded comments onto the text an
 * accepted edit writes, as the server moves it when the edit lands, so the
 * thread's highlight sits on the new words before the comments are read
 * again. Reports whether the quote moved.
 */
export function moveLoadedThreadQuote(
  queryClient: QueryClient,
  documentId: string,
  thread: { threadId: string; fieldId: string | null },
  beforeMarkdown: string,
  afterMarkdown: string,
): boolean {
  let moved = false;
  queryClient.setQueryData<CommentListResponse>(
    ["action", "list-comments", { documentId }],
    (response) => {
      if (!response) return response;
      const comments = Array.isArray(response) ? response : response.comments;
      const next = comments.map((comment) => {
        if (
          moved ||
          comment.thread_id !== thread.threadId ||
          comment.parent_id !== null ||
          (comment.field_id ?? null) !== thread.fieldId ||
          comment.quoted_text === null
        )
          return comment;
        const quote = reanchoredCommentQuote(
          {
            quotedText: comment.quoted_text,
            prefix: comment.anchor_prefix,
            suffix: comment.anchor_suffix,
            startOffset: comment.anchor_start_offset,
          },
          beforeMarkdown,
          afterMarkdown,
        );
        if (!quote) return comment;
        moved = true;
        return {
          ...comment,
          quoted_text: quote.quotedText,
          anchor_prefix: quote.prefix,
          anchor_suffix: quote.suffix,
          anchor_start_offset: quote.startOffset,
        };
      });
      if (!moved) return response;
      return Array.isArray(response) ? next : { ...response, comments: next };
    },
  );
  return moved;
}
