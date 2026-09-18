import { useEffect, useRef, useState } from "react";

import { parsePartialAddSlideInput } from "@/lib/streaming-slide-html";

interface ToolInputEventDetail {
  phase?: "start" | "delta";
  tool?: string;
  id?: string;
  argsText?: string;
}

export function useGeneratingSlidePreview({
  deckId,
  slideCount,
  generating,
}: {
  deckId: string;
  slideCount: number;
  generating: boolean;
}): string | null {
  const [content, setContent] = useState<string | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const previousSlideCountRef = useRef(slideCount);
  // Latest parsed value awaiting a flush; setContent fires at most once per frame
  // and always reads this ref, so a burst of deltas within one frame collapses
  // to a single render carrying the newest value instead of the stale one.
  const pendingContentRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (slideCount !== previousSlideCountRef.current) {
      previousSlideCountRef.current = slideCount;
      activeCallIdRef.current = null;
      setContent(null);
    }
  }, [slideCount]);

  useEffect(() => {
    if (!generating) {
      activeCallIdRef.current = null;
      setContent(null);
      return;
    }

    const flush = () => {
      rafIdRef.current = null;
      setContent(pendingContentRef.current);
    };

    const scheduleFlush = (value: string | null) => {
      pendingContentRef.current = value;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flush);
      }
    };

    const handleToolInput = (event: Event) => {
      const detail = (event as CustomEvent<ToolInputEventDetail>).detail;
      if (detail?.tool !== "add-slide") return;

      const parsed = parsePartialAddSlideInput(detail.argsText ?? "");
      if (parsed.deckId && parsed.deckId !== deckId) return;

      if (detail.phase === "start") {
        if (detail.id && activeCallIdRef.current === detail.id) return;
        activeCallIdRef.current = detail.id ?? null;
        scheduleFlush(null);
        return;
      }

      if (
        detail.id &&
        activeCallIdRef.current &&
        detail.id !== activeCallIdRef.current
      ) {
        return;
      }
      if (detail.id) activeCallIdRef.current = detail.id;
      if (parsed.content !== undefined) {
        scheduleFlush(parsed.content || null);
      }
    };

    window.addEventListener("agent-native:tool-input", handleToolInput);
    return () => {
      window.removeEventListener("agent-native:tool-input", handleToolInput);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [deckId, generating]);

  return content;
}
