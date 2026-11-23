import { useLayoutEffect, useRef, type RefObject } from "react";

import { PAGE_PANEL_SLIDE_MS } from "./document-page-panel-state";

const SLIDE_MS = 260;

/** Where the page's text starts. A container query can change the inset
 * before it without moving the block that holds it. */
function textLeft(lead: Element) {
  return (
    lead.getBoundingClientRect().left +
    parseFloat(getComputedStyle(lead).paddingLeft)
  );
}

/**
 * Slides the page over as the review margin opens or closes. The margin opens
 * in the long frame that mounts the comment card, and a transition on the
 * column's padding counted that frame, so the page drew most of the way over
 * in one jump. A transform runs on the compositor and counts from the first
 * frame it draws. It moves the page and the comment lane together, so the
 * lane, which measures its place against the page, holds still beside it.
 *
 * The page panel docking moves the text the same way, often in the same commit
 * as the margin leaving, so one slide covers both: two would fight over the
 * transform, and the page has to move only once.
 */
export function useReviewMarginSlide(
  refs: {
    scroller: RefObject<HTMLElement | null>;
    content: RefObject<HTMLElement | null>;
    column: RefObject<HTMLElement | null>;
    panelSpacer: RefObject<HTMLElement | null>;
  },
  reserved: boolean,
  panelDocked: boolean,
) {
  const { scroller, content, column, panelSpacer } = refs;
  const shown = useRef<{ margin: string; panel: string } | null>(null);
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const viewport = scroller.current;
    const moving = content.current;
    const page = column.current;
    if (!viewport || !moving || !page) return;
    const style = getComputedStyle(page);
    const spacer = panelSpacer.current;
    const panelWidth = spacer?.style.width ?? "";
    const to = { margin: style.paddingRight, panel: panelWidth };
    const from = shown.current;
    shown.current = to;
    const lead = page.firstElementChild;
    if (
      from === null ||
      (from.margin === to.margin && from.panel === to.panel) ||
      !lead ||
      !("animate" in moving) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // The page is drawn at the old margin, moved by any slide still running,
    // so a slide reversed partway turns around where the page is.
    page.style.paddingRight = from.margin;
    if (spacer) spacer.style.width = from.panel;
    const drawn = textLeft(lead);
    page.style.paddingRight = "";
    if (spacer) spacer.style.width = panelWidth;
    running.current?.cancel();
    const shift = drawn - textLeft(lead);
    if (Math.abs(shift) < 1) return;
    // Opening starts the page to the right of where it lands, which would
    // show a horizontal scrollbar for the length of the slide.
    viewport.style.overflowX = "hidden";
    const slide = moving.animate(
      [{ transform: `translateX(${shift}px)` }, { transform: "none" }],
      {
        duration: from.panel === to.panel ? SLIDE_MS : PAGE_PANEL_SLIDE_MS,
        easing: style.getPropertyValue("--ease-drawer").trim() || "ease-out",
      },
    );
    running.current = slide;
    // A replaced slide's cancel event arrives after the new slide has started;
    // only the slide still running gives the scrollbar back.
    const settle = () => {
      if (running.current !== slide) return;
      running.current = null;
      viewport.style.overflowX = "";
    };
    slide.onfinish = settle;
    slide.oncancel = settle;
  }, [scroller, content, column, panelSpacer, reserved, panelDocked]);
  useLayoutEffect(
    () => () => {
      running.current?.cancel();
    },
    [],
  );
}
