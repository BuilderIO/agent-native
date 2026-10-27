// @vitest-environment happy-dom
import { parseSubmitChatMessage } from "@agent-native/core/client/agent-chat";
import type { ReviewComment } from "@agent-native/core/review";
import { describe, expect, it } from "vitest";

import { sendToDesignAgentChat } from "./agent-chat";
import {
  buildReviewThreadAgentContext,
  buildReviewThreadAgentDispatch,
  isReviewThreadEngineAction,
  reviewAgentModeForMenuAction,
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
  it("opens an unsubmitted draft with the thread attached", () => {
    const dispatch = buildReviewThreadAgentDispatch(input);
    expect(dispatch.submit).toBe(false);
    expect(dispatch.message.trim()).toBe("");
  });

  it("attaches the design, thread, comment and screen ids, the root body, and the replies", () => {
    const { context } = buildReviewThreadAgentDispatch(input);
    expect(context).toContain("Design id: design-1");
    expect(context).toContain("Review thread id: thread-1");
    expect(context).toContain("Review comment id: comment-root");
    expect(context).toContain("Screen id: screen-9");
    expect(context).toContain("Feedback: Make the hero title bigger");
    expect(context).toContain("Replies:\nAlex: Agree, 48px feels right");
  });

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

describe("menu items that start a review-agent run", () => {
  it("sends only Send to agent to the chat", () => {
    const chat = (
      ["send", "suggest", "reply", "apply"] as ReviewThreadAgentAction[]
    ).filter((action) => !isReviewThreadEngineAction(action));
    expect(chat).toEqual(["send"]);
  });

  it.each([
    ["suggest", "suggest"],
    ["reply", "reply"],
    ["apply", "apply-resolve"],
  ] as const)("%s starts a %s run", (action, mode) => {
    expect(isReviewThreadEngineAction(action)).toBe(true);
    expect(reviewAgentModeForMenuAction(action)).toBe(mode);
  });
});

describe("agent chat accepts the Send to agent dispatch", () => {
  it("survives the chat's message parser with its submit flag and context", async () => {
    const dispatch = buildReviewThreadAgentDispatch(input);
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
    const parsed = parseSubmitChatMessage(await received);
    // A null parse is a send the chat silently drops, which an empty message
    // would be for the draft that has to open with an empty composer.
    expect(parsed).not.toBeNull();
    expect(parsed?.submit).toBe(false);
    expect(parsed?.newTab).toBe(true);
    expect(parsed?.openSidebar).toBe(true);
    expect(parsed?.context).toBe(dispatch.context);
  });
});
