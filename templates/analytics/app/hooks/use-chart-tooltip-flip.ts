import { useEffect, useRef } from "react";

const VIEWPORT_GUTTER_PADDING = 12;
const FLIP_CURSOR_OFFSET = 24;

/**
 * Recharts tooltips can extend past the chart's right edge and get clipped by
 * the agent sidebar. Attach the returned ref to the tooltip content's outer
 * div; while the tooltip is mounted we observe the recharts wrapper's
 * `transform` (cursor moves) and translate the content left when its right
 * edge would land inside `.agent-sidebar-panel`.
 */
export function useChartTooltipFlip<T extends HTMLElement>(active = true) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const wrapper = el.parentElement;
    if (!wrapper) return;

    const apply = () => {
      const node = ref.current;
      if (!node) return;
      node.style.transform = "";
      const rect = node.getBoundingClientRect();
      if (rect.width === 0) return;

      const sidebar = document.querySelector(".agent-sidebar-panel");
      const sidebarRect = sidebar?.getBoundingClientRect();
      const gutterLeft =
        sidebarRect && sidebarRect.width > 0 && sidebarRect.left > 0
          ? sidebarRect.left
          : window.innerWidth;
      const rightLimit = gutterLeft - VIEWPORT_GUTTER_PADDING;
      const bottomLimit = window.innerHeight - VIEWPORT_GUTTER_PADDING;
      let translateX = 0;
      let translateY = 0;

      if (rect.right > rightLimit) {
        translateX = -(rect.width + FLIP_CURSOR_OFFSET);
      }
      if (rect.bottom > bottomLimit) {
        translateY = bottomLimit - rect.bottom;
      } else if (rect.top < VIEWPORT_GUTTER_PADDING) {
        translateY = VIEWPORT_GUTTER_PADDING - rect.top;
      }

      const transforms = [
        translateX ? `translateX(${translateX}px)` : "",
        translateY ? `translateY(${translateY}px)` : "",
      ].filter(Boolean);
      node.style.transform = transforms.join(" ");
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(wrapper, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, [active]);

  return ref;
}
