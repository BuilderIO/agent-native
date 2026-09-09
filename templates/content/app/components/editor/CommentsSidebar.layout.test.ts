// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { suggestionTextPresentation } from "@shared/suggestion-text";
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
  it("keeps stale suggestions discoverable in the pending filter", () => {
    const source = readFileSync(
      "app/components/editor/CommentsSidebar.tsx",
      "utf8",
    );
    expect(source).toContain(
      'suggestion.status === "pending" || suggestion.status === "stale"',
    );
    expect(source).toMatch(/historyStatus === "pending"\) &&\s+!unresolved/);
  });
  it("restricts link-driven selection and history reveal to a fresh explicit URL intent", () => {
    const source = readFileSync(
      "app/components/editor/DocumentEditor.tsx",
      "utf8",
    );
    const start = source.indexOf(
      'const suggestionId = new URLSearchParams(location.search).get("suggestion")',
    );
    const end = source.indexOf("const handleKeyDown", start);
    const linkEffect = source.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(linkEffect).toMatch(/if \(!suggestionId\) \{[\s\S]*?return;/);
    expect(linkEffect).toContain("appliedSuggestionLinkRef.current === key");
    expect(
      linkEffect.indexOf("appliedSuggestionLinkRef.current = key"),
    ).toBeLessThan(
      linkEffect.indexOf("setSelectedSuggestionId(suggestion.id)"),
    );
    expect(linkEffect).toContain("setCommentsBrowseOpen(true)");
    expect(linkEffect).toContain(
      "replyDrafts.setOpenReply(suggestion.threadId, suggestion.id, false)",
    );
    expect(linkEffect).toContain("setFocusSuggestionId(suggestion.id)");
    expect(source.match(/setFocusSuggestionId\(suggestion.id\)/g)).toHaveLength(
      1,
    );
  });
  it("reveals a failed decision even when history was filtered to pending", () => {
    const source = readFileSync(
      "app/components/editor/CommentsSidebar.tsx",
      "utf8",
    );
    expect(source).toContain("replyDrafts.revealHistory(");
    expect(source).toContain(
      "if (key) setHistoryFilters(defaultHistoryFilters)",
    );
    expect(source).toContain("Number(right.id === activeConflictId)");
  });
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
    expect(source.match(/scrollIntoView/g)).toHaveLength(1);
    expect(source).toMatch(
      /if \(!focusRequested\) return;[\s\S]*?requestAnimationFrame[\s\S]*?target\.scrollIntoView/,
    );
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

  it("uses the same eased emphasis for active, hovered, and focused cards", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain(
      "transition-[background-color,transform] duration-[260ms] ease-[var(--ease-drawer)]",
    );
    expect(source).not.toContain("allowEmphasisMotion");
    expect(source).toContain(
      "hover:-translate-x-2 hover:bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))]",
    );
    expect(source).toContain(
      "focus-within:-translate-x-2 focus-within:bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))]",
    );
    expect(source).toContain("ease-[var(--ease-drawer)]");
    expect(source).toContain("motion-reduce:hover:translate-x-0");
    expect(source).not.toContain("bg-accent/60");
    expect(source).toContain(
      '? "-translate-x-2 bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))] shadow-lg"',
    );
    expect(source).toContain(
      ': "bg-popover hover:-translate-x-2 hover:bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))] hover:shadow-lg focus-within:-translate-x-2 focus-within:bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))] focus-within:shadow-lg"',
    );
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

  it("smoothly strengthens ordinary comment highlights without moving them", () => {
    const styles = readFileSync("app/global.css", { encoding: "utf8" });
    const highlightStyles = styles.slice(
      styles.indexOf(".notion-editor .comment-highlight"),
      styles.indexOf("/* Pending suggested edits"),
    );

    expect(highlightStyles).toContain(
      "background-color: var(--comment-highlight-fill)",
    );
    expect(highlightStyles).toContain(
      "transition: background-color 160ms var(--ease-out-strong)",
    );
    expect(highlightStyles).toMatch(
      /\.comment-highlight:hover,\s*\.notion-editor \.comment-highlight\.comment-highlight--hovered\s*\{[^}]*\/ 0\.28\)/,
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

  it("opens the selected inline thread for reply and closes it on deselection", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("selectedThreadIsOpen");
    expect(source).toMatch(
      /presentation === "inline" &&\s+canComment &&\s+selectedThreadIsOpen/,
    );
    expect(source).toContain("setReplyingThreadId(selectedThreadId)");
    expect(source).toContain("setReplyingThreadId(thread.threadId)");
    expect(source).not.toContain("current === thread.threadId ? null");
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?setReplyingThreadId\(selectedThreadId\)/,
    );
  });

  it("combines content controls with status and author filters", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source.match(/<DropdownMenu>/g)).toHaveLength(1);
    expect(source).toContain("DropdownMenuCheckboxItem");
    expect(source).toContain('"all" | "comments" | "suggestions"');
    expect(source).toContain('historyKind === "comments"');
    expect(source).toContain('historyKind === "suggestions"');
    expect(source).toContain('t("comments.typeFilter")');
    expect(source).not.toContain("aria-pressed={historyKind === kind}");
    expect(source).toContain('t("comments.statusFilter")');
    expect(source).toContain('t("comments.authorFilter")');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain(
      '"pending",\n                    "accepted",\n                    "rejected"',
    );
    expect(source).toContain("historySuggestions.map((suggestion)");
    expect(source).toContain(
      "renderSuggestionCard(thread.suggestion, marginTop)",
    );
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
    expect(source).toContain(
      'className="w-full min-w-0 overflow-hidden rounded-lg bg-popover',
    );
  });

  it("labels pending suggestions whose page anchor cannot be resolved", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain('suggestion.status === "pending"');
    expect(source).toContain("!anchoredSuggestionIds?.includes(suggestion.id)");
    expect(source).toContain('t("comments.unanchored")');
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
    expect(source).toContain(
      "observeCommentLane(container, lane, setCommentLaneOffset)",
    );
    expect(source).toContain("translate-x-4");
    expect(source).toContain(
      'scrollContainer.addEventListener("scroll", update, { passive: true })',
    );
    expect(source).toContain(
      "const containerRect = scrollContent.getBoundingClientRect()",
    );
    expect(source).toContain(
      "const mutationObserver = new MutationObserver(update)",
    );
    expect(source).toContain('className="pointer-events-none absolute z-30"');
    expect(source).toContain("data-comments-anchored-popover");
    expect(source).toContain("useElementMinWidth(documentLayoutRef, 800)");
    expect(source).toContain(
      'utilityPanel === "comments" &&\n      !hasUtilityRailSpace &&\n      !!selectedSuggestionId',
    );
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

    const submit = source.slice(
      source.indexOf("const handlePendingSubmit ="),
      source.indexOf("const handlePendingCancel ="),
    );
    const failure = submit.slice(submit.indexOf("catch (error)"));

    expect(submit).toContain("pendingSubmitting) return;");
    expect(submit).toContain("const id = pendingComment.id;");
    expect(submit).toMatch(
      /onPendingChange\(id, \(\) => \(\{ submitting: true \}\)\)[\s\S]*?const result = await createComment\.mutateAsync\([\s\S]*?onPendingDone\(id, result\.threadId\);[\s\S]*?catch \(error\)/,
    );
    expect(failure).toContain(
      "onPendingChange(id, () => ({ submitting: false }));",
    );
    expect(failure).toContain('toast.error(t("empty.genericError")');
    expect(failure).not.toMatch(
      /onPendingDone|setPendingComment|text:|mentions:/,
    );
  });

  it("keeps card height estimates based on the thread reply count", () => {
    const thread = {
      comments: [{ id: "root" }, { id: "reply" }],
    } as CommentThread;

    expect(estimateThreadCardHeight(thread)).toBe(124);
  });

  it("keeps suggestion replies in history even when their highlight is unavailable", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });
    expect(source).toContain(
      'if (presentation !== "history") onActivateSuggestion?.(suggestion.id)',
    );
  });

  it("limits a narrow popover to its selected discussion", () => {
    const source = readFileSync("app/components/editor/CommentsSidebar.tsx", {
      encoding: "utf8",
    });
    expect(source).toContain(
      "(alignToAnchors || suggestion.id === activeSuggestionId)",
    );
    expect(source).not.toContain("!activeSuggestionId ||");
  });

  it("keeps stale decision feedback in the shared discussion shell", () => {
    const source = readFileSync(
      "app/components/editor/CommentsSidebar.tsx",
      "utf8",
    );
    expect(source).toContain('suggestion.status === "stale"');
    expect(source).toContain('t("editor.toolbar.conflict")');
    expect(source).toContain('role="alert"');
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
