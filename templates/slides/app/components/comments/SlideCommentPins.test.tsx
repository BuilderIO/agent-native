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
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlideCommentPins } from "./SlideCommentPins";

const { deleteComment, mutateAsync, reaction, resolveComment, updateComment } =
  vi.hoisted(() => ({
    deleteComment: vi.fn(),
    mutateAsync: vi.fn(),
    reaction: vi.fn(),
    resolveComment: vi.fn(),
    updateComment: vi.fn(),
  }));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: Error) => error.message,
  useAvatarUrl: () => null,
  useReconciledState: (value: string) => useState(value),
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
  useDeleteSlideComment: () => ({ mutate: deleteComment }),
  useResolveSlideComment: () => ({ mutate: resolveComment }),
  useToggleSlideCommentReaction: () => ({ mutate: reaction }),
  useUpdateSlideComment: () => ({
    isPending: false,
    mutateAsync: updateComment,
  }),
}));

function renderWithCanvas(
  props: Partial<ComponentProps<typeof SlideCommentPins>> = {},
) {
  const canvas = document.createElement("div");
  canvas.dataset.mainSlideCanvas = "true";
  canvas.dataset.slideCanvasFocus = "true";
  canvas.tabIndex = 0;
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
  const firstPane = document.createElement("div");
  firstPane.className = "slide-content";
  canvas.append(firstPane);
  document.body.append(canvas);

  return {
    ...render(
      <SlideCommentPins
        active={false}
        canComment
        comments={[]}
        deckId="deck-1"
        slideId="slide-1"
        canvasSelector="[data-main-slide-canvas='true']"
        {...props}
      />,
    ),
    canvas,
    firstPane,
  };
}

