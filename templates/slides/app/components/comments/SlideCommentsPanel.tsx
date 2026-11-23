import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  IconX,
  IconCheck,
  IconMessageCircle,
  IconChevronDown,
  IconAlertTriangle,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSlideComments,
  type CommentThread,
} from "@/hooks/use-slide-comments";

import {
  isOwnSlideComment,
  SlideCommentComposerBox,
  slideCommentDraftSpot,
  SlideCommentEntry,
  slideCommentMentionsViewer,
  useSlideCommentDraft,
  useSlideCommentKit,
  type SlideCommentKit,
} from "./slide-comment-kit";

const COMMENT_FILTERS_STORAGE_KEY = "slides:comments-filters-expanded";

function readCommentFiltersExpanded() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COMMENT_FILTERS_STORAGE_KEY) === "true";
  } catch {
    // coercion-ok: Filter disclosure defaults closed if browser storage is unavailable.
    return false;
  }
}

function writeCommentFiltersExpanded(expanded: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMMENT_FILTERS_STORAGE_KEY, String(expanded));
  } catch {
    // coercion-ok: Filter disclosure remains usable for this session if storage is unavailable.
  }
}

interface SlideCommentsPanelProps {
  deckId: string | null;
  slideId: string | null;
  canComment: boolean;
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
  selectedThreadId?: string | null;
  selectedThreadRequestId?: number;
  onThreadResolved?: (threadId: string) => void;
}

function threadComments(thread: CommentThread) {
  return [thread.root, ...thread.replies];
}

function NewCommentBox({
  kit,
  slideId,
  quotedText,
  anchor,
  onDone,
}: {
  kit: SlideCommentKit;
  slideId: string;
  quotedText: string;
  anchor?: SlideCommentAnchor | undefined;
  onDone: () => void;
}) {
  const { t } = kit;
  const spot = slideCommentDraftSpot(anchor, quotedText);
  const draftKey = spot ? `new:${slideId}@${spot}` : `new:${slideId}`;
  const draft = useSlideCommentDraft(kit, draftKey);
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const discard = () => {
    draft.clear();
    onDone();
  };
  return (
    <div
      className="rounded-lg border border-border bg-accent p-2"
      data-slide-comment-new
    >
      {quotedText && (
        <div className="mb-2 truncate rounded-r border-l-2 border-[hsl(var(--slides-comment-accent))] bg-[hsl(var(--slides-comment-accent)/0.05)] px-2 py-1.5 text-[11px] italic text-muted-foreground">
          "{quotedText}"
        </div>
      )}
      <SlideCommentComposerBox
        kit={kit}
        draft={draft}
        autoFocus
        placeholder={t("comments.addCommentPlaceholder")}
        commentLabel={t("comments.comment")}
        ariaLabel={t("comments.addComment")}
        failedLabel={t("comments.saveCommentFailed")}
        onSubmit={(sent) =>
          kit
            .createThread({
              slideId,
              draft: sent,
              quotedText: quotedText || null,
              anchor,
            })
            .then(() => {
              if (currentDraftKey.current === draftKey) onDone();
            })
        }
        onEscape={discard}
        onCancel={discard}
      />
    </div>
  );
}

