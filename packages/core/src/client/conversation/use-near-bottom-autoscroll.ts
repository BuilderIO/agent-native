import { useCallback, useEffect, useRef, useState } from "react";

export interface UseNearBottomAutoscrollOptions {
  followKey: unknown;
  streaming?: boolean;
  threshold?: number;
  enabled?: boolean;
}

function eventElementTarget(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Node)) return null;
  if (target instanceof HTMLElement) return target;
  return target.parentElement;
}

function canScrollElementVertically(
  element: HTMLElement,
  deltaY: number,
): boolean {
  if (element.scrollHeight <= element.clientHeight) return false;
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY || style.overflow;
  if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
  if (deltaY < 0) return element.scrollTop > 0;
  if (deltaY > 0) {
    return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  }
  return false;
}

function nestedScrollableConsumesVerticalIntent(
  event: Event,
  root: HTMLElement,
  deltaY: number,
): boolean {
  let element = eventElementTarget(event);
  while (element && element !== root) {
    if (canScrollElementVertically(element, deltaY)) return true;
    element = element.parentElement;
  }
  return false;
}

/**
 * @deprecated Nothing in this repo calls this any more — `AgentConversation`
 * and `AssistantChat` both stick to the bottom via the shadcn `MessageScroller`
 * primitive, which does it with one mechanism instead of five.
 *
 * What is below is five independent things all writing `scrollTop`: a scroll
 * listener with a content-shrank heuristic, a ResizeObserver re-attached to
 * every child on each mutation, a MutationObserver that scrolls, a
 * rAF+rAF+setTimeout(80) chain, and a 100ms interval while streaming. Each was
 * added to fix a different report and none replaced the one before it, so they
 * race: that is the "text bumps up and down rapidly" and "flashing and
 * jittering" users kept describing. Kept only so an external template importing
 * it does not break; do not adopt it, and delete it in the next major.
 */
