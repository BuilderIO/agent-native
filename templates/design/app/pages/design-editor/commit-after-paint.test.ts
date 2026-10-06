import { afterEach, expect, it, vi } from "vitest";

import {
  commitAfterPaint,
  flushCommitsAfterPaint,
  flushCommitsOnInput,
} from "./commit-after-paint";

afterEach(() => {
  flushCommitsAfterPaint();
  vi.useRealTimers();
});

it("lands a commit after the triggering frame, not inside it", async () => {
  vi.useFakeTimers();
  const commit = vi.fn();
  commitAfterPaint(commit);
  expect(commit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  expect(commit).toHaveBeenCalledOnce();
});

it("runs commits in the order they were made", () => {
  const order: number[] = [];
  commitAfterPaint(() => order.push(1));
  commitAfterPaint(() => order.push(2));
  flushCommitsAfterPaint();
  expect(order).toEqual([1, 2]);
});

it("still lands the commit when animation frames never fire", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  try {
    const commit = vi.fn();
    commitAfterPaint(commit);
    await vi.advanceTimersByTimeAsync(100);
    expect(commit).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("surfaces a failing commit without dropping the ones behind it", () => {
  const later = vi.fn();
  commitAfterPaint(() => {
    throw new Error("patch failed");
  });
  commitAfterPaint(later);
  expect(() => flushCommitsAfterPaint()).toThrow("patch failed");
  expect(later).toHaveBeenCalledOnce();
});

it("lands a pending commit before the next key or pointer press acts", () => {
  const target = new EventTarget();
  const stop = flushCommitsOnInput(target);
  const landed: string[] = [];

  commitAfterPaint(() => landed.push("style"));
  target.dispatchEvent(new Event("keydown"));
  expect(landed).toEqual(["style"]);

  commitAfterPaint(() => landed.push("text"));
  target.dispatchEvent(new Event("pointerdown"));
  expect(landed).toEqual(["style", "text"]);

  stop();
  commitAfterPaint(() => landed.push("after stop"));
  target.dispatchEvent(new Event("keydown"));
  expect(landed).toEqual(["style", "text"]);
  flushCommitsAfterPaint();
});
