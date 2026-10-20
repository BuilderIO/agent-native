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
  const [preview, setPreview] = useState<{
    deckId: string;
    slideCount: number;
    content: string;
  } | null>(null);
  const generationRef = useRef(0);
  const activeCallIdRef = useRef<string | null>(null);
  const callIdsRef = useRef(new Set<string>());
  const ignoredCallIdsRef = useRef(new Set<string>());
  const pendingContentRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeCallIdRef.current = null;
    callIdsRef.current.clear();
    pendingContentRef.current = null;
    setPreview(null);

    if (!generating) {
      return () => {
        if (generationRef.current === generation) generationRef.current++;
      };
    }

    const flush = () => {
      if (generationRef.current !== generation) return;
      rafIdRef.current = null;
      const content = pendingContentRef.current;
      setPreview(
        content === null ? null : { deckId, slideCount, content },
      );
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
      if (detail.id && ignoredCallIdsRef.current.has(detail.id)) return;
      if (detail.id) callIdsRef.current.add(detail.id);

      if (detail.phase === "start") {
        if (detail.id && activeCallIdRef.current === detail.id) return;
        activeCallIdRef.current = detail.id ?? null;
        scheduleFlush(null);
        return;
      }

      const parsed = parsePartialAddSlideInput(detail.argsText ?? "");
      if (parsed.deckId !== deckId) return;

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
      if (generationRef.current === generation) generationRef.current++;
      for (const callId of callIdsRef.current) {
        ignoredCallIdsRef.current.add(callId);
      }
      callIdsRef.current.clear();
      activeCallIdRef.current = null;
      pendingContentRef.current = null;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [deckId, generating, slideCount]);

  if (
    !generating ||
    preview?.deckId !== deckId ||
    preview.slideCount !== slideCount
  ) {
    return null;
  }
  return preview.content;
}
