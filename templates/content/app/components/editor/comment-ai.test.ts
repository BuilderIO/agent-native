import type { CommentAiRequest } from "@shared/comment-ai";
import { describe, expect, it } from "vitest";

import {
  commentAiRequestsRefetchInterval,
  latestCommentAiRequest,
  threadHasUndoableAiChange,
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
  const undoable = (requests: CommentAiRequest[]) =>
    threadHasUndoableAiChange(requests, "thread-a");

  it("counts only an applied change Undo can still reverse", () => {
    expect(
      undoable([
        made("a", { editApplied: true, undoable: true, changes: [change] }),
      ]),
    ).toBe(true);
    expect(threadHasUndoableAiChange(undefined, "thread-a")).toBe(false);
    // Undone already, or removed text Undo can't bring back.
    expect(
      undoable([
        made("a", { editApplied: true, undone: true, changes: [change] }),
      ]),
    ).toBe(false);
    expect(
      undoable([
        made("a", { editApplied: true, undoable: false, changes: [change] }),
      ]),
    ).toBe(false);
    // A reply or a suggestion changed nothing in the page.
    expect(undoable([made("a", { commentId: "reply-1" })])).toBe(false);
    expect(
      undoable([
        made(
          "a",
          { editApplied: true, changes: [change] },
          {
            status: "needs-review",
          },
        ),
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
    expect(undoable([earlier, latest])).toBe(true);
    // Another thread's change isn't this thread's.
    expect(
      undoable([
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
