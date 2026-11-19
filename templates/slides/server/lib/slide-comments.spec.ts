import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import {
  getReviewCommentById,
  mirrorReviewComments,
} from "@agent-native/core/review";
import createReviewComment from "@agent-native/core/review/actions/create-review-comment";
import deleteReviewComment from "@agent-native/core/review/actions/delete-review-comment";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SlideCommentRow } from "./slide-comments.js";

// oracle-change(templates/slides/actions/add-slide-comment.test.ts): Slides' comments moved onto the review kit; the database-backed tests here replace the mocked ones
// oracle-change(templates/slides/actions/delete-slide-comment.test.ts): Slides' comments moved onto the review kit; the database-backed tests here replace the mocked ones
// oracle-change(templates/slides/actions/list-slide-comments.test.ts): Slides' comments moved onto the review kit; the database-backed tests here replace the mocked ones
// oracle-change(templates/slides/actions/toggle-slide-comment-reaction.test.ts): Slides' comments moved onto the review kit; the database-backed tests here replace the mocked ones
// oracle-change(templates/slides/actions/update-slide-comment.test.ts): Slides' comments moved onto the review kit; the database-backed tests here replace the mocked ones
// oracle-change(templates/slides/server/lib/comment-notifications.spec.ts): Slides' comment email is gone; the review kit sends it, and core tests it
// oracle-change(templates/slides/server/lib/slide-comment-mirror.spec.ts): the mirror's checks went with the mirror; Slides keeps its comments in the kit alone, tested here

