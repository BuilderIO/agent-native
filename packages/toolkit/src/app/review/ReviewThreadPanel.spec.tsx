// @vitest-environment happy-dom

import type { ReviewComment } from "@agent-native/core/review/types";
import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.hoisted(() => vi.fn());
const discussion = vi.hoisted(() => ({
  reactions: {},
  threadPreferences: {} as Record<string, { unread: boolean }>,
  canReact: false,
}));
const reviewComments = vi.hoisted(() => vi.fn());
const writeClipboardText = vi.hoisted(() => vi.fn());
const rootComment = vi.hoisted(
  () =>
    ({
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
      authorEmail: "reviewer@example.com",
      authorName: null,
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
      createdAt: "2026-07-13T13:00:00.000Z",
      updatedAt: "2026-07-13T13:00:00.000Z",
      metadata: null,
    }) satisfies ReviewComment,
);
const resolvedComment = vi.hoisted(
  () =>
    ({
      id: "comment-2",
      resourceType: "design",
      resourceId: "design-1",
      threadId: "thread-2",
      parentCommentId: null,
      targetId: "screen-1",
      kind: "comment",
      status: "resolved",
      anchor: null,
      body: "Resolved note",
      authorEmail: "reviewer@example.com",
      authorName: null,
      createdBy: "human",
      resolutionTarget: "human",
      mentions: [],
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      resolvedBy: "owner@example.com",
      resolvedAt: "2026-07-13T13:05:00.000Z",
      consumedAt: null,
      deletedBy: null,
      deletedAt: null,
      createdAt: "2026-07-13T13:01:00.000Z",
      updatedAt: "2026-07-13T13:05:00.000Z",
      metadata: null,
    }) satisfies ReviewComment,
);

vi.mock("@agent-native/core/client/review/use-review", () => ({
  useReviewComments: (...args: unknown[]) => reviewComments(...args),
  useCreateReviewComment: () => ({
    mutate,
    mutateAsync: mutate,
    isPending: false,
  }),
  useDeleteReviewComment: () => ({
    mutate,
    mutateAsync: mutate,
    isPending: false,
  }),
  useReplyReviewComment: () => ({
    mutate,
    mutateAsync: mutate,
    isPending: false,
  }),
  useUpdateReviewComment: () => ({
    mutate,
    mutateAsync: mutate,
    isPending: false,
  }),
  useResolveReviewThread: () => ({
    mutate,
    mutateAsync: mutate,
    isPending: false,
  }),
  useReactToReviewComment: () => ({ mutate, isPending: false }),
}));

import { isTrustedReviewAttachmentUrl } from "./ReviewCommentItem.js";
import { serializeReviewComposerDoc } from "./ReviewComposerText.js";
import { ReviewThreadPanel } from "./ReviewThreadPanel.js";
vi.mock("@agent-native/toolkit/clipboard", () => ({ writeClipboardText }));

// The composers are Tiptap editors: the `.ProseMirror` node carries `role="textbox"`
// and the `aria-*`/`data-*` attributes the composer was given, plus `.editor`.
type ReviewEditorElement = HTMLElement & { editor: Editor };

function requireEditor(element: ReviewEditorElement | null) {
  if (!element) throw new Error("review composer editor is not mounted");
  return element;
}

// Replaces the body the way a keystroke does (a transaction that fires
// onUpdate), so the component under test sees the change. Positions 1 to
// size-1 are the text of the first paragraph, which is all these tests use.
function setEditorValue(element: ReviewEditorElement | null, value: string) {
  const { editor } = requireEditor(element);
  act(() => {
    const { state, view } = editor;
    view.dispatch(state.tr.insertText(value, 1, state.doc.content.size - 1));
  });
}

function appendToEditor(element: ReviewEditorElement | null, value: string) {
  const { editor } = requireEditor(element);
  act(() => {
    const { state, view } = editor;
    view.dispatch(state.tr.insertText(value, state.doc.content.size - 1));
  });
}

