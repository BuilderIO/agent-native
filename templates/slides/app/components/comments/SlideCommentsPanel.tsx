import { setClientAppState } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  ReviewThreadsPanel,
  type ReviewThread,
  type ReviewThreadGroupTarget,
  type ReviewThreadsPanelLabels,
} from "@agent-native/toolkit/app/review";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import { parseSlideReviewAnchor } from "@shared/slide-review";
import { IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  slideCommentThreads,
  slideReviewQueryParams,
  useSlideComments,
} from "@/hooks/use-slide-comments";
import { useSlideReviewSurface } from "@/hooks/use-slide-review-surface";
import { requestSlideComment } from "@/lib/slide-comment-requests";
import { TAB_ID } from "@/lib/tab-id";

import { SlideReviewThreadCard } from "./SlideReviewThreadCard";

/** Where a text-selection or shortcut comment starts when it has no point. */
const SLIDE_CENTER: SlideCommentAnchor = { x: 50, y: 50 };

interface SlideCommentsPanelProps {
  deckId: string | null;
  slideId: string | null;
  /** Deck slide order, for grouping threads under their slide. */
  slideIds?: readonly string[] | undefined;
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string | null;
  onBeforeCommentSubmit?: (() => Promise<void>) | undefined;
  onSelectSlide?: ((slideId: string) => void) | undefined;
  /** Arms the pin tool, for the panel's new-thread button. */
  onNewThread?: (() => void) | undefined;
  pendingComment: {
    slideId: string;
    quotedText: string;
    anchor?: SlideCommentAnchor | undefined;
  } | null;
  onPendingDone: () => void;
  onClose: () => void;
  selectedThreadId?: string | null | undefined;
  selectedThreadRequestId?: number | undefined;
  onThreadResolved?: ((threadId: string) => void) | undefined;
}

function threadSlideId(thread: ReviewThread): string | null {
  return (
    parseSlideReviewAnchor(thread.root.anchor)?.slideId ?? thread.root.targetId
  );
}

function hasCanvasPin(thread: ReviewThread): boolean {
  return Boolean(parseSlideReviewAnchor(thread.root.anchor)?.point);
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
  onNewThread,
  pendingComment,
  onPendingDone,
  onClose,
  selectedThreadId = null,
  selectedThreadRequestId = 0,
  onThreadResolved,
}: SlideCommentsPanelProps) {
  const t = useT();
  const surface = useSlideReviewSurface({ deckId, canEdit });
  const { discussion } = useSlideComments(deckId, slideId, "deck");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    selectedThreadId,
  );
  useEffect(() => {
    setActiveThreadId(selectedThreadId);
  }, [selectedThreadId, selectedThreadRequestId]);

  // New comments start on the canvas, where their pin will live.
  useEffect(() => {
    if (!pendingComment) return;
    if (canComment && pendingComment.slideId === slideId) {
      requestSlideComment({
        kind: "draft",
        slideId: pendingComment.slideId,
        anchor: pendingComment.anchor ?? SLIDE_CENTER,
        quotedText: pendingComment.quotedText || undefined,
      });
    }
    onPendingDone();
  }, [canComment, onPendingDone, pendingComment, slideId]);

  useEffect(() => {
    setClientAppState(
      appStateKeyForBrowserTab("slides-comments", TAB_ID),
      { open: true, threadId: activeThreadId },
      { requestSource: TAB_ID },
    ).catch((error: unknown) => {
      console.warn(
        "[slides] could not publish the open comment thread:",
        error,
      );
    });
  }, [activeThreadId]);
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

  const targets = useMemo<ReviewThreadGroupTarget[]>(
    () =>
      slideIds.map((id, index) => ({
        id,
        name: t("comments.slideGroup", { number: index + 1 }),
      })),
    [slideIds, t],
  );

  const labels = useMemo<ReviewThreadsPanelLabels>(
    () => ({
      threadsCount: (count) => t("comments.threadsCount", { count }),
      search: t("comments.search"),
      filter: t("comments.filters"),
      filtersActive: t("comments.filtersActive"),
      showResolved: t("comments.showResolvedFilter"),
      onlyYours: t("comments.onlyYours"),
      currentTarget: t("comments.thisSlide"),
      sort: t("comments.sort"),
      sortByDate: t("comments.sortByDate"),
      sortByUnread: t("comments.sortByUnread"),
      markAllRead: t("comments.markAllRead"),
      newThread: t("comments.addComment"),
      loading: t("comments.loading"),
      emptyState: t("comments.noCommentsYet"),
      error: t("comments.loadFailed"),
      ungrouped: t("comments.removedSlidesGroup"),
      reviewer: t("comments.reviewer"),
      agent: t("comments.agentBadge"),
      unread: t("comments.unread"),
      resolved: t("comments.resolved"),
    }),
    [t],
  );

  const selectThread = useCallback(
    (thread: ReviewThread) => {
      const threadId = thread.root.threadId;
      setActiveThreadId(threadId);
      const onSlide = threadSlideId(thread);
      if (onSlide && onSlide !== slideId && slideIds.includes(onSlide)) {
        onSelectSlide?.(onSlide);
      }
      if (onSlide && hasCanvasPin(thread)) {
        requestSlideComment({
          kind: "open-thread",
          slideId: onSlide,
          threadId,
        });
      }
    },
    [onSelectSlide, slideId, slideIds],
  );

  const renderUnpinnedThread = (thread: ReviewThread) => {
    // A thread with no canvas pin, such as an old slide-level comment, opens
    // under its row instead.
    if (!deckId || hasCanvasPin(thread)) return null;
    const slideThread = slideCommentThreads([
      thread.root,
      ...thread.replies,
    ]).at(0);
    if (!slideThread) return null;
    return (
      <SlideReviewThreadCard
        thread={slideThread}
        deckId={deckId}
        discussion={discussion}
        canComment={canComment}
        canEdit={canEdit}
        currentUserEmail={currentUserEmail}
        peopleMentionOptions={surface.peopleMentionOptions}
        agent={surface.agent}
        onBeforeCommentSubmit={onBeforeCommentSubmit}
        onClose={() => setActiveThreadId(null)}
        onResolved={onThreadResolved}
        className="w-full shadow-none"
      />
    );
  };

  if (!deckId) return null;

  return (
    <div className="flex h-full w-60 flex-shrink-0 flex-col border-s border-border bg-[var(--slides-editor-surface)]">
      <ReviewThreadsPanel
        query={slideReviewQueryParams(deckId)}
        canComment={canComment}
        currentUserEmail={currentUserEmail}
        currentTargetId={slideId}
        targets={targets}
        targetIdForThread={threadSlideId}
        labels={labels}
        onSelectThread={selectThread}
        onNewThread={canComment ? onNewThread : undefined}
        activeThreadId={activeThreadId}
        onError={() => toast.error(t("comments.updateFailed"))}
        renderActiveThread={renderUnpinnedThread}
        headerActions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-[10px]"
            aria-label={t("comments.close")}
            onClick={onClose}
          >
            <IconX className="size-4" />
          </Button>
        }
      />
    </div>
  );
}
