import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-ai-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "comment-ai-owner@example.com";
const OUTSIDER = "comment-ai-outsider@example.com";
const DOCUMENT_ID = "comment-ai-page";
const THREAD_ID = "comment-ai-thread";
const ROOT_COMMENT_ID = "comment-ai-root";
const FIRST_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_REQUEST_ID = "33333333-3333-4333-8333-333333333333";

let getDb: typeof import("../db/index.js").getDb;
let schema: typeof import("../db/schema.js");
let commentAi: typeof import("./comment-ai.js");
let commentIdForIdempotency: typeof import("../../actions/add-comment.js").commentIdForIdempotency;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

const asClassifier = <T>(
  requestId: string,
  threadId: string,
  run: () => Promise<T>,
) =>
  runWithRequestContext(
    {
      userEmail: OWNER,
      run: {
        threadId,
        allowedActionNames: ["submit-comment-ai-classification"],
        actionScope: { kind: "content-comment-ai-classifier", requestId },
      },
    },
    run,
  );

function startArgs(requestId = FIRST_REQUEST_ID) {
  return {
    requestId,
    documentId: DOCUMENT_ID,
    threadId: THREAD_ID,
    rootCommentId: ROOT_COMMENT_ID,
    intent: "reply" as const,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  commentAi = await import("./comment-ai.js");
  ({ commentIdForIdempotency } = await import("../../actions/add-comment.js"));
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.commentAiRequests);
  await getDb().delete(schema.documentComments);
  await getDb().delete(schema.documents);

  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Comment AI page",
    content: "Page body",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.documentComments).values({
    id: ROOT_COMMENT_ID,
    ownerEmail: OWNER,
    documentId: DOCUMENT_ID,
    threadId: THREAD_ID,
    parentId: null,
    content: "Please explain this paragraph",
    authorEmail: OWNER,
    authorName: "Owner",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("comment AI request persistence", () => {
  it("persists an Auto submission and exposes its exact private classifier session", async () => {
    const result = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest({
        ...startArgs(),
        intent: undefined,
        submittedMode: "auto",
        instructions: "Please decide whether this asks for a change.",
        provider: "OpenAI",
        model: "gpt-5-6-sol",
        engine: "builder",
      }),
    );

    expect(result).toMatchObject({
      submittedMode: "auto",
      instructions: "Please decide whether this asks for a change.",
      submittedProvider: "OpenAI",
      submittedModel: "gpt-5-6-sol",
      submittedEngine: "builder",
      intent: null,
      status: "classifying",
      dispatch: true,
      pendingSession: {
        phase: "classification",
        backgroundSession: {
          operationId: `${FIRST_REQUEST_ID}:classification`,
          scope: {
            type: "content-comment-ai-classifier",
            id: FIRST_REQUEST_ID,
          },
          actionScope: {
            kind: "content-comment-ai-classifier",
            requestId: FIRST_REQUEST_ID,
          },
        },
      },
    });
    expect(result.pendingSession.backgroundSession.threadId).toMatch(
      /^comment-ai-classifier-/,
    );
    const stored = await asUser(OWNER, () =>
      commentAi.loadCommentAiRequest(FIRST_REQUEST_ID),
    );
    expect(stored).toMatchObject({
      submittedMode: "auto",
      submittedProvider: "OpenAI",
      submittedModel: "gpt-5-6-sol",
      submittedEngine: "builder",
      status: "classifying",
    });
    expect(stored.classificationTurnId).toBeTruthy();
  });

  it("persists one finite classifier result and resumes an intent-bound execution session", async () => {
    const started = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest({
        ...startArgs(),
        intent: undefined,
        submittedMode: "auto",
        instructions: "Make this clearer and resolve the comment.",
      }),
    );
    const classifierThreadId =
      started.pendingSession.backgroundSession.threadId;

    const classified = await asClassifier(
      FIRST_REQUEST_ID,
      classifierThreadId,
      () => commentAi.submitCommentAiClassification("apply-resolve"),
    );
    expect(classified).toMatchObject({
      request: {
        intent: "apply-resolve",
        status: "classified",
        submittedModel: null,
        submittedEngine: null,
      },
      pendingSession: {
        phase: "execution",
        backgroundSession: {
          operationId: FIRST_REQUEST_ID,
          actionScope: {
            kind: "content-comment-ai",
            requestId: FIRST_REQUEST_ID,
          },
        },
      },
    });
    const lateClassifierCompletion = await asUser(OWNER, () =>
      commentAi.reconcileCommentAiSession({
        operationId: FIRST_REQUEST_ID,
        threadId: started.pendingSession.backgroundSession.threadId,
        turnId: started.pendingSession.backgroundSession.turnId,
        status: "completed",
      }),
    );
    expect(lateClassifierCompletion).toMatchObject({
      intent: "apply-resolve",
      status: "classified",
    });
    await expect(
      asClassifier(FIRST_REQUEST_ID, classifierThreadId, () =>
        commentAi.submitCommentAiClassification("reply"),
      ),
    ).rejects.toThrow("no longer awaiting classification");
  });

  it("continues only resolved replies on the prior exact agent thread", async () => {
    const prior = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest(startArgs()),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "replied" })
      .where(eq(schema.commentAiRequests.id, FIRST_REQUEST_ID));

    const started = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest({
        ...startArgs(SECOND_REQUEST_ID),
        intent: undefined,
        submittedMode: "auto",
        instructions: "Can you explain that further?",
        continuationOfRequestId: FIRST_REQUEST_ID,
      }),
    );
    expect(started.continuationOfRequestId).toBe(FIRST_REQUEST_ID);
    const freshExecutionThread = started.agentThreadId;
    const classifierThread = started.pendingSession.backgroundSession.threadId;
    const classified = await asClassifier(
      SECOND_REQUEST_ID,
      classifierThread,
      () => commentAi.submitCommentAiClassification("reply"),
    );

    expect(classified.request.agentThreadId).toBe(prior.agentThreadId);
    expect(classified.request.agentThreadId).not.toBe(freshExecutionThread);
    expect(classified.request.continuationOfRequestId).toBe(FIRST_REQUEST_ID);
  });

  it("continues an explicit reply on the prior exact agent thread", async () => {
    const prior = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest(startArgs()),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "replied" })
      .where(eq(schema.commentAiRequests.id, FIRST_REQUEST_ID));

    const continued = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest({
        ...startArgs(SECOND_REQUEST_ID),
        continuationOfRequestId: FIRST_REQUEST_ID,
      }),
    );

    expect(continued).toMatchObject({
      intent: "reply",
      continuationOfRequestId: FIRST_REQUEST_ID,
      agentThreadId: prior.agentThreadId,
      pendingSession: { phase: "execution" },
    });
  });

  it("keeps a fresh execution thread when a continuation resolves to suggest", async () => {
    const prior = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest(startArgs()),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "replied" })
      .where(eq(schema.commentAiRequests.id, FIRST_REQUEST_ID));
    const started = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest({
        ...startArgs(SECOND_REQUEST_ID),
        intent: undefined,
        submittedMode: "auto",
        instructions: "Maybe propose a revision.",
        continuationOfRequestId: FIRST_REQUEST_ID,
      }),
    );
    const classified = await asClassifier(
      SECOND_REQUEST_ID,
      started.pendingSession.backgroundSession.threadId,
      () => commentAi.submitCommentAiClassification("suggest"),
    );

    expect(classified.request.agentThreadId).toBe(started.agentThreadId);
    expect(classified.request.agentThreadId).not.toBe(prior.agentThreadId);
  });

  it("fails closed when a classifier terminates without submitting an intent", async () => {
    const started = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest({
        ...startArgs(),
        intent: undefined,
        submittedMode: "auto",
        instructions: "What should happen here?",
      }),
    );
    const session = started.pendingSession.backgroundSession;
    const failed = await asUser(OWNER, () =>
      commentAi.reconcileCommentAiSession({
        operationId: FIRST_REQUEST_ID,
        threadId: session.threadId,
        turnId: session.turnId,
        status: "completed",
      }),
    );

    expect(failed).toMatchObject({
      intent: null,
      status: "needs-review",
      errorCode: "run_unavailable",
    });
  });

  it("binds a request ID immutably and keeps it private to its requester", async () => {
    await asUser(OWNER, () => commentAi.startCommentAiRequest(startArgs()));

    await expect(
      asUser(OWNER, () =>
        commentAi.startCommentAiRequest({
          ...startArgs(),
          intent: "apply-resolve",
        }),
      ),
    ).rejects.toThrow("already bound to another comment or intent");
    await expect(
      asUser(OWNER, () =>
        commentAi.startCommentAiRequest({
          ...startArgs(),
          provider: "Anthropic",
        }),
      ),
    ).rejects.toThrow("already bound to another comment or intent");
    await expect(
      asUser(OUTSIDER, () => commentAi.loadCommentAiRequest(FIRST_REQUEST_ID)),
    ).rejects.toThrow("Comment AI request not found");
  });

  it("reuses a queued or running request for the same requester and thread", async () => {
    const first = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest(startArgs()),
    );
    const queuedReplay = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest(startArgs(SECOND_REQUEST_ID)),
    );
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "running" })
      .where(eq(schema.commentAiRequests.id, FIRST_REQUEST_ID));
    const runningReplay = await asUser(OWNER, () =>
      commentAi.startCommentAiRequest(startArgs(THIRD_REQUEST_ID)),
    );

    expect(queuedReplay.requestId).toBe(first.requestId);
    expect(runningReplay.requestId).toBe(first.requestId);
    expect(first.outcome).toBe("confirmed-start");
    expect(queuedReplay.outcome).toBe("busy");
    expect(runningReplay.outcome).toBe("busy");
    const rows = await getDb().select().from(schema.commentAiRequests);
    expect(rows).toHaveLength(1);
  });

  it("reconciles simultaneous starts with distinct IDs into one active request", async () => {
    const results = await Promise.all(
      [FIRST_REQUEST_ID, SECOND_REQUEST_ID, THIRD_REQUEST_ID].map((id) =>
        asUser(OWNER, () => commentAi.startCommentAiRequest(startArgs(id))),
      ),
    );
    expect(new Set(results.map((result) => result.requestId)).size).toBe(1);
    expect(results.filter((result) => result.dispatch)).toHaveLength(1);
    expect(
      results.filter((result) => result.outcome === "confirmed-start"),
    ).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "busy")).toHaveLength(
      2,
    );
    expect(await getDb().select().from(schema.commentAiRequests)).toHaveLength(
      1,
    );
  });

  it("does not redispatch a failed request on its already terminal agent turn", async () => {
    await asUser(OWNER, () => commentAi.startCommentAiRequest(startArgs()));
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "needs-review" })
      .where(eq(schema.commentAiRequests.id, FIRST_REQUEST_ID));
    const retries = await Promise.all(
      [1, 2, 3].map(() =>
        asUser(OWNER, () => commentAi.startCommentAiRequest(startArgs())),
      ),
    );
    expect(retries.every((result) => !result.dispatch)).toBe(true);
    expect(retries.every((result) => result.status === "needs-review")).toBe(
      true,
    );
  });

  it("excludes only its deterministic receipt from source drift detection", async () => {
    await asUser(OWNER, () => commentAi.startCommentAiRequest(startArgs()));
    const request = await asUser(OWNER, () =>
      commentAi.loadCommentAiRequest(FIRST_REQUEST_ID),
    );
    const receiptId = commentIdForIdempotency(
      OWNER,
      DOCUMENT_ID,
      `comment-ai:${FIRST_REQUEST_ID}:reply`,
    );
    const now = new Date().toISOString();
    await getDb().insert(schema.documentComments).values({
      id: receiptId,
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      threadId: THREAD_ID,
      parentId: ROOT_COMMENT_ID,
      content: "AI reply",
      authorEmail: OWNER,
      authorName: "AI",
      actorKind: "agent",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      asUser(OWNER, () => commentAi.assertCommentAiSourceUnchanged(request)),
    ).resolves.toMatchObject({ root: { id: ROOT_COMMENT_ID } });

    await getDb()
      .update(schema.documentComments)
      .set({ content: "The original comment changed" })
      .where(eq(schema.documentComments.id, ROOT_COMMENT_ID));
    await expect(
      asUser(OWNER, () => commentAi.assertCommentAiSourceUnchanged(request)),
    ).rejects.toThrow("comment changed during this request");
  });

  it("preserves a terminal success and its receipt after a late failure", async () => {
    await asUser(OWNER, () => commentAi.startCommentAiRequest(startArgs()));
    const request = await asUser(OWNER, () =>
      commentAi.loadCommentAiRequest(FIRST_REQUEST_ID),
    );

    await asUser(OWNER, () =>
      commentAi.updateCommentAiRequest(request, {
        status: "replied",
        result: { commentId: "saved-comment" },
      }),
    );
    const late = await asUser(OWNER, () =>
      commentAi.updateCommentAiRequest(request, {
        status: "failed",
        error: "late worker failure",
      }),
    );

    expect(late).toMatchObject({
      status: "replied",
      result: { commentId: "saved-comment" },
      error: null,
    });
  });
});
