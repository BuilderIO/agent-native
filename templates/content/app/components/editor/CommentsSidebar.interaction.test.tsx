// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import { CommentDraftProvider } from "./comment-drafts";
import { CommentsSidebar } from "./CommentsSidebar";

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  edit: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({ mutate: actions.create, isPending: false }),
  useEditComment: () => ({ mutate: actions.edit, isPending: false }),
  useResolveComment: () => ({ mutate: actions.resolve, isPending: false }),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/markdown", () => ({
  InlineMarkdown: ({ content }: { content: string }) => content,
}));

function thread(id: string, resolved = false): CommentThread {
  return {
    threadId: id,
    quotedText: "unique selected text",
    prefix: null,
    suffix: null,
    startOffset: 0,
    resolved,
    comments: [
      {
        id: `${id}-root`,
        document_id: "fixture",
        thread_id: id,
        parent_id: null,
        content: `Comment ${id}`,
        quoted_text: "unique selected text",
        anchor_prefix: null,
        anchor_suffix: null,
        anchor_start_offset: 0,
        mentions: [],
        author_email: "reviewer@example.test",
        author_name: "Reviewer",
        resolved: resolved ? 1 : 0,
        created_at: "2026-09-04T12:00:00Z",
        updated_at: "2026-09-04T12:00:00Z",
        notion_comment_id: null,
      },
    ],
  };
}

describe("comment review interactions", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });
  function render(
    selected: string | null,
    threads = [thread("one"), thread("two")],
    presentation: "inline" | "history" = "inline",
  ) {
    if (!container) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(
            CommentDraftProvider,
            {
              documentId: "fixture",
              currentUserEmail: "reviewer@example.test",
              children: null,
            },
            createElement(CommentsSidebar, {
              documentId: "fixture",
              threads,
              selectedThreadId: selected,
              currentUserEmail: "reviewer@example.test",
              canComment: true,
              canResolve: true,
              alignToAnchors: false,
              forceVisible: true,
              presentation,
            }),
          ),
        ),
      ),
    );
  }
  function type(text: string) {
    const input = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("preserves a reply through dismissal, thread switches, and panel presentation remounts", () => {
    render("one");
    type("Unsent detailed feedback");
    act(() =>
      container
        .querySelector("textarea")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    render("two");
    type("Different draft");
    render(null, undefined, "history");
    render("one");
    expect(container.querySelector("textarea")!.value).toBe(
      "Unsent detailed feedback",
    );
    render("two");
    expect(container.querySelector("textarea")!.value).toBe("Different draft");
  });
  it("does not clear newer typing when an older reply settles", () => {
    render("one");
    type("First submitted draft");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(actions.create).toHaveBeenCalledOnce();
    type("Newer unsent draft");
    act(() =>
      actions.create.mock.calls[0][1].onSuccess({
        id: "saved",
        threadId: "one",
      }),
    );
    expect(container.querySelector("textarea")!.value).toBe(
      "Newer unsent draft",
    );
  });
  it("discards only the current draft explicitly", () => {
    render("one");
    type("Keep me");
    render("two");
    type("Discard me");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "comments.discardDraft")!
        .click(),
    );
    expect(container.querySelector("textarea")!.value).toBe("");
    render("one");
    expect(container.querySelector("textarea")!.value).toBe("Keep me");
  });
  it("shows resolved reply history without reopening and exposes Reopen", () => {
    const resolved = thread("one", true);
    resolved.comments.push({
      ...resolved.comments[0],
      id: "reply",
      parent_id: resolved.comments[0].id,
      content: "Resolved reply history",
    });
    render(null, [resolved], "history");
    expect(container.textContent).toContain("Resolved reply history");
    const reopen = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("comments.reopen"),
    )!;
    act(() => reopen.click());
    expect(actions.resolve).toHaveBeenCalledWith(
      { id: "one-root", documentId: "fixture", resolved: false },
      expect.anything(),
    );
  });
  it("distinguishes the initial empty list from filtering", () => {
    render(null, [], "history");
    expect(container.textContent).toContain("comments.selectTextToComment");
    expect(container.textContent).not.toContain("comments.noFilteredComments");
  });
});
