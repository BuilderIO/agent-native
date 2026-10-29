// @vitest-environment happy-dom
import type { ReviewComment, ReviewMention } from "@agent-native/core/review";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-slide-comments";

const mocks = vi.hoisted(() => ({
  threads: [] as unknown[],
  createComment: vi.fn(),
  startIfTagged: vi.fn(),
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

vi.mock("@agent-native/core/client/review", () => ({
  useCreateReviewComment: () => ({
    isPending: false,
    mutateAsync: mocks.createComment,
  }),
}));

// The real thread card is covered by the toolkit; here it only has to say
// which thread it is showing.
vi.mock("./SlideReviewThreadCard", () => ({
  SlideReviewThreadCard: ({ thread }: { thread: CommentThread }) => (
    <article>{thread.review.root.body}</article>
  ),
}));

// A plain stand-in for the rich composer: a text field, a button that adds a
// chip, and the submit button.
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
    mentions = [],
    onMentionsChange,
    mentionOptions = [],
  }: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (target: "human") => void;
    mentions?: ReviewMention[];
    onMentionsChange?: (mentions: ReviewMention[]) => void;
    mentionOptions?: ReviewMention[];
  }) => (
    <div>
      <textarea
        aria-label="composer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {mentionOptions.map((option) => (
        <button
          key={option.id ?? option.email ?? option.label}
          type="button"
          onClick={() => onMentionsChange?.([...mentions, option])}
        >
          mention {option.label}
        </button>
      ))}
      <button type="button" onClick={() => onSubmit("human")}>
        submit
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: (
    _deckId: string | null,
    slideId: string | null,
    scope: "slide" | "deck" = "slide",
  ) => ({
    data: (mocks.threads as CommentThread[]).filter(
      (thread) => scope === "deck" || thread.slideId === slideId,
    ),
    discussion: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-slide-review-surface", () => ({
  useSlideReviewSurface: () => ({
    peopleMentionOptions: [{ label: "Sam", email: "sam@example.com" }],
    agent: {
      mentionOptions: [{ label: "Claude", id: "agent:anthropic:claude" }],
      startIfTagged: mocks.startIfTagged,
    },
  }),
}));

import { groupThreadsBySlide, SlideCommentsPanel } from "./SlideCommentsPanel";

function root(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: "c1",
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: "c1",
    parentCommentId: null,
    targetId: "slide-1",
    kind: "comment",
    status: "open",
    anchor: null,
    body: "Body",
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

function thread(
  id: string,
  slideId: string | null,
  overrides: Partial<ReviewComment> = {},
): CommentThread {
  const comment = root({ id, threadId: id, targetId: slideId, ...overrides });
  return {
    threadId: id,
    slideId,
    quotedText: null,
    anchor: null,
    resolved: comment.status === "resolved",
    review: { root: comment, replies: [] },
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

beforeEach(() => {
  mocks.threads = [];
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
});

// oracle-change: the panel now lists core review threads; editing, reactions and reply cases are covered by the toolkit thread card.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("groupThreadsBySlide", () => {
  it("orders groups by the deck's current slide order and keeps orphaned threads last", () => {
    const groups = groupThreadsBySlide(
      [
        thread("on-a", "slide-a"),
        thread("orphan", "deleted-slide"),
        thread("on-b", "slide-b"),
      ],
      ["slide-b", "slide-a"],
    );
    expect(
      groups.map((group) => [
        group.slideNumber,
        group.threads.map((entry) => entry.threadId),
      ]),
    ).toEqual([
      [1, ["on-b"]],
      [2, ["on-a"]],
      [null, ["orphan"]],
    ]);
  });
});

describe("SlideCommentsPanel", () => {
  it("shows this slide's open threads, and resolved ones on request", () => {
    mocks.threads = [
      thread("open", "slide-1", { body: "Open on this slide" }),
      thread("done", "slide-1", { body: "Resolved one", status: "resolved" }),
      thread("other", "slide-2", { body: "On slide 2" }),
    ];
    render(<SlideCommentsPanel {...baseProps} />);
    expect(screen.getByText("Open on this slide")).toBeTruthy();
    expect(screen.queryByText("Resolved one")).toBeNull();
    expect(screen.queryByText("On slide 2")).toBeNull();

    fireEvent.click(screen.getByText('comments.showResolved {"count":1}'));
    expect(screen.getByText("Resolved one")).toBeTruthy();
  });

  it("filters For you to threads that mention you or that you are in with someone else", () => {
    window.localStorage.setItem("slides:comments-filters-expanded", "true");
    mocks.threads = [
      thread("mention", "slide-1", {
        body: "Mentions me",
        mentions: [{ label: "Me", email: "ME@example.com" }],
      }),
      thread("unrelated", "slide-1", { body: "Not for me" }),
    ];
    render(<SlideCommentsPanel {...baseProps} />);
    fireEvent.click(screen.getByText("comments.forYou"));
    expect(screen.getByText("Mentions me")).toBeTruthy();
    expect(screen.queryByText("Not for me")).toBeNull();
  });

  it("groups all slides' threads under their slide number", () => {
    window.localStorage.setItem("slides:comments-filters-expanded", "true");
    mocks.threads = [
      thread("second", "slide-2", { body: "Second slide note" }),
      thread("first", "slide-1", { body: "First slide note" }),
    ];
    render(<SlideCommentsPanel {...baseProps} />);
    fireEvent.click(screen.getByText("comments.allComments"));
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      'comments.slideGroup {"number":1}',
      'comments.slideGroup {"number":2}',
    ]);
  });

  it("posts a text-selection comment on the slide and hands an agent chip to the agent", async () => {
    mocks.createComment.mockResolvedValue({ id: "new", threadId: "new" });
    mocks.startIfTagged.mockResolvedValue("started");
    const point = { x: 12, y: 34, objectId: "title", objectX: 1, objectY: 2 };
    const onPendingDone = vi.fn();
    render(
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
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "Shorter please" },
    });
    fireEvent.click(screen.getByText("mention Claude"));
    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => expect(mocks.startIfTagged).toHaveBeenCalled());
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "deck",
        resourceId: "deck-1",
        targetId: "slide-1",
        body: "Shorter please",
        anchor: {
          kind: "slide",
          slideId: "slide-1",
          quotedText: "Q3 Revenue",
          point,
        },
        mentions: [{ label: "Claude", id: "agent:anthropic:claude" }],
      }),
    );
    expect(mocks.startIfTagged).toHaveBeenCalledWith({
      threadId: "new",
      commentId: "new",
      mentions: [{ label: "Claude", id: "agent:anthropic:claude" }],
    });
    expect(onPendingDone).toHaveBeenCalled();
  });

  it("offers commenters people to mention but no agent", () => {
    render(
      <SlideCommentsPanel
        {...baseProps}
        canEdit={false}
        pendingComment={{ slideId: "slide-1", quotedText: "" }}
      />,
    );
    expect(screen.getByText("mention Sam")).toBeTruthy();
    expect(screen.queryByText("mention Claude")).toBeNull();
  });
});
