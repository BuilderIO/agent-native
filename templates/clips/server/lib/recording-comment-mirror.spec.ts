import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionRunContext } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  compareMirroredReviewComments,
  getReviewCommentById,
  mirrorReviewComments,
  registerReviewableResource,
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
import { asc, eq, sql } from "drizzle-orm";
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

vi.mock("./activity-notifications.js", () => ({
  notifyRecordingComment: vi.fn(async () => null),
  notifyRecordingReaction: vi.fn(async () => null),
}));

interface Runnable<T = unknown> {
  run: (args: unknown, ctx?: unknown) => Promise<T>;
}
type Saved = { id: string; threadId: string; repeated: boolean };

let dbModule: typeof import("../db/index.js");
let mirror: typeof import("./recording-comment-mirror.js");
let review: typeof import("./recording-comment-review.js");
let addComment: Runnable<Saved>;
let replyToComment: Runnable<Saved & { parentId: string }>;
let updateComment: Runnable;
let resolveComment: Runnable;
let reactToComment: Runnable;
let deleteComment: Runnable<{ deletedCommentIds: string[] }>;
let listComments: Runnable<{ comments: unknown[] }>;
let trashRecording: Runnable;
let deleteRecordingPermanent: Runnable;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://clips.example.test";
  dbModule = await import("../db/index.js");
  mirror = await import("./recording-comment-mirror.js");
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

async function clipsCopies(recordingId: string) {
  const { getDb, schema } = dbModule;
  const rows = await getDb()
    .select()
    .from(schema.recordingComments)
    .where(eq(schema.recordingComments.recordingId, recordingId))
    .orderBy(asc(schema.recordingComments.createdAt));
  return rows.map(mirror.recordingCommentCopy);
}