function ThreadCard({
  kit,
  thread,
  currentSlideId,
  onSelectSlide,
  selected,
  selectionRequestId,
  onThreadResolved,
}: {
  kit: SlideCommentKit;
  thread: CommentThread;
  currentSlideId: string | null;
  onSelectSlide?: (slideId: string) => void;
  selected: boolean;
  selectionRequestId: number;
  onThreadResolved?: (threadId: string) => void;
}) {
  const { t, canComment } = kit;
  const [replyOpen, setReplyOpen] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const replyDraft = useSlideCommentDraft(kit, `reply:${thread.threadId}`);
  const cardRef = useRef<HTMLDivElement>(null);
  const { replies, slideId } = thread;

  useEffect(() => {
    if (selected) {
      cardRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selected, selectionRequestId]);

  const handleResolve = () => {
    const resolving = !thread.resolved;
    kit.setResolved(thread, resolving).then(
      () => {
        if (selected && resolving) onThreadResolved?.(thread.threadId);
      },
      (caught: unknown) =>
        toast.error(actionErrorMessage(caught) ?? t("comments.updateFailed")),
    );
  };

  return (
    <div
      ref={cardRef}
      data-slide-comment-thread={thread.threadId}
      data-selected-comment={selected ? "true" : undefined}
      className={`@container/review group rounded-lg border px-3 py-2.5 ${thread.resolved ? "border-border/60 opacity-50" : "border-border bg-card"} ${selected ? "ring-2 ring-primary/70" : ""}`}
    >
      {thread.quotedText && (
        <div className="mb-2 truncate border-l-2 border-[hsl(var(--slides-comment-accent)/0.5)] pl-2 text-[11px] italic text-muted-foreground">
          "{thread.quotedText}"
        </div>
      )}
      {onSelectSlide && slideId && slideId !== currentSlideId && (
        <button
          type="button"
          data-slide-comment-slide-jump
          onClick={() => onSelectSlide(slideId)}
          className="mb-2 text-[10px] text-primary hover:underline"
        >
          {t("comments.goToSlide")}
        </button>
      )}

      <SlideCommentEntry kit={kit} comment={thread.root} variant="root" />

      {replies.length > 0 && (
        <button
          type="button"
          aria-expanded={showReplies}
          onClick={() => setShowReplies(!showReplies)}
          className="mt-2 ml-8 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/80"
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

      {showReplies && (
        <div className="ml-8">
          {replies.map((reply) => (
            <SlideCommentEntry
              key={reply.id}
              kit={kit}
              comment={reply}
              variant="reply"
            />
          ))}
        </div>
      )}

      {canComment && (
        <div className="mt-2 ml-8 flex items-center gap-3">
          {!thread.resolved && !replyOpen && (
            <button
              type="button"
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
                  disabled={kit.resolving}
                  onClick={handleResolve}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
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

      {replyOpen && canComment && !thread.resolved && (
        <SlideCommentComposerBox
          className="mt-2 ml-8"
          kit={kit}
          draft={replyDraft}
          variant="reply"
          autoFocus
          placeholder={t("comments.replyPlaceholder")}
          commentLabel={t("comments.reply")}
          ariaLabel={t("comments.reply")}
          failedLabel={t("comments.saveReplyFailed")}
          onSubmit={(draft) =>
            kit.reply(thread, draft).then(() => {
              setReplyOpen(false);
              setShowReplies(true);
            })
          }
          onEscape={() => setReplyOpen(false)}
          onCancel={() => {
            replyDraft.clear();
            setReplyOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function SlideCommentsPanel({
  deckId,
  slideId,
  canComment,
  currentUserEmail,
  onBeforeCommentSubmit,
  onSelectSlide,
  pendingComment,
  onPendingDone,
  onClose,
  selectedThreadId = null,
  selectedThreadRequestId = 0,
  onThreadResolved,
}: SlideCommentsPanelProps) {
  const t = useT();
  const [scope, setScope] = useState<"slide" | "deck">("slide");
  const [audience, setAudience] = useState<"all" | "for-you">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(
    readCommentFiltersExpanded,
  );
  const commentsQuery = useSlideComments(deckId, slideId, scope);
  const threads = commentsQuery.data?.threads ?? [];
  const kit = useSlideCommentKit({
    deckId: deckId ?? "",
    surface: "panel",
    currentUserEmail,
    canComment,
    discussion: commentsQuery.data?.discussion,
    onBeforeCommentSubmit,
  });
  const [showResolved, setShowResolved] = useState(false);
  const [addingComment, setAddingComment] = useState(false);

  const audienceThreads = threads.filter((thread) => {
    const comments = threadComments(thread);
    if (audience === "for-you") {
      const isViewerComment = (comment: (typeof comments)[number]) =>
        isOwnSlideComment(comment, currentUserEmail);
      const hasViewerComment = comments.some(isViewerComment);
      const hasNonViewerComment = comments.some(
        (comment) => !isViewerComment(comment),
      );
      const hasViewerMention = comments.some((comment) =>
        slideCommentMentionsViewer(comment, currentUserEmail),
      );
      const hasAttentionItem =
        hasViewerMention || (hasViewerComment && hasNonViewerComment);
      if (!hasAttentionItem) return false;
    }

    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    return normalizedSearchTerm.length === 0
      ? true
      : comments.some((comment) =>
          [
            comment.body,
            thread.quotedText ?? "",
            comment.authorName ?? "",
            comment.authorEmail ?? "",
          ].some((value) => value.toLowerCase().includes(normalizedSearchTerm)),
        );
  });
  const visibleThreads = showResolved
    ? audienceThreads
    : audienceThreads.filter((t) => !t.resolved);
  const selectedThread = threads.find(
    (thread) => thread.threadId === selectedThreadId,
  );
  const threadCards =
    selectedThread &&
    !visibleThreads.some(
      (thread) => thread.threadId === selectedThread.threadId,
    )
      ? [...visibleThreads, selectedThread]
      : visibleThreads;
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

  const toggleFilters = () => {
    const next = !filtersExpanded;
    writeCommentFiltersExpanded(next);
    if (!next) {
      setScope("slide");
      setAudience("all");
      setSearchTerm("");
    }
    setFiltersExpanded(next);
  };

  return (
    <div className="flex h-full w-[17rem] flex-shrink-0 flex-col bg-[var(--slides-editor-surface)]">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-3">
        <span className="text-[13px] font-medium text-foreground/80">
          {t("comments.title")}
        </span>
        <div className="flex items-center gap-1">
          {canComment && deckId && slideId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("comments.addComment")}
                  aria-expanded={showInput}
                  disabled={showInput}
                  onClick={() => setAddingComment(true)}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground/80 disabled:opacity-50"
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
                type="button"
                aria-label={t("comments.filters")}
                aria-expanded={filtersExpanded}
                onClick={toggleFilters}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground/80"
              >
                <IconChevronDown
                  size={14}
                  className={`transition-transform ${filtersExpanded ? "rotate-180" : ""}`}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("comments.filters")}</TooltipContent>
          </Tooltip>
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

      {filtersExpanded && (
        <>
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
        </>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Pending / manual new comment input */}
        {showInput && deckId && slideId && (
          <NewCommentBox
            kit={kit}
            slideId={slideId}
            quotedText={currentPendingComment?.quotedText ?? ""}
            anchor={currentPendingComment?.anchor}
            onDone={() => {
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
          deckId &&
          threadCards.map((thread) => (
            <ThreadCard
              key={thread.threadId}
              kit={kit}
              thread={thread}
              currentSlideId={slideId}
              onSelectSlide={onSelectSlide}
              selected={thread.threadId === selectedThreadId}
              selectionRequestId={selectedThreadRequestId}
              onThreadResolved={onThreadResolved}
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
          threadCards.length === 0 &&
          (deckId && slideId && canComment ? (
            <button
              type="button"
              onClick={() => setAddingComment(true)}
              className="w-full text-center py-10 rounded-lg border border-dashed border-border/70 hover:border-[hsl(var(--slides-comment-accent)/0.5)] hover:bg-accent transition-colors"
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
