import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { createThread, runWithRequestContext } from "@agent-native/core/server";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-ai-concurrency-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "comment-ai-owner@example.com";
const OTHER_USER = "comment-ai-collaborator@example.com";
const DOCUMENT_ID = "comment-ai-page";
const ROOT_A = "comment-ai-root-a";
const ROOT_B = "comment-ai-root-b";
const OP_A = "11111111-1111-4111-8111-111111111111";
const OP_B = "22222222-2222-4222-8222-222222222222";
const OP_C = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "durable-turn-id";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let commentAi: typeof import("../server/lib/comment-ai.js");
let applyRequest: typeof import("./apply-comment-ai-request.js").default;
let addComment: typeof import("./add-comment.js").default;
let commentIdForIdempotency: typeof import("./add-comment.js").commentIdForIdempotency;
let replyRequest: typeof import("./reply-to-comment-ai-request.js").default;

const asUser = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

function startArgs(
  requestId: string,
  rootCommentId: string,
  intent: "reply" | "suggest" | "apply-resolve" = "reply",
) {
  return {
    requestId,
    agentThreadId: `agent-thread-${requestId}`,
    documentId: DOCUMENT_ID,
    threadId: rootCommentId,
    rootCommentId,
    intent,
  };
}

function runOperation<T>(
  operationId: string,
  agentThreadId: string,
  run: () => Promise<T>,
) {
  return runWithRequestContext(
    {
      userEmail: OWNER,
      run: {
        actionScope: { kind: "content-comment-ai", requestId: operationId },
        threadId: agentThreadId,
        runId: `run-${operationId}`,
        model: "openai/gpt-5.6-sol",
      },
    },
    run,
  );
}

async function insertRoot(id: string, content: string) {
  const now = new Date().toISOString();
  await getDb().insert(schema.documentComments).values({
    id,
    ownerEmail: OWNER,
    documentId: DOCUMENT_ID,
    threadId: id,
    parentId: null,
    content,
    authorEmail: OWNER,
    authorName: "Owner",
    createdAt: now,
    updatedAt: now,
  });
}

