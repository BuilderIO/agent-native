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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    const onScroll = () => updateNearBottom();
    el.addEventListener("scroll", onScroll, { passive: true });
    updateNearBottom();
    return () => el.removeEventListener("scroll", onScroll);
  }, [enabled, updateNearBottom]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

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
