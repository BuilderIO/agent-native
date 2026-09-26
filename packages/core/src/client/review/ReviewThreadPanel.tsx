import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconDots,
  IconFilter,
  IconLink,
  IconMessageCircle,
  IconMoodSmile,
  IconMail,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import type {
  ReviewComment,
  ReviewCommentReaction,
  ReviewMention,
  ReviewResolutionTarget,
} from "../../review/types.js";
import { writeClipboardText } from "../clipboard.js";
import { useFormatters } from "../i18n.js";
import { InlineMarkdown } from "../markdown/index.js";
import { useAvatarUrl } from "../use-avatar.js";
import { cn } from "../utils.js";
import { ReviewCommentComposer } from "./ReviewCommentComposer.js";
import { ReviewStatusBadge } from "./ReviewStatusBadge.js";
import {
  useCreateReviewComment,
  useDeleteReviewComment,
  useReactToReviewComment,
  useReplyReviewComment,
  useUpdateReviewComment,
  useResolveReviewThread,
  useReviewComments,
} from "./use-review.js";

const DEFAULT_REACTION_CHOICES = ["👍", "❤️", "🎉", "👀"] as const;
const MAX_REVIEW_IMAGE_ATTACHMENTS = 5;

interface ReviewCommentAttachment {
  url: string;
  name: string;
}

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

export type ReviewCommentFilter = "all" | "open" | "resolved";

export interface ReviewThreadPanelProps {
  resourceType: string;
  resourceId: string;
  targetId?: string | null;
  newestFirst?: boolean;
  limit?: number;
  unreadOnly?: boolean;
  composerTargetId?: string | null;
  composerAnchor?: unknown;
  composerMetadata?: Record<string, unknown>;
  composerContextLabel?: string;
  title?: string;
  className?: string;
  includeResolved?: boolean;
  showFilter?: boolean;
  filterLabel?: string;
  allCommentsLabel?: string;
  openCommentsLabel?: string;
  resolvedCommentsLabel?: string;
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
  unreadLabel?: string;
  agentLabel?: string;
  onSelectThread?: (thread: ReviewThread) => void;
  onCommentCreated?: (comment: ReviewComment) => void;
  threadFilter?: (thread: ReviewThread) => boolean;
  threadSort?: (left: ReviewThread, right: ReviewThread) => number;
  onCopyThreadLink?: (thread: ReviewThread) => void;
  onMarkThreadUnread?: (thread: ReviewThread) => void;
  onSetThreadUnread?: (thread: ReviewThread, unread: boolean) => void;
  copyLinkLabel?: string;
  markUnreadLabel?: string;
  markReadLabel?: string;
  showReactions?: boolean;
  reactionChoices?: readonly string[];
  addReactionLabel?: string;
  onReactionError?: () => void;
  mentionOptions?: readonly ReviewMention[];
  showComposerTools?: boolean;
  canEditComment?: ReviewCommentCapability;
  editLabel?: string;
  saveEditLabel?: string;
  cancelEditLabel?: string;
  onCommentUpdated?: (comment: ReviewComment) => void;
  onThreadResolved?: (thread: ReviewThread) => void;
  onThreadReopened?: (thread: ReviewThread) => void;
  reopenLabel?: string;
  reopeningLabel?: string;
  confirmDeleteTitle?: string;
  confirmDeleteDescription?: string;
  confirmDeleteLabel?: string;
  cancelDeleteLabel?: string;
  canReply?: ReviewThreadCapability;
  canResolve?: ReviewThreadCapability;
  canDeleteComment?: ReviewCommentCapability;
  canCopyLink?: ReviewThreadCapability;
  linkCopiedLabel?: string;
  copyLinkFailedLabel?: string;
  renderThreadActions?: (thread: ReviewThread) => ReactNode;
  showComposerTargetPicker?: boolean;
  composerCommentLabel?: string;
  composerAgentLabel?: string;
}

