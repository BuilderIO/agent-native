import { useT } from "@agent-native/core/client/i18n";
import { SLIDE_REVIEW_THREAD_PARAM } from "@shared/slide-review";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { useSlideComments } from "./use-slide-comments";

/**
 * Opens the thread a comment email links to. The link names the thread, not a
 * slide position, so it still lands on the right slide after a reorder.
 */
export function useOpenCommentFromUrl({
  deckId,
  slideIds,
  activeSlideId,
  onSelectSlide,
  onSelectThread,
}: {
  deckId: string | null;
  slideIds: readonly string[] | undefined;
  activeSlideId: string | null;
  onSelectSlide: (slideId: string) => void;
  onSelectThread: (threadId: string) => void;
}): void {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const threadId = searchParams.get(SLIDE_REVIEW_THREAD_PARAM);
  // The editor's own `?slide=` sync writes from a render-time snapshot, which
  // can put the param back after it is removed; a link opens once.
  const handled = useRef<string | null>(null);
  const { data: threads, isError } = useSlideComments(
    threadId ? deckId : null,
    null,
    "deck",
  );

  useEffect(() => {
    // Wait for the editor to settle on a slide, or its own default would
    // override the one chosen here.
    if (!threadId || !slideIds || !activeSlideId) return;
    if (!threads && !isError) return;
    if (handled.current === threadId) return;
    handled.current = threadId;
    const thread = threads?.find((entry) => entry.threadId === threadId);
    if (thread) {
      if (thread.slideId && slideIds.includes(thread.slideId)) {
        onSelectSlide(thread.slideId);
      }
      onSelectThread(threadId);
    } else {
      toast.error(t("comments.threadNotFound"));
    }
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(SLIDE_REVIEW_THREAD_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [
    activeSlideId,
    isError,
    onSelectSlide,
    onSelectThread,
    setSearchParams,
    slideIds,
    t,
    threadId,
    threads,
  ]);
}
