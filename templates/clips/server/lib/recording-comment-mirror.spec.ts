import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionRunContext } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  getReviewCommentById,
  mirrorReviewComments,
} from "@agent-native/core/review";
import createReviewComment from "@agent-native/core/review/actions/create-review-comment";
import deleteReviewComment from "@agent-native/core/review/actions/delete-review-comment";
import listReviewComments from "@agent-native/core/review/actions/list-review-comments";
import reactToReviewComment from "@agent-native/core/review/actions/react-to-review-comment";
import replyReviewComment from "@agent-native/core/review/actions/reply-review-comment";
import resolveReviewThread from "@agent-native/core/review/actions/resolve-review-thread";
import updateReviewComment from "@agent-native/core/review/actions/update-review-comment";
import updateReviewCommentAnchor from "@agent-native/core/review/actions/update-review-comment-anchor";
import { runWithRequestContext } from "@agent-native/core/server";
import { signShortLivedToken } from "@agent-native/core/server/short-lived-token";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getCommentAccessTokenResourceId } from "./comment-access-token.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `recording-comment-mirror-${process.pid}-${Date.now()}.pglite`,
);
const ORG = "mirror-org";
const OWNER = "owner@example.test";
const EDITOR = "editor@example.test";
const COMMENTER = "commenter@example.test";
const VIEWER = "viewer@example.test";
const MEMBER = "member@example.test";
const STRANGER = "stranger@example.test";
const PASSWORD = "fake-stored-share-password";

const emails = vi.hoisted(() => ({
  sendRecordingCommentEmails: vi.fn(async (_comment: { id: string }) => null),
}));

vi.mock("./activity-notifications.js", () => ({
  notifyRecordingComment: vi.fn(async () => null),
  notifyRecordingReaction: vi.fn(async () => null),
  sendRecordingCommentEmails: emails.sendRecordingCommentEmails,
}));

interface Runnable<T = unknown> {
  run: (args: unknown, ctx?: unknown) => Promise<T>;
}
type Saved = {
  id: string;
  threadId: string;
  parentId: string | null;
  repeated: boolean;
};

let dbModule: typeof import("../db/index.js");
let mirror: typeof import("./recording-comment-mirror.js");
let comments: typeof import("./recording-comments.js");
let review: typeof import("./recording-comment-review.js");
let addComment: Runnable<Saved>;
let replyToComment: Runnable<Saved>;
let updateComment: Runnable;
let resolveComment: Runnable;
let reactToComment: Runnable<{
  reacted: boolean;
  reactions: Record<string, string[]>;
}>;
let deleteComment: Runnable<{ deletedCommentIds: string[] }>;
let listComments: Runnable<{ comments: unknown[] }>;
let trashRecording: Runnable;
let deleteRecordingPermanent: Runnable;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://clips.example.test";
  dbModule = await import("../db/index.js");
  mirror = await import("./recording-comment-mirror.js");
  comments = await import("./recording-comments.js");
  review = await import("./recording-comment-review.js");
  addComment = (await import("../../actions/add-comment.js")).default as never;
  replyToComment = (await import("../../actions/reply-to-comment.js"))
    .default as never;
  updateComment = (await import("../../actions/update-comment.js"))
    .default as never;
  resolveComment = (await import("../../actions/resolve-comment.js"))
    .default as never;
  reactToComment = (await import("../../actions/react-to-comment.js"))
    .default as never;
  deleteComment = (await import("../../actions/delete-comment.js"))
    .default as never;
  listComments = (await import("../../actions/list-comments.js"))
    .default as never;
  trashRecording = (await import("../../actions/trash-recording.js"))
    .default as never;
  deleteRecordingPermanent = (
    await import("../../actions/delete-recording-permanent.js")
  ).default as never;
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
  await getDbExec().execute({
    sql: `INSERT INTO organizations (id, name, created_by, created_at)
      VALUES (?, 'Mirror org', ?, 0) ON CONFLICT DO NOTHING`,
    args: [ORG, OWNER],
  });
  for (const email of [OWNER, MEMBER]) {
    await getDbExec().execute({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
        VALUES (?, ?, ?, 'member', 0) ON CONFLICT DO NOTHING`,
      args: [`member-${email}`, ORG, email],
    });
  }
}, 180000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function createRecording(
  id: string,
  options: {
    visibility?: "private" | "org" | "public";
    password?: string | null;
    expiresAt?: string | null;
    enableComments?: boolean;
    shares?: Array<[string, "viewer" | "commenter" | "editor"]>;
  } = {},
) {
  const { getDb, schema } = dbModule;
  await getDb()
    .insert(schema.recordings)
    .values({
      id,
      organizationId: ORG,
      orgId: ORG,
      ownerEmail: OWNER,
      title: "Mirror clip",
      status: "ready",
      visibility: options.visibility ?? "private",
      password: options.password ?? null,
      expiresAt: options.expiresAt ?? null,
      enableComments: options.enableComments ?? true,
    });
  for (const [email, role] of options.shares ?? []) {
    await getDb()
      .insert(schema.recordingShares)
      .values({
        id: `${id}-${email}`,
        resourceId: id,
        principalType: "user",
        principalId: email,
        role,
        createdBy: OWNER,
      });
  }
}

async function clipsRows(recordingId: string) {
  const { getDb, schema } = dbModule;
  return getDb()
    .select({ id: schema.recordingComments.id })
    .from(schema.recordingComments)
    .where(eq(schema.recordingComments.recordingId, recordingId));
}

async function clipsRowsInFull(recordingId: string) {
  const { getDb, schema } = dbModule;
  return getDb()
    .select()
    .from(schema.recordingComments)
    .where(eq(schema.recordingComments.recordingId, recordingId));
}

async function kitRows(recordingId: string) {
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, status, revision, updated_at FROM agent_review_comments
      WHERE resource_type = 'recording' AND resource_id = ? ORDER BY id`,
    args: [recordingId],
  });
  return rows;
}

