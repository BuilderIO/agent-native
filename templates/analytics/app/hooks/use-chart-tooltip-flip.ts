import { useEffect, useRef } from "react";

const RIGHT_GUTTER_PADDING = 12;
const FLIP_CURSOR_OFFSET = 24;

/**
 * Recharts tooltips can extend past the chart's right edge and get clipped by
 * the agent sidebar. Attach the returned ref to the tooltip content's outer
 * div; while the tooltip is mounted we observe the recharts wrapper's
 * `transform` (cursor moves) and translate the content left when its right
 * edge would land inside `.agent-sidebar-panel`.
 */
export function useChartTooltipFlip<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
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
      const limit = gutterLeft - RIGHT_GUTTER_PADDING;

      if (rect.right > limit) {
        node.style.transform = `translateX(-${rect.width + FLIP_CURSOR_OFFSET}px)`;
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(wrapper, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, []);

  return ref;
}
