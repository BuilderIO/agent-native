import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconCircleCheck,
  IconDots,
  IconMessageCircle,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";

import type {
  ReviewComment,
  ReviewResolutionTarget,
} from "../../review/types.js";
import { useFormatters } from "../i18n.js";
import { cn } from "../utils.js";
import { ReviewCommentComposer } from "./ReviewCommentComposer.js";
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

export type ReviewThreadCapability =
  | boolean
  | ((thread: ReviewThread) => boolean);

export type ReviewCommentCapability =
  | boolean
  | ((comment: ReviewComment, thread: ReviewThread) => boolean);

export interface ReviewThreadPanelProps {
  resourceType: string;
  resourceId: string;
  targetId?: string | null;
  /** Persist new comments against this target while targetId continues to filter the list. */
  composerTargetId?: string | null;
  /** Optional element/point anchor attached to new comments from the composer. */
  composerAnchor?: unknown | null;
  /** Host metadata attached to new comments from the composer. */
  composerMetadata?: Record<string, unknown>;
  /** Visible label describing the element currently targeted by the composer. */
  composerContextLabel?: string;
  title?: string;
  className?: string;
  includeResolved?: boolean;
  showComposer?: boolean;
  showHeader?: boolean;
  variant?: "card" | "plain";
  placeholder?: string;
  emptyState?: string;
  loadingLabel?: string;
  replyLabel?: string;
  replyPlaceholder?: string;
  cancelReplyLabel?: string;
  resolveLabel?: string;
  deleteLabel?: string;
  moreActionsLabel?: string;
  resolvedLabel?: string;
  reviewerLabel?: string;
  onSelectThread?: (thread: ReviewThread) => void;
  onCommentCreated?: (comment: ReviewComment) => void;
  /** Allow signed-in commenters to reply. Omitted capabilities fail closed. */
  canReply?: ReviewThreadCapability;
  /** Allow editors to resolve a thread. Omitted capabilities fail closed. */
  canResolve?: ReviewThreadCapability;
  /** Allow deletion only for comments the caller has authorized. */
  canDeleteComment?: ReviewCommentCapability;
  /** Extra per-thread controls rendered next to reply/resolve/delete. */
  renderThreadActions?: (thread: ReviewThread) => ReactNode;
  /** Show a separate agent-submit action when the host supports agent routing. */
  showComposerTargetPicker?: boolean;
  composerCommentLabel?: string;
  composerAgentLabel?: string;
}

