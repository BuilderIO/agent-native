import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-ai-undo-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "comment-ai-undo-owner@example.com";
const OTHER_USER = "comment-ai-undo-other@example.com";
const DOCUMENT_ID = "comment-ai-undo-page";
const ROOT = "comment-ai-undo-root";
const OPERATION = "44444444-4444-4444-8444-444444444444";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let commentAi: typeof import("../server/lib/comment-ai.js");
let applyRequest: typeof import("./apply-comment-ai-request.js").default;
let undoRequest: typeof import("./undo-comment-ai-request.js").default;

const asUser = <T>(email: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: email }, run);

async function apply(edits: Array<{ find: string; replace: string }>) {
  const started = await asUser(OWNER, () =>
    commentAi.startCommentAiRequest({
      requestId: OPERATION,
      agentThreadId: `agent-thread-${OPERATION}`,
      documentId: DOCUMENT_ID,
      threadId: ROOT,
      rootCommentId: ROOT,
      intent: "apply-resolve",
    }),
  );
  const inRun = <T>(run: () => Promise<T>) =>
    runWithRequestContext(
      {
        userEmail: OWNER,
        run: {
          actionScope: { kind: "content-comment-ai", requestId: OPERATION },
          threadId: started.agentThreadId,
          runId: `run-${OPERATION}`,
          model: "openai/gpt-5.6-sol",
        },
      },
      run,
    );
  const attempt = await inRun(async () =>
    commentAi.beginCommentAiAttempt(
      await commentAi.requireCommentAiRequest("apply-resolve"),
    ),
  );
  return inRun(() =>
    applyRequest.run(
      { attemptId: attempt.attempt!.id, edits, summary: "Lengthened it" },
      { caller: "tool", userEmail: OWNER },
    ),
  );
}

const undo = (email = OWNER) =>
  asUser(email, () =>
    undoRequest.run(
      { requestId: OPERATION },
      { caller: "http", userEmail: email },
    ),
  );

async function pageContent() {
  const [document] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, DOCUMENT_ID));
  return document.content;
}

async function threadResolved() {
  const [root] = await getDb()
    .select()
    .from(schema.documentComments)
    .where(eq(schema.documentComments.id, ROOT));
  return root.resolved;
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
  undoRequest = (await import("./undo-comment-ai-request.js")).default;
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.commentAiAttempts);
  await getDb().delete(schema.commentAiRequests);
  await getDb().delete(schema.documentComments);
  await getDb().delete(schema.documentEditReceipts);
  await getDb().delete(schema.documents);
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Undo page",
    content: "The labels are soft. The pacing works.",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.documentComments).values({
    id: ROOT,
    ownerEmail: OWNER,
    documentId: DOCUMENT_ID,
    threadId: ROOT,
    parentId: null,
    content: "Make this sentence longer",
    authorEmail: OWNER,
    authorName: "Owner",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("undo an applied comment AI change", () => {
  it("records what changed, then restores the text and reopens the thread", async () => {
    const applied = await apply([
      {
        find: "The labels are soft.",
        replace: "The labels are soft in the recording and hard to read.",
      },
    ]);
    expect(applied.status).toBe("resolved");
    expect(applied.result?.changes).toEqual([
      {
        before: "The labels are soft.",
        after: "The labels are soft in the recording and hard to read.",
      },
    ]);
    expect(applied.result?.undoable).toBe(true);
    expect(await threadResolved()).toBe(1);

    const undone = await undo();
    expect(undone.result?.undone).toBe(true);
    expect(await pageContent()).toBe("The labels are soft. The pacing works.");
    expect(await threadResolved()).toBe(0);

    // A second click is a no-op rather than a second reversal.
    await undo();
    expect(await pageContent()).toBe("The labels are soft. The pacing works.");
  });

  it("leaves the Page alone when the changed text was edited since", async () => {
    await apply([{ find: "The labels are soft.", replace: "Labels blur." }]);
    await getDb()
      .update(schema.documents)
      .set({ content: "Labels blur badly. The pacing works.", bodyRevision: 3 })
      .where(eq(schema.documents.id, DOCUMENT_ID));

    await expect(undo()).rejects.toThrow(/edited after AI applied it/);
    expect(await pageContent()).toBe("Labels blur badly. The pacing works.");
    expect(await threadResolved()).toBe(1);
  });

  it("only lets the person who asked undo it", async () => {
    await apply([{ find: "The labels are soft.", replace: "Labels blur." }]);
    await expect(undo(OTHER_USER)).rejects.toThrow();
    expect(await pageContent()).toBe("Labels blur. The pacing works.");
  });

  it("does not offer undo for a pure deletion", async () => {
    const applied = await apply([{ find: " The pacing works.", replace: "" }]);
    expect(applied.result?.undoable).toBe(false);
    await expect(undo()).rejects.toThrow(/removed text/);
  });
});
