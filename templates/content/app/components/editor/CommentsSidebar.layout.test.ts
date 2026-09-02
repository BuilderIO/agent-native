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

  it("does not couple selection or layout state to ordinary scrolling", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });
    const globalStyles = readFileSync("app/global.css", { encoding: "utf8" });

    expect(source).not.toContain('container.addEventListener("scroll"');
    expect(source).not.toContain("scrollIntoView");
    expect(source).not.toContain("data-comment-connector");
    expect(source).toContain("data-unanchored-comments");
    expect(source).not.toContain("CommentConnector");
    expect(globalStyles).not.toContain(".comment-highlight::after");
  });

  it("keeps comment actions named and available to keyboard focus", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain('aria-label={t("comments.askAi")}');
    expect(source).toContain('aria-label={t("comments.resolve")}');
    expect(source).toContain('aria-label={t("comments.submit")}');
    expect(source).toContain('aria-label={t("comments.reopen")}');
    expect(source).toContain("group-focus-within/thread:opacity-100");
    expect(source).not.toContain("hidden group-hover/thread:flex");
    expect(source).toContain('presentation === "history"');
    expect(source).toContain("data-comments-history");
    expect(source).not.toContain("showResolved");
    expect(source).not.toContain('t("comments.resolved", {');
  });

  it("uses the same eased emphasis for active and hovered comment cards", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain(
      "transition-transform duration-[260ms] ease-[var(--ease-drawer)]",
    );
    expect(source).toContain('? "-translate-x-2 shadow-lg"');
    expect(source).toContain(': "hover:-translate-x-2 hover:shadow-lg"');
  });

  it("keeps multiline comment highlights padded as one forgiving target", () => {
    const styles = readFileSync("app/global.css", { encoding: "utf8" });
    const highlightStyles = styles.slice(
      styles.indexOf(".notion-editor .comment-highlight"),
      styles.indexOf("/* @mention tokens inside comment bodies */"),
    );

    expect(highlightStyles).toContain("padding-block: 0.2em");
    expect(highlightStyles).toContain("padding-inline: 0.15em");
    expect(highlightStyles).toContain("margin-inline: -0.15em");
    expect(highlightStyles).toContain("box-decoration-break: clone");
    expect(highlightStyles).toContain("content-box");
    expect(highlightStyles).not.toContain("border-bottom: 1px");
  });

  it("opens the selected inline thread for reply and closes it on deselection", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("selectedThreadIsOpen");
    expect(source).toContain(
      'presentation === "inline" && canComment && selectedThreadIsOpen',
    );
    expect(source).toContain("setReplyingThreadId(nextReplyingThreadId)");
    expect(source).toContain("setReplyingThreadId(thread.threadId)");
    expect(source).not.toContain("current === thread.threadId ? null");
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?setReplyingThreadId\(nextReplyingThreadId\)/,
    );
  });

  it("combines comment history filters into one persistent checkbox menu", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source.match(/<DropdownMenu>/g)).toHaveLength(1);
    expect(source).toContain("DropdownMenuCheckboxItem");
    expect(source).toContain('t("comments.typeFilter")');
    expect(source).toContain('t("comments.statusFilter")');
    expect(source).toContain('t("comments.authorFilter")');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain(
      'className="w-full min-w-0 overflow-hidden rounded-lg bg-popover',
    );
  });

  it("captures inline comment activation at the document state boundary", () => {
    const source = readFileSync("app/components/editor/DocumentEditor.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain('target?.closest("[data-comment-thread]")');
    expect(source).toContain("onPointerOverCapture");
    expect(source).toContain("onPointerOutCapture");
    expect(source).toContain("setHoveredThreadId(threadId)");
    expect(source).toContain("activateCommentThread(threadId)");
    expect(source).toContain("data-comments-flow-lane");
    expect(source).toContain("commentLaneRef");
    expect(source).toContain('querySelector(".notion-editor")');
    expect(source).toContain("translate-x-8");
    expect(source).toContain("data-comments-anchored-popover");
    expect(source).toContain("useElementMinWidth(documentLayoutRef, 960)");
    expect(source).toContain('window.addEventListener("resize", update)');
    expect(source).toContain(
      'window.visualViewport?.addEventListener("resize", update)',
    );
    expect(source).toContain("observer?.observe(element)");
    expect(source).not.toContain("CONTENT_COMMENTS_UI_CLEANUP_FLAG");
  });

  it("recomputes anchors when comment indicators are restored", () => {
    const source = readFileSync("app/components/editor/VisualEditor.tsx", {
      encoding: "utf8",
    });

    expect(source).toMatch(
      /scheduleApply\(false\);[\s\S]*?showCommentIndicators/,
    );
  });

  it("keeps the pending composer in normal flow in the anchored card", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("alignToAnchors");
    expect(source).toContain(
      '"relative mx-2 mt-3 rounded-lg bg-popover p-3 shadow-md ring-1 ring-border/50"',
    );
    expect(source).toContain(": undefined");
  });

  it("keeps comment drafts open until their mutation succeeds", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("createComment.isPending");
    expect(source).toContain("onSuccess: (result) => {");
    expect(source).toContain("onError: (error) => {");
    expect(source).toContain('toast.error(t("empty.genericError")');
    expect(source).toMatch(
      /createComment\.mutate\([\s\S]*?onSuccess: \(result\) => \{[\s\S]*?setPendingText\(""\)[\s\S]*?onPendingDone\?\.\(result\.threadId\)/,
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
    expect(source).toContain(
      "relative flow-root w-full min-w-0 shrink-0 pb-16",
    );
    expect(source).not.toContain("w-80 shrink-0 overflow-auto");
    expect(source).not.toContain("overflow-auto relative");
  });
});
