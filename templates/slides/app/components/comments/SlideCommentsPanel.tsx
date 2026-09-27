import {
  actionErrorMessage,
  useAvatarUrl,
  useReconciledState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { InlineMarkdown } from "@agent-native/core/client/markdown";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  IconX,
  IconCheck,
  IconTrash,
  IconPencil,
  IconMessageCircle,
  IconChevronDown,
  IconAlertTriangle,
  IconRefresh,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";

import {
  Avatar as UserAvatar,
  AvatarFallback as UserAvatarFallback,
  AvatarImage as UserAvatarImage,
} from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSlideComments,
  useCreateSlideComment,
  useResolveSlideComment,
  useDeleteSlideComment,
  useToggleSlideCommentReaction,
  useUpdateSlideComment,
  emailToColor,
  formatRelativeTime,
  type CommentThread,
  type SlideComment,
} from "@/hooks/use-slide-comments";

const COMMENT_REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏"];

interface SlideCommentsPanelProps {
  deckId: string | null;
  slideId: string | null;
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string | null;
  onBeforeCommentSubmit?: () => Promise<void>;
  onSelectSlide?: (slideId: string) => void;
  pendingComment: {
    slideId: string;
    quotedText: string;
    anchor?: SlideCommentAnchor;
  } | null;
  onPendingDone: () => void;
  onClose: () => void;
}

