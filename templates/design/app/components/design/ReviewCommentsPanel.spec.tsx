// @vitest-environment happy-dom

import type { ReviewThread } from "@agent-native/core/client/review";
import type { ReviewComment } from "@agent-native/core/review";
import { act } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  latestPanelProps: null as Record<string, unknown> | null,
  unreadMutate: vi.fn(),
  bulkUnreadMutate: vi.fn(),
  resolveMutate: vi.fn(),
  reviewState: {
    data: {
      comments: [] as ReviewComment[],
      discussion: {
        threadPreferences: {},
        canSetThreadPreferences: true,
      },
    },
  },
}));

vi.mock("@agent-native/core/client/review", () => ({
  ReviewThreadPanel: (props: Record<string, unknown>) => {
    mocks.latestPanelProps = props;
    return <div data-review-thread-panel />;
  },
  useSetReviewThreadUnread: () => ({
    mutate: mocks.unreadMutate,
    isPending: false,
  }),
  useSetReviewThreadsUnread: () => ({
    mutate: mocks.bulkUnreadMutate,
    isPending: false,
  }),
  useReviewComments: () => mocks.reviewState,
  useResolveReviewThread: () => ({
    mutate: mocks.resolveMutate,
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgMembers: () => ({ data: { members: [] } }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: () => null,
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
    DropdownMenuCheckboxItem: passthrough,
    DropdownMenuItem: passthrough,
  };
});

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

import {
  compareReviewThreads,
  getReviewThreadTargetFilter,
  getUnreadReviewThreadIds,
  ReviewCommentsPanel,
} from "./ReviewCommentsPanel";

describe("ReviewCommentsPanel capabilities", () => {
  beforeEach(() => {
    mocks.latestPanelProps = null;
    mocks.unreadMutate.mockReset();
    mocks.bulkUnreadMutate.mockReset();
    mocks.reviewState.data.comments = [];
    mocks.reviewState.data.discussion.threadPreferences = {};
  });

  it("keeps the sidebar design-wide and leaves comment creation to canvas pins", () => {
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        canResolve={false}
        canDispatchToAgent={false}
      />,
    );

    expect(mocks.latestPanelProps).toMatchObject({
      showComposer: false,
      showComposerTargetPicker: false,
      canResolve: false,
    });
    expect(mocks.latestPanelProps).not.toHaveProperty("targetId");
    expect(mocks.latestPanelProps?.renderThreadActions).toBeUndefined();
  });

  it("shows agent routing only when the caller grants dispatch capability", () => {
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        canResolve
        canDispatchToAgent
        onSendThreadToAgent={vi.fn()}
      />,
    );

    expect(mocks.latestPanelProps).toMatchObject({
      canResolve: true,
      showComposer: false,
      showComposerTargetPicker: false,
    });
    expect(mocks.latestPanelProps?.renderThreadActions).toBeTypeOf("function");
  });

  it("provides thread-aware filtering and leaves the page scope opt-in", () => {
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        currentUserEmail="ME@example.com"
        currentTargetId="screen-2"
      />,
    );
    const filter = mocks.latestPanelProps?.threadFilter as (thread: {
      root: { authorEmail: string };
      replies: Array<{ authorEmail: string }>;
    }) => boolean;
    expect(filter).toBeTypeOf("function");
    expect(
      filter({
        root: { authorEmail: "other@example.com" },
        replies: [{ authorEmail: "me@example.com" }],
      }),
    ).toBe(true);
    expect(mocks.latestPanelProps).not.toHaveProperty("targetId");
  });

  it("uses the nullable board target when current-page filtering is enabled", () => {
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        currentTargetId={null}
      />,
    );

    expect(getReviewThreadTargetFilter(true, null)).toEqual({ targetId: null });
    expect(getReviewThreadTargetFilter(true, "screen-2")).toEqual({
      targetId: "screen-2",
    });
    expect(getReviewThreadTargetFilter(true, undefined)).toEqual({});
    expect(getReviewThreadTargetFilter(false, null)).toEqual({});
    expect(mocks.latestPanelProps).toMatchObject({
      onSetThreadUnread: expect.any(Function),
    });
  });

  it("marks a selected unread thread as read", () => {
    mocks.reviewState.data.comments = [
      { threadId: "thread-1", parentCommentId: null } as ReviewComment,
    ];
    mocks.reviewState.data.discussion.threadPreferences = {
      "thread-1": { muted: false, unread: true },
    };
    const onSelectThread = vi.fn();
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        onSelectThread={onSelectThread}
      />,
    );

    const thread = {
      root: { threadId: "thread-1" },
      replies: [],
    } as unknown as ReviewThread;
    (mocks.latestPanelProps?.onSelectThread as (thread: ReviewThread) => void)(
      thread,
    );
    expect(mocks.unreadMutate).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", unread: false }),
      expect.any(Object),
    );
    expect(onSelectThread).toHaveBeenCalledWith(thread);
  });

  it("marks all unread threads with one bulk mutation", async () => {
    mocks.reviewState.data.comments = [
      { threadId: "thread-1", parentCommentId: null } as ReviewComment,
      { threadId: "thread-2", parentCommentId: null } as ReviewComment,
    ];
    mocks.reviewState.data.discussion.threadPreferences = {
      "thread-1": { muted: false, unread: true },
      "thread-2": { muted: false, unread: true },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<ReviewCommentsPanel designId="design-1" canComment />);
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[aria-label="review.markAllRead"]')
          ?.click();
      });
      expect(mocks.bulkUnreadMutate).toHaveBeenCalledTimes(1);
      expect(mocks.bulkUnreadMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "design",
          resourceId: "design-1",
          threadIds: expect.arrayContaining(["thread-1", "thread-2"]),
          unread: false,
        }),
        expect.any(Object),
      );
      expect(mocks.unreadMutate).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("counts root unread preferences and sorts unread threads first", () => {
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
    const makeThread = (threadId: string, createdAt: string) =>
      ({
        root: { threadId, createdAt },
        replies: [],
      }) as unknown as ReviewThread;
    expect(
      compareReviewThreads(
        makeThread("unread", "2026-01-01T00:00:00.000Z"),
        makeThread("read", "2026-02-01T00:00:00.000Z"),
        "unread",
        preferences,
      ),
    ).toBeLessThan(0);
    expect(
      compareReviewThreads(
        makeThread("old", "2026-01-01T00:00:00.000Z"),
        makeThread("new", "2026-02-01T00:00:00.000Z"),
        "date",
        preferences,
      ),
    ).toBeGreaterThan(0);
  });
});
