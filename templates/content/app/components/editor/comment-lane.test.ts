// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { observeCommentLane } from "./comment-lane";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let resize: () => void;
let stop: (() => void) | undefined;
const observed = new Set<Element>();

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  observed.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: Element) {
        observed.add(element);
      }
      unobserve(element: Element) {
        observed.delete(element);
      }
      disconnect() {
        observed.clear();
      }
    },
  );
});

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}

async function flushMount() {
  await vi.waitFor(() => expect(frames.size).toBeGreaterThan(0));
  flushFrames();
}

function fixture() {
  const container = document.createElement("div");
  const lane = document.createElement("aside");
  container.append(lane);
  document.body.append(container);
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue(
    new DOMRect(800, 0, 320, 800),
  );
  return { container, lane };
}

function editor(container: HTMLElement, right = 736) {
  const column = document.createElement("div");
  column.className = "notion-editor";
  vi.spyOn(column, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 0, right - 100, 800),
  );
  container.prepend(column);
  return column;
}

it("aligns when the editor mounts after the comment lane without a resize", async () => {
  const { container, lane } = fixture();
  const offset = vi.fn();
  stop = observeCommentLane(container, lane, offset);
  expect(offset).not.toHaveBeenCalled();
  const column = editor(container);
  await flushMount();
  expect(offset).toHaveBeenLastCalledWith(-64);
  expect(observed.has(column)).toBe(true);
});

it("rebinds the resize observer when collaboration replaces the editor", async () => {
  const { container, lane } = fixture();
  const oldColumn = editor(container);
  const offset = vi.fn();
  stop = observeCommentLane(container, lane, offset);
  oldColumn.remove();
  const nextColumn = editor(container, 672);
  await flushMount();
  expect(offset).toHaveBeenLastCalledWith(-128);
  expect(observed.has(oldColumn)).toBe(false);
  expect(observed.has(nextColumn)).toBe(true);
  vi.mocked(nextColumn.getBoundingClientRect).mockReturnValue(
    new DOMRect(100, 0, 650, 800),
  );
  resize();
  flushFrames();
  expect(offset).toHaveBeenLastCalledWith(-50);
});

it("keeps measuring the untransformed lane without offset feedback", () => {
  const { container, lane } = fixture();
  editor(container);
  const content = document.createElement("div");
  lane.append(content);
  const offsets: number[] = [];
  stop = observeCommentLane(container, lane, (offset) => {
    offsets.push(offset);
    content.style.transform = `translateX(${offset}px)`;
  });
  for (let i = 0; i < 3; i++) {
    resize();
    flushFrames();
  }
  expect(offsets).toEqual([-64, -64, -64, -64]);
});

it("does not shift the lane right when the reading column already reaches it", () => {
  const { container, lane } = fixture();
  editor(container, 850);
  const offset = vi.fn();
  stop = observeCommentLane(container, lane, offset);
  expect(offset).toHaveBeenLastCalledWith(0);
});

it("cleans up pending work and listeners when the lane closes", async () => {
  const { container, lane } = fixture();
  editor(container);
  const offset = vi.fn();
  stop = observeCommentLane(container, lane, offset);
  resize();
  stop();
  expect(frames.size).toBe(0);
  expect(observed.size).toBe(0);
  offset.mockClear();
  window.dispatchEvent(new Event("resize"));
  editor(container, 680);
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushFrames();
  expect(offset).not.toHaveBeenCalled();
});

it("still handles editor mounting and window resizing without ResizeObserver", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const { container, lane } = fixture();
  const offset = vi.fn();
  stop = observeCommentLane(container, lane, offset);
  const column = editor(container);
  await flushMount();
  expect(offset).toHaveBeenLastCalledWith(-64);
  vi.mocked(column.getBoundingClientRect).mockReturnValue(
    new DOMRect(100, 0, 600, 800),
  );
  window.dispatchEvent(new Event("resize"));
  flushFrames();
  expect(offset).toHaveBeenLastCalledWith(-100);
});
