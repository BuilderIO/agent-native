// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewComment } from "../../review/types.js";

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

vi.mock("./use-review.js", () => ({
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
  useReactToReviewComment: () => ({
    mutate,
    isPending: false,
    variables: undefined,
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

import {
  isTrustedReviewAttachmentUrl,
  ReviewThreadPanel,
} from "./ReviewThreadPanel.js";
vi.mock("../clipboard.js", () => ({ writeClipboardText }));

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(textarea),
    "value",
  )?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
    rootComment.metadata = {
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

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Leave feedback"]',
    );
    expect(composer).not.toBeNull();
    setTextareaValue(composer!, "Ship this feedback");
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
    setTextareaValue(composer!, "Send this to the agent");
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
    act(() => replyButton?.click());

    expect(
      container.querySelector('textarea[placeholder="Reply to this thread"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Cancel reply"]'),
    ).not.toBeNull();
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

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Leave feedback"]',
    );
    expect(composer).not.toBeNull();
    setTextareaValue(composer!, "Human review note");
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

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Leave feedback"]',
    );
    setTextareaValue(composer!, "First draft");
    const failedSubmission = deferredMutation();
    const commentButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Comment",
    );
    act(() => commentButton?.click());

    expect(composer?.value).toBe("");
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
    expect(composer?.value).toBe("First draft");

    const staleFailure = deferredMutation();
    act(() => commentButton?.click());
    setTextareaValue(composer!, "Newer draft");
    await act(async () => {
      staleFailure.reject(new Error("still offline"));
      await staleFailure.promise.catch(() => undefined);
    });
    expect(composer?.value).toBe("Newer draft");
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
    expect(composer?.value).toBe("Newer draft");
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
      container.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="Reply to this thread"]',
      );
    setTextareaValue(input()!, "Submitted reply");
    const failedReply = deferredMutation();
    act(() =>
      input()?.closest("form")?.querySelector("button[type=submit]")?.click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reply"]')
        ?.click(),
    );
    setTextareaValue(input()!, "Newer reply");
    await act(async () => {
      failedReply.reject(new Error("offline"));
      await failedReply.promise.catch(() => undefined);
    });
    expect(input()?.value).toBe("Newer reply");
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
    expect(input()?.value).toBe("Newer reply");
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
    const replyComposer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Reply to this thread"]',
    );
    setTextareaValue(replyComposer!, "A quick reply");
    const replySubmit = replyComposer
      ?.closest("form")
      ?.querySelector<HTMLButtonElement>('button[type="submit"]');
    const failedReply = deferredMutation();
    act(() => replySubmit?.click());

    expect(
      container.querySelector('textarea[placeholder="Reply to this thread"]'),
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
      container.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="Reply to this thread"]',
      )?.value,
    ).toBe("A quick reply");
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
    rootComment.mentions = [mention];
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

    const editComposer = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit comment"]',
    );
    expect(editComposer).not.toBeNull();
    setTextareaValue(editComposer!, "Ping @Alice updated");
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
      document.querySelector('textarea[aria-label="Edit comment"]'),
    ).toBeNull();
    await act(async () => {
      failedEdit.reject(new Error("offline"));
      await failedEdit.promise.catch(() => undefined);
    });
    expect(
      document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Edit comment"]',
      )?.value,
    ).toBe("Ping @Alice updated");
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
      container.querySelector('textarea[placeholder="Reply..."]'),
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
});
