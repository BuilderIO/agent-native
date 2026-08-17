// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Comment, CommentsPanel } from "./comments-panel";

const actionMocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  updateComment: vi.fn(),
  otherMutation: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  useActionMutation: (name: string) => ({
    mutate:
      name === "add-comment"
        ? actionMocks.addComment
        : name === "update-comment"
          ? actionMocks.updateComment
          : actionMocks.otherMutation,
  }),
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
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
            presentation="share"
          />
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

  it("renders inline Markdown while flattening headings", () => {
    renderPanel("viewer@example.com", [
      {
        ...rootComment,
        content: "# Not a heading\n\n**Bold** and `inline code`.",
      },
    ]);

    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("code")?.textContent).toBe("inline code");
    expect(container.textContent).toContain("Not a heading");
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

  it("only offers comment editing to the comment author", () => {
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();

    renderPanel("AUTHOR@example.com");

    expect(container.querySelector('[aria-haspopup="menu"]')).not.toBeNull();
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
});
