import { describe, expect, it } from "vitest";

import {
  type SlideScrollGeometry,
  slideNearReadingLine,
  slideRevealDelta,
} from "./slide-scroll";

// Ten slides, each 200px tall with a 16px gap, in a 500px tall scroller.
const SLIDE = 200;
const PITCH = SLIDE + 16;
const VIEW_TOP = 100;
const VIEW_HEIGHT = 500;
const COUNT = 10;
const PADDING = 56;
const MAX_SCROLL = PADDING + COUNT * PITCH - 16 - VIEW_HEIGHT;

function scrolled(
  scrollTop: number,
  currentIndex: number,
  overrides: Partial<SlideScrollGeometry> = {},
): SlideScrollGeometry {
  return {
    currentIndex,
    count: COUNT,
    currentTop: VIEW_TOP + PADDING + currentIndex * PITCH - scrollTop,
    currentHeight: SLIDE,
    pitch: PITCH,
    viewTop: VIEW_TOP,
    viewHeight: VIEW_HEIGHT,
    scrollTop,
    maxScrollTop: MAX_SCROLL,
    ...overrides,
  };
}

describe("slideNearReadingLine", () => {
  it("points at the first slide at the start of the scroll", () => {
    expect(slideNearReadingLine(scrolled(0, 0))).toBe(0);
    expect(slideNearReadingLine(scrolled(0, COUNT - 1))).toBe(0);
  });

  it("points at the last slide at the end of the scroll with several slides in view", () => {
    expect(slideNearReadingLine(scrolled(MAX_SCROLL, 0))).toBe(COUNT - 1);
    expect(slideNearReadingLine(scrolled(MAX_SCROLL, 4))).toBe(COUNT - 1);
  });

  it("walks forward through the deck as the scroll advances", () => {
    const seen: number[] = [];
    for (let scrollTop = 0; scrollTop <= MAX_SCROLL; scrollTop += 40) {
      seen.push(slideNearReadingLine(scrolled(scrollTop, 0)));
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(COUNT);
  });

  it("does not depend on which slide is current", () => {
    for (const scrollTop of [0, 300, 900, MAX_SCROLL]) {
      const pointed = new Set(
        Array.from({ length: COUNT }, (_, current) =>
          slideNearReadingLine(scrolled(scrollTop, current)),
        ),
      );
      expect(pointed.size).toBe(1);
    }
  });

  it("stays on a lone slide that fits the pane", () => {
    expect(
      slideNearReadingLine(
        scrolled(0, 0, {
          count: 1,
          maxScrollTop: 0,
          currentTop: VIEW_TOP + 80,
        }),
      ),
    ).toBe(0);
  });
});

describe("slideRevealDelta", () => {
  it("does not move when the slide is already in view", () => {
    expect(slideRevealDelta(scrolled(0, 0))).toBe(0);
    expect(slideRevealDelta(scrolled(300, 2))).toBe(0);
  });

  it("scrolls a slide below the pane to the top of it", () => {
    const geometry = scrolled(0, 6);
    const delta = slideRevealDelta(geometry);
    expect(geometry.currentTop - delta).toBeLessThan(VIEW_TOP + 32);
    expect(geometry.currentTop - delta).toBeGreaterThanOrEqual(VIEW_TOP);
  });

  it("scrolls a slide above the pane back down into view", () => {
    const geometry = scrolled(1500, 0);
    expect(slideRevealDelta(geometry)).toBeLessThan(0);
  });

  it("does not move while at least half of the slide still shows", () => {
    // 60px of the 200px slide is scrolled off the top: 70% still visible.
    expect(slideRevealDelta(scrolled(PADDING + 60, 0))).toBe(0);
  });

  it("counts half of the pane as enough when the slide is taller than the pane", () => {
    // 400px slide in a 300px pane: 200px of it showing fills most of the pane.
    const geometry = scrolled(0, 0, {
      currentHeight: 400,
      pitch: 416,
      viewHeight: 300,
      currentTop: VIEW_TOP - 100,
      maxScrollTop: 3000,
    });
    expect(slideRevealDelta(geometry)).toBe(0);
  });
});
