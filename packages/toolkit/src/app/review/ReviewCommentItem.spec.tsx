// @vitest-environment happy-dom

import type { ReviewComment } from "@agent-native/core/review/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useAvatarUrl = vi.hoisted(() => vi.fn((_email: string | null) => null));

vi.mock("@agent-native/core/client/use-avatar", () => ({ useAvatarUrl }));

import {
  formatReviewCommentRelativeTime,
  ReviewCommentItem,
} from "./ReviewCommentItem.js";

const NOW = Date.parse("2026-07-13T15:31:00.000Z");

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "comment-1",
    resourceType: "design",
    resourceId: "design-1",
    threadId: "thread-1",
    parentCommentId: null,
    targetId: "screen-1",
    kind: "comment",
    status: "open",
    anchor: null,
    body: "Make the heading clearer",
    authorEmail: "maya@example.com",
    authorName: "Maya",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: new Date(NOW - 2 * 60_000).toISOString(),
    updatedAt: new Date(NOW - 2 * 60_000).toISOString(),
    metadata: null,
    ...overrides,
  };
}

describe("ReviewCommentItem", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useAvatarUrl.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(element: React.ReactElement) {
    act(() => root.render(element));
  }

  const reactButton = () =>
    container.querySelector('button[aria-label="Add reaction"]');
  const occurrences = (text: string) =>
    (container.textContent ?? "").split(text).length - 1;

  it("renders the root with a compact header and a react button", () => {
    render(
      <ReviewCommentItem
        comment={makeComment()}
        variant="root"
        showReactions
        canReact
      />,
    );
    const name = container.querySelector("span.truncate");
    expect(name?.className).toContain("font-semibold");
    expect(reactButton()).not.toBeNull();
    expect(container.querySelector("[data-review-comment-clock]")).toBeNull();
  });

  it("renders the react button and reaction chips on a root with reactions", () => {
    const onReact = vi.fn();
    render(
      <ReviewCommentItem
        comment={makeComment()}
        variant="root"
        showReactions
        canReact
        reactions={[
          { reaction: "👍", count: 1, reactedByMe: false },
          { reaction: "❤️", count: 3, reactedByMe: false },
        ]}
        onReact={onReact}
      />,
    );
    expect(reactButton()).not.toBeNull();
    const chip = container.querySelector<HTMLButtonElement>(
      'button[aria-label="👍 1"]',
    );
    expect(chip?.textContent?.trim()).toBe("👍");
    expect(
      container
        .querySelector('button[aria-label="❤️ 3"]')
        ?.textContent?.replace(/\s/g, ""),
    ).toBe("❤️3");
    act(() => chip?.click());
    expect(onReact).toHaveBeenCalledWith(
      expect.objectContaining({ id: "comment-1" }),
      "👍",
      true,
    );
  });

  it("opens the reaction picker from the root and reports the chosen reaction", async () => {
    const onReact = vi.fn();
    render(
      <ReviewCommentItem
        comment={makeComment()}
        variant="root"
        showReactions
        canReact
        onReact={onReact}
      />,
    );
    await act(async () => {
      reactButton()?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    const party = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("🎉"));
    expect(party).toBeDefined();
    await act(async () => party?.click());
    expect(onReact).toHaveBeenCalledWith(
      expect.objectContaining({ id: "comment-1" }),
      "🎉",
      true,
    );
  });

  it("hides the reaction row on a root when reactions are off", () => {
    render(
      <ReviewCommentItem
        comment={makeComment()}
        variant="root"
        canReact
        reactions={[{ reaction: "👍", count: 1, reactedByMe: false }]}
      />,
    );
    expect(reactButton()).toBeNull();
    expect(container.querySelector("[data-review-reaction-bar]")).toBeNull();
  });

  it("shows the clock time and a react button on a reply", () => {
    const createdAt = new Date(2026, 6, 13, 14, 31).toISOString();
    render(
      <ReviewCommentItem
        comment={makeComment({ createdAt, parentCommentId: "comment-0" })}
        variant="reply"
        showReactions
        canReact
      />,
    );
    const clock = container.querySelector("[data-review-comment-clock]");
    expect(clock?.textContent).toMatch(/^2:31\s?PM$/);
    expect(clock?.className).toContain("font-mono");
    expect(reactButton()).not.toBeNull();
    const name = container.querySelector("span.truncate");
    expect(name?.className).toContain("font-medium");
  });

  it("marks the portaled reaction picker as review UI", async () => {
    render(
      <ReviewCommentItem
        comment={makeComment({ parentCommentId: "comment-0" })}
        variant="reply"
        showReactions
        canReact
      />,
    );
    await act(async () => {
      reactButton()?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.hasAttribute("data-review-popover")).toBe(true);
    expect(container.contains(menu)).toBe(false);
  });

  it("shows only the emoji for one reaction and emoji plus count for two or more", () => {
    render(
      <ReviewCommentItem
        comment={makeComment()}
        variant="reply"
        showReactions
        canReact
        reactions={[
          { reaction: "🔥", count: 1, reactedByMe: false },
          { reaction: "❤️", count: 3, reactedByMe: true },
        ]}
      />,
    );
    const fire = container.querySelector('button[aria-label="🔥 1"]');
    const heart = container.querySelector('button[aria-label="❤️ 3"]');
    expect(fire?.textContent?.trim()).toBe("🔥");
    expect(heart?.textContent?.replace(/\s/g, "")).toBe("❤️3");
    expect(heart?.getAttribute("aria-pressed")).toBe("true");
    expect(fire?.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles a chip off when the current user already reacted", () => {
    const onReact = vi.fn();
    render(
      <ReviewCommentItem
        comment={makeComment()}
        variant="reply"
        showReactions
        canReact
        reactions={[{ reaction: "🎉", count: 2, reactedByMe: true }]}
        onReact={onReact}
      />,
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="🎉 2"]')
        ?.click(),
    );
    expect(onReact).toHaveBeenCalledWith(expect.anything(), "🎉", false);
  });

  it("marks agent replies with a badge and never requests a photo", () => {
    render(
      <ReviewCommentItem
        comment={makeComment({
          createdBy: "agent",
          authorName: "Claude",
          authorEmail: "agent@example.com",
        })}
        variant="reply"
        agentBadgeLabel="KI"
      />,
    );
    expect(container.textContent).toContain("Claude");
    expect(container.textContent).toContain("KI");
    expect(
      container.querySelector('[role="img"][aria-label="Claude"]'),
    ).not.toBe(null);
    expect(container.querySelector("img")).toBeNull();
    expect(useAvatarUrl).toHaveBeenCalledWith(null);
    expect(useAvatarUrl).not.toHaveBeenCalledWith("agent@example.com");
  });

  it("keeps a named agent's name and shows its badge once", () => {
    render(
      <ReviewCommentItem
        comment={makeComment({
          createdBy: "agent",
          authorName: "Claude",
          authorEmail: "owner@example.com",
        })}
        variant="reply"
        agentBadgeLabel="KI"
      />,
    );
    expect(container.querySelector("span.truncate")?.textContent).toBe(
      "Claude",
    );
    expect(occurrences("KI")).toBe(1);
    expect(container.textContent).not.toContain("owner@example.com");
  });

  it("shows an unnamed agent under the badge label, once, and never its owner's email", () => {
    render(
      <ReviewCommentItem
        comment={makeComment({
          createdBy: "agent",
          authorName: null,
          authorEmail: "owner@example.com",
        })}
        variant="reply"
        agentBadgeLabel="KI"
      />,
    );
    expect(container.querySelector("span.truncate")?.textContent).toBe("KI");
    expect(occurrences("KI")).toBe(1);
    expect(container.textContent).not.toContain("owner@example.com");
    expect(useAvatarUrl).toHaveBeenCalledWith(null);
  });

  it("treats a whitespace-only agent name as unnamed", () => {
    render(
      <ReviewCommentItem
        comment={makeComment({
          createdBy: "agent",
          authorName: "   ",
          authorEmail: "owner@example.com",
        })}
        variant="reply"
        agentBadgeLabel="KI"
      />,
    );
    expect(container.querySelector("span.truncate")?.textContent).toBe("KI");
    expect(occurrences("KI")).toBe(1);
    expect(container.textContent).not.toContain("owner@example.com");
  });

  it("does not repeat the badge when an agent's name already reads as it", () => {
    render(
      <ReviewCommentItem
        comment={makeComment({
          createdBy: "agent",
          authorName: " agent ",
          authorEmail: null,
        })}
        variant="reply"
        agentBadgeLabel="Agent"
      />,
    );
    expect(container.querySelector("span.truncate")?.textContent).toBe("agent");
    expect(occurrences("agent")).toBe(1);
  });

  it("requests a photo for people and shows no Agent badge", () => {
    render(<ReviewCommentItem comment={makeComment()} variant="reply" />);
    expect(useAvatarUrl).toHaveBeenCalledWith("maya@example.com");
    expect(container.textContent).not.toContain("Agent");
  });

  it("shows a human's email when the comment has no name", () => {
    render(
      <ReviewCommentItem
        comment={makeComment({ authorName: null })}
        variant="reply"
      />,
    );
    expect(container.querySelector("span.truncate")?.textContent).toBe(
      "maya@example.com",
    );
    expect(container.textContent).not.toContain("Agent");
  });

  it("swaps the whole comment for the editor while editing", () => {
    render(
      <ReviewCommentItem
        comment={makeComment()}
        variant="root"
        editor={<textarea aria-label="Edit comment" />}
      />,
    );
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.textContent).not.toContain("Make the heading clearer");
  });
});

