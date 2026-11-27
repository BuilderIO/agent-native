import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createThread,
  getThread,
  runWithRequestContext,
} from "@agent-native/core/server";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-ai-follow-ups-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "comment-ai-owner@example.com";
const DOCUMENT_ID = "comment-ai-page";
const ROOT_A = "comment-ai-root-a";
const OP_A = "11111111-1111-4111-8111-111111111111";
const OP_B = "22222222-2222-4222-8222-222222222222";
const OP_C = "33333333-3333-4333-8333-333333333333";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let commentAi: typeof import("../server/lib/comment-ai.js");
let replyRequest: typeof import("./reply-to-comment-ai-request.js").default;

const asUser = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

function startArgs(requestId: string, rootCommentId: string) {
  return {
    requestId,
    documentId: DOCUMENT_ID,
    threadId: rootCommentId,
    rootCommentId,
    intent: "reply" as const,
  };
}

function runOperation<T>(
  operationId: string,
  agentThreadId: string,
  run: () => Promise<T>,
  runId = `run-${operationId}`,
) {
  return runWithRequestContext(
    {
      userEmail: OWNER,
      run: {
        actionScope: { kind: "content-comment-ai", requestId: operationId },
        threadId: agentThreadId,
        runId,
        model: "openai/gpt-5.6-sol",
      },
    },
    run,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const { creativeContextDbPlugin } =
    await import("@agent-native/creative-context/server");
  await creativeContextDbPlugin(undefined as never);
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  commentAi = await import("../server/lib/comment-ai.js");
  replyRequest = (await import("./reply-to-comment-ai-request.js")).default;
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.commentAiAttempts);
  await getDb().delete(schema.commentAiRequests);
  await getDb().delete(schema.documentComments);
  await getDb().delete(schema.documents);

  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Follow-up page",
    content: "Alpha one. Beta two.",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.documentComments).values({
    id: ROOT_A,
    ownerEmail: OWNER,
    documentId: DOCUMENT_ID,
    threadId: ROOT_A,
    parentId: null,
    content: "Please change Alpha",
    authorEmail: OWNER,
    authorName: "Owner",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("comment AI follow-ups and Retry", () => {
  type Session = {
    operationId: string;
    threadId: string;
    turnId: string;
    scope: { type: string; id: string };
    actionScope: unknown;
  };

  async function openChat(session: Session) {
    const existing = await getThread(session.threadId);
    if (
      existing?.scope &&
      (existing.scope.type !== session.scope.type ||
        existing.scope.id !== session.scope.id)
    ) {
      throw new Error("Thread not found");
    }
    if (!existing) {
      await createThread(OWNER, {
        id: session.threadId,
        scope: session.scope,
      });
    }
    return asUser(() =>
      commentAi.resolveCommentAiActionSurface({
        ownerEmail: OWNER,
        threadId: session.threadId,
        queuedMessageId: session.operationId,
        requestedTurnId: session.turnId,
        actionScope: session.actionScope as never,
      }),
    );
  }

  async function answer(session: Session, content: string) {
    await openChat(session);
    return runOperation(
      session.operationId,
      session.threadId,
      async () => {
        const request = await commentAi.requireCommentAiRequest("reply");
        const { attempt } = await commentAi.beginCommentAiAttempt(request);
        if (!attempt) throw new Error("The request has no attempt to answer");
        return replyRequest.run(
          { attemptId: attempt.id, content },
          { caller: "tool", userEmail: OWNER },
        );
      },
      `run-${session.turnId}`,
    );
  }

  function followUp(requestId: string, continuationOfRequestId: string) {
    return asUser(() =>
      commentAi.startCommentAiRequest({
        requestId,
        documentId: DOCUMENT_ID,
        threadId: ROOT_A,
        rootCommentId: ROOT_A,
        intent: "reply",
        instructions: "Why that word?",
        continuationOfRequestId,
      }),
    );
  }

  async function retry(requestId: string, expectedUpdatedAt?: string) {
    const rows = await getDb()
      .select({ updatedAt: schema.commentAiRequests.updatedAt })
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, requestId));
    const row = rows[0] as (typeof rows)[number] | undefined;
    if (!row) throw new Error("The request to retry is missing");
    return asUser(() =>
      commentAi.restartCommentAiRequest({
        requestId,
        expectedUpdatedAt: expectedUpdatedAt ?? row.updatedAt,
      }),
    );
  }

  async function humanReply(id: string) {
    const now = new Date().toISOString();
    await getDb().insert(schema.documentComments).values({
      id,
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      threadId: ROOT_A,
      parentId: ROOT_A,
      content: "Also keep the first sentence short",
      authorEmail: OWNER,
      authorName: "Owner",
      createdAt: now,
      updatedAt: now,
    });
  }

  it("answers each question after the AI answered, in a chat of its own", async () => {
    const first = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    expect(await answer(first.backgroundSession, "First answer")).toMatchObject(
      { status: "replied" },
    );

    const second = await followUp(OP_B, OP_A);
    expect(
      await answer(second.backgroundSession, "Second answer"),
    ).toMatchObject({ status: "replied" });
    const third = await followUp(OP_C, OP_B);
    expect(await answer(third.backgroundSession, "Third answer")).toMatchObject(
      { status: "replied" },
    );

    expect(
      new Set([first.agentThreadId, second.agentThreadId, third.agentThreadId])
        .size,
    ).toBe(3);
    const replies = await getDb()
      .select({ content: schema.documentComments.content })
      .from(schema.documentComments)
      .where(eq(schema.documentComments.parentId, ROOT_A));
    expect(replies.map((reply) => reply.content).sort()).toEqual([
      "First answer",
      "Second answer",
      "Third answer",
    ]);
  });

  it("starts a request stopped by a reply in its thread over from the discussion as it is now", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await openChat(started.backgroundSession);
    await humanReply("comment-ai-human-reply");
    await expect(
      runOperation(OP_A, started.backgroundSession.threadId, async () => {
        const request = await commentAi.requireCommentAiRequest("reply");
        return commentAi.beginCommentAiAttempt(request);
      }),
    ).rejects.toMatchObject({ code: "discussion_changed" });

    const restarted = await retry(OP_A);
    expect(restarted).toMatchObject({
      operationId: OP_A,
      status: "queued",
      dispatch: true,
      errorCode: null,
      error: null,
      pendingSession: { phase: "execution" },
    });
    expect(restarted.agentThreadId).not.toBe(started.agentThreadId);
    await expect(
      runOperation(OP_A, started.backgroundSession.threadId, () =>
        commentAi.requireCommentAiRequest("reply"),
      ),
    ).rejects.toThrow("not bound");

    expect(
      await answer(restarted.backgroundSession, "Answer after the reply"),
    ).toMatchObject({ status: "replied", errorCode: null });
  });

  it("gives a follow-up that borrowed the prior chat one of its own on Retry", async () => {
    const first = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await answer(first.backgroundSession, "First answer");
    await followUp(OP_B, OP_A);
    const borrowedThreadId = first.backgroundSession.threadId;
    const borrowedTurnId = backgroundAgentTurnIdForReceipt(
      borrowedThreadId,
      OP_B,
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({
        agentThreadId: borrowedThreadId,
        agentTurnId: borrowedTurnId,
        status: "needs-review",
        errorCode: "operation_failed",
        error:
          "Background agent session was rejected (HTTP 404): Thread not found",
      })
      .where(eq(schema.commentAiRequests.id, OP_B));
    await expect(
      openChat({
        operationId: OP_B,
        threadId: borrowedThreadId,
        turnId: borrowedTurnId,
        scope: { type: "content-comment-ai", id: OP_B },
        actionScope: { kind: "content-comment-ai", requestId: OP_B },
      }),
    ).rejects.toThrow("Thread not found");

    const restarted = await retry(OP_B);
    expect(restarted.agentThreadId).not.toBe(borrowedThreadId);
    expect(
      await answer(restarted.backgroundSession, "Second answer"),
    ).toMatchObject({ status: "replied" });
  });

  it("sends a stopped Auto request back to a classifier of its own", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest({
        requestId: OP_A,
        documentId: DOCUMENT_ID,
        threadId: ROOT_A,
        rootCommentId: ROOT_A,
        submittedMode: "auto",
        instructions: "What do you think?",
      }),
    );
    await asUser(() =>
      commentAi.reconcileCommentAiSession({
        operationId: OP_A,
        threadId: started.backgroundSession.threadId,
        turnId: started.backgroundSession.turnId,
        status: "errored",
        runId: "run-classifier",
      }),
    );

    const restarted = await retry(OP_A);
    expect(restarted).toMatchObject({
      status: "classifying",
      pendingSession: { phase: "classification" },
    });
    expect(restarted.backgroundSession.threadId).not.toBe(
      started.backgroundSession.threadId,
    );
    const classified = await runWithRequestContext(
      {
        userEmail: OWNER,
        run: {
          threadId: restarted.backgroundSession.threadId,
          actionScope: {
            kind: "content-comment-ai-classifier",
            requestId: OP_A,
          },
        },
      },
      () => commentAi.submitCommentAiClassification("reply"),
    );
    expect(classified.request).toMatchObject({
      status: "classified",
      agentThreadId: restarted.agentThreadId,
    });
  });

  it("refuses Retry while the AI works, on a resolved thread, and behind a newer request", async () => {
    await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "running" })
      .where(eq(schema.commentAiRequests.id, OP_A));
    await expect(retry(OP_A)).rejects.toMatchObject({
      errorCode: "comment_ai_operation_conflict",
    });

    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "needs-review" })
      .where(eq(schema.commentAiRequests.id, OP_A));
    await followUp(OP_B, OP_A);
    await expect(retry(OP_A)).rejects.toMatchObject({
      errorCode: "comment_ai_already_active",
    });

    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "cancelled" })
      .where(eq(schema.commentAiRequests.id, OP_B));
    await getDb()
      .update(schema.documentComments)
      .set({ resolved: 1 })
      .where(eq(schema.documentComments.id, ROOT_A));
    await expect(retry(OP_A)).rejects.toMatchObject({
      errorCode: "comment_ai_thread_resolved",
    });
  });

  it("refuses Retry after the AI changed the page, and from a tab that saw an older version", async () => {
    await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "needs-review", updatedAt: "2026-11-25T12:00:00.000Z" })
      .where(eq(schema.commentAiRequests.id, OP_A));
    await expect(retry(OP_A, "2026-11-25T11:00:00.000Z")).rejects.toMatchObject(
      { errorCode: "comment_ai_operation_conflict" },
    );

    await getDb()
      .update(schema.commentAiRequests)
      .set({ resultJson: JSON.stringify({ editApplied: true }) })
      .where(eq(schema.commentAiRequests.id, OP_A));
    await expect(retry(OP_A)).rejects.toMatchObject({
      errorCode: "comment_ai_edit_applied",
    });
  });

  it("keeps the old chat from writing to a request Retry started over", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    const oldThreadId = started.backgroundSession.threadId;
    await openChat(started.backgroundSession);
    const stale = await runOperation(OP_A, oldThreadId, () =>
      commentAi.requireCommentAiRequest("reply"),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "needs-review" })
      .where(eq(schema.commentAiRequests.id, OP_A));
    const restarted = await retry(OP_A);

    await expect(
      runOperation(OP_A, oldThreadId, () =>
        commentAi.beginCommentAiAttempt(stale),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_thread_conflict" });
    expect(
      await asUser(() =>
        commentAi.updateCommentAiRequest(stale, { status: "replied" }),
      ),
    ).toMatchObject({
      status: "queued",
      agentThreadId: restarted.agentThreadId,
    });
    expect(
      await answer(restarted.backgroundSession, "Answer from the new chat"),
    ).toMatchObject({ status: "replied" });
  });

  it("keeps the old classifier from classifying a request Retry started over", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest({
        requestId: OP_A,
        documentId: DOCUMENT_ID,
        threadId: ROOT_A,
        rootCommentId: ROOT_A,
        submittedMode: "auto",
        instructions: "What do you think?",
      }),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "needs-review" })
      .where(eq(schema.commentAiRequests.id, OP_A));
    const restarted = await retry(OP_A);
    const classify = (threadId: string) =>
      runWithRequestContext(
        {
          userEmail: OWNER,
          run: {
            threadId,
            actionScope: {
              kind: "content-comment-ai-classifier",
              requestId: OP_A,
            },
          },
        },
        () => commentAi.submitCommentAiClassification("reply"),
      );

    await expect(classify(started.backgroundSession.threadId)).rejects.toThrow(
      "not bound",
    );
    expect(
      (await classify(restarted.backgroundSession.threadId)).request,
    ).toMatchObject({ status: "classified" });
  });
});
