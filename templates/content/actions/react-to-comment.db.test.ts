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

const directory = mkdtempSync(join(tmpdir(), "content-comment-reactions-"));
const owner = "reaction-owner@example.com";
const stranger = "reaction-stranger@example.com";
const documentId = "reaction-doc";
let dbModule: typeof import("../server/db/index.js");
let addComment: typeof import("./add-comment.js").default;
let listComments: typeof import("./list-comments.js").default;
let deleteComment: typeof import("./delete-comment.js").default;
let reactToComment: typeof import("./react-to-comment.js").default;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "db")}`);
  dbModule = await import("../server/db/index.js");
  const { runContentMigrations } = await import("../server/plugins/db.js");
  await runContentMigrations();
  addComment = (await import("./add-comment.js")).default;
  listComments = (await import("./list-comments.js")).default;
  deleteComment = (await import("./delete-comment.js")).default;
  reactToComment = (await import("./react-to-comment.js")).default;
  await dbModule.getDb().insert(dbModule.schema.documents).values({
    id: documentId,
    ownerEmail: owner,
    title: "Comment reactions test",
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const asOwner = <T>(fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner, userName: "Reaction Owner" }, fn);
const ctx = { caller: "frontend" as const, userEmail: owner };

async function reactionsFor(commentId: string) {
  const result = await listComments.run({ documentId }, ctx);
  return result.comments.find((comment) => comment.id === commentId)?.reactions;
}

it("adds a reaction once per person, summarizes it, and removes it", async () => {
  await asOwner(async () => {
    const comment = await addComment.run(
      { documentId, content: "Reacted comment" },
      ctx,
    );
    const react = (reaction: string, active: boolean) =>
      reactToComment.run(
        { documentId, commentId: comment.id, reaction, active },
        ctx,
      );

    await react("👍", true);
    await react("👍", true);
    await react("🎉", true);
    expect(await reactionsFor(comment.id)).toEqual([
      { reaction: "👍", count: 1, reactedByMe: true },
      { reaction: "🎉", count: 1, reactedByMe: true },
    ]);

    await react("👍", false);
    expect(await reactionsFor(comment.id)).toEqual([
      { reaction: "🎉", count: 1, reactedByMe: true },
    ]);
  });
});

it("accepts only emoji reactions", () => {
  const parse = (reaction: string) =>
    reactToComment.schema.safeParse({
      documentId,
      commentId: "any",
      reaction,
      active: true,
    }).success;
  expect(parse("👍")).toBe(true);
  expect(parse("❤️")).toBe(true);
  expect(parse("🇺🇸")).toBe(true);
  expect(parse("lol")).toBe(false);
  expect(parse("<b>hi</b>")).toBe(false);
});

it("denies people without comment access to the document", async () => {
  const comment = await asOwner(() =>
    addComment.run({ documentId, content: "Private comment" }, ctx),
  );
  await expect(
    runWithRequestContext({ userEmail: stranger }, () =>
      reactToComment.run(
        { documentId, commentId: comment.id, reaction: "👀", active: true },
        { caller: "frontend", userEmail: stranger },
      ),
    ),
  ).rejects.toThrow();
  expect(await asOwner(() => reactionsFor(comment.id))).toEqual([]);
});

it("keeps the accountable person as the author of agent-posted comments", async () => {
  await asOwner(async () => {
    const posted = await addComment.run(
      { documentId, content: "Posted through MCP" },
      { caller: "mcp", userEmail: owner },
    );
    const result = await listComments.run({ documentId }, ctx);
    const comment = result.comments.find((entry) => entry.id === posted.id);
    expect(comment?.submission_source).toBe("mcp");
    expect(comment?.author_email).toBe(owner);
    expect(comment?.author_name).not.toBe("AI Agent");
  });
});

it("removes a comment's reactions when the comment is deleted", async () => {
  await asOwner(async () => {
    const comment = await addComment.run(
      { documentId, content: "Soon deleted" },
      ctx,
    );
    await reactToComment.run(
      { documentId, commentId: comment.id, reaction: "❤️", active: true },
      ctx,
    );
    await deleteComment.run({ id: comment.id, documentId }, ctx);
    const rows = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.documentCommentReactions)
      .where(
        eq(dbModule.schema.documentCommentReactions.commentId, comment.id),
      );
    expect(rows).toEqual([]);
  });
});
