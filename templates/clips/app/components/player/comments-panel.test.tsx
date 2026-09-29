// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  collectCommentSubtreeIds,
  type Comment,
  CommentsPanel,
  relativeTime,
} from "./comments-panel";
import { TimestampedCommentBar } from "./timestamped-comment-button";

const actionMocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  updateComment: vi.fn(),
  otherMutation: vi.fn(),
  mutationOptions: new Map<string, any>(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  useActionMutation: (name: string, options?: any) => {
    actionMocks.mutationOptions.set(name, options);
    return {
      mutate: (vars: any) => {
        void options?.onMutate?.(vars);
        return (
          name === "add-comment"
            ? actionMocks.addComment
            : name === "update-comment"
              ? actionMocks.updateComment
              : actionMocks.otherMutation
        )(vars);
      },
    };
  },
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatRelativeTime: (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) => {
      if (options?.numeric === "auto" && value === 0) return "now";
      const amount = Math.abs(value);
      return `${amount} ${unit}${amount === 1 ? "" : "s"} ${value < 0 ? "ago" : "from now"}`;
    },
  }),
}));

vi.mock("../../hooks/use-mention-members", () => ({
  useMentionMembers: () => ({
    data: [{ email: "member@example.com", name: "Member" }],
  }),
}));

const rootComment: Comment = {
  id: "comment-1",
  threadId: "thread-1",
  parentId: null,
  authorEmail: "author@example.com",
  authorName: "Author",
  content:
    "Please take a look at https://example.com/docs?item=1 and www.example.org/help.",
  videoTimestampMs: 12_000,
  emojiReactionsJson: "{}",
  resolved: false,
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:00:00.000Z",
};

let notifyResize: (() => void) | undefined;

class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    notifyResize = () => callback([], this as unknown as ResizeObserver);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: value }),
  );
}

describe("comment timestamps", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const formatRelativeTime = (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
  ) => {
    const amount = Math.abs(value);
    return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
  };

  it.each([
    [45 * 60 * 1000, "45 minutes ago"],
    [18 * 60 * 60 * 1000, "18 hours ago"],
    [3 * 24 * 60 * 60 * 1000, "3 days ago"],
    [2 * 30 * 24 * 60 * 60 * 1000, "2 months ago"],
    [365 * 24 * 60 * 60 * 1000, "1 year ago"],
  ])(
    "uses full relative units for an elapsed timestamp",
    (elapsed, expected) => {
      const createdAt = new Date(now - elapsed).toISOString();
      expect(relativeTime(createdAt, formatRelativeTime, now)).toBe(expected);
    },
  );

  it("uses a localized near-now value for a just-created comment", () => {
    const formatter = vi.fn(
      (
        _value: number,
        _unit: Intl.RelativeTimeFormatUnit,
        options?: Intl.RelativeTimeFormatOptions,
      ) => (options?.numeric === "auto" ? "now" : "unexpected"),
    );
    expect(
      relativeTime(new Date(now - 30_000).toISOString(), formatter, now),
    ).toBe("now");
    expect(formatter).toHaveBeenCalledWith(0, "second", { numeric: "auto" });
  });

  it("does not round into the next unit before its boundary", () => {
    expect(
      relativeTime(
        new Date(now - 59.9 * 60_000).toISOString(),
        formatRelativeTime,
        now,
      ),
    ).toBe("59 minutes ago");
    expect(
      relativeTime(
        new Date(now - 23.9 * 3_600_000).toISOString(),
        formatRelativeTime,
        now,
      ),
    ).toBe("23 hours ago");
  });

  it("returns an empty value for an invalid timestamp", () => {
    expect(relativeTime("not-a-date", formatRelativeTime, now)).toBe("");
  });
});

