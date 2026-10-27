// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import type { ReviewThread } from "@agent-native/toolkit/app/review";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatRelativeTime: (value: number, unit: string) => `${value} ${unit}`,
    formatDate: () => "date",
  }),
}));

import { ReviewThreadRow, reviewThreadPreview } from "./ReviewThreadRow";

function makeThread(overrides: Record<string, unknown> = {}): ReviewThread {
  const root = {
    id: "root",
    threadId: "thread-1",
    parentCommentId: null,
    targetId: "screen-1",
    status: "open",
    body: "Hero headline wraps on mobile",
    authorEmail: "maya@example.com",
    authorName: "Maya",
    createdBy: "human",
    createdAt: "2026-10-26T10:00:00.000Z",
    ...overrides,
  } as unknown as ReviewComment;
  return { root, replies: [] };
}

let mounted: { container: HTMLElement; unmount: () => void } | null = null;

function renderRow(props: {
  thread: ReviewThread;
  unread?: boolean;
  active?: boolean;
  onSelect?: (thread: ReviewThread) => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ReviewThreadRow
        thread={props.thread}
        unread={props.unread ?? false}
        active={props.active ?? false}
        onSelect={props.onSelect ?? vi.fn()}
      />,
    );
  });
  mounted = {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  return container;
}

describe("reviewThreadPreview", () => {
  it("reduces mention markup to @name and keeps only the first line", () => {
    expect(
      reviewThreadPreview("Hey @[Alex](mailto:alex@example.com)\nsecond line"),
    ).toBe("Hey @Alex");
  });

  it("skips leading blank lines and trims the line", () => {
    expect(reviewThreadPreview("\n   \n  Spacing check  \n")).toBe(
      "Spacing check",
    );
  });

  it("returns an empty string for an attachment-only comment", () => {
    expect(reviewThreadPreview("")).toBe("");
  });
});

describe("ReviewThreadRow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T10:00:30.000Z"));
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
  });

  it("shows the first line and the relative age", () => {
    const container = renderRow({ thread: makeThread() });

    const row = container.querySelector("[data-review-thread-row]");
    expect(row?.textContent).toContain("Hero headline wraps on mobile");
    expect(row?.querySelector("time")?.textContent).toBe("0 second");
  });

  it("marks an unread thread with a dot, bold text, and a label for screen readers", () => {
    const container = renderRow({ thread: makeThread(), unread: true });

    const row = container.querySelector<HTMLElement>(
      "[data-review-thread-row]",
    );
    expect(row?.getAttribute("data-review-thread-unread")).toBe("true");
    expect(row?.querySelector(".bg-primary")).not.toBeNull();
    expect(row?.querySelector(".sr-only")?.textContent).toBe("review.unread");
    expect(row?.querySelector("span.font-medium")?.textContent).toBe(
      "Hero headline wraps on mobile",
    );
  });

  it("dims a resolved thread", () => {
    const container = renderRow({
      thread: makeThread({ status: "resolved" }),
    });

    expect(
      container
        .querySelector("[data-review-thread-row]")
        ?.classList.contains("opacity-60"),
    ).toBe(true);
  });

  it("highlights the active row and sets aria-current on it", () => {
    const container = renderRow({ thread: makeThread(), active: true });

    const row = container.querySelector<HTMLElement>(
      "[data-review-thread-row]",
    );
    expect(row?.classList.contains("bg-secondary")).toBe(true);
    expect(row?.getAttribute("aria-current")).toBe("true");
  });

  it("passes the whole thread to onSelect when clicked", () => {
    const onSelect = vi.fn();
    const thread = makeThread();
    const container = renderRow({ thread, onSelect });

    act(() => {
      container
        .querySelector<HTMLButtonElement>("[data-review-thread-row]")
        ?.click();
    });

    expect(onSelect).toHaveBeenCalledWith(thread);
  });

  it("shows no initials for an agent author, only its mark", () => {
    const container = renderRow({
      thread: makeThread({
        createdBy: "agent",
        authorName: "Claude",
        authorEmail: null,
      }),
    });

    const avatar = container.querySelector<HTMLElement>(
      "[data-review-thread-row] > span",
    );
    expect(avatar?.textContent).toBe("");
    expect(avatar?.querySelector("svg")).not.toBeNull();
  });
});