describe("formatReviewCommentRelativeTime", () => {
  const formatters = {
    formatDate: (
      value: Date | number | string,
      options?: Intl.DateTimeFormatOptions,
    ) =>
      new Intl.DateTimeFormat("en-US", options).format(
        value instanceof Date ? value : new Date(value),
      ),
    formatRelativeTime: (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) => new Intl.RelativeTimeFormat("en-US", options).format(value, unit),
  } as Parameters<typeof formatReviewCommentRelativeTime>[1];
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it("picks the largest whole unit", () => {
    expect(formatReviewCommentRelativeTime(ago(10_000), formatters, NOW)).toBe(
      "now",
    );
    expect(
      formatReviewCommentRelativeTime(ago(2 * 60_000), formatters, NOW),
    ).toBe("2 minutes ago");
    expect(
      formatReviewCommentRelativeTime(ago(3 * 3_600_000), formatters, NOW),
    ).toBe("3 hours ago");
    expect(
      formatReviewCommentRelativeTime(ago(3 * 86_400_000), formatters, NOW),
    ).toBe("3 days ago");
  });

  it("falls back to a calendar date after 30 days", () => {
    expect(
      formatReviewCommentRelativeTime(ago(45 * 86_400_000), formatters, NOW),
    ).toBe("May 29");
  });

  it("does not turn an unparseable timestamp into a relative time", () => {
    expect(formatReviewCommentRelativeTime("not-a-date", formatters, NOW)).toBe(
      "not-a-date",
    );
  });
});