async function openMenu(trigger: HTMLButtonElement | null) {
  expect(trigger).not.toBeNull();
  trigger?.focus();
  await act(async () => {
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

describe("CommentsPanel reply composer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function renderPanel(
    currentUserEmail = "viewer@example.com",
    comments: Comment[] = [rootComment],
    presentation: "default" | "share" | "inline" = "share",
  ) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={comments}
            currentMs={34_000}
            currentUserEmail={currentUserEmail}
            enableComments
            canComment
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            presentation={presentation}
          />
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderPanel();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    notifyResize = undefined;
    actionMocks.mutationOptions.clear();
    vi.clearAllMocks();
  });

  it("renders comment URLs as safe external links without including punctuation", () => {
    const absoluteUrl = container.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/docs?item=1"]',
    );
    const wwwUrl = container.querySelector<HTMLAnchorElement>(
      'a[href="https://www.example.org/help"]',
    );

    expect(absoluteUrl?.textContent).toBe("https://example.com/docs?item=1");
    expect(absoluteUrl?.target).toBe("_blank");
    expect(absoluteUrl?.rel).toBe("noopener noreferrer");
    expect(wwwUrl?.textContent).toBe("www.example.org/help");
    expect(container.textContent).toContain("www.example.org/help.");
  });

  it("keeps reactions on one compact action row as secondary buttons", () => {
    renderPanel("viewer@example.com", [
      {
        ...rootComment,
        emojiReactionsJson: JSON.stringify({
          "👍": ["viewer@example.com"],
          "💡": ["other@example.com"],
        }),
      },
    ]);

    const actionRow = container.querySelector<HTMLElement>(
      "[data-comment-actions]",
    );
    const reactionButtons = actionRow?.querySelectorAll<HTMLButtonElement>(
      'button[aria-pressed="true"], button[aria-pressed="false"]',
    );

    expect(actionRow?.className).toContain("flex-nowrap");
    expect(reactionButtons).toHaveLength(2);
    expect(reactionButtons?.[0].className).toContain("bg-secondary");
    expect(reactionButtons?.[0].className).toContain("h-7");
    expect(reactionButtons?.[1].className).toContain("bg-secondary");
    act(() => reactionButtons?.[0].click());
    expect(actionMocks.otherMutation).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "👍",
    });
  });

  it("gives comment actions shadcn hover feedback", () => {
    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "commentsPanel.reply",
    );
    const reactionButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.react"]',
    );

    expect(replyButton?.className).toContain("hover:bg-accent");
    expect(replyButton?.className).toContain("hover:text-accent-foreground");
    expect(reactionButton?.className).toContain("hover:bg-accent");
    expect(reactionButton?.className).toContain("hover:text-accent-foreground");

    renderPanel("author@example.com");
    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[data-comment-actions] [aria-haspopup="menu"]',
    );
    expect(menuTrigger?.className).toContain("hover:bg-accent");
    expect(menuTrigger?.className).toContain("hover:text-accent-foreground");
  });

  it("treats legacy resolved comments like regular comments", () => {
    renderPanel("viewer@example.com", [{ ...rootComment, resolved: true }]);

    expect(container.textContent).not.toContain("commentsPanel.resolved");
    expect(container.querySelector(".opacity-60")).toBeNull();
    expect(container.querySelector("[data-comment-actions]")).not.toBeNull();
  });

  it("keeps the compact comment composer inside a quiet filled surface", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );

    expect(composer?.className).toContain("px-0 py-1");
    const composerShell = composer?.closest(".rounded-xl");
    expect(composerShell?.className).toContain("bg-muted/60");
    expect(composerShell?.querySelectorAll("button")).toHaveLength(1);
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.react"]'),
    ).toBeNull();
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.reply"]'),
    ).toBeNull();
    expect(
      composerShell?.querySelector(
        'button[aria-label="commentsPanel.commentButton"]',
      ),
    ).not.toBeNull();
  });

  it("docks the inline composer below the feed with a compact arrow action", () => {
    renderPanel("viewer@example.com", [rootComment], "inline");

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    const composerShell = composer?.closest(".rounded-xl");
    const comment = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent?.includes("Please take a look"),
    );

    expect(composerShell).not.toBeNull();
    expect(composerShell?.className).toContain("rounded-xl");
    expect(composerShell?.className).toContain(
      "border-[hsl(var(--comment-input-border))]",
    );
    expect(composerShell?.className).toContain(
      "shadow-[var(--comment-input-shadow)]",
    );
    expect(composerShell?.querySelectorAll("button")).toHaveLength(1);
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.react"]'),
    ).toBeNull();
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.reply"]'),
    ).toBeNull();
    expect(composerShell?.parentElement?.className).toContain(
      "comment-widget-shadow",
    );
    expect(composerShell?.className).toContain("focus-within:border-ring");
    expect(composer?.className).toContain("min-h-[54px]");
    expect(composer?.className).toContain("max-h-[40vh]");
    const composerDock = composerShell?.closest(".shrink-0");
    expect(composerDock?.className).toContain("relative");
    expect(composerDock?.className).toContain("z-10");
    expect(composerDock?.className).toContain("bg-transparent");
    expect(composerDock?.className).toContain("-mt-16");
    expect(composerDock?.className).toContain("pt-16");
    expect(composerDock?.className).toContain("pointer-events-none");
    const fade = composerDock?.querySelector('[aria-hidden="true"]');
    expect(fade?.className).toContain("absolute");
    expect(fade?.className).toContain("top-0");
    expect(fade?.className).toContain("z-0");
    expect(fade?.className).toContain("bg-gradient-to-b");
    expect(fade?.className).toContain("lg:to-background");
    expect(composerDock?.lastElementChild?.className).toContain(
      "pointer-events-auto",
    );
    expect(composerDock?.lastElementChild?.className).toContain(
      "relative z-10",
    );
    expect(composerDock?.lastElementChild?.className).toContain(
      "bg-background",
    );
    expect(composerDock?.className).not.toContain("border-t");
    const submit = container.querySelector<HTMLButtonElement>(
      "button[data-comment-submit]",
    );
    expect(submit?.className).toContain("size-[22px]");
    expect(submit?.querySelector(".tabler-icon-arrow-up")).not.toBeNull();
    expect(submit?.disabled).toBe(true);
    expect(comment).toBeDefined();
    expect(
      (comment as Node).compareDocumentPosition(composer!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "A new comment");
    });

    expect(submit?.disabled).toBe(false);
    expect(container.querySelector("kbd")).toBeNull();
  });

  it("keeps inline comments scrollable with the composer available, at every width", () => {
    renderPanel("viewer@example.com", [rootComment], "inline");

    const panel = container.firstElementChild as HTMLElement | null;
    const listRegion = container.querySelector("ul")?.parentElement;
    const commentList = container.querySelector("ul");

    expect(panel?.className).toContain("h-full");
    expect(panel?.className).not.toMatch(/\blg:h-full\b/);
    expect(listRegion?.className).toContain("overflow-y-auto");
    expect(listRegion?.className).not.toMatch(/\blg:overflow-y-auto\b/);
    expect(listRegion?.className).toContain("overscroll-contain");
    expect(listRegion?.className).not.toMatch(/\blg:overscroll-contain\b/);
    expect(commentList?.className).toContain("pb-16");
    expect(
      Array.from(commentList?.querySelectorAll(":scope > li") ?? []).every(
        (item) => !item.className.includes("min-h-[140px]"),
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("[data-comment-actions]")).length,
    ).toBeGreaterThan(0);
  });

  it("scrolls the default (sidebar) preset at every width too", () => {
    renderPanel("viewer@example.com", [rootComment], "default");

    const listRegion = container.querySelector("ul")?.parentElement;

    expect(listRegion?.className).toContain("overflow-y-auto");
    expect(listRegion?.className).not.toMatch(/\blg:overflow-y-auto\b/);
  });

  it("opens account creation when a signed-out viewer activates the composer", () => {
    const onUnauthenticated = vi.fn();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[rootComment]}
            currentMs={34_000}
            enableComments
            canComment={false}
            onSeek={vi.fn()}
            onUnauthenticated={onUnauthenticated}
            queryKey={["recording", "recording-1"]}
            presentation="inline"
          />
        </QueryClientProvider>,
      );
    });

    const composer = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("commentsPanel.leaveComment"),
    );

    expect(composer).toBeDefined();
    expect(composer?.className).not.toContain("border-input");
    const composerShell = composer?.querySelector("span.rounded-xl");
    expect(composerShell?.className).toContain("rounded-xl");
    expect(composerShell?.className).toContain("border-transparent");
    expect(container.textContent).not.toContain("commentsPanel.beFirst");
    act(() => composer?.click());
    expect(onUnauthenticated).toHaveBeenCalledWith("comment");
  });

  it("keeps reply and reaction affordances visible before the account gate", () => {
    const onUnauthenticated = vi.fn();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[rootComment]}
            currentMs={34_000}
            enableComments
            canComment={false}
            onSeek={vi.fn()}
            onUnauthenticated={onUnauthenticated}
            queryKey={["recording", "recording-1"]}
            presentation="inline"
          />
        </QueryClientProvider>,
      );
    });

    const reply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("commentsPanel.reply"),
    );
    const react = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.react"]',
    );

    expect(reply).toBeDefined();
    expect(react).toBeDefined();
    act(() => reply?.click());
    expect(onUnauthenticated).toHaveBeenCalledWith("comment");
  });

  it("grows comment composers to 40vh and scrolls only past that limit", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const maxHeight = Math.round(window.innerHeight * 0.4);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: maxHeight + 64,
    });

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "A comment long enough to wrap");
    });

    expect(composer?.style.height).toBe(`${maxHeight}px`);
    expect(composer?.style.overflowY).toBe("auto");

    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: 72,
    });
    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "Short comment");
    });

    expect(composer?.style.height).toBe("72px");
    expect(composer?.style.overflowY).toBe("hidden");
  });

  it("recalculates the comment textarea cap after a viewport resize", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const heightDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight",
    );
    const originalHeight = window.innerHeight;

    try {
      Object.defineProperty(composer, "scrollHeight", {
        configurable: true,
        value: Math.round(originalHeight * 0.4) + 64,
      });
      act(() => {
        if (composer) setTextareaValue(composer, "A long comment");
      });
      expect(composer?.style.height).toBe(
        `${Math.round(originalHeight * 0.4)}px`,
      );

      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 400,
      });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(composer?.style.height).toBe("160px");
      expect(composer?.style.overflowY).toBe("auto");
    } finally {
      if (heightDescriptor) {
        Object.defineProperty(window, "innerHeight", heightDescriptor);
      } else {
        Reflect.deleteProperty(window, "innerHeight");
      }
    }
  });

  it("regrows comment textareas when their width changes wrapping", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const naturalHeight = Math.floor(window.innerHeight * 0.2);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: naturalHeight,
    });

    act(() => notifyResize?.());

    expect(composer?.style.height).toBe(`${naturalHeight}px`);
    expect(composer?.style.overflowY).toBe("hidden");
  });

  it("lets the comment feed widget expand with its composer", () => {
    renderPanel("viewer@example.com", [rootComment], "inline");
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const naturalHeight = Math.floor(window.innerHeight * 0.2);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: naturalHeight,
    });

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "A longer comment in the feed");
    });

    expect(composer?.style.height).toBe(`${naturalHeight}px`);
    expect(composer?.closest(".comment-widget-shadow")?.className).toContain(
      "min-h-[96px]",
    );
    expect(
      composer?.closest(".comment-widget-shadow")?.className.split(" "),
    ).not.toContain("h-[96px]");
  });

  it("renders inline Markdown while flattening headings", () => {
    renderPanel("viewer@example.com", [
      {
        ...rootComment,
        content: "# Not a heading\n\n**Bold**, *italic* and `inline code`.",
      },
    ]);

    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("inline code");
    expect(container.textContent).toContain("Not a heading");
  });

  it("applies Markdown formatting shortcuts to selected text", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "format this");
      composer.setSelectionRange(0, 11);
      composer.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "b",
          metaKey: true,
        }),
      );
    });

    expect(composer?.value).toBe("**format this**");
  });

  it("opens and focuses a reply field inline without replacing the new-comment draft", async () => {
    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Keep this draft");
    });

    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "commentsPanel.reply",
    );
    expect(replyButton).toBeDefined();

    await act(async () => {
      replyButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const inlineReply = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.writeReply"]',
    );
    expect(inlineReply).not.toBeNull();
    expect(document.activeElement).toBe(inlineReply);
    expect(newComment?.value).toBe("Keep this draft");
    const inlineReplyShell = inlineReply?.parentElement?.parentElement;
    expect(inlineReplyShell?.className).toContain("rounded-[16px]");
    expect(inlineReplyShell?.className).toContain("border-transparent");
    expect(inlineReplyShell?.className).toContain("focus-within:border-ring");
    expect(inlineReplyShell?.className).not.toContain("focus-within:ring-ring");
    expect(inlineReplyShell?.className).toContain("p-[3px]");
    expect(inlineReply?.className).toContain("min-h-6");
    const inlineReplySubmit = inlineReplyShell?.querySelector("button");
    expect(inlineReplySubmit?.className).toContain("size-[22px]");
    expect(
      inlineReply!.compareDocumentPosition(newComment as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(inlineReply?.closest(".border-s")).toBeNull();
  });

  it("inserts organization member mentions from autocomplete", async () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "Hi @");
      composer.setSelectionRange(4, 4);
      composer.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, key: "@" }),
      );
    });

    const option = document.body.querySelector<HTMLButtonElement>(
      'button[role="option"]',
    );
    expect(option?.textContent).toContain("Member");

    await act(async () => {
      option?.click();
      await Promise.resolve();
    });

    expect(composer?.value).toBe("Hi @Member ");
    act(() =>
      composer?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="commentsPanel.commentButton"]',
        )
        ?.click(),
    );

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Hi @Member",
      videoTimestampMs: 34_000,
      mentions: [{ email: "member@example.com", name: "Member" }],
    });
  });

  it("submits the inline reply to the selected thread", async () => {
    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "commentsPanel.reply",
    );

    await act(async () => {
      replyButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const inlineReply = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.writeReply"]',
    );
    act(() => {
      if (!inlineReply) return;
      setTextareaValue(inlineReply, "Inline response");
    });

    const sendReply = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.writeReply"]',
    );
    expect(sendReply?.querySelector(".tabler-icon-arrow-up")).not.toBeNull();
    await act(async () => {
      sendReply?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Inline response",
      videoTimestampMs: 12_000,
      threadId: "thread-1",
      parentId: "comment-1",
    });
    expect(container.textContent).toContain("Inline response");
  });

  it("nests replies two levels deep and caps further reply affordances", async () => {
    const firstReply: Comment = {
      ...rootComment,
      id: "comment-1-reply-1",
      parentId: rootComment.id,
      authorName: "First Reply",
      content: "A first-level reply.",
      createdAt: "2026-07-10T12:01:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
    };
    const secondReply: Comment = {
      ...rootComment,
      id: "comment-1-reply-2",
      parentId: firstReply.id,
      authorName: "Second Reply",
      content: "A second-level reply.",
      createdAt: "2026-07-10T12:02:00.000Z",
      updatedAt: "2026-07-10T12:02:00.000Z",
    };
    renderPanel(
      "viewer@example.com",
      [rootComment, firstReply, secondReply],
      "share",
    );

    const rootList = container.querySelector("ul");
    const rootItem = rootList?.querySelector(":scope > li");
    const firstLevelList = rootItem?.querySelector(":scope > ul");
    const firstReplyItem = firstLevelList?.querySelector(":scope > li");
    const secondLevelList = firstReplyItem?.querySelector(":scope > ul");
    const secondReplyItem = secondLevelList?.querySelector(":scope > li");

    expect(firstReplyItem?.textContent).toContain("A first-level reply.");
    expect(secondReplyItem?.textContent).toContain("A second-level reply.");
    expect(secondReplyItem?.parentElement).toBe(secondLevelList);

    const replyButtons = Array.from(
      container.querySelectorAll("[data-comment-actions] button"),
    ).filter((button) => button.textContent?.trim() === "commentsPanel.reply");
    expect(replyButtons).toHaveLength(2);

    const firstReplyButton = Array.from(
      firstReplyItem?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.trim() === "commentsPanel.reply");
    await act(async () => {
      firstReplyButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nestedComposer = firstReplyItem?.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.writeReply"]',
    );
    expect(nestedComposer).not.toBeNull();
    act(() => {
      if (!nestedComposer) return;
      setTextareaValue(nestedComposer, "A nested response.");
    });
    act(() =>
      firstReplyItem
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="commentsPanel.writeReply"]',
        )
        ?.click(),
    );

    expect(actionMocks.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "A nested response.",
        threadId: rootComment.threadId,
        parentId: firstReply.id,
      }),
    );
    expect(
      Array.from(secondReplyItem?.querySelectorAll("button") ?? []).some(
        (button) => button.textContent?.trim() === "commentsPanel.reply",
      ),
    ).toBe(false);
  });

  it("collects every nested reply for optimistic deletion", () => {
    const firstReply = {
      ...rootComment,
      id: "reply-1",
      parentId: rootComment.id,
    };
    const secondReply = {
      ...rootComment,
      id: "reply-2",
      parentId: firstReply.id,
    };

    expect(
      collectCommentSubtreeIds(
        [rootComment, firstReply, secondReply],
        rootComment.id,
      ),
    ).toEqual(new Set([rootComment.id, firstReply.id, secondReply.id]));
  });

  it("rolls back one failed reaction without discarding another optimistic reaction", async () => {
    renderPanel("viewer@example.com");
    const options = actionMocks.mutationOptions.get("react-to-comment");
    expect(options).toBeDefined();

    const first = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });
    const second = await options.onMutate({
      commentId: rootComment.id,
      emoji: "💡",
    });

    await act(async () => {
      options.onError?.(
        new Error("reaction failed"),
        {
          commentId: rootComment.id,
          emoji: "👍",
        },
        first,
      );
      await Promise.resolve();
    });

    const commentText = container.textContent ?? "";
    expect(commentText).toContain("💡 1");
    expect(commentText).not.toContain("👍 1");
    expect(second).toMatchObject({ type: "reaction", emoji: "💡" });
  });

  it("keeps same-emoji toggles ordered when both requests fail", async () => {
    renderPanel("viewer@example.com");
    const options = actionMocks.mutationOptions.get("react-to-comment");
    expect(options).toBeDefined();

    const first = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });
    const second = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });

    await act(async () => {
      options.onError?.(
        new Error("first reaction failed"),
        { commentId: rootComment.id, emoji: "👍" },
        first,
      );
      options.onError?.(
        new Error("second reaction failed"),
        { commentId: rootComment.id, emoji: "👍" },
        second,
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("👍 1");
  });

  it("ignores an older reaction response after a newer toggle", async () => {
    renderPanel("viewer@example.com");
    const options = actionMocks.mutationOptions.get("react-to-comment");
    expect(options).toBeDefined();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const first = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });
    const second = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });

    await act(async () => {
      options.onSuccess?.(
        { reactions: {} },
        { commentId: rootComment.id, emoji: "👍" },
        second,
      );
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("👍 1");
    expect(invalidateQueries).not.toHaveBeenCalled();

    await act(async () => {
      options.onSuccess?.(
        { reactions: { "👍": ["viewer@example.com"] } },
        { commentId: rootComment.id, emoji: "👍" },
        first,
      );
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("👍 1");
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["recording", "recording-1"],
    });
  });

  it("restores the confirmed edit when every overlapping edit fails", async () => {
    renderPanel("author@example.com");
    const options = actionMocks.mutationOptions.get("update-comment");
    expect(options).toBeDefined();

    const first = await options.onMutate({
      id: rootComment.id,
      content: "Rejected edit A",
    });
    const second = await options.onMutate({
      id: rootComment.id,
      content: "Rejected edit B",
    });

    await act(async () => {
      options.onError?.(
        new Error("first edit failed"),
        { id: rootComment.id, content: "Rejected edit A" },
        first,
      );
      options.onError?.(
        new Error("second edit failed"),
        { id: rootComment.id, content: "Rejected edit B" },
        second,
      );
      await Promise.resolve();
    });

    act(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "common.cancel")
        ?.click();
    });

    expect(container.textContent).toContain(rootComment.content);
    expect(container.textContent).not.toContain("Rejected edit A");
    expect(container.textContent).not.toContain("Rejected edit B");
  });

  it("only offers comment editing to the comment author", () => {
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();

    renderPanel("AUTHOR@example.com");

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    expect(menuTrigger).not.toBeNull();
    expect(menuTrigger?.className).toContain("opacity-0");
    expect(menuTrigger?.className).toContain("group-hover/comment:opacity-100");
    expect(menuTrigger?.className).toContain(
      "group-focus-within/comment:opacity-100",
    );
  });

  it("prefills and saves an author's comment inline", async () => {
    renderPanel("author@example.com");

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    await openMenu(menuTrigger);

    const editItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "commentsPanel.editComment");
    expect(editItem).toBeDefined();

    await act(async () => {
      editItem?.click();
      await Promise.resolve();
    });

    const editor = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="commentsPanel.editComment"]',
    );
    expect(editor?.value).toBe(rootComment.content);
    expect(document.activeElement).toBe(editor);

    act(() => {
      if (!editor) return;
      setTextareaValue(editor, "Updated comment");
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "common.save",
    );
    act(() => save?.click());

    expect(actionMocks.updateComment).toHaveBeenCalledWith({
      id: "comment-1",
      content: "Updated comment",
    });
  });

  it("cancels comment editing without saving", async () => {
    renderPanel("author@example.com");

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    await openMenu(menuTrigger);
    const editItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "commentsPanel.editComment");
    await act(async () => {
      editItem?.click();
      await Promise.resolve();
    });

    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "common.cancel",
    );
    act(() => cancel?.click());

    expect(
      container.querySelector(
        'textarea[aria-label="commentsPanel.editComment"]',
      ),
    ).toBeNull();
    expect(actionMocks.updateComment).not.toHaveBeenCalled();
  });

  it("submits a new comment for a signed-in viewer", () => {
    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Viewer note");
    });

    act(() => {
      newComment?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "Enter",
        }),
      );
    });

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Viewer note",
      videoTimestampMs: 34_000,
    });
  });

  it("captures the player's live timestamp when the rendered time is stale", () => {
    const getCurrentMs = vi.fn(() => 72_000);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[rootComment]}
            currentMs={0}
            getCurrentMs={getCurrentMs}
            currentUserEmail="viewer@example.com"
            enableComments
            canComment
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            presentation="inline"
          />
        </QueryClientProvider>,
      );
    });

    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Live timestamp note");
      newComment.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });

    expect(getCurrentMs).toHaveBeenCalledTimes(1);
    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Live timestamp note",
      videoTimestampMs: 72_000,
    });
  });

  it("submits a new comment with Enter while keeping Shift+Enter for newlines", () => {
    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Viewer note");
      newComment.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Viewer note",
      videoTimestampMs: 34_000,
    });

    actionMocks.addComment.mockClear();
    renderPanel();
    const multilineComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(multilineComment).not.toBeNull();

    act(() => {
      if (!multilineComment) return;
      setTextareaValue(multilineComment, "Viewer note");
      multilineComment.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          shiftKey: true,
        }),
      );
    });

    expect(actionMocks.addComment).not.toHaveBeenCalled();
  });

  it("grows the timestamped composer to 40vh with a compact send action", () => {
    act(() => {
      root.render(
        <TimestampedCommentBar
          recordingId="recording-1"
          atMs={34_000}
          onClose={vi.fn()}
        />,
      );
    });

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.composerPlaceholder"]',
    );
    const send = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.commentAt 0:34"]',
    );
    const maxHeight = Math.round(window.innerHeight * 0.4);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: maxHeight + 64,
    });

    act(() => {
      if (!composer) return;
      setTextareaValue(
        composer,
        "A timestamped comment that spans several lines",
      );
    });

    expect(composer?.getAttribute("rows")).toBe("1");
    expect(composer?.className).toContain("max-h-[40vh]");
    expect(composer?.style.height).toBe(`${maxHeight}px`);
    expect(composer?.style.overflowY).toBe("auto");
    expect(composer?.closest(".max-w-lg")).not.toBeNull();
    expect(send?.className).toContain("size-7");
    expect(send?.querySelector(".tabler-icon-arrow-up")).not.toBeNull();
  });

  it("renders a shadcn empty state with an icon when there are no comments", () => {
    renderPanel("viewer@example.com", [], "share");

    const empty = container.querySelector("[data-slot=empty]");
    const icon = container.querySelector("[data-slot=empty-icon]");
    const svg = icon ? icon.querySelector("svg") : null;

    expect(empty).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(svg).not.toBeNull();
    expect(container.textContent).toContain("commentsPanel.beFirst");
  });

  it("renders the shared empty state icon when comments are disabled", () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[]}
            currentMs={34_000}
            currentUserEmail="viewer@example.com"
            enableComments={false}
            canComment={false}
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            presentation="share"
          />
        </QueryClientProvider>,
      );
    });

    const empty = container.querySelector("[data-slot=empty]");
    const icon = container.querySelector("[data-slot=empty-icon]");
    const svg = icon ? icon.querySelector("svg") : null;

    expect(empty).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(svg).not.toBeNull();
    expect(container.textContent).toContain("commentsPanel.disabled");
  });
});
