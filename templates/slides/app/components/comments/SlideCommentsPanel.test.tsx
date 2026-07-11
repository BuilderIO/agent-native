// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SlideCommentsPanel } from "./SlideCommentsPanel";

const refetch = vi.fn();

vi.mock("@agent-native/core/client", () => ({
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
    data: undefined,
    isError: true,
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
    render(
      <SlideCommentsPanel
        deckId="deck-1"
        slideId="slide-1"
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
});