async function expectStoresAgree(recordingId: string) {
  const { getDb, schema } = dbModule;
  const [sharing] = await getDb()
    .select({
      ownerEmail: schema.recordings.ownerEmail,
      orgId: schema.recordings.orgId,
      visibility: schema.recordings.visibility,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  const copies = await clipsCopies(recordingId);
  expect(
    await compareMirroredReviewComments(
      { resourceType: "recording", resourceId: recordingId, ...sharing },
      copies,
    ),
  ).toEqual({ checked: copies.length, differences: [] });
  return copies.length;
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
  it("keeps the kit matching recording_comments through every comment action", async () => {
    await createRecording("rec-actions", { shares: [[VIEWER, "viewer"]] });
    const root = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-actions",
        content: "Tighten the **intro**",
        videoTimestampMs: 12_542,
      }),
    );
    await expectStoresAgree("rec-actions");
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
      resolutionTarget: null,
      ownerEmail: OWNER,
      orgId: ORG,
      visibility: "private",
    });

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
    await expectStoresAgree("rec-actions");
    expect(await stored(reply.id)).toMatchObject({
      threadId: root.id,
      parentCommentId: root.id,
      anchor: { videoTimestampMs: 12_542 },
    });
    expect(await stored(nested.id)).toMatchObject({
      parentCommentId: reply.id,
      anchor: { videoTimestampMs: 13_000 },
    });

    await as(VIEWER, () =>
      reactToComment.run({ commentId: root.id, emoji: "👍" }),
    );
    await as(OWNER, () =>
      reactToComment.run({ commentId: root.id, emoji: "👍" }),
    );
    await as(OWNER, () =>
      reactToComment.run({ commentId: reply.id, emoji: "🔥" }),
    );
    await expectStoresAgree("rec-actions");
    await as(OWNER, () =>
      reactToComment.run({ commentId: reply.id, emoji: "🔥" }),
    );
    await expectStoresAgree("rec-actions");

    await as(OWNER, () =>
      updateComment.run({ id: root.id, content: "Tighten the intro, please" }),
    );
    await expectStoresAgree("rec-actions");
    expect((await stored(root.id))?.body).toBe("Tighten the intro, please");

    await as(VIEWER, () => resolveComment.run({ id: reply.id }));
    await as(OWNER, () => resolveComment.run({ id: root.id, resolved: true }));
    await expectStoresAgree("rec-actions");
    expect((await stored(root.id))?.status).toBe("resolved");
    await as(OWNER, () => resolveComment.run({ id: root.id, resolved: false }));
    await expectStoresAgree("rec-actions");
    expect((await stored(root.id))?.status).toBe("open");

    await as(OWNER, () => deleteComment.run({ id: nested.id }));
    expect(await expectStoresAgree("rec-actions")).toBe(2);
    expect(await stored(nested.id)).toMatchObject({
      status: "deleted",
      body: "",
      deletedBy: OWNER,
    });

    const removed = await as(OWNER, () => deleteComment.run({ id: root.id }));
    expect(removed.deletedCommentIds.sort()).toEqual(
      [reply.id, root.id].sort(),
    );
    expect(await expectStoresAgree("rec-actions")).toBe(0);
    expect((await stored(reply.id))?.status).toBe("deleted");
  });

  it("creates nothing in either store when an add repeats its idempotency key", async () => {
    await createRecording("rec-repeat");
    const args = {
      recordingId: "rec-repeat",
      content: "Saved once",
      videoTimestampMs: 4_000,
      idempotencyKey: "mirror-repeat-key-0001",
    };
    const first = await as(OWNER, () => addComment.run(args));
    const before = await kitRows("rec-repeat");
    const second = await as(OWNER, () => addComment.run(args));

    expect(second).toMatchObject({ id: first.id, repeated: true });
    expect(await expectStoresAgree("rec-repeat")).toBe(1);
    expect(await kitRows("rec-repeat")).toEqual(before);
  });

  it("moves the kit's anchors with a Rewind that shifts the video", async () => {
    await createRecording("rec-rewind");
    const comment = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-rewind",
        content: "Here",
        videoTimestampMs: 1_000,
      }),
    );
    const { getDb, schema } = dbModule;
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.recordingComments)
        .set({
          videoTimestampMs: sql`${schema.recordingComments.videoTimestampMs} + 5000`,
        })
        .where(eq(schema.recordingComments.recordingId, "rec-rewind"));
      await mirror.mirrorRecordingComments(tx, "rec-rewind", "all");
    });

    await expectStoresAgree("rec-rewind");
    expect((await stored(comment.id))?.anchor).toEqual({
      videoTimestampMs: 6_000,
    });
  });

  it("leaves both stores as they were when a recording is trashed", async () => {
    await createRecording("rec-trash", { shares: [[VIEWER, "viewer"]] });
    const comment = await as(VIEWER, () =>
      addComment.run({
        recordingId: "rec-trash",
        content: "Before the trash",
        videoTimestampMs: 0,
      }),
    );
    await as(OWNER, () => trashRecording.run({ id: "rec-trash" }));

    expect(await expectStoresAgree("rec-trash")).toBe(1);
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

    expect(await expectStoresAgree("rec-delete")).toBe(0);
    for (const id of [root.id, reply.id]) {
      expect(await stored(id)).toMatchObject({
        status: "deleted",
        body: "",
        deletedBy: OWNER,
      });
    }
  });

  it("rolls the kit's copy back with a comment write that fails", async () => {
    await createRecording("rec-rollback");
    const { getDb, schema } = dbModule;

    await expect(
      getDb().transaction(async (tx) => {
        await tx.insert(schema.recordingComments).values({
          id: "rolled-back",
          recordingId: "rec-rollback",
          organizationId: ORG,
          threadId: "rolled-back",
          content: "Never saved",
          authorEmail: OWNER,
        });
        await mirror.mirrorRecordingComments(tx, "rec-rollback", [
          "rolled-back",
        ]);
        expect(await stored("rolled-back")).not.toBeNull();
        throw new Error("The comment write failed");
      }),
    ).rejects.toThrow("The comment write failed");

    expect(await stored("rolled-back")).toBeNull();
  });

  it("copies comments written before the mirror, and a second copy changes nothing", async () => {
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
      ]);
    await getDb().insert(schema.recordingComments).values({
      id: "orphan",
      recordingId: "rec-gone",
      organizationId: ORG,
      threadId: "orphan",
      content: "Orphaned",
      authorEmail: OWNER,
    });

    const first = await mirror.copyRecordingCommentsToReviewKit();
    expect(first.failedRecordings).toEqual([]);
    expect(first.differences).toEqual([]);
    expect(first).toMatchObject({ repliesWithoutParent: 1 });
    expect(await expectStoresAgree("rec-legacy")).toBe(3);
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
    const { rows: reactions } = await getDbExec().execute(
      `SELECT comment_id, actor_email, reaction FROM agent_review_comment_reactions
        WHERE comment_id IN ('legacy-root', 'legacy-unlinked')
        ORDER BY comment_id, actor_email`,
    );
    expect(reactions).toEqual([
      { comment_id: "legacy-root", actor_email: MEMBER, reaction: "🎉" },
      { comment_id: "legacy-root", actor_email: OWNER, reaction: "🎉" },
    ]);
    expect(await stored("orphan")).toBeNull();

    const kitBefore = await kitRows("rec-legacy");
    const again = await mirror.copyRecordingCommentsToReviewKit();
    expect(again).toEqual(first);
    expect(await kitRows("rec-legacy")).toEqual(kitBefore);
  });

  it("clears comments Clips copied but no longer has, and keeps ones written through the kit", async () => {
    await createRecording("rec-kit-only");
    const comment = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-kit-only",
        content: "Gone from Clips",
        videoTimestampMs: 0,
      }),
    );
    const { getDb, schema } = dbModule;
    await getDb()
      .delete(schema.recordingComments)
      .where(eq(schema.recordingComments.recordingId, "rec-kit-only"));
    const at = "2026-11-20T12:00:00.000Z";
    await mirrorReviewComments(
      { resourceType: "recording", resourceId: "rec-deleted-elsewhere" },
      [
        {
          id: "kit-only-recording-root",
          threadId: "kit-only-recording-root",
          parentCommentId: null,
          body: "On a recording another server deleted",
          authorEmail: OWNER,
          authorName: null,
          createdBy: "human",
          resolved: false,
          createdAt: at,
          updatedAt: at,
        },
      ],
    );
    await mirrorReviewComments(
      { resourceType: "recording", resourceId: "rec-kit-only" },
      [
        {
          id: "kit-written-recording-root",
          threadId: "kit-written-recording-root",
          parentCommentId: null,
          body: "Written through the kit before Clips registered",
          authorEmail: OWNER,
          authorName: null,
          createdBy: "human",
          resolved: false,
          createdAt: at,
          updatedAt: at,
        },
      ],
    );

    const report = await mirror.copyRecordingCommentsToReviewKit();

    expect(report.failedRecordings).toEqual([]);
    expect(report.differences).toEqual([]);
    for (const id of [comment.id, "kit-only-recording-root"]) {
      expect(await stored(id)).toMatchObject({ status: "deleted", body: "" });
    }
    expect(await stored("kit-written-recording-root")).toMatchObject({
      status: "open",
      body: "Written through the kit before Clips registered",
    });
    expect(report.kitWrittenComments).toContainEqual({
      recordingId: "rec-kit-only",
      id: "kit-written-recording-root",
    });
  });

  it("deletes a reply written through the kit in a thread Clips deleted", async () => {
    await createRecording("rec-orphan");
    const add = (content: string) =>
      as(OWNER, () =>
        addComment.run({
          recordingId: "rec-orphan",
          content,
          videoTimestampMs: 0,
        }),
      );
    const gone = await add("Deleted by a server on the old code");
    const here = await add("Still in Clips");
    const at = "2026-11-20T12:00:00.000Z";
    const kitReply = (id: string, threadId: string) => ({
      id,
      threadId,
      parentCommentId: threadId,
      body: "A reply through the kit's own actions",
      authorEmail: OWNER,
      authorName: null,
      createdBy: "human" as const,
      resolved: false,
      createdAt: at,
      updatedAt: at,
    });
    await mirrorReviewComments(
      { resourceType: "recording", resourceId: "rec-orphan" },
      [
        kitReply("kit-recording-reply-gone", gone.id),
        kitReply("kit-recording-reply-here", here.id),
      ],
    );
    const { getDb, schema } = dbModule;
    await getDb()
      .delete(schema.recordingComments)
      .where(eq(schema.recordingComments.id, gone.id));

    const report = await mirror.copyRecordingCommentsToReviewKit();

    expect(report.failedRecordings).toEqual([]);
    expect(report.differences).toEqual([]);
    for (const id of [gone.id, "kit-recording-reply-gone"]) {
      expect(await stored(id)).toMatchObject({ status: "deleted", body: "" });
    }
    expect(report.orphanedReplies).toEqual([
      { recordingId: "rec-orphan", id: "kit-recording-reply-gone" },
    ]);
    expect(await stored("kit-recording-reply-here")).toMatchObject({
      status: "open",
    });
    expect(report.kitWrittenComments).toContainEqual({
      recordingId: "rec-orphan",
      id: "kit-recording-reply-here",
    });
  });

  it("refuses recording comment writes through the kit's own actions", async () => {
    await createRecording("rec-kit-write");
    const comment = await as(OWNER, () =>
      addComment.run({
        recordingId: "rec-kit-write",
        content: "Written in Clips",
        videoTimestampMs: 0,
      }),
    );
    const recording = {
      resourceType: "recording",
      resourceId: "rec-kit-write",
    };
    const ctx = { userEmail: OWNER, orgId: ORG, caller: "frontend" };
    const kitWrites: Array<[unknown, Record<string, unknown>]> = [
      [createReviewComment, { ...recording, body: "Written around Clips" }],
      [
        replyReviewComment,
        { ...recording, commentId: comment.id, body: "Reply around Clips" },
      ],
      [
        reactToReviewComment,
        { ...recording, commentId: comment.id, reaction: "👀", active: true },
      ],
      [resolveReviewThread, { ...recording, threadId: comment.threadId }],
      [
        updateReviewComment,
        { ...recording, commentId: comment.id, body: "Edited around Clips" },
      ],
      [deleteReviewComment, { ...recording, commentId: comment.id }],
    ];

    for (const [action, args] of kitWrites) {
      await expect(
        as(OWNER, () => (action as Runnable).run(args, ctx)),
      ).rejects.toThrow("add-comment");
    }
    await as(OWNER, () =>
      resolveComment.run({ id: comment.id, resolved: true }, ctx),
    );
    await expect(
      as(OWNER, () =>
        (resolveReviewThread as unknown as Runnable).run(
          {
            ...recording,
            threadId: comment.threadId,
            status: "resolved",
            resolutionNote: "Changed through the kit",
          },
          ctx,
        ),
      ),
    ).rejects.toThrow("add-comment");
    await expectStoresAgree("rec-kit-write");
  });
});

describe("Clips' comment access through the review kit", () => {
  beforeAll(() => {
    const { commentsWrittenByApp: _writtenByClips, ...openToTheKit } =
      review.recordingReviewResource;
    registerReviewableResource(openToTheKit);
  });
  afterAll(() => {
    registerReviewableResource(review.recordingReviewResource);
  });

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
