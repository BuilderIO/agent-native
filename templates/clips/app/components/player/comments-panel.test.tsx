// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Comment, CommentsPanel } from "./comments-panel";

const actionMocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  otherMutation: vi.fn(),
}));

vi.mock("@agent-native/core/client", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  useActionMutation: (name: string) => ({
    mutate:
      name === "add-comment"
        ? actionMocks.addComment
        : actionMocks.otherMutation,
  }),
  useT: () => (key: string) => key,
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

describe("CommentsPanel reply composer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[rootComment]}
            currentMs={34_000}
            currentUserEmail="viewer@example.com"
            enableComments
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            presentation="share"
          />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
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
      (button) => button.textContent?.trim() === "Reply",
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
    expect(
      inlineReply!.compareDocumentPosition(newComment as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("submits the inline reply to the selected thread", async () => {
    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Reply",
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
    act(() => sendReply?.click());

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Inline response",
      videoTimestampMs: 12_000,
      threadId: "thread-1",
      parentId: "comment-1",
    });
  });
});
