// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlideCommentPins } from "./SlideCommentPins";

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "comments.addComment": "Add comment",
      "comments.addCommentPlaceholder": "Add a comment...",
      "comments.cancel": "Cancel",
      "comments.comment": "Comment",
      "comments.saving": "Saving...",
      "comments.saveCommentFailed": "Could not save this comment.",
      "comments.title": "Comments",
    })[key] ?? key,
}));

vi.mock("@agent-native/core/client/markdown", () => ({
  InlineMarkdown: ({ content }: { content: string }) => <span>{content}</span>,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  AvatarImage: () => null,
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
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  emailToColor: () => "#000",
  formatRelativeTime: () => "just now",
  useCreateSlideComment: () => ({ isPending: false, mutateAsync }),
}));

function renderWithCanvas(
  props: Partial<ComponentProps<typeof SlideCommentPins>> = {},
) {
  const canvas = document.createElement("div");
  canvas.className = "slide-content";
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 250,
      height: 200,
      left: 100,
      right: 500,
      top: 50,
      width: 400,
      x: 100,
      y: 50,
    }),
  });
  document.body.append(canvas);

  return render(
    <SlideCommentPins
      active={false}
      canComment
      comments={[]}
      deckId="deck-1"
      slideId="slide-1"
      canvasSelector=".slide-content"
      {...props}
    />,
  );
}

describe("SlideCommentPins", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ id: "comment-1", threadId: "comment-1" });
  });

  afterEach(() => cleanup());

  it("creates a persisted comment at the clicked slide position", async () => {
    renderWithCanvas({ active: true });
    const plane = await waitFor(() => {
      const element = document.querySelector(
        "[data-slide-comment-click-plane]",
      );
      expect(element).toBeTruthy();
      return element!;
    });

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    fireEvent.change(screen.getByPlaceholderText("Add a comment..."), {
      target: { value: "Move this title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Move this title",
        anchor: { x: 50, y: 50 },
      }),
    );
  });

  it("opens the full thread when an avatar marker is clicked", async () => {
    renderWithCanvas({
      comments: [
        {
          threadId: "thread-1",
          quotedText: null,
          anchor: { x: 25, y: 30 },
          resolved: false,
          comments: [
            {
              id: "comment-1",
              deck_id: "deck-1",
              slide_id: "slide-1",
              thread_id: "thread-1",
              parent_id: null,
              content: "Check this image",
              quoted_text: null,
              anchor: { x: 25, y: 30 },
              author_email: "writer@example.com",
              author_name: "Writer",
              resolved: false,
              created_at: "2026-08-27T00:00:00.000Z",
              updated_at: "2026-08-27T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    const marker = await waitFor(() => {
      const element = document.querySelector("[data-slide-comment-marker]");
      expect(element).toBeTruthy();
      return element!;
    });

    fireEvent.click(marker);
    expect(screen.getAllByText("Check this image").length).toBeGreaterThan(0);
  });
});