const TEST_DB_PATH = join(
  tmpdir(),
  `slide-comments-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = { userEmail: "owner@example.test", orgId: "slides-org" };
const COMMENTER = "commenter@example.test";
const EDITOR = "editor@example.test";

interface Runnable<T = unknown> {
  run: (args: unknown, ctx?: unknown) => Promise<T>;
  needsApproval: (args: unknown, ctx?: unknown) => Promise<boolean>;
}

interface CommentPage {
  comments: SlideCommentRow[];
  has_more: boolean;
  next_cursor: { createdAt: string; id: string } | null;
  next_offset: number | null;
  limit: number;
  offset: number;
}

let dbModule: typeof import("../db/index.js");
let copy: typeof import("./slide-comment-mirror.js");
let addComment: Runnable<{ id: string; threadId: string }>;
let updateComment: Runnable;
let toggleReaction: Runnable<{
  reacted: boolean;
  reactions: SlideCommentRow["reactions"];
}>;
let deleteComment: Runnable<{ ok: true; removedIds: string[] }>;
let listComments: Runnable<CommentPage>;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides.example.test";
  dbModule = await import("../db/index.js");
  copy = await import("./slide-comment-mirror.js");
  addComment = (await import("../../actions/add-slide-comment.js"))
    .default as never;
  updateComment = (await import("../../actions/update-slide-comment.js"))
    .default as never;
  toggleReaction = (
    await import("../../actions/toggle-slide-comment-reaction.js")
  ).default as never;
  deleteComment = (await import("../../actions/delete-slide-comment.js"))
    .default as never;
  listComments = (await import("../../actions/list-slide-comments.js"))
    .default as never;
  const dbPlugin = (await import("../plugins/db.js")).default;
  await dbPlugin(undefined as never);
  const reviewPlugin = (await import("../plugins/review.js")).default;
  await (reviewPlugin as (app: unknown) => unknown)(undefined);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
}, 120000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function createDeck(
  id: string,
  shares: Array<[string, "viewer" | "commenter" | "editor"]> = [],
) {
  const { getDb, schema } = dbModule;
  await getDb()
    .insert(schema.decks)
    .values({
      id,
      title: "Comment deck",
      data: JSON.stringify({
        slides: [
          { id: "slide-1", content: "<h1>One</h1>" },
          { id: "slide-2", content: "<h1>Two</h1>" },
        ],
      }),
      ownerEmail: OWNER.userEmail,
      orgId: OWNER.orgId,
    });
  for (const [email, role] of shares) {
    await getDb()
      .insert(schema.deckShares)
      .values({
        id: `${id}-${email}`,
        resourceId: id,
        principalType: "user",
        principalId: email,
        role,
        createdBy: OWNER.userEmail,
      });
  }
}

const asOwner = <T>(run: () => Promise<T>) => runWithRequestContext(OWNER, run);
const as = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

const stored = (id: string) =>
  getReviewCommentById(id, {}, { bypassScope: true });

async function listed(deckId: string, args: Record<string, unknown> = {}) {
  return asOwner(() => listComments.run({ deckId, ...args }));
}

describe("Slides comments on the review kit", () => {
  it("keeps a thread in the kit through every Slides comment action", async () => {
    await createDeck("deck-actions");
    const root = await asOwner(() =>
      addComment.run({
        deckId: "deck-actions",
        slideId: "slide-1",
        content: "Tighten the **headline**",
        quotedText: "One",
        anchor: { x: 12.5, y: 40, objectId: "title", objectX: 5, objectY: 6 },
      }),
    );
    expect(await stored(root.id)).toMatchObject({
      resourceType: "deck",
      resourceId: "deck-actions",
      surfaceId: "slide-1",
      anchorKind: "slide-point",
      anchor: { x: 12.5, y: 40, objectId: "title", objectX: 5, objectY: 6 },
      metadata: { quotedText: "One" },
      createdBy: "human",
    });

    const reply = await asOwner(() =>
      addComment.run(
        {
          deckId: "deck-actions",
          slideId: "slide-1",
          content: "On it",
          threadId: root.threadId,
          parentId: root.id,
        },
        { caller: "tool" },
      ),
    );
    expect(await stored(reply.id)).toMatchObject({
      createdBy: "agent",
      authorName: "AI Agent",
      parentCommentId: root.id,
    });

    const react = (caller?: string) =>
      asOwner(() =>
        toggleReaction.run(
          { deckId: "deck-actions", commentId: root.id, emoji: "👍" },
          caller ? { caller } : undefined,
        ),
      );
    expect(await react()).toEqual({
      id: root.id,
      emoji: "👍",
      reacted: true,
      reactions: [{ emoji: "👍", count: 1, reacted: true }],
    });
    expect((await react("tool")).reactions).toEqual([
      { emoji: "👍", count: 2, reacted: true },
    ]);
    expect(await react()).toMatchObject({
      reacted: false,
      reactions: [{ emoji: "👍", count: 1, reacted: false }],
    });

    expect(
      await asOwner(() =>
        updateComment.run({
          deckId: "deck-actions",
          id: root.id,
          content: "Tighten the headline, please",
          resolved: true,
        }),
      ),
    ).toEqual({ ok: true, resolved: true });
    const page = await listed("deck-actions", { slideId: "slide-1" });
    expect(page).toMatchObject({
      has_more: false,
      next_cursor: null,
      next_offset: null,
    });
    expect(page.comments).toEqual([
      expect.objectContaining({
        id: root.id,
        deck_id: "deck-actions",
        slide_id: "slide-1",
        thread_id: root.threadId,
        parent_id: null,
        content: "Tighten the headline, please",
        quoted_text: "One",
        anchor: { x: 12.5, y: 40, objectId: "title", objectX: 5, objectY: 6 },
        reactions: [{ emoji: "👍", count: 1, reacted: false }],
        author_email: OWNER.userEmail,
        author_kind: "person",
        resolved: true,
      }),
      expect.objectContaining({
        id: reply.id,
        parent_id: root.id,
        author_kind: "agent",
        author_name: "AI Agent",
        resolved: true,
      }),
    ]);

    expect(
      await asOwner(() =>
        updateComment.run({
          deckId: "deck-actions",
          id: reply.id,
          resolved: true,
        }),
      ),
    ).toEqual({ ok: true });
    await asOwner(() =>
      updateComment.run({
        deckId: "deck-actions",
        id: root.id,
        resolved: false,
      }),
    );
    expect(
      await asOwner(() =>
        deleteComment.run({ deckId: "deck-actions", id: reply.id }),
      ),
    ).toEqual({ ok: true, removedIds: [reply.id] });
    expect(
      (await listed("deck-actions")).comments.map((comment) => [
        comment.id,
        comment.resolved,
      ]),
    ).toEqual([[root.id, false]]);
    await asOwner(() =>
      deleteComment.run({ deckId: "deck-actions", id: root.id }),
    );
    expect((await listed("deck-actions")).comments).toEqual([]);
    expect((await stored(root.id))?.status).toBe("deleted");

    const { getDb, schema } = dbModule;
    expect(await getDb().select().from(schema.slideComments)).toEqual([]);
  });

  it("refuses what Slides has always refused", async () => {
    await createDeck("deck-refusals", [["viewer@example.test", "viewer"]]);
    const deck = { deckId: "deck-refusals" };
    await expect(
      asOwner(() =>
        addComment.run({ ...deck, slideId: "slide-9", content: "Lost" }),
      ),
    ).rejects.toThrow("Slide not found in deck: slide-9");
    await expect(
      as("viewer@example.test", () =>
        addComment.run({ ...deck, slideId: "slide-1", content: "Viewer" }),
      ),
    ).rejects.toThrow();

    const root = await asOwner(() =>
      addComment.run({ ...deck, slideId: "slide-1", content: "Root" }),
    );
    await expect(
      asOwner(() =>
        addComment.run({
          ...deck,
          slideId: "slide-2",
          content: "Wrong slide",
          threadId: root.threadId,
          parentId: root.id,
        }),
      ),
    ).rejects.toThrow("Parent comment not found in this thread");
    await expect(
      asOwner(() =>
        addComment.run({
          ...deck,
          slideId: "slide-1",
          content: "Wrong thread",
          threadId: "another-thread",
          parentId: root.id,
        }),
      ),
    ).rejects.toThrow("Parent comment not found in this thread");

    await asOwner(() =>
      updateComment.run({ ...deck, id: root.id, resolved: true }),
    );
    await expect(
      asOwner(() =>
        addComment.run({
          ...deck,
          slideId: "slide-1",
          content: "Too late",
          threadId: root.threadId,
          parentId: root.id,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    await expect(
      asOwner(() =>
        toggleReaction.run({ ...deck, commentId: "missing", emoji: "👍" }),
      ),
    ).rejects.toThrow("Comment not found: missing");
    await expect(
      asOwner(() =>
        updateComment.run({ ...deck, id: "missing", resolved: true }),
      ),
    ).rejects.toThrow("Comment not found: missing");
    await expect(
      asOwner(() => deleteComment.run({ ...deck, id: "missing" })),
    ).rejects.toThrow("Comment not found: missing");
  });

  it("refuses a reply on a slide the deck no longer has", async () => {
    await createDeck("deck-removed-slide");
    const deck = { deckId: "deck-removed-slide" };
    const root = await asOwner(() =>
      addComment.run({ ...deck, slideId: "slide-2", content: "On two" }),
    );
    const { getDb, schema } = dbModule;
    await getDb()
      .update(schema.decks)
      .set({
        data: JSON.stringify({
          slides: [{ id: "slide-1", content: "<h1>One</h1>" }],
        }),
      })
      .where(eq(schema.decks.id, "deck-removed-slide"));

    await expect(
      asOwner(() =>
        addComment.run({
          ...deck,
          slideId: "slide-2",
          content: "Still here?",
          threadId: root.threadId,
          parentId: root.id,
        }),
      ),
    ).rejects.toThrow("Slide not found in deck: slide-2");
    expect(
      (await listed("deck-removed-slide")).comments.map(
        (comment) => comment.id,
      ),
    ).toEqual([root.id]);
  });

  it("knows a person's reaction whatever the case of their email, and takes toggles in turn", async () => {
    await createDeck("deck-reactions", [[COMMENTER, "commenter"]]);
    const deck = { deckId: "deck-reactions" };
    const root = await asOwner(() =>
      addComment.run({ ...deck, slideId: "slide-1", content: "React" }),
    );
    const react = (userEmail: string) =>
      as(userEmail, () =>
        toggleReaction.run({ ...deck, commentId: root.id, emoji: "🎉" }),
      );

    expect((await react(COMMENTER)).reacted).toBe(true);
    expect(await react("Commenter@Example.Test")).toMatchObject({
      reacted: false,
      reactions: [],
    });

    const both = await Promise.all([react(COMMENTER), react(COMMENTER)]);
    expect(both.map((result) => result.reacted).sort()).toEqual([false, true]);
    expect((await listed("deck-reactions")).comments[0]?.reactions).toEqual([]);
  });

  it("lets a commenter resolve threads, and only an author change what a comment says", async () => {
    await createDeck("deck-roles", [
      [COMMENTER, "commenter"],
      [EDITOR, "editor"],
    ]);
    const deck = { deckId: "deck-roles" };
    const root = await asOwner(() =>
      addComment.run({ ...deck, slideId: "slide-1", content: "Owner's note" }),
    );

    expect(
      await as(COMMENTER, () =>
        updateComment.run({ ...deck, id: root.id, resolved: true }),
      ),
    ).toEqual({ ok: true, resolved: true });
    await expect(
      as(EDITOR, () =>
        updateComment.run({
          ...deck,
          id: root.id,
          content: "Editor's words",
          resolved: false,
        }),
      ),
    ).rejects.toThrow();
    expect(await stored(root.id)).toMatchObject({
      body: "Owner's note",
      status: "resolved",
    });

    await expect(
      as(COMMENTER, () => deleteComment.run({ ...deck, id: root.id })),
    ).rejects.toThrow();
    await as(EDITOR, () => deleteComment.run({ ...deck, id: root.id }));
    expect((await stored(root.id))?.status).toBe("deleted");
  });

  it("asks before the agent deletes another person's words", async () => {
    await createDeck("deck-approval", [[COMMENTER, "commenter"]]);
    const deck = { deckId: "deck-approval" };
    const root = await asOwner(() =>
      addComment.run({
        ...deck,
        slideId: "slide-1",
        content: "Owner's thread",
      }),
    );
    const reply = await as(COMMENTER, () =>
      addComment.run({
        ...deck,
        slideId: "slide-1",
        content: "Commenter's reply",
        threadId: root.threadId,
        parentId: root.id,
      }),
    );
    const ownReply = await asOwner(() =>
      addComment.run(
        {
          ...deck,
          slideId: "slide-1",
          content: "The agent's reply",
          threadId: root.threadId,
          parentId: root.id,
        },
        { caller: "tool" },
      ),
    );
    const needsApproval = (id: string, caller: string) =>
      asOwner(() => deleteComment.needsApproval({ ...deck, id }, { caller }));

    expect(await needsApproval(root.id, "tool")).toBe(true);
    expect(await needsApproval(reply.id, "tool")).toBe(true);
    expect(await needsApproval(ownReply.id, "tool")).toBe(false);
    expect(await needsApproval(root.id, "frontend")).toBe(false);
    expect(
      await as(COMMENTER, () =>
        deleteComment.needsApproval(
          { ...deck, id: root.id },
          { caller: "tool" },
        ),
      ),
    ).toBe(false);

    await expect(
      asOwner(() =>
        deleteComment.run({ ...deck, id: root.id }, { caller: "tool" }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await stored(reply.id))?.status).toBe("open");

    const kitDelete = deleteReviewComment as unknown as Runnable;
    const kitArgs = {
      resourceType: "deck",
      resourceId: deck.deckId,
      commentId: root.id,
    };
    const agent = { ...OWNER, caller: "tool" };
    expect(await asOwner(() => kitDelete.needsApproval(kitArgs, agent))).toBe(
      true,
    );
    await expect(
      asOwner(() => kitDelete.run(kitArgs, agent)),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await stored(reply.id))?.status).toBe("open");

    const result = await asOwner(() =>
      deleteComment.run(
        { ...deck, id: root.id },
        { caller: "tool", approvedToolCallKey: "approved-1" },
      ),
    );
    expect([...result.removedIds].sort()).toEqual(
      [root.id, reply.id, ownReply.id].sort(),
    );
    expect((await stored(reply.id))?.status).toBe("deleted");
  });

  it("pages a deck's comments by cursor or by offset", async () => {
    await createDeck("deck-pages");
    const ids: string[] = [];
    for (const [index, slideId] of [
      "slide-1",
      "slide-2",
      "slide-1",
      "slide-1",
      "slide-2",
    ].entries()) {
      const comment = await asOwner(() =>
        addComment.run({
          deckId: "deck-pages",
          slideId,
          content: `Comment ${index}`,
        }),
      );
      ids.push(comment.id);
    }
    const idsOf = (page: { comments: Array<{ id: string }> }) =>
      page.comments.map((comment) => comment.id);

    const first = await listed("deck-pages", { limit: 2 });
    expect(idsOf(first)).toEqual(ids.slice(0, 2));
    expect(first).toMatchObject({ has_more: true, next_offset: 2, limit: 2 });
    const second = await listed("deck-pages", {
      limit: 2,
      cursor: first.next_cursor,
    });
    expect(idsOf(second)).toEqual(ids.slice(2, 4));
    const byOffset = await listed("deck-pages", { limit: 2, offset: 4 });
    expect(idsOf(byOffset)).toEqual(ids.slice(4));
    expect(byOffset).toMatchObject({ has_more: false, next_cursor: null });
    expect(idsOf(await listed("deck-pages", { slideId: "slide-1" }))).toEqual([
      ids[0],
      ids[2],
      ids[3],
    ]);
    expect(idsOf(await listed("deck-pages", { offset: 9 }))).toEqual([]);
  });

  it("checks a new thread's slide whoever writes it", async () => {
    await createDeck("deck-kit-write");
    const deck = { resourceType: "deck", resourceId: "deck-kit-write" };
    await expect(
      asOwner(async () =>
        createReviewComment.run(
          { ...deck, body: "Nowhere" } as never,
          OWNER as never,
        ),
      ),
    ).rejects.toThrow("A deck comment needs the slide it's on");
    const comment = await asOwner(async () =>
      createReviewComment.run(
        { ...deck, body: "Through the kit", surfaceId: "slide-2" } as never,
        OWNER as never,
      ),
    );
    expect(
      (await listed("deck-kit-write", { slideId: "slide-2" })).comments,
    ).toEqual([expect.objectContaining({ id: comment.id })]);
  });

  it("adds only the comments the kit lacks from the table Slides used before", async () => {
    await createDeck("deck-legacy");
    const { getDb, schema } = dbModule;
    await getDb()
      .insert(schema.slideComments)
      .values([
        {
          id: "legacy-root",
          deckId: "deck-legacy",
          slideId: "slide-2",
          threadId: "legacy-root",
          content: "Old note",
          anchor: JSON.stringify({ x: 1, y: 2 }),
          emojiReactionsJson: JSON.stringify({
            "🎉": ["owner@example.test", "agent:owner@example.test"],
          }),
          authorEmail: OWNER.userEmail,
          resolved: true,
          createdAt: "2026-10-01T09:00:00.000Z",
          updatedAt: "2026-10-02T09:00:00.000Z",
        },
        {
          id: "legacy-agent",
          deckId: "deck-legacy",
          slideId: "slide-2",
          threadId: "legacy-root",
          parentId: "legacy-root",
          content: "Fixed it",
          authorEmail: OWNER.userEmail,
          authorName: "AI Agent",
          resolved: true,
          createdAt: "2026-10-01T09:05:00.000Z",
          updatedAt: "2026-10-01T09:05:00.000Z",
        },
      ]);
    await getDb().insert(schema.slideComments).values({
      id: "orphan",
      deckId: "deck-gone",
      slideId: "slide-1",
      threadId: "orphan",
      content: "Orphaned",
      authorEmail: OWNER.userEmail,
    });

    const first = await copy.addMissingSlideCommentsToReviewKit();
    expect(first).toMatchObject({ added: 2, failedDecks: [] });
    expect(await stored("legacy-agent")).toMatchObject({
      createdBy: "agent",
      createdAt: "2026-10-01T09:05:00.000Z",
      status: "resolved",
    });
    expect((await stored("legacy-root"))?.resolvedAt).toBe(
      "2026-10-02T09:00:00.000Z",
    );
    expect((await listed("deck-legacy")).comments[0]).toMatchObject({
      id: "legacy-root",
      anchor: { x: 1, y: 2 },
      reactions: [{ emoji: "🎉", count: 2, reacted: true }],
    });
    expect(await stored("orphan")).toBeNull();

    await asOwner(() =>
      updateComment.run({
        deckId: "deck-legacy",
        id: "legacy-root",
        content: "Edited since",
        resolved: false,
      }),
    );
    await asOwner(() =>
      deleteComment.run({ deckId: "deck-legacy", id: "legacy-agent" }),
    );
    const again = await copy.addMissingSlideCommentsToReviewKit();
    expect(again).toMatchObject({ added: 0, failedDecks: [] });
    expect(await stored("legacy-root")).toMatchObject({
      body: "Edited since",
      status: "open",
    });
    expect((await stored("legacy-agent"))?.status).toBe("deleted");
  });

  it("links a reply Slides saved with no parent, so deleting it leaves its thread", async () => {
    await createDeck("deck-unlinked");
    const { getDb, schema } = dbModule;
    const deckId = "deck-unlinked";
    const thread = {
      deckId,
      slideId: "slide-1",
      threadId: "old-root",
      authorEmail: OWNER.userEmail,
    };
    await getDb()
      .insert(schema.slideComments)
      .values([
        {
          ...thread,
          id: "old-root",
          content: "Old thread",
          createdAt: "2026-10-01T09:00:00.000Z",
          updatedAt: "2026-10-01T09:00:00.000Z",
        },
        {
          ...thread,
          id: "old-reply",
          content: "A reply saved with no parent",
          createdAt: "2026-10-01T09:01:00.000Z",
          updatedAt: "2026-10-01T09:01:00.000Z",
        },
        {
          ...thread,
          id: "old-reply-2",
          content: "One the kit never had",
          createdAt: "2026-10-01T09:02:00.000Z",
          updatedAt: "2026-10-01T09:02:00.000Z",
        },
      ]);
    const rows = await getDb()
      .select()
      .from(schema.slideComments)
      .where(eq(schema.slideComments.deckId, deckId));
    await mirrorReviewComments(
      { resourceType: "deck", resourceId: deckId, ...OWNER },
      rows
        .filter((row) => row.id !== "old-reply-2")
        .map((row) => copy.slideCommentCopy(row)),
    );
    await expect(
      asOwner(() => deleteComment.run({ deckId, id: "old-reply" })),
    ).rejects.toMatchObject({ statusCode: 409, errorCode: "reply_not_linked" });
    expect((await stored("old-root"))?.status).toBe("open");

    const report = await copy.addMissingSlideCommentsToReviewKit();
    expect(report).toMatchObject({ added: 1, linked: 1, failedDecks: [] });
    expect((await stored("old-reply"))?.parentCommentId).toBe("old-root");
    expect((await stored("old-reply-2"))?.parentCommentId).toBe("old-root");
    expect((await copy.addMissingSlideCommentsToReviewKit()).linked).toBe(0);

    const result = await asOwner(() =>
      deleteComment.run({ deckId, id: "old-reply" }),
    );
    expect(result.removedIds).toEqual(["old-reply"]);
    expect((await stored("old-reply"))?.status).toBe("deleted");
    expect((await stored("old-root"))?.status).toBe("open");
    expect((await stored("old-reply-2"))?.status).toBe("open");
  });
});
