import type { CommentAiRequest } from "@shared/comment-ai";
import { describe, expect, it } from "vitest";

import {
  commentAiRequestsRefetchInterval,
  latestCommentAiRequest,
  missingCommentAiReplyIds,
  noteCommentAiPageChanges,
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

describe("reading an open page again when comment AI finishes", () => {
  const finished = (
    id: string,
    status: CommentAiRequest["status"],
    result: CommentAiRequest["result"],
  ) => ({ ...request(id, "thread-a", status, "2026-09-14T10:00:00Z"), result });
  const threads = (...ids: string[]) => [
    { comments: ids.map((id) => ({ id })) },
  ];

  it("names the replies and receipts finished requests wrote that aren't loaded", () => {
    const requests = [
      finished("a", "replied", { commentId: "reply-b" }),
      finished("b", "suggested", {
        commentId: "receipt-a",
        suggestionId: "suggestion-1",
      }),
      finished("c", "resolved", { commentId: "receipt-c", editApplied: true }),
    ];
    expect(missingCommentAiReplyIds(requests, threads("root-a"))).toBe(
      "receipt-a receipt-c reply-b",
    );
    expect(
      missingCommentAiReplyIds(requests, threads("receipt-a", "reply-b")),
    ).toBe("receipt-c");
    expect(
      missingCommentAiReplyIds(
        requests,
        threads("receipt-a", "receipt-c", "reply-b"),
      ),
    ).toBe("");
  });

  it("waits for the first load and ignores runs still going", () => {
    const replied = finished("a", "replied", { commentId: "reply-a" });
    expect(missingCommentAiReplyIds([replied], undefined)).toBe("");
    expect(
      missingCommentAiReplyIds(
        [finished("b", "running", { commentId: "reply-b" })],
        threads(),
      ),
    ).toBe("");
    expect(
      missingCommentAiReplyIds([finished("c", "failed", null)], threads()),
    ).toBe("");
  });

  it("notes a change to the page only from a run it saw running", () => {
    const known = new Map<string, CommentAiRequest["status"]>();
    const running = finished("a", "running", null);
    const applied = finished("a", "resolved", {
      commentId: "receipt-a",
      editApplied: true,
    });
    // Already finished when the page opened: the page read has it.
    expect(
      noteCommentAiPageChanges(known, [
        finished("b", "resolved", applied.result),
      ]),
    ).toBe(false);
    expect(noteCommentAiPageChanges(known, [running])).toBe(false);
    expect(noteCommentAiPageChanges(known, [applied])).toBe(true);
    // Seen once, not again on the next poll.
    expect(noteCommentAiPageChanges(known, [applied])).toBe(false);
  });

  it("leaves the page alone for a run that changed nothing in it", () => {
    const known = new Map<string, CommentAiRequest["status"]>([
      ["a", "running"],
      ["b", "running"],
      ["c", "refreshing"],
    ]);
    expect(
      noteCommentAiPageChanges(known, [
        finished("a", "replied", { commentId: "reply-a" }),
        finished("b", "suggested", { suggestionId: "suggestion-b" }),
        finished("c", "needs-review", null),
      ]),
    ).toBe(false);
    // A change left for review is in the page too.
    known.set("d", "running");
    expect(
      noteCommentAiPageChanges(known, [
        finished("d", "needs-review", { editApplied: true }),
      ]),
    ).toBe(true);
  });
});
