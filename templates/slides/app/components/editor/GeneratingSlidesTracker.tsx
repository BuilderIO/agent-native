import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { useGeneratingSlidePreviews } from "@/hooks/use-generating-slide-preview";

/** A slide the agent is writing, without the HTML that changes every frame. */
export interface GeneratingSlideSummary {
  key: string;
  failed: boolean;
  settling: boolean;
}

export interface GeneratingSlidesSummary {
  slides: GeneratingSlideSummary[];
  replacesDeck: boolean;
  callKey: string | null;
}

export const NO_GENERATING_SLIDES: GeneratingSlidesSummary = {
  slides: [],
  replacesDeck: false,
  callKey: null,
};

/**
 * The streamed HTML of each generating slide, read by the previews that show
 * it. Streaming changes it every frame; keeping it here, outside React state,
 * means only those previews re-render as it grows.
 */
export interface GeneratingSlideContentStore {
  get: (key: string) => string | undefined;
  set: (contents: ReadonlyMap<string, string>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createGeneratingSlideContentStore(): GeneratingSlideContentStore {
  let contents: ReadonlyMap<string, string> = new Map();
  const listeners = new Set<() => void>();
  return {
    get: (key) => contents.get(key),
    set: (next) => {
      contents = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const noSubscription = () => () => {};

/** A generating slide's streamed HTML, or `fallback` without a store or key. */
export function useGeneratingSlideContent(
  store: GeneratingSlideContentStore | undefined,
  key: string | undefined,
  fallback?: string | null,
): string | null | undefined {
  const streamed = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => (store && key ? store.get(key) : undefined),
    () => undefined,
  );
  return streamed ?? fallback;
}

/**
 * Follows the agent's slide writes and reports them in two parts: the summary
 * the editor lays out from, which changes only when a slide appears, lands or
 * finishes, and the HTML, which goes to `store` for the previews alone.
 */
export function GeneratingSlidesTracker({
  deckId,
  generating,
  store,
  onSummary,
}: {
  deckId: string;
  generating: boolean;
  store: GeneratingSlideContentStore;
  onSummary: (summary: GeneratingSlidesSummary) => void;
}) {
  const previews = useGeneratingSlidePreviews({ deckId, generating });
  const previewsRef = useRef(previews);
  previewsRef.current = previews;

  useLayoutEffect(() => {
    store.set(
      new Map(previews.slides.map((slide) => [slide.key, slide.content])),
    );
  }, [previews, store]);

  const summaryKey = JSON.stringify([
    previews.slides.map((slide) => [slide.key, slide.failed, slide.settling]),
    previews.replacesDeck,
    previews.callKey,
  ]);
  // Reported only when what the summary describes changes, not as the HTML
  // inside it grows.
  useLayoutEffect(() => {
    const latest = previewsRef.current;
    onSummary(
      latest.slides.length === 0 && latest.callKey === null
        ? NO_GENERATING_SLIDES
        : {
            slides: latest.slides.map(({ key, failed, settling }) => ({
              key,
              failed,
              settling,
            })),
            replacesDeck: latest.replacesDeck,
            callKey: latest.callKey,
          },
    );
  }, [summaryKey, onSummary]);
  useLayoutEffect(() => () => onSummary(NO_GENERATING_SLIDES), [onSummary]);

  return null;
}
