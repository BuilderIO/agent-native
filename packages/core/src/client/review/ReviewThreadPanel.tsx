import {
  IconMessageCircle,
  IconPlus,
  IconSend,
  IconTrash,
  IconCircleCheck,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import type { ReviewComment } from "../../review/types.js";
import { cn } from "../utils.js";
import { ReviewStatusBadge } from "./ReviewStatusBadge.js";
import {
  useCreateReviewComment,
  useDeleteReviewComment,
  useReplyReviewComment,
  useResolveReviewThread,
  useReviewComments,
} from "./use-review.js";

export interface ReviewThread {
  root: ReviewComment;
  replies: ReviewComment[];
}

export interface ReviewThreadPanelProps {
  resourceType: string;
  resourceId: string;
  targetId?: string | null;
  title?: string;
  className?: string;
  includeResolved?: boolean;
  showComposer?: boolean;
  placeholder?: string;
  emptyState?: string;
  onSelectThread?: (thread: ReviewThread) => void;
}

export function ReviewThreadPanel({
  resourceType,
  resourceId,
  targetId,
  title = "Review",
  className,
  includeResolved = true,
  showComposer = true,
  placeholder = "Add a comment...",
  emptyState = "No review comments yet.",
  onSelectThread,
}: ReviewThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const comments = useReviewComments({
    resourceType,
    resourceId,
    targetId,
    includeResolved,
  });
  const createComment = useCreateReviewComment();
  const replyComment = useReplyReviewComment();
  const resolveThread = useResolveReviewThread();
  const deleteComment = useDeleteReviewComment();
  const threads = useMemo(
    () => buildReviewThreads(comments.data?.comments ?? []),
    [comments.data?.comments],
  );

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <IconMessageCircle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">{title}</h2>
        </div>
        <ReviewStatusBadge status={comments.data?.reviewStatus?.status} />
      </div>

      {showComposer ? (
        <form
          className="border-b border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const body = draft.trim();
            if (!body) return;
            createComment.mutate(
              { resourceType, resourceId, targetId, body },
              { onSuccess: () => setDraft("") },
            );
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={placeholder}
            className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={!draft.trim() || createComment.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconPlus className="h-3.5 w-3.5" />
              Comment
            </button>
          </div>
        </form>
      ) : null}

      <div className="divide-y divide-border">
        {comments.isLoading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Loading comments...
          </div>
        ) : threads.length ? (
          threads.map((thread) => (
            <article
              key={thread.root.threadId}
              className="px-4 py-3"
              onClick={() => onSelectThread?.(thread)}
            >
              <CommentBubble comment={thread.root} />
              {thread.replies.length ? (
                <div className="mt-3 space-y-3 border-l border-border pl-4">
                  {thread.replies.map((reply) => (
                    <CommentBubble key={reply.id} comment={reply} compact />
                  ))}
                </div>
              ) : null}
              <form
                className="mt-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const body = replyDrafts[thread.root.id]?.trim();
                  if (!body) return;
                  replyComment.mutate(
                    {
                      resourceType,
                      resourceId,
                      commentId: thread.root.id,
                      body,
                    },
                    {
                      onSuccess: () =>
                        setReplyDrafts((current) => ({
                          ...current,
                          [thread.root.id]: "",
                        })),
                    },
                  );
                }}
              >
                <input
                  value={replyDrafts[thread.root.id] ?? ""}
                  onChange={(event) =>
                    setReplyDrafts((current) => ({
                      ...current,
                      [thread.root.id]: event.currentTarget.value,
                    }))
                  }
                  placeholder="Reply..."
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={
                    !replyDrafts[thread.root.id]?.trim() ||
                    replyComment.isPending
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Reply"
                >
                  <IconSend className="h-3.5 w-3.5" />
                </button>
                {thread.root.status !== "resolved" ? (
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input hover:bg-accent"
                    aria-label="Resolve thread"
                    onClick={() =>
                      resolveThread.mutate({
                        resourceType,
                        resourceId,
                        threadId: thread.root.threadId,
                      })
                    }
                  >
                    <IconCircleCheck className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent"
                  aria-label="Delete comment"
                  onClick={() =>
                    deleteComment.mutate({
                      resourceType,
                      resourceId,
                      commentId: thread.root.id,
                    })
                  }
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </form>
            </article>
          ))
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {emptyState}
          </div>
        )}
      </div>
    </section>
  );
}

export function buildReviewThreads(comments: ReviewComment[]): ReviewThread[] {
  const roots: ReviewComment[] = [];
  const replies = new Map<string, ReviewComment[]>();

  for (const comment of comments) {
    if (!comment.parentCommentId || comment.parentCommentId === comment.id) {
      roots.push(comment);
      continue;
    }
    const list = replies.get(comment.threadId) ?? [];
    list.push(comment);
    replies.set(comment.threadId, list);
  }

  return roots.map((root) => ({
    root,
    replies: replies.get(root.threadId) ?? [],
  }));
}

function CommentBubble({
  comment,
  compact = false,
}: {
  comment: ReviewComment;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "text-sm" : ""}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {comment.authorName ?? comment.authorEmail ?? "Reviewer"}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatCommentDate(comment.createdAt)}
        </span>
        {comment.status === "resolved" ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
            Resolved
          </span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
        {comment.body}
      </p>
    </div>
  );
}

function formatCommentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
