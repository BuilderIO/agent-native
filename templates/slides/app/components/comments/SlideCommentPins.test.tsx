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
import { createContext, useContext, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-slide-comments";

const mocks = vi.hoisted(() => ({
  createComment: vi.fn(),
  startIfTagged: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/review", () => ({
  useCreateReviewComment: () => ({
    isPending: false,
    mutateAsync: mocks.createComment,
  }),
}));

vi.mock("@agent-native/toolkit/app/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/review")
  >()),
  ReviewAuthorAvatar: () => null,
  ReviewThreadCardFrame: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  ReviewCommentComposer: ({
    value,
    onChange,
    onSubmit,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (target: "human") => void;
  }) => (
    <div>
      <textarea
        aria-label="composer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={() => onSubmit("human")}>
        submit
      </button>
    </div>
  ),
}));

vi.mock("./SlideReviewThreadCard", () => ({
  SlideReviewThreadCard: ({ thread }: { thread: CommentThread }) => (
    <article>{thread.review.root.body}</article>
  ),
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: () => ({ discussion: undefined }),
}));

vi.mock("@/hooks/use-slide-review-surface", () => ({
  useSlideReviewSurface: () => ({
    peopleMentionOptions: [],
    agent: { mentionOptions: [], startIfTagged: mocks.startIfTagged },
  }),
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
  PopoverContent: ({ children }: { children: ReactNode }) =>
    useContext(PopoverContext)?.open ? <div>{children}</div> : null,
}));

import { setSlideCommentsHidden } from "@/hooks/use-slide-comments-hidden";
import { requestSlideComment } from "@/lib/slide-comment-requests";

import { SlideCommentPins } from "./SlideCommentPins";

function rect(left: number, top: number, width: number, height: number) {
  return () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  });
}

/** A 400x200 canvas at (100, 50) with one object at (200, 100), 100x50. */
function mountCanvas() {
  const canvas = document.createElement("div");
  canvas.dataset.mainSlideCanvas = "true";
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: rect(100, 50, 400, 200),
  });
  const content = document.createElement("div");
  content.className = "slide-content";
  const object = document.createElement("h1");
  object.setAttribute("data-slide-object-id", "title");
  object.textContent = "Q3 Revenue";
  Object.defineProperty(object, "getBoundingClientRect", {
    value: rect(200, 100, 100, 50),
  });
  content.append(object);
  canvas.append(content);
  document.body.append(canvas);
  return { canvas, object };
}

function thread(
  id: string,
  overrides: Partial<CommentThread> = {},
): CommentThread {
  const root = {
    id,
    threadId: id,
    parentCommentId: null,
    body: `Thread ${id}`,
    authorEmail: "alice@example.com",
    authorName: "Alice",
    createdBy: "human",
  } as ReviewComment;
  return {
    threadId: id,
    slideId: "slide-1",
    quotedText: null,
    anchor: { x: 10, y: 10 },
    resolved: false,
    review: { root, replies: [] },
    ...overrides,
  };
}

// oracle-change: pins now render the shared review thread card; the old inline reply/resolve/delete cases moved to core and the toolkit.
const props = {
  canComment: true,
  canEdit: true,
  deckId: "deck-1",
  slideId: "slide-1",
  canvasSelector: "[data-main-slide-canvas='true']",
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  setSlideCommentsHidden(false);
});

