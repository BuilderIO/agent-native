import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getMigrationDatabaseUrl,
  getRuntimeDatabaseUrl,
} from "@agent-native/core/db";
import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

const directory = mkdtempSync(
  join(tmpdir(), "content-comment-ai-refresh-race-"),
);
const owner = "comment-ai-refresh-race@example.com";
const documentId = crypto.randomUUID();
const rootId = crypto.randomUUID();
const requestId = crypto.randomUUID();
const threadId = `agent-thread-${requestId}`;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let commentAi: typeof import("../server/lib/comment-ai.js");

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
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

it("preserves a newer refresh when stale context validation fails", async () => {
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
  await runWithRequestContext({ userEmail: owner }, () =>
    commentAi.startCommentAiRequest({
      requestId,
      agentThreadId: threadId,
      documentId,
      threadId: rootId,
      rootCommentId: rootId,
      intent: "reply",
    }),
  );
  const run = <T>(fn: () => Promise<T>) =>
    runWithRequestContext(
      {
        userEmail: owner,
        run: {
          actionScope: { kind: "content-comment-ai", requestId },
          threadId,
          runId: "race-run",
        },
      },
      fn,
    );
  const request = await run(() =>
    commentAi.requireCommentAiRequest(undefined, { deferBookkeeping: true }),
  );
  const started = await run(() => commentAi.beginCommentAiAttempt(request));
  const attempt = started.attempt;
  if (!attempt) throw new Error("Expected an active attempt");
  const stale = started.request;
  await run(() => commentAi.markCommentAiRefreshRequired(stale, attempt));
  await getDb()
    .update(schema.documentComments)
    .set({ content: "Changed feedback" })
    .where(eq(schema.documentComments.id, rootId));
  const before = await run(() => commentAi.loadCommentAiRequest(requestId));
  expect(before.status).toBe("refreshing");
  await expect(
    run(() => commentAi.beginCommentAiAttempt(stale, { recordRun: true })),
  ).rejects.toMatchObject({ code: "root_comment_changed" });
  expect(await run(() => commentAi.loadCommentAiRequest(requestId))).toEqual(
    before,
  );
});
