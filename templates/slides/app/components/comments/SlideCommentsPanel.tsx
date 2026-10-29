import {
  actionErrorMessage,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useCreateReviewComment } from "@agent-native/core/client/review";
import type { ReviewMention } from "@agent-native/core/review";
import {
  ReviewAuthorAvatar,
  ReviewCommentComposer,
  ReviewThreadCardFrame,
  type ReviewMentionOption,
} from "@agent-native/toolkit/app/review";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  SLIDE_REVIEW_RESOURCE_TYPE,
  slideReviewAnchor,
} from "@shared/slide-review";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconMessageCircle,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type CommentThread,
  useSlideComments,
} from "@/hooks/use-slide-comments";
import { useSlideReviewSurface } from "@/hooks/use-slide-review-surface";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { SlideReviewThreadCard } from "./SlideReviewThreadCard";

const COMMENT_FILTERS_STORAGE_KEY = "slides:comments-filters-expanded";

function readCommentFiltersExpanded() {
  try {
    return window.localStorage.getItem(COMMENT_FILTERS_STORAGE_KEY) === "true";
  } catch {
    // coercion-ok: unreadable storage means the filters start collapsed.
    return false;
  }
}

function writeCommentFiltersExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(COMMENT_FILTERS_STORAGE_KEY, String(expanded));
  } catch {
    // coercion-ok: a blocked localStorage only forgets the filters toggle.
  }
}

interface SlideCommentsPanelProps {
  deckId: string | null;
  slideId: string | null;
  /** Deck slide order, for grouping threads when all slides are shown. */
  slideIds?: readonly string[];
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
  selectedThreadId?: string | null;
  selectedThreadRequestId?: number;
  onThreadResolved?: (threadId: string) => void;
}

interface ThreadGroup {
  slideId: string | null;
  /** 1-based; null when the slide is no longer in the deck. */
  slideNumber: number | null;
  threads: CommentThread[];
}

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

/** Threads someone else is in with you, or that mention you. */
function threadIsForYou(thread: CommentThread, email: string | null) {
  if (!email) return false;
  const comments = [thread.review.root, ...thread.review.replies];
  const mentioned = comments.some((comment) =>
    comment.mentions.some((mention) => normalizeEmail(mention.email) === email),
  );
  const mine = comments.some(
    (comment) => normalizeEmail(comment.authorEmail) === email,
  );
  const others = comments.some(
    (comment) => normalizeEmail(comment.authorEmail) !== email,
  );
  return mentioned || (mine && others);
}

function threadMatches(thread: CommentThread, query: string) {
  if (!query) return true;
  const comments = [thread.review.root, ...thread.review.replies];
  return [
    thread.quotedText ?? "",
    ...comments.flatMap((comment) => [
      comment.body,
      comment.authorName ?? "",
      comment.authorEmail ?? "",
    ]),
  ].some((value) => value.toLowerCase().includes(query));
}

export function groupThreadsBySlide(
  threads: readonly CommentThread[],
  slideIds: readonly string[],
): ThreadGroup[] {
  const order = new Map(slideIds.map((id, index) => [id, index]));
  const groups = new Map<string | null, ThreadGroup>();
  for (const thread of threads) {
    const index = thread.slideId ? order.get(thread.slideId) : undefined;
    const key = index === undefined ? null : thread.slideId;
    const group = groups.get(key) ?? {
      slideId: key,
      slideNumber: index === undefined ? null : index + 1,
      threads: [],
    };
    group.threads.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (left, right) =>
      (left.slideNumber ?? Number.MAX_SAFE_INTEGER) -
      (right.slideNumber ?? Number.MAX_SAFE_INTEGER),
  );
}

