import type { CommentAiRequest } from "@shared/comment-ai";
import { describe, expect, it } from "vitest";

import {
  commentAiRequestsRefetchInterval,
  hasUndoableAiChange,
  latestCommentAiRequest,
} from "./comment-ai";

function request(
  operationId: string,
  threadId: string,
  status: CommentAiRequest["status"],
  updatedAt: string,
): CommentAiRequest {
  return {
    operationId,
    requestId: operationId,
    documentId: "document-1",
    threadId,
    rootCommentId: `root-${threadId}`,
    intent: "reply",
    status,
    attemptId: null,
    attemptCount: 1,
    runId: null,
    agentThreadId: `agent-${operationId}`,
    agentTurnId: `turn-${operationId}`,
    model: null,
    engine: null,
    result: null,
    errorCode: null,
    error: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("comment AI request selection", () => {
  it("keeps independent comment requests mapped to their own threads", () => {
    const requests = [
      request("a-old", "thread-a", "replied", "2026-09-14T10:00:00Z"),
      request("b", "thread-b", "running", "2026-09-14T10:02:00Z"),
      request("a-new", "thread-a", "queued", "2026-09-14T10:03:00Z"),
    ];

    expect(latestCommentAiRequest(requests, "thread-a")?.operationId).toBe(
      "a-new",
    );
    expect(latestCommentAiRequest(requests, "thread-b")?.operationId).toBe("b");
  });

  it("polls while queued, running, or refreshing and stops when terminal", () => {
    expect(
      commentAiRequestsRefetchInterval({
        requests: [
          request("a", "thread-a", "refreshing", "2026-09-14T10:00:00Z"),
        ],
      }),
    ).toBe(1_500);
    expect(
      commentAiRequestsRefetchInterval({
        requests: [request("a", "thread-a", "replied", "2026-09-14T10:00:00Z")],
      }),
    ).toBe(false);
  });
});

describe("an applied AI change's Undo", () => {
  it("counts only an applied change the thread's Undo can still reverse", () => {
    const applied = (
      result: CommentAiRequest["result"],
      status: CommentAiRequest["status"] = "resolved",
    ) => ({
      ...request("a", "thread-a", status, "2026-09-14T10:00:00Z"),
      result,
    });
    const change = { before: "teh", after: "the" };

    expect(
      hasUndoableAiChange(
        applied({ editApplied: true, undoable: true, changes: [change] }),
      ),
    ).toBe(true);
    expect(hasUndoableAiChange(undefined)).toBe(false);
    // Undone already, or removed text Undo can't bring back.
    expect(
      hasUndoableAiChange(
        applied({ editApplied: true, undone: true, changes: [change] }),
      ),
    ).toBe(false);
    expect(
      hasUndoableAiChange(
        applied({ editApplied: true, undoable: false, changes: [change] }),
      ),
    ).toBe(false);
    // A reply or a suggestion changed nothing in the page.
    expect(hasUndoableAiChange(applied({ commentId: "reply-1" }))).toBe(false);
    expect(
      hasUndoableAiChange(
        applied({ editApplied: true, changes: [change] }, "needs-review"),
      ),
    ).toBe(false);
  });
});
