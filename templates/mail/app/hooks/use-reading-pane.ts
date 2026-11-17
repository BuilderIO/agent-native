import { useCallback, useLayoutEffect, useState } from "react";

import {
  clampListWidth,
  readingPaneLayout,
  readStoredListWidth,
  storeListWidth,
  type ReadingPaneLayout,
} from "@/lib/reading-pane";

function initialListWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    return readStoredListWidth(window.localStorage);
    // coercion-ok: blocked storage (private browsing) has no saved width to read.
  } catch {
    return null;
  }
}

/**
 * Measures the inbox and decides whether the list and the open email sit side
 * by side. `layout` is null until the container has been measured, which
 * happens before the first paint, so callers render nothing in that frame
 * rather than one layout and then the other.
 */
export function useReadingPane(enabled: boolean) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<{
    container: number;
    viewport: number;
  } | null>(null);
  const [preferredListWidth, setPreferredListWidth] =
    useState(initialListWidth);

  useLayoutEffect(() => {
    if (!container) return;
    const measure = () =>
      setSize((current) => {
        const next = {
          container: Math.round(container.getBoundingClientRect().width),
          viewport: window.innerWidth,
        };
        return current?.container === next.container &&
          current.viewport === next.viewport
          ? current
          : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [container]);

  const layout: ReadingPaneLayout | null = size
    ? readingPaneLayout({
        enabled,
        viewportWidth: size.viewport,
        containerWidth: size.container,
        preferredListWidth,
      })
    : null;
  const listMaxWidth = layout?.mode === "pane" ? layout.listMaxWidth : null;

  const commitListWidth = useCallback(
    (width: number) => {
      if (listMaxWidth === null) return;
      const next = clampListWidth(width, listMaxWidth);
      setPreferredListWidth(next);
      try {
        storeListWidth(window.localStorage, next);
        // coercion-ok: with storage blocked the width still holds for this visit.
      } catch {}
    },
    [listMaxWidth],
  );

  return { containerRef: setContainer, layout, commitListWidth };
}
