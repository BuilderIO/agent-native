import type { CommentAiRequest } from "@shared/comment-ai";
import { describe, expect, it } from "vitest";

import {
  commentAiRequestsRefetchInterval,
  latestCommentAiRequest,
  threadHasAppliedAiChange,
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

describe("an AI change a thread delete leaves in the page", () => {
  const change = { before: "teh", after: "the" };
  const made = (
    id: string,
    result: CommentAiRequest["result"],
    {
      status = "resolved",
      threadId = "thread-a",
      updatedAt = "2026-09-14T10:00:00Z",
    }: {
      status?: CommentAiRequest["status"];
      threadId?: string;
      updatedAt?: string;
    } = {},
  ) => ({ ...request(id, threadId, status, updatedAt), result });
  const applied = (requests: CommentAiRequest[]) =>
    threadHasAppliedAiChange(requests, "thread-a");

  it("counts a change the AI made and hasn't undone, resolved or left for review", () => {
    expect(
      applied([
        made("a", { editApplied: true, undoable: true, changes: [change] }),
      ]),
    ).toBe(true);
    // Saved, but the discussion changed, so the thread stayed open.
    expect(
      applied([
        made(
          "a",
          { editApplied: true, changes: [change] },
          {
            status: "needs-review",
          },
        ),
      ]),
    ).toBe(true);
    expect(threadHasAppliedAiChange(undefined, "thread-a")).toBe(false);
    expect(
      applied([
        made("a", { editApplied: true, undone: true, changes: [change] }),
      ]),
    ).toBe(false);
    // A reply or a suggestion changed nothing in the page.
    expect(applied([made("a", { commentId: "reply-1" })])).toBe(false);
    expect(
      applied([
        made("a", { suggestionId: "suggestion-1" }, { status: "suggested" }),
      ]),
    ).toBe(false);
  });

  it("looks past the latest request to every one the delete would remove", () => {
    const earlier = made("a", { editApplied: true, changes: [change] });
    const latest = made(
      "b",
      { commentId: "reply-1" },
      {
        status: "replied",
        updatedAt: "2026-09-14T11:00:00Z",
      },
    );
    expect(applied([earlier, latest])).toBe(true);
    // Another thread's change isn't this thread's.
    expect(
      applied([
        made(
          "c",
          { editApplied: true, changes: [change] },
          {
            threadId: "thread-b",
          },
        ),
      ]),
    ).toBe(false);
  });
});
