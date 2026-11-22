// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-comments";

import {
  estimateThreadCardHeight,
  findPendingCommentPosition,
  findThreadPosition,
  getAiCommentSource,
  highlightedQuote,
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

// oracle-change: removed CommentsSidebar.tsx/DocumentEditor.tsx source-text greps; layout and card height are still asserted below, the suggestion text trailing-space case lives in shared/suggestion-text.test.ts, and rendered panel behaviour in the CommentsSidebar.*.test.tsx files

describe("comments sidebar layout", () => {
  it("lays out mixed suggestion and comment identities in one collision flow", () => {
    const items = layoutCommentThreads(
      [
        { threadId: "suggestion", comments: [] },
        { threadId: "comment", comments: [] },
      ],
      new Map([
        ["comment", { documentTop: 100, layoutTop: 100 }],
        ["suggestion", { documentTop: 140, layoutTop: 140 }],
      ]),
      new Map([
        ["comment", 80],
        ["suggestion", 120],
      ]),
      "suggestion",
    );
    expect(items.map((item) => item.thread.threadId)).toEqual([
      "comment",
      "suggestion",
    ]);
    expect(items.map((item) => item.top)).toEqual([48, 140]);
    expect(items.map((item) => item.marginTop)).toEqual([48, 12]);
  });

  it("uses the editor suggestion marker instead of the sidebar card as its anchor", () => {
    document.body.innerHTML =
      '<div id="scroll"><div data-document-scroll-content><div class="ProseMirror"><span data-suggestion-id="suggestion"></span></div></div><div id="rail"><div data-suggestion-id="suggestion"></div></div></div>';
    const scroll = document.getElementById("scroll") as HTMLElement;
    const content = scroll.querySelector(
      "[data-document-scroll-content]",
    ) as HTMLElement;
    const rail = document.getElementById("rail") as HTMLElement;
    const marker = scroll.querySelector(
      ".ProseMirror [data-suggestion-id]",
    ) as HTMLElement;
    content.getBoundingClientRect = () => rect(40) as DOMRect;
    rail.getBoundingClientRect = () => rect(80) as DOMRect;
    marker.getBoundingClientRect = () => rect(156) as DOMRect;
    expect(
      findThreadPosition(
        "suggestion",
        null,
        scroll,
        rail,
        "data-suggestion-id",
      ),
    ).toEqual({ documentTop: 116, layoutTop: 76 });
    marker.remove();
    expect(
      findThreadPosition(
        "suggestion",
        null,
        scroll,
        rail,
        "data-suggestion-id",
      ),
    ).toBeNull();
  });
  it("attributes only comments submitted through AI surfaces", () => {
    expect(getAiCommentSource("mcp")).toBe("mcp");
    expect(getAiCommentSource("agent")).toBe("agent");
    expect(getAiCommentSource("frontend")).toBeNull();
    expect(getAiCommentSource("automation")).toBeNull();
    expect(getAiCommentSource(null)).toBeNull();
  });

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

  it("measures a highlight from its start, and flags the rest as partial", () => {
    document.body.innerHTML =
      '<div id="scroll"><div data-document-scroll-content><span id="hidden" data-comment-thread="thread-1">old</span><span id="shown" data-comment-thread="thread-1">new</span></div></div><div id="rail"></div>';
    const scroll = document.getElementById("scroll") as HTMLElement;
    const content = scroll.querySelector(
      "[data-document-scroll-content]",
    ) as HTMLElement;
    const rail = document.getElementById("rail") as HTMLElement;
    const hidden = document.getElementById("hidden") as HTMLElement;
    const shown = document.getElementById("shown") as HTMLElement;
    const nowhere = () => [] as unknown as DOMRectList;
    content.getBoundingClientRect = () => rect(40) as DOMRect;
    rail.getBoundingClientRect = () => rect(80) as DOMRect;
    hidden.getBoundingClientRect = () => rect(0) as DOMRect;
    hidden.getClientRects = nowhere;
    shown.getBoundingClientRect = () => rect(156) as DOMRect;

    expect(findThreadPosition("thread-1", null, scroll, rail)).toEqual({
      documentTop: 116,
      layoutTop: 76,
      partial: true,
    });
    hidden.getClientRects = () => [rect(0)] as unknown as DOMRectList;
    expect(findThreadPosition("thread-1", null, scroll, rail)).toEqual({
      documentTop: -40,
      layoutTop: -80,
    });
    hidden.getClientRects = nowhere;
    // While an accepted edit settles, all of its text can be hidden at once.
    shown.getClientRects = nowhere;
    expect(findThreadPosition("thread-1", null, scroll, rail)).toBe(
      "unrendered",
    );
  });

  it("reads a quote across blocks with a space where its highlight crosses", () => {
    document.body.innerHTML =
      '<div class="ProseMirror"><p>Alpha <span data-comment-thread="t">ends <strong>here.</strong></span></p><ul><li><p><span data-comment-thread="t">Bravo</span> starts</p></li></ul></div>';
    const marked = document.querySelectorAll('[data-comment-thread="t"]');

    expect(highlightedQuote(marked, "ends here.Bravo")).toBe(
      "ends here. Bravo",
    );
    // One block reads as stored, and text edited since no longer matches.
    expect(highlightedQuote([marked[0]!], "ends here.")).toBeNull();
    expect(highlightedQuote(marked, "ends there.Bravo")).toBeNull();
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

    expect(findPendingCommentPosition(scroll, scroll)).toEqual({
      documentTop: 45,
      layoutTop: 45,
    });
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

  it("keeps a selected thread aligned when earlier cards do not fit above it", () => {
    const threads = ["first", "second", "selected"].map(
      (threadId) =>
        ({
          threadId,
          comments: [{ id: `${threadId}-comment` }],
        }) as CommentThread,
    );
    const positions = new Map([
      ["first", { documentTop: 10, layoutTop: 10 }],
      ["second", { documentTop: 25, layoutTop: 25 }],
      ["selected", { documentTop: 40, layoutTop: 40 }],
    ]);
    const heights = new Map(threads.map((thread) => [thread.threadId, 80]));

    const items = layoutCommentThreads(threads, positions, heights, "selected");

    expect(items.map((item) => item.top)).toEqual([-144, -52, 40]);
    expect(items[2].top).toBe(positions.get("selected")?.layoutTop);
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

  it("separates layout-unanchored threads from the anchored rail section", () => {
    const anchored = {
      threadId: "anchored",
      comments: [{ id: "anchored-comment" }],
    } as CommentThread;
    const unanchored = {
      threadId: "unanchored",
      comments: [{ id: "unanchored-comment" }],
    } as CommentThread;
    const positions = new Map([
      ["anchored", { documentTop: 100, layoutTop: 100 }],
      ["unanchored", { documentTop: 200, layoutTop: null }],
    ]);

    const items = layoutCommentThreads(
      [anchored, unanchored],
      positions,
      new Map([
        ["anchored", 80],
        ["unanchored", 80],
      ]),
      null,
    );

    expect(items.map((item) => item.top)).toEqual([100, 212]);
    expect(items[1].marginTop).toBe(32);
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

  it("keeps multiline comment highlights padded as one forgiving target", () => {
    const styles = readFileSync("app/global.css", { encoding: "utf8" });
    const highlightStyles = styles.slice(
      styles.indexOf(".content-editor .comment-highlight"),
      styles.indexOf("/* @mention tokens inside comment bodies */"),
    );

    expect(highlightStyles).toContain("padding-block: 0.2em");
    expect(highlightStyles).toContain("padding-inline: 0.15em");
    expect(highlightStyles).toContain("margin-inline: -0.15em");
    expect(highlightStyles).toContain("box-decoration-break: clone");
    expect(highlightStyles).toContain("content-box");
    expect(highlightStyles).not.toContain("border-bottom: 1px");
  });

  it("smoothly strengthens ordinary comment highlights without moving them", () => {
    const styles = readFileSync("app/global.css", { encoding: "utf8" });
    const highlightStyles = styles.slice(
      styles.indexOf(".content-editor .comment-highlight"),
      styles.indexOf("/* Pending suggested edits"),
    );

    expect(highlightStyles).toContain(
      "background-color: var(--comment-highlight-fill)",
    );
    expect(highlightStyles).toContain(
      "transition: background-color 160ms var(--ease-out-strong)",
    );
    expect(highlightStyles).toMatch(
      /\.comment-highlight:hover,\s*\.content-editor \.comment-highlight\.comment-highlight--hovered\s*\{[^}]*\/ 0\.28\)/,
    );
    expect(highlightStyles).toMatch(
      /\.comment-highlight\.comment-highlight--active\s*\{[^}]*\/ 0\.38\)/,
    );
    expect(highlightStyles).toMatch(
      /\.comment-highlight\.comment-highlight--pending\s*\{[^}]*hsl\(210 100% 52% \/ 0\.2\)[^}]*hsl\(210 100% 52% \/ 0\.55\)[^}]*cursor: default/,
    );
    expect(highlightStyles.indexOf(".comment-highlight:hover")).toBeLessThan(
      highlightStyles.indexOf(".comment-highlight.comment-highlight--active"),
    );
    expect(
      highlightStyles.indexOf(".comment-highlight.comment-highlight--active"),
    ).toBeLessThan(
      highlightStyles.indexOf(".comment-highlight.comment-highlight--pending"),
    );
    expect(highlightStyles).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(highlightStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.comment-highlight\s*\{[^}]*transition: none/,
    );
  });

  it("keeps card height estimates based on the thread reply count", () => {
    const thread = {
      comments: [{ id: "root" }, { id: "reply" }],
    } as CommentThread;

    expect(estimateThreadCardHeight(thread)).toBe(124);
  });
});
