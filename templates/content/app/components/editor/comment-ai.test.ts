import type { CommentAiRequest } from "@shared/comment-ai";
import { describe, expect, it } from "vitest";

import {
  commentAiRequestsRefetchInterval,
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
