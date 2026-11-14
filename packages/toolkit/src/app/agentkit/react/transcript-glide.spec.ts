import { describe, expect, it } from "vitest";

import { TranscriptGlide } from "./transcript-glide.js";

const frameMs = 1000 / 60;
const lineHeight = 21;

/** A scroller whose offset rounds and clamps the way a browser's does. */
function scroller(scrollHeight: number, clientHeight = 600) {
  let offset = scrollHeight - clientHeight;
  return {
    scrollHeight,
    clientHeight,
    get scrollTop() {
      return offset;
    },
    set scrollTop(value: number) {
      offset = Math.round(
        Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)),
      );
    },
  };
}

function harness(element: ReturnType<typeof scroller>) {
  let following = true;
  let pending: ((time: number) => void) | null = null;
  let time = 0;
  const writes: number[] = [];
  const glide = new TranscriptGlide({
    element,
    write: (scrollTop) => {
      writes.push(scrollTop);
      element.scrollTop = scrollTop;
    },
    following: () => following,
    requestFrame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
  });
  return {
    glide,
    writes,
    unfollow: () => (following = false),
    /** Runs one frame, after `beforeFrame` changes the content. */
    frame(beforeFrame?: () => void) {
      time += frameMs;
      beforeFrame?.();
      const callback = pending;
      pending = null;
      callback?.(time);
    },
  };
}

describe("TranscriptGlide", () => {
  it("slides a wrapped line into view over several frames", () => {
    const element = scroller(2_000);
    const { glide, frame } = harness(element);
    element.scrollHeight += lineHeight;
    glide.follow();
    const positions: number[] = [element.scrollTop];
    for (let index = 0; index < 20; index += 1) {
      frame();
      positions.push(element.scrollTop);
    }
    const steps = positions
      .slice(1)
      .map((position, index) => position - positions[index]!);

    expect(Math.max(...steps)).toBeLessThanOrEqual(lineHeight / 3);
    expect(steps.filter((step) => step > 0).length).toBeGreaterThan(4);
    expect(element.scrollTop).toBe(element.scrollHeight - element.clientHeight);
    expect(glide.active).toBe(false);
  });

  it("retargets as content keeps growing and stays close behind it", () => {
    const element = scroller(2_000);
    const { glide, frame } = harness(element);
    glide.follow();
    let largestStep = 0;
    let largestLag = 0;
    // A new line roughly every 220ms, as a fast reply wraps.
    for (let index = 1; index <= 180; index += 1) {
      const before = element.scrollTop;
      frame(() => {
        if (index % 13 === 0) element.scrollHeight += lineHeight;
      });
      largestStep = Math.max(largestStep, element.scrollTop - before);
      largestLag = Math.max(
        largestLag,
        element.scrollHeight - element.clientHeight - element.scrollTop,
      );
      if (!glide.active) glide.follow();
    }

    expect(largestStep).toBeLessThan(lineHeight / 2);
    expect(largestLag).toBeLessThanOrEqual(lineHeight + 1);
  });

  it("stops without writing once the reader scrolls", () => {
    const element = scroller(2_000);
    const { glide, frame, writes } = harness(element);
    element.scrollHeight += 200;
    glide.follow();
    frame();
    frame();
    const written = writes.length;
    element.scrollTop -= 120;
    const readerPosition = element.scrollTop;
    frame();
    frame();

    expect(writes).toHaveLength(written);
    expect(element.scrollTop).toBe(readerPosition);
    expect(glide.active).toBe(false);
  });

  it("stops as soon as the transcript stops following", () => {
    const element = scroller(2_000);
    const { glide, frame, writes, unfollow } = harness(element);
    element.scrollHeight += 200;
    glide.follow();
    frame();
    unfollow();
    const written = writes.length;
    frame();

    expect(writes).toHaveLength(written);
    expect(glide.active).toBe(false);
  });
});
