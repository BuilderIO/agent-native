// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import type { ReviewThread } from "@agent-native/toolkit/app/review";
import { act } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  unreadMutate: vi.fn(),
  bulkUnreadMutate: vi.fn(),
  reviewState: {
    data: undefined as
      | {
          comments: ReviewComment[];
          discussion: {
            threadPreferences: Record<string, { unread?: boolean }>;
            canSetThreadPreferences: boolean;
          };
        }
      | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@agent-native/core/client/review", () => ({
  useSetReviewThreadUnread: () => ({
    mutate: mocks.unreadMutate,
    isPending: false,
  }),
  useSetReviewThreadsUnread: () => ({
    mutate: mocks.bulkUnreadMutate,
    isPending: false,
  }),
  useReviewComments: () => mocks.reviewState,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
  useFormatters: () => ({
    formatRelativeTime: (value: number, unit: string) => `${value} ${unit}`,
    formatDate: () => "date",
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" {...props}>
        {children}
      </button>
    ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement> & { size?: string }) => (
    <input {...props} size={undefined} />
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <span data-skeleton="" />,
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  );
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuLabel: passthrough,
    DropdownMenuRadioGroup: passthrough,
    DropdownMenuRadioItem: passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      onCheckedChange,
      disabled,
    }: {
      children?: ReactNode;
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
      disabled?: boolean;
    }) => (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
      >
        {children}
      </button>
    ),
    DropdownMenuItem: ({
      children,
      onSelect,
    }: {
      children?: ReactNode;
      onSelect?: () => void;
    }) => (
      <button type="button" role="menuitem" onClick={() => onSelect?.()}>
        {children}
      </button>
    ),
  };
});

import {
  compareReviewThreads,
  getUnreadReviewThreadIds,
  groupReviewThreadsByScreen,
  ReviewCommentsPanel,
  type ReviewCommentsPanelProps,
} from "./ReviewCommentsPanel";

const SCREENS: ReviewCommentsPanelProps["screens"] = [
  { id: "screen-1", name: "Screen 1", route: "/home" },
  { id: "screen-2", name: "Screen 2", route: null },
];

function makeComment(overrides: Record<string, unknown>): ReviewComment {
  return {
    id: "comment",
    resourceType: "design",
    resourceId: "design-1",
    threadId: "thread",
    parentCommentId: null,
    targetId: null,
    status: "open",
    body: "Comment body",
    authorEmail: "other@example.com",
    authorName: "Other",
    createdBy: "human",
    createdAt: "2026-10-25T10:00:00.000Z",
    ...overrides,
  } as unknown as ReviewComment;
}

function makeRoot(
  threadId: string,
  overrides: Record<string, unknown> = {},
): ReviewComment {
  return makeComment({ id: `${threadId}-root`, threadId, ...overrides });
}

function makeThread(root: ReviewComment): ReviewThread {
  return { root, replies: [] };
}

function setComments(
  comments: ReviewComment[],
  unreadThreadIds: string[] = [],
) {
  mocks.reviewState.data = {
    comments,
    discussion: {
      threadPreferences: Object.fromEntries(
        unreadThreadIds.map((threadId) => [threadId, { unread: true }]),
      ),
      canSetThreadPreferences: true,
    },
  };
}

const FIXTURE = [
  makeRoot("t-hero", {
    targetId: "screen-1",
    body: "Hero headline wraps",
    createdAt: "2026-10-26T10:00:00.000Z",
  }),
  makeRoot("t-copy", {
    targetId: "screen-1",
    body: "Copy button needs a hover state",
    authorEmail: "me@example.com",
    authorName: "Me",
    createdAt: "2026-10-25T10:00:00.000Z",
  }),
  makeRoot("t-docs", {
    targetId: "screen-2",
    body: "Docs title should match",
    createdAt: "2026-10-24T10:00:00.000Z",
  }),
  makeRoot("t-board", {
    targetId: null,
    body: "Board wide question",
    createdAt: "2026-10-23T10:00:00.000Z",
  }),
  makeRoot("t-old", {
    targetId: "screen-2",
    body: "Already fixed",
    status: "resolved",
    createdAt: "2026-10-22T10:00:00.000Z",
  }),
];

let mounted: { container: HTMLElement; root: Root } | null = null;

function renderPanel(props: Partial<ReviewCommentsPanelProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  act(() => {
    root.render(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        screens={SCREENS}
        {...props}
      />,
    );
  });
  return container;
}

function rowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-review-thread-row]")].map(
    (row) => row.getAttribute("data-review-thread-id") ?? "",
  );
}

function clickButton(container: HTMLElement, selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  act(() => element.click());
}

function clickMenuItem(container: HTMLElement, label: string) {
  const item = [
    ...container.querySelectorAll<HTMLElement>(
      "[role=menuitemcheckbox], [role=menuitem]",
    ),
  ].find((candidate) => candidate.textContent === label);
  if (!item) throw new Error(`Missing menu item ${label}`);
  act(() => item.click());
}

