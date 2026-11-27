import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  invocationEffect,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
} from "@agent-native/core/action";
import {
  getMigrationDatabaseUrl,
  getRuntimeDatabaseUrl,
} from "@agent-native/core/db";
import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "content-comment-ai-proof-"));
const owner = "comment-ai-proof@example.com";
const documentId = crypto.randomUUID();
const rootId = crypto.randomUUID();
const requestId = crypto.randomUUID();
const threadId = `agent-thread-${requestId}`;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let commentAi: typeof import("../server/lib/comment-ai.js");
let getContext: typeof import("./get-comment-ai-context.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner }, run);
const asRun = <T>(run: () => Promise<T>) =>
  runWithRequestContext(
    {
      userEmail: owner,
      run: {
        actionScope: { kind: "content-comment-ai", requestId },
        threadId,
        runId: "proof-run",
        model: "example/model",
      },
    },
    run,
  );

beforeAll(async () => {
  registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
  const databaseUrl = `pglite:${join(directory, "database.pglite")}`;
  process.env.DATABASE_URL = databaseUrl;
  if (
    getRuntimeDatabaseUrl() !== databaseUrl ||
    getMigrationDatabaseUrl() !== databaseUrl
  ) {
    throw new Error("Comment AI proof requires its isolated PGlite database");
  }
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  const { creativeContextDbPlugin } =
    await import("@agent-native/creative-context/server");
  await creativeContextDbPlugin(undefined as never);
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  commentAi = await import("../server/lib/comment-ai.js");
  getContext = (await import("./get-comment-ai-context.js")).default;
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

it("reports an exhausted refresh as a settled no-write action", async () => {
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: documentId,
    ownerEmail: owner,
    title: "Proof page",
    content: "Initial content",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.documentComments).values({
    id: rootId,
    ownerEmail: owner,
    documentId,
    threadId: rootId,
    parentId: null,
    content: "Please revise this",
    authorEmail: owner,
    authorName: "Owner",
    createdAt: now,
    updatedAt: now,
  });
  await asOwner(() =>
    commentAi.startCommentAiRequest({
      requestId,
      agentThreadId: threadId,
      documentId,
      threadId: rootId,
      rootCommentId: rootId,
      intent: "reply",
    }),
  );
  for (const revision of [1, 2]) {
    await asRun(async () => {
      const request = await commentAi.requireCommentAiRequest("reply");
      await commentAi.beginCommentAiAttempt(request);
    });
    await getDb()
      .update(schema.documents)
      .set({ content: `Revision ${revision}`, bodyRevision: revision + 1 })
      .where(eq(schema.documents.id, documentId));
  }

  const before = await asOwner(() => commentAi.loadCommentAiRequest(requestId));
  const attempts = await getDb()
    .select()
    .from(schema.commentAiAttempts)
    .where(eq(schema.commentAiAttempts.requestId, requestId));
  const outcome: ActionExecutionOutcome = { refused: false };
  const error = await asRun(() =>
    runActionWithExecutionOutcome(
      getContext.run,
      {},
      {
        caller: "tool",
        userEmail: owner,
        actionName: "get-comment-ai-context",
      },
      outcome,
      getContext,
    ),
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(error).toMatchObject({ code: "refresh_exhausted" });
  expect(invocationEffect(getContext, outcome, { failed: { error } })).toEqual({
    effect: "none",
    changed: false,
  });
  const after = await asOwner(() => commentAi.loadCommentAiRequest(requestId));
  expect(after).toMatchObject({
    status: before.status,
    attemptCount: 2,
    activeAttemptId: before.activeAttemptId,
    errorCode: before.errorCode,
  });
  expect(
    await getDb()
      .select()
      .from(schema.commentAiAttempts)
      .where(eq(schema.commentAiAttempts.requestId, requestId)),
  ).toEqual(attempts);
});
