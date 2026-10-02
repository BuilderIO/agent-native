// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { suggestionTextPresentation } from "@shared/suggestion-text";
import { describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-comments";

import {
  estimateThreadCardHeight,
  findPendingCommentOffset,
  findThreadPosition,
  getAiCommentSource,
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

  it("combines content controls with status and author filters", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source.match(/t\("comments.filter"\)/g)).toHaveLength(1);
    expect(source).toContain("DropdownMenuCheckboxItem");
    expect(source).toContain('"all" | "comments" | "suggestions"');
    expect(source).toContain('historyKind === "comments"');
    expect(source).toContain('historyKind === "suggestions"');
    expect(source).toContain('t("comments.typeFilter")');
    expect(source).not.toContain("aria-pressed={historyKind === kind}");
    expect(source).toContain('t("comments.statusFilter")');
    expect(source).toContain('t("comments.authorFilter")');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain('["open", "resolved", "all"] as const');
    expect(source).toContain("historySuggestions.map((suggestion)");
    expect(source).toContain("renderSuggestionCard(thread.suggestion)");
    expect(source).toContain(
      "renderSuggestionText(previousText, previousPresentation)",
    );
    expect(source).toContain('t("comments.suggestionWith")');
    expect(source).toContain(
      "<SuggestionText content={content} context={context} />",
    );
    const presentation = suggestionTextPresentation("**Echo**  ");
    expect(presentation[presentation.length - 1]).toEqual({
      type: "text",
      value: "  ",
    });
    // The panel is one flat feed rather than a stack of summary cards.
    expect(source).toContain("data-comments-feed");
    expect(source).not.toContain("HistoryThreadView");
  });

  it("keeps card height estimates based on the thread reply count", () => {
    const thread = {
      comments: [{ id: "root" }, { id: "reply" }],
    } as CommentThread;

    expect(estimateThreadCardHeight(thread)).toBe(124);
  });
});