describe("ReviewCommentsPanel", () => {
  beforeEach(() => {
    mocks.unreadMutate.mockReset();
    mocks.bulkUnreadMutate.mockReset();
    mocks.reviewState.isLoading = false;
    mocks.reviewState.isError = false;
    setComments(FIXTURE);
  });

  afterEach(() => {
    if (!mounted) return;
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  });

  it("lists threads as rows, not expanded articles", () => {
    const container = renderPanel();

    expect(
      container.querySelector("[data-review-comments-panel]"),
    ).not.toBeNull();
    expect(container.querySelector("article")).toBeNull();
    expect(rowIds(container)).toEqual([
      "t-hero",
      "t-copy",
      "t-docs",
      "t-board",
    ]);
  });

  it("groups rows by screen in canvas order, board last, and shows routes only for localhost screens", () => {
    const container = renderPanel({
      screens: [
        { id: "screen-2", name: "Screen 2", route: null },
        { id: "screen-1", name: "Screen 1", route: "/home" },
      ],
    });

    const groups = [...container.querySelectorAll("[role=group]")];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Screen 2",
      "Screen 1",
      "review.boardGroup",
    ]);
    const screen1 = groups[1];
    expect(
      screen1?.querySelector("span.text-muted-foreground")?.textContent,
    ).toBe("/home");
    expect(groups[0]?.textContent).toContain("Screen 2");
    expect(groups[0]?.textContent).not.toContain("/home");
    expect(groups[2]?.textContent).toContain("Board wide question");
  });

  it("sends threads with an unknown target to the board group", () => {
    setComments([
      makeRoot("t-gone", { targetId: "deleted-screen", body: "Stale target" }),
    ]);
    const container = renderPanel();

    const groups = [...container.querySelectorAll("[role=group]")];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "review.boardGroup",
    ]);
    expect(rowIds(container)).toEqual(["t-gone"]);
  });

  it("shows the count of visible threads and leaves resolved ones out until asked", () => {
    const container = renderPanel();

    expect(container.textContent).toContain("review.threadsCount:4");

    clickButton(container, '[aria-label="review.filter"]');
    clickMenuItem(container, "review.showResolved");

    expect(container.textContent).toContain("review.threadsCount:5");
    expect(rowIds(container)).toContain("t-old");
  });

  it("dims resolved rows", () => {
    const container = renderPanel();
    clickButton(container, '[aria-label="review.filter"]');
    clickMenuItem(container, "review.showResolved");

    const resolvedRow = container.querySelector<HTMLElement>(
      '[data-review-thread-id="t-old"]',
    );
    expect(resolvedRow?.classList.contains("opacity-60")).toBe(true);
    const openRow = container.querySelector<HTMLElement>(
      '[data-review-thread-id="t-hero"]',
    );
    expect(openRow?.classList.contains("opacity-60")).toBe(false);
  });

  it("filters rows by the search input and restores them on Escape", () => {
    const container = renderPanel();

    clickButton(container, '[aria-label="review.search"]');
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    act(() => {
      if (!input) return;
      // React tracks the value through its own setter, so write through the
      // prototype's setter for the change to reach onChange.
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "hero");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rowIds(container)).toEqual(["t-hero"]);
    expect(container.textContent).toContain("review.threadsCount:1");

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector("input")).toBeNull();
    expect(rowIds(container)).toHaveLength(4);
  });

  it("calls the focus handler with the thread when a row is clicked", () => {
    const onSelectThread = vi.fn();
    const container = renderPanel({ onSelectThread });

    clickButton(container, '[data-review-thread-id="t-docs"]');

    expect(onSelectThread).toHaveBeenCalledTimes(1);
    expect(onSelectThread.mock.calls[0]?.[0]).toMatchObject({
      root: { threadId: "t-docs" },
    });
  });

  it("marks the active row and leaves the others plain", () => {
    const container = renderPanel({ activeThreadId: "t-copy" });

    const active = container.querySelector<HTMLElement>(
      '[data-review-thread-id="t-copy"]',
    );
    expect(active?.classList.contains("bg-secondary")).toBe(true);
    expect(active?.getAttribute("aria-current")).toBe("true");
    const other = container.querySelector<HTMLElement>(
      '[data-review-thread-id="t-hero"]',
    );
    expect(other?.classList.contains("bg-secondary")).toBe(false);
    expect(other?.getAttribute("aria-current")).toBeNull();
  });

  it("marks an unread thread read when its row is selected", () => {
    setComments(FIXTURE, ["t-hero"]);
    const onSelectThread = vi.fn();
    const container = renderPanel({ onSelectThread });

    clickButton(container, '[data-review-thread-id="t-hero"]');

    expect(mocks.unreadMutate).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "t-hero", unread: false }),
      expect.any(Object),
    );
    expect(onSelectThread).toHaveBeenCalledTimes(1);
  });

  it("marks all unread threads with one bulk mutation from the filter menu", () => {
    setComments(FIXTURE, ["t-hero", "t-docs"]);
    const container = renderPanel();

    clickButton(container, '[aria-label="review.filter"]');
    clickMenuItem(container, "review.markAllRead");

    expect(mocks.bulkUnreadMutate).toHaveBeenCalledTimes(1);
    expect(mocks.bulkUnreadMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "design",
        resourceId: "design-1",
        threadIds: expect.arrayContaining(["t-hero", "t-docs"]),
        unread: false,
      }),
      expect.any(Object),
    );
    expect(mocks.unreadMutate).not.toHaveBeenCalled();
  });

  it("hides mark-all-read when nothing is unread", () => {
    const container = renderPanel();

    clickButton(container, '[aria-label="review.filter"]');

    expect(container.textContent).not.toContain("review.markAllRead");
  });

  it("only shows the New thread button when the caller can start a thread", () => {
    const withoutHandler = renderPanel();
    expect(
      withoutHandler.querySelector('[aria-label="review.newThread"]'),
    ).toBeNull();
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;

    const onNewThread = vi.fn();
    const container = renderPanel({ onNewThread });
    clickButton(container, '[aria-label="review.newThread"]');
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("disables New thread for a viewer who cannot comment", () => {
    const container = renderPanel({
      canComment: false,
      onNewThread: vi.fn(),
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="review.newThread"]',
    );
    expect(button?.disabled).toBe(true);
  });

  it("shows the empty state when there are no threads", () => {
    setComments([]);
    const container = renderPanel();

    expect(container.querySelector("[data-review-thread-row]")).toBeNull();
    expect(container.textContent).toContain("review.emptyState");
  });

  it("shows a skeleton with no count while loading", () => {
    mocks.reviewState.data = undefined;
    mocks.reviewState.isLoading = true;
    const container = renderPanel();

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
    expect(container.textContent).not.toContain("review.threadsCount");
    expect(container.textContent).not.toContain("review.emptyState");
  });

  it("reports a failed load instead of the empty state", () => {
    mocks.reviewState.data = undefined;
    mocks.reviewState.isError = true;
    const container = renderPanel();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "common.genericError",
    );
    expect(container.textContent).not.toContain("review.emptyState");
  });

  it("does not ask a signed-in viewer to sign in to comment", () => {
    const markup = renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment={false}
        currentUserEmail="viewer@example.com"
        screens={[]}
        signInHref="/sign-in"
      />,
    );

    expect(markup).not.toContain("review.signInToComment");
  });

  it("offers sign-in to anonymous viewers who cannot comment", () => {
    const markup = renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment={false}
        screens={[]}
        signInHref="/sign-in"
      />,
    );

    expect(markup).toContain("review.signInToComment");
  });

  it("filters to the current page's screen", () => {
    const container = renderPanel({ currentTargetId: "screen-2" });
    clickButton(container, '[aria-label="review.filter"]');
    clickMenuItem(container, "review.currentPage");

    expect(rowIds(container)).toEqual(["t-docs"]);
  });

  it("treats a null current target as the board", () => {
    const container = renderPanel({ currentTargetId: null });
    clickButton(container, '[aria-label="review.filter"]');
    clickMenuItem(container, "review.currentPage");

    expect(rowIds(container)).toEqual(["t-board"]);
  });

  it("filters to the signed-in viewer's threads", () => {
    const container = renderPanel({ currentUserEmail: "ME@example.com" });
    clickButton(container, '[aria-label="review.filter"]');
    clickMenuItem(container, "review.onlyYours");

    expect(rowIds(container)).toEqual(["t-copy"]);
  });

  it("keeps the comparator's unread-first and date ordering", () => {
    const comments = [
      { threadId: "unread", parentCommentId: null },
      { threadId: "reply-only", parentCommentId: "root" },
    ] as ReviewComment[];
    const preferences = {
      unread: { muted: false, unread: true },
      "reply-only": { muted: false, unread: true },
    };
    expect(getUnreadReviewThreadIds(comments, preferences)).toEqual(
      new Set(["unread"]),
    );
    const makeDated = (threadId: string, createdAt: string) =>
      makeThread(makeRoot(threadId, { createdAt }));
    expect(
      compareReviewThreads(
        makeDated("unread", "2026-01-01T00:00:00.000Z"),
        makeDated("read", "2026-02-01T00:00:00.000Z"),
        "unread",
        preferences,
      ),
    ).toBeLessThan(0);
    expect(
      compareReviewThreads(
        makeDated("old", "2026-01-01T00:00:00.000Z"),
        makeDated("new", "2026-02-01T00:00:00.000Z"),
        "date",
        preferences,
      ),
    ).toBeGreaterThan(0);
  });

  it("groups pure thread lists without dropping board threads", () => {
    const groups = groupReviewThreadsByScreen(
      [
        makeThread(makeRoot("a", { targetId: "screen-2" })),
        makeThread(makeRoot("b", { targetId: null })),
        makeThread(makeRoot("c", { targetId: "screen-1" })),
      ],
      SCREENS,
    );

    expect(groups.map((group) => group.screen?.id ?? null)).toEqual([
      "screen-1",
      "screen-2",
      null,
    ]);
  });
});
