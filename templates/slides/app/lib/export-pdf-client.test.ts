// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { findSlideExportSource } from "./export-pdf-client.js";

/**
 * A slide renders twice — sidebar thumbnail and editor canvas — with the same
 * layout width, distinguished only by a CSS `scale()`. `offsetWidth` does not
 * see transforms, so both read the same number and a strict `>` tiebreak
 * silently returned the document-order-first thumbnail, exporting the
 * low-fidelity copy. happy-dom reports 0 for every layout metric, so the
 * widths are stubbed per element to model the real DOM.
 */
function addSlideCopy(
  slideId: string,
  {
    offsetWidth,
    renderedWidth,
  }: { offsetWidth: number; renderedWidth: number },
) {
  const el = document.createElement("div");
  el.setAttribute("data-slide-canvas", slideId);
  Object.defineProperty(el, "offsetWidth", {
    value: offsetWidth,
    configurable: true,
  });
  el.getBoundingClientRect = () => ({ width: renderedWidth }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("findSlideExportSource", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers the visually larger copy when both report the same offsetWidth", () => {
    // Thumbnail is first in document order — the order the old tiebreak kept.
    const thumbnail = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 192,
    });
    const canvas = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 960,
    });

    const picked = findSlideExportSource("s1", 0, 1);
    expect(picked).toBe(canvas);
    expect(picked).not.toBe(thumbnail);
  });

  it("still prefers the canvas when the editor is zoomed out", () => {
    addSlideCopy("s1", { offsetWidth: 960, renderedWidth: 192 });
    const zoomedCanvas = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 634,
    });

    expect(findSlideExportSource("s1", 0, 1)).toBe(zoomedCanvas);
  });

  it("falls back to offsetWidth when rendered widths genuinely tie", () => {
    addSlideCopy("s1", { offsetWidth: 480, renderedWidth: 480 });
    const larger = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 480,
    });

    expect(findSlideExportSource("s1", 0, 1)).toBe(larger);
  });

  it("throws rather than exporting a partial deck when the slide is not rendered", () => {
    expect(() => findSlideExportSource("missing", 2, 5)).toThrow(
      /Slide 3 of 5 is not currently rendered/,
    );
  });
});
