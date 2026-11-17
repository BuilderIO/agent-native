import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import {
  compareMirroredReviewComments,
  getReviewCommentById,
} from "@agent-native/core/review";
import createReviewComment from "@agent-native/core/review/actions/create-review-comment";
import deleteReviewComment from "@agent-native/core/review/actions/delete-review-comment";
import reactToReviewComment from "@agent-native/core/review/actions/react-to-review-comment";
import resolveReviewThread from "@agent-native/core/review/actions/resolve-review-thread";
import sendReviewThreadToAgent from "@agent-native/core/review/actions/send-review-thread-to-agent";
import updateReviewComment from "@agent-native/core/review/actions/update-review-comment";
import { runWithRequestContext } from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `slide-comment-mirror-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = { userEmail: "owner@example.test", orgId: "mirror-org" };

vi.mock("./comment-notifications.js", () => ({
  notifyDeckComment: vi.fn(async () => false),
}));

interface Runnable<T = unknown> {
  run: (args: unknown, ctx?: unknown) => Promise<T>;
}

let dbModule: typeof import("../db/index.js");
let mirror: typeof import("./slide-comment-mirror.js");
let addComment: Runnable<{ id: string; threadId: string }>;
let updateComment: Runnable;
let toggleReaction: Runnable;
let deleteComment: Runnable;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides.example.test";
  dbModule = await import("../db/index.js");
  mirror = await import("./slide-comment-mirror.js");
  addComment = (await import("../../actions/add-slide-comment.js"))
    .default as never;
  updateComment = (await import("../../actions/update-slide-comment.js"))
    .default as never;
  toggleReaction = (
    await import("../../actions/toggle-slide-comment-reaction.js")
  ).default as never;
  deleteComment = (await import("../../actions/delete-slide-comment.js"))
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

async function createDeck(id: string) {
  const { getDb, schema } = dbModule;
  await getDb()
    .insert(schema.decks)
    .values({
      id,
      title: "Mirror deck",
      data: JSON.stringify({
        slides: [
          { id: "slide-1", content: "<h1>One</h1>" },
          { id: "slide-2", content: "<h1>Two</h1>" },
        ],
      }),
      ownerEmail: OWNER.userEmail,
      orgId: OWNER.orgId,
    });
}

async function slideCopies(deckId: string) {
  const { getDb, schema } = dbModule;
  const rows = await getDb()
    .select()
    .from(schema.slideComments)
    .where(eq(schema.slideComments.deckId, deckId))
    .orderBy(asc(schema.slideComments.createdAt));
  return rows.map(mirror.slideCommentCopy);
}

async function expectStoresAgree(deckId: string) {
  const { getDb, schema } = dbModule;
  const [sharing] = await getDb()
    .select({
      ownerEmail: schema.decks.ownerEmail,
      orgId: schema.decks.orgId,
      visibility: schema.decks.visibility,
    })
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .limit(1);
  const copies = await slideCopies(deckId);
  expect(
    await compareMirroredReviewComments(
      { resourceType: "deck", resourceId: deckId, ...sharing },
      copies,
    ),
  ).toEqual({ checked: copies.length, differences: [] });
}

const asOwner = <T>(run: () => Promise<T>) => runWithRequestContext(OWNER, run);

const stored = (id: string) =>
  getReviewCommentById(id, {}, { bypassScope: true });

describe("Slides comments in the review kit", () => {
  it("keeps the kit matching slide_comments through every comment action", async () => {
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
    await expectStoresAgree("deck-actions");
    expect(await stored(root.id)).toMatchObject({
      resourceType: "deck",
      resourceId: "deck-actions",
      surfaceId: "slide-1",
      anchorKind: "slide-point",
      anchor: { x: 12.5, y: 40, objectId: "title", objectX: 5, objectY: 6 },
      metadata: { quotedText: "One" },
      ownerEmail: OWNER.userEmail,
      orgId: OWNER.orgId,
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
    await asOwner(() =>
      toggleReaction.run({
        deckId: "deck-actions",
        commentId: root.id,
        emoji: "👍",
      }),
    );
    await asOwner(() =>
      toggleReaction.run(
        { deckId: "deck-actions", commentId: root.id, emoji: "👍" },
        { caller: "tool" },
      ),
    );
    await asOwner(() =>
      updateComment.run({
        deckId: "deck-actions",
        id: root.id,
        content: "Tighten the headline, please",
        resolved: true,
      }),
    );
    await expectStoresAgree("deck-actions");
    expect(await stored(reply.id)).toMatchObject({
      createdBy: "agent",
      authorName: "AI Agent",
      parentCommentId: root.id,
      status: "resolved",
    });

    await asOwner(() =>
      updateComment.run({
        deckId: "deck-actions",
        id: root.id,
        resolved: false,
      }),
    );
    await asOwner(() =>
      deleteComment.run({ deckId: "deck-actions", id: reply.id }),
    );
    await expectStoresAgree("deck-actions");
    expect(await stored(reply.id)).toMatchObject({
      status: "deleted",
      body: "",
      deletedBy: OWNER.userEmail,
    });

    await asOwner(() =>
      deleteComment.run({ deckId: "deck-actions", id: root.id }),
    );
    await expectStoresAgree("deck-actions");
    expect((await stored(root.id))?.status).toBe("deleted");
  });

  it("rolls the kit's copy back with a comment write that fails", async () => {
    await createDeck("deck-rollback");
    const { getDb, schema } = dbModule;

    await expect(
      getDb().transaction(async (tx) => {
        await tx.insert(schema.slideComments).values({
          id: "rolled-back",
          deckId: "deck-rollback",
          slideId: "slide-1",
          threadId: "rolled-back",
          content: "Never saved",
          authorEmail: OWNER.userEmail,
        });
        await mirror.mirrorSlideComments(tx, "deck-rollback", ["rolled-back"]);
        expect(await stored("rolled-back")).not.toBeNull();
        throw new Error("The deck write failed");
      }),
    ).rejects.toThrow("The deck write failed");

    expect(await stored("rolled-back")).toBeNull();
  });

  it("copies comments written before the mirror, and copies again safely", async () => {
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
    // Rows a deleted deck left behind have no deck to sit on.
    await getDb().insert(schema.slideComments).values({
      id: "orphan",
      deckId: "deck-gone",
      slideId: "slide-1",
      threadId: "orphan",
      content: "Orphaned",
      authorEmail: OWNER.userEmail,
    });

    const first = await mirror.copySlideCommentsToReviewKit();
    expect(first.failedDecks).toEqual([]);
    expect(first.differences).toEqual([]);
    await expectStoresAgree("deck-legacy");
    expect(await stored("legacy-agent")).toMatchObject({
      createdBy: "agent",
      createdAt: "2026-10-01T09:05:00.000Z",
      status: "resolved",
    });
    // Slides never kept when a comment was resolved; its last update stands in.
    expect((await stored("legacy-root"))?.resolvedAt).toBe(
      "2026-10-02T09:00:00.000Z",
    );
    expect(await stored("orphan")).toBeNull();

    const again = await mirror.copySlideCommentsToReviewKit();
    expect(again.differences).toEqual([]);
    expect((await stored("legacy-root"))?.revision).toBe(1);
  });

  it("reports a deck whose comments only the kit still has", async () => {
    await createDeck("deck-kit-only");
    const comment = await asOwner(() =>
      addComment.run({
        deckId: "deck-kit-only",
        slideId: "slide-1",
        content: "Gone from Slides",
      }),
    );
    // As if deleted from Slides while a build without the mirror ran.
    const { getDb, schema } = dbModule;
    await getDb()
      .delete(schema.slideComments)
      .where(eq(schema.slideComments.deckId, "deck-kit-only"));

    const report = await mirror.copySlideCommentsToReviewKit();
    expect(report.differences).toEqual([
      { deckId: "deck-kit-only", id: comment.id, problem: "extra" },
    ]);
    // Reported, not deleted: someone decides what happens to it.
    expect((await stored(comment.id))?.body).toBe("Gone from Slides");

    await mirror.deleteMirroredSlideComments("deck-kit-only", "all");
    expect((await mirror.copySlideCommentsToReviewKit()).differences).toEqual(
      [],
    );
  });

  it("refuses deck comment writes through the kit's own actions", async () => {
    await createDeck("deck-kit-write");
    const comment = await asOwner(() =>
      addComment.run({
        deckId: "deck-kit-write",
        slideId: "slide-1",
        content: "Resolved in Slides",
      }),
    );
    await asOwner(() =>
      updateComment.run({
        deckId: "deck-kit-write",
        id: comment.id,
        resolved: true,
      }),
    );
    const deck = { resourceType: "deck", resourceId: "deck-kit-write" };
    const kitWrites: Array<[unknown, Record<string, unknown>]> = [
      [createReviewComment, { ...deck, body: "Written around Slides" }],
      [
        reactToReviewComment,
        { ...deck, commentId: comment.id, reaction: "👀", active: true },
      ],
      // A note on a thread that's already resolved changes nothing else.
      [
        resolveReviewThread,
        { ...deck, threadId: comment.threadId, resolutionNote: "Noted" },
      ],
      [sendReviewThreadToAgent, { ...deck, threadId: comment.threadId }],
      [
        updateReviewComment,
        { ...deck, commentId: comment.id, body: "Edited around Slides" },
      ],
      [deleteReviewComment, { ...deck, commentId: comment.id }],
    ];

    for (const [action, args] of kitWrites) {
      await expect(
        asOwner(() => (action as Runnable).run(args, OWNER)),
      ).rejects.toThrow("add-slide-comment");
    }
    await expectStoresAgree("deck-kit-write");
  });
});
