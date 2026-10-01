// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReplyInput, SlideCommentsPanel } from "./SlideCommentsPanel";

const refetch = vi.fn();
const useSlideCommentsArgs = vi.fn();
const commentFiltersStorage = new Map<string, string>();
const localStorageMock = {
  get length() {
    return commentFiltersStorage.size;
  },
  clear: () => commentFiltersStorage.clear(),
  getItem: (key: string) => commentFiltersStorage.get(key) ?? null,
  key: (index: number) =>
    Array.from(commentFiltersStorage.keys())[index] ?? null,
  removeItem: (key: string) => {
    commentFiltersStorage.delete(key);
  },
  setItem: (key: string, value: string) => {
    commentFiltersStorage.set(key, value);
  },
} as Storage;
const {
  createComment,
  deleteComment,
  resolveComment,
  toggleReaction,
  updateComment,
} = vi.hoisted(() => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  resolveComment: vi.fn(),
  toggleReaction: vi.fn(),
  updateComment: vi.fn(),
}));
let commentQueryState:
  | {
      data: unknown[] | undefined;
      isError: boolean;
    }
  | undefined;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      "comments.title": "Comments",
      "comments.addComment": "Add comment",
      "comments.close": "Close",
      "comments.loadFailed": "Couldn't load comments",
      "comments.retry": "Retry",
      "comments.addCommentPlaceholder": "Add a comment...",
      "comments.replyPlaceholder": "Write a reply...",
      "comments.cancel": "Cancel",
      "comments.saving": "Saving...",
      "comments.comment": "Comment",
      "comments.deleteComment": "Delete comment",
      "comments.editComment": "Edit comment",
      "comments.save": "Save",
      "comments.reopenThread": "Reopen thread",
      "comments.resolveThread": "Resolve thread",
      "comments.updateFailed": "Could not update this comment.",
      "comments.deleteFailed": "Could not delete this comment.",
      "comments.reactionFailed": "Could not update this reaction.",
      "comments.addReaction": "Add reaction",
      "comments.toggleReaction": "Toggle reaction {{emoji}}",
      "comments.reactWith": "React with {{emoji}}",
      "comments.filters": "Comment filters",
      "comments.scope": "Comment scope",
      "comments.thisSlide": "This slide",
      "comments.allComments": "All slides",
      "comments.audience": "Comment audience",
      "comments.all": "All",
      "comments.forYou": "For you",
      "comments.goToSlide": "Go to slide",
      "comments.hideResolved": "Hide resolved",
      "comments.showResolved": "Show resolved comments",
      "comments.search": "Search comments",
      "comments.searchPlaceholder": "Search all comments...",
    };
    return messages[key] ?? key;
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: Error) => error.message,
  useAvatarUrl: () => null,
  useReconciledState: (value: string) => useState(value),
}));

const PopoverContext = createContext<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
} | null>(null);

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    open = false,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <PopoverContext.Provider value={{ open, onOpenChange }}>
      {children}
    </PopoverContext.Provider>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => {
    const context = useContext(PopoverContext);
    return (
      <span onClick={() => context?.onOpenChange?.(!context.open)}>
        {children}
      </span>
    );
  },
  PopoverContent: ({ children }: { children: ReactNode }) => {
    const context = useContext(PopoverContext);
    return context?.open ? <div>{children}</div> : null;
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: (...args: unknown[]) => {
    useSlideCommentsArgs(...args);
    return {
      data: commentQueryState?.data,
      isError: commentQueryState?.isError ?? false,
      refetch,
    };
  },
  useCreateSlideComment: () => ({
    mutateAsync: createComment,
    isPending: false,
  }),
  useResolveSlideComment: () => ({ mutate: resolveComment }),
  useDeleteSlideComment: () => ({ mutate: deleteComment }),
  useUpdateSlideComment: () => ({
    mutateAsync: updateComment,
    isPending: false,
  }),
  useToggleSlideCommentReaction: () => ({ mutate: toggleReaction }),
  emailToColor: () => "#000",
  formatRelativeTime: () => "just now",
}));

afterEach(() => {
  cleanup();
  commentFiltersStorage.clear();
});

beforeEach(() => {
  commentFiltersStorage.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  useSlideCommentsArgs.mockClear();
});

