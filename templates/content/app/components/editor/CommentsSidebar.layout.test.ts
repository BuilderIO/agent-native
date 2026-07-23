// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-comments";

import {
  estimateThreadCardHeight,
  findPendingCommentOffset,
  findThreadPosition,
  layoutCommentThreads,
  scrollToCommentAnchor,
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
  it("tracks both document and desktop-rail positions for a highlight", () => {
    document.body.innerHTML =
      '<div id="scroll"><div data-document-scroll-content><span data-comment-thread="thread-1"></span></div></div><div id="rail"></div>';
    const scroll = document.getElementById("scroll") as HTMLElement;
    const content = scroll.querySelector(
      "[data-document-scroll-content]",
    ) as HTMLElement;
    const rail = document.getElementById("rail") as HTMLElement;
    const highlight = scroll.querySelector(
      "[data-comment-thread]",
    ) as HTMLElement;

    content.getBoundingClientRect = () => rect(40) as DOMRect;
    rail.getBoundingClientRect = () => rect(80) as DOMRect;
    highlight.getBoundingClientRect = () => rect(156) as DOMRect;

    expect(findThreadPosition("thread-1", null, scroll, rail)).toEqual({
      documentTop: 116,
      layoutTop: 76,
    });
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

  it("gives the selected thread first claim near its anchor without overlap", () => {
    const first = {
      threadId: "first",
      comments: [{ id: "first-comment" }],
    } as CommentThread;
    const selected = {
      threadId: "selected",
      comments: [{ id: "selected-comment" }],
    } as CommentThread;
    const third = {
      threadId: "third",
      comments: [{ id: "third-comment" }],
    } as CommentThread;
    const positions = new Map([
      ["first", { documentTop: 100, layoutTop: 100 }],
      ["selected", { documentTop: 120, layoutTop: 120 }],
      ["third", { documentTop: 140, layoutTop: 140 }],
    ]);
    const heights = new Map([
      ["first", 80],
      ["selected", 80],
      ["third", 80],
    ]);

    const items = layoutCommentThreads(
      [first, selected, third],
      positions,
      heights,
      "selected",
    );

    expect(items.map((item) => item.top)).toEqual([28, 120, 212]);
    expect(items[0].top + 80).toBeLessThanOrEqual(items[1].top - 12);
    expect(items[1].top + 80).toBeLessThanOrEqual(items[2].top - 12);
  });

  it("keeps narrow layouts sequential and puts missing anchors last", () => {
    const anchored = {
      threadId: "anchored",
      comments: [{ id: "anchored-comment" }],
    } as CommentThread;
    const orphaned = {
      threadId: "orphaned",
      comments: [{ id: "orphaned-comment" }],
    } as CommentThread;
    const positions = new Map([
      ["anchored", { documentTop: 400, layoutTop: null }],
    ]);

    const items = layoutCommentThreads(
      [orphaned, anchored],
      positions,
      new Map(),
      null,
    );

    expect(items.map((item) => item.thread.threadId)).toEqual([
      "anchored",
      "orphaned",
    ]);
    expect(items[0].top).toBe(0);
    expect(items[1].top).toBe(112);
    expect(items[1].isOrphaned).toBe(true);
  });

  it("bounds explicit anchor navigation inside the document scroller", () => {
    const scroll = document.createElement("div");
    Object.defineProperty(scroll, "scrollHeight", { value: 1000 });
    Object.defineProperty(scroll, "clientHeight", { value: 400 });
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo;

    expect(scrollToCommentAnchor(scroll, 900)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: "smooth" });
  });

  it("does not couple selection or layout state to ordinary scrolling", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).not.toContain('container.addEventListener("scroll"');
    expect(source).not.toContain("scrollIntoView");
    expect(source).toContain("data-comment-connector");
    expect(source).toContain("data-unanchored-comments");
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