describe("SlideCommentPins", () => {
  it("drops a pin on an object and saves it anchored to that object on this slide", async () => {
    const { object } = mountCanvas();
    document.elementsFromPoint = () => [object];
    mocks.createComment.mockResolvedValue({ id: "new", threadId: "new" });
    const { container } = render(
      <SlideCommentPins {...props} active comments={[]} />,
    );
    const plane = container.querySelector<HTMLElement>(
      "[data-slide-comment-click-plane]",
    );
    if (!plane) throw new Error("pin mode renders no click plane");
    // (250, 125) is the object's centre and the canvas's (37.5%, 37.5%).
    fireEvent.pointerDown(plane, { clientX: 250, clientY: 125 });
    fireEvent.click(plane, { clientX: 250, clientY: 125 });
    fireEvent.change(await screen.findByLabelText("composer"), {
      target: { value: "Tighten this" },
    });
    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => expect(mocks.createComment).toHaveBeenCalled());
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "deck",
        resourceId: "deck-1",
        targetId: "slide-1",
        body: "Tighten this",
        resolutionTarget: "human",
        anchor: {
          kind: "slide",
          slideId: "slide-1",
          point: {
            x: 37.5,
            y: 37.5,
            targetText: "Q3 Revenue",
            objectId: "title",
            objectX: 50,
            objectY: 50,
          },
        },
      }),
    );
    expect(mocks.startIfTagged).toHaveBeenCalledWith({
      threadId: "new",
      commentId: "new",
      mentions: [],
    });
  });

  it("places a pin by its object, so it follows the object, and hides resolved threads", () => {
    mountCanvas();
    const { container } = render(
      <SlideCommentPins
        {...props}
        active={false}
        comments={[
          thread("on-object", {
            // A stale slide-level position; the object's box wins.
            anchor: { x: 1, y: 1, objectId: "title", objectX: 50, objectY: 50 },
          }),
          thread("done", { resolved: true }),
        ]}
      />,
    );
    const markers = container.querySelectorAll<HTMLElement>(
      "[data-slide-comment-marker-position]",
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]?.style.left).toBe("37.5%");
    expect(markers[0]?.style.top).toBe("37.5%");
  });

  it("opens the thread card from its pin and tells the editor which thread", () => {
    mountCanvas();
    const onSelectThread = vi.fn();
    render(
      <SlideCommentPins
        {...props}
        active={false}
        comments={[thread("t1")]}
        onSelectThread={onSelectThread}
      />,
    );
    fireEvent.click(screen.getByLabelText("comments.openThreadBy"));
    expect(screen.getByText("Thread t1")).toBeTruthy();
    expect(onSelectThread).toHaveBeenCalledWith("t1");
  });

  it("opens a thread the panel asks for, and starts a draft at a text selection", async () => {
    mountCanvas();
    const point = { x: 20, y: 30 };
    mocks.createComment.mockResolvedValue({ id: "new", threadId: "new" });
    render(
      <SlideCommentPins {...props} active={false} comments={[thread("t1")]} />,
    );
    act(() =>
      requestSlideComment({
        kind: "open-thread",
        slideId: "slide-1",
        threadId: "t1",
      }),
    );
    expect(screen.getByText("Thread t1")).toBeTruthy();

    act(() =>
      requestSlideComment({
        kind: "draft",
        slideId: "slide-1",
        anchor: point,
        quotedText: "Q3 Revenue",
      }),
    );
    fireEvent.change(await screen.findByLabelText("composer"), {
      target: { value: "Shorter" },
    });
    fireEvent.click(screen.getByText("submit"));
    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          anchor: {
            kind: "slide",
            slideId: "slide-1",
            quotedText: "Q3 Revenue",
            point,
          },
        }),
      ),
    );
  });

  it("leaves a request for another slide waiting", () => {
    mountCanvas();
    render(
      <SlideCommentPins {...props} active={false} comments={[thread("t1")]} />,
    );
    act(() =>
      requestSlideComment({
        kind: "open-thread",
        slideId: "slide-2",
        threadId: "t9",
      }),
    );
    expect(screen.queryByText("Thread t1")).toBeNull();
  });

  it("shows no pins while comments are hidden, and Shift+C brings them back", () => {
    mountCanvas();
    const { container } = render(
      <SlideCommentPins {...props} active={false} comments={[thread("t1")]} />,
    );
    act(() => setSlideCommentsHidden(true));
    expect(
      container.querySelectorAll("[data-slide-comment-marker-position]"),
    ).toHaveLength(0);
    fireEvent.keyDown(window, { key: "C", shiftKey: true });
    expect(
      container.querySelectorAll("[data-slide-comment-marker-position]"),
    ).toHaveLength(1);
  });

  it("turns comments back on when the pin tool is picked", () => {
    mountCanvas();
    setSlideCommentsHidden(true);
    const { container } = render(
      <SlideCommentPins {...props} active comments={[thread("t1")]} />,
    );
    expect(
      container.querySelectorAll("[data-slide-comment-marker-position]"),
    ).toHaveLength(1);
  });
});
