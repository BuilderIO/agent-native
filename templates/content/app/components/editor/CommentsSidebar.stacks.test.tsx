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
}: {
  threads: CommentThread[];
  scroll: HTMLDivElement;
  presentation: "inline" | "history";
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
      canComment
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
    const [paragraph] = foldedStacks();
    // The newest thread is in front: its quote, its first comment, and
    // how many replies it has.
    expect(paragraph.textContent).toContain("quote d");
    expect(paragraph.textContent).toContain("Comment d");
    expect(paragraph.textContent).not.toContain("Comment a");
    // Resolved threads are dropped, so the count is of open threads.
    expect(paragraph.textContent).toContain("comments.stackMore:3");
    expect(
      paragraph.querySelectorAll("[data-comment-stack-footer] [title]"),
    ).toHaveLength(3);
    const open = openButton("d");
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.getAttribute("aria-label")).toBe("comments.stackShowAll:4");
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

    act(() => showAll.click());
    expect(margin()).toEqual(["a", "b", "c", "d", "solo", "stack:l2", "l3"]);
    expect(
      container.querySelector<HTMLElement>("[data-comment-pending]")?.dataset
        .commentStackState,
    ).toBeUndefined();
    expect(
      richEditor(container.querySelector("[data-comment-pending]")!),
    ).not.toBeNull();
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
      scroll
        .querySelector<HTMLElement>('[data-comment-thread="new"]')!
        .click(),
    );
    expect(margin()).toEqual(
      expect.arrayContaining(["a", "b", "c", "d", "new"]),
    );
    expect(collapseButton()).not.toBeNull();
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
});
