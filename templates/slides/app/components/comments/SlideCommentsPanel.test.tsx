// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-slide-comments";
import {
  subscribeSlideCommentRequests,
  takeSlideCommentRequest,
  type SlideCommentRequest,
} from "@/lib/slide-comment-requests";

const mocks = vi.hoisted(() => ({
  comments: [] as ReviewComment[],
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  setClientAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/review/use-review", () => ({
  useReviewComments: () => ({
    data: {
      comments: mocks.comments,
      discussion: {
        reactions: {},
        threadPreferences: {},
        canReact: true,
        canSetThreadPreferences: true,
      },
    },
    isLoading: false,
    isError: false,
  }),
  useSetReviewThreadUnread: () => ({ isPending: false, mutate: vi.fn() }),
  useSetReviewThreadsUnread: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-slide-comments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-slide-comments")>()),
  useSlideComments: () => ({ discussion: undefined }),
}));

vi.mock("@/hooks/use-slide-review-surface", () => ({
  useSlideReviewSurface: () => ({
    peopleMentionOptions: [],
    agent: { mentionOptions: [], startIfTagged: vi.fn() },
  }),
}));

// The thread card is covered on its own; here it only has to say which
// thread opened under its row.
vi.mock("./SlideReviewThreadCard", () => ({
  SlideReviewThreadCard: ({ thread }: { thread: CommentThread }) => (
    <article>card {thread.review.root.body}</article>
  ),
}));

import { SlideCommentsPanel } from "./SlideCommentsPanel";

function comment(
  id: string,
  slideId: string | null,
  overrides: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: id,
    parentCommentId: null,
    targetId: slideId,
    kind: "comment",
    status: "open",
    anchor: slideId
      ? { kind: "slide", slideId, point: { x: 10, y: 10 } }
      : null,
    body: `Body ${id}`,
    authorEmail: "alice@example.com",
    authorName: "Alice",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    metadata: null,
    ...overrides,
  };
}

const baseProps = {
  deckId: "deck-1",
  slideId: "slide-1",
  slideIds: ["slide-1", "slide-2"],
  canComment: true,
  canEdit: true,
  currentUserEmail: "me@example.com",
  pendingComment: null,
  onPendingDone: vi.fn(),
  onClose: vi.fn(),
};

let requests: SlideCommentRequest[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  mocks.comments = [];
  requests = [];
  unsubscribe = subscribeSlideCommentRequests(() => {
    for (const slideId of ["slide-1", "slide-2"]) {
      const request = takeSlideCommentRequest(slideId);
      if (request) requests.push(request);
    }
  });
});

afterEach(() => {
  unsubscribe();
  cleanup();
  vi.clearAllMocks();
});

// oracle-change: the panel is now the shared one-line thread list; thread editing, reactions and replies moved to the toolkit card and its tests.
describe("SlideCommentsPanel", () => {
  it("lists threads under their slide in deck order, a removed slide's threads last", () => {
    mocks.comments = [
      comment("gone", "deleted-slide"),
      comment("second", "slide-2"),
      comment("first", "slide-1"),
    ];
    render(<SlideCommentsPanel {...baseProps} />);
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'comments.slideGroup {"number":1}',
      'comments.slideGroup {"number":2}',
      "comments.removedSlidesGroup",
    ]);
    expect(screen.getByText('comments.threadsCount {"count":3}')).toBeTruthy();
  });

  it("opens a pinned thread on the canvas, moving to its slide first", () => {
    mocks.comments = [comment("second", "slide-2")];
    const onSelectSlide = vi.fn();
    render(<SlideCommentsPanel {...baseProps} onSelectSlide={onSelectSlide} />);
    fireEvent.click(screen.getByText("Body second"));
    expect(onSelectSlide).toHaveBeenCalledWith("slide-2");
    expect(requests).toEqual([
      { kind: "open-thread", slideId: "slide-2", threadId: "second" },
    ]);
    expect(screen.queryByText("card Body second")).toBeNull();
  });

  it("opens a thread with no canvas pin under its row", () => {
    mocks.comments = [comment("legacy", "slide-1", { anchor: null })];
    render(<SlideCommentsPanel {...baseProps} />);
    fireEvent.click(screen.getByText("Body legacy"));
    expect(screen.getByText("card Body legacy")).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("starts a text-selection comment as a draft on the canvas", () => {
    const onPendingDone = vi.fn();
    const point = { x: 12, y: 34 };
    const { rerender } = render(
      <SlideCommentsPanel
        {...baseProps}
        onPendingDone={onPendingDone}
        pendingComment={{
          slideId: "slide-1",
          quotedText: "Q3 Revenue",
          anchor: point,
        }}
      />,
    );
    expect(requests).toEqual([
      {
        kind: "draft",
        slideId: "slide-1",
        anchor: point,
        quotedText: "Q3 Revenue",
      },
    ]);
    expect(onPendingDone).toHaveBeenCalled();

    // A shortcut with no selection has no point; the draft starts mid-slide.
    rerender(
      <SlideCommentsPanel
        {...baseProps}
        onPendingDone={onPendingDone}
        pendingComment={{ slideId: "slide-1", quotedText: "" }}
      />,
    );
    expect(requests.at(-1)).toEqual({
      kind: "draft",
      slideId: "slide-1",
      anchor: { x: 50, y: 50 },
      quotedText: undefined,
    });
  });

  it("arms the pin tool from + and closes from the header", () => {
    const onNewThread = vi.fn();
    const onClose = vi.fn();
    render(
      <SlideCommentsPanel
        {...baseProps}
        onNewThread={onNewThread}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText("comments.addComment"));
    fireEvent.click(screen.getByLabelText("comments.close"));
    expect(onNewThread).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("hides + from someone who cannot comment", () => {
    render(
      <SlideCommentsPanel
        {...baseProps}
        canComment={false}
        onNewThread={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("comments.addComment")).toBeNull();
  });
});
