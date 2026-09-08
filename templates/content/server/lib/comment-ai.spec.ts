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
    expect(await getDb().select().from(schema.commentAiRequests)).toHaveLength(
      1,
    );
  });

  it("atomically reclaims a failed request once for concurrent retries", async () => {
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
    expect(retries.filter((result) => result.dispatch)).toHaveLength(1);
    expect(retries.every((result) => result.status === "queued")).toBe(true);
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