export function useNearBottomAutoscroll<TElement extends HTMLElement>({
  followKey,
  streaming = false,
  threshold = 4,
  enabled = true,
}: UseNearBottomAutoscrollOptions) {
  const scrollRef = useRef<TElement | null>(null);
  const isNearBottomRef = useRef(true);
  const followGenerationRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const lastTouchYRef = useRef<number | null>(null);
  const pendingAnimationFrameIdsRef = useRef<Set<number>>(new Set());
  const pendingTimeoutIdsRef = useRef<Set<number>>(new Set());
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const cancelPendingScrolls = useCallback(() => {
    for (const id of pendingAnimationFrameIdsRef.current) {
      window.cancelAnimationFrame(id);
    }
    pendingAnimationFrameIdsRef.current.clear();
    for (const id of pendingTimeoutIdsRef.current) {
      window.clearTimeout(id);
    }
    pendingTimeoutIdsRef.current.clear();
  }, []);

  const scheduleAnimationFrame = useCallback(
    (callback: FrameRequestCallback) => {
      let id = 0;
      id = window.requestAnimationFrame((time) => {
        pendingAnimationFrameIdsRef.current.delete(id);
        callback(time);
      });
      pendingAnimationFrameIdsRef.current.add(id);
    },
    [],
  );

  const isAtBottom = useCallback(
    (el: HTMLElement) =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= threshold,
    [threshold],
  );

  const setFollowingBottom = useCallback(
    (following: boolean, forceGeneration = false, el?: HTMLElement) => {
      if (forceGeneration || isNearBottomRef.current !== following) {
        followGenerationRef.current += 1;
      }
      isNearBottomRef.current = following;
      const canScroll = !el || el.scrollHeight > el.clientHeight + threshold;
      setShowScrollToBottom(!following && canScroll);
    },
    [threshold],
  );

  const detachFromBottom = useCallback(() => {
    setFollowingBottom(false, true, scrollRef.current ?? undefined);
  }, [setFollowingBottom]);

  const updateBottomState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottom(el)) setFollowingBottom(true, false, el);
    else if (!isNearBottomRef.current) {
      setShowScrollToBottom(el.scrollHeight > el.clientHeight + threshold);
    }
  }, [isAtBottom, setFollowingBottom, threshold]);

  const scrollToBottomIfFollowing = useCallback(
    (generation: number) => {
      if (
        followGenerationRef.current !== generation ||
        !isNearBottomRef.current
      ) {
        return;
      }
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      lastScrollTopRef.current = el.scrollTop;
      setFollowingBottom(true, false, el);
    },
    [setFollowingBottom],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFollowingBottom(true, true, el);
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    lastScrollTopRef.current = el.scrollTop;
  }, [setFollowingBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    lastScrollTopRef.current = el.scrollTop;
    let lastScrollHeight = el.scrollHeight;

    const onWheel = (event: WheelEvent) => {
      if (nestedScrollableConsumesVerticalIntent(event, el, event.deltaY)) {
        return;
      }
      if (event.deltaY < 0) detachFromBottom();
    };

    const onTouchStart = (event: TouchEvent) => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const nextTouchY = event.touches[0]?.clientY;
      if (nextTouchY == null) return;
      const lastTouchY = lastTouchYRef.current;
      if (lastTouchY != null && nextTouchY > lastTouchY) {
        const deltaY = lastTouchY - nextTouchY;
        if (!nestedScrollableConsumesVerticalIntent(event, el, deltaY)) {
          detachFromBottom();
        }
      }
      lastTouchYRef.current = nextTouchY;
    };

    const onTouchEnd = () => {
      lastTouchYRef.current = null;
    };

    const onScroll = (event: Event) => {
      if (event.target !== el) return;
      const previousScrollTop = lastScrollTopRef.current;
      const nextScrollTop = el.scrollTop;
      const nextScrollHeight = el.scrollHeight;
      // When the message list briefly shrinks (a re-render swaps content, a
      // streaming/reconnect placeholder collapses, images unload, the message
      // list remounts as a new run starts, etc.) the browser is forced to clamp
      // scrollTop downward and fires a scroll event. That clamp is not the user
      // scrolling up — treating it as such detaches auto-follow and strands the
      // conversation scrolled up, sometimes all the way at the top. Only treat a
      // downward jump as user intent when the content did not shrink underneath
      // it. Genuine user scroll-ups (wheel/touch/keys, scrollbar drag at a
      // stable height) are unaffected.
      const contentShrank = nextScrollHeight < lastScrollHeight;
      lastScrollTopRef.current = nextScrollTop;
      lastScrollHeight = nextScrollHeight;
      if (nextScrollTop < previousScrollTop && !contentShrank) {
        detachFromBottom();
        return;
      }
      updateBottomState();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey)
      ) {
        if (nestedScrollableConsumesVerticalIntent(event, el, -1)) return;
        detachFromBottom();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    updateBottomState();

    // Re-check near-bottom whenever the scroll container's content grows
    // (e.g. new messages appended, images loaded, tool-call details expanded).
    // Without this the "near bottom" flag can get stuck as `false` even though
    // the user never scrolled away — the container just grew taller.
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      const observeResizeTargets = () => {
        ro?.disconnect();
        ro = new ResizeObserver(() => {
          if (isNearBottomRef.current) {
            scrollToBottomIfFollowing(followGenerationRef.current);
          } else {
            updateBottomState();
          }
        });
        ro.observe(el);
        // Also watch direct children so inline content changes are caught.
        for (const child of Array.from(el.children)) ro.observe(child);
      };
      observeResizeTargets();
      if (typeof MutationObserver !== "undefined") {
        mo = new MutationObserver(() => {
          observeResizeTargets();
          if (isNearBottomRef.current) {
            scrollToBottomIfFollowing(followGenerationRef.current);
          }
        });
        mo.observe(el, { childList: true });
      }
    }

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("keydown", onKeyDown);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [detachFromBottom, enabled, scrollToBottomIfFollowing, updateBottomState]);

  const scrollToBottomAfterPaint = useCallback(() => {
    cancelPendingScrolls();
    const generation = followGenerationRef.current;
    scrollToBottomIfFollowing(generation);
    scheduleAnimationFrame(() => {
      scrollToBottomIfFollowing(generation);
      scheduleAnimationFrame(() => scrollToBottomIfFollowing(generation));
    });
    const timeoutId = window.setTimeout(() => {
      pendingTimeoutIdsRef.current.delete(timeoutId);
      scrollToBottomIfFollowing(generation);
    }, 80);
    pendingTimeoutIdsRef.current.add(timeoutId);
  }, [cancelPendingScrolls, scheduleAnimationFrame, scrollToBottomIfFollowing]);

  useEffect(() => {
    if (!enabled) cancelPendingScrolls();
    return cancelPendingScrolls;
  }, [cancelPendingScrolls, enabled]);

  const resumeFollowing = useCallback(() => {
    const el = scrollRef.current;
    setFollowingBottom(true, true, el ?? undefined);
    scrollToBottomAfterPaint();
  }, [scrollToBottomAfterPaint, setFollowingBottom]);

  const markNearBottom = useCallback(() => {
    setFollowingBottom(true, true, scrollRef.current ?? undefined);
  }, [setFollowingBottom]);

  useEffect(() => {
    if (!enabled || !isNearBottomRef.current) return;
    scrollToBottomAfterPaint();
  }, [enabled, followKey, scrollToBottomAfterPaint]);

  useEffect(() => {
    if (!enabled || !streaming) return;
    const id = window.setInterval(() => {
      scrollToBottomIfFollowing(followGenerationRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [enabled, scrollToBottomIfFollowing, streaming]);

  return {
    scrollRef,
    isNearBottomRef,
    showScrollToBottom,
    markNearBottom,
    scrollToBottom,
    scrollToBottomAfterPaint,
    resumeFollowing,
  };
}
