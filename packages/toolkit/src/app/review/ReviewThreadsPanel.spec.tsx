// @vitest-environment happy-dom

import type { ReviewComment } from "@agent-native/core/review/types";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  comments: [] as ReviewComment[],
  unread: {} as Record<string, { muted: boolean; unread: boolean }>,
  setUnread: vi.fn(),
}));

vi.mock("@agent-native/core/client/review/use-review", () => ({
  useReviewComments: () => ({
    data: {
      comments: mocks.comments,
      discussion: {
        reactions: {},
        threadPreferences: mocks.unread,
        canReact: true,
        canSetThreadPreferences: true,
      },
    },
    isLoading: false,
    isError: false,
  }),
  useSetReviewThreadUnread: () => ({
    isPending: false,
    mutate: mocks.setUnread,
  }),
  useSetReviewThreadsUnread: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { ReviewPinBadge } from "./ReviewPinBadge.js";
import { reviewThreadPreview } from "./ReviewThreadRow.js";
import {
  groupReviewThreadsByTarget,
  ReviewThreadsPanel,
  type ReviewThreadsPanelLabels,
} from "./ReviewThreadsPanel.js";

function comment(
  id: string,
  targetId: string | null,
  overrides: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: id,
    parentCommentId: null,
    targetId,
    kind: "comment",
    status: "open",
    anchor: null,
    body: `Body ${id}`,
    authorEmail: "alice@example.com",
    authorName: "Alice",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    ownerEmail: null,
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

const labels: ReviewThreadsPanelLabels = {
  threadsCount: (count) => `${count} threads`,
  search: "Search",
  filter: "Filter",
  filtersActive: "Filters applied",
  showResolved: "Show resolved",
  onlyYours: "Only yours",
  currentTarget: "This slide",
  sort: "Sort",
  sortByDate: "By date",
  sortByUnread: "By unread",
  markAllRead: "Mark all read",
  newThread: "New thread",
  loading: "Loading",
  emptyState: "No comments",
  error: "Error",
  ungrouped: "Elsewhere",
  reviewer: "Reviewer",
  agent: "Agent",
  unread: "Unread",
  resolved: "Resolved",
};

describe("groupReviewThreadsByTarget", () => {
  it("follows target order, drops empty targets, and puts unknown targets last", () => {
    const thread = (id: string, target: string | null) => ({
      root: comment(id, target),
      replies: [],
    });
    const groups = groupReviewThreadsByTarget(
      [thread("a", "t2"), thread("b", "gone"), thread("c", "t1")],
      [
        { id: "t1", name: "One" },
        { id: "t2", name: "Two" },
        { id: "t3", name: "Three" },
      ],
    );
    expect(
      groups.map((group) => [
        group.target?.name ?? null,
        group.threads.map((entry) => entry.root.id),
      ]),
    ).toEqual([
      ["One", ["c"]],
      ["Two", ["a"]],
      [null, ["b"]],
    ]);
  });
});

describe("reviewThreadPreview", () => {
  it("is the first non-empty line, with mentions as @name", () => {
    expect(
      reviewThreadPreview("\n  Ask @[Sam](mailto:sam@example.com) \nmore"),
    ).toBe("Ask @Sam");
  });
});

describe("ReviewThreadsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.comments = [];
    mocks.unread = {};
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const render = (element: ReactElement) => act(() => root.render(element));
  const rows = () =>
    Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-review-thread-row]"),
    );

  it("hides resolved threads, marks a thread read when opened, and shows the active one's detail", () => {
    mocks.comments = [
      comment("open", "t1"),
      comment("done", "t1", { status: "resolved" }),
    ];
    mocks.unread = { open: { muted: false, unread: true } };
    const onSelect = vi.fn();
    const props = {
      query: { resourceType: "deck", resourceId: "deck-1" },
      canComment: true,
      targets: [{ id: "t1", name: "Slide 1" }],
      labels,
      onSelectThread: onSelect,
      renderActiveThread: (thread: { root: ReviewComment }) => (
        <p data-detail>{thread.root.id}</p>
      ),
    };
    render(<ReviewThreadsPanel {...props} />);
    expect(rows().map((row) => row.dataset.reviewThreadId)).toEqual(["open"]);
    expect(rows()[0]?.dataset.reviewThreadUnread).toBe("true");

    act(() => rows()[0]?.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(mocks.setUnread).toHaveBeenCalledWith(
      {
        resourceType: "deck",
        resourceId: "deck-1",
        threadId: "open",
        unread: false,
      },
      undefined,
    );

    render(<ReviewThreadsPanel {...props} activeThreadId="done" />);
    // The active thread shows even when resolved threads are filtered out.
    expect(rows().map((row) => row.dataset.reviewThreadId)).toEqual([
      "open",
      "done",
    ]);
    expect(container.querySelector("[data-detail]")?.textContent).toBe("done");
  });
});

describe("ReviewPinBadge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows each author once and the thread's count", () => {
    act(() =>
      root.render(
        <ReviewPinBadge
          ariaLabel="Open thread"
          authors={[
            { name: "Alice", email: "alice@example.com" },
            { name: "Alice", email: "ALICE@example.com" },
            { name: "Bob", email: "bob@example.com" },
          ]}
          count={3}
        />,
      ),
    );
    expect(container.textContent).toBe("AB3");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Open thread",
    );
  });
});