export function ReviewThreadPanel({
  resourceType,
  resourceId,
  targetId,
  composerTargetId,
  composerAnchor,
  composerMetadata,
  composerContextLabel,
  title = "Review",
  className,
  includeResolved = true,
  showComposer = true,
  showHeader = true,
  variant = "card",
  placeholder = "Add a comment...",
  emptyState = "No review comments yet.",
  loadingLabel = "Loading comments",
  replyLabel = "Reply",
  replyPlaceholder = "Reply...",
  cancelReplyLabel = "Cancel reply",
  resolveLabel = "Resolve",
  deleteLabel = "Delete comment",
  moreActionsLabel = "More actions",
  resolvedLabel = "Resolved",
  reviewerLabel = "Reviewer",
  onSelectThread,
  onCommentCreated,
  canReply = false,
  canResolve = false,
  canDeleteComment = false,
  renderThreadActions,
  showComposerTargetPicker = false,
  composerCommentLabel = "Comment",
  composerAgentLabel = "Send to agent",
}: ReviewThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const [submittingTarget, setSubmittingTarget] =
    useState<ReviewResolutionTarget | null>(null);
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const { formatDate } = useFormatters();
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

  const submitDraft = (resolutionTarget: ReviewResolutionTarget) => {
    const body = draft.trim();
    if (!body || createComment.isPending) return;
    setSubmittingTarget(resolutionTarget);
    createComment.mutate(
      {
        resourceType,
        resourceId,
        targetId: composerTargetId === undefined ? targetId : composerTargetId,
        ...(composerAnchor !== undefined ? { anchor: composerAnchor } : {}),
        ...(composerMetadata ? { metadata: composerMetadata } : {}),
        body,
        resolutionTarget: showComposerTargetPicker ? resolutionTarget : "human",
      },
      {
        onSuccess: (comment) => {
          setDraft("");
          onCommentCreated?.(comment);
        },
        onSettled: () => setSubmittingTarget(null),
      },
    );
  };

  return (
    <section
      className={cn(
        "@container/review overflow-hidden text-card-foreground",
        variant === "card"
          ? "rounded-lg border border-border bg-card"
          : "bg-transparent",
        className,
      )}
    >
      {showHeader ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <IconMessageCircle className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="truncate text-sm font-medium">{title}</h2>
          </div>
          <ReviewStatusBadge
            status={comments.data?.reviewStatus?.status}
            className="shrink-0"
          />
        </div>
      ) : null}

      {showComposer ? (
        <ReviewCommentComposer
          className="border-b border-border px-3 py-3"
          value={draft}
          onChange={setDraft}
          onSubmit={submitDraft}
          submittingTarget={submittingTarget}
          disabled={createComment.isPending}
          showAgentAction={showComposerTargetPicker}
          placeholder={placeholder}
          commentLabel={composerCommentLabel}
          agentLabel={composerAgentLabel}
          contextLabel={composerContextLabel}
        />
      ) : null}

      <div className="divide-y divide-border">
        {comments.isLoading ? (
          <div
            className="flex flex-col gap-3 px-3 py-4"
            aria-label={loadingLabel}
          >
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-7 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
            <Skeleton className="h-8 w-full" />
          </div>
        ) : threads.length ? (
          threads.map((thread) => {
            const replyDraft = replyDrafts[thread.root.id] ?? "";
            const replying = replyingThreadId === thread.root.threadId;
            const threadIsOpen = thread.root.status === "open";
            const replyAllowed =
              threadIsOpen && capabilityAllowsThread(canReply, thread);
            const resolveAllowed =
              threadIsOpen && capabilityAllowsThread(canResolve, thread);
            const deleteAllowed = capabilityAllowsComment(
              canDeleteComment,
              thread.root,
              thread,
            );
            const threadActions = renderThreadActions?.(thread);
            const hasActions =
              replyAllowed ||
              resolveAllowed ||
              deleteAllowed ||
              Boolean(threadActions);
            return (
              <article
                key={thread.root.threadId}
                className={cn(
                  "group/thread px-3 py-3 transition-colors",
                  onSelectThread && "cursor-pointer hover:bg-muted/30",
                )}
                onClick={() => onSelectThread?.(thread)}
              >
                <CommentBubble
                  comment={thread.root}
                  resolvedLabel={resolvedLabel}
                  reviewerLabel={reviewerLabel}
                  formatDate={formatDate}
                />
                {thread.replies.length ? (
                  <div className="ms-3 mt-3 flex flex-col gap-3 border-s border-border ps-3">
                    {thread.replies.map((reply) => (
                      <CommentBubble
                        key={reply.id}
                        comment={reply}
                        compact
                        resolvedLabel={resolvedLabel}
                        reviewerLabel={reviewerLabel}
                        formatDate={formatDate}
                      />
                    ))}
                  </div>
                ) : null}

                {replying && replyAllowed ? (
                  <form
                    className="mt-3 flex min-w-0 items-center gap-1.5"
                    onClick={(event) => event.stopPropagation()}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const body = replyDraft.trim();
                      if (!body || replyComment.isPending) return;
                      replyComment.mutate(
                        {
                          resourceType,
                          resourceId,
                          commentId: thread.root.id,
                          body,
                        },
                        {
                          onSuccess: () => {
                            setReplyDrafts((current) => ({
                              ...current,
                              [thread.root.id]: "",
                            }));
                            setReplyingThreadId(null);
                          },
                        },
                      );
                    }}
                  >
                    <Input
                      autoFocus
                      value={replyDraft}
                      onChange={(event) =>
                        setReplyDrafts((current) => ({
                          ...current,
                          [thread.root.id]: event.currentTarget.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setReplyingThreadId(null);
                        }
                      }}
                      placeholder={replyPlaceholder}
                      className="h-8 min-w-0 flex-1 text-sm"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      variant="outline"
                      className="size-8 shrink-0"
                      disabled={!replyDraft.trim() || replyComment.isPending}
                      aria-label={replyLabel}
                    >
                      {replyComment.isPending ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <IconSend className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0"
                      aria-label={cancelReplyLabel}
                      onClick={() => setReplyingThreadId(null)}
                    >
                      <IconX className="size-3.5" />
                    </Button>
                  </form>
                ) : hasActions ? (
                  <div
                    className="mt-2.5 flex min-w-0 items-center gap-0.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {replyAllowed ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 min-w-0 gap-1.5 px-1.5 text-xs @xs/review:px-2"
                        aria-label={replyLabel}
                        onClick={() =>
                          setReplyingThreadId(thread.root.threadId)
                        }
                      >
                        <IconMessageCircle className="size-3.5" />
                        <span className="hidden @2xs/review:inline">
                          {replyLabel}
                        </span>
                      </Button>
                    ) : null}
                    <div className="ms-auto flex min-w-0 items-center gap-0.5">
                      {threadActions}
                      {resolveAllowed ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 min-w-0 gap-1.5 px-1.5 text-xs @xs/review:px-2"
                          disabled={resolveThread.isPending}
                          aria-label={resolveLabel}
                          onClick={() =>
                            resolveThread.mutate({
                              resourceType,
                              resourceId,
                              threadId: thread.root.threadId,
                            })
                          }
                        >
                          {resolveThread.isPending ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <IconCircleCheck className="size-3.5" />
                          )}
                          <span className="hidden @xs/review:inline">
                            {resolveLabel}
                          </span>
                        </Button>
                      ) : null}
                      {deleteAllowed ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0"
                              aria-label={moreActionsLabel}
                            >
                              <IconDots className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              disabled={deleteComment.isPending}
                              className="text-destructive focus:text-destructive"
                              onSelect={() =>
                                deleteComment.mutate({
                                  resourceType,
                                  resourceId,
                                  commentId: thread.root.id,
                                })
                              }
                            >
                              <IconTrash className="size-4" />
                              {deleteLabel}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
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
  resolvedLabel,
  reviewerLabel,
  formatDate,
}: {
  comment: ReviewComment;
  compact?: boolean;
  resolvedLabel: string;
  reviewerLabel: string;
  formatDate: ReturnType<typeof useFormatters>["formatDate"];
}) {
  const author = comment.authorName ?? comment.authorEmail ?? reviewerLabel;
  const resolutionNote =
    comment.status === "resolved" ? getReviewResolutionNote(comment) : null;
  const bodyIsResolutionNote =
    resolutionNote !== null &&
    resolutionNote === comment.body.trim() &&
    isResolutionNoteMetadata(comment.metadata);
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Avatar className={compact ? "size-5" : "size-7"}>
        <AvatarFallback className="text-[10px] font-semibold text-muted-foreground">
          {authorInitials(author)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{author}</span>
          <time
            className="shrink-0 text-[11px] text-muted-foreground"
            dateTime={comment.createdAt}
          >
            {formatCommentDate(comment.createdAt, formatDate)}
          </time>
          {comment.status === "resolved" ? (
            <span className="hidden shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground @xs/review:inline-flex">
              {resolvedLabel}
            </span>
          ) : null}
        </div>
        {!bodyIsResolutionNote ? (
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap break-words text-foreground",
              compact ? "text-xs leading-5" : "text-sm leading-5",
            )}
          >
            {comment.body}
          </p>
        ) : null}
        {resolutionNote ? (
          <div
            className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-muted-foreground"
            aria-label={resolvedLabel}
          >
            <IconCircleCheck className="mt-0.5 size-3.5 shrink-0" />
            <p className="min-w-0 whitespace-pre-wrap break-words text-xs leading-4">
              {resolutionNote}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function capabilityAllowsThread(
  capability: ReviewThreadCapability,
  thread: ReviewThread,
): boolean {
  return typeof capability === "function" ? capability(thread) : capability;
}

function capabilityAllowsComment(
  capability: ReviewCommentCapability,
  comment: ReviewComment,
  thread: ReviewThread,
): boolean {
  return typeof capability === "function"
    ? capability(comment, thread)
    : capability;
}

function getReviewResolutionNote(comment: ReviewComment): string | null {
  const direct = comment.resolutionNote;
  const metadata = comment.metadata;
  const nestedResolution = metadata?.resolution;
  const nestedNote =
    isRecord(nestedResolution) && typeof nestedResolution.note === "string"
      ? nestedResolution.note
      : null;
  const metadataNote =
    typeof metadata?.resolutionNote === "string"
      ? metadata.resolutionNote
      : typeof metadata?.resolvedNote === "string"
        ? metadata.resolvedNote
        : isResolutionNoteMetadata(metadata) &&
            typeof metadata?.note === "string"
          ? metadata.note
          : isResolutionNoteMetadata(metadata)
            ? comment.body
            : null;
  const candidate =
    typeof direct === "string" ? direct : (metadataNote ?? nestedNote);
  const normalized = candidate?.trim();
  return normalized || null;
}

function isResolutionNoteMetadata(
  metadata: Record<string, unknown> | null,
): boolean {
  const marker = metadata?.type ?? metadata?.kind;
  return (
    marker === "resolution" ||
    marker === "resolution_note" ||
    marker === "resolution-note"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authorInitials(value: string): string {
  const normalized = value.split("@")[0]?.trim() ?? "";
  const parts = normalized.split(/[\s._+-]+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "R";
}

function formatCommentDate(
  value: string,
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return formatDate(date, { hour: "numeric", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return formatDate(date, { month: "short", day: "numeric" });
  }
  return formatDate(date, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