async function bindTurn(operationId: string) {
  await getDb()
    .update(schema.commentAiRequests)
    .set({ agentTurnId: TURN_ID })
    .where(eq(schema.commentAiRequests.id, operationId));
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
  applyRequest = (await import("./apply-comment-ai-request.js")).default;
  const addCommentModule = await import("./add-comment.js");
  addComment = addCommentModule.default;
  commentIdForIdempotency = addCommentModule.commentIdForIdempotency;
  replyRequest = (await import("./reply-to-comment-ai-request.js")).default;
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.commentAiAttempts);
  await getDb().delete(schema.commentAiRequests);
  await getDb().delete(schema.documentComments);
  await getDb().delete(schema.documentShares);
  await getDb().delete(schema.documentEditReceipts);
  await getDb().delete(schema.documents);

  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Concurrency page",
    content: "Alpha one. Beta two.",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await insertRoot(ROOT_A, "Please change Alpha");
  await insertRoot(ROOT_B, "Please change Beta");
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("comment AI operation isolation", () => {
  it("reconciles legacy cross-user active rows before enforcing the global source guard", async () => {
    await getDbExec().execute(
      "DROP INDEX IF EXISTS comment_ai_requests_active_comment_idx",
    );
    const now = new Date().toISOString();
    const base = {
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      threadId: ROOT_A,
      rootCommentId: ROOT_A,
      fieldId: "body",
      intent: "reply",
      status: "queued",
      threadDigest: "digest",
      snapshotJson: "[]",
      baseRevision: "revision",
      suggestionRevision: now,
      createdAt: now,
      updatedAt: now,
    };
    await getDb()
      .insert(schema.commentAiRequests)
      .values([
        { ...base, id: OP_A, requesterEmail: OWNER },
        { ...base, id: OP_B, requesterEmail: OTHER_USER },
      ]);

    await getDbExec().execute(`WITH ranked_active AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY document_id, root_comment_id
        ORDER BY created_at ASC, id ASC
      ) AS active_rank
      FROM comment_ai_requests
      WHERE status IN ('queued', 'running', 'refreshing')
    )
    UPDATE comment_ai_requests AS request
    SET status = 'needs-review', error_code = 'operation_failed',
        error = 'Another Ask AI operation was already active for this comment during the concurrency upgrade',
        updated_at = CURRENT_TIMESTAMP
    FROM ranked_active
    WHERE request.id = ranked_active.id AND ranked_active.active_rank > 1`);
    await getDbExec()
      .execute(`CREATE UNIQUE INDEX comment_ai_requests_active_comment_idx
      ON comment_ai_requests (document_id, root_comment_id)
      WHERE status IN ('queued', 'running', 'refreshing')`);

    const rows = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .orderBy(schema.commentAiRequests.id);
    expect(rows.map((row) => [row.id, row.status, row.errorCode])).toEqual([
      [OP_A, "queued", null],
      [OP_B, "needs-review", "operation_failed"],
    ]);
  });

  it("starts two comments concurrently with distinct operation and agent thread ids", async () => {
    const [first, second] = await Promise.all([
      asUser(() => commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A))),
      asUser(() => commentAi.startCommentAiRequest(startArgs(OP_B, ROOT_B))),
    ]);

    expect(first).toMatchObject({
      operationId: OP_A,
      agentThreadId: `agent-thread-${OP_A}`,
      dispatch: true,
      backgroundSession: {
        operationId: OP_A,
        threadId: `agent-thread-${OP_A}`,
        scope: { type: "content-comment-ai", id: OP_A },
      },
    });
    expect(second).toMatchObject({
      operationId: OP_B,
      agentThreadId: `agent-thread-${OP_B}`,
      dispatch: true,
    });
    expect(first.operationId).not.toBe(second.operationId);
    expect(first.agentThreadId).not.toBe(second.agentThreadId);
  });

  it("does not reclaim a terminal agent turn when the domain operation needs review", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({
        status: "needs-review",
        errorCode: "operation_failed",
        error: "Resolution acknowledgement was not saved",
      })
      .where(eq(schema.commentAiRequests.id, OP_A));

    const replay = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );

    expect(replay).toMatchObject({
      operationId: OP_A,
      agentThreadId: started.agentThreadId,
      agentTurnId: started.agentTurnId,
      status: "needs-review",
      dispatch: false,
    });
  });

  it("reconciles simultaneous starts for one comment into one active operation", async () => {
    const results = await Promise.all(
      [OP_A, OP_B, OP_C].map((id) =>
        asUser(() => commentAi.startCommentAiRequest(startArgs(id, ROOT_A))),
      ),
    );

    expect(new Set(results.map((result) => result.operationId))).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.dispatch)).toHaveLength(1);
    expect(await getDb().select().from(schema.commentAiRequests)).toHaveLength(
      1,
    );
  });

  it("rejects a second user's active operation for the same source comment", async () => {
    await getDb().insert(schema.documentShares).values({
      id: crypto.randomUUID(),
      resourceId: DOCUMENT_ID,
      principalType: "user",
      principalId: OTHER_USER,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );

    await expect(
      runWithRequestContext({ userEmail: OTHER_USER }, () =>
        commentAi.startCommentAiRequest(startArgs(OP_B, ROOT_A)),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_already_active" });
  });

  it("reads the latest Page after an unrelated edit instead of rejecting the click-time revision", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await getDb()
      .update(schema.documents)
      .set({
        content: "Unrelated preface. Alpha one. Beta two.",
        bodyRevision: 2,
        updatedAt: "2026-09-14T12:00:00.000Z",
      })
      .where(eq(schema.documents.id, DOCUMENT_ID));

    const attempt = await runOperation(
      OP_A,
      started.agentThreadId,
      async () => {
        const request = await commentAi.requireCommentAiRequest("reply");
        return commentAi.beginCommentAiAttempt(request);
      },
    );

    expect(attempt.attempt?.sourceRevision).toContain("body:2:");
    expect(attempt.source.document.content).toContain("Unrelated preface");
    expect(attempt.request.attemptCount).toBe(1);
  });

  it("types a changed root comment separately from an unrelated Page edit", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await getDb()
      .update(schema.documentComments)
      .set({ content: "Please change a different sentence" })
      .where(eq(schema.documentComments.id, ROOT_A));

    await expect(
      runOperation(OP_A, started.agentThreadId, async () => {
        const request = await commentAi.requireCommentAiRequest("reply");
        return commentAi.beginCommentAiAttempt(request);
      }),
    ).rejects.toMatchObject({ code: "root_comment_changed" });

    const [request] = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, OP_A));
    expect(request).toMatchObject({
      status: "needs-review",
      errorCode: "root_comment_changed",
    });
  });

  it("types an appended discussion separately from a Page edit", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    const now = new Date().toISOString();
    await getDb().insert(schema.documentComments).values({
      id: "comment-ai-human-reply",
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

    await expect(
      runOperation(OP_A, started.agentThreadId, async () => {
        const request = await commentAi.requireCommentAiRequest("reply");
        return commentAi.beginCommentAiAttempt(request);
      }),
    ).rejects.toMatchObject({ code: "discussion_changed" });
  });
});

