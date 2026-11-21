// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-slide-comments";

import { SlideCommentsPanel } from "./SlideCommentsPanel";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  reply: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  react: vi.fn(),
  sendToAgent: vi.fn(),
  toastError: vi.fn(),
  refetch: vi.fn(),
  useSlideCommentsArgs: vi.fn(),
}));

const storage = new Map<string, string>();
const localStorageMock = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key: string) => {
    storage.delete(key);
  },
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
} as Storage;

let queryState: {
  threads: CommentThread[] | undefined;
  isError: boolean;
  reactions?: Record<string, unknown[]>;
} = { threads: [], isError: false };

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  useSession: () => ({
    session: { email: "writer@example.com", orgId: null },
  }),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/i18n")>();
  const { default: english } =
    await vi.importActual<typeof import("@/i18n/en-US")>("@/i18n/en-US");
  const lookup = (key: string): unknown =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        english,
      );
  return {
    ...actual,
    useT:
      () =>
      (key: string, values: Record<string, unknown> = {}) => {
        const plural =
          typeof values.count === "number"
            ? `_${new Intl.PluralRules("en").select(values.count)}`
            : "";
        const message = lookup(`${key}${plural}`) ?? lookup(key);
        return typeof message === "string"
          ? message.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
              String(values[name]),
            )
          : key;
      },
  };
});

vi.mock("@agent-native/core/client/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/review")
  >()),
  useCreateReviewComment: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useReplyReviewComment: () => ({ mutateAsync: mocks.reply, isPending: false }),
  useUpdateReviewComment: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
  useDeleteReviewComment: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
  }),
  useResolveReviewThread: () => ({
    mutateAsync: mocks.resolve,
    isPending: false,
  }),
  useReactToReviewComment: () => ({
    mutateAsync: mocks.react,
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChatAndConfirm: mocks.sendToAgent,
}));

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/toolkit/app/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/review")
  >()),
  useReviewMentionPeople: () => ({
    people: [{ label: "Pat", email: "pat@example.com" }],
    searching: false,
    failed: false,
    onMentionQueryChange: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: (...args: unknown[]) => {
    mocks.useSlideCommentsArgs(...args);
    return {
      data: queryState.threads
        ? {
            threads: queryState.threads,
            discussion: {
              reactions: queryState.reactions ?? {},
              threadPreferences: {},
              canReact: true,
              canSetThreadPreferences: true,
            },
          }
        : undefined,
      isError: queryState.isError,
      refetch: mocks.refetch,
    };
  },
}));

type EditorElement = HTMLElement & {
  editor: {
    commands: { focus: (position: "end") => boolean };
    state: { tr: { insertText: (text: string) => unknown } };
    view: { dispatch: (transaction: unknown) => void };
  };
};

function comment(
  id: string,
  extra: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: "thread-1",
    parentCommentId: null,
    targetId: null,
    surfaceId: "slide-1",
    kind: "comment",
    status: "open",
    anchor: null,
    anchorKind: null,
    anchorVersion: null,
    body: "Review this slide",
    authorEmail: "other@example.com",
    authorName: "Other",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    metadata: null,
    canDelete: false,
    canDeleteThread: false,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...extra,
  } as ReviewComment;
}

function thread(
  root: ReviewComment,
  replies: ReviewComment[] = [],
  extra: Partial<CommentThread> = {},
): CommentThread {
  return {
    threadId: root.threadId,
    slideId: root.surfaceId ?? null,
    quotedText: null,
    anchor: null,
    resolved: root.status === "resolved",
    root,
    replies,
    ...extra,
  };
}

type PanelProps = ComponentProps<typeof SlideCommentsPanel>;

function panelProps(extra: Partial<PanelProps> = {}): PanelProps {
  return {
    deckId: "deck-1",
    slideId: "slide-1",
    canComment: true,
    currentUserEmail: "writer@example.com",
    pendingComment: null,
    onPendingDone: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
}

async function editorNamed(name: string): Promise<EditorElement> {
  const element = await screen.findByRole("textbox", { name });
  return element as EditorElement;
}

function typeInto(element: EditorElement, text: string) {
  act(() => {
    element.editor.commands.focus("end");
  });
  act(() => {
    const { state, view } = element.editor;
    view.dispatch(state.tr.insertText(text));
  });
}

function pressEnter(element: HTMLElement, init: KeyboardEventInit = {}) {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function openMenu(trigger: HTMLElement) {
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
}

function menuItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );
}

