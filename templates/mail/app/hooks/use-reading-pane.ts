import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import {
  clampListWidth,
  readingPaneLayout,
  readStoredListWidth,
  readStoredPaneEnabled,
  storeListWidth,
  storePaneEnabled,
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

function initialPaneEnabled(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    return readStoredPaneEnabled(window.localStorage);
    // coercion-ok: blocked storage (private browsing) has no remembered choice to read.
  } catch {
    return null;
  }
}

export function useReadingPane(enabled: boolean | undefined) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<{
    container: number;
    viewport: number;
  } | null>(null);
  const [preferredListWidth, setPreferredListWidth] =
    useState(initialListWidth);
  const [rememberedEnabled] = useState(initialPaneEnabled);

  useEffect(() => {
    if (enabled === undefined) return;
    try {
      storePaneEnabled(window.localStorage, enabled);
      // coercion-ok: with storage blocked the saved setting still decides once it loads.
    } catch {}
  }, [enabled]);

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
        enabled: enabled ?? rememberedEnabled ?? true,
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