describe("comment AI durable action binding", () => {
  it("binds the initial generated turn before client acknowledgement and repeats idempotently", async () => {
    const agentThreadId = `agent-thread-${crypto.randomUUID()}`;
    const agentTurnId = backgroundAgentTurnIdForReceipt(agentThreadId, OP_A);
    await createThread(OWNER, {
      id: agentThreadId,
      scope: { type: "content-comment-ai", id: OP_A },
    });
    await asUser(() =>
      commentAi.startCommentAiRequest({
        ...startArgs(OP_A, ROOT_A),
        agentThreadId,
      }),
    );
    const details = {
      ownerEmail: OWNER,
      threadId: agentThreadId,
      queuedMessageId: OP_A,
      requestedTurnId: agentTurnId,
      actionScope: { kind: "content-comment-ai", requestId: OP_A },
    };

    const first = await asUser(() =>
      commentAi.resolveCommentAiActionSurface(details),
    );
    const second = await asUser(() =>
      commentAi.resolveCommentAiActionSurface(details),
    );
    const [request] = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, OP_A));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      allowedActionNames: [
        "get-comment-ai-context",
        "reply-to-comment-ai-request",
      ],
      actionScope: { kind: "content-comment-ai", requestId: OP_A },
    });
    expect(request.agentTurnId).toBe(agentTurnId);
  });

  it("rejects a tampered initial turn tuple before exposing tools", async () => {
    const agentThreadId = `agent-thread-${crypto.randomUUID()}`;
    await asUser(() =>
      commentAi.startCommentAiRequest({
        ...startArgs(OP_A, ROOT_A),
        agentThreadId,
      }),
    );
    await bindTurn(OP_A);

    await expect(
      asUser(() =>
        commentAi.resolveCommentAiActionSurface({
          ownerEmail: OWNER,
          threadId: agentThreadId,
          queuedMessageId: OP_A,
          requestedTurnId: "tampered-turn",
          actionScope: { kind: "content-comment-ai", requestId: OP_A },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_turn_conflict" });
  });

  it("rejects an initial operation tuple without its requested turn even after binding", async () => {
    const agentThreadId = `agent-thread-${crypto.randomUUID()}`;
    await asUser(() =>
      commentAi.startCommentAiRequest({
        ...startArgs(OP_A, ROOT_A),
        agentThreadId,
      }),
    );
    await bindTurn(OP_A);

    await expect(
      asUser(() =>
        commentAi.resolveCommentAiActionSurface({
          ownerEmail: OWNER,
          threadId: agentThreadId,
          queuedMessageId: OP_A,
          actionScope: { kind: "content-comment-ai", requestId: OP_A },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_binding_missing" });
  });

  it("rejects a malformed explicit comment action scope before fallback", async () => {
    await expect(
      asUser(() =>
        commentAi.resolveCommentAiActionSurface({
          ownerEmail: OWNER,
          actionScope: {
            kind: "content-comment-ai",
            requestId: "not-a-request-id",
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_binding_missing" });
  });

  it("reapplies stored intent on a later full-chat send without action scope", async () => {
    const agentThreadId = `agent-thread-${crypto.randomUUID()}`;
    await createThread(OWNER, {
      id: agentThreadId,
      scope: { type: "content-comment-ai", id: OP_A },
    });
    await asUser(() =>
      commentAi.startCommentAiRequest({
        ...startArgs(OP_A, ROOT_A, "reply"),
        agentThreadId,
      }),
    );
    await bindTurn(OP_A);

    const surface = await asUser(() =>
      commentAi.resolveCommentAiActionSurface({
        ownerEmail: OWNER,
        threadId: agentThreadId,
        requestedTurnId: "later-full-chat-turn",
        queuedMessageId: "later-message",
      }),
    );
    expect(surface).toMatchObject({
      allowedActionNames: [
        "get-comment-ai-context",
        "reply-to-comment-ai-request",
      ],
      actionScope: { kind: "content-comment-ai", requestId: OP_A },
    });
  });

  it("fails closed when protected thread scope has no request binding", async () => {
    const agentThreadId = `agent-thread-${crypto.randomUUID()}`;
    await createThread(OWNER, {
      id: agentThreadId,
      scope: { type: "content-comment-ai", id: OP_C },
    });

    await expect(
      asUser(() =>
        commentAi.resolveCommentAiActionSurface({
          ownerEmail: OWNER,
          threadId: agentThreadId,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_binding_missing" });
  });
});

describe("operation-scoped refresh and commits", () => {
  it("refreshes a reply after a Page edit, then publishes once from the new basis", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A, "reply")),
    );
    const first = await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("reply");
      return commentAi.beginCommentAiAttempt(request);
    });
    await getDb()
      .update(schema.documents)
      .set({
        content: "Intro. Alpha one. Beta two.",
        bodyRevision: 2,
        updatedAt: "2026-09-14T12:01:00.000Z",
      })
      .where(eq(schema.documents.id, DOCUMENT_ID));

    const refresh = await runOperation(OP_A, started.agentThreadId, () =>
      replyRequest.run(
        { attemptId: first.attempt!.id, content: "Stale answer" },
        { caller: "tool", userEmail: OWNER },
      ),
    );
    expect(refresh).toMatchObject({
      status: "refreshing",
      refreshRequired: true,
      errorCode: "page_changed",
      nextAction: "get-comment-ai-context",
    });

    const second = await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("reply");
      return commentAi.beginCommentAiAttempt(request);
    });
    const completed = await runOperation(OP_A, started.agentThreadId, () =>
      replyRequest.run(
        { attemptId: second.attempt!.id, content: "Fresh answer" },
        { caller: "tool", userEmail: OWNER },
      ),
    );

    expect(completed).toMatchObject({
      status: "replied",
      attemptCount: 2,
      model: "openai/gpt-5.6-sol",
      result: { commentId: expect.any(String) },
    });
    const replies = await getDb()
      .select()
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.threadId, ROOT_A),
          eq(schema.documentComments.parentId, ROOT_A),
        ),
      );
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      content: "Fresh answer",
      authorModel: "openai/gpt-5.6-sol",
    });

    const replay = await runOperation(OP_A, started.agentThreadId, () =>
      replyRequest.run(
        { attemptId: second.attempt!.id, content: "Duplicate answer" },
        { caller: "tool", userEmail: OWNER },
      ),
    );
    expect(replay).toMatchObject({
      status: "replied",
      result: { commentId: replies[0].id },
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.threadId, ROOT_A),
            eq(schema.documentComments.parentId, ROOT_A),
          ),
        ),
    ).toHaveLength(1);
  });

  it("stops automatic refresh after two reasoning attempts", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A, "reply")),
    );
    const first = await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("reply");
      return commentAi.beginCommentAiAttempt(request);
    });
    await getDb()
      .update(schema.documents)
      .set({ content: "First edit. Alpha one. Beta two.", bodyRevision: 2 })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    await runOperation(OP_A, started.agentThreadId, () =>
      replyRequest.run(
        { attemptId: first.attempt!.id, content: "First stale answer" },
        { caller: "tool", userEmail: OWNER },
      ),
    );
    const second = await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("reply");
      return commentAi.beginCommentAiAttempt(request);
    });
    await getDb()
      .update(schema.documents)
      .set({ content: "Second edit. Alpha one. Beta two.", bodyRevision: 3 })
      .where(eq(schema.documents.id, DOCUMENT_ID));

    await expect(
      runOperation(OP_A, started.agentThreadId, () =>
        replyRequest.run(
          { attemptId: second.attempt!.id, content: "Second stale answer" },
          { caller: "tool", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ code: "refresh_exhausted" });
    const [request] = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, OP_A));
    expect(request).toMatchObject({
      status: "needs-review",
      attemptCount: 2,
      errorCode: "refresh_exhausted",
    });
  });

  it("rejects a late result from a superseded reasoning basis", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A, "reply")),
    );
    const first = await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("reply");
      return commentAi.beginCommentAiAttempt(request);
    });
    await getDb()
      .update(schema.documents)
      .set({ content: "Intro. Alpha one. Beta two.", bodyRevision: 2 })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    await runOperation(OP_A, started.agentThreadId, () =>
      replyRequest.run(
        { attemptId: first.attempt!.id, content: "Stale answer" },
        { caller: "tool", userEmail: OWNER },
      ),
    );
    const second = await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("reply");
      return commentAi.beginCommentAiAttempt(request);
    });

    await expect(
      runOperation(OP_A, started.agentThreadId, () =>
        replyRequest.run(
          { attemptId: first.attempt!.id, content: "Late stale answer" },
          { caller: "tool", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ code: "attempt_superseded" });
    const [request] = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, OP_A));
    expect(request).toMatchObject({
      status: "running",
      activeAttemptId: second.attempt!.id,
      attemptCount: 2,
      errorCode: null,
    });
  });

  it("allows disjoint apply operations to commit against the latest Page", async () => {
    const [startedA, startedB] = await Promise.all([
      asUser(() =>
        commentAi.startCommentAiRequest(
          startArgs(OP_A, ROOT_A, "apply-resolve"),
        ),
      ),
      asUser(() =>
        commentAi.startCommentAiRequest(
          startArgs(OP_B, ROOT_B, "apply-resolve"),
        ),
      ),
    ]);
    const [attemptA, attemptB] = await Promise.all([
      runOperation(OP_A, startedA.agentThreadId, async () => {
        const request =
          await commentAi.requireCommentAiRequest("apply-resolve");
        return commentAi.beginCommentAiAttempt(request);
      }),
      runOperation(OP_B, startedB.agentThreadId, async () => {
        const request =
          await commentAi.requireCommentAiRequest("apply-resolve");
        return commentAi.beginCommentAiAttempt(request);
      }),
    ]);

    const appliedA = await runOperation(OP_A, startedA.agentThreadId, () =>
      applyRequest.run(
        {
          attemptId: attemptA.attempt!.id,
          edits: [{ find: "Alpha one", replace: "Alpha changed" }],
          summary: "Changed Alpha",
        },
        { caller: "tool", userEmail: OWNER },
      ),
    );
    const appliedB = await runOperation(OP_B, startedB.agentThreadId, () =>
      applyRequest.run(
        {
          attemptId: attemptB.attempt!.id,
          edits: [{ find: "Beta two", replace: "Beta changed" }],
          summary: "Changed Beta",
        },
        { caller: "tool", userEmail: OWNER },
      ),
    );

    expect(appliedA.status).toBe("resolved");
    expect(appliedB.status).toBe("resolved");
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document.content).toBe("Alpha changed. Beta changed.");
  });

  it("keeps an overlapping apply open with a typed recoverable conflict", async () => {
    const [startedA, startedB] = await Promise.all([
      asUser(() =>
        commentAi.startCommentAiRequest(
          startArgs(OP_A, ROOT_A, "apply-resolve"),
        ),
      ),
      asUser(() =>
        commentAi.startCommentAiRequest(
          startArgs(OP_B, ROOT_B, "apply-resolve"),
        ),
      ),
    ]);
    const [attemptA, attemptB] = await Promise.all([
      runOperation(OP_A, startedA.agentThreadId, async () => {
        const request =
          await commentAi.requireCommentAiRequest("apply-resolve");
        return commentAi.beginCommentAiAttempt(request);
      }),
      runOperation(OP_B, startedB.agentThreadId, async () => {
        const request =
          await commentAi.requireCommentAiRequest("apply-resolve");
        return commentAi.beginCommentAiAttempt(request);
      }),
    ]);
    await runOperation(OP_A, startedA.agentThreadId, () =>
      applyRequest.run(
        {
          attemptId: attemptA.attempt!.id,
          edits: [{ find: "Alpha one", replace: "Alpha changed" }],
          summary: "Changed Alpha",
        },
        { caller: "tool", userEmail: OWNER },
      ),
    );

    await expect(
      runOperation(OP_B, startedB.agentThreadId, () =>
        applyRequest.run(
          {
            attemptId: attemptB.attempt!.id,
            edits: [{ find: "Alpha one", replace: "Another Alpha" }],
            summary: "Changed Alpha again",
          },
          { caller: "tool", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ code: "target_deleted" });

    const [request, root] = await Promise.all([
      getDb()
        .select()
        .from(schema.commentAiRequests)
        .where(eq(schema.commentAiRequests.id, OP_B))
        .then((rows) => rows[0]),
      getDb()
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.id, ROOT_B))
        .then((rows) => rows[0]),
    ]);
    expect(request).toMatchObject({
      status: "needs-review",
      errorCode: "target_deleted",
    });
    expect(root?.resolved).toBe(0);
  });

  it("resumes receipt and resolve after a verified edit without spending another reasoning attempt", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A, "apply-resolve")),
    );
    const first = await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("apply-resolve");
      return commentAi.beginCommentAiAttempt(request);
    });
    const payload = {
      edits: [{ find: "Alpha one", replace: "Alpha recovered" }],
      summary: "Changed Alpha once",
    };
    await runOperation(OP_A, started.agentThreadId, () =>
      commentAi.retainCommentAiAttemptPayload(
        first.request,
        first.attempt!.id,
        { attemptId: first.attempt!.id, ...payload },
      ),
    );
    const receiptId = commentIdForIdempotency(
      OWNER,
      DOCUMENT_ID,
      `comment-ai:${OP_A}:receipt`,
    );
    await runOperation(OP_A, started.agentThreadId, () =>
      addComment.run(
        {
          documentId: DOCUMENT_ID,
          threadId: ROOT_A,
          parentId: ROOT_A,
          content: payload.summary,
          clientOperationId: receiptId,
        },
        { caller: "tool", userEmail: OWNER },
      ),
    );
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.documents)
        .set({ content: "Alpha recovered. Beta two.", bodyRevision: 2 })
        .where(eq(schema.documents.id, DOCUMENT_ID));
      await tx
        .update(schema.commentAiAttempts)
        .set({ status: "needs-review", errorCode: "operation_failed" })
        .where(eq(schema.commentAiAttempts.id, first.attempt!.id));
      await tx
        .update(schema.commentAiRequests)
        .set({
          status: "needs-review",
          attemptCount: 2,
          resultJson: JSON.stringify({
            editApplied: true,
            commentId: receiptId,
          }),
          errorCode: "operation_failed",
        })
        .where(eq(schema.commentAiRequests.id, OP_A));
    });

    const resumed = await runOperation(
      OP_A,
      started.agentThreadId,
      async () => {
        const request =
          await commentAi.requireCommentAiRequest("apply-resolve");
        return commentAi.beginCommentAiAttempt(request);
      },
    );
    expect(resumed.attempt?.id).toBe(first.attempt?.id);
    expect(resumed.request).toMatchObject({
      status: "running",
      attemptCount: 2,
      resultJson: JSON.stringify({ editApplied: true, commentId: receiptId }),
    });

    const completed = await runOperation(OP_A, started.agentThreadId, () =>
      applyRequest.run(
        { attemptId: resumed.attempt!.id, ...payload },
        { caller: "tool", userEmail: OWNER },
      ),
    );
    expect(completed).toMatchObject({
      status: "resolved",
      attemptCount: 2,
      result: {
        editApplied: true,
        commentId: receiptId,
        resolved: true,
      },
    });
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document.content).toBe("Alpha recovered. Beta two.");
    expect(document.bodyRevision).toBe(2);
    const receipts = await getDb()
      .select()
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.threadId, ROOT_A),
          eq(schema.documentComments.parentId, ROOT_A),
        ),
      );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: completed.result?.commentId,
      content: payload.summary,
      resolved: 1,
    });
  });
});

