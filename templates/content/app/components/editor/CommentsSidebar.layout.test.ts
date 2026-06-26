// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CommentThread } from "@/hooks/use-comments";

import {
  estimateThreadCardHeight,
  findPendingCommentOffset,
  findThreadOffset,
  shouldClearSelectedThreadOnScroll,
} from "./CommentsSidebar";

function rect(top: number) {
  return {
    top,
    bottom: top + 20,
    left: 0,
    right: 100,
    width: 100,
    height: 20,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

describe("comments sidebar layout", () => {
  it("positions thread cards from the visible highlight rect, not scrollTop", () => {
    document.body.innerHTML =
      '<div id="scroll"><span data-comment-thread="thread-1"></span></div>';
    const scroll = document.getElementById("scroll") as HTMLElement;
    const highlight = scroll.querySelector(
      "[data-comment-thread]",
    ) as HTMLElement;

    Object.defineProperty(scroll, "scrollTop", { value: 240 });
    scroll.getBoundingClientRect = () => rect(100) as DOMRect;
    highlight.getBoundingClientRect = () => rect(156) as DOMRect;

    expect(findThreadOffset("thread-1", null, scroll)).toBe(56);
  });

  it("can position thread cards relative to the sidebar rail", () => {
    document.body.innerHTML =
      '<div id="rail"></div><div id="scroll"><span data-comment-thread="thread-1"></span></div>';
    const rail = document.getElementById("rail") as HTMLElement;
    const scroll = document.getElementById("scroll") as HTMLElement;
    const highlight = scroll.querySelector(
      "[data-comment-thread]",
    ) as HTMLElement;

    rail.getBoundingClientRect = () => rect(48) as DOMRect;
    scroll.getBoundingClientRect = () => rect(100) as DOMRect;
    highlight.getBoundingClientRect = () => rect(156) as DOMRect;

    expect(findThreadOffset("thread-1", null, scroll, rail)).toBe(108);
  });

  it("positions pending comments from the pending highlight rect", () => {
    document.body.innerHTML =
      '<div id="scroll"><span class="comment-highlight--pending"></span></div>';
    const scroll = document.getElementById("scroll") as HTMLElement;
    const pending = scroll.querySelector(
      ".comment-highlight--pending",
    ) as HTMLElement;

    Object.defineProperty(scroll, "scrollTop", { value: 300 });
    scroll.getBoundingClientRect = () => rect(80) as DOMRect;
    pending.getBoundingClientRect = () => rect(125) as DOMRect;

    expect(findPendingCommentOffset(scroll)).toBe(45);
  });

  it("clears selected threads once their anchor scrolls out of view", () => {
    expect(shouldClearSelectedThreadOnScroll(null, 500)).toBe(true);
    expect(shouldClearSelectedThreadOnScroll(-41, 500)).toBe(true);
    expect(shouldClearSelectedThreadOnScroll(541, 500)).toBe(true);
    expect(shouldClearSelectedThreadOnScroll(120, 500)).toBe(false);
  });

  it("checks selected-thread visibility with viewport-relative offsets", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("offsets.get(selectedThreadId) ?? null");
    expect(source).not.toContain(
      "offsets.get(selectedThreadId)! - container.scrollTop",
    );
  });

  it("keeps card height estimates based on the thread reply count", () => {
    const thread = {
      comments: [{ id: "root" }, { id: "reply" }],
    } as CommentThread;

    expect(estimateThreadCardHeight(thread)).toBe(124);
  });

  it("does not give the desktop comment rail its own scroll container", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("data-comments-sidebar");
    expect(source).not.toContain("w-80 shrink-0 overflow-auto");
    expect(source).not.toContain("overflow-auto relative");
  });
});
