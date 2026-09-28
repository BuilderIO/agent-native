// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlideCommentsPanel } from "./SlideCommentsPanel";

const refetch = vi.fn();
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
      "comments.scope": "Comment scope",
      "comments.thisSlide": "This slide",
      "comments.allComments": "All slides",
      "comments.audience": "Comment audience",
      "comments.all": "All",
      "comments.forYou": "For you",
      "comments.goToSlide": "Go to slide",
      "comments.hideResolved": "Hide resolved",
      "comments.showResolved": "Show resolved comments",
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
  useSlideComments: () => ({
    data: commentQueryState?.data,
    isError: commentQueryState?.isError ?? false,
    refetch,
  }),
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
});

describe("SlideCommentsPanel", () => {
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
});
