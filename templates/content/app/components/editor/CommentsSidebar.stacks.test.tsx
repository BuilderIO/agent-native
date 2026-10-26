// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import { richEditor, setRichEditorValue } from "./comment-composer-test-utils";
import { CommentDraftProvider } from "./comment-drafts";
import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
  type PendingCommentSelection,
} from "./CommentsSidebar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({
    mutateAsync: actions.create,
    isPending: false,
    reconcileAmbiguous: vi.fn(),
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
  useT: () => (key: string, params?: { count?: number }) =>
    params?.count === undefined ? key : `${key}:${params.count}`,
}));
vi.mock("@agent-native/toolkit/app/review", () => ({
  InlineMarkdown: ({ content }: { content: string }) => content,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const AUTHORS: Record<string, string> = {
  a: "ada@example.test",
  b: "jo@example.test",
  c: "sam@example.test",
  d: "lee@example.test",
};

/** A queried element the test can't go on without. */
function found<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected the element to be on the page");
  return value;
}

function thread(
  id: string,
  times: string[],
  { resolved = false }: { resolved?: boolean } = {},
): CommentThread {
  const author = AUTHORS[id] ?? "reviewer@example.test";
  return {
    threadId: id,
    quotedText: `quote ${id}`,
    prefix: null,
    suffix: null,
    startOffset: 0,
    field: null,
    resolved,
    comments: times.map((created_at, index) => ({
      id: `${id}-${index}`,
      document_id: "fixture",
      thread_id: id,
      parent_id: index === 0 ? null : `${id}-0`,
      content: index === 0 ? `Comment ${id}` : `Reply ${id} ${index}`,
      quoted_text: `quote ${id}`,
      anchor_prefix: null,
      anchor_suffix: null,
      anchor_start_offset: 0,
      mentions: [],
      author_email: author,
      author_name: author.split("@")[0],
      resolved: resolved ? 1 : 0,
      created_at,
      updated_at: created_at,
      notion_comment_id: null,
      submission_source: "frontend",
    })),
  };
}

// A paragraph with four open threads and one resolved, a paragraph with one
// thread, and a list whose first item has two.
const THREADS = [
  thread("a", ["2026-10-20T09:00:00Z"]),
  thread("b", ["2026-10-20T10:00:00Z", "2026-10-20T10:30:00Z"]),
  thread("c", ["2026-10-20T11:00:00Z"]),
  thread("d", ["2026-10-20T12:00:00Z"]),
  thread("r", ["2026-10-20T13:00:00Z"], { resolved: true }),
  thread("solo", ["2026-10-20T08:00:00Z"]),
  thread("l1", ["2026-10-20T07:00:00Z"]),
  thread("l2", ["2026-10-20T07:30:00Z"]),
  thread("l3", ["2026-10-20T07:45:00Z"]),
];

const DOC = `
  <div data-document-scroll-content>
    <div class="ProseMirror">
      <p>Review: <span data-comment-thread="a">alpha</span>, <span data-comment-thread="b">beta</span>,
        <span data-comment-thread="r">resolved</span>, <span data-comment-thread="c">gamma</span>,
        <span data-comment-thread="d">delta</span>, <span data-slot="intro">and more</span>.</p>
      <p><span data-comment-thread="solo">solo</span> <span data-slot="solo">beside it</span></p>
      <ul>
        <li><p><span data-comment-thread="l1">one</span> <span data-comment-thread="l2">two</span></p></li>
        <li><p><span data-comment-thread="l3">three</span></p></li>
      </ul>
    </div>
  </div>`;

type Harness = {
  selected: string | null;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  comment: (selection: PendingCommentSelection) => void;
  activated: string[];
};
const harness = { activated: [] } as unknown as Harness;

function Owner({
  threads,
  scroll,
  presentation,
  canComment,
}: {
  threads: CommentThread[];
  scroll: HTMLDivElement;
  presentation: "inline" | "history";
  canComment: boolean;
}) {
  const replies = useCommentReplyDrafts("fixture", "reviewer@example.test");
  const pending = usePendingCommentDraft("fixture");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  harness.selected = selected;
  harness.select = setSelected;
  harness.hover = setHovered;
  // As the editor does: a new comment clears the selection.
  harness.comment = (selection) => {
    pending.setPendingComment(selection);
    setSelected(null);
    setHovered(null);
  };
  return (
    <CommentsSidebar
      replyDrafts={replies}
      pendingComment={pending.pendingComment}
      onPendingChange={pending.changePendingComment}
      onPendingDone={(id, threadId) => {
        if (!pending.completePendingComment(id)) return;
        if (threadId) setSelected(threadId);
      }}
      documentId="fixture"
      threads={threads}
      scrollContainerRef={{ current: scroll }}
      activeThreadId={hovered ?? selected}
      selectedThreadId={selected}
      hoveredThreadId={hovered}
      onActivateThread={(id) => {
        harness.activated.push(id);
        pending.setPendingComment(null);
        setHovered(null);
        setSelected(id);
      }}
      onSelectedThreadChange={setSelected}
      onHoveredThreadChange={setHovered}
      currentUserEmail="reviewer@example.test"
      canComment={canComment}
      canResolve
      alignToAnchors
      forceVisible
      presentation={presentation}
    />
  );
}

describe("comment stacks in the margin", () => {
  let root: Root;
  let container: HTMLDivElement;
  let scroll: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    actions.create.mockReset();
    harness.activated = [];
    scroll = document.createElement("div");
    scroll.innerHTML = DOC;
    document.body.append(scroll);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    scroll.remove();
    queryClient.clear();
    window.localStorage.clear();
  });

  function render(
    threads: CommentThread[] = THREADS,
    presentation: "inline" | "history" = "inline",
    canComment = true,
  ) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CommentDraftProvider
              documentId="fixture"
              currentUserEmail="reviewer@example.test"
            >
              <Owner
                threads={threads}
                scroll={scroll}
                presentation={presentation}
                canComment={canComment}
              />
            </CommentDraftProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }

  async function wait(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  /** The margin's cards in order: a thread id, or `stack:<front>`. */
  function margin() {
    return [
      ...container.querySelectorAll<HTMLElement>(
        "[data-comment-layout-thread]",
      ),
    ].map((item) => {
      const stack = item.querySelector<HTMLElement>(
        '[data-comment-stack-state="folded"]',
      );
      return stack
        ? `stack:${stack.dataset.commentStackFront}`
        : item.dataset.commentLayoutThread;
    });
  }

  function foldedStacks() {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-comment-stack-state="folded"]',
      ),
    ];
  }

  function openButton(front: string) {
    return container.querySelector<HTMLButtonElement>(
      `[data-comment-stack-front="${front}"] [data-comment-stack-open]`,
    )!;
  }

  function collapseButton() {
    return container.querySelector<HTMLButtonElement>(
      "[data-comment-stack-collapse]",
    );
  }

  function markPending(slot: string) {
    scroll
      .querySelector(`[data-slot="${slot}"]`)!
      .classList.add("comment-highlight", "comment-highlight--pending");
  }

  it("folds every block with two or more open threads into one card", () => {
    render();
    expect(margin()).toEqual(["stack:d", "solo", "stack:l2", "l3"]);
    const front = found(
      foldedStacks()[0].querySelector("[data-comment-stack-front-card]"),
    );
    // The newest thread is in front: its quote, its first comment, and
    // how many replies it has.
    expect(front.textContent).toContain("quote d");
    expect(front.textContent).toContain("Comment d");
    expect(front.textContent).not.toContain("Comment a");
    // Resolved threads are dropped, so the count is of open threads.
    expect(front.textContent).toContain("comments.stackMore:3");
    expect(
      front.querySelectorAll("[data-comment-stack-footer] [title]"),
    ).toHaveLength(3);
    const open = openButton("d");
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.getAttribute("aria-label")).toBe("comments.stackShowAll:4");
  });

  it("keeps the other threads' cards unseen behind the front, so it keeps its size when the front changes", () => {
    render();
    const behind = [
      ...foldedStacks()[0].querySelectorAll<HTMLElement>(
        "[data-comment-stack-behind]",
      ),
    ];
    expect(behind.map((card) => card.dataset.commentStackBehind)).toEqual([
      "a",
      "b",
      "c",
    ]);
    for (const card of behind) {
      expect(card.classList.contains("invisible")).toBe(true);
      expect(card.getAttribute("aria-hidden")).toBe("true");
      expect(card.hasAttribute("inert")).toBe(true);
    }
  });

  it("stacks a quote across blocks under its first block, spaced as the page reads it, in front or behind", async () => {
    scroll.innerHTML = `
      <div data-document-scroll-content>
        <div class="ProseMirror">
          <p><span data-comment-thread="near">near</span> and the
            <span data-comment-thread="across">end of one</span></p>
          <p><span data-comment-thread="across">start of two</span></p>
        </div>
      </div>`;
    const across = {
      ...thread("across", ["2026-10-20T09:00:00Z"]),
      quotedText: "end of onestart of two",
    };
    render([across, thread("near", ["2026-10-20T10:00:00Z"])]);
    expect(margin()).toEqual(["stack:near"]);
    const stack = foldedStacks()[0];
    expect(
      found(stack.querySelector('[data-comment-stack-behind="across"]'))
        .textContent,
    ).toContain("end of one start of two");

    act(() => harness.hover("across"));
    await wait(220);
    expect(margin()).toEqual(["stack:across"]);
    const front = found(
      foldedStacks()[0].querySelector("[data-comment-stack-front-card]"),
    );
    expect(front.textContent).toContain("end of one start of two");
    expect(
      found(foldedStacks()[0].querySelector("[data-comment-stack-description]"))
        .textContent,
    ).toContain("end of one start of two");
  });

  it("describes a folded stack to screen readers, though its preview is inert", () => {
    render();
    const description = document.getElementById(
      openButton("d").getAttribute("aria-describedby")!,
    )!;
    // An inert node describes nothing, so the description lives outside the
    // preview, hidden from sight rather than from assistive technology.
    expect(description.closest("[inert]")).toBeNull();
    expect(description.hidden).toBe(true);
    expect([...description.children].map((line) => line.textContent)).toEqual([
      "quote d",
      "lee",
      "Comment d",
      "ada",
      "jo",
      "sam",
      "comments.stackMore:3",
    ]);

    act(() => harness.select("b"));
    act(() => collapseButton()!.click());
    expect(
      document.getElementById(openButton("b").getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("comments.replyCount:1");
  });

  it("shows a front thread's reply count", () => {
    render();
    act(() => harness.select("b"));
    act(() => collapseButton()!.click());
    expect(foldedStacks()[0].textContent).toContain("comments.replyCount:1");
  });

  it("leaves single-thread blocks and the comments panel as they were", () => {
    render([THREADS[5], THREADS[8]]);
    expect(margin()).toEqual(["solo", "l3"]);
    expect(container.querySelector("[data-comment-stack]")).toBeNull();
    expect(
      container.querySelector('[data-thread-card="solo"] [data-comment-quote]'),
    ).toBeNull();

    render(THREADS, "history");
    expect(container.querySelector("[data-comment-stack]")).toBeNull();
    expect(
      [...container.querySelectorAll("[data-thread-card]")]
        .map((card) => card.getAttribute("data-thread-card"))
        .sort(),
    ).toEqual(["a", "b", "c", "d", "l1", "l2", "l3", "solo"]);
  });

  it("leaves a comment on the whole page out of the margin and its stacks", () => {
    // Newer than every thread, so it would be a stack's front if it joined one.
    const page = thread("page", ["2026-10-21T09:00:00Z"]);
    page.quotedText = null;
    page.comments[0].quoted_text = null;

    render([...THREADS, page]);
    expect(margin()).toEqual(["stack:d", "solo", "stack:l2", "l3"]);
    expect(container.querySelector('[data-thread-card="page"]')).toBeNull();

    render([...THREADS, page], "history");
    expect(container.querySelector("[data-comment-stack]")).toBeNull();
    expect(container.querySelector('[data-thread-card="page"]')).not.toBeNull();
  });

  it("brings a highlight's thread to the front once the pointer rests on it", async () => {
    render();
    act(() => harness.hover("b"));
    await wait(60);
    // Passing over a highlight on the way to the margin changes nothing.
    act(() => harness.hover(null));
    await wait(200);
    expect(margin()[0]).toBe("stack:d");

    act(() => harness.hover("b"));
    await wait(220);
    expect(margin()[0]).toBe("stack:b");
    // It stays in front after the pointer leaves, so the card can be reached.
    act(() => harness.hover(null));
    await wait(220);
    expect(margin()[0]).toBe("stack:b");
  });

  it("keeps the default front in front once the pointer has rested on it", async () => {
    render();
    act(() => harness.hover("d"));
    await wait(220);
    act(() => harness.hover(null));
    // A reply elsewhere would otherwise make another thread the newest.
    const replied = thread("a", [
      "2026-10-20T09:00:00Z",
      "2026-10-20T14:00:00Z",
    ]);
    render(THREADS.map((item) => (item.threadId === "a" ? replied : item)));
    expect(margin()[0]).toBe("stack:d");
  });

  it("stacks a thread whose highlight gains its id after the thread arrives", async () => {
    // A posted comment's highlight can reuse the draft's span.
    render([...THREADS, thread("late", ["2026-10-20T15:00:00Z"])]);
    expect(margin()).not.toContain("stack:late");
    act(() =>
      scroll
        .querySelector('[data-slot="solo"]')!
        .setAttribute("data-comment-thread", "late"),
    );
    await wait(60);
    expect(margin()).toEqual(["stack:d", "stack:late", "stack:l2", "l3"]);
  });

  it("opens from its card, laying the block's threads out in document order", () => {
    render();
    act(() => openButton("d").click());
    expect(harness.activated).toEqual(["d"]);
    expect(harness.selected).toBe("d");
    expect(margin()).toEqual(["a", "b", "c", "d", "solo", "stack:l2", "l3"]);
    expect(collapseButton()?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector("[data-comment-stack-guide]"),
    ).not.toBeNull();
    // Cards in an open stack repeat their quote, since they no longer sit
    // level with their own highlight.
    expect(
      container.querySelector('[data-thread-card="a"] [data-comment-quote]')
        ?.textContent,
    ).toBe("quote a");
  });

  it("shows an open stack's quotes as text to a viewer who can't comment", () => {
    render(THREADS, "inline", false);
    act(() => harness.select("b"));
    const quote = () =>
      container.querySelector<HTMLElement>(
        '[data-thread-card="a"] [data-comment-quote]',
      )!;
    expect(quote().textContent).toBe("quote a");
    // A button here would do nothing for them.
    expect(quote().closest("button")).toBeNull();

    render();
    act(() => quote().click());
    expect(harness.selected).toBe("a");
  });

  it("moves focus and scroll to the opened card, and focus back on Collapse", async () => {
    const scrolled: Element[] = [];
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    try {
      render();
      openButton("d").focus();
      act(() => openButton("d").click());
      const card = container.querySelector('[data-thread-card="d"]');
      expect(document.activeElement).toBe(card);
      expect(scrollIntoView).not.toHaveBeenCalled();
      await wait(320);
      expect(scrolled).toEqual([card]);
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
        behavior: "smooth",
      });

      act(() => collapseButton()!.click());
      expect(document.activeElement).toBe(openButton("d"));
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it("starts an open stack at the top of the margin, not above it", () => {
    render();
    // Every highlight here sits at the margin's top, so keeping the last
    // thread level with its own would push the Collapse row above it.
    act(() => harness.select("d"));
    const header = container.querySelector<HTMLElement>(
      '[data-comment-stack-state="open"]',
    )!;
    expect(header.style.top).toBe("0px");
  });

  it("opens from any highlight in the block, on that thread", () => {
    render();
    act(() => harness.select("b"));
    expect(margin()).toEqual(["a", "b", "c", "d", "solo", "stack:l2", "l3"]);
    expect(
      container.querySelector(
        '[data-thread-card="b"] [data-comment-reply-composer]',
      ),
    ).not.toBeNull();
  });

  it("opens a selected thread's stack once its highlight is measured", async () => {
    const highlight = scroll.querySelector('[data-comment-thread="b"]')!;
    highlight.removeAttribute("data-comment-thread");
    render();
    // Selected before the margin knows its block, as from a link.
    act(() => harness.select("b"));
    act(() => highlight.setAttribute("data-comment-thread", "b"));
    await wait(60);
    expect(margin()).toEqual(["a", "b", "c", "d", "solo", "stack:l2", "l3"]);
    expect(collapseButton()).not.toBeNull();
  });

  it("keeps a stack open when its selected thread is resolved", async () => {
    const three = THREADS.filter((item) => item.threadId !== "d");
    render(three);
    act(() => harness.select("b"));
    const resolve = (item: CommentThread) =>
      item.threadId === "b" ? { ...item, resolved: true } : item;
    // The margin measures again only after the editor drops the highlight.
    render(three.map(resolve));
    expect(collapseButton()).not.toBeNull();
    act(() =>
      scroll
        .querySelector('[data-comment-thread="b"]')!
        .removeAttribute("data-comment-thread"),
    );
    await wait(60);
    expect(margin()).toEqual(
      expect.arrayContaining(["a", "c", "solo", "stack:l2", "l3"]),
    );
    expect(foldedStacks()).toHaveLength(1);
    expect(collapseButton()).not.toBeNull();
  });

  it("keeps a stack opened before measurement open when that thread is resolved", async () => {
    const highlight = scroll.querySelector('[data-comment-thread="b"]')!;
    highlight.removeAttribute("data-comment-thread");
    render();
    act(() => harness.select("b"));
    act(() => highlight.setAttribute("data-comment-thread", "b"));
    await wait(60);
    render(
      THREADS.map((item) =>
        item.threadId === "b" ? { ...item, resolved: true } : item,
      ),
    );
    act(() => highlight.removeAttribute("data-comment-thread"));
    await wait(60);
    expect(collapseButton()).not.toBeNull();
    expect(margin()).toEqual(expect.arrayContaining(["a", "c", "d"]));
  });

  it("forgets a stack resolved down to one thread", async () => {
    render();
    act(() => harness.select("l1"));
    const resolved = THREADS.map((item) =>
      item.threadId === "l1" ? { ...item, resolved: true } : item,
    );
    render(resolved);
    const highlight = scroll.querySelector('[data-comment-thread="l1"]')!;
    act(() => highlight.removeAttribute("data-comment-thread"));
    await wait(60);
    expect(collapseButton()).toBeNull();
    // A thread arriving later makes a new stack, which nobody has opened.
    act(() => highlight.setAttribute("data-comment-thread", "l4"));
    render([...resolved, thread("l4", ["2026-10-20T16:00:00Z"])]);
    await wait(60);
    expect(margin()).toContain("stack:l4");
    expect(collapseButton()).toBeNull();
  });

  it("ignores hovering while its stack is open", async () => {
    render();
    act(() => harness.select("b"));
    act(() => harness.hover("c"));
    await wait(220);
    act(() => harness.hover(null));
    act(() => collapseButton()!.click());
    expect(margin()[0]).toBe("stack:b");
  });

  it("folds on Collapse, keeping the thread you were on in front", () => {
    render();
    act(() => harness.select("a"));
    act(() => harness.select("c"));
    act(() => collapseButton()!.click());
    expect(harness.selected).toBeNull();
    expect(margin()).toEqual(["stack:c", "solo", "stack:l2", "l3"]);
  });

  it("folds when the selection is dismissed or the margin's empty space is clicked", () => {
    render();
    act(() => harness.select("a"));
    act(() => harness.select(null));
    expect(margin()[0]).toBe("stack:a");

    act(() => harness.select("b"));
    act(() =>
      container
        .querySelector<HTMLElement>("[data-comments-sidebar]")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(harness.selected).toBeNull();
    expect(margin()[0]).toBe("stack:b");
  });

  it("keeps only one stack open at a time", () => {
    render();
    act(() => harness.select("a"));
    act(() => harness.select("l1"));
    expect(margin()).toEqual(["stack:a", "solo", "l1", "l2", "l3"]);
    expect(
      container.querySelectorAll("[data-comment-stack-collapse]"),
    ).toHaveLength(1);
  });

  it("opens a new comment on top of a folded stack without opening it", async () => {
    render();
    markPending("intro");
    act(() => harness.comment({ quotedText: "and more", offsetTop: 0 }));
    const pending = container.querySelector<HTMLElement>(
      "[data-comment-pending]",
    )!;
    expect(pending.dataset.commentStackState).toBe("composing");
    expect(pending.querySelectorAll("[data-comment-stack-sheet]")).toHaveLength(
      2,
    );
    expect(richEditor(pending)).not.toBeNull();
    const showAll = pending.querySelector<HTMLButtonElement>(
      "[data-comment-stack-show-all]",
    )!;
    expect(showAll.textContent).toContain("comments.stackMore:4");
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    // The stack's own card makes way for the composer.
    expect(margin()).toEqual(["solo", "stack:l2", "l3"]);

    showAll.focus();
    act(() => showAll.click());
    expect(margin()).toEqual(["a", "b", "c", "d", "solo", "stack:l2", "l3"]);
    expect(
      container.querySelector<HTMLElement>("[data-comment-pending]")?.dataset
        .commentStackState,
    ).toBeUndefined();
    // The draft keeps focus, though the button that had it is gone.
    expect(document.activeElement).toBe(
      richEditor(container.querySelector("[data-comment-pending]")!),
    );
  });

  it("puts a posted comment in front of the folded stack", async () => {
    render();
    markPending("intro");
    act(() => harness.comment({ quotedText: "and more", offsetTop: 0 }));
    await wait(60);
    const created = thread("new", [new Date().toISOString()]);
    actions.create.mockImplementation(async () => {
      const slot = scroll.querySelector('[data-slot="intro"]')!;
      slot.className = "";
      slot.setAttribute("data-comment-thread", "new");
      render([...THREADS, created]);
      return { id: "new-0", threadId: "new" };
    });
    await setRichEditorValue(
      richEditor(container.querySelector("[data-comment-pending]")!)!,
      "Which settings page?",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );
    expect(harness.selected).toBe("new");
    expect(margin()).toEqual(["stack:new", "solo", "stack:l2", "l3"]);
    expect(foldedStacks()[0].textContent).toContain("comments.stackMore:4");

    // Its highlight still opens the stack, though the thread is selected.
    act(() =>
      scroll.querySelector<HTMLElement>('[data-comment-thread="new"]')!.click(),
    );
    expect(margin()).toEqual(
      expect.arrayContaining(["a", "b", "c", "d", "new"]),
    );
    expect(collapseButton()).not.toBeNull();
  });

  it("folds the stack a posted comment makes with a block's only thread", async () => {
    render();
    // Selecting a lone thread opens nothing, so nothing is left to open the
    // stack its block becomes.
    act(() => harness.select("solo"));
    markPending("solo");
    act(() => harness.comment({ quotedText: "beside it", offsetTop: 0 }));
    await wait(60);
    actions.create.mockImplementation(async () => {
      const slot = scroll.querySelector('[data-slot="solo"]')!;
      slot.className = "";
      slot.setAttribute("data-comment-thread", "new");
      render([...THREADS, thread("new", [new Date().toISOString()])]);
      return { id: "new-0", threadId: "new" };
    });
    await setRichEditorValue(
      richEditor(container.querySelector("[data-comment-pending]")!)!,
      "A second thread here",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );
    expect(harness.selected).toBe("new");
    expect(margin()).toEqual(["stack:d", "stack:new", "stack:l2", "l3"]);
    expect(collapseButton()).toBeNull();
  });

  it("puts a posted comment in front even when the newest thread was touched", async () => {
    render();
    act(() => harness.select("a"));
    act(() => harness.select(null));
    markPending("intro");
    act(() => harness.comment({ quotedText: "and more", offsetTop: 0 }));
    await wait(60);
    actions.create.mockImplementation(async () => {
      const slot = scroll.querySelector('[data-slot="intro"]')!;
      slot.className = "";
      slot.setAttribute("data-comment-thread", "new");
      render([...THREADS, thread("new", ["2026-10-20T06:00:00Z"])]);
      return { id: "new-0", threadId: "new" };
    });
    await setRichEditorValue(
      richEditor(container.querySelector("[data-comment-pending]")!)!,
      "Older clock, still in front",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );
    expect(margin()[0]).toBe("stack:new");
  });

  it("keeps a posted comment in front while the pointer rests on another highlight", async () => {
    render();
    markPending("intro");
    act(() => harness.comment({ quotedText: "and more", offsetTop: 0 }));
    // The Comment button goes from under the pointer, which comes to rest on
    // another of the block's highlights.
    act(() => harness.hover("b"));
    await wait(220);
    actions.create.mockImplementation(async () => {
      const slot = found(scroll.querySelector('[data-slot="intro"]'));
      slot.className = "";
      slot.setAttribute("data-comment-thread", "new");
      render([...THREADS, thread("new", [new Date().toISOString()])]);
      return { id: "new-0", threadId: "new" };
    });
    await setRichEditorValue(
      found(
        richEditor(found(container.querySelector("[data-comment-pending]"))),
      ),
      "Posted under a resting pointer",
    );
    await act(async () =>
      found(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="comments.submit"]',
        ),
      ).click(),
    );
    await wait(400);
    expect(margin()[0]).toBe("stack:new");

    // Resting on a highlight again brings it back.
    act(() => harness.hover(null));
    act(() => harness.hover("b"));
    await wait(220);
    expect(margin()[0]).toBe("stack:b");
  });

  it("puts a clicked highlight's thread in front, even one already selected", async () => {
    render();
    markPending("intro");
    act(() => harness.comment({ quotedText: "and more", offsetTop: 0 }));
    await wait(60);
    actions.create.mockImplementation(async () => {
      const slot = scroll.querySelector('[data-slot="intro"]')!;
      slot.className = "";
      slot.setAttribute("data-comment-thread", "new");
      render([...THREADS, thread("new", [new Date().toISOString()])]);
      return { id: "new-0", threadId: "new" };
    });
    await setRichEditorValue(
      richEditor(container.querySelector("[data-comment-pending]")!)!,
      "Selected, and still folded",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );
    act(() => harness.hover("a"));
    await wait(220);
    act(() => harness.hover(null));
    expect(margin()[0]).toBe("stack:a");

    act(() =>
      scroll.querySelector<HTMLElement>('[data-comment-thread="new"]')!.click(),
    );
    act(() => collapseButton()!.click());
    expect(margin()[0]).toBe("stack:new");
  });

  it("adds a new comment to an open stack's list as its selected card", () => {
    render();
    act(() => harness.select("a"));
    markPending("intro");
    act(() => harness.comment({ quotedText: "and more", offsetTop: 0 }));
    expect(margin()).toEqual(["a", "b", "c", "d", "solo", "stack:l2", "l3"]);
    expect(collapseButton()).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>("[data-comment-pending]")?.dataset
        .commentStackState,
    ).toBeUndefined();
  });

  it("folds an open stack when a new comment starts in another block", () => {
    render();
    act(() => harness.select("a"));
    markPending("solo");
    act(() => harness.comment({ quotedText: "beside it", offsetTop: 0 }));
    expect(margin()).toEqual(["stack:a", "solo", "stack:l2", "l3"]);
    expect(collapseButton()).toBeNull();
  });

  describe("lining the card you're on up with its text", () => {
    const CARD = 100;
    let layout: { mockRestore: () => void } | null = null;
    afterEach(() => {
      layout?.mockRestore();
      layout = null;
    });

    /** Puts each highlight at a top in the margin, and makes every card 100px tall. */
    function layOut(tops: Partial<Record<string, number>>) {
      layout = vi
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: Element) {
          const threadId = this.getAttribute("data-comment-thread");
          const top =
            threadId !== null
              ? (tops[threadId] ?? 0)
              : this.classList.contains("comment-highlight--pending")
                ? (tops.pending ?? 0)
                : 0;
          const height =
            this.hasAttribute("data-thread-card") ||
            this.hasAttribute("data-comment-pending") ||
            this.getAttribute("data-comment-stack-state") === "folded"
              ? CARD
              : 0;
          return {
            top,
            bottom: top + height,
            left: 0,
            right: 100,
            width: 100,
            height,
            x: 0,
            y: top,
            toJSON: () => ({}),
          };
        });
    }

    /** Each card's top in the margin: its place in the flow, plus its shift. */
    function cardTops() {
      let flow = 0;
      const tops = new Map<string, number>();
      for (const item of container.querySelectorAll<HTMLElement>(
        "[data-comment-layout-thread]",
      )) {
        const top = flow + parseFloat(item.style.marginTop || "0");
        const shift = Number(
          /translateY\((-?[\d.]+)px\)/.exec(item.style.transform)?.[1] ?? 0,
        );
        tops.set(found(item.dataset.commentLayoutThread), top + shift);
        flow = top + CARD;
      }
      return tops;
    }

    function collapseTop() {
      return parseFloat(
        found(
          container.querySelector<HTMLElement>(
            '[data-comment-stack-state="open"]',
          ),
        ).style.top,
      );
    }

    it("keeps the cards before the clicked one above it when they fit", async () => {
      layOut({
        a: 500,
        b: 500,
        c: 500,
        d: 500,
        solo: 900,
        l1: 1100,
        l2: 1100,
        l3: 1200,
      });
      render();
      await wait(20);
      act(() => harness.select("c"));
      const tops = cardTops();
      expect(tops.get("c")).toBe(500);
      // Collapse, a and b above it, in document order; d below.
      expect(tops.get("a")).toBe(500 - 2 * (CARD + 12));
      expect(tops.get("b")).toBe(500 - (CARD + 12));
      expect(tops.get("d")).toBe(500 + CARD + 12);
      expect(collapseTop()).toBe(500 - 2 * (CARD + 12) - 28 - 12);
    });

    it("puts the clicked card first near the top, level with its text, below a reachable Collapse row", async () => {
      // a and b would need 264px above c; the paragraph is 150px down.
      layOut({
        a: 150,
        b: 150,
        c: 150,
        d: 150,
        solo: 600,
        l1: 800,
        l2: 800,
        l3: 900,
      });
      render();
      await wait(20);
      act(() => harness.select("c"));
      const tops = cardTops();
      expect(tops.get("c")).toBe(150);
      expect(collapseTop()).toBe(150 - 28 - 12);
      // The rest follow it in document order.
      expect(tops.get("a")).toBe(150 + CARD + 12);
      expect(tops.get("b")).toBe(150 + 2 * (CARD + 12));
      expect(tops.get("d")).toBe(150 + 3 * (CARD + 12));
      // The page's other cards keep clear of the stack.
      expect(tops.get("solo")).toBeGreaterThanOrEqual(150 + 4 * (CARD + 12));
      // The margin still lists them in document order.
      expect(margin()).toEqual(["a", "b", "c", "d", "solo", "stack:l2", "l3"]);
    });

    it("keeps highlights on one line in document order, whatever order their threads came in", async () => {
      layOut({
        a: 150,
        b: 150,
        c: 150,
        d: 150,
        solo: 600,
        l1: 800,
        l2: 800,
        l3: 900,
      });
      render([...THREADS].reverse());
      await wait(20);
      act(() => harness.select("c"));
      const tops = cardTops();
      expect(tops.get("c")).toBe(150);
      expect(tops.get("a")).toBe(150 + CARD + 12);
      expect(tops.get("b")).toBe(150 + 2 * (CARD + 12));
      expect(tops.get("d")).toBe(150 + 3 * (CARD + 12));
    });

    it("lines a new comment up with its selection, folded or in the opened stack", async () => {
      layOut({
        a: 150,
        b: 150,
        c: 150,
        d: 150,
        pending: 180,
        solo: 600,
        l1: 800,
        l2: 800,
        l3: 900,
      });
      render();
      await wait(20);
      markPending("intro");
      act(() => harness.comment({ quotedText: "and more", offsetTop: 180 }));
      await wait(20);
      const pending = () =>
        found(container.querySelector<HTMLElement>("[data-comment-pending]"));
      expect(pending().dataset.commentStackState).toBe("composing");
      expect(pending().style.top).toBe("180px");

      act(() =>
        found(
          pending().querySelector<HTMLButtonElement>(
            "[data-comment-stack-show-all]",
          ),
        ).click(),
      );
      expect(collapseButton()).not.toBeNull();
      expect(pending().style.top).toBe("180px");
      expect(collapseTop()).toBe(180 - 28 - 12);
      expect(cardTops().get("a")).toBe(180 + CARD + 12);
    });
  });

  describe("bringing a new thread to the front of a folded stack", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function leaving() {
      return [
        ...container.querySelectorAll<HTMLElement>(
          "[data-comment-stack-leaving]",
        ),
      ];
    }

    function entering() {
      return [
        ...container.querySelectorAll<HTMLElement>(
          ".comment-stack-front-enter",
        ),
      ];
    }

    it("keeps the old front card under the new one as it leaves", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      render();
      expect(leaving()).toHaveLength(0);
      act(() => harness.hover("b"));
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(margin()[0]).toBe("stack:b");
      const [card] = leaving();
      expect(card.dataset.commentStackLeaving).toBe("d");
      expect(card.textContent).toContain("Comment d");
      // Drawn just before the new front, so it stays underneath.
      expect(card.nextElementSibling?.textContent).toContain("Comment b");
      expect(entering()).toEqual([card.nextElementSibling]);
      // It's only a picture of the card that left.
      expect(card.getAttribute("aria-hidden")).toBe("true");
      expect(card.hasAttribute("inert")).toBe(true);
      expect(
        document.getElementById(
          found(openButton("b").getAttribute("aria-describedby")),
        )?.firstElementChild?.textContent,
      ).toBe("quote b");

      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(leaving()).toHaveLength(0);
      expect(margin()[0]).toBe("stack:b");
    });

    it("settles on the latest front when the pointer crosses several highlights", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      render();
      for (const threadId of ["b", "c", "a"]) {
        act(() => harness.hover(threadId));
        act(() => {
          vi.advanceTimersByTime(190);
        });
      }
      // Only the card it just replaced is on its way out; none queue up.
      expect(margin()[0]).toBe("stack:a");
      expect(leaving().map((card) => card.dataset.commentStackLeaving)).toEqual(
        ["c"],
      );
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(leaving()).toHaveLength(0);
      expect(margin()[0]).toBe("stack:a");
    });

    it("plays the change when a stack folds with another thread in front", () => {
      render();
      act(() => harness.select("a"));
      act(() => found(collapseButton()).click());
      expect(margin()[0]).toBe("stack:a");
      expect(leaving().map((card) => card.dataset.commentStackLeaving)).toEqual(
        ["d"],
      );
    });

    it("plays the change when another person's new thread comes to the front", async () => {
      render();
      act(() =>
        found(scroll.querySelector('[data-slot="intro"]')).setAttribute(
          "data-comment-thread",
          "new",
        ),
      );
      render([...THREADS, thread("new", ["2026-10-20T15:00:00Z"])]);
      await wait(60);
      expect(margin()[0]).toBe("stack:new");
      expect(leaving().map((card) => card.dataset.commentStackLeaving)).toEqual(
        ["d"],
      );
    });

    // Text that leads the block also changes which thread the folded card is
    // laid out under.
    it.each(["after", "before"] as const)(
      "swaps in a posted comment's saved copy without playing the change again, its text %s the others",
      async (place) => {
        render();
        const slot =
          place === "after"
            ? found(scroll.querySelector('[data-slot="intro"]'))
            : document.createElement("span");
        act(() => {
          if (place === "before")
            found(scroll.querySelector('[data-comment-thread="a"]')).before(
              slot,
            );
          slot.setAttribute("data-comment-thread", "optimistic-op");
        });
        render([...THREADS, thread("optimistic-op", ["2026-10-20T15:00:00Z"])]);
        await wait(60);
        expect(margin()).toContain("stack:optimistic-op");
        expect(entering()).toHaveLength(1);

        // The saved thread takes the stand-in's place before its change ends.
        act(() => slot.setAttribute("data-comment-thread", "new"));
        render([...THREADS, thread("new", ["2026-10-20T15:00:00Z"])]);
        await wait(60);
        expect(margin()).toContain("stack:new");
        expect(leaving()).toHaveLength(0);
        expect(entering()).toHaveLength(0);
      },
    );

    it("plays the change on folding a stack whose block moved while it was open", async () => {
      render();
      act(() => harness.select("a"));
      act(() =>
        found(scroll.querySelector(".ProseMirror")).prepend(
          document.createElement("p"),
        ),
      );
      await wait(60);
      act(() => found(collapseButton()).click());
      expect(margin()[0]).toBe("stack:a");
      expect(leaving().map((card) => card.dataset.commentStackLeaving)).toEqual(
        ["d"],
      );
    });

    it("folds without a change to play when the same thread stays in front", () => {
      render();
      act(() => harness.select("d"));
      act(() => found(collapseButton()).click());
      expect(margin()[0]).toBe("stack:d");
      expect(leaving()).toHaveLength(0);
    });
  });
});
