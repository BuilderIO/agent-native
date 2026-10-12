import type { ReviewComment } from "@agent-native/core/review";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewThreadsSidebar } from "./ReviewThreadsSidebar";

const markUnread = vi.fn();
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { count?: number }) =>
    key === "review.screenNumber" ? `Screen ${values?.count}` : key,
  useFormatters: () => ({
    formatDate: (value: Date) => value.toISOString(),
    formatNumber: (value: number) => String(value),
    formatRelativeTime: (value: number, unit: string) => `${value} ${unit}`,
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/review", () => ({
  useSetReviewThreadUnread: () => ({
    mutate: (...args: unknown[]) => markUnread(...args),
  }),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const reviewComment = {
  id: "comment-1",
  resourceType: "design",
  resourceId: "design-1",
  threadId: "thread-1",
  parentCommentId: null,
  targetId: "screen-1",
  kind: "comment",
  status: "open",
  anchor: {},
  body: "Update the layout grid",
  authorEmail: "ada@example.com",
  authorName: "Ada Lovelace",
  createdBy: "human",
  resolutionTarget: null,
  mentions: [],
  ownerEmail: null,
  orgId: null,
  visibility: "private",
  resolvedBy: null,
  resolvedAt: null,
  consumedAt: null,
  deletedBy: null,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  metadata: null,
} as ReviewComment;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  markUnread.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  document.body.replaceChildren();
});

describe("ReviewThreadsSidebar", () => {
  it("groups a thread by screen, marks it read, and selects it", async () => {
    const onSelectThread = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <ReviewThreadsSidebar
          comments={[reviewComment]}
          screens={[
            {
              id: "screen-1",
              filename: "home.html",
              content: "",
              updatedAt: new Date().toISOString(),
              heightPinned: false,
            },
          ]}
          canvasFrameGeometryById={{}}
          loading={false}
          error={false}
          threadPreferences={{ "thread-1": { muted: false, unread: true } }}
          canSetThreadPreferences
          onSelectThread={onSelectThread}
        />,
      );
    });

    expect(container.textContent).toContain("Screen 1/Home");
    const threadButton = container.querySelector<HTMLButtonElement>(
      'button[data-review-thread-summary="thread-1"]',
    );
    expect(threadButton?.textContent).toContain("Update the layout grid");
    if (!threadButton) throw new Error("Thread summary did not render");

    await act(async () => threadButton.click());

    expect(markUnread).toHaveBeenCalledWith(
      {
        resourceType: "design",
        resourceId: "design-1",
        threadId: "thread-1",
        unread: false,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(onSelectThread).toHaveBeenCalledWith({
      root: reviewComment,
      replies: [],
    });
  });

  it("shows the empty state when there are no open threads", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <ReviewThreadsSidebar
          comments={[]}
          screens={[]}
          canvasFrameGeometryById={{}}
          loading={false}
          error={false}
          threadPreferences={{}}
          canSetThreadPreferences={false}
          onSelectThread={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("review.emptyThreads");
  });

  it("filters thread summaries by body text", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <ReviewThreadsSidebar
          comments={[reviewComment]}
          screens={[]}
          canvasFrameGeometryById={{}}
          loading={false}
          error={false}
          threadPreferences={{}}
          canSetThreadPreferences={false}
          onSelectThread={vi.fn()}
        />,
      );
    });

    const searchButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="review.search"]',
    );
    if (!searchButton) throw new Error("Search button did not render");
    await act(async () => searchButton.click());

    const searchInput = container.querySelector<HTMLInputElement>("input");
    if (!searchInput) throw new Error("Search input did not render");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(searchInput, "missing text");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("review.noThreadsFound");
    expect(container.querySelector("[data-review-thread-summary]")).toBeNull();
  });

  it("groups a board pin under the screen frame containing its world point", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const boardThread = {
      ...reviewComment,
      targetId: null,
      anchor: {
        point: { xPct: 10, yPct: 10 },
        worldPoint: { x: 1500, y: 300 },
      },
    } as ReviewComment;
    const screen = (id: string, filename: string) => ({
      id,
      filename,
      content: "",
      updatedAt: new Date().toISOString(),
      heightPinned: false,
    });

    await act(async () => {
      root!.render(
        <ReviewThreadsSidebar
          comments={[boardThread]}
          screens={[
            screen("screen-1", "home.html"),
            screen("screen-2", "docs.html"),
          ]}
          canvasFrameGeometryById={{
            "screen-1": { x: 0, y: 0, width: 1280, height: 800 },
            "screen-2": { x: 1400, y: 0, width: 1280, height: 800 },
          }}
          loading={false}
          error={false}
          threadPreferences={{}}
          canSetThreadPreferences={false}
          onSelectThread={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Screen 2/Docs");
    expect(container.textContent).not.toContain("review.designBoard");
  });
});
