import { useEffect, useRef } from "react";

const VIEWPORT_GUTTER_PADDING = 12;

/**
 * Ancestors of a dashboard chart (the scrollable app shell, the dashboard
 * grid's inline-size container) clip any content that overflows their box,
 * including a Recharts tooltip positioned near a chart's edge or corner —
 * raising its z-index does not help because clipping is independent of
 * stacking order. Read the Recharts wrapper's live (transform-based) screen
 * position off an invisible marker rendered in its place, then let the
 * caller render the real tooltip through a portal to `document.body` at
 * that position, clamped to the viewport, so it always escapes overflow
 * ancestors entirely instead of being clipped at a container edge.
 */
export function useChartTooltipPortalPosition(active: boolean) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const anchor = anchorRef.current;
    const wrapper = anchor?.parentElement;
    if (!anchor || !wrapper) return;

    const apply = () => {
      const box = boxRef.current;
      if (!box) return;
      const anchorRect = anchor.getBoundingClientRect();

      box.style.left = `${anchorRect.left}px`;
      box.style.top = `${anchorRect.top}px`;

      const rect = box.getBoundingClientRect();
      if (rect.width === 0) return;

      const sidebar = document.querySelector(".agent-sidebar-panel");
      const sidebarRect = sidebar?.getBoundingClientRect();
      const rightEdge =
        sidebarRect && sidebarRect.width > 0 && sidebarRect.left > 0
          ? sidebarRect.left
          : window.innerWidth;

      let left = anchorRect.left;
      if (left + rect.width > rightEdge - VIEWPORT_GUTTER_PADDING) {
        left = rightEdge - VIEWPORT_GUTTER_PADDING - rect.width;
      }
      if (left < VIEWPORT_GUTTER_PADDING) left = VIEWPORT_GUTTER_PADDING;

      let top = anchorRect.top;
      if (top + rect.height > window.innerHeight - VIEWPORT_GUTTER_PADDING) {
        top = window.innerHeight - VIEWPORT_GUTTER_PADDING - rect.height;
      }
      if (top < VIEWPORT_GUTTER_PADDING) top = VIEWPORT_GUTTER_PADDING;

      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(wrapper, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, [active]);

  return { anchorRef, boxRef };
}