describe("SlideCommentPins", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ id: "comment-1", threadId: "comment-1" });
  });

  afterEach(() => {
    cleanup();
    document
      .querySelectorAll("[data-main-slide-canvas]")
      .forEach((canvas) => canvas.remove());
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

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

  it("persists object-relative coordinates when a component is clicked", async () => {
    renderWithCanvas({ active: true });
    const object = document.createElement("div");
    object.dataset.slideObjectId = "chart-1";
    object.textContent = "Revenue chart";
    Object.defineProperty(object, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 180,
        height: 80,
        left: 200,
        right: 300,
        top: 100,
        width: 100,
        x: 200,
        y: 100,
      }),
    });
    document.querySelector(".slide-content")?.append(object);
    const target = document.createElement("span");
    target.textContent = "Revenue chart";
    object.append(target);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target, object],
    });

    const plane = await waitFor(() => {
      const element = document.querySelector(
        "[data-slide-comment-click-plane]",
      );
      expect(element).toBeTruthy();
      return element!;
    });

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    fireEvent.change(screen.getByPlaceholderText("Add a comment..."), {
      target: { value: "Check the chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Check the chart",
        anchor: {
          x: 50,
          y: 50,
          objectId: "chart-1",
          objectX: 100,
          objectY: 62.5,
          targetText: "Revenue chart",
        },
      }),
    );
  });

  it("assigns an id before anchoring a first comment on an unpersisted object", async () => {
    const ensureObjectId = vi.fn(() => "new-object");
    renderWithCanvas({ active: true, onEnsureObjectId: ensureObjectId });
    const object = document.createElement("div");
    object.className = "fmd-freeform-object";
    object.style.position = "absolute";
    object.textContent = "New shape";
    Object.defineProperty(object, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 180,
        height: 80,
        left: 200,
        right: 300,
        top: 100,
        width: 100,
        x: 200,
        y: 100,
      }),
    });
    document.querySelector(".slide-content")?.append(object);
    const target = document.createElement("span");
    target.textContent = "New shape";
    object.append(target);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target, object],
    });

    const plane = await waitFor(() => {
      const element = document.querySelector(
        "[data-slide-comment-click-plane]",
      );
      expect(element).toBeTruthy();
      return element!;
    });

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    fireEvent.change(screen.getByPlaceholderText("Add a comment..."), {
      target: { value: "Check this new shape" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Check this new shape",
        anchor: {
          x: 50,
          y: 50,
          objectId: "new-object",
          objectX: 100,
          objectY: 62.5,
          targetText: "New shape",
        },
      }),
    );
    expect(ensureObjectId).toHaveBeenCalledWith(object);
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

  it("measures the whole canvas when it contains multiple content panes", async () => {
    renderWithCanvas({ active: true });
    const canvas = document.querySelector("[data-main-slide-canvas='true']")!;
    const secondPane = document.createElement("div");
    secondPane.className = "slide-content";
    canvas.append(secondPane);

    const overlay = await waitFor(() => {
      const element = document.querySelector("[data-slide-comment-overlay]");
      expect(element).toBeTruthy();
      return element!;
    });

    expect(overlay.getAttribute("style")).toContain("width: 400px");
    expect(overlay.getAttribute("style")).toContain("height: 200px");
  });

  it("keeps an anchored marker attached as its object moves", async () => {
    let objectRect = {
      bottom: 180,
      height: 80,
      left: 200,
      right: 300,
      top: 100,
      width: 100,
      x: 200,
      y: 100,
    };
    const comment = {
      threadId: "thread-1",
      quotedText: null,
      anchor: {
        x: 10,
        y: 20,
        objectId: "chart-1",
        objectX: 50,
        objectY: 50,
      },
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
          anchor: {
            x: 10,
            y: 20,
            objectId: "chart-1",
            objectX: 50,
            objectY: 50,
          },
          author_email: "writer@example.com",
          author_name: "Writer",
          resolved: false,
          created_at: "2026-08-27T00:00:00.000Z",
          updated_at: "2026-08-27T00:00:00.000Z",
        },
      ],
    };
    const view = renderWithCanvas({ comments: [comment] });
    const object = document.createElement("div");
    object.dataset.slideObjectId = "chart-1";
    Object.defineProperty(object, "getBoundingClientRect", {
      configurable: true,
      value: () => objectRect,
    });
    view.firstPane.append(object);
    fireEvent.resize(window);

    await waitFor(() => {
      const marker = document.querySelector<HTMLElement>(
        "[data-slide-comment-marker]",
      );
      const position = marker?.closest<HTMLElement>(
        "[data-slide-comment-marker-position]",
      );
      expect(position?.style.left).toBe("37.5%");
      expect(position?.style.top).toBe("45%");
    });

    objectRect = {
      bottom: 210,
      height: 60,
      left: 300,
      right: 420,
      top: 150,
      width: 120,
      x: 300,
      y: 150,
    };
    fireEvent.resize(window);

    await waitFor(() => {
      const marker = document.querySelector<HTMLElement>(
        "[data-slide-comment-marker]",
      );
      const position = marker?.closest<HTMLElement>(
        "[data-slide-comment-marker-position]",
      );
      expect(position?.style.left).toBe("65%");
      expect(position?.style.top).toBe("65%");
    });
  });

  it("restores canvas focus after the pin plane is pressed", async () => {
    renderWithCanvas({ active: true });
    const canvas = document.querySelector<HTMLElement>(
      "[data-main-slide-canvas='true']",
    )!;
    const plane = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        "[data-slide-comment-click-plane]",
      );
      expect(element).toBeTruthy();
      return element!;
    });

    fireEvent.pointerDown(plane, { clientX: 300, clientY: 150 });
    expect(document.activeElement).toBe(canvas);
  });

  it("clears a pending pin draft when the slide changes", async () => {
    const view = renderWithCanvas({ active: true });
    const plane = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        "[data-slide-comment-click-plane]",
      );
      expect(element).toBeTruthy();
      return element!;
    });

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    expect(screen.getByPlaceholderText("Add a comment...")).toBeTruthy();

    view.rerender(
      <SlideCommentPins
        active
        canComment
        comments={[]}
        deckId="deck-1"
        slideId="slide-2"
        canvasSelector="[data-main-slide-canvas='true']"
      />,
    );

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Add a comment...")).toBeNull(),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