const as = async <T>(
  userEmail: string | null,
  run: () => Promise<T>,
): Promise<T> =>
  runWithRequestContext(userEmail ? { userEmail, orgId: ORG } : {}, run);

const stored = (id: string) =>
  getReviewCommentById(id, {}, { bypassScope: true });

function unlockedFor(recordingId: string): Headers {
  return new Headers({
    "x-clips-comment-token": signShortLivedToken({
      resourceId: getCommentAccessTokenResourceId(
        recordingId,
        PASSWORD,
        "initial",
      ),
      ttlSeconds: 600,
    }),
  });
}

describe("Clips comments in the review kit", () => {
  it("reads and writes every comment action through the kit and leaves recording_comments alone", async () => {
    await createRecording("rec-actions", { shares: [[VIEWER, "viewer"]] });
    const root = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-actions",
        content: "Tighten the **intro**",
        videoTimestampMs: 12_542,
      }),
    );
    expect(await stored(root.id)).toMatchObject({
      resourceType: "recording",
      resourceId: "rec-actions",
      threadId: root.id,
      parentCommentId: null,
      anchorKind: "video-time",
      anchorVersion: 1,
      anchor: { videoTimestampMs: 12_542 },
      body: "Tighten the **intro**",
      authorEmail: OWNER,
      createdBy: "human",
      ownerEmail: OWNER,
      orgId: ORG,
      visibility: "private",
    });
    expect(emails.sendRecordingCommentEmails).toHaveBeenCalledWith(
      expect.objectContaining({ id: root.id }),
    );

    const reply = await as(VIEWER, () =>
      replyToComment.run({ commentId: root.id, content: "On it" }),
    );
    const nested = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-actions",
        content: "At this frame instead",
        videoTimestampMs: 13_000,
        threadId: root.threadId,
        parentId: reply.id,
      }),
    );
    expect(reply).toMatchObject({ threadId: root.id, parentId: root.id });
    expect(await stored(reply.id)).toMatchObject({
      threadId: root.id,
      parentCommentId: root.id,
      anchor: { videoTimestampMs: 12_542 },
    });
    expect(await stored(nested.id)).toMatchObject({
      parentCommentId: reply.id,
      anchor: { videoTimestampMs: 12_542 },
    });

    await as(VIEWER, () =>
      reactToComment.run({ commentId: root.id, emoji: "👍" }),
    );
    const reacted = await as(OWNER, () =>
      reactToComment.run({ commentId: root.id, emoji: "👍" }),
    );
    expect(reacted.reacted).toBe(true);
    expect(reacted.reactions["👍"]?.sort()).toEqual([OWNER, VIEWER].sort());
    await as(OWNER, () =>
      reactToComment.run({ commentId: reply.id, emoji: "🔥" }),
    );
    const undone = await as(OWNER, () =>
      reactToComment.run({ commentId: reply.id, emoji: "🔥" }),
    );
    expect(undone).toMatchObject({ reacted: false, reactions: {} });

    await as(OWNER, () =>
      updateComment.run({ id: root.id, content: "Tighten the intro, please" }),
    );
    expect((await stored(root.id))?.body).toBe("Tighten the intro, please");

    const listed = await as(VIEWER, () =>
      listComments.run({ recordingId: "rec-actions" }),
    );
    expect(listed.comments).toHaveLength(3);
    expect(listed.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: root.id,
          threadId: root.id,
          parentId: null,
          content: "Tighten the intro, please",
          videoTimestampMs: 12_542,
          resolved: false,
        }),
        expect.objectContaining({ id: reply.id, parentId: root.id }),
        expect.objectContaining({ id: nested.id, parentId: reply.id }),
      ]),
    );

    await expect(
      as(VIEWER, () => resolveComment.run({ id: reply.id })),
    ).rejects.toThrow("Only the comment author or a recording editor");
    await as(OWNER, () => resolveComment.run({ id: reply.id }));
    for (const id of [root.id, reply.id, nested.id]) {
      expect((await stored(id))?.status).toBe("resolved");
    }
    await expect(
      as(VIEWER, () =>
        replyToComment.run({ commentId: root.id, content: "Too late" }),
      ),
    ).rejects.toMatchObject({ errorCode: "thread_not_open" });
    await as(OWNER, () => resolveComment.run({ id: root.id, resolved: false }));
    expect((await stored(root.id))?.status).toBe("open");
    await getDbExec().execute({
      sql: "UPDATE agent_review_comments SET status = 'resolved' WHERE id = ?",
      args: [root.id],
    });
    await as(OWNER, () => resolveComment.run({ id: nested.id }));
    expect((await stored(root.id))?.status).toBe("open");

    await as(OWNER, () => deleteComment.run({ id: nested.id }));
    expect(await stored(nested.id)).toMatchObject({
      status: "deleted",
      body: "",
      deletedBy: OWNER,
    });
    const removed = await as(OWNER, () => deleteComment.run({ id: root.id }));
    expect(removed.deletedCommentIds.sort()).toEqual(
      [reply.id, root.id].sort(),
    );
    expect((await stored(reply.id))?.status).toBe("deleted");
    expect(await clipsRows("rec-actions")).toEqual([]);
  });

  it("saves a keyed comment once, and refuses its key for another comment or after a delete", async () => {
    await createRecording("rec-repeat", { shares: [[VIEWER, "viewer"]] });
    const args = {
      recordingId: "rec-repeat",
      content: "Saved once",
      videoTimestampMs: 4_000,
      idempotencyKey: "mirror-repeat-key-0001",
    };
    const sent = emails.sendRecordingCommentEmails.mock.calls.length;
    const first = await as(OWNER, () => addComment.run(args));
    const before = await kitRows("rec-repeat");
    const second = await as(OWNER, () => addComment.run(args));

    expect(second).toMatchObject({ id: first.id, repeated: true });
    expect(await kitRows("rec-repeat")).toEqual(before);
    expect(emails.sendRecordingCommentEmails.mock.calls.length).toBe(sent + 1);

    await expect(
      as(OWNER, () => addComment.run({ ...args, content: "Something else" })),
    ).rejects.toMatchObject({
      errorCode: "comment_key_used",
      statusCode: 409,
    });
    const viewers = await as(VIEWER, () => addComment.run(args));
    expect(viewers.id).not.toBe(first.id);

    await as(OWNER, () => deleteComment.run({ id: first.id }));
    await expect(as(OWNER, () => addComment.run(args))).rejects.toMatchObject({
      errorCode: "comment_key_used",
      message: expect.stringContaining("was deleted"),
    });
  });

  it("moves comments with a Rewind that shifts the video, and leaves deleted ones", async () => {
    await createRecording("rec-rewind");
    const add = (videoTimestampMs: number) =>
      as(OWNER, () =>
        addComment.run({
          recordingId: "rec-rewind",
          content: "Here",
          videoTimestampMs,
        }),
      );
    const comment = await add(1_000);
    const gone = await add(2_000);
    await as(OWNER, () => deleteComment.run({ id: gone.id }));
    const revision = (await stored(comment.id))?.revision ?? 0;
    const goneAnchor = (await stored(gone.id))?.anchor;
    const { getDb } = dbModule;
    await getDb().transaction((tx) =>
      comments.shiftRecordingComments(tx, "rec-rewind", 5_000),
    );

    expect(await stored(comment.id)).toMatchObject({
      anchor: { videoTimestampMs: 6_000 },
      revision: revision + 1,
    });
    expect((await stored(gone.id))?.anchor).toEqual(goneAnchor);
  });

  it("leaves comments as they were when a recording is trashed", async () => {
    await createRecording("rec-trash", { shares: [[VIEWER, "viewer"]] });
    const comment = await as(VIEWER, () =>
      addComment.run({
        recordingId: "rec-trash",
        content: "Before the trash",
        videoTimestampMs: 0,
      }),
    );
    await as(OWNER, () => trashRecording.run({ id: "rec-trash" }));

    expect((await stored(comment.id))?.status).toBe("open");
    expect(
      await review.resolveRecordingCommentAccess("rec-trash", {
        userEmail: VIEWER,
      }),
    ).toBeNull();
    expect(
      (
        await review.resolveRecordingCommentAccess("rec-trash", {
          userEmail: OWNER,
        })
      )?.role,
    ).toBe("owner");
  });

  it("marks every comment deleted in the kit when a recording is deleted for good", async () => {
    await createRecording("rec-delete", { shares: [[VIEWER, "viewer"]] });
    const root = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-delete",
        content: "Goes with the clip",
        videoTimestampMs: 0,
      }),
    );
    const reply = await as(VIEWER, () =>
      replyToComment.run({ commentId: root.id, content: "So does this" }),
    );
    await as(OWNER, () => deleteRecordingPermanent.run({ id: "rec-delete" }));

    for (const id of [root.id, reply.id]) {
      expect(await stored(id)).toMatchObject({
        status: "deleted",
        body: "",
        deletedBy: OWNER,
      });
    }
  });

  it("deletes a comment's copy from before the switch along with it, emptying one that holds a key", async () => {
    await createRecording("rec-old-copies");
    const { getDb, schema } = dbModule;
    await getDb()
      .insert(schema.recordingComments)
      .values(
        [
          { id: "old-root", threadId: "old-root", parentId: null },
          { id: "old-reply", threadId: "old-root", parentId: "old-root" },
          { id: "old-kept", threadId: "old-kept", parentId: null },
          {
            id: "old-keyed",
            threadId: "old-keyed",
            parentId: null,
            idempotencyKey: "content-key",
            mentionsJson: JSON.stringify([{ email: MEMBER, name: "Member" }]),
            emojiReactionsJson: JSON.stringify({ "🎉": [MEMBER] }),
          },
        ].map((row) => ({
          ...row,
          recordingId: "rec-old-copies",
          organizationId: ORG,
          content: `Written as ${row.id}`,
          videoTimestampMs: 5_000,
          authorEmail: OWNER,
          createdAt: "2026-10-01T09:00:00.000Z",
          updatedAt: "2026-10-01T09:00:00.000Z",
        })),
      );
    await mirrorReviewComments(
      { resourceType: "recording", resourceId: "rec-old-copies" },
      (await clipsRowsInFull("rec-old-copies")).map((row) =>
        mirror.recordingCommentCopy(row),
      ),
    );
    const oldIds = async () =>
      (await clipsRows("rec-old-copies")).map((row) => row.id).sort();

    await as(OWNER, () => deleteComment.run({ id: "old-reply" }));
    expect(await oldIds()).toEqual(["old-kept", "old-keyed", "old-root"]);
    await as(OWNER, () =>
      (deleteReviewComment as Runnable).run(
        {
          resourceType: "recording",
          resourceId: "rec-old-copies",
          commentId: "old-root",
        },
        { userEmail: OWNER, orgId: ORG, caller: "frontend" },
      ),
    );
    expect(await oldIds()).toEqual(["old-kept", "old-keyed"]);
    expect(await stored("old-root")).toMatchObject({ status: "deleted" });
    await as(OWNER, () => deleteComment.run({ id: "old-keyed" }));
    const left = await clipsRowsInFull("rec-old-copies");
    expect(
      left
        .map(
          ({
            id,
            content,
            idempotencyKey,
            mentionsJson,
            emojiReactionsJson,
          }) => ({
            id,
            content,
            idempotencyKey,
            mentionsJson,
            emojiReactionsJson,
          }),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    ).toEqual([
      {
        id: "old-kept",
        content: "Written as old-kept",
        idempotencyKey: null,
        mentionsJson: null,
        emojiReactionsJson: "{}",
      },
      {
        id: "old-keyed",
        content: "",
        idempotencyKey: "content-key",
        mentionsJson: null,
        emojiReactionsJson: "{}",
      },
    ]);
  });

  it("adds the comments the kit lacks once, links replies saved without a parent, and changes nothing else", async () => {
    await createRecording("rec-legacy", { visibility: "public" });
    const { getDb, schema } = dbModule;
    await getDb()
      .insert(schema.recordingComments)
      .values([
        {
          id: "legacy-root",
          recordingId: "rec-legacy",
          organizationId: ORG,
          threadId: "legacy-root",
          content: "Old note @Member",
          mentionsJson: JSON.stringify([{ email: MEMBER, name: "Member" }]),
          videoTimestampMs: 30_000,
          emojiReactionsJson: JSON.stringify({
            "🎉": [OWNER, MEMBER, OWNER],
            "👀": [],
          }),
          authorEmail: MEMBER,
          authorName: "Member",
          resolved: true,
          createdAt: "2026-10-01T09:00:00.000Z",
          updatedAt: "2026-10-02T09:00:00.000Z",
        },
        {
          id: "legacy-reply",
          recordingId: "rec-legacy",
          organizationId: ORG,
          threadId: "legacy-root",
          parentId: "legacy-root",
          content: "Fixed it",
          videoTimestampMs: 30_000,
          authorEmail: OWNER,
          createdAt: "2026-10-01T09:05:00.000Z",
          updatedAt: "2026-10-01T09:05:00.000Z",
        },
        {
          id: "legacy-unlinked",
          recordingId: "rec-legacy",
          organizationId: ORG,
          threadId: "legacy-root",
          content: "Reply saved without a parent",
          videoTimestampMs: 30_000,
          emojiReactionsJson: "not json",
          authorEmail: OWNER,
          createdAt: "2026-10-01T09:06:00.000Z",
          updatedAt: "2026-10-01T09:06:00.000Z",
        },
        {
          id: "legacy-deleted",
          recordingId: "rec-legacy",
          organizationId: ORG,
          threadId: "legacy-deleted",
          content: "Deleted through the kit",
          videoTimestampMs: 1_000,
          authorEmail: OWNER,
          createdAt: "2026-10-03T09:00:00.000Z",
          updatedAt: "2026-10-03T09:00:00.000Z",
        },
      ]);
    await getDb().insert(schema.recordingComments).values({
      id: "orphan",
      recordingId: "rec-gone",
      organizationId: ORG,
      threadId: "orphan",
      content: "Orphaned",
      authorEmail: OWNER,
    });
    const unlinked = await getDb()
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.id, "legacy-unlinked"));
    await mirrorReviewComments(
      { resourceType: "recording", resourceId: "rec-legacy" },
      [
        ...unlinked.map((row) => mirror.recordingCommentCopy(row)),
        {
          id: "legacy-deleted",
          threadId: "legacy-deleted",
          parentCommentId: null,
          anchor: { videoTimestampMs: 1_000 },
          anchorKind: "video-time",
          anchorVersion: 1,
          body: "Deleted through the kit",
          authorEmail: OWNER,
          authorName: null,
          createdBy: "human",
          resolved: false,
          createdAt: "2026-10-03T09:00:00.000Z",
          updatedAt: "2026-10-03T09:00:00.000Z",
        },
      ],
    );
    await mirror.deleteMirroredRecordingComments(
      "rec-legacy",
      ["legacy-deleted"],
      OWNER,
    );
    const kitWritten = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-legacy",
        content: "Written through the kit",
        videoTimestampMs: 2_000,
      }),
    );

    const first = await mirror.addMissingRecordingCommentsToReviewKit();
    expect(first.failedRecordings).toEqual([]);
    expect(first).toMatchObject({ added: 2, linked: 1 });
    expect(await stored("legacy-root")).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-10-02T09:00:00.000Z",
      createdAt: "2026-10-01T09:00:00.000Z",
      anchor: { videoTimestampMs: 30_000 },
      mentions: [{ label: "Member", email: MEMBER }],
      visibility: "public",
    });
    expect(await stored("legacy-reply")).toMatchObject({
      parentCommentId: "legacy-root",
      status: "open",
    });
    expect(await stored("legacy-unlinked")).toMatchObject({
      threadId: "legacy-root",
      parentCommentId: "legacy-root",
    });
    expect(await stored("legacy-deleted")).toMatchObject({
      status: "deleted",
      body: "",
    });
    expect((await stored(kitWritten.id))?.status).toBe("open");
    expect(await stored("orphan")).toBeNull();
    const { rows: reactions } = await getDbExec().execute(
      `SELECT comment_id, actor_email, reaction FROM agent_review_comment_reactions
        WHERE comment_id IN ('legacy-root', 'legacy-unlinked')
        ORDER BY comment_id, actor_email`,
    );
    expect(reactions).toEqual([
      { comment_id: "legacy-root", actor_email: MEMBER, reaction: "🎉" },
      { comment_id: "legacy-root", actor_email: OWNER, reaction: "🎉" },
    ]);

    await as(OWNER, () =>
      updateComment.run({ id: "legacy-reply", content: "Fixed it for good" }),
    );
    const kitBefore = await kitRows("rec-legacy");
    const again = await mirror.addMissingRecordingCommentsToReviewKit();
    expect(again).toMatchObject({
      added: 0,
      linked: 0,
      failedRecordings: [],
    });
    expect(await kitRows("rec-legacy")).toEqual(kitBefore);
    expect((await stored("legacy-reply"))?.body).toBe("Fixed it for good");
  });

  it("takes recording comments written through the kit's own actions, with Clips' rules and emails", async () => {
    await createRecording("rec-kit-write");
    const recording = {
      resourceType: "recording",
      resourceId: "rec-kit-write",
    };
    const ctx = { userEmail: OWNER, orgId: ORG, caller: "frontend" };
    const run = <T>(action: unknown, args: Record<string, unknown>) =>
      as(OWNER, () => (action as Runnable<T>).run(args, ctx));
    const sent = emails.sendRecordingCommentEmails.mock.calls.length;

    const created = await run<{ id: string; threadId: string }>(
      createReviewComment,
      {
        ...recording,
        body: "Written around Clips",
        anchorKind: "video-time",
        anchor: { videoTimestampMs: 7_000 },
      },
    );
    const replied = await run<{ id: string }>(replyReviewComment, {
      ...recording,
      commentId: created.id,
      body: "Reply around Clips",
    });
    await run(reactToReviewComment, {
      ...recording,
      commentId: created.id,
      reaction: "👀",
      active: true,
    });
    await run(updateReviewComment, {
      ...recording,
      commentId: created.id,
      body: "Edited around Clips",
    });
    await run(resolveReviewThread, {
      ...recording,
      threadId: created.threadId,
      status: "resolved",
    });

    expect(emails.sendRecordingCommentEmails.mock.calls.length).toBe(sent + 2);
    const listed = await as(OWNER, () =>
      listComments.run({ recordingId: "rec-kit-write" }),
    );
    expect(listed.comments).toHaveLength(2);
    expect(listed.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          content: "Edited around Clips",
          videoTimestampMs: 7_000,
          emojiReactionsJson: JSON.stringify({ "👀": [OWNER] }),
          resolved: true,
        }),
        expect.objectContaining({
          id: replied.id,
          parentId: created.id,
          videoTimestampMs: 7_000,
          resolved: true,
        }),
      ]),
    );

    await run(deleteReviewComment, { ...recording, commentId: created.id });
    expect((await stored(replied.id))?.status).toBe("deleted");
  });
});

