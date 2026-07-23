// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewComment } from "../../review/types.js";

const mutate = vi.hoisted(() => vi.fn());
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

vi.mock("./use-review.js", () => ({
  useReviewComments: () => ({
    data: {
      comments: [rootComment],
      reviewStatus: { status: "draft" },
    },
    isLoading: false,
  }),
  useCreateReviewComment: () => ({ mutate, isPending: false }),
  useDeleteReviewComment: () => ({ mutate, isPending: false }),
  useReplyReviewComment: () => ({ mutate, isPending: false }),
  useResolveReviewThread: () => ({ mutate, isPending: false }),
}));

import { ReviewThreadPanel } from "./ReviewThreadPanel.js";

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

describe("ReviewThreadPanel sidebar layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    const comment = rootComment as ReviewComment & {
      resolutionNote?: string;
    };
    comment.status = "open";
    comment.metadata = null;
    delete comment.resolutionNote;
    mutate.mockReset();
    vi.unstubAllGlobals();
  });

  it("uses a flat container and progressively discloses reply and narrow actions", () => {
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
    act(() => commentButton?.click());
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
      expect.any(Object),
    );
    act(() => agentButton?.click());
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ resolutionTarget: "agent" }),
      expect.any(Object),
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
      container.querySelector('input[placeholder="Reply to this thread"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Cancel reply"]'),
    ).not.toBeNull();
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
      expect.any(Object),
    );
    expect(container.textContent).not.toContain("Send to agent");
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
      container.querySelector('input[placeholder="Reply..."]'),
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
