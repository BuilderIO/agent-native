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
  threshold = 40,
  enabled = true,
}: UseNearBottomAutoscrollOptions) {
  const scrollRef = useRef<TElement | null>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const updateNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isNearBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    const onScroll = () => updateNearBottom();
    el.addEventListener("scroll", onScroll, { passive: true });
    updateNearBottom();

    // Re-check near-bottom whenever the scroll container's content grows
    // (e.g. new messages appended, images loaded, tool-call details expanded).
    // Without this the "near bottom" flag can get stuck as `false` even though
    // the user never scrolled away — the container just grew taller.
    const ro = new ResizeObserver(() => {
      if (isNearBottomRef.current) scrollToBottom();
      else updateNearBottom();
    });
    ro.observe(el);
    // Also watch direct children so inline content changes are caught.
    for (const child of Array.from(el.children)) ro.observe(child);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [enabled, updateNearBottom, scrollToBottom]);

  const scrollToBottomAfterPaint = useCallback(() => {
    scrollToBottom();
    requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(scrollToBottom);
    });
    window.setTimeout(scrollToBottom, 80);
  }, [scrollToBottom]);

  const markNearBottom = useCallback(() => {
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  useEffect(() => {
    if (!enabled || !isNearBottomRef.current) return;
    scrollToBottomAfterPaint();
  }, [enabled, followKey, scrollToBottomAfterPaint]);

  useEffect(() => {
    if (!enabled || !streaming) return;
    const id = window.setInterval(() => {
      if (isNearBottomRef.current) scrollToBottom();
    }, 100);
    return () => window.clearInterval(id);
  }, [enabled, scrollToBottom, streaming]);

  return {
    scrollRef,
    isNearBottomRef,
    showScrollToBottom,
    markNearBottom,
    scrollToBottom,
    scrollToBottomAfterPaint,
  };
}