describe("Clips' comment access through the review kit", () => {
  async function outcome(run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch {
      return false;
    }
  }

  function context(
    userEmail: string | null,
    headers?: Headers,
  ): ActionRunContext {
    return {
      ...(userEmail ? { userEmail, orgId: ORG } : {}),
      caller: "frontend",
      ...(headers ? { requestHeaders: headers } : {}),
    };
  }

  async function compareAccess(
    recordingId: string,
    userEmail: string | null,
    headers?: Headers,
  ) {
    const ctx = context(userEmail, headers);
    const clipsRead = await outcome(() =>
      as(userEmail, () => listComments.run({ recordingId }, ctx)),
    );
    const kitRead = await outcome(() =>
      as(userEmail, () =>
        (listReviewComments as unknown as Runnable).run(
          { resourceType: "recording", resourceId: recordingId },
          ctx,
        ),
      ),
    );
    const clipsWrite = await outcome(() =>
      as(userEmail, () =>
        addComment.run(
          { recordingId, content: "Clips write", videoTimestampMs: 0 },
          ctx,
        ),
      ),
    );
    const kitWrite = await outcome(() =>
      as(userEmail, () =>
        (createReviewComment as unknown as Runnable).run(
          {
            resourceType: "recording",
            resourceId: recordingId,
            body: "Kit write",
            anchorKind: "video-time",
            anchor: { videoTimestampMs: 0 },
          },
          ctx,
        ),
      ),
    );
    return {
      read: clipsRead,
      write: clipsWrite,
      kitRead,
      kitWrite,
    };
  }

  const both = (read: boolean, write: boolean) => ({
    read,
    write,
    kitRead: read,
    kitWrite: write,
  });

  it("lets the owner, a commenter, a viewer and an org member read and write as Clips does", async () => {
    await createRecording("acc-shared", {
      shares: [
        [COMMENTER, "commenter"],
        [VIEWER, "viewer"],
        [EDITOR, "editor"],
      ],
    });
    await createRecording("acc-org", { visibility: "org" });

    expect(await compareAccess("acc-shared", OWNER)).toEqual(both(true, true));
    expect(await compareAccess("acc-shared", COMMENTER)).toEqual(
      both(true, true),
    );
    expect(await compareAccess("acc-shared", VIEWER)).toEqual(both(true, true));
    expect(await compareAccess("acc-shared", STRANGER)).toEqual(
      both(false, false),
    );
    expect(await compareAccess("acc-org", MEMBER)).toEqual(both(true, true));
    expect(await compareAccess("acc-org", STRANGER)).toEqual(
      both(false, false),
    );
    expect(
      (
        await review.resolveRecordingCommentAccess("acc-shared", {
          userEmail: COMMENTER,
        })
      )?.role,
    ).toBe("commenter");
  });

  it("lets a signed-out share-page reader read a public recording but not write", async () => {
    await createRecording("acc-public", { visibility: "public" });
    await createRecording("acc-private-out");

    expect(await compareAccess("acc-public", null)).toEqual(both(true, false));
    expect(await compareAccess("acc-private-out", null)).toEqual(
      both(false, false),
    );
  });

  it("asks everyone but the owner for the share password's comment token", async () => {
    await createRecording("acc-password", {
      visibility: "public",
      password: PASSWORD,
      shares: [[VIEWER, "viewer"]],
    });
    const unlocked = unlockedFor("acc-password");

    expect(await compareAccess("acc-password", VIEWER)).toEqual(
      both(false, false),
    );
    expect(await compareAccess("acc-password", VIEWER, unlocked)).toEqual(
      both(true, true),
    );
    expect(await compareAccess("acc-password", null)).toEqual(
      both(false, false),
    );
    expect(await compareAccess("acc-password", null, unlocked)).toEqual(
      both(true, false),
    );
    expect(await compareAccess("acc-password", OWNER)).toEqual(
      both(true, true),
    );
    expect(
      await compareAccess("acc-password", VIEWER, unlockedFor("acc-other")),
    ).toEqual(both(false, false));
  });

  it("closes an expired share to everyone but the owner", async () => {
    await createRecording("acc-expired", {
      visibility: "public",
      expiresAt: "2000-01-01T00:00:00.000Z",
      shares: [[VIEWER, "viewer"]],
    });

    expect(await compareAccess("acc-expired", VIEWER)).toEqual(
      both(false, false),
    );
    expect(await compareAccess("acc-expired", null)).toEqual(
      both(false, false),
    );
    expect(await compareAccess("acc-expired", OWNER)).toEqual(both(true, true));
  });

  it("keeps comments that are turned off readable by the owner alone and writable by no one", async () => {
    await createRecording("acc-off", {
      enableComments: false,
      shares: [[EDITOR, "editor"]],
    });

    expect(await compareAccess("acc-off", OWNER)).toEqual(both(true, false));
    expect(await compareAccess("acc-off", EDITOR)).toEqual(both(false, false));
  });

  it("lets a viewer delete their own reply after the owner turns comments off", async () => {
    await createRecording("acc-off-later", { shares: [[VIEWER, "viewer"]] });
    const thread = await as(OWNER, () =>
      addComment.run({
        recordingId: "acc-off-later",
        content: "Owner's note",
        videoTimestampMs: 0,
      }),
    );
    const reply = await as(VIEWER, () =>
      addComment.run({
        recordingId: "acc-off-later",
        content: "Viewer's reply",
        videoTimestampMs: 0,
        threadId: thread.threadId,
        parentId: thread.id,
      }),
    );
    const { getDb, schema } = dbModule;
    await getDb()
      .update(schema.recordings)
      .set({ enableComments: false })
      .where(eq(schema.recordings.id, "acc-off-later"));

    await expect(
      as(VIEWER, () => deleteComment.run({ id: reply.id })),
    ).resolves.toMatchObject({ deletedCommentIds: [reply.id] });
    expect((await stored(reply.id))?.status).toBe("deleted");
    expect((await stored(thread.id))?.status).toBe("open");
  });

  it("lets a thread's author or an editor resolve it, and moves no one's comment in time", async () => {
    await createRecording("acc-resolve", {
      shares: [
        [VIEWER, "viewer"],
        [COMMENTER, "commenter"],
        [EDITOR, "editor"],
      ],
    });
    const thread = await as(VIEWER, () =>
      addComment.run({
        recordingId: "acc-resolve",
        content: "Resolve me",
        videoTimestampMs: 0,
      }),
    );
    const resolveAs = (userEmail: string, status: "resolved" | "open") =>
      outcome(() =>
        as(userEmail, () =>
          (resolveReviewThread as unknown as Runnable).run(
            {
              resourceType: "recording",
              resourceId: "acc-resolve",
              threadId: thread.threadId,
              status,
            },
            context(userEmail),
          ),
        ),
      );
    const clipsResolveAs = (userEmail: string, resolved: boolean) =>
      outcome(() =>
        as(userEmail, () =>
          resolveComment.run({ id: thread.id, resolved }, context(userEmail)),
        ),
      );

    expect(await resolveAs(COMMENTER, "resolved")).toBe(false);
    expect(await clipsResolveAs(COMMENTER, true)).toBe(false);
    expect(await resolveAs(VIEWER, "resolved")).toBe(true);
    expect(await clipsResolveAs(VIEWER, true)).toBe(true);
    expect(await resolveAs(EDITOR, "open")).toBe(true);
    expect(await clipsResolveAs(EDITOR, false)).toBe(true);

    expect(
      await outcome(() =>
        as(OWNER, () =>
          (updateReviewCommentAnchor as unknown as Runnable).run(
            {
              resourceType: "recording",
              resourceId: "acc-resolve",
              commentId: thread.id,
              anchorKind: "video-time",
              anchor: { videoTimestampMs: 9_000 },
            },
            context(OWNER),
          ),
        ),
      ),
    ).toBe(false);
  });

  it("routes a new unmentioned thread to people, never the agent", async () => {
    await createRecording("acc-route");
    const created = (await as(OWNER, () =>
      (createReviewComment as unknown as Runnable).run(
        {
          resourceType: "recording",
          resourceId: "acc-route",
          body: "No mention here",
        },
        context(OWNER),
      ),
    )) as { resolutionTarget: string | null };

    expect(created.resolutionTarget).toBe("human");
  });
});
