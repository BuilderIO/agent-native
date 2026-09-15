// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SlideCommentsPanel } from "./SlideCommentsPanel";

const refetch = vi.fn();
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
    };
    return messages[key] ?? key;
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
  useCreateSlideComment: vi.fn(),
  useResolveSlideComment: vi.fn(),
  useDeleteSlideComment: vi.fn(),
  emailToColor: () => "#000",
  formatRelativeTime: () => "just now",
}));

describe("SlideCommentsPanel", () => {
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
});
