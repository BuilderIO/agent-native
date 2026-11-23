import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-ai-attempt-limit-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "attempt-limit-owner@example.com";
const DOCUMENT_ID = "attempt-limit-page";
const ROOT_ID = "attempt-limit-root";
const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = `agent-thread-${OPERATION_ID}`;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let commentAi: typeof import("../server/lib/comment-ai.js");

const asUser = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  const { creativeContextDbPlugin } =
    await import("@agent-native/creative-context/server");
  await creativeContextDbPlugin(undefined as never);
  await (await import("../server/plugins/db.js")).default(undefined as never);
  commentAi = await import("../server/lib/comment-ai.js");
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

it("reports the attempt limit without changing an unavailable retained operation", async () => {
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Attempt limit page",
    content: "Alpha one.",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.documentComments).values({
    id: ROOT_ID,
    ownerEmail: OWNER,
    documentId: DOCUMENT_ID,
    threadId: ROOT_ID,
    parentId: null,
    content: "Please answer",
    authorEmail: OWNER,
    authorName: "Owner",
    createdAt: now,
    updatedAt: now,
  });

  const started = await asUser(() =>
    commentAi.startCommentAiRequest({
      requestId: OPERATION_ID,
      agentThreadId: THREAD_ID,
      documentId: DOCUMENT_ID,
      threadId: ROOT_ID,
      rootCommentId: ROOT_ID,
      intent: "reply",
    }),
  );
  const first = await asUser(async () =>
    commentAi.beginCommentAiAttempt(
      await commentAi.loadCommentAiRequest(OPERATION_ID),
    ),
  );
  expect(first.attempt?.attemptNumber).toBe(1);
  await getDb()
    .update(schema.documents)
    .set({ content: "Intro. Alpha one.", bodyRevision: 2 })
    .where(eq(schema.documents.id, DOCUMENT_ID));
  const second = await asUser(async () =>
    commentAi.beginCommentAiAttempt(
      await commentAi.loadCommentAiRequest(OPERATION_ID),
    ),
  );
  expect(second.attempt?.attemptNumber).toBe(2);
  if (!second.attempt) throw new Error("Second attempt was not created");
  const attemptId = second.attempt.id;
  const payload = { attemptId, content: "Retained answer" };
  await asUser(() =>
    commentAi.retainCommentAiAttemptPayload(second.request, attemptId, payload),
  );
  const turnId = started.agentTurnId;
  if (!turnId) throw new Error("Agent turn was not bound");
  const reconciled = await asUser(() =>
    commentAi.reconcileCommentAiSession({
      operationId: OPERATION_ID,
      threadId: THREAD_ID,
      turnId,
      status: "unavailable",
    }),
  );
  expect(reconciled).toMatchObject({
    status: "needs-review",
    errorCode: "run_unavailable",
    attemptCount: 2,
  });

  const beforeRequest = await asUser(() =>
    commentAi.loadCommentAiRequest(OPERATION_ID),
  );
  const beforeAttempts = await getDb()
    .select()
    .from(schema.commentAiAttempts)
    .where(eq(schema.commentAiAttempts.requestId, OPERATION_ID));
  const beforeDocuments = await getDb().select().from(schema.documents);
  const beforeComments = await getDb().select().from(schema.documentComments);
  expect(beforeAttempts).toHaveLength(2);
  expect(
    beforeAttempts.find((attempt) => attempt.id === attemptId),
  ).toMatchObject({
    status: "needs-review",
    errorCode: "run_unavailable",
    payloadJson: JSON.stringify(payload),
  });

  await expect(
    asUser(() => commentAi.beginCommentAiAttempt(beforeRequest)),
  ).rejects.toMatchObject({
    code: "refresh_exhausted",
    message:
      "The AI operation reached its attempt limit. Review the retained operation before retrying.",
    recoverable: false,
  });

  expect(
    await asUser(() => commentAi.loadCommentAiRequest(OPERATION_ID)),
  ).toEqual(beforeRequest);
  expect(
    await getDb()
      .select()
      .from(schema.commentAiAttempts)
      .where(eq(schema.commentAiAttempts.requestId, OPERATION_ID)),
  ).toEqual(beforeAttempts);
  expect(await getDb().select().from(schema.documents)).toEqual(
    beforeDocuments,
  );
  expect(await getDb().select().from(schema.documentComments)).toEqual(
    beforeComments,
  );
});

it("persists the attempt-limit message when a Page changes before publication", async () => {
  const documentId = "attempt-limit-publish-page";
  const rootId = "attempt-limit-publish-root";
  const operationId = "22222222-2222-4222-8222-222222222222";
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: documentId,
    ownerEmail: OWNER,
    title: "Attempt limit publish page",
    content: "Alpha one.",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.documentComments).values({
    id: rootId,
    ownerEmail: OWNER,
    documentId,
    threadId: rootId,
    parentId: null,
    content: "Please answer",
    authorEmail: OWNER,
    authorName: "Owner",
    createdAt: now,
    updatedAt: now,
  });
  await asUser(() =>
    commentAi.startCommentAiRequest({
      requestId: operationId,
      agentThreadId: `agent-thread-${operationId}`,
      documentId,
      threadId: rootId,
      rootCommentId: rootId,
      intent: "reply",
    }),
  );
  await asUser(async () =>
    commentAi.beginCommentAiAttempt(
      await commentAi.loadCommentAiRequest(operationId),
    ),
  );
  await getDb()
    .update(schema.documents)
    .set({ content: "Intro. Alpha one.", bodyRevision: 2 })
    .where(eq(schema.documents.id, documentId));
  const second = await asUser(async () =>
    commentAi.beginCommentAiAttempt(
      await commentAi.loadCommentAiRequest(operationId),
    ),
  );
  if (!second.attempt) throw new Error("Second attempt was not created");
  const attempt = second.attempt;
  const payload = { attemptId: attempt.id, content: "Retained answer" };
  await asUser(() =>
    commentAi.retainCommentAiAttemptPayload(
      second.request,
      attempt.id,
      payload,
    ),
  );
  await getDb()
    .update(schema.documents)
    .set({ content: "Updated. Alpha one.", bodyRevision: 3 })
    .where(eq(schema.documents.id, documentId));
  const verification = await asUser(() =>
    commentAi.verifyCommentAiAttempt(second.request, attempt.id),
  );
  expect(verification.sourceRevisionMatches).toBe(false);

  const message =
    "The AI operation reached its attempt limit. Review the retained operation before retrying.";
  await expect(
    asUser(() =>
      commentAi.markCommentAiRefreshRequired(second.request, attempt),
    ),
  ).rejects.toMatchObject({ code: "refresh_exhausted", message });
  expect(
    await asUser(() => commentAi.loadCommentAiRequest(operationId)),
  ).toMatchObject({
    status: "needs-review",
    errorCode: "refresh_exhausted",
    error: message,
  });
  expect(
    await asUser(() =>
      commentAi.getCommentAiAttempt(second.request, attempt.id),
    ),
  ).toMatchObject({
    status: "needs-review",
    errorCode: "refresh_exhausted",
    error: message,
    payloadJson: JSON.stringify(payload),
  });
});