describe("SlideCommentsPanel", () => {
  it("keeps filters collapsed by default and remembers the disclosure state", () => {
    commentQueryState = { data: [], isError: false };
    const props = {
      deckId: "deck-1",
      slideId: "slide-1",
      canComment: true,
      canEdit: true,
      currentUserEmail: "writer@example.com",
      pendingComment: null,
      onPendingDone: vi.fn(),
      onClose: vi.fn(),
    };

    const view = render(<SlideCommentsPanel {...props} />);
    const filtersButton = screen.getByRole("button", {
      name: "Comment filters",
    });
    expect(filtersButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Comment scope" })).toBeNull();
    expect(screen.queryByPlaceholderText("Search all comments...")).toBeNull();
    expect(useSlideCommentsArgs).toHaveBeenLastCalledWith(
      "deck-1",
      "slide-1",
      "slide",
    );

    fireEvent.click(filtersButton);
    expect(filtersButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Comment scope" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Search all comments...")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All slides" }));
    expect(useSlideCommentsArgs).toHaveBeenLastCalledWith(
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
    expect(screen.queryByRole("group", { name: "Comment scope" })).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Comment audience" }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText("Search all comments...")).toBeNull();
    expect(useSlideCommentsArgs).toHaveBeenLastCalledWith(
      "deck-1",
      "slide-1",
      "slide",
    );

    fireEvent.click(filtersButton);
    expect(filtersButton.getAttribute("aria-expanded")).toBe("true");
    expect(useSlideCommentsArgs).toHaveBeenLastCalledWith(
      "deck-1",
      "slide-1",
      "slide",
    );
    view.unmount();
    render(<SlideCommentsPanel {...props} />);
    expect(
      screen
        .getByRole("button", { name: "Comment filters" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(useSlideCommentsArgs).toHaveBeenLastCalledWith(
      "deck-1",
      "slide-1",
      "slide",
    );
  });

  it("keeps Add comment available when the slide already has threads", () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Review this slide",
            },
          ],
        },
      ],
      isError: false,
    };

    const view = render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    expect(screen.getByPlaceholderText("Add a comment...")).toBeTruthy();
    expect(
      view.container.querySelector('[data-slide-comment-thread="thread-1"]'),
    ).toBeTruthy();
  });

  it("scrolls to and highlights a selected thread", () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Review this slide",
            },
          ],
        },
      ],
      isError: false,
    };
    const props = {
      deckId: "deck-1",
      slideId: "slide-1",
      canComment: false,
      canEdit: false,
      currentUserEmail: "viewer@example.com",
      pendingComment: null,
      onPendingDone: vi.fn(),
      onClose: vi.fn(),
    };

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
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Review this slide",
            },
          ],
        },
      ],
      isError: false,
    };
    const props = {
      deckId: "deck-1",
      slideId: "slide-1",
      canComment: false,
      canEdit: false,
      currentUserEmail: "viewer@example.com",
      pendingComment: null,
      onPendingDone: vi.fn(),
      onClose: vi.fn(),
      selectedThreadId: "thread-1",
      selectedThreadRequestId: 1,
    };
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
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Review this slide",
            },
          ],
        },
      ],
      isError: false,
    };
    const props = {
      deckId: "deck-1",
      slideId: "slide-1",
      canComment: false,
      canEdit: false,
      currentUserEmail: "viewer@example.com",
      pendingComment: null,
      onPendingDone: vi.fn(),
      onClose: vi.fn(),
    };

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
    expect(screen.queryByText("comments.noCommentsYet")).toBeNull();
  });

  it("keeps the add-reaction picker available from the smile affordance", () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Review this slide",
            },
          ],
        },
      ],
      isError: false,
    };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    expect(
      screen.getAllByRole("button", { name: "React with {{emoji}}" }),
    ).toHaveLength(7);
  });

  it("saves a selected-text comment with its object anchor", async () => {
    const anchor = {
      x: 42,
      y: 33,
      objectId: "shape-7",
      objectX: 50,
      objectY: 75,
      targetText: "Revenue",
    };
    const onPendingDone = vi.fn();
    commentQueryState = { data: [], isError: false };
    createComment.mockReset().mockResolvedValue({
      id: "comment-1",
      threadId: "thread-1",
    });

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit
        currentUserEmail="writer@example.com"
        pendingComment={{ slideId: "slide-1", quotedText: "Revenue", anchor }}
        onPendingDone={onPendingDone}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Add a comment..."), {
      target: { value: "Check this total" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(createComment).toHaveBeenCalledWith({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Check this total",
        quotedText: "Revenue",
        anchor,
      }),
    );
    expect(onPendingDone).toHaveBeenCalledOnce();
  });

  it("shows a retryable error instead of the empty-comments state", () => {
    commentQueryState = {
      data: undefined,
      isError: true,
    };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Couldn't load comments")).toBeTruthy();
    expect(screen.queryByText("comments.noCommentsYet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows existing reactions but hides reaction controls for viewers", () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Review this slide",
              reactions: [{ emoji: "👍", count: 2, reacted: false }],
            },
          ],
        },
      ],
      isError: false,
    };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment={false}
        canEdit={false}
        currentUserEmail="viewer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Review this slide")).toBeTruthy();
    expect(screen.getByText("👍")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Toggle reaction/ }),
    ).toBeNull();
  });

  it("excludes a self-authored-only thread from For you", () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Only my note",
            },
          ],
        },
      ],
      isError: false,
    };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit={false}
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Comment filters" }));
    fireEvent.click(screen.getByRole("button", { name: "For you" }));

    expect(screen.queryByText("Only my note")).toBeNull();
  });

  it("clears a pending comment that belongs to another slide", async () => {
    const onPendingDone = vi.fn();
    commentQueryState = { data: [], isError: false };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-2"
        canComment
        canEdit
        currentUserEmail="writer@example.com"
        pendingComment={{ slideId: "slide-1", quotedText: "Old title" }}
        onPendingDone={onPendingDone}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByPlaceholderText("Add a comment...")).toBeNull();
    await waitFor(() => expect(onPendingDone).toHaveBeenCalledOnce());
  });

  it("keeps the current slide context for all-slides navigation", () => {
    const onSelectSlide = vi.fn();
    commentQueryState = {
      data: [
        {
          threadId: "thread-2",
          slideId: "slide-2",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-2",
              author_email: "other@example.com",
              author_name: "Other",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Review the second slide",
            },
          ],
        },
      ],
      isError: false,
    };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment={false}
        canEdit={false}
        currentUserEmail="viewer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onSelectSlide={onSelectSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Comment filters" }));
    fireEvent.click(screen.getByRole("button", { name: "All slides" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to slide" }));

    expect(onSelectSlide).toHaveBeenCalledExactlyOnceWith("slide-2");
  });

  it("renders inline markdown in comment bodies without block headings", () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "**bold** `code` and # Heading",
            },
          ],
        },
      ],
      isError: false,
    };

    const { container } = render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("bold", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("code", { selector: "code" })).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.textContent).toContain("Heading");
  });

  it("lets a commenter reopen a resolved thread without gaining delete access", () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: true,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "other@example.com",
              author_name: "Other",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Please check this value",
            },
          ],
        },
      ],
      isError: false,
    };
    deleteComment.mockReset();
    resolveComment.mockReset();

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit={false}
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show resolved comments" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reopen thread" }));

    expect(resolveComment).toHaveBeenCalledWith(
      {
        id: "comment-1",
        deckId: "deck-1",
        resolved: false,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(screen.queryByRole("button", { name: "Delete comment" })).toBeNull();
    expect(deleteComment).not.toHaveBeenCalled();
  });

  it("lets the author edit their comment with the deck scoped", async () => {
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Original wording",
            },
          ],
        },
      ],
      isError: false,
    };
    updateComment.mockReset().mockResolvedValue({ ok: true });

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit={false}
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Updated wording" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateComment).toHaveBeenCalledWith({
        id: "comment-1",
        deckId: "deck-1",
        content: "Updated wording",
      }),
    );
  });

  it("keeps a pending comment open while IME keys are composing", () => {
    const onPendingDone = vi.fn();
    createComment.mockReset();
    commentQueryState = { data: [], isError: false };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit
        currentUserEmail="writer@example.com"
        pendingComment={{ slideId: "slide-1", quotedText: "" }}
        onPendingDone={onPendingDone}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Add a comment...");
    fireEvent.change(input, { target: { value: "candidate" } });
    fireEvent.keyDown(input, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });

    expect(screen.getByPlaceholderText("Add a comment...")).toBeTruthy();
    expect(onPendingDone).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it("keeps a reply open while IME keys are composing", () => {
    const onDone = vi.fn();
    createComment.mockReset();

    render(
      <ReplyInput
        deckId="deck-1"
        slideId="slide-1"
        threadId="thread-1"
        parentId="comment-1"
        onDone={onDone}
      />,
    );

    const input = screen.getByPlaceholderText("Write a reply...");
    fireEvent.change(input, { target: { value: "candidate" } });
    fireEvent.keyDown(input, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });

    expect(screen.getByPlaceholderText("Write a reply...")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it("keeps a comment edit open while IME keys are composing", () => {
    const onPendingDone = vi.fn();
    updateComment.mockReset();
    commentQueryState = {
      data: [
        {
          threadId: "thread-1",
          resolved: false,
          quotedText: null,
          comments: [
            {
              id: "comment-1",
              author_email: "writer@example.com",
              author_name: "Writer",
              created_at: "2026-08-13T00:00:00.000Z",
              content: "Original wording",
            },
          ],
        },
      ],
      isError: false,
    };

    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit={false}
        currentUserEmail="writer@example.com"
        pendingComment={null}
        onPendingDone={onPendingDone}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const input = screen.getByRole("textbox", { name: "Edit comment" });
    fireEvent.keyDown(input, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });

    expect(screen.getByRole("textbox", { name: "Edit comment" })).toBeTruthy();
    expect(updateComment).not.toHaveBeenCalled();
  });
});