// The body as the composer submits it, with mention chips written as `@label`.
function editorValue(element: ReviewEditorElement | null) {
  const { editor } = requireEditor(element);
  return serializeReviewComposerDoc(editor.state.doc);
}

function deferredMutation() {
  let resolve!: (value: ReviewComment) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReviewComment>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  mutate.mockReturnValueOnce(promise);
  return { promise, resolve, reject };
}

describe("ReviewThreadPanel sidebar layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    reviewComments.mockImplementation(() => ({
      data: {
        comments: [rootComment],
        reviewStatus: { status: "draft" },
        discussion,
      },
      isLoading: false,
    }));
    writeClipboardText.mockResolvedValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    rootComment.body = "Make the heading clearer";
    (rootComment as ReviewComment).mentions = [];
    (rootComment as ReviewComment).createdBy = "human";
    const comment = rootComment as ReviewComment & {
      resolutionNote?: string;
    };
    comment.status = "open";
    comment.metadata = null;
    delete comment.resolutionNote;
    discussion.threadPreferences = {};
    mutate.mockReset();
    mutate.mockResolvedValue(rootComment);
    reviewComments.mockReset();
    writeClipboardText.mockReset();
    vi.unstubAllGlobals();
  });

  it("fails closed for untrusted persisted attachment URLs", () => {
    expect(
      isTrustedReviewAttachmentUrl(
        `${window.location.origin}/uploads/image.png`,
      ),
    ).toBe(true);
    expect(
      isTrustedReviewAttachmentUrl("https://cdn.builder.io/image.png"),
    ).toBe(true);
    expect(isTrustedReviewAttachmentUrl("https://tracker.example/pixel")).toBe(
      false,
    );
    expect(isTrustedReviewAttachmentUrl("javascript:alert(1)")).toBe(false);
  });

  it("renders all five trusted persisted image attachments", () => {
    (rootComment as ReviewComment).metadata = {
      attachments: Array.from({ length: 6 }, (_, index) => ({
        url: `${window.location.origin}/uploads/review-${index + 1}.png`,
        name: `Review ${index + 1}`,
        contentType: "image/png",
      })),
    };

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
        />,
      );
    });

    expect(
      container.querySelectorAll("[data-review-comment-attachments] img"),
    ).toHaveLength(5);
  });

  it("uses the localized agent label without displaying the acting human as author", () => {
    (rootComment as ReviewComment).createdBy = "agent";
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          agentLabel="KI"
          showComposer={false}
        />,
      );
    });
    expect(container.textContent).toContain("KI");
    expect(container.textContent).not.toContain("reviewer@example.com");
  });

  it("shows persisted unread state and filters to unread threads", () => {
    discussion.threadPreferences["thread-1"] = { unread: true };

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          unreadOnly
          unreadLabel="Unread feedback"
          showComposer={false}
        />,
      );
    });

    expect(
      container.querySelector('[data-review-thread-unread="true"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Unread feedback");
  });

  it("uses a flat container and progressively discloses reply and narrow actions", async () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          composerTargetId="screen-2"
          composerAnchor={{
            nodeId: "hero-title",
            point: { xPct: 50, yPct: 20 },
          }}
          composerMetadata={{ layerName: "Hero title", tagName: "H1" }}
          composerContextLabel="Commenting on Hero title"
          showHeader={false}
          variant="plain"
          canReply
          canResolve
          canDeleteComment
          showComposerTargetPicker
          placeholder="Leave feedback"
          replyPlaceholder="Reply to this thread"
          renderThreadActions={() => (
            <button type="button" aria-label="Send to agent">
              Send to agent
            </button>
          )}
        />,
      );
    });

    const section = container.querySelector("section");
    expect(section?.className).toContain("@container/review");
    expect(section?.className).toContain("bg-transparent");
    expect(section?.className).not.toContain("rounded-lg");
    expect(container.textContent).not.toContain("Draft");
    expect(container.textContent).toContain("Make the heading clearer");
    expect(container.textContent).toContain("Commenting on Hero title");
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Comment",
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Send to agent",
      ),
    ).toBe(true);

    const composer = container.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Leave feedback"]',
    );
    expect(composer).not.toBeNull();
    setEditorValue(composer, "Ship this feedback");
    const composerButtons = Array.from(container.querySelectorAll("button"));
    const commentButton = composerButtons.find(
      (button) => button.textContent?.trim() === "Comment",
    );
    const agentButton = composerButtons.find(
      (button) => button.textContent?.trim() === "Send to agent",
    );
    await act(async () => commentButton?.click());
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetId: "screen-2",
        anchor: {
          nodeId: "hero-title",
          point: { xPct: 50, yPct: 20 },
        },
        metadata: { layerName: "Hero title", tagName: "H1" },
        resolutionTarget: "human",
      }),
    );
    setEditorValue(composer, "Send this to the agent");
    act(() => agentButton?.click());
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ resolutionTarget: "agent" }),
    );

    const resolveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Resolve"]',
    );
    expect(resolveButton?.querySelector("span")?.className).toContain(
      "@xs/review:inline",
    );

    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Reply",
    );
    expect(replyButton).toBeTruthy();
    await act(async () => replyButton?.click());
    // The editor mounts asynchronously and takes the reply's focus once ready.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    const replyBox = container.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Reply to this thread"]',
    );
    const replyField = replyBox?.closest("[data-review-composer-field]");
    expect(replyBox).not.toBeNull();
    expect(replyField?.hasAttribute("data-expanded")).toBe(true);
    expect(
      container.querySelector('button[aria-label="Cancel reply"]'),
    ).not.toBeNull();

    // An empty reply box goes back to the one-line pill once the person leaves it.
    act(() => replyBox?.blur());
    expect(replyField?.hasAttribute("data-expanded")).toBe(false);
  });

  it("renders inline Markdown in comment bodies without headings", () => {
    rootComment.body = "# Not a heading\n\n**Bold** and `code`.";

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
        />,
      );
    });

    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.textContent).toContain("Not a heading");
  });

  it("routes the plain comment action to a human when agent dispatch is hidden", () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          showHeader={false}
          placeholder="Leave feedback"
        />,
      );
    });

    const composer = container.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Leave feedback"]',
    );
    expect(composer).not.toBeNull();
    setEditorValue(composer, "Human review note");
    const commentButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Comment",
    );
    act(() => commentButton?.click());

    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetId: "screen-1",
        body: "Human review note",
        resolutionTarget: "human",
      }),
    );
    expect(container.textContent).not.toContain("Send to agent");
  });

  it("clears a submitted comment immediately and restores it only when the draft is still untouched", async () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          placeholder="Leave feedback"
        />,
      );
    });

    const composer = container.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Leave feedback"]',
    );
    setEditorValue(composer, "First draft");
    const failedSubmission = deferredMutation();
    const commentButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Comment",
    );
    act(() => commentButton?.click());

    expect(editorValue(composer)).toBe("");
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: "First draft",
        clientOperationId: expect.any(String),
      }),
    );
    await act(async () => {
      failedSubmission.reject(new Error("offline"));
      await failedSubmission.promise.catch(() => undefined);
    });
    expect(editorValue(composer)).toBe("First draft");

    const staleFailure = deferredMutation();
    act(() => commentButton?.click());
    setEditorValue(composer, "Newer draft");
    await act(async () => {
      staleFailure.reject(new Error("still offline"));
      await staleFailure.promise.catch(() => undefined);
    });
    expect(editorValue(composer)).toBe("Newer draft");
    const failedCard = container.querySelector<HTMLElement>(
      "[data-review-failed-create]",
    );
    expect(failedCard?.textContent).toContain("First draft");
    const failedOperationId = failedCard?.dataset.reviewFailedCreate;
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-2"
          showHeader={false}
          placeholder="Leave feedback"
        />,
      );
    });
    expect(container.querySelector("[data-review-failed-create]")).toBeNull();
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          placeholder="Leave feedback"
        />,
      );
    });
    const restoredCard = container.querySelector<HTMLElement>(
      "[data-review-failed-create]",
    );
    await act(async () => restoredCard?.querySelector("button")?.click());
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: "First draft",
        clientOperationId: failedOperationId,
      }),
    );
    expect(editorValue(composer)).toBe("Newer draft");
    expect(container.querySelector("[data-review-failed-create]")).toBeNull();
  });

  it("preserves a failed reply separately from newer reply text", async () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canReply
          replyPlaceholder="Reply to this thread"
        />,
      );
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reply"]')
        ?.click(),
    );
    const input = () =>
      container.querySelector<ReviewEditorElement>(
        '[role="textbox"][aria-label="Reply to this thread"]',
      );
    setEditorValue(input(), "Submitted reply");
    const failedReply = deferredMutation();
    act(() =>
      input()
        ?.closest("form")
        ?.querySelector<HTMLButtonElement>("button[type=submit]")
        ?.click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reply"]')
        ?.click(),
    );
    setEditorValue(input(), "Newer reply");
    await act(async () => {
      failedReply.reject(new Error("offline"));
      await failedReply.promise.catch(() => undefined);
    });
    expect(editorValue(input())).toBe("Newer reply");
    const failedCard = container.querySelector<HTMLElement>(
      "[data-review-failed-reply]",
    );
    expect(failedCard?.textContent).toContain("Submitted reply");
    const failedOperationId = failedCard?.dataset.reviewFailedReply;
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-2"
          showHeader={false}
          showComposer={false}
          canReply
          replyPlaceholder="Reply to this thread"
        />,
      );
    });
    expect(container.querySelector("[data-review-failed-reply]")).toBeNull();
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canReply
          replyPlaceholder="Reply to this thread"
        />,
      );
    });
    const restoredCard = container.querySelector<HTMLElement>(
      "[data-review-failed-reply]",
    );
    await act(async () => restoredCard?.querySelector("button")?.click());
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: "Submitted reply",
        clientOperationId: failedOperationId,
      }),
    );
    expect(editorValue(input())).toBe("Newer reply");
    expect(container.querySelector("[data-review-failed-reply]")).toBeNull();
  });

  it("hands a submitted reply to the optimistic thread and restores it after a definite failure", async () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canReply
          replyPlaceholder="Reply to this thread"
        />,
      );
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reply"]')
        ?.click(),
    );
    const replyComposer = container.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Reply to this thread"]',
    );
    setEditorValue(replyComposer, "A quick reply");
    const replySubmit = replyComposer
      ?.closest("form")
      ?.querySelector<HTMLButtonElement>('button[type="submit"]');
    const failedReply = deferredMutation();
    act(() => replySubmit?.click());

    expect(
      container.querySelector(
        '[role="textbox"][aria-label="Reply to this thread"]',
      ),
    ).toBeNull();
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: "A quick reply",
        clientOperationId: expect.any(String),
      }),
    );
    await act(async () => {
      failedReply.reject(new Error("offline"));
      await failedReply.promise.catch(() => undefined);
    });
    expect(
      editorValue(
        container.querySelector<ReviewEditorElement>(
          '[role="textbox"][aria-label="Reply to this thread"]',
        ),
      ),
    ).toBe("A quick reply");
  });

  async function failReplyAfter(beforeFailure: () => void) {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canReply
          replyPlaceholder="Reply to this thread"
        />,
      );
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reply"]')
        ?.click(),
    );
    const replyComposer = container.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Reply to this thread"]',
    );
    setEditorValue(replyComposer, "A quick reply");
    const failedReply = deferredMutation();
    act(() =>
      replyComposer
        ?.closest("form")
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click(),
    );
    beforeFailure();
    await act(async () => {
      failedReply.reject(new Error("offline"));
      await failedReply.promise.catch(() => undefined);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    return container.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Reply to this thread"]',
    );
  }

  it("puts the cursor back in a failed reply when nothing else took focus", async () => {
    const restored = await failReplyAfter(() => {});

    expect(editorValue(restored)).toBe("A quick reply");
    expect(document.activeElement).toBe(restored);
  });

  it("leaves focus where the person moved when a failed reply comes back", async () => {
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    try {
      const restored = await failReplyAfter(() => elsewhere.focus());

      expect(editorValue(restored)).toBe("A quick reply");
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it("restores the delete dialog when dismissal races with a failed optimistic delete", async () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canDeleteComment
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="More actions"]')
        ?.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
    });
    const deleteItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Delete comment");
    await act(async () => deleteItem?.click());

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    const confirmDelete = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Delete");
    const failedDelete = deferredMutation();
    act(() => {
      confirmDelete?.click();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => {
      failedDelete.reject(new Error("offline"));
      await failedDelete.promise.catch(() => undefined);
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("releases each thread control after overlapping resolution requests settle", async () => {
    const secondOpenComment: ReviewComment = {
      ...resolvedComment,
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    };
    reviewComments.mockReturnValue({
      data: {
        comments: [rootComment, secondOpenComment],
        reviewStatus: { status: "draft" },
        discussion,
      },
      isLoading: false,
    });
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canResolve
        />,
      );
    });

    const firstResolution = deferredMutation();
    const secondResolution = deferredMutation();
    const resolveButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Resolve"]',
      ),
    );
    act(() => {
      resolveButtons[0]?.click();
      resolveButtons[0]?.click();
      resolveButtons[1]?.click();
    });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(resolveButtons[0]?.disabled).toBe(true);
    expect(resolveButtons[1]?.disabled).toBe(true);

    await act(async () => {
      firstResolution.reject(new Error("offline"));
      await firstResolution.promise.catch(() => undefined);
    });
    expect(resolveButtons[0]?.disabled).toBe(false);
    expect(resolveButtons[1]?.disabled).toBe(true);

    await act(async () => {
      secondResolution.resolve(secondOpenComment);
      await secondResolution.promise;
    });
    expect(resolveButtons[1]?.disabled).toBe(false);
  });

  it("fails closed when reply, resolve, and delete capabilities are omitted", () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
        />,
      );
    });

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('button[aria-label="Reply"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Resolve"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="More actions"]'),
    ).toBeNull();
  });

  it("preserves mentions while editing a comment", async () => {
    const mention = { label: "Alice", email: "alice@example.com" };
    rootComment.body = "Ping @Alice";
    (rootComment as ReviewComment).mentions = [mention];
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canEditComment
          mentionOptions={[mention]}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="More actions"]')
        ?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
          }),
        );
    });
    const editItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Edit comment");
    expect(editItem).toBeTruthy();
    await act(async () => editItem?.click());

    const editComposer = document.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Edit comment"]',
    );
    expect(editComposer).not.toBeNull();
    expect(
      editComposer?.querySelector("[data-review-mention-chip]"),
    ).not.toBeNull();
    appendToEditor(editComposer, " updated");
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save",
    );
    const failedEdit = deferredMutation();
    await act(async () => save?.click());

    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: "Ping @Alice updated",
        mentions: [mention],
      }),
    );
    expect(
      document.querySelector('[role="textbox"][aria-label="Edit comment"]'),
    ).toBeNull();
    // Someone who moved on while the save ran keeps their focus.
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    try {
      await act(async () => {
        failedEdit.reject(new Error("offline"));
        await failedEdit.promise.catch(() => undefined);
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(
        editorValue(
          document.querySelector<ReviewEditorElement>(
            '[role="textbox"][aria-label="Edit comment"]',
          ),
        ),
      ).toBe("Ping @Alice updated");
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it("puts the cursor in the reply box that Reply opens", async () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canReply
        />,
      );
    });

    const reply = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reply"]',
    );
    reply?.focus();
    await act(async () => reply?.click());
    // The editor mounts asynchronously and takes the reply's focus once ready.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(document.activeElement).toBe(
      container.querySelector('[role="textbox"][data-review-reply-input]'),
    );
  });

  it("puts the cursor at the end of the comment that Edit opens", async () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canEditComment
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="More actions"]')
        ?.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
    });
    const editItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Edit comment");
    editItem?.focus();
    await act(async () => editItem?.click());
    // The menu hands focus back to its trigger once it has closed.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    const editComposer = document.querySelector<ReviewEditorElement>(
      '[role="textbox"][aria-label="Edit comment"]',
    );
    expect(document.activeElement).toBe(editComposer);
    // The caret sits after the last character of the first paragraph.
    expect(editComposer?.editor.state.selection.$head.parentOffset).toBe(
      rootComment.body.length,
    );
  });

  it("returns focus to the menu button after an action other than Edit", async () => {
    const onMarkThreadUnread = vi.fn();
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canEditComment
          onMarkThreadUnread={onMarkThreadUnread}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions"]',
    );
    await act(async () => {
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const markUnread = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Mark as unread");
    markUnread?.focus();
    await act(async () => markUnread?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(onMarkThreadUnread).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("shows only the controls authorized for the current viewer", () => {
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canReply
          canResolve={false}
          canDeleteComment={(comment) =>
            comment.authorEmail === "someone-else@example.com"
          }
        />,
      );
    });

    const replyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reply"]',
    );
    expect(replyButton).not.toBeNull();
    expect(container.querySelector('button[aria-label="Resolve"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="More actions"]'),
    ).toBeNull();

    act(() => replyButton?.click());
    expect(
      container.querySelector('[role="textbox"][aria-label="Reply..."]'),
    ).not.toBeNull();

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canResolve
          canDeleteComment={(comment) =>
            comment.authorEmail === "reviewer@example.com"
          }
        />,
      );
    });

    expect(container.querySelector('button[aria-label="Reply"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="Resolve"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="More actions"]'),
    ).not.toBeNull();
  });

  it("filters review history by open and resolved status", () => {
    reviewComments.mockReturnValue({
      data: {
        comments: [rootComment, resolvedComment],
        reviewStatus: { status: "draft" },
      },
      isLoading: false,
    });

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          showFilter
          filterLabel="Filter comments"
          allCommentsLabel="All"
          openCommentsLabel="Open"
          resolvedCommentsLabel="Resolved"
        />,
      );
    });

    expect(container.textContent).toContain("Make the heading clearer");
    expect(container.textContent).not.toContain("Resolved note");
    expect(reviewComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeResolved: false }),
    );

    const filterTrigger = container.querySelector<HTMLButtonElement>(
      "[data-review-filter-trigger]",
    );
    expect(filterTrigger).not.toBeNull();
    act(() => {
      filterTrigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
        }),
      );
    });

    const resolvedOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((item) => item.textContent?.trim() === "Resolved");
    expect(resolvedOption).not.toBeUndefined();
    act(() => resolvedOption?.click());

    expect(container.textContent).toContain("Resolved note");
    expect(container.textContent).not.toContain("Make the heading clearer");
    expect(reviewComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeResolved: true }),
    );
  });

  it("copies a stable thread link through the shared clipboard helper", async () => {
    writeClipboardText.mockResolvedValue(true);

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          canCopyLink
          copyLinkLabel="Copy link"
          linkCopiedLabel="Link copied"
        />,
      );
    });

    const moreActions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions"]',
    );
    expect(moreActions).not.toBeNull();
    act(() => {
      moreActions?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
        }),
      );
    });

    const copyItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Copy link");
    expect(copyItem).not.toBeUndefined();
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).some((item) => item.textContent?.trim() === "Delete comment"),
    ).toBe(false);
    act(() => copyItem?.click());
    await act(async () => {
      await Promise.resolve();
    });

    const expectedUrl = new URL(window.location.href);
    expectedUrl.hash = "review-thread=thread-1";
    expect(writeClipboardText).toHaveBeenCalledWith(expectedUrl.toString());
  });

  it("renders resolution notes from metadata and a future typed field", () => {
    const comment = rootComment as ReviewComment & {
      resolutionNote?: string;
    };
    comment.status = "resolved";
    comment.metadata = {
      resolutionNote: "Tightened the hero headline to six words.",
    };

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          resolvedLabel="Resolved"
        />,
      );
    });

    expect(container.textContent).toContain(
      "Tightened the hero headline to six words.",
    );

    comment.metadata = null;
    comment.resolutionNote = "Updated the spacing tokens.";
    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          resolvedLabel="Resolved"
        />,
      );
    });

    expect(container.textContent).toContain("Updated the spacing tokens.");
  });

  it("does not render resolution notes on open comments", () => {
    const comment = rootComment as ReviewComment & {
      resolutionNote?: string;
    };
    comment.status = "open";
    comment.metadata = {
      resolutionNote: "This thread has not actually been resolved.",
    };
    comment.resolutionNote = "This thread has not actually been resolved.";

    act(() => {
      root.render(
        <ReviewThreadPanel
          resourceType="design"
          resourceId="design-1"
          showHeader={false}
          showComposer={false}
          resolvedLabel="Resolved"
        />,
      );
    });

    expect(container.textContent).not.toContain(
      "This thread has not actually been resolved.",
    );
    expect(container.querySelector('[aria-label="Resolved"]')).toBeNull();
  });

  it("lays a thread out as a compact root followed by dividerless replies", async () => {
    const reply = {
      ...(rootComment as ReviewComment),
      id: "comment-reply",
      parentCommentId: "comment-1",
      body: "Beep bloop",
      authorName: "Claude",
      authorEmail: null,
      createdBy: "agent",
      createdAt: "2026-07-13T14:31:00.000Z",
    } satisfies ReviewComment;
    discussion.canReact = true;
    discussion.reactions = {
      "comment-reply": [
        { reaction: "🔥", count: 1, reactedByMe: false },
        { reaction: "👍", count: 2, reactedByMe: false },
      ],
    };
    reviewComments.mockImplementation(() => ({
      data: {
        comments: [rootComment, reply],
        reviewStatus: { status: "draft" },
        discussion,
      },
      isLoading: false,
    }));
    try {
      act(() => {
        root.render(
          <ReviewThreadPanel
            resourceType="design"
            resourceId="design-1"
            showHeader={false}
            showComposer={false}
            showReactions
          />,
        );
      });

      const items = container.querySelectorAll("[data-review-comment]");
      expect(
        Array.from(items).map((item) =>
          item.getAttribute("data-review-comment-variant"),
        ),
      ).toEqual(["root", "reply"]);
      expect(container.querySelector(".border-s")).toBeNull();
      expect(
        items[0]?.querySelector('[aria-label="Add reaction"]'),
      ).not.toBeNull();
      expect(
        items[1]?.querySelector('[aria-label="Add reaction"]'),
      ).not.toBeNull();
      expect(items[1]?.textContent).toContain("Agent");
      expect(
        items[1]?.querySelector("[data-review-comment-clock]"),
      ).not.toBeNull();
      expect(
        items[1]?.querySelector('[aria-label="🔥 1"]')?.textContent?.trim(),
      ).toBe("🔥");
      expect(
        items[1]
          ?.querySelector('[aria-label="👍 2"]')
          ?.textContent?.replace(/\s/g, ""),
      ).toBe("👍2");

      await act(async () => {
        items[1]
          ?.querySelector('[aria-label="Add reaction"]')
          ?.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
          );
      });
      const choices = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).map((item) => item.querySelector('[aria-hidden="true"]')?.textContent);
      expect(choices).toEqual(["👍", "❤️", "🎉", "👀", "🔥"]);
      await act(async () =>
        document.querySelectorAll<HTMLElement>('[role="menuitem"]')[4]?.click(),
      );
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          commentId: "comment-reply",
          reaction: "🔥",
          active: true,
        }),
        expect.anything(),
      );
    } finally {
      discussion.canReact = false;
      discussion.reactions = {};
    }
  });
});
