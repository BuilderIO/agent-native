import { describe, expect, it } from "vitest";

import { findSlideExportSource } from "./export-pdf-client.js";

/**
 * A slide is rendered twice: once as a sidebar thumbnail and once as the
 * editor canvas. Both carry the same layout width and are distinguished only
 * by a CSS `scale()` — which `offsetWidth` does not see. Picking the wrong
 * one silently exports the low-fidelity thumbnail, so the tiebreak is worth
 * pinning.
 */
function makeCandidate(offsetWidth: number, renderedWidth: number) {
  return {
    offsetWidth,
    getBoundingClientRect: () => ({ width: renderedWidth }),
  } as unknown as HTMLElement;
}

describe("findSlideExportSource", () => {
  it("prefers the visually larger copy when both report the same offsetWidth", () => {
    // Sidebar thumbnail comes first in document order and is scaled down;
    // offsetWidth ignores the transform so both read 960.
    const thumbnail = makeCandidate(960, 192);
    const canvas = makeCandidate(960, 960);

    expect(findSlideExportSource([thumbnail, canvas])).toBe(canvas);
  });

  it("still prefers the canvas when the editor is zoomed out", () => {
    const thumbnail = makeCandidate(960, 192);
    const zoomedCanvas = makeCandidate(960, 634);

    expect(findSlideExportSource([thumbnail, zoomedCanvas])).toBe(
      zoomedCanvas,
    );
  });

  it("falls back to offsetWidth when rendered widths genuinely tie", () => {
    const small = makeCandidate(480, 480);
    const large = makeCandidate(960, 480);

    expect(findSlideExportSource([small, large])).toBe(large);
  });
});
