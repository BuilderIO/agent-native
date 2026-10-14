import { useCallback, useEffect, useRef, useState } from "react";

import type { UndoReveal, UndoSelectionRequest } from "@/lib/undo-reveal";

/**
 * An editor that is not showing the slide (generating overlay, another deck
 * page) never consumes the request, and its paths would then select the wrong
 * objects on a later content change. A request nobody applied by now is stale.
 */
export const UNDO_SELECTION_TTL_MS = 2000;

/**
 * Undo/redo shows the slide it rewrote and re-selects what changed. The
 * request travels with the slide update so the editor applies it to the DOM
 * that already carries the restored content.
 */
export function useUndoSelection({
  deckId,
  subscribe,
  getCurrentSlideId,
  selectSlide,
}: {
  deckId: string | undefined;
  subscribe: (listener: (reveal: UndoReveal) => void) => () => void;
  getCurrentSlideId: () => string | undefined;
  selectSlide: (slideId: string) => void;
}) {
  const [undoSelection, setUndoSelection] =
    useState<UndoSelectionRequest | null>(null);
  const sequenceRef = useRef(0);
  const clearUndoSelection = useCallback(() => setUndoSelection(null), []);
  const selectSlideRef = useRef(selectSlide);
  selectSlideRef.current = selectSlide;
  const getCurrentSlideIdRef = useRef(getCurrentSlideId);
  getCurrentSlideIdRef.current = getCurrentSlideId;

  useEffect(
    () =>
      subscribe((reveal) => {
        if (reveal.deckId !== deckId) return;
        const currentSlideId = getCurrentSlideIdRef.current();
        const rewritten =
          reveal.slides.find((slide) => slide.slideId === currentSlideId) ??
          reveal.slides[0];
        if (!rewritten) return;
        if (rewritten.slideId !== currentSlideId) {
          selectSlideRef.current(rewritten.slideId);
        }
        sequenceRef.current += 1;
        setUndoSelection({
          sequence: sequenceRef.current,
          slideId: rewritten.slideId,
          targets: rewritten.targets,
        });
      }),
    [deckId, subscribe],
  );

  useEffect(() => {
    if (!undoSelection) return;
    const timer = setTimeout(clearUndoSelection, UNDO_SELECTION_TTL_MS);
    return () => clearTimeout(timer);
  }, [undoSelection, clearUndoSelection]);

  return { undoSelection, clearUndoSelection };
}