export function SlideCommentsPanel({
  deckId,
  slideId,
  slideIds = [],
  canComment,
  canEdit,
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
  const [showResolved, setShowResolved] = useState(false);
  const [addingComment, setAddingComment] = useState(false);
  const commentsQuery = useSlideComments(deckId, slideId, scope);
  const allThreadsQuery = useSlideComments(deckId, slideId, "deck");
  const surface = useSlideReviewSurface({ deckId, canEdit });
  const threads = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);
  const email = normalizeEmail(currentUserEmail);
  const query = searchTerm.trim().toLowerCase();
  const audienceThreads = threads.filter(
    (thread) =>
      (audience === "all" || threadIsForYou(thread, email)) &&
      threadMatches(thread, query),
  );
  const visibleThreads = showResolved
    ? audienceThreads
    : audienceThreads.filter((thread) => !thread.resolved);
  // A thread opened from a pin, a link or the canvas shows even when the
  // filters would hide it.
  const selectedThread = allThreadsQuery.data?.find(
    (thread) => thread.threadId === selectedThreadId,
  );
  const threadCards =
    selectedThread &&
    !visibleThreads.some(
      (thread) => thread.threadId === selectedThread.threadId,
    )
      ? [...visibleThreads, selectedThread]
      : visibleThreads;
  const resolvedCount = audienceThreads.filter(
    (thread) => thread.resolved,
  ).length;
  const groups = useMemo(
    () =>
      scope === "deck" ? groupThreadsBySlide(threadCards, slideIds) : null,
    [scope, slideIds, threadCards],
  );
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

  useEffect(() => {
    setClientAppState(
      appStateKeyForBrowserTab("slides-comments", TAB_ID),
      { open: true, threadId: selectedThreadId },
      { requestSource: TAB_ID },
    ).catch((error: unknown) => {
      console.warn(
        "[slides] could not publish the open comment thread:",
        error,
      );
    });
  }, [selectedThreadId]);
  useEffect(
    () => () => {
      setClientAppState(
        appStateKeyForBrowserTab("slides-comments", TAB_ID),
        { open: false, threadId: null },
        { requestSource: TAB_ID },
      ).catch((error: unknown) => {
        console.warn(
          "[slides] could not publish the closed comments panel:",
          error,
        );
      });
    },
    [],
  );

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedThreadId) return;
    const card = listRef.current?.querySelector<HTMLElement>(
      `[data-slide-review-thread="${CSS.escape(selectedThreadId)}"]`,
    );
    // Scroll only: a pin opening this thread keeps focus in its own card.
    card?.scrollIntoView({ block: "nearest" });
  }, [selectedThreadId, selectedThreadRequestId, threadCards.length]);

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

  const card = (thread: CommentThread) =>
    deckId ? (
      <div
        key={thread.threadId}
        data-slide-review-thread={thread.threadId}
        className={cn(
          "rounded-xl",
          thread.threadId === selectedThreadId &&
            "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        )}
      >
        <SlideReviewThreadCard
          thread={thread}
          deckId={deckId}
          discussion={commentsQuery.discussion}
          canComment={canComment}
          canEdit={canEdit}
          currentUserEmail={currentUserEmail}
          peopleMentionOptions={surface.peopleMentionOptions}
          agent={surface.agent}
          onBeforeCommentSubmit={onBeforeCommentSubmit}
          onResolved={onThreadResolved}
          className="w-full shadow-none"
        />
      </div>
    ) : null;

  return (
    <div className="flex h-full w-80 flex-shrink-0 flex-col bg-[var(--slides-editor-surface)]">
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
                type="button"
                aria-label={t("comments.close")}
                onClick={onClose}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground/80"
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
              <IconSearch className="pointer-events-none absolute start-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t("comments.search")}
                placeholder={t("comments.searchPlaceholder")}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-7 ps-7 text-[11px]"
              />
            </div>
          </div>
        </>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {showInput && deckId && slideId && (
          <NewSlideComment
            deckId={deckId}
            slideId={slideId}
            quotedText={currentPendingComment?.quotedText ?? ""}
            anchor={currentPendingComment?.anchor}
            currentUserEmail={currentUserEmail}
            mentionOptions={
              canEdit
                ? [
                    ...surface.peopleMentionOptions,
                    ...surface.agent.mentionOptions,
                  ]
                : surface.peopleMentionOptions
            }
            onBeforeSubmit={onBeforeCommentSubmit}
            onCreated={async (created, mentions) => {
              onPendingDone();
              setAddingComment(false);
              const outcome = await surface.agent.startIfTagged({
                threadId: created.threadId,
                commentId: created.id,
                mentions,
              });
              if (outcome === "busy") toast.error(t("comments.agentBusy"));
              else if (outcome === "setup-required")
                toast.error(t("comments.agentSetupRequired"));
              else if (outcome === "failed")
                toast.error(t("comments.agentStartFailed"));
            }}
            onCancel={() => {
              onPendingDone();
              setAddingComment(false);
            }}
          />
        )}

        {commentsQuery.isLoading && !showLoadError ? (
          <div
            role="status"
            aria-label={t("comments.loading")}
            className="space-y-3"
          >
            {[0, 1].map((index) => (
              <div
                key={index}
                className="space-y-2 rounded-xl border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}

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

        {!showLoadError &&
          (groups
            ? groups.map((group) => (
                <section
                  key={group.slideId ?? "removed"}
                  className="space-y-2"
                  aria-label={
                    group.slideNumber
                      ? t("comments.slideGroup", { number: group.slideNumber })
                      : t("comments.removedSlidesGroup")
                  }
                >
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-[11px] font-medium text-muted-foreground">
                      {group.slideNumber
                        ? t("comments.slideGroup", {
                            number: group.slideNumber,
                          })
                        : t("comments.removedSlidesGroup")}
                    </h3>
                    {group.slideId &&
                    group.slideId !== slideId &&
                    onSelectSlide ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (group.slideId) onSelectSlide(group.slideId);
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {t("comments.goToSlide")}
                      </button>
                    ) : null}
                  </div>
                  {group.threads.map(card)}
                </section>
              ))
            : threadCards.map(card))}

        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved(!showResolved)}
            className="w-full py-1 text-[11px] text-muted-foreground hover:text-foreground/70"
          >
            {showResolved
              ? t("comments.hideResolved")
              : t("comments.showResolved", { count: resolvedCount })}
          </button>
        )}

        {!showLoadError &&
          !commentsQuery.isLoading &&
          !showInput &&
          threadCards.length === 0 && (
            <div className="py-10 text-center">
              <IconMessageCircle
                size={28}
                className="mx-auto mb-2 text-muted-foreground/60"
              />
              <p className="text-[12px] text-muted-foreground">
                {t("comments.noCommentsYet")}
              </p>
              {deckId && slideId && canComment ? (
                <button
                  type="button"
                  onClick={() => setAddingComment(true)}
                  className="mt-1 text-[11px] text-muted-foreground/70 hover:text-foreground"
                >
                  {t("comments.clickToAddComment")}
                </button>
              ) : !slideId ? (
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  {t("comments.selectSlideToAdd")}
                </p>
              ) : null}
            </div>
          )}
      </div>
    </div>
  );
}

function NewSlideComment({
  deckId,
  slideId,
  quotedText,
  anchor,
  currentUserEmail,
  mentionOptions,
  onBeforeSubmit,
  onCreated,
  onCancel,
}: {
  deckId: string;
  slideId: string;
  quotedText: string;
  anchor?: SlideCommentAnchor | undefined;
  currentUserEmail: string | null;
  mentionOptions: readonly ReviewMentionOption[];
  onBeforeSubmit?: (() => Promise<void>) | undefined;
  onCreated: (
    created: { id: string; threadId: string },
    mentions: readonly ReviewMention[],
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const create = useCreateReviewComment();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<ReviewMention[]>([]);

  const submit = async (resolutionTarget: "agent" | "human") => {
    const body = text.trim();
    if (!body || create.isPending) return;
    const submittedMentions = mentions;
    try {
      await onBeforeSubmit?.();
      const created = await create.mutateAsync({
        resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
        resourceId: deckId,
        targetId: slideId,
        anchor: slideReviewAnchor({ slideId, quotedText, point: anchor }),
        body,
        mentions: submittedMentions,
        resolutionTarget,
        clientOperationId: crypto.randomUUID(),
      });
      setText("");
      setMentions([]);
      await onCreated(created, submittedMentions);
    } catch (error) {
      toast.error(actionErrorMessage(error) ?? t("comments.saveCommentFailed"));
    }
  };

  return (
    <ReviewThreadCardFrame
      className="w-full shadow-none"
      title={t("comments.addComment")}
      closeLabel={t("comments.cancel")}
      onClose={create.isPending ? undefined : onCancel}
    >
      {quotedText ? (
        <blockquote className="mx-3 mt-3 line-clamp-3 border-s-2 border-primary/50 ps-2 text-xs text-muted-foreground">
          {quotedText}
        </blockquote>
      ) : null}
      <div className="flex items-start gap-2 px-3 py-4">
        <ReviewAuthorAvatar
          className="mt-0.5"
          name={currentUserEmail ?? t("comments.reviewer")}
          email={currentUserEmail}
          size={24}
        />
        <ReviewCommentComposer
          className="min-w-0 flex-1"
          autoFocus
          value={text}
          mentions={mentions}
          onMentionsChange={setMentions}
          mentionOptions={mentionOptions}
          agentsLabel={t("comments.agentsSection")}
          showCommentTools
          emojiLabel={t("comments.addEmoji")}
          mentionLabel={t("comments.mention")}
          noMentionsLabel={t("comments.noMentions")}
          disabled={create.isPending}
          onChange={setText}
          onSubmit={(target) => void submit(target)}
          submittingTarget={create.isPending ? "human" : null}
          placeholder={t("comments.addCommentPlaceholder")}
          commentLabel={t("comments.comment")}
          submitOnEnter
          onEscape={onCancel}
        />
      </div>
    </ReviewThreadCardFrame>
  );
}
