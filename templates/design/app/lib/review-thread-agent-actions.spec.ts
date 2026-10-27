// @vitest-environment happy-dom
import { parseSubmitChatMessage } from "@agent-native/core/client/agent-chat";
import type { ReviewComment } from "@agent-native/core/review";
import { describe, expect, it } from "vitest";

import { sendToDesignAgentChat } from "./agent-chat";
import {
  buildReviewThreadAgentContext,
  buildReviewThreadAgentDispatch,
  type ReviewThreadAgentAction,
} from "./review-thread-agent-actions";

function comment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: "comment-root",
    resourceType: "design",
    resourceId: "design-1",
    threadId: "thread-1",
    parentCommentId: null,
    targetId: "screen-9",
    kind: "comment",
    status: "open",
    anchor: null,
    body: "Make the hero title bigger",
    authorEmail: "sam@example.com",
    authorName: "Sam",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    ownerEmail: null,
    orgId: null,
    visibility: "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    metadata: null,
    ...overrides,
  };
}

const thread = {
  root: comment({}),
  replies: [
    comment({
      id: "comment-reply",
      parentCommentId: "comment-root",
      authorName: "Alex",
      body: "Agree, 48px feels right",
    }),
  ],
};

const input = { designId: "design-1", thread };

describe("buildReviewThreadAgentDispatch", () => {
  it("send opens an unsubmitted draft after routing the thread to the agent queue", () => {
    const dispatch = buildReviewThreadAgentDispatch("send", input);
    expect(dispatch.submit).toBe(false);
    expect(dispatch.routeToAgentQueue).toBe(true);
    expect(dispatch.message.trim()).toBe("");
  });

  it("suggest submits a propose-only prompt without queue routing", () => {
    const dispatch = buildReviewThreadAgentDispatch("suggest", input);
    expect(dispatch.submit).toBe(true);
    expect(dispatch.routeToAgentQueue).toBe(false);
    expect(dispatch.message).toContain("Do not edit the design");
    expect(dispatch.message).toContain("wait for me to ask");
    expect(dispatch.message).not.toContain("resolve-review-thread");
  });

  it("reply submits a prompt that answers with reply-review-comment, without queue routing", () => {
    const dispatch = buildReviewThreadAgentDispatch("reply", input);
    expect(dispatch.submit).toBe(true);
    expect(dispatch.routeToAgentQueue).toBe(false);
    expect(dispatch.message).toContain("`reply-review-comment`");
    expect(dispatch.message).toContain('`resolutionTarget: "human"`');
    expect(dispatch.message).toContain("Do not edit the design");
    expect(dispatch.message).toContain("do not resolve the thread");
    expect(dispatch.message).not.toContain("resolve-review-thread");
  });

  it("apply routes the thread, submits, and tells the agent to resolve it after verifying", () => {
    const dispatch = buildReviewThreadAgentDispatch("apply", input);
    expect(dispatch.submit).toBe(true);
    expect(dispatch.routeToAgentQueue).toBe(true);
    expect(dispatch.message).toContain(
      "Apply this selected design review thread only.",
    );
    expect(dispatch.message).toContain("`resolve-review-thread`");
    expect(dispatch.message).toContain("`resolutionNote`");
    expect(dispatch.message).toContain("`reply-review-comment`");
    expect(dispatch.message).toContain('`resolutionTarget: "human"`');
  });

  it.each(["send", "suggest", "reply", "apply"] as const)(
    "%s attaches the design, thread, comment and screen ids, the root body, and the replies",
    (action) => {
      const { context } = buildReviewThreadAgentDispatch(action, input);
      expect(context).toContain("Design id: design-1");
      expect(context).toContain("Review thread id: thread-1");
      expect(context).toContain("Review comment id: comment-root");
      expect(context).toContain("Screen id: screen-9");
      expect(context).toContain("Feedback: Make the hero title bigger");
      expect(context).toContain("Replies:\nAlex: Agree, 48px feels right");
    },
  );

  it("marks a board-level thread's screen as unknown and omits an empty replies block", () => {
    const context = buildReviewThreadAgentContext({
      designId: "design-1",
      root: comment({ targetId: null }),
      replies: [],
    });
    expect(context).toContain("Screen id: unknown");
    expect(context).not.toContain("Replies:");
  });

  it("names a reply without an author as Reviewer", () => {
    const context = buildReviewThreadAgentContext({
      designId: "design-1",
      root: thread.root,
      replies: [comment({ authorName: null, body: "Same here" })],
    });
    expect(context).toContain("Reviewer: Same here");
  });
});

describe("agent chat accepts every dispatch", () => {
  async function deliveredToChat(action: ReviewThreadAgentAction) {
    const dispatch = buildReviewThreadAgentDispatch(action, input);
    const received = new Promise<MessageEvent>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type !== "agentNative.submitChat") return;
        window.removeEventListener("message", onMessage);
        resolve(event);
      };
      window.addEventListener("message", onMessage);
    });
    sendToDesignAgentChat({
      message: dispatch.message,
      context: dispatch.context,
      submit: dispatch.submit,
      openSidebar: true,
      newTab: true,
    });
    return { dispatch, parsed: parseSubmitChatMessage(await received) };
  }

  it.each(["send", "suggest", "reply", "apply"] as const)(
    "%s survives the chat's message parser with its submit flag and context",
    async (action) => {
      const { dispatch, parsed } = await deliveredToChat(action);
      // A null parse is a send the chat silently drops, which an empty message
      // would be for the draft that has to open with an empty composer.
      expect(parsed).not.toBeNull();
      expect(parsed?.submit).toBe(dispatch.submit);
      expect(parsed?.newTab).toBe(true);
      expect(parsed?.openSidebar).toBe(true);
      expect(parsed?.context).toBe(dispatch.context);
    },
  );
});