function Avatar({ email, name }: { email: string; name?: string | null }) {
  const color = emailToColor(email);
  const avatarUrl = useAvatarUrl(email);
  const initials = (name || email)
    .split(/[@.\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("")
    .slice(0, 2);
  return (
    <UserAvatar className="h-5 w-5 shrink-0" title={name || email}>
      {avatarUrl ? (
        <UserAvatarImage src={avatarUrl} alt={name || email} />
      ) : null}
      <UserAvatarFallback
        className="text-[9px] font-bold text-primary-foreground"
        style={{ backgroundColor: color }}
      >
        {initials}
      </UserAvatarFallback>
    </UserAvatar>
  );
}

export function CommentItem({
  comment,
  deckId,
  onDelete,
  canManage,
  canReact,
}: {
  comment: SlideComment;
  deckId: string;
  onDelete: () => void;
  canManage: boolean;
  canReact: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useReconciledState(comment.content, {
    active: editing,
  });
  const [error, setError] = useState<string | null>(null);
  const [reactionOpen, setReactionOpen] = useState(false);
  const updateComment = useUpdateSlideComment();
  const toggleReaction = useToggleSlideCommentReaction();

  const save = async () => {
    const content = draft.trim();
    if (!content || updateComment.isPending) return;
    setError(null);
    try {
      await updateComment.mutateAsync({ id: comment.id, deckId, content });
      setEditing(false);
    } catch (caught) {
      setError(actionErrorMessage(caught) ?? t("comments.saveCommentFailed"));
    }
  };

  const reactions = comment.reactions ?? [];
  const toggleEmoji = (emoji: string) => {
    setError(null);
    toggleReaction.mutate(
      { commentId: comment.id, deckId, emoji },
      {
        onError: (caught) =>
          setError(actionErrorMessage(caught) ?? t("comments.reactionFailed")),
      },
    );
    setReactionOpen(false);
  };

  return (
    <div className="group flex gap-2">
      <Avatar email={comment.author_email} name={comment.author_name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[11px] font-medium text-foreground/80">
            {comment.author_name || comment.author_email.split("@")[0]}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <span className="text-[10px] text-muted-foreground">
              {formatRelativeTime(comment.created_at)}
            </span>
            {canManage && !editing && (
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("comments.editComment")}
                      onClick={() => {
                        setDraft(comment.content);
                        setError(null);
                        setEditing(true);
                      }}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <IconPencil size={11} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("comments.editComment")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("comments.deleteComment")}
                      onClick={onDelete}
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <IconTrash size={11} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("comments.deleteComment")}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              aria-label={t("comments.editComment")}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Escape") setEditing(false);
              }}
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t("comments.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!draft.trim() || updateComment.isPending}
                className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
              >
                {updateComment.isPending
                  ? t("comments.saving")
                  : t("comments.save")}
              </button>
            </div>
          </div>
        ) : (
          <InlineMarkdown
            content={comment.content}
            className="mt-0.5 text-[12px] leading-relaxed text-foreground/90"
          />
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {reactions.map((reaction) =>
            canReact ? (
              <button
                key={reaction.emoji}
                type="button"
                aria-label={t("comments.toggleReaction", {
                  emoji: reaction.emoji,
                })}
                aria-pressed={reaction.reacted}
                onClick={() => toggleEmoji(reaction.emoji)}
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${reaction.reacted ? "border-primary/60 bg-primary/10" : "border-border bg-background hover:bg-accent"}`}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ) : (
              <span
                key={reaction.emoji}
                aria-label={`${reaction.emoji} ${reaction.count}`}
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${reaction.reacted ? "border-primary/60 bg-primary/10" : "border-border bg-background"}`}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </span>
            ),
          )}
          {canReact && (
            <Popover open={reactionOpen} onOpenChange={setReactionOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("comments.addReaction")}
                  className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <IconPlus className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="start"
                className="w-auto p-1.5"
              >
                <div className="flex gap-0.5">
                  {COMMENT_REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={t("comments.reactWith", { emoji })}
                      onClick={() => toggleEmoji(emoji)}
                      className="rounded p-1.5 text-base leading-none hover:bg-accent"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        {error && !editing && (
          <p role="alert" className="mt-1 text-[11px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function PendingCommentInput({
  quotedText,
  anchor,
  deckId,
  slideId,
  onBeforeSubmit,
  onDone,
  onCancel,
}: {
  quotedText: string;
  anchor?: SlideCommentAnchor;
  deckId: string;
  slideId: string;
  onBeforeSubmit?: () => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createComment = useCreateSlideComment();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await onBeforeSubmit?.();
      await createComment.mutateAsync({
        deckId,
        slideId,
        content: trimmed,
        quotedText: quotedText || undefined,
        ...(anchor ? { anchor } : {}),
      });
      setText("");
      onDone();
    } catch (err) {
      setError(actionErrorMessage(err) ?? t("comments.saveCommentFailed"));
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-accent">
      {quotedText && (
        <div className="px-3 pt-2.5 pb-1.5 border-l-2 border-[#609FF8] mx-3 mt-2.5 mb-1 bg-[#609FF8]/5 rounded-r text-[11px] text-muted-foreground italic truncate">
          "{quotedText}"
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={t("comments.addCommentPlaceholder")}
        rows={3}
        className="w-full bg-transparent text-foreground/90 text-[12px] px-3 py-2 outline-none resize-none placeholder:text-muted-foreground"
      />
      {error && (
        <div className="px-3 pb-1 text-[11px] text-destructive">{error}</div>
      )}
      <div className="flex justify-end gap-1.5 px-3 pb-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-muted-foreground hover:text-foreground/80 px-2 py-1 rounded"
        >
          {t("comments.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || createComment.isPending}
          className="text-[11px] bg-[#609FF8] text-black font-medium px-2.5 py-1 rounded disabled:opacity-40 hover:bg-[#7AB2FA]"
        >
          {createComment.isPending
            ? t("comments.saving")
            : t("comments.comment")}
        </button>
      </div>
    </div>
  );
}

export function ReplyInput({
  deckId,
  slideId,
  threadId,
  parentId,
  onBeforeSubmit,
  onDone,
}: {
  deckId: string;
  slideId: string;
  threadId: string;
  parentId: string;
  onBeforeSubmit?: () => Promise<void>;
  onDone: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createComment = useCreateSlideComment();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await onBeforeSubmit?.();
      await createComment.mutateAsync({
        deckId,
        slideId,
        threadId,
        parentId,
        content: trimmed,
      });
      setText("");
      onDone();
    } catch (err) {
      setError(actionErrorMessage(err) ?? t("comments.saveReplyFailed"));
    }
  };

  return (
    <div className="mt-2 border border-border rounded-lg overflow-hidden bg-accent">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") onDone();
        }}
        placeholder={t("comments.replyPlaceholder")}
        rows={2}
        className="w-full bg-transparent text-foreground/90 text-[12px] px-3 py-2 outline-none resize-none placeholder:text-muted-foreground"
      />
      {error && (
        <div className="px-3 pb-1 text-[11px] text-destructive">{error}</div>
      )}
      <div className="flex justify-end gap-1.5 px-3 pb-2">
        <button
          type="button"
          onClick={onDone}
          className="text-[11px] text-muted-foreground hover:text-foreground/80 px-2 py-1 rounded"
        >
          {t("comments.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || createComment.isPending}
          className="text-[11px] bg-[#609FF8] text-black font-medium px-2.5 py-1 rounded disabled:opacity-40 hover:bg-[#7AB2FA]"
        >
          {t("comments.reply")}
        </button>
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  deckId,
  slideId,
  currentSlideId,
  canComment,
  canEdit,
  currentUserEmail,
  onBeforeCommentSubmit,
  onSelectSlide,
}: {
  thread: CommentThread;
  deckId: string;
  slideId: string;
  currentSlideId: string | null;
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string | null;
  onBeforeCommentSubmit?: () => Promise<void>;
  onSelectSlide?: (slideId: string) => void;
}) {
  const t = useT();
  const [replyOpen, setReplyOpen] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveComment = useResolveSlideComment();
  const deleteComment = useDeleteSlideComment();

  const rootComment = thread.comments[0];
  const replies = thread.comments.slice(1);

  if (!rootComment) return null;

  const handleResolve = () => {
    setError(null);
    resolveComment.mutate(
      {
        id: rootComment.id,
        deckId,
        resolved: !thread.resolved,
      },
      {
        onError: (caught) =>
          setError(actionErrorMessage(caught) ?? t("comments.updateFailed")),
      },
    );
  };
  const handleDelete = (commentId: string) => {
    setError(null);
    deleteComment.mutate(
      { id: commentId, deckId },
      {
        onError: (caught) =>
          setError(actionErrorMessage(caught) ?? t("comments.deleteFailed")),
      },
    );
  };

  return (
    <div
      data-slide-comment-thread={thread.threadId}
      className={`group border rounded-lg px-3 py-2.5 ${thread.resolved ? "border-border/60 opacity-50" : "border-border bg-card"}`}
    >
      {/* Quoted text */}
      {thread.quotedText && (
        <div className="border-l-2 border-[#609FF8]/50 pl-2 mb-2 text-[11px] text-muted-foreground italic truncate">
          "{thread.quotedText}"
        </div>
      )}
      {onSelectSlide && thread.slideId && thread.slideId !== currentSlideId && (
        <button
          type="button"
          data-slide-comment-slide-jump
          onClick={() => onSelectSlide(thread.slideId!)}
          className="mb-2 text-[10px] text-primary hover:underline"
        >
          {t("comments.goToSlide")}
        </button>
      )}

      <CommentItem
        comment={rootComment}
        deckId={deckId}
        onDelete={() => handleDelete(rootComment.id)}
        canManage={
          canEdit ||
          rootComment.author_email.trim().toLowerCase() ===
            currentUserEmail?.trim().toLowerCase()
        }
        canReact={canComment}
      />

      {/* Replies toggle */}
      {replies.length > 0 && (
        <button
          type="button"
          aria-expanded={showReplies}
          onClick={() => setShowReplies(!showReplies)}
          className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/80 ml-7"
        >
          <IconChevronDown
            size={11}
            className={`transition-transform ${showReplies ? "rotate-180" : ""}`}
          />
          {showReplies
            ? t("comments.hideReplies")
            : t("comments.replyCount", { count: replies.length })}
        </button>
      )}

      {/* Expanded replies */}
      {showReplies && (
        <div className="mt-2 ml-7 space-y-2.5">
          {replies.map((r) => (
            <CommentItem
              key={r.id}
              comment={r}
              deckId={deckId}
              onDelete={() => handleDelete(r.id)}
              canManage={
                canEdit ||
                r.author_email.trim().toLowerCase() ===
                  currentUserEmail?.trim().toLowerCase()
              }
              canReact={canComment}
            />
          ))}
        </div>
      )}

      {/* Reply & resolve actions */}
      {canComment && (
        <div className="mt-2 ml-7 flex items-center gap-3">
          {!thread.resolved && !replyOpen && (
            <button
              onClick={() => setReplyOpen(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground/80"
            >
              {t("comments.reply")}
            </button>
          )}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={
                    thread.resolved
                      ? t("comments.reopenThread")
                      : t("comments.resolveThread")
                  }
                  onClick={handleResolve}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {thread.resolved ? (
                    <IconRefresh size={12} />
                  ) : (
                    <IconCheck size={12} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {thread.resolved
                  ? t("comments.reopenThread")
                  : t("comments.resolveThread")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {replyOpen && canComment && (
        <div className="ml-7">
          <ReplyInput
            deckId={deckId}
            slideId={slideId}
            threadId={thread.threadId}
            parentId={rootComment.id}
            onBeforeSubmit={onBeforeCommentSubmit}
            onDone={() => setReplyOpen(false)}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 ml-7 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SlideCommentsPanel({
  deckId,
  slideId,
  canComment,
  canEdit,
  currentUserEmail,
  onBeforeCommentSubmit,
  onSelectSlide,
  pendingComment,
  onPendingDone,
  onClose,
}: SlideCommentsPanelProps) {
  const t = useT();
  const [scope, setScope] = useState<"slide" | "deck">("slide");
  const [audience, setAudience] = useState<"all" | "for-you">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const commentsQuery = useSlideComments(deckId, slideId, scope);
  const threads = commentsQuery.data ?? [];
  const [showResolved, setShowResolved] = useState(false);
  const [addingComment, setAddingComment] = useState(false);

  const normalizedCurrentUserEmail = currentUserEmail?.trim().toLowerCase();
  const audienceThreads = threads.filter((thread) => {
    if (audience === "for-you") {
      const hasViewerComment = thread.comments.some(
        (comment) =>
          comment.author_email.trim().toLowerCase() ===
          normalizedCurrentUserEmail,
      );
      const hasNonViewerComment = thread.comments.some(
        (comment) =>
          comment.author_email.trim().toLowerCase() !==
          normalizedCurrentUserEmail,
      );
      const hasViewerMention = normalizedCurrentUserEmail
        ? thread.comments.some((comment) =>
            comment.content
              .toLowerCase()
              .includes(`@${normalizedCurrentUserEmail}`),
          )
        : false;
      const hasAttentionItem =
        hasViewerMention || (hasViewerComment && hasNonViewerComment);
      if (!hasAttentionItem) return false;
    }

    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    return normalizedSearchTerm.length === 0
      ? true
      : thread.comments.some((comment) =>
          [
            comment.content,
            comment.quoted_text ?? "",
            comment.author_name ?? "",
            comment.author_email,
          ].some((value) => value.toLowerCase().includes(normalizedSearchTerm)),
        );
  });
  const visibleThreads = showResolved
    ? audienceThreads
    : audienceThreads.filter((t) => !t.resolved);
  const visibleResolvedThreads = audienceThreads.filter((t) => t.resolved);
  const showLoadError = commentsQuery.isError && threads.length === 0;
  const currentPendingComment =
    pendingComment?.slideId === slideId ? pendingComment : null;

  useEffect(() => {
    if (pendingComment && pendingComment.slideId !== slideId) {
      onPendingDone();
      return;
    }
    if (pendingComment && !canComment) {
      onPendingDone();
      return;
    }
    if (pendingComment) setAddingComment(false);
  }, [canComment, onPendingDone, pendingComment, slideId]);

  const showInput =
    canComment && Boolean(currentPendingComment || addingComment);

  return (
    <div className="flex h-full w-[17rem] flex-shrink-0 flex-col bg-[var(--slides-editor-surface)]">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-3">
        <span className="text-[13px] font-medium text-foreground/80">
          {t("comments.title")}
        </span>
        <div className="flex items-center gap-1">
          {canComment && !showInput && deckId && slideId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setAddingComment(true)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground/80 hover:bg-accent"
                >
                  <IconMessageCircle size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("comments.addComment")}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onClose}
                className="p-1 rounded text-muted-foreground hover:text-foreground/80 hover:bg-accent"
              >
                <IconX size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("comments.close")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border/70 px-3 pb-2">
        <div
          className="inline-flex rounded-md border border-border/70 p-0.5"
          role="group"
          aria-label={t("comments.scope")}
        >
          {(["slide", "deck"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={`rounded px-2 py-1 text-[10px] ${scope === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {value === "slide"
                ? t("comments.thisSlide")
                : t("comments.allComments")}
            </button>
          ))}
        </div>
        <div
          className="inline-flex rounded-md border border-border/70 p-0.5"
          role="group"
          aria-label={t("comments.audience")}
        >
          {(["all", "for-you"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={audience === value}
              onClick={() => setAudience(value)}
              className={`rounded px-2 py-1 text-[10px] ${audience === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {value === "all" ? t("comments.all") : t("comments.forYou")}
            </button>
          ))}
        </div>
      </div>
      <div className="border-b border-border/70 px-3 py-2">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("comments.search")}
            placeholder={t("comments.searchPlaceholder")}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="h-7 pl-7 text-[11px]"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Pending / manual new comment input */}
        {showInput && deckId && slideId && (
          <PendingCommentInput
            quotedText={currentPendingComment?.quotedText ?? ""}
            anchor={currentPendingComment?.anchor}
            deckId={deckId}
            slideId={slideId}
            onBeforeSubmit={onBeforeCommentSubmit}
            onDone={() => {
              onPendingDone();
              setAddingComment(false);
            }}
            onCancel={() => {
              onPendingDone();
              setAddingComment(false);
            }}
          />
        )}

        {showLoadError && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-destructive/30 bg-destructive/5 px-3 py-8 text-center">
            <IconAlertTriangle className="size-5 text-destructive/70" />
            <p className="text-xs text-muted-foreground">
              {t("comments.loadFailed")}
            </p>
            <button
              type="button"
              onClick={() => void commentsQuery.refetch()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <IconRefresh className="size-3.5" />
              {t("comments.retry")}
            </button>
          </div>
        )}

        {/* Thread list */}
        {!showLoadError &&
          visibleThreads.map((thread) => (
            <ThreadCard
              key={thread.threadId}
              thread={thread}
              deckId={deckId ?? ""}
              slideId={thread.slideId ?? slideId ?? ""}
              currentSlideId={slideId}
              canComment={canComment}
              canEdit={canEdit}
              currentUserEmail={currentUserEmail}
              onBeforeCommentSubmit={onBeforeCommentSubmit}
              onSelectSlide={onSelectSlide}
            />
          ))}

        {/* Resolved toggle */}
        {visibleResolvedThreads.length > 0 && (
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground/70 py-1"
          >
            {showResolved
              ? t("comments.hideResolved")
              : t("comments.showResolved", {
                  count: visibleResolvedThreads.length,
                })}
          </button>
        )}

        {/* Empty state */}
        {!showLoadError &&
          !showInput &&
          visibleThreads.length === 0 &&
          (deckId && slideId && canComment ? (
            <button
              type="button"
              onClick={() => setAddingComment(true)}
              className="w-full text-center py-10 rounded-lg border border-dashed border-border/70 hover:border-[#609FF8]/50 hover:bg-accent transition-colors"
            >
              <IconMessageCircle
                size={28}
                className="mx-auto mb-2 text-muted-foreground/60"
              />
              <p className="text-[12px] text-muted-foreground">
                {t("comments.noCommentsYet")}
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                {t("comments.clickToAddComment")}
              </p>
            </button>
          ) : deckId && slideId ? (
            <div className="text-center py-10">
              <IconMessageCircle
                size={28}
                className="mx-auto mb-2 text-muted-foreground/60"
              />
              <p className="text-[12px] text-muted-foreground">
                {t("comments.noCommentsYet")}
              </p>
            </div>
          ) : (
            <div className="text-center py-10">
              <IconMessageCircle
                size={28}
                className="mx-auto mb-2 text-muted-foreground/60"
              />
              <p className="text-[12px] text-muted-foreground">
                {t("comments.noCommentsYet")}
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                {t("comments.selectSlideToAdd")}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}