export function ReviewThreadPanel({
  resourceType,
  resourceId,
  targetId,
  newestFirst,
  limit,
  unreadOnly = false,
  composerTargetId,
  composerAnchor,
  composerMetadata,
  composerContextLabel,
  title = "Review",
  className,
  includeResolved = true,
  showFilter = false,
  filterLabel = "Filter comments",
  allCommentsLabel = "All",
  openCommentsLabel = "Open",
  resolvedCommentsLabel = "Resolved",
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
  unreadLabel = "Unread",
  agentLabel,
  onSelectThread,
  onCommentCreated,
  threadFilter,
  threadSort,
  onCopyThreadLink,
  onMarkThreadUnread,
  onSetThreadUnread,
  copyLinkLabel = "Copy link",
  markUnreadLabel = "Mark as unread",
  markReadLabel = "Mark as read",
  showReactions = false,
  reactionChoices = DEFAULT_REACTION_CHOICES,
  addReactionLabel = "Add reaction",
  onReactionError,
  mentionOptions = [],
  showComposerTools = false,
  canEditComment = false,
  editLabel = "Edit comment",
  saveEditLabel = "Save",
  cancelEditLabel = "Cancel",
  onCommentUpdated,
  onThreadResolved,
  onThreadReopened,
  reopenLabel = "Reopen",
  reopeningLabel = "Reopening…",
  confirmDeleteTitle = "Delete comment?",
  confirmDeleteDescription = "This removes the comment from the review thread.",
  confirmDeleteLabel = "Delete",
  cancelDeleteLabel = "Cancel",
  canReply = false,
  canResolve = false,
  canDeleteComment = false,
  canCopyLink = false,
  linkCopiedLabel = "Link copied",
  copyLinkFailedLabel = "Couldn’t copy link",
  renderThreadActions,
  showComposerTargetPicker = false,
  composerCommentLabel = "Comment",
  composerAgentLabel = "Send to agent",
}: ReviewThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<ReviewMention[]>([]);
  const draftRef = useRef("");
  const draftMentionsRef = useRef<ReviewMention[]>([]);
  const draftGenerationRef = useRef(0);
  const createRetryRef = useRef<{ key: string; id: string } | null>(null);
  const [failedCreates, setFailedCreates] = useState<
    Array<{
      id: string;
      resourceType: string;
      resourceId: string;
      body: string;
      mentions: ReviewMention[];
      resolutionTarget: ReviewResolutionTarget;
      targetId?: string | null;
      anchor?: ReviewComment["anchor"];
      metadata?: ReviewComment["metadata"];
    }>
  >([]);
  const createPendingRef = useRef(false);
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
  const replyingThreadIdRef = useRef<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const replyDraftsRef = useRef<Record<string, string>>({});
  const [replyMentions, setReplyMentions] = useState<
    Record<string, ReviewMention[]>
  >({});
  const replyMentionsRef = useRef<Record<string, ReviewMention[]>>({});
  const replyGenerationsRef = useRef<Record<string, number>>({});
  const replyRetriesRef = useRef<Record<string, { key: string; id: string }>>(
    {},
  );
  const [failedReplies, setFailedReplies] = useState<
    Record<
      string,
      Array<{
        id: string;
        resourceType: string;
        resourceId: string;
        body: string;
        mentions: ReviewMention[];
      }>
    >
  >({});
  const replyPendingRef = useRef<Set<string>>(new Set());
  const [editCandidate, setEditCandidate] = useState<ReviewComment | null>(
    null,
  );
  const editCandidateRef = useRef<ReviewComment | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editDraftRef = useRef("");
  const [editMentions, setEditMentions] = useState<ReviewMention[]>([]);
  const editMentionsRef = useRef<ReviewMention[]>([]);
  const editGenerationRef = useRef(0);
  const [deleteCandidate, setDeleteCandidate] = useState<ReviewComment | null>(
    null,
  );
  const deleteCandidateRef = useRef<ReviewComment | null>(null);
  const deleteGenerationRef = useRef(0);
  const deletingCommentIdRef = useRef<string | null>(null);
  const [resolvingThreadIds, setResolvingThreadIds] = useState<Set<string>>(
    () => new Set(),
  );
  const resolvingThreadIdsRef = useRef(new Set<string>());
  const [commentFilter, setCommentFilter] = useState<ReviewCommentFilter>(
    showFilter ? "open" : "all",
  );
  const [copyPendingThreadId, setCopyPendingThreadId] = useState<string | null>(
    null,
  );
  const [copyStatus, setCopyStatus] = useState<{
    threadId: string;
    status: "copied" | "failed";
  } | null>(null);
  const formatters = useFormatters();
  const formatDate = formatters.formatDate.bind(formatters);
  const comments = useReviewComments({
    resourceType,
    resourceId,
    targetId,
    includeResolved: includeResolved && commentFilter !== "open",
    newestFirst,
    limit,
  });
  const createComment = useCreateReviewComment();
  const replyComment = useReplyReviewComment();
  const resolveThread = useResolveReviewThread();
  const deleteComment = useDeleteReviewComment();
  const reactToComment = useReactToReviewComment();
  const updateComment = useUpdateReviewComment();
  const threads = useMemo(() => {
    const next = buildReviewThreads(comments.data?.comments ?? []);
    const filtered = threadFilter ? next.filter(threadFilter) : next;
    return threadSort ? filtered.sort(threadSort) : filtered;
  }, [comments.data?.comments, threadFilter, threadSort]);

  const visibleThreads = useMemo(() => {
    const statusFiltered =
      commentFilter === "all"
        ? threads
        : threads.filter((thread) => thread.root.status === commentFilter);
    if (!unreadOnly) return statusFiltered;
    const preferences = comments.data?.discussion?.threadPreferences ?? {};
    return statusFiltered.filter(
      (thread) => preferences[thread.root.threadId]?.unread === true,
    );
  }, [commentFilter, comments.data?.discussion, threads, unreadOnly]);

  const handleReaction = (
    comment: ReviewComment,
    reaction: string,
    active: boolean,
  ) => {
    if (!comments.data?.discussion?.canReact || reactToComment.isPending)
      return;
    reactToComment.mutate(
      {
        resourceType,
        resourceId,
        commentId: comment.id,
        reaction,
        active,
      },
      { onError: onReactionError },
    );
  };

  const copyThreadLink = async (thread: ReviewThread) => {
    if (copyPendingThreadId) return;
    const href = typeof window === "undefined" ? null : window.location.href;
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return;
    }
    url.hash = `review-thread=${encodeURIComponent(thread.root.threadId)}`;
    setCopyPendingThreadId(thread.root.threadId);
    let copied = false;
    try {
      copied = await writeClipboardText(url.toString());
    } catch {
      copied = false;
    }
    setCopyPendingThreadId(null);
    setCopyStatus({
      threadId: thread.root.threadId,
      status: copied ? "copied" : "failed",
    });
    window.setTimeout(() => {
      setCopyStatus((current) =>
        current?.threadId === thread.root.threadId ? null : current,
      );
    }, 1_500);
  };

  const filterText =
    commentFilter === "open"
      ? openCommentsLabel
      : commentFilter === "resolved"
        ? resolvedCommentsLabel
        : allCommentsLabel;

  const submitDraft = async (resolutionTarget: ReviewResolutionTarget) => {
    if (createPendingRef.current) return;
    const submittedDraft = draftRef.current;
    const body = submittedDraft.trim();
    if (!body) return;
    const submittedMentions = [...draftMentionsRef.current];
    const retryKey = JSON.stringify({
      body,
      mentions: submittedMentions,
      resolutionTarget,
      targetId: composerTargetId === undefined ? targetId : composerTargetId,
      anchor: composerAnchor,
      metadata: composerMetadata,
    });
    const operationId =
      createRetryRef.current?.key === retryKey
        ? createRetryRef.current.id
        : globalThis.crypto.randomUUID();
    const generation = draftGenerationRef.current;
    createPendingRef.current = true;
    draftRef.current = "";
    draftMentionsRef.current = [];
    setDraft("");
    setDraftMentions([]);
    try {
      const comment = await createComment.mutateAsync({
        resourceType,
        resourceId,
        targetId: composerTargetId === undefined ? targetId : composerTargetId,
        ...(composerAnchor !== undefined ? { anchor: composerAnchor } : {}),
        ...(composerMetadata ? { metadata: composerMetadata } : {}),
        body,
        ...(submittedMentions.length ? { mentions: submittedMentions } : {}),
        resolutionTarget: showComposerTargetPicker ? resolutionTarget : "human",
        clientOperationId: operationId,
      });
      if (createRetryRef.current?.id === operationId) {
        createRetryRef.current = null;
      }
      onCommentCreated?.(comment);
    } catch {
      if (
        draftGenerationRef.current !== generation ||
        draftRef.current !== ""
      ) {
        setFailedCreates((current) => [
          ...current,
          {
            id: operationId,
            resourceType,
            resourceId,
            body,
            mentions: submittedMentions,
            resolutionTarget: showComposerTargetPicker
              ? resolutionTarget
              : "human",
            targetId:
              composerTargetId === undefined ? targetId : composerTargetId,
            anchor: composerAnchor,
            metadata: composerMetadata,
          },
        ]);
        return;
      }
      createRetryRef.current = { key: retryKey, id: operationId };
      draftRef.current = submittedDraft;
      draftMentionsRef.current = submittedMentions;
      setDraft(submittedDraft);
      setDraftMentions(submittedMentions);
    } finally {
      createPendingRef.current = false;
    }
  };

  const retryFailedCreate = async (failed: (typeof failedCreates)[number]) => {
    if (
      createPendingRef.current ||
      failed.resourceType !== resourceType ||
      failed.resourceId !== resourceId
    )
      return;
    createPendingRef.current = true;
    try {
      const comment = await createComment.mutateAsync({
        resourceType: failed.resourceType,
        resourceId: failed.resourceId,
        targetId: failed.targetId,
        ...(failed.anchor !== undefined ? { anchor: failed.anchor } : {}),
        ...(failed.metadata ? { metadata: failed.metadata } : {}),
        body: failed.body,
        ...(failed.mentions.length ? { mentions: failed.mentions } : {}),
        resolutionTarget: failed.resolutionTarget,
        clientOperationId: failed.id,
      });
      setFailedCreates((current) =>
        current.filter((item) => item.id !== failed.id),
      );
      onCommentCreated?.(comment);
    } catch {
      return;
    } finally {
      createPendingRef.current = false;
    }
  };

  const submitEdit = async () => {
    const comment = editCandidate;
    const body = editDraft.trim();
    if (!comment || !body) return;
    const submittedDraft = editDraft;
    const submittedMentions = [...editMentions];
    const generation = editGenerationRef.current;
    editCandidateRef.current = null;
    editDraftRef.current = "";
    editMentionsRef.current = [];
    setEditCandidate(null);
    setEditDraft("");
    setEditMentions([]);
    try {
      const updated = await updateComment.mutateAsync({
        resourceType,
        resourceId,
        commentId: comment.id,
        body,
        mentions: submittedMentions,
      });
      onCommentUpdated?.(updated);
    } catch {
      if (
        editGenerationRef.current !== generation ||
        editCandidateRef.current
      ) {
        return;
      }
      editCandidateRef.current = comment;
      editDraftRef.current = submittedDraft;
      editMentionsRef.current = submittedMentions;
      setEditCandidate(comment);
      setEditDraft(submittedDraft);
      setEditMentions(submittedMentions);
    }
  };

  const startEditing = (comment: ReviewComment) => {
    editGenerationRef.current += 1;
    editCandidateRef.current = comment;
    editDraftRef.current = comment.body;
    editMentionsRef.current = [...comment.mentions];
    setEditCandidate(comment);
    setEditDraft(comment.body);
    setEditMentions([...comment.mentions]);
  };

  const cancelEditing = () => {
    editGenerationRef.current += 1;
    editCandidateRef.current = null;
    editDraftRef.current = "";
    editMentionsRef.current = [];
    setEditCandidate(null);
    setEditDraft("");
    setEditMentions([]);
  };

  const startReplying = (threadId: string) => {
    replyingThreadIdRef.current = threadId;
    setReplyingThreadId(threadId);
  };

  const cancelReplying = () => {
    replyingThreadIdRef.current = null;
    setReplyingThreadId(null);
  };

  const submitReply = async (comment: ReviewComment) => {
    if (replyPendingRef.current.has(comment.id)) return;
    const threadId = comment.threadId;
    const submittedDraft = replyDraftsRef.current[comment.id] ?? "";
    const body = submittedDraft.trim();
    if (!body) return;
    const submittedMentions = [...(replyMentionsRef.current[comment.id] ?? [])];
    const retryKey = JSON.stringify({ body, mentions: submittedMentions });
    const retry = replyRetriesRef.current[comment.id];
    const operationId =
      retry?.key === retryKey ? retry.id : globalThis.crypto.randomUUID();
    const generation = replyGenerationsRef.current[comment.id] ?? 0;
    replyPendingRef.current.add(comment.id);
    replyDraftsRef.current = {
      ...replyDraftsRef.current,
      [comment.id]: "",
    };
    replyMentionsRef.current = {
      ...replyMentionsRef.current,
      [comment.id]: [],
    };
    setReplyDrafts((current) => ({ ...current, [comment.id]: "" }));
    setReplyMentions((current) => ({ ...current, [comment.id]: [] }));
    if (replyingThreadIdRef.current === threadId) cancelReplying();

    try {
      await replyComment.mutateAsync({
        resourceType,
        resourceId,
        commentId: comment.id,
        body,
        ...(submittedMentions.length ? { mentions: submittedMentions } : {}),
        clientOperationId: operationId,
      });
      if (replyRetriesRef.current[comment.id]?.id === operationId) {
        delete replyRetriesRef.current[comment.id];
      }
    } catch {
      if (
        (replyGenerationsRef.current[comment.id] ?? 0) !== generation ||
        (replyDraftsRef.current[comment.id] ?? "") !== ""
      ) {
        setFailedReplies((current) => ({
          ...current,
          [comment.id]: [
            ...(current[comment.id] ?? []),
            {
              id: operationId,
              resourceType,
              resourceId,
              body,
              mentions: submittedMentions,
            },
          ],
        }));
        return;
      }
      replyRetriesRef.current[comment.id] = { key: retryKey, id: operationId };
      replyDraftsRef.current = {
        ...replyDraftsRef.current,
        [comment.id]: submittedDraft,
      };
      replyMentionsRef.current = {
        ...replyMentionsRef.current,
        [comment.id]: submittedMentions,
      };
      setReplyDrafts((current) => ({
        ...current,
        [comment.id]: submittedDraft,
      }));
      setReplyMentions((current) => ({
        ...current,
        [comment.id]: submittedMentions,
      }));
      if (replyingThreadIdRef.current === null) startReplying(threadId);
    } finally {
      replyPendingRef.current.delete(comment.id);
    }
  };

  const retryFailedReply = async (
    comment: ReviewComment,
    failed: (typeof failedReplies)[string][number],
  ) => {
    if (
      replyPendingRef.current.has(comment.id) ||
      failed.resourceType !== resourceType ||
      failed.resourceId !== resourceId
    )
      return;
    replyPendingRef.current.add(comment.id);
    try {
      await replyComment.mutateAsync({
        resourceType: failed.resourceType,
        resourceId: failed.resourceId,
        commentId: comment.id,
        body: failed.body,
        ...(failed.mentions.length ? { mentions: failed.mentions } : {}),
        clientOperationId: failed.id,
      });
      setFailedReplies((current) => ({
        ...current,
        [comment.id]: (current[comment.id] ?? []).filter(
          (item) => item.id !== failed.id,
        ),
      }));
    } catch {
      return;
    } finally {
      replyPendingRef.current.delete(comment.id);
    }
  };

  const setThreadResolution = async (
    thread: ReviewThread,
    status: "open" | "resolved",
  ) => {
    const threadId = thread.root.threadId;
    if (resolvingThreadIdsRef.current.has(threadId)) return;
    resolvingThreadIdsRef.current.add(threadId);
    setResolvingThreadIds((current) => new Set(current).add(threadId));
    try {
      await resolveThread.mutateAsync({
        resourceType,
        resourceId,
        threadId,
        status,
      });
      status === "open"
        ? onThreadReopened?.(thread)
        : onThreadResolved?.(thread);
    } catch (error) {
      console.error("Failed to update review thread status", error);
    } finally {
      resolvingThreadIdsRef.current.delete(threadId);
      setResolvingThreadIds((current) => {
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
    }
  };

  const openDeleteDialog = (comment: ReviewComment) => {
    deleteGenerationRef.current += 1;
    deleteCandidateRef.current = comment;
    setDeleteCandidate(comment);
  };

  const closeDeleteDialog = () => {
    if (!deleteCandidateRef.current && deletingCommentIdRef.current) return;
    deleteGenerationRef.current += 1;
    deleteCandidateRef.current = null;
    setDeleteCandidate(null);
  };

  const submitDelete = async () => {
    const candidate = deleteCandidateRef.current;
    if (!candidate) return;
    const generation = deleteGenerationRef.current;
    deletingCommentIdRef.current = candidate.id;
    deleteCandidateRef.current = null;
    setDeleteCandidate(null);
    try {
      await deleteComment.mutateAsync({
        resourceType,
        resourceId,
        commentId: candidate.id,
      });
    } catch {
      if (
        deleteGenerationRef.current === generation &&
        !deleteCandidateRef.current
      ) {
        deleteCandidateRef.current = candidate;
        setDeleteCandidate(candidate);
      }
    } finally {
      if (deletingCommentIdRef.current === candidate.id) {
        deletingCommentIdRef.current = null;
      }
    }
  };

  return (
    <>
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
            mentions={draftMentions}
            onMentionsChange={(mentions) => {
              draftMentionsRef.current = mentions;
              setDraftMentions(mentions);
            }}
            mentionOptions={mentionOptions}
            showCommentTools={showComposerTools}
            onChange={(value) => {
              draftGenerationRef.current += 1;
              draftRef.current = value;
              setDraft(value);
              setDraftMentions((current) => {
                const next = current.filter((mention) =>
                  value.includes(`@${mention.label}`),
                );
                draftMentionsRef.current = next;
                return next;
              });
            }}
            onSubmit={submitDraft}
            showAgentAction={showComposerTargetPicker}
            placeholder={placeholder}
            commentLabel={composerCommentLabel}
            agentLabel={composerAgentLabel}
            contextLabel={composerContextLabel}
          />
        ) : null}
        {failedCreates
          .filter(
            (failed) =>
              failed.resourceType === resourceType &&
              failed.resourceId === resourceId,
          )
          .map((failed) => (
            <div
              key={failed.id}
              className="flex items-start gap-2 border-b border-border px-3 py-2 text-sm"
              data-review-failed-create={failed.id}
            >
              <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {failed.body}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={createPendingRef.current}
                onClick={() => void retryFailedCreate(failed)}
              >
                {failed.resolutionTarget === "agent"
                  ? composerAgentLabel
                  : composerCommentLabel}
              </Button>
            </div>
          ))}

        {showFilter ? (
          <div className="flex items-center justify-end border-b border-border px-3 py-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                  aria-label={filterLabel}
                  data-review-filter-trigger
                >
                  <IconFilter className="size-3.5" />
                  <span>{filterText}</span>
                  <IconChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuRadioGroup
                  value={commentFilter}
                  onValueChange={(value) => {
                    if (
                      value === "all" ||
                      value === "open" ||
                      value === "resolved"
                    ) {
                      setCommentFilter(value);
                    }
                  }}
                >
                  <DropdownMenuRadioItem value="all">
                    {allCommentsLabel}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="open">
                    {openCommentsLabel}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="resolved">
                    {resolvedCommentsLabel}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
          ) : visibleThreads.length ? (
            visibleThreads.map((thread) => {
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
              const editAllowed = capabilityAllowsComment(
                canEditComment,
                thread.root,
                thread,
              );
              const copyLinkAllowed = capabilityAllowsThread(
                canCopyLink,
                thread,
              );
              const copyState =
                copyStatus?.threadId === thread.root.threadId
                  ? copyStatus.status
                  : null;
              const threadActions = renderThreadActions?.(thread);
              const threadUnread = Boolean(
                comments.data?.discussion?.threadPreferences[
                  thread.root.threadId
                ]?.unread,
              );
              const reopenAllowed =
                thread.root.status === "resolved" &&
                capabilityAllowsThread(canResolve, thread);
              const hasMenuActions =
                editAllowed ||
                deleteAllowed ||
                copyLinkAllowed ||
                Boolean(onCopyThreadLink) ||
                Boolean(onMarkThreadUnread || onSetThreadUnread);
              const hasActions =
                replyAllowed ||
                resolveAllowed ||
                reopenAllowed ||
                hasMenuActions ||
                Boolean(threadActions);
              return (
                <article
                  key={thread.root.threadId}
                  className={cn(
                    "group/thread px-3 py-3 transition-colors",
                    threadUnread && "bg-primary/[0.03]",
                    onSelectThread && "cursor-pointer hover:bg-muted/30",
                  )}
                  data-review-thread-unread={threadUnread ? "true" : undefined}
                  onClick={() => onSelectThread?.(thread)}
                >
                  {editCandidate?.id === thread.root.id ? (
                    <div className="mt-3 flex min-w-0 items-start gap-1.5">
                      <ReviewCommentComposer
                        className="min-w-0 flex-1"
                        value={editDraft}
                        mentions={editMentions}
                        onMentionsChange={(mentions) => {
                          editMentionsRef.current = mentions;
                          setEditMentions(mentions);
                        }}
                        mentionOptions={mentionOptions}
                        showCommentTools={showComposerTools}
                        onChange={(value) => {
                          editGenerationRef.current += 1;
                          editDraftRef.current = value;
                          setEditDraft(value);
                        }}
                        onSubmit={submitEdit}
                        commentLabel={saveEditLabel}
                        placeholder={editLabel}
                        textareaProps={{ "aria-label": editLabel }}
                        submitOnEnter
                        onEscape={cancelEditing}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="mt-1 size-8 shrink-0"
                        aria-label={cancelEditLabel}
                        onClick={cancelEditing}
                      >
                        <IconX className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <CommentBubble
                      comment={thread.root}
                      resolvedLabel={resolvedLabel}
                      reviewerLabel={reviewerLabel}
                      agentLabel={agentLabel}
                      unread={threadUnread}
                      unreadLabel={unreadLabel}
                      formatDate={formatDate}
                      reactions={
                        comments.data?.discussion?.reactions[thread.root.id]
                      }
                      canReact={comments.data?.discussion?.canReact ?? false}
                      showReactions={showReactions}
                      reactionChoices={reactionChoices}
                      addReactionLabel={addReactionLabel}
                      onReact={handleReaction}
                    />
                  )}
                  {thread.replies.length ? (
                    <div className="ms-3 mt-3 flex flex-col gap-3 border-s border-border ps-3">
                      {thread.replies.map((reply) => (
                        <CommentBubble
                          key={reply.id}
                          comment={reply}
                          compact
                          resolvedLabel={resolvedLabel}
                          reviewerLabel={reviewerLabel}
                          agentLabel={agentLabel}
                          unread={false}
                          unreadLabel={unreadLabel}
                          formatDate={formatDate}
                          reactions={
                            comments.data?.discussion?.reactions[reply.id]
                          }
                          canReact={
                            comments.data?.discussion?.canReact ?? false
                          }
                          showReactions={showReactions}
                          reactionChoices={reactionChoices}
                          addReactionLabel={addReactionLabel}
                          onReact={handleReaction}
                        />
                      ))}
                    </div>
                  ) : null}

                  {(failedReplies[thread.root.id] ?? [])
                    .filter(
                      (failed) =>
                        failed.resourceType === resourceType &&
                        failed.resourceId === resourceId,
                    )
                    .map((failed) => (
                      <div
                        key={failed.id}
                        className="mt-2 flex items-start gap-2 text-sm"
                        data-review-failed-reply={failed.id}
                      >
                        <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                          {failed.body}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={replyPendingRef.current.has(thread.root.id)}
                          onClick={() =>
                            void retryFailedReply(thread.root, failed)
                          }
                        >
                          {replyLabel}
                        </Button>
                      </div>
                    ))}
                  {replying && replyAllowed ? (
                    <div
                      className="mt-3 flex min-w-0 items-start gap-1.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ReviewCommentComposer
                        className="min-w-0 flex-1"
                        value={replyDraft}
                        mentions={replyMentions[thread.root.id] ?? []}
                        mentionOptions={mentionOptions}
                        onMentionsChange={(mentions) => {
                          replyMentionsRef.current = {
                            ...replyMentionsRef.current,
                            [thread.root.id]: mentions,
                          };
                          setReplyMentions((current) => ({
                            ...current,
                            [thread.root.id]: mentions,
                          }));
                        }}
                        showCommentTools={showComposerTools}
                        onChange={(value) => {
                          replyGenerationsRef.current = {
                            ...replyGenerationsRef.current,
                            [thread.root.id]:
                              (replyGenerationsRef.current[thread.root.id] ??
                                0) + 1,
                          };
                          replyDraftsRef.current = {
                            ...replyDraftsRef.current,
                            [thread.root.id]: value,
                          };
                          setReplyDrafts((current) => ({
                            ...current,
                            [thread.root.id]: value,
                          }));
                          setReplyMentions((current) => ({
                            ...current,
                            [thread.root.id]: (
                              current[thread.root.id] ?? []
                            ).filter((mention) =>
                              value.includes(`@${mention.label}`),
                            ),
                          }));
                          replyMentionsRef.current = {
                            ...replyMentionsRef.current,
                            [thread.root.id]: (
                              replyMentionsRef.current[thread.root.id] ?? []
                            ).filter((mention) =>
                              value.includes(`@${mention.label}`),
                            ),
                          };
                        }}
                        onSubmit={() => submitReply(thread.root)}
                        placeholder={replyPlaceholder}
                        commentLabel={replyLabel}
                        submitOnEnter
                        onEscape={cancelReplying}
                        textareaProps={{ "data-review-reply-input": true }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 shrink-0"
                        aria-label={cancelReplyLabel}
                        onClick={cancelReplying}
                      >
                        <IconX className="size-3.5" />
                      </Button>
                    </div>
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
                          onClick={() => startReplying(thread.root.threadId)}
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
                            disabled={resolvingThreadIds.has(
                              thread.root.threadId,
                            )}
                            aria-label={resolveLabel}
                            onClick={() =>
                              setThreadResolution(thread, "resolved")
                            }
                          >
                            {resolvingThreadIds.has(thread.root.threadId) ? (
                              <Spinner className="size-3.5" />
                            ) : (
                              <IconCircleCheck className="size-3.5" />
                            )}
                            <span className="hidden @xs/review:inline">
                              {resolveLabel}
                            </span>
                          </Button>
                        ) : null}
                        {reopenAllowed ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 min-w-0 gap-1.5 px-1.5 text-xs @xs/review:px-2"
                            disabled={resolvingThreadIds.has(
                              thread.root.threadId,
                            )}
                            aria-label={reopenLabel}
                            onClick={() => setThreadResolution(thread, "open")}
                          >
                            {resolvingThreadIds.has(thread.root.threadId) ? (
                              <Spinner className="size-3.5" />
                            ) : (
                              <IconCircleCheck className="size-3.5" />
                            )}
                            <span className="hidden @xs/review:inline">
                              {resolvingThreadIds.has(thread.root.threadId)
                                ? reopeningLabel
                                : reopenLabel}
                            </span>
                          </Button>
                        ) : null}
                        {hasMenuActions ? (
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
                              {editAllowed ? (
                                <DropdownMenuItem
                                  onSelect={() => startEditing(thread.root)}
                                >
                                  {editLabel}
                                </DropdownMenuItem>
                              ) : null}
                              {onSetThreadUnread || onMarkThreadUnread ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    if (onSetThreadUnread) {
                                      onSetThreadUnread(thread, !threadUnread);
                                    } else {
                                      onMarkThreadUnread?.(thread);
                                    }
                                  }}
                                >
                                  <IconMail className="size-4" />
                                  {onSetThreadUnread && threadUnread
                                    ? markReadLabel
                                    : markUnreadLabel}
                                </DropdownMenuItem>
                              ) : null}
                              {onCopyThreadLink ? (
                                <DropdownMenuItem
                                  onSelect={() => onCopyThreadLink(thread)}
                                >
                                  <IconLink className="size-4" />
                                  {copyLinkLabel}
                                </DropdownMenuItem>
                              ) : copyLinkAllowed ? (
                                <DropdownMenuItem
                                  disabled={copyPendingThreadId !== null}
                                  onSelect={() => void copyThreadLink(thread)}
                                >
                                  {copyState === "copied" ? (
                                    <IconCheck className="size-4" />
                                  ) : copyState === "failed" ? (
                                    <IconAlertCircle className="size-4" />
                                  ) : (
                                    <IconLink className="size-4" />
                                  )}
                                  {copyState === "copied"
                                    ? linkCopiedLabel
                                    : copyState === "failed"
                                      ? copyLinkFailedLabel
                                      : copyLinkLabel}
                                </DropdownMenuItem>
                              ) : null}
                              {deleteAllowed ? (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => openDeleteDialog(thread.root)}
                                >
                                  <IconTrash className="size-4" />
                                  {deleteLabel}
                                </DropdownMenuItem>
                              ) : null}
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
      <AlertDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDeleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelDeleteLabel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!deleteCandidate}
              onClick={(event) => {
                event.preventDefault();
                submitDelete();
              }}
            >
              {confirmDeleteLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  agentLabel,
  unread = false,
  unreadLabel = "Unread",
  formatDate,
  reactions = [],
  canReact = false,
  showReactions = false,
  reactionChoices,
  addReactionLabel,
  onReact,
}: {
  comment: ReviewComment;
  compact?: boolean;
  resolvedLabel: string;
  reviewerLabel: string;
  agentLabel?: string;
  unread?: boolean;
  unreadLabel?: string;
  formatDate: ReturnType<typeof useFormatters>["formatDate"];
  reactions?: ReviewCommentReaction[];
  canReact?: boolean;
  showReactions?: boolean;
  reactionChoices: readonly string[];
  addReactionLabel: string;
  onReact: (comment: ReviewComment, reaction: string, active: boolean) => void;
}) {
  const author =
    (comment.createdBy === "agent" ? agentLabel : undefined) ??
    comment.authorName ??
    comment.authorEmail ??
    reviewerLabel;
  const avatarUrl = useAvatarUrl(comment.authorEmail);
  const resolutionNote =
    comment.status === "resolved" ? getReviewResolutionNote(comment) : null;
  const bodyIsResolutionNote =
    resolutionNote !== null &&
    resolutionNote === comment.body.trim() &&
    isResolutionNoteMetadata(comment.metadata);
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Avatar className={compact ? "size-5" : "size-7"}>
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={author} /> : null}
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
          {unread ? (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
              <span className="sr-only">{unreadLabel}</span>
            </>
          ) : null}
          {comment.status === "resolved" ? (
            <span className="hidden shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground @xs/review:inline-flex">
              {resolvedLabel}
            </span>
          ) : null}
        </div>
        {!bodyIsResolutionNote ? (
          <InlineMarkdown
            content={displayReviewCommentBody(comment.body)}
            className={cn(
              "mt-1 text-foreground",
              compact ? "text-xs leading-5" : "text-sm leading-5",
            )}
          />
        ) : null}
        {resolutionNote ? (
          <div
            className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-muted-foreground"
            aria-label={resolvedLabel}
          >
            <IconCircleCheck className="mt-0.5 size-3.5 shrink-0" />
            <InlineMarkdown
              content={displayReviewCommentBody(resolutionNote)}
              className="min-w-0 text-xs leading-4"
            />
          </div>
        ) : null}
        <ReviewCommentAttachmentStrip comment={comment} compact={compact} />
        {showReactions ? (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {reactions.map((item) => (
              <button
                key={item.reaction}
                type="button"
                disabled={!canReact}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
                  item.reactedByMe
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
                onClick={() =>
                  onReact(comment, item.reaction, !item.reactedByMe)
                }
                aria-label={`${item.reaction} ${item.count}`}
              >
                <span aria-hidden="true">{item.reaction}</span>
                <span>{item.count}</span>
              </button>
            ))}
            {canReact ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-full text-muted-foreground"
                    aria-label={addReactionLabel}
                  >
                    <IconMoodSmile className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="flex w-auto gap-0.5 p-1"
                >
                  {reactionChoices.map((reaction) => (
                    <DropdownMenuItem
                      key={reaction}
                      className="size-8 justify-center p-0 text-base"
                      onSelect={() => onReact(comment, reaction, true)}
                    >
                      <span aria-hidden="true">{reaction}</span>
                      <span className="sr-only">{reaction}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReviewCommentAttachmentStrip({
  comment,
  compact,
}: {
  comment: ReviewComment;
  compact: boolean;
}) {
  const attachments = reviewCommentAttachments(comment);
  if (!attachments.length) return null;
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap gap-1.5",
        compact ? "max-w-56" : "max-w-64",
      )}
      data-review-comment-attachments
    >
      {attachments.map((attachment) => (
        <a
          key={attachment.url}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block size-16 overflow-hidden rounded-md border border-border bg-muted"
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

function reviewCommentAttachments(
  comment: ReviewComment,
): ReviewCommentAttachment[] {
  const raw = comment.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const attachment = value as Record<string, unknown>;
      const url = typeof attachment.url === "string" ? attachment.url : "";
      const contentType =
        typeof attachment.contentType === "string"
          ? attachment.contentType
          : undefined;
      if (
        !url ||
        (contentType && !contentType.startsWith("image/")) ||
        !isTrustedReviewAttachmentUrl(url)
      ) {
        return [];
      }
      return [
        {
          url,
          name:
            typeof attachment.name === "string" && attachment.name.trim()
              ? attachment.name
              : "image",
        },
      ];
    })
    .slice(0, MAX_REVIEW_IMAGE_ATTACHMENTS);
}

export function isTrustedReviewAttachmentUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(
      value,
      typeof window === "undefined"
        ? "http://localhost"
        : window.location.origin,
    );
    // coercion-ok: an unparseable attachment URL is untrusted, not absent.
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (typeof window !== "undefined" && parsed.origin === window.location.origin)
    return true;
  return parsed.protocol === "https:" && parsed.hostname === "cdn.builder.io";
}

function displayReviewCommentBody(body: string): string {
  return body.replace(/@\[([^\]]+)\]\(mailto:[^)]+\)/g, "@$1");
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
