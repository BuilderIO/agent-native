import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => ({ status: "no-recipients" })),
}));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: vi.fn(async () => new Map()),
}));

const directory = mkdtempSync(join(tmpdir(), "content-delete-comment-"));
const owner = "delete-owner@example.com";
const commenter = "delete-commenter@example.com";
const documentId = "delete-comment-doc";
let dbModule: typeof import("../server/db/index.js");
let addComment: typeof import("./add-comment.js").default;
let deleteComment: typeof import("./delete-comment.js").default;
let reactToComment: typeof import("./react-to-comment.js").default;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "db")}`);
  dbModule = await import("../server/db/index.js");
  const { runContentMigrations } = await import("../server/plugins/db.js");
  await runContentMigrations();
  addComment = (await import("./add-comment.js")).default;
  deleteComment = (await import("./delete-comment.js")).default;
  reactToComment = (await import("./react-to-comment.js")).default;
  (await import("../server/plugins/suggested-edits.js")).default();
  const db = dbModule.getDb();
  await db.insert(dbModule.schema.documents).values({
    id: documentId,
    ownerEmail: owner,
    title: "Delete comments test",
  });
  await db.insert(dbModule.schema.documentShares).values({
    id: crypto.randomUUID(),
    resourceId: documentId,
    principalType: "user",
    principalId: commenter,
    role: "commenter",
    createdBy: owner,
    createdAt: new Date().toISOString(),
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const as = <T>(userEmail: string, fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, fn);
const ctxFor = (userEmail: string) => ({
  caller: "frontend" as const,
  userEmail,
});

function comment(userEmail: string, content: string, threadId?: string) {
  return as(userEmail, () =>
    addComment.run(
      threadId
        ? { documentId, content, threadId, parentId: threadId }
        : { documentId, content },
      ctxFor(userEmail),
    ),
  );
}

function remove(userEmail: string, id: string) {
  return as(userEmail, () =>
    deleteComment.run({ id, documentId }, ctxFor(userEmail)),
  );
}

async function commentIds(threadId: string) {
  const rows = await dbModule
    .getDb()
    .select({ id: dbModule.schema.documentComments.id })
    .from(dbModule.schema.documentComments)
    .where(eq(dbModule.schema.documentComments.threadId, threadId));
  return rows.map(({ id }) => id).sort();
}

it("deletes an author's own reply and leaves the rest of the thread", async () => {
  const root = await comment(owner, "Thread");
  const mine = await comment(commenter, "My reply", root.id);
  const theirs = await comment(owner, "Owner reply", root.id);

  const result = await remove(commenter, mine.id);

  expect(result.deletedIds).toEqual([mine.id]);
  expect(await commentIds(root.id)).toEqual([root.id, theirs.id].sort());
});

it("deletes a thread its author alone wrote in, with replies and reactions", async () => {
  const root = await comment(commenter, "My thread");
  const reply = await comment(commenter, "My follow-up", root.id);
  await as(owner, () =>
    reactToComment.run(
      { documentId, commentId: reply.id, reaction: "👍", active: true },
      ctxFor(owner),
    ),
  );

  const result = await remove(commenter, root.id);

  expect(result.deletedIds.sort()).toEqual([root.id, reply.id].sort());
  expect(await commentIds(root.id)).toEqual([]);
  const reactions = await dbModule
    .getDb()
    .select()
    .from(dbModule.schema.documentCommentReactions)
    .where(eq(dbModule.schema.documentCommentReactions.commentId, reply.id));
  expect(reactions).toEqual([]);
});

it("leaves a thread someone else replied in to an editor", async () => {
  const root = await comment(commenter, "My question");
  const answer = await comment(owner, "An answer", root.id);

  await expect(remove(commenter, root.id)).rejects.toThrow(/editor/);
  expect(await commentIds(root.id)).toEqual([root.id, answer.id].sort());

  await remove(owner, root.id);
  expect(await commentIds(root.id)).toEqual([]);
});

it("refuses a comment synced with Notion, which sync would bring back", async () => {
  const root = await comment(commenter, "Synced thread");
  await dbModule
    .getDb()
    .update(dbModule.schema.documentComments)
    .set({ notionCommentId: "notion-comment-1" })
    .where(eq(dbModule.schema.documentComments.id, root.id));

  await expect(remove(commenter, root.id)).rejects.toThrow(/Notion/);
  expect(await commentIds(root.id)).toEqual([root.id]);
});

it("refuses a thread the AI is working on", async () => {
  const root = await comment(commenter, "Ask AI thread");
  await dbModule.getDb().insert(dbModule.schema.commentAiRequests).values({
    id: crypto.randomUUID(),
    ownerEmail: owner,
    requesterEmail: commenter,
    documentId,
    threadId: root.id,
    rootCommentId: root.id,
    fieldId: "",
    intent: "reply",
    status: "running",
    threadDigest: "digest",
    snapshotJson: "{}",
    baseRevision: "base",
    suggestionRevision: "suggestion",
  });

  await expect(remove(commenter, root.id)).rejects.toThrow(/AI/);
  expect(await commentIds(root.id)).toEqual([root.id]);
});

it("knows an author whose email changed case", async () => {
  const root = await comment(commenter, "Thread");
  const mine = await comment(commenter, "My reply", root.id);
  await dbModule
    .getDb()
    .update(dbModule.schema.documentComments)
    .set({ authorEmail: commenter.toUpperCase() })
    .where(eq(dbModule.schema.documentComments.id, mine.id));

  const result = await remove(commenter, mine.id);

  expect(result.deletedIds).toEqual([mine.id]);
});

it("deletes a thread's finished Ask AI requests, which hold copies of it", async () => {
  const root = await comment(commenter, "Asked the AI");
  const requestId = crypto.randomUUID();
  const db = dbModule.getDb();
  await db.insert(dbModule.schema.commentAiRequests).values({
    id: requestId,
    ownerEmail: owner,
    requesterEmail: commenter,
    documentId,
    threadId: root.id,
    rootCommentId: root.id,
    fieldId: "body",
    intent: "reply",
    status: "replied",
    threadDigest: "digest",
    snapshotJson: JSON.stringify([{ content: "Asked the AI" }]),
    baseRevision: "base",
    suggestionRevision: "suggestion",
    resultJson: JSON.stringify({ reply: "An answer" }),
  });
  await db.insert(dbModule.schema.commentAiAttempts).values({
    id: crypto.randomUUID(),
    ownerEmail: owner,
    requestId,
    attemptNumber: 1,
    status: "completed",
    sourceRevision: "base",
    suggestionRevision: "suggestion",
    threadDigest: "digest",
    snapshotJson: JSON.stringify([{ content: "Asked the AI" }]),
  });

  await remove(commenter, root.id);

  expect(
    await db
      .select()
      .from(dbModule.schema.commentAiRequests)
      .where(eq(dbModule.schema.commentAiRequests.threadId, root.id)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(dbModule.schema.commentAiAttempts)
      .where(eq(dbModule.schema.commentAiAttempts.requestId, requestId)),
  ).toEqual([]);
});

it("refuses a thread whose AI suggestion waits for review", async () => {
  const root = await comment(commenter, "Suggest a better intro");
  const { getDbExec } = await import("@agent-native/core/db");
  const listSuggestions = (
    await import("@agent-native/core/review/suggestions/actions/list-resource-suggestions")
  ).default;
  // Creates the suggestion tables.
  await as(owner, () =>
    listSuggestions.run(
      { resourceType: "document", resourceId: documentId },
      ctxFor(owner),
    ),
  );
  const now = new Date().toISOString();
  const suggest = (id: string, metadata: Record<string, string>) =>
    getDbExec().execute({
      sql: "INSERT INTO agent_review_suggestions (id, resource_type, resource_id, adapter_kind, adapter_version, thread_id, author_email, actor_kind, base_revision, summary, owner_email, created_at, updated_at, metadata_json) VALUES (?, 'document', ?, 'content.document-markdown', 1, ?, ?, 'agent', 'base', 'Tighten the intro', ?, ?, ?, ?)",
      args: [
        id,
        documentId,
        `suggestion-${id}`,
        commenter,
        owner,
        now,
        now,
        JSON.stringify(metadata),
      ],
    });
  const fromAi = crypto.randomUUID();
  await suggest(fromAi, {
    sourceThreadId: root.id,
    commentAiRequestId: "request",
  });
  // Anyone can name a thread; without a request it isn't the thread's.
  await suggest(crypto.randomUUID(), { sourceThreadId: root.id });

  await expect(remove(commenter, root.id)).rejects.toThrow(/suggestion/);
  expect(await commentIds(root.id)).toEqual([root.id]);

  await getDbExec().execute({
    sql: "UPDATE agent_review_suggestions SET status = 'rejected' WHERE id = ?",
    args: [fromAi],
  });
  await remove(commenter, root.id);
  expect(await commentIds(root.id)).toEqual([]);
});