describe("background session reconciliation", () => {
  it.each([
    ["completed", "needs-review", "run_unavailable"],
    ["truncated", "needs-review", "run_unavailable"],
    ["errored", "failed", "run_unavailable"],
    ["unavailable", "needs-review", "run_unavailable"],
    ["aborted", "cancelled", null],
  ] as const)(
    "maps %s to the persisted operation status %s",
    async (sessionStatus, operationStatus, errorCode) => {
      const started = await asUser(() =>
        commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
      );
      await bindTurn(OP_A);
      const result = await asUser(() =>
        commentAi.reconcileCommentAiSession({
          operationId: OP_A,
          threadId: started.agentThreadId,
          turnId: TURN_ID,
          status: sessionStatus,
          runId: "observed-run",
        }),
      );

      expect(result).toMatchObject({
        status: operationStatus,
        errorCode,
        runId: "observed-run",
      });
      const listed = await asUser(() =>
        commentAi.listCommentAiRequests(DOCUMENT_ID),
      );
      expect(listed.requests[0]).toMatchObject({
        status: operationStatus,
        errorCode,
      });
    },
  );

  it("keeps a verified edit reviewable when the agent is cancelled", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A, "apply-resolve")),
    );
    const [request] = await getDb()
      .update(schema.commentAiRequests)
      .set({
        status: "running",
        resultJson: JSON.stringify({ editApplied: true }),
      })
      .where(eq(schema.commentAiRequests.id, OP_A))
      .returning();
    expect(request).toBeDefined();
    await bindTurn(OP_A);

    const result = await asUser(() =>
      commentAi.reconcileCommentAiSession({
        operationId: OP_A,
        threadId: started.agentThreadId,
        turnId: TURN_ID,
        status: "aborted",
      }),
    );
    expect(result).toMatchObject({
      status: "needs-review",
      errorCode: "operation_failed",
      result: { editApplied: true },
    });
    expect(result.error).toContain("did not undo the edit");
  });

  it("keeps cancellation reviewable once a write payload is committing", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A, "apply-resolve")),
    );
    const attempt = await runOperation(
      OP_A,
      started.agentThreadId,
      async () => {
        const request =
          await commentAi.requireCommentAiRequest("apply-resolve");
        const current = await commentAi.beginCommentAiAttempt(request);
        await commentAi.retainCommentAiAttemptPayload(
          current.request,
          current.attempt!.id,
          { edits: [{ find: "Alpha one", replace: "Alpha changed" }] },
        );
        return current.attempt!;
      },
    );

    const result = await asUser(() =>
      bindTurn(OP_A).then(() =>
        commentAi.reconcileCommentAiSession({
          operationId: OP_A,
          threadId: started.agentThreadId,
          turnId: TURN_ID,
          status: "aborted",
        }),
      ),
    );
    expect(result).toMatchObject({
      status: "needs-review",
      errorCode: "operation_failed",
    });
    expect(result.error).toContain("write was being committed");
    const [savedAttempt] = await getDb()
      .select()
      .from(schema.commentAiAttempts)
      .where(eq(schema.commentAiAttempts.id, attempt.id));
    expect(savedAttempt.status).toBe("needs-review");
  });

  it("keeps a runtime failure reviewable once a write payload is committing", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A, "apply-resolve")),
    );
    await runOperation(OP_A, started.agentThreadId, async () => {
      const request = await commentAi.requireCommentAiRequest("apply-resolve");
      const current = await commentAi.beginCommentAiAttempt(request);
      await commentAi.retainCommentAiAttemptPayload(
        current.request,
        current.attempt!.id,
        { edits: [{ find: "Alpha one", replace: "Alpha changed" }] },
      );
    });

    const result = await asUser(() =>
      bindTurn(OP_A).then(() =>
        commentAi.reconcileCommentAiSession({
          operationId: OP_A,
          threadId: started.agentThreadId,
          turnId: TURN_ID,
          status: "errored",
        }),
      ),
    );
    expect(result).toMatchObject({
      status: "needs-review",
      errorCode: "operation_failed",
    });
    expect(result.error).toContain("write was being committed");
  });

  it("does not clear a persisted error when a late progress event arrives", async () => {
    const started = await asUser(() =>
      commentAi.startCommentAiRequest(startArgs(OP_A, ROOT_A)),
    );
    await asUser(() =>
      bindTurn(OP_A).then(() =>
        commentAi.reconcileCommentAiSession({
          operationId: OP_A,
          threadId: started.agentThreadId,
          turnId: TURN_ID,
          status: "errored",
          terminalReason: "Provider failed",
        }),
      ),
    );

    const result = await asUser(() =>
      commentAi.reconcileCommentAiSession({
        operationId: OP_A,
        threadId: started.agentThreadId,
        turnId: TURN_ID,
        status: "running",
      }),
    );
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "run_unavailable",
      error: "Provider failed",
    });
  });
});