function menuItem(name: string): HTMLElement {
  const item = menuItems().find(
    (element) => element.textContent.trim() === name,
  );
  if (!item) throw new Error(`no menu item named ${name}`);
  return item;
}

function deferred<T>() {
  const handlers = {
    resolve: (_value: T) => {},
    reject: (_reason: unknown) => {},
  };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return { promise, resolve: handlers.resolve, reject: handlers.reject };
}

const revenueSelection = {
  slideId: "slide-1",
  quotedText: "Revenue",
  anchor: { x: 42, y: 33, textStartOffset: 0, textEndOffset: 7 },
};
const costsSelection = {
  slideId: "slide-1",
  quotedText: "Costs",
  anchor: { x: 42, y: 60, textStartOffset: 12, textEndOffset: 17 },
};

function reactionChoice(item: HTMLElement): string | null | undefined {
  return item.querySelector('[aria-hidden="true"]')?.textContent;
}

afterEach(() => {
  cleanup();
  storage.clear();
});

beforeEach(() => {
  storage.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  queryState = { threads: [], isError: false };
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.sendToAgent.mockResolvedValue({ delivered: true });
});

describe("SlideCommentsPanel", () => {
  it("keeps filters collapsed by default and remembers the disclosure state", () => {
    const props = panelProps();

    const view = render(<SlideCommentsPanel {...props} />);
    const filtersButton = screen.getByRole("button", {
      name: "Comment filters",
    });
    expect(filtersButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Comment scope" })).toBeNull();
    expect(screen.queryByPlaceholderText("Search all comments...")).toBeNull();
    expect(mocks.useSlideCommentsArgs).toHaveBeenLastCalledWith(
      "deck-1",
      "slide-1",
      "slide",
    );

    fireEvent.click(filtersButton);
    expect(filtersButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Comment scope" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All slides" }));
    expect(mocks.useSlideCommentsArgs).toHaveBeenLastCalledWith(
      "deck-1",
      "slide-1",
      "deck",
    );
    fireEvent.click(screen.getByRole("button", { name: "For you" }));
    fireEvent.change(screen.getByLabelText("Search comments"), {
      target: { value: "phrase" },
    });
    fireEvent.click(filtersButton);
    expect(filtersButton.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("group", { name: "Comment audience" }),
    ).toBeNull();
    expect(mocks.useSlideCommentsArgs).toHaveBeenLastCalledWith(
      "deck-1",
      "slide-1",
      "slide",
    );

    fireEvent.click(filtersButton);
    view.unmount();
    render(<SlideCommentsPanel {...props} />);
    expect(
      screen
        .getByRole("button", { name: "Comment filters" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("keeps Add comment available when the slide already has threads", async () => {
    queryState.threads = [thread(comment("comment-1"))];

    const view = render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await editorNamed("Add comment")).toBeTruthy();
    expect(
      view.container.querySelector('[data-slide-comment-thread="thread-1"]'),
    ).toBeTruthy();
  });

  it("scrolls to and highlights a selected thread", () => {
    queryState.threads = [thread(comment("comment-1"))];
    const props = panelProps({ canComment: false });

    const view = render(<SlideCommentsPanel {...props} />);
    const card = view.container.querySelector<HTMLElement>(
      '[data-slide-comment-thread="thread-1"]',
    );
    expect(card).toBeTruthy();
    const scrollIntoView = vi.fn();
    Object.defineProperty(card, "scrollIntoView", { value: scrollIntoView });

    view.rerender(
      <SlideCommentsPanel {...props} selectedThreadId="thread-1" />,
    );

    expect(card?.getAttribute("data-selected-comment")).toBe("true");
    expect(card?.className).toContain("ring-2");
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      behavior: "smooth",
      block: "nearest",
    });
  });

  it("re-scrolls when the same selected thread is requested again", () => {
    queryState.threads = [thread(comment("comment-1"))];
    const props = panelProps({
      canComment: false,
      selectedThreadId: "thread-1",
      selectedThreadRequestId: 1,
    });
    const view = render(<SlideCommentsPanel {...props} />);
    const card = view.container.querySelector<HTMLElement>(
      '[data-slide-comment-thread="thread-1"]',
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(card, "scrollIntoView", { value: scrollIntoView });

    view.rerender(
      <SlideCommentsPanel {...props} selectedThreadRequestId={2} />,
    );
    view.rerender(
      <SlideCommentsPanel {...props} selectedThreadRequestId={3} />,
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("keeps an anchored selected thread visible through active filters", () => {
    queryState.threads = [thread(comment("comment-1"))];
    const props = panelProps({
      canComment: false,
      currentUserEmail: "viewer@example.com",
    });

    const view = render(<SlideCommentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Comment filters" }));
    fireEvent.click(screen.getByRole("button", { name: "For you" }));
    fireEvent.change(screen.getByLabelText("Search comments"), {
      target: { value: "not in this comment" },
    });

    view.rerender(
      <SlideCommentsPanel {...props} selectedThreadId="thread-1" />,
    );

    const card = view.container.querySelector<HTMLElement>(
      '[data-slide-comment-thread="thread-1"]',
    );
    expect(card?.getAttribute("data-selected-comment")).toBe("true");
    expect(screen.queryByText("No comments yet")).toBeNull();
  });

  it("hands selection back when the selected thread is resolved so it collapses into the resolved disclosure", async () => {
    queryState.threads = [thread(comment("comment-1"))];
    mocks.resolve.mockResolvedValue({});
    const onThreadResolved = vi.fn();
    const props = panelProps({ onThreadResolved });

    const view = render(
      <SlideCommentsPanel {...props} selectedThreadId="thread-1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve thread" }));

    expect(mocks.resolve).toHaveBeenCalledWith({
      resourceType: "deck",
      resourceId: "deck-1",
      threadId: "thread-1",
      status: "resolved",
    });
    await waitFor(() =>
      expect(onThreadResolved).toHaveBeenCalledWith("thread-1"),
    );

    queryState.threads = [thread(comment("comment-1", { status: "resolved" }))];
    view.rerender(<SlideCommentsPanel {...props} selectedThreadId={null} />);
    expect(
      view.container.querySelector('[data-slide-comment-thread="thread-1"]'),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show 1 resolved" }),
    ).toBeTruthy();
  });

  it("does not clear selection when resolving fails or an unselected thread is resolved", async () => {
    queryState.threads = [thread(comment("comment-1"))];
    mocks.resolve.mockRejectedValueOnce(new Error("Resolve failed"));
    const onThreadResolved = vi.fn();

    const view = render(
      <SlideCommentsPanel
        {...panelProps({ onThreadResolved })}
        selectedThreadId="thread-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve thread" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Resolve failed"),
    );

    view.rerender(
      <SlideCommentsPanel
        {...panelProps({ onThreadResolved })}
        selectedThreadId={null}
      />,
    );
    mocks.resolve.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Resolve thread" }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2));
    expect(onThreadResolved).not.toHaveBeenCalled();
  });

  it("offers Slides' reactions from the add-reaction picker", async () => {
    queryState.threads = [thread(comment("comment-1"))];
    mocks.react.mockResolvedValue({});

    render(<SlideCommentsPanel {...panelProps()} />);
    openMenu(screen.getByRole("button", { name: "Add reaction" }));

    expect(menuItems().map(reactionChoice)).toEqual([
      "👍",
      "❤️",
      "😂",
      "🎉",
      "😮",
      "😢",
      "🙏",
    ]);
    act(() =>
      menuItems()
        .find((item) => reactionChoice(item) === "🎉")
        ?.click(),
    );

    await waitFor(() =>
      expect(mocks.react).toHaveBeenCalledWith({
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "comment-1",
        reaction: "🎉",
        active: true,
      }),
    );
  });

  it("says why a reaction failed", async () => {
    queryState.threads = [thread(comment("comment-1"))];
    mocks.react.mockRejectedValue(new Error("Reaction failed"));

    render(<SlideCommentsPanel {...panelProps()} />);
    openMenu(screen.getByRole("button", { name: "Add reaction" }));
    act(() =>
      menuItems()
        .find((item) => reactionChoice(item) === "🎉")
        ?.click(),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Reaction failed"),
    );
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });

  it("saves a selected-text comment with its quote and object anchor", async () => {
    const anchor = {
      x: 42,
      y: 33,
      objectId: "shape-7",
      objectX: 50,
      objectY: 75,
      targetText: "Revenue",
    };
    const onPendingDone = vi.fn();
    const onBeforeCommentSubmit = vi.fn(async () => {});
    mocks.create.mockResolvedValue(
      comment("comment-1", { body: "Check this total" }),
    );

    render(
      <SlideCommentsPanel
        {...panelProps({ onPendingDone, onBeforeCommentSubmit })}
        pendingComment={{ slideId: "slide-1", quotedText: "Revenue", anchor }}
      />,
    );

    const editor = await editorNamed("Add comment");
    typeInto(editor, "Check this total");
    pressEnter(editor);

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        resourceType: "deck",
        resourceId: "deck-1",
        surfaceId: "slide-1",
        body: "Check this total",
        mentions: [],
        anchor,
        anchorKind: "slide-point",
        metadata: { quotedText: "Revenue" },
      }),
    );
    expect(onBeforeCommentSubmit).toHaveBeenCalledOnce();
    await waitFor(() => expect(onPendingDone).toHaveBeenCalledOnce());
    expect(mocks.sendToAgent).not.toHaveBeenCalled();
  });

  it("keeps a selection's draft to that selection and throws it away on Cancel", async () => {
    const revenue = revenueSelection;
    const costs = costsSelection;
    const view = render(
      <SlideCommentsPanel {...panelProps()} pendingComment={revenue} />,
    );
    typeInto(await editorNamed("Add comment"), "Half a thought");

    view.rerender(
      <SlideCommentsPanel {...panelProps()} pendingComment={costs} />,
    );
    expect((await editorNamed("Add comment")).textContent).toBe("");

    view.rerender(
      <SlideCommentsPanel {...panelProps()} pendingComment={revenue} />,
    );
    expect((await editorNamed("Add comment")).textContent).toBe(
      "Half a thought",
    );

    const onPendingDone = vi.fn();
    view.rerender(
      <SlideCommentsPanel
        {...panelProps({ onPendingDone })}
        pendingComment={revenue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onPendingDone).toHaveBeenCalledOnce();
    view.rerender(<SlideCommentsPanel {...panelProps()} />);
    view.rerender(
      <SlideCommentsPanel {...panelProps()} pendingComment={revenue} />,
    );
    expect((await editorNamed("Add comment")).textContent).toBe("");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("leaves a newer selection's box open when an earlier send finishes", async () => {
    const creating = deferred<unknown>();
    mocks.create.mockReturnValue(creating.promise);
    const onPendingDone = vi.fn();
    const view = render(
      <SlideCommentsPanel
        {...panelProps({ onPendingDone })}
        pendingComment={revenueSelection}
      />,
    );
    const editor = await editorNamed("Add comment");
    typeInto(editor, "Check this total");
    pressEnter(editor);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());

    view.rerender(
      <SlideCommentsPanel
        {...panelProps({ onPendingDone })}
        pendingComment={costsSelection}
      />,
    );
    await act(async () => {
      creating.resolve(comment("comment-1"));
      await creating.promise;
    });

    expect(onPendingDone).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Add comment" })).toBeTruthy();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("keeps a pending comment open while IME keys are composing", async () => {
    const onPendingDone = vi.fn();
    render(
      <SlideCommentsPanel
        {...panelProps({ onPendingDone })}
        pendingComment={{ slideId: "slide-1", quotedText: "Revenue" }}
      />,
    );

    const editor = await editorNamed("Add comment");
    typeInto(editor, "変換");
    pressEnter(editor, { isComposing: true });

    expect(screen.getByRole("textbox", { name: "Add comment" })).toBeTruthy();
    expect(onPendingDone).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("offers the Slides agent alongside people in the mention list", async () => {
    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    const editor = await editorNamed("Add comment");
    act(() => {
      editor.editor.commands.focus("end");
    });
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "@",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll('[role="option"]')).map(
          (option) => option.textContent,
        ),
      ).toEqual([
        expect.stringContaining("Pat"),
        expect.stringContaining("Agent"),
      ]),
    );
  });

  it("shows a retryable error instead of the empty-comments state", () => {
    queryState = { threads: undefined, isError: true };

    render(<SlideCommentsPanel {...panelProps()} />);

    expect(screen.getByText("Couldn't load comments")).toBeTruthy();
    expect(screen.queryByText("No comments yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("shows existing reactions but hides reaction controls for viewers", () => {
    queryState.threads = [thread(comment("comment-1"))];
    queryState.reactions = {
      "comment-1": [{ reaction: "👍", count: 1, reactedByMe: false }],
    };

    render(
      <SlideCommentsPanel
        {...panelProps({
          canComment: false,
          currentUserEmail: "viewer@example.com",
        })}
      />,
    );

    expect(screen.getByText("Review this slide")).toBeTruthy();
    const reaction = screen.getByRole("button", { name: "👍, 1 reaction" });
    expect(reaction.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("excludes a self-authored-only thread from For you", () => {
    queryState.threads = [
      thread(
        comment("comment-1", {
          body: "Only my note",
          authorEmail: "writer@example.com",
          authorName: "Writer",
        }),
      ),
    ];

    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Comment filters" }));
    fireEvent.click(screen.getByRole("button", { name: "For you" }));

    expect(screen.queryByText("Only my note")).toBeNull();
  });

  it("keeps a thread that mentions the viewer in For you", () => {
    queryState.threads = [
      thread(
        comment("comment-1", {
          body: "@Writer can you check this?",
          mentions: [{ label: "Writer", email: "Writer@Example.com" }],
        }),
      ),
    ];

    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Comment filters" }));
    fireEvent.click(screen.getByRole("button", { name: "For you" }));

    expect(
      document.querySelector('[data-slide-comment-thread="thread-1"]'),
    ).toBeTruthy();
  });

  it("clears a pending comment that belongs to another slide", async () => {
    const onPendingDone = vi.fn();

    render(
      <SlideCommentsPanel
        {...panelProps({ onPendingDone })}
        slideId="slide-2"
        pendingComment={{ slideId: "slide-1", quotedText: "Revenue" }}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "Add comment" })).toBeNull();
    await waitFor(() => expect(onPendingDone).toHaveBeenCalledOnce());
  });

  it("keeps the current slide context for all-slides navigation", () => {
    const onSelectSlide = vi.fn();
    queryState.threads = [
      thread(
        comment("comment-2", {
          threadId: "thread-2",
          surfaceId: "slide-2",
          body: "Review the second slide",
        }),
      ),
    ];

    render(
      <SlideCommentsPanel
        {...panelProps({ canComment: false, onSelectSlide })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Comment filters" }));
    fireEvent.click(screen.getByRole("button", { name: "All slides" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to slide" }));

    expect(onSelectSlide).toHaveBeenCalledExactlyOnceWith("slide-2");
  });

  it("renders inline markdown in comment bodies without block headings", () => {
    queryState.threads = [
      thread(comment("comment-1", { body: "**bold** `code` and # Heading" })),
    ];

    const { container } = render(<SlideCommentsPanel {...panelProps()} />);

    expect(screen.getByText("bold", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("code", { selector: "code" })).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.textContent).toContain("Heading");
  });

  it("lets a commenter reopen a resolved thread without gaining delete access", async () => {
    queryState.threads = [thread(comment("comment-1", { status: "resolved" }))];
    mocks.resolve.mockResolvedValue({});

    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 resolved" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen thread" }));

    expect(mocks.resolve).toHaveBeenCalledWith({
      resourceType: "deck",
      resourceId: "deck-1",
      threadId: "thread-1",
      status: "open",
    });
    expect(
      screen.queryByRole("button", { name: "More actions for Other" }),
    ).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("deletes a thread only when the server allows it", async () => {
    queryState.threads = [
      thread(comment("comment-1", { canDelete: true, canDeleteThread: true })),
    ];
    mocks.remove.mockResolvedValue({});

    render(<SlideCommentsPanel {...panelProps()} />);
    openMenu(screen.getByRole("button", { name: "More actions for Other" }));
    expect(() => menuItem("Edit comment")).toThrow();
    act(() => menuItem("Delete thread").click());

    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "comment-1",
      }),
    );
  });

  it("says why a delete failed after the comment has left the list", async () => {
    queryState.threads = [
      thread(comment("comment-1", { canDelete: true, canDeleteThread: true })),
    ];
    const removing = deferred<unknown>();
    mocks.remove.mockReturnValue(removing.promise);

    const view = render(<SlideCommentsPanel {...panelProps()} />);
    openMenu(screen.getByRole("button", { name: "More actions for Other" }));
    act(() => menuItem("Delete thread").click());
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());

    queryState.threads = [];
    view.rerender(<SlideCommentsPanel {...panelProps()} />);
    expect(screen.getByText("No comments yet")).toBeTruthy();
    await act(async () => {
      removing.reject(new Error("Delete failed"));
      await removing.promise.catch(() => undefined);
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Delete failed"),
    );
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });

  it("lets the author edit their own comment", async () => {
    queryState.threads = [
      thread(
        comment("comment-1", {
          body: "Old text",
          authorEmail: "writer@example.com",
          authorName: "Writer",
        }),
      ),
    ];
    mocks.update.mockResolvedValue({});

    render(<SlideCommentsPanel {...panelProps()} />);
    openMenu(screen.getByRole("button", { name: "More actions for Writer" }));
    act(() => menuItem("Edit comment").click());

    const editor = await editorNamed("Edit comment");
    expect(editor.textContent).toBe("Old text");
    typeInto(editor, " and more");
    pressEnter(editor);

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "comment-1",
        body: "Old text and more",
        mentions: [],
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Edit comment" }),
      ).toBeNull(),
    );
  });

  it("keeps a comment edit open while IME keys are composing", async () => {
    queryState.threads = [
      thread(
        comment("comment-1", {
          authorEmail: "writer@example.com",
          authorName: "Writer",
        }),
      ),
    ];

    render(<SlideCommentsPanel {...panelProps()} />);
    openMenu(screen.getByRole("button", { name: "More actions for Writer" }));
    act(() => menuItem("Edit comment").click());
    const editor = await editorNamed("Edit comment");
    pressEnter(editor, { isComposing: true });

    expect(screen.getByRole("textbox", { name: "Edit comment" })).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("sends a reply on Enter and keeps Shift+Enter for a new line", async () => {
    queryState.threads = [thread(comment("comment-1"))];
    mocks.reply.mockResolvedValue(
      comment("reply-1", { parentCommentId: "comment-1" }),
    );

    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const editor = await editorNamed("Reply");
    typeInto(editor, "Looks good");
    pressEnter(editor, { shiftKey: true });
    expect(mocks.reply).not.toHaveBeenCalled();
    typeInto(editor, "Ship it");

    pressEnter(editor);
    await waitFor(() =>
      expect(mocks.reply).toHaveBeenCalledWith({
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "comment-1",
        body: "Looks good\nShip it",
        mentions: [],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull(),
    );
  });

  it("sends a reply once while the first send is still pending", async () => {
    queryState.threads = [thread(comment("comment-1"))];
    let finish: (value: ReviewComment) => void = () => {};
    mocks.reply.mockImplementation(
      () =>
        new Promise<ReviewComment>((resolve) => {
          finish = resolve;
        }),
    );

    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const editor = await editorNamed("Reply");
    typeInto(editor, "Once");
    pressEnter(editor);
    pressEnter(editor);
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledTimes(1));

    await act(async () =>
      finish(comment("reply-1", { parentCommentId: "comment-1" })),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull(),
    );
    expect(mocks.reply).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed reply's draft and says why", async () => {
    queryState.threads = [thread(comment("comment-1"))];
    mocks.reply.mockRejectedValue(new Error("Reply failed"));

    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const editor = await editorNamed("Reply");
    typeInto(editor, "Keep me");
    pressEnter(editor);

    expect((await screen.findByRole("alert")).textContent).toBe("Reply failed");
    expect(
      screen.getByRole("textbox", { name: "Reply" }).textContent,
    ).toContain("Keep me");
  });

  it("keeps a reply's draft through Escape and throws it away on Cancel", async () => {
    queryState.threads = [thread(comment("comment-1"))];

    render(<SlideCommentsPanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const editor = await editorNamed("Reply");
    typeInto(editor, "Half a reply");
    pressEnter(editor, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect((await editorNamed("Reply")).textContent).toBe("Half a reply");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect((await editorNamed("Reply")).textContent).toBe("");
    expect(mocks.reply).not.toHaveBeenCalled();
  });
});
