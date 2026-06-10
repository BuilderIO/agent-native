import { useCallback, useEffect, useRef, useState } from "react";

export interface UseNearBottomAutoscrollOptions {
  followKey: unknown;
  streaming?: boolean;
  threshold?: number;
  enabled?: boolean;
}

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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

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
        detachFromBottom();
      }
      lastTouchYRef.current = nextTouchY;
    };

    const onTouchEnd = () => {
      lastTouchYRef.current = null;
    };

    const onScroll = () => {
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
    const generation = followGenerationRef.current;
    scrollToBottomIfFollowing(generation);
    requestAnimationFrame(() => {
      scrollToBottomIfFollowing(generation);
      requestAnimationFrame(() => scrollToBottomIfFollowing(generation));
    });
    window.setTimeout(() => scrollToBottomIfFollowing(generation), 80);
  }, [scrollToBottomIfFollowing]);

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
  };
}
