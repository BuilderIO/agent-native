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

    const handleToolInput = (event: Event) => {
      const detail = (event as CustomEvent<ToolInputEventDetail>).detail;
      if (detail?.tool !== "add-slide") return;

      const parsed = parsePartialAddSlideInput(detail.argsText ?? "");
      if (parsed.deckId && parsed.deckId !== deckId) return;

      if (detail.phase === "start") {
        if (detail.id && activeCallIdRef.current === detail.id) return;
        activeCallIdRef.current = detail.id ?? null;
        setContent(null);
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
        setContent(parsed.content || null);
      }
    };

    window.addEventListener("agent-native:tool-input", handleToolInput);
    return () =>
      window.removeEventListener("agent-native:tool-input", handleToolInput);
  }, [deckId, generating]);

  return content;
}
