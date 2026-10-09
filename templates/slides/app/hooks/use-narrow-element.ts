import { useLayoutEffect, useState } from "react";

/**
 * True while `element` is laid out narrower than `maxWidth` CSS px. An element
 * that has no layout yet (not mounted, `display: none`, or a test DOM) reads as
 * not narrow, so controls never collapse on a width that was never measured.
 */
export function useNarrowElement(
  element: HTMLElement | null,
  maxWidth: number,
): boolean {
  const [narrow, setNarrow] = useState(false);

  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") {
      setNarrow(false);
      return;
    }
    const update = (width: number) => setNarrow(width > 0 && width < maxWidth);
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, maxWidth]);

  return narrow;
}
