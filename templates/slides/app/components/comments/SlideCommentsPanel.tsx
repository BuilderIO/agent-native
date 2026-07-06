import { useT } from "@agent-native/core/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconX,
  IconCheck,
  IconTrash,
  IconMessageCircle,
  IconChevronDown,
} from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";

import {
  useSlideComments,
  useCreateSlideComment,
  useResolveSlideComment,
  useDeleteSlideComment,
  emailToColor,
  formatRelativeTime,
  type CommentThread,
  type SlideComment,
} from "@/hooks/use-slide-comments";

interface SlideCommentsPanelProps {
  deckId: string | null;
  slideId: string | null;
  pendingComment: { quotedText: string } | null;
  onPendingDone: () => void;
  onClose: () => void;
}

/** Initials avatar */
function Avatar({ email, name }: { email: string; name?: string | null }) {
  const color = emailToColor(email);
  const initials = (name || email)
    .split(/[@.\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("")
    .slice(0, 2);
  return (
    <div
      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
      style={{ backgroundColor: color }}
      title={name || email}
    >
      {initials}
    </div>
  );
}

/** Single comment (inside a thread) */
function CommentItem({
  comment,
  onDelete,
}: {
  comment: SlideComment;
  onDelete: () => void;
}) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex gap-2 group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Avatar email={comment.author_email} name={comment.author_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-medium text-foreground/80 truncate">
            {comment.author_name || comment.author_email.split("@")[0]}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] text-muted-foreground">
              {formatRelativeTime(comment.created_at)}
            </span>
            {hovered && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onDelete}
                    className="p-0.5 rounded text-muted-foreground hover:text-red-400"
                  >
                    <IconTrash size={11} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("comments.deleteComment")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <p className="text-[12px] text-foreground/90 mt-0.5 break-words leading-relaxed">
          {comment.content}
        </p>
      </div>
    </div>
  );
}

/** Pending new comment input */
function PendingCommentInput({
  quotedText,
  deckId,
  slideId,
  onDone,
  onCancel,
}: {
  quotedText: string;
  deckId: string;
  slideId: string;
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
      await createComment.mutateAsync({
        deckId,
        slideId,
        content: trimmed,
        quotedText: quotedText || undefined,
      });
      setText("");
      onDone();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("comments.saveCommentFailed"),
      );
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
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
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

/** Inline reply input below a thread */
function ReplyInput({
  deckId,
  slideId,
  threadId,
  onDone,
}: {
  deckId: string;
  slideId: string;
  threadId: string;
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
      await createComment.mutateAsync({
        deckId,
        slideId,
        threadId,
        content: trimmed,
      });
      setText("");
      onDone();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("comments.saveReplyFailed"),
      );
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
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
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

/** A single comment thread card */
function ThreadCard({
  thread,
  deckId,
  slideId,
}: {
  thread: CommentThread;
  deckId: string;
  slideId: string;
}) {
  const t = useT();
  const [replyOpen, setReplyOpen] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [hovered, setHovered] = useState(false);
  const resolveComment = useResolveSlideComment();
  const deleteComment = useDeleteSlideComment();

  const rootComment = thread.comments[0];
  const replies = thread.comments.slice(1);

  if (!rootComment) return null;

  return (
    <div
      className={`border rounded-lg px-3 py-2.5 ${thread.resolved ? "border-border/60 opacity-50" : "border-border bg-card"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Quoted text */}
      {thread.quotedText && (
        <div className="border-l-2 border-[#609FF8]/50 pl-2 mb-2 text-[11px] text-muted-foreground italic truncate">
          "{thread.quotedText}"
        </div>
      )}

      {/* Root comment */}
      <div className="flex gap-2">
        <Avatar
          email={rootComment.author_email}
          name={rootComment.author_name}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-medium text-foreground/80 truncate">
              {rootComment.author_name ||
                rootComment.author_email.split("@")[0]}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground">
                {formatRelativeTime(rootComment.created_at)}
              </span>
              {hovered && !thread.resolved && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() =>
                          resolveComment.mutate({ id: rootComment.id })
                        }
                        className="p-0.5 rounded text-muted-foreground hover:text-green-400"
                      >
                        <IconCheck size={11} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("comments.resolveThread")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() =>
                          deleteComment.mutate({ id: rootComment.id })
                        }
                        className="p-0.5 rounded text-muted-foreground hover:text-red-400"
                      >
                        <IconTrash size={11} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("comments.deleteComment")}
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
          <p className="text-[12px] text-foreground/90 mt-0.5 break-words leading-relaxed">
            {rootComment.content}
          </p>
        </div>
      </div>

      {/* Replies toggle */}
      {replies.length > 0 && (
        <button
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
              onDelete={() => deleteComment.mutate({ id: r.id })}
            />
          ))}
        </div>
      )}

      {/* Reply & resolve actions */}
      {!thread.resolved && (
        <div className="mt-2 ml-7 flex items-center gap-3">
          {!replyOpen && (
            <button
              onClick={() => setReplyOpen(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground/80"
            >
              {t("comments.reply")}
            </button>
          )}
        </div>
      )}

      {replyOpen && (
        <div className="ml-7">
          <ReplyInput
            deckId={deckId}
            slideId={slideId}
            threadId={thread.threadId}
            onDone={() => setReplyOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

export function SlideCommentsPanel({
  deckId,
  slideId,
  pendingComment,
  onPendingDone,
  onClose,
}: SlideCommentsPanelProps) {
  const t = useT();
  const { data: threads = [] } = useSlideComments(deckId, slideId);
  const [showResolved, setShowResolved] = useState(false);
  const [addingComment, setAddingComment] = useState(false);

  const activeThreads = threads.filter((t) => !t.resolved);
  const resolvedThreads = threads.filter((t) => t.resolved);
  const visibleThreads = showResolved ? threads : activeThreads;

  // When pending comment arrives, cancel any manual "add comment" mode
  useEffect(() => {
    if (pendingComment) setAddingComment(false);
  }, [pendingComment]);

  const showInput = pendingComment || addingComment;

  return (
    <div className="w-72 flex-shrink-0 border-l border-border bg-background flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <span className="text-[13px] font-medium text-foreground/80">
          {t("comments.title")}
        </span>
        <div className="flex items-center gap-1">
          {!showInput && deckId && slideId && (
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Pending / manual new comment input */}
        {showInput && deckId && slideId && (
          <PendingCommentInput
            quotedText={pendingComment ? pendingComment.quotedText : ""}
            deckId={deckId}
            slideId={slideId}
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

        {/* Thread list */}
        {visibleThreads.map((thread) => (
          <ThreadCard
            key={thread.threadId}
            thread={thread}
            deckId={deckId ?? ""}
            slideId={slideId ?? ""}
          />
        ))}

        {/* Resolved toggle */}
        {resolvedThreads.length > 0 && (
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground/70 py-1"
          >
            {showResolved
              ? t("comments.hideResolved")
              : t("comments.showResolved", { count: resolvedThreads.length })}
          </button>
        )}

        {/* Empty state */}
        {!showInput &&
          visibleThreads.length === 0 &&
          (deckId && slideId ? (
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
