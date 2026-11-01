import { useLayoutEffect, useRef, type RefObject } from "react";

const SLIDE_MS = 260;

/**
 * Slides the page over as the review margin opens or closes. The margin opens
 * in the long frame that mounts the comment card, and a transition on the
 * column's padding counted that frame, so the page drew most of the way over
 * in one jump. A transform runs on the compositor and counts from the first
 * frame it draws. It moves the page and the comment lane together, so the
 * lane, which measures its place against the page, holds still beside it.
 */
export function useReviewMarginSlide(
  refs: {
    scroller: RefObject<HTMLElement | null>;
    content: RefObject<HTMLElement | null>;
    column: RefObject<HTMLElement | null>;
  },
  reserved: boolean,
) {
  const { scroller, content, column } = refs;
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const viewport = scroller.current;
    const moving = content.current;
    const page = column.current;
    if (!viewport || !moving || !page) return;
    const style = getComputedStyle(page);
    const to = style.paddingRight;
    const from = shown.current;
    shown.current = to;
    const lead = page.firstElementChild;
    if (
      from === null ||
      from === to ||
      !lead ||
      !("animate" in moving) ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const landed = lead.getBoundingClientRect().left;
    page.style.paddingRight = from;
    const left = lead.getBoundingClientRect().left;
    page.style.paddingRight = "";
    const shift = left - landed;
    if (Math.abs(shift) < 1) return;
    // Opening starts the page to the right of where it lands, which would
    // show a horizontal scrollbar for the length of the slide.
    viewport.style.overflowX = "hidden";
    const slide = moving.animate(
      [{ transform: `translateX(${shift}px)` }, { transform: "none" }],
      {
        duration: SLIDE_MS,
        easing: style.getPropertyValue("--ease-drawer").trim() || "ease-out",
      },
    );
    const settle = () => {
      viewport.style.overflowX = "";
    };
    slide.onfinish = settle;
    slide.oncancel = settle;
    return () => slide.cancel();
  }, [scroller, content, column, reserved]);
}
