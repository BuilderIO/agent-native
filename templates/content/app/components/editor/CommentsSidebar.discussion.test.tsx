// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import {
  richEditor,
  richEditorValue,
  setRichEditorValue,
} from "./comment-composer-test-utils";
import { CommentDraftProvider } from "./comment-drafts";
import {
  CommentsSidebar,
  preserveCommentReplyEscape,
  useCommentReplyDrafts,
} from "./CommentsSidebar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ create: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({
    mutateAsync: actions.create,
    isPending: false,
    reconcileAmbiguous: actions.reconcile,
  }),
  useEditComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactToComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutateAsync: vi.fn() }),
  useResolveComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  chatModelSelectionStorageKey: (scope: string) => `model:${scope}`,
  useChatModels: () => ({
    configuredModels: [],
    selectionReady: false,
    selectedModel: "",
    selectedEngine: "",
    selectedEffort: undefined,
    unavailableSelection: null,
    onModelChange: vi.fn(),
  }),
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
  useT: () => (key: string, options?: { filter?: string }) =>
    options?.filter === undefined ? key : `${key}:${options.filter}`,
}));
vi.mock("@agent-native/toolkit/app/review", () => ({
  InlineMarkdown: ({ content }: { content: string }) => content,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const USER = "reviewer@example.test";
const SORT_KEY = `content-discussion-sort:${JSON.stringify(USER)}`;
const FILTERS_KEY = `content-discussion-filters:${JSON.stringify([
  USER,
  "fixture",
])}`;

function thread(id: string, quotedText: string | null): CommentThread {
  return {
    threadId: id,
    quotedText,
    prefix: null,
    suffix: null,
    startOffset: quotedText ? 0 : null,
    resolved: false,
    comments: [
      {
        id: `${id}-root`,
        document_id: "fixture",
        thread_id: id,
        parent_id: null,
        content: `Comment ${id}`,
        quoted_text: quotedText,
        anchor_prefix: null,
        anchor_suffix: null,
        anchor_start_offset: quotedText ? 0 : null,
        mentions: [],
        author_email: USER,
        author_name: "Reviewer",
        resolved: 0,
        created_at: "2026-10-21T12:00:00Z",
        updated_at: "2026-10-21T12:00:00Z",
        notion_comment_id: null,
        submission_source: "frontend",
      },
    ],
  };
}

// One comment on the whole page and one on text.
const fixtureThreads = [
  thread("page-1", null),
  thread("text-1", "Quoted line"),
];
let threads = fixtureThreads;

let replies: ReturnType<typeof useCommentReplyDrafts>;
let highlights: {
  visible: boolean;
  onChange?: (visible: boolean) => void;
} = { visible: true };
// The page the panel measures highlights in. Empty, it measures nothing.
const page: { current: HTMLDivElement | null } = { current: null };
// Hears the panel let go of the selected thread.
let onSelectedThreadChange: ((threadId: string | null) => void) | undefined;

function Owner({
  presentation,
  selected = null,
}: {
  presentation: "inline" | "history";
  selected?: string | null;
}) {
  replies = useCommentReplyDrafts("fixture", USER);
  return (
    <CommentsSidebar
      replyDrafts={replies}
      documentId="fixture"
      threads={threads}
      selectedThreadId={selected}
      onSelectedThreadChange={onSelectedThreadChange}
      currentUserEmail={USER}
      canComment
      canResolve
      alignToAnchors={false}
      forceVisible
      presentation={presentation}
      highlightsVisible={highlights.visible}
      onHighlightsVisibleChange={highlights.onChange}
      scrollContainerRef={page}
    />
  );
}

describe("the Discussion panel", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    actions.create.mockReset();
    actions.reconcile.mockReset();
    highlights = { visible: true };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    page.current?.remove();
    page.current = null;
    threads = fixtureThreads;
    onSelectedThreadChange = undefined;
    queryClient.clear();
    window.localStorage.clear();
  });

  function render(
    presentation: "inline" | "history" = "history",
    selected: string | null = null,
  ) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CommentDraftProvider documentId="fixture" currentUserEmail={USER}>
              <Owner presentation={presentation} selected={selected} />
            </CommentDraftProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }

  function remount() {
    act(() => root.unmount());
    root = createRoot(container);
    render();
  }

  const card = (id: string) =>
    container.querySelector(`[data-thread-card="${id}"]`);
  const button = (selector: string) =>
    document.querySelector<HTMLButtonElement>(selector)!;
  const click = async (selector: string) => {
    await act(async () => button(selector).click());
  };
  const filterOption = (group: string, option: string) =>
    `[data-discussion-filter-group="${group}"] [data-discussion-filter-option="${option}"]`;
  const storedFilters = () => window.localStorage.getItem(FILTERS_KEY);
  const nextFrame = () =>
    act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  const unavailable = (id: string) =>
    container.querySelector(
      `[data-thread-card="${id}"] [data-comment-anchor-unavailable]`,
    );
  // A page whose only paragraph is a quote across formatting, so its text alone
  // can't place it: only its highlight can.
  function pageWithFormattedQuote(marked: boolean) {
    page.current = document.createElement("div");
    page.current.innerHTML = `<div class="ProseMirror"><p>${formattedQuote(marked)}</p></div>`;
    document.body.append(page.current);
    return page.current.querySelector("p")!;
  }
  const formattedQuote = (marked: boolean) =>
    marked
      ? '<span data-comment-thread="text-1"><strong>Quoted</strong> line</span>'
      : "<strong>Quoted</strong> line";

  it("leaves a comment on the whole page out of the margin rail but lists it in the panel", () => {
    render("inline");
    expect(card("page-1")).toBeNull();
    expect(card("text-1")).not.toBeNull();

    render("inline", "page-1");
    expect(card("page-1")).toBeNull();

    render("history");
    expect(card("page-1")).not.toBeNull();
    expect(card("text-1")).not.toBeNull();
  });

  it("remembers the sort and a Page's filters, and forgets the filters once they're back to default", async () => {
    render();
    await click("[data-discussion-sort-trigger]");
    await click('[data-discussion-sort="activity"]');
    expect(window.localStorage.getItem(SORT_KEY)).toBe('"activity"');

    await click("[data-discussion-filter-trigger]");
    await click(filterOption("target", "page"));
    expect(JSON.parse(storedFilters()!)).toEqual({
      kind: "all",
      author: null,
      tab: null,
      target: "page",
      mentionsMe: false,
    });
    expect(card("page-1")).not.toBeNull();
    expect(card("text-1")).toBeNull();

    remount();
    expect(replies.historyFilters).toMatchObject({
      sort: "activity",
      target: "page",
    });
    expect(card("text-1")).toBeNull();

    await click("[data-discussion-filter-trigger]");
    await click(filterOption("target", "all"));
    expect(storedFilters()).toBeNull();
    expect(card("text-1")).not.toBeNull();
    expect(window.localStorage.getItem(SORT_KEY)).toBe('"activity"');
  });

  it("keeps the switch for comment highlights in the toolbar", async () => {
    render();
    expect(
      container.querySelector("[data-discussion-highlights-toggle]"),
    ).toBeNull();

    const onChange = vi.fn();
    highlights = { visible: true, onChange };
    render();
    const toggle = () => button("[data-discussion-highlights-toggle]");
    expect(toggle().closest("[data-discussion-toolbar]")).not.toBeNull();
    expect(toggle().getAttribute("aria-label")).toBe("comments.hideIndicators");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    await click("[data-discussion-highlights-toggle]");
    expect(onChange).toHaveBeenCalledWith(false);

    highlights = { visible: false, onChange };
    render();
    expect(toggle().getAttribute("aria-label")).toBe("comments.showIndicators");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a chip for each filter someone chose and clears it from the chip", async () => {
    render();
    expect(
      container.querySelector('[aria-label^="comments.removeFilter"]'),
    ).toBeNull();

    act(() => replies.setHistoryFilters({ target: "text" }));
    const chipLabel = "comments.targetFilter: comments.targetText";
    expect(
      container.querySelector("[data-discussion-toolbar]")?.textContent,
    ).toContain(chipLabel);
    expect(
      button("[data-discussion-filter-trigger]").getAttribute("aria-label"),
    ).toBe("1 comments.filter");
    expect(card("page-1")).toBeNull();

    await click(`[aria-label="comments.removeFilter:${chipLabel}"]`);
    expect(replies.historyFilters.target).toBe("all");
    expect(
      container.querySelector("[data-discussion-toolbar]")?.textContent,
    ).not.toContain(chipLabel);
    expect(card("page-1")).not.toBeNull();
    expect(storedFilters()).toBeNull();
  });

  it("has one filter button, whose options say which ones are chosen", async () => {
    render();
    expect(
      container.querySelectorAll("[data-discussion-filter-trigger]"),
    ).toHaveLength(1);
    const pressed = (group: string, option: string) =>
      button(filterOption(group, option)).getAttribute("aria-pressed");

    await click("[data-discussion-filter-trigger]");
    expect(pressed("status", "open")).toBe("true");
    expect(pressed("status", "resolved")).toBe("false");

    await click(filterOption("status", "resolved"));
    expect(replies.historyFilters.status).toBe("resolved");
    expect(pressed("status", "resolved")).toBe("true");
    expect(pressed("status", "open")).toBe("false");
  });

  it("clears every chosen filter at once", async () => {
    render();
    act(() =>
      replies.setHistoryFilters({ status: "resolved", mentionsMe: true }),
    );
    const clear = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-discussion-toolbar] button",
      ),
    ].find((element) => element.textContent === "comments.clearFilters")!;
    await act(async () => clear.click());
    expect(replies.historyFilters).toMatchObject({
      status: "open",
      mentionsMe: false,
      target: "all",
      query: "",
    });
    expect(storedFilters()).toBeNull();
  });

  it("posts a comment on the whole page with nothing quoted", async () => {
    actions.create.mockResolvedValue({ id: "created", threadId: "created" });
    render();
    const composer = container.querySelector<HTMLElement>(
      "[data-discussion-composer]",
    )!;
    const editor = richEditor(composer)!;
    expect(editor.getAttribute("aria-label")).toBe("comments.commentOnPage");

    await setRichEditorValue(editor, "A thought on the whole page");
    await act(async () =>
      composer
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );

    expect(actions.create).toHaveBeenCalledOnce();
    const payload = actions.create.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      clientOperationId: expect.any(String),
      documentId: "fixture",
      content: "A thought on the whole page",
    });
    for (const anchor of [
      "quotedText",
      "propertyId",
      "property",
      "fieldId",
      "threadId",
      "parentId",
    ]) {
      expect(payload).not.toHaveProperty(anchor);
    }
    expect(richEditorValue(richEditor(composer)!)).toBe("");
  });

  it("shows a linked thread whatever the filters say, Type included", () => {
    render("history", "text-1");
    act(() => replies.setHistoryFilters({ kind: "suggestions" }));
    expect(card("text-1")).not.toBeNull();
    expect(card("page-1")).toBeNull();
  });

  it("keeps a linked resolved thread selected, and in view under the default Open filter", () => {
    onSelectedThreadChange = vi.fn();
    threads = [fixtureThreads[0], { ...fixtureThreads[1], resolved: true }];
    render("history", "text-1");
    expect(card("text-1")).not.toBeNull();
    expect(card("page-1")).not.toBeNull();
    expect(onSelectedThreadChange).not.toHaveBeenCalled();

    // It lets go once the thread is gone.
    threads = [fixtureThreads[0]];
    render("history", "text-1");
    expect(onSelectedThreadChange).toHaveBeenCalledWith(null);
  });

  it("keeps a page comment in view after posting it under a filter that hides it, until the filters change", async () => {
    actions.create.mockResolvedValue({ id: "created", threadId: "created" });
    render();
    act(() => replies.setHistoryFilters({ target: "text" }));
    const composer = container.querySelector<HTMLElement>(
      "[data-discussion-composer]",
    )!;
    await setRichEditorValue(richEditor(composer)!, "Seen right away");
    await act(async () =>
      composer
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );
    // The refetch after posting brings the new thread.
    threads = [...fixtureThreads, thread("created", null)];
    try {
      render();
      expect(card("created")).not.toBeNull();
      expect(card("page-1")).toBeNull();

      act(() => replies.setHistoryFilters({ target: "property" }));
      expect(card("created")).toBeNull();
    } finally {
      threads = fixtureThreads;
    }
  });

  it("keeps a comment whose save wasn't confirmed in view under any filter, and once it's confirmed", async () => {
    const unconfirmed = thread("optimistic-operation-1", null);
    unconfirmed.comments[0].mutation = {
      kind: "create",
      status: "error",
      operationId: "operation-1",
      ambiguous: true,
    };
    threads = [...fixtureThreads, unconfirmed];
    render();
    act(() =>
      replies.setHistoryFilters({ target: "text", kind: "suggestions" }),
    );
    // Its card holds the only way to check the save, and the composer waits
    // on that check.
    expect(card("optimistic-operation-1")).not.toBeNull();
    expect(card("page-1")).toBeNull();
    const check = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("comments.checkSaved"),
    )!;
    expect(check).toBeDefined();

    actions.reconcile.mockResolvedValue("confirmed");
    await act(async () => check.click());
    expect(actions.reconcile).toHaveBeenCalledWith("fixture", "operation-1");
    // The refetch swaps the unconfirmed card for the saved thread, which is
    // saved under its operation's id.
    threads = [...fixtureThreads, thread("operation-1", null)];
    render();
    expect(card("operation-1")).not.toBeNull();

    act(() => replies.setHistoryFilters({ target: "property" }));
    expect(card("operation-1")).toBeNull();
  });

  it("keeps a thread whose reply's save wasn't confirmed in view under any filter", () => {
    const replied = thread("text-2", "Other line");
    replied.comments.push({
      ...replied.comments[0],
      id: "optimistic-reply",
      parent_id: replied.comments[0].id,
      content: "Reply",
      mutation: {
        kind: "create",
        status: "error",
        operationId: "operation-2",
        ambiguous: true,
      },
    });
    threads = [...fixtureThreads, replied];
    render();
    act(() => replies.setHistoryFilters({ target: "page" }));
    expect(card("text-2")).not.toBeNull();
    expect(card("text-1")).toBeNull();
  });

  it("keeps a conflict's view while someone searches, without saving over their filters", () => {
    render();
    act(() => replies.setHistoryFilters({ target: "text" }));
    act(() => replies.revealHistory("conflict-1", null));
    expect(replies.historyFilters.target).toBe("all");

    act(() => replies.setHistoryFilters({ query: "Comment" }));
    expect(replies.historyFilters).toMatchObject({
      target: "all",
      query: "Comment",
    });
    expect(JSON.parse(storedFilters()!).target).toBe("text");
  });

  it("keeps Escape in the page composer and the search from closing the panel", () => {
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-discussion-toolbar", "");
    const search = document.createElement("input");
    toolbar.append(search);
    const outside = document.createElement("input");
    document.body.append(toolbar, outside);
    const escape = () =>
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    try {
      search.focus();
      const inSearch = escape();
      search.dispatchEvent(inSearch);
      preserveCommentReplyEscape(inSearch);
      expect(inSearch.defaultPrevented).toBe(true);

      outside.focus();
      const elsewhere = escape();
      outside.dispatchEvent(elsewhere);
      preserveCommentReplyEscape(elsewhere);
      expect(elsewhere.defaultPrevented).toBe(false);
    } finally {
      toolbar.remove();
      outside.remove();
    }
  });

  it("keeps a page comment's text when it fails to post", async () => {
    actions.create.mockRejectedValue(new Error("offline"));
    render();
    const composer = container.querySelector<HTMLElement>(
      "[data-discussion-composer]",
    )!;
    await setRichEditorValue(richEditor(composer)!, "Try again later");
    await act(async () =>
      composer
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );

    expect(actions.create).toHaveBeenCalledOnce();
    expect(richEditorValue(richEditor(composer)!)).toBe("Try again later");
  });

  it("doesn't call a highlight unavailable before it has been looked for", async () => {
    page.current = document.createElement("div");
    page.current.innerHTML =
      '<div class="ProseMirror"><p><span data-comment-thread="text-1">Quoted line</span></p></div>';
    document.body.append(page.current);
    render();
    await nextFrame();
    expect(unavailable("text-1")).toBeNull();

    // Hiding highlights takes their marks off the page, so a comment posted
    // now can't be measured.
    highlights = { visible: false };
    page.current.innerHTML =
      '<div class="ProseMirror"><p>Quoted line</p><p>Second line</p></div>';
    threads = [...fixtureThreads, thread("text-2", "Second line")];
    render();
    await nextFrame();
    expect(card("text-2")).not.toBeNull();
    expect(unavailable("text-2")).toBeNull();

    // Shown again, the highlights are measured, and a missing quote is flagged.
    highlights = { visible: true };
    page.current.innerHTML =
      '<div class="ProseMirror"><p><span data-comment-thread="text-1">Quoted line</span></p></div>';
    render();
    await nextFrame();
    expect(unavailable("text-1")).toBeNull();
    expect(unavailable("text-2")).not.toBeNull();
  });

  it("waits for highlights shown again to be drawn before calling one unavailable", async () => {
    const paragraph = pageWithFormattedQuote(true);
    render();
    await nextFrame();
    expect(unavailable("text-1")).toBeNull();

    highlights = { visible: false };
    render();
    paragraph.innerHTML = formattedQuote(false);
    await nextFrame();

    // The editor draws the highlights a moment after they're shown again.
    highlights = { visible: true };
    render();
    expect(unavailable("text-1")).toBeNull();
    await nextFrame();
    expect(unavailable("text-1")).toBeNull();

    act(() => {
      paragraph.innerHTML = formattedQuote(true);
    });
    await nextFrame();
    expect(unavailable("text-1")).toBeNull();
  });

  it("calls a highlight unavailable once it's clear it won't come back", async () => {
    const paragraph = pageWithFormattedQuote(true);
    render();
    await nextFrame();

    // Someone rewrites the quote while highlights are hidden.
    highlights = { visible: false };
    render();
    paragraph.innerHTML = "Rewritten line";
    await nextFrame();

    highlights = { visible: true };
    render();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(unavailable("text-1")).not.toBeNull();
  });
});
