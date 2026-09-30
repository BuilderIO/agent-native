import { useLayoutEffect, useState, type RefObject } from "react";

// Leave room for the search field, group label, and at least one action.
const MIN_USABLE_PANEL_HEIGHT = 120;
// ponytail: 280px ceiling keeps recent output visible; raise it if long menus need more items shown.
const MAX_COMPOSER_PANEL_HEIGHT = 280;

export function useComposerPanelPlacement(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
) {
  const [placement, setPlacement] = useState({
    width: 320,
    maxHeight: MAX_COMPOSER_PANEL_HEIGHT,
    side: "top" as "top" | "bottom",
    sideOffset: 8,
    alignOffset: 0,
    direction: "ltr" as "ltr" | "rtl",
  });
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const frame = trigger?.closest<HTMLElement>(
      '[data-agent-composer-slot="root"]',
    );
    if (!trigger || !frame) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const bounds = frame.getBoundingClientRect();
      const button = trigger.getBoundingClientRect();
      const rtl = getComputedStyle(frame).direction === "rtl";
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom =
        viewportTop + (viewport?.height ?? window.innerHeight);
      const spaceAbove = Math.max(0, bounds.top - viewportTop - 24);
      const spaceBelow = Math.max(0, viewportBottom - bounds.bottom - 24);
      const side =
        spaceAbove < MIN_USABLE_PANEL_HEIGHT && spaceBelow > spaceAbove
          ? "bottom"
          : "top";
      setPlacement({
        width: bounds.width,
        direction: rtl ? "rtl" : "ltr",
        side,
        maxHeight: Math.min(
          MAX_COMPOSER_PANEL_HEIGHT,
          side === "top" ? spaceAbove : spaceBelow,
        ),
        sideOffset:
          side === "top"
            ? button.top - bounds.top + 8
            : bounds.bottom - button.bottom + 8,
        alignOffset: rtl
          ? button.right - bounds.right
          : bounds.left - button.left,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(trigger);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [open, triggerRef]);
  return placement;
}
