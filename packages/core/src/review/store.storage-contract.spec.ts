import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./notifications.js", () => ({
  notifyReviewComment: vi.fn(async () => ({ sent: 0 })),
  notifyReviewCommentWithReceipt: vi.fn(async () => ({ sent: 0 })),
}));

const { closeDbExec, getDbExec } = await import("../db/client.js");
const { ReviewAnchorError, ReviewCommentLinkConflictError } =
  await import("./errors.js");
const { __resetReviewableResourcesForTests, registerReviewableResource } =
  await import("./registry.js");
const {
  __resetReviewInitForTests,
  deleteReviewComment,
  ensureReviewTables,
  findReviewCommentLink,
  insertReviewComment,
  insertReviewCommentIdempotently,
  insertReviewReply,
  consumeReviewFeedback,
  routeReviewThread,
  linkReviewComment,
  listReviewCommentLinks,
  queryReviewCommentPage,
  queryReviewComments,
  resolveReviewThread,
  updateReviewComment,
} = await import("./store.js");
const createReviewComment = (await import("./actions/create-review-comment.js"))
  .default;
const listReviewComments = (await import("./actions/list-review-comments.js"))
  .default;
const updateReviewCommentAnchorAction = (
  await import("./actions/update-review-comment-anchor.js")
).default;
const updateReviewCommentAction = (
  await import("./actions/update-review-comment.js")
).default;
type ReviewCommentWriteEvent = import("./types.js").ReviewCommentWriteEvent;
type ReviewResourceRole = import("./types.js").ReviewResourceRole;

const OWNER = "owner@example.com";
const VIEWER = "viewer@example.com";
const ROLES: Record<string, ReviewResourceRole> = {
  [OWNER]: "owner",
  [VIEWER]: "viewer",
};
const resolveAccess = (_id: string, ctx?: { userEmail?: string | null }) => {
  const role = ctx?.userEmail ? ROLES[ctx.userEmail] : undefined;
  return role
    ? { role, ownerEmail: OWNER, visibility: "private" as const }
    : null;
};

const PINNED = "storage-contract-pinned";
const PLAIN = "storage-contract-plain";
const OPEN_TO_VIEWERS = "storage-contract-open";
const HOOKED = "storage-contract-hooked";

const hookEvents: ReviewCommentWriteEvent[] = [];
let previousDatabaseUrl: string | undefined;

function pin(anchor: unknown, version: number) {
  const value = anchor as { x?: unknown; y?: unknown } | null;
  if (typeof value?.x !== "number") throw new Error("a pin needs an x");
  // Version 1 pins had no y; reading one fills it in.
  return version === 1 ? { x: value.x, y: 0 } : { x: value.x, y: value.y };
}

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
  __resetReviewInitForTests();
  __resetReviewableResourcesForTests();
  registerReviewableResource({
    type: PINNED,
    resolveAccess,
    anchorKinds: { pin: { version: 2, parse: pin } },
  });
  registerReviewableResource({ type: PLAIN, resolveAccess });
  registerReviewableResource({
    type: OPEN_TO_VIEWERS,
    resolveAccess,
    comments: { minimumRole: "viewer", unmentionedRoute: "human" },
  });
  registerReviewableResource({
    type: HOOKED,
    resolveAccess,
    onCommentWrite: async (event, tx) => {
      await tx.execute({
        sql: "INSERT INTO storage_contract_hook_log (event) VALUES (?)",
        args: [event.type],
      });
      if ("comment" in event && event.comment.body === "refuse me") {
        throw new Error("The app refused this comment");
      }
      hookEvents.push(event);
    },
  });
  await ensureReviewTables();
  await getDbExec().execute(
    "CREATE TABLE storage_contract_hook_log (event TEXT NOT NULL)",
  );
});

afterAll(async () => {
  __resetReviewableResourcesForTests();
  __resetReviewInitForTests();
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

function comment(resourceType: string, resourceId: string, extra = {}) {
  return {
    resourceType,
    resourceId,
    body: "A comment",
    authorEmail: OWNER,
    ownerEmail: OWNER,
    ...extra,
  };
}

async function hookLog(): Promise<string[]> {
  const { rows } = await getDbExec().execute(
    "SELECT event FROM storage_contract_hook_log",
  );
  return rows.map((row) => String((row as { event: unknown }).event));
}

describe.sequential("the review kit's storage contract", () => {
  it("checks anchors against the resource's anchor kinds", async () => {
    const latest = await insertReviewComment(
      comment(PINNED, "deck-1", {
        anchor: { x: 4, y: 5 },
        anchorKind: "pin",
        surfaceId: "slide-2",
      }),
    );
    expect(latest).toMatchObject({
      anchor: { x: 4, y: 5 },
      anchorKind: "pin",
      anchorVersion: 2,
      surfaceId: "slide-2",
      revision: 1,
    });

    const older = await insertReviewComment(
      comment(PINNED, "deck-1", {
        anchor: { x: 7 },
        anchorKind: "pin",
        anchorVersion: 1,
      }),
    );
    expect(older).toMatchObject({
      anchor: { x: 7, y: 0 },
      anchorKind: "pin",
      anchorVersion: 1,
    });

    for (const refused of [
      { anchor: { x: 1 } },
      { anchor: { x: 1 }, anchorKind: "toString" },
      { anchor: { x: 1 }, anchorKind: "pin", anchorVersion: 3 },
      { anchor: { y: 1 }, anchorKind: "pin" },
      { anchorVersion: 1 },
    ]) {
      await expect(
        insertReviewComment(comment(PINNED, "deck-1", refused)),
      ).rejects.toBeInstanceOf(ReviewAnchorError);
    }
    const stored = await queryReviewComments({
      resourceType: PINNED,
      resourceId: "deck-1",
      scope: {},
      bypassScope: true,
    });
    expect(stored.map((row) => row.id).sort()).toEqual(
      [latest.id, older.id].sort(),
    );

    // A comment with no anchor needs no kind.
    await expect(
      insertReviewComment(comment(PINNED, "deck-1")),
    ).resolves.toMatchObject({ anchor: null, anchorKind: null });
  });

  it("keeps untyped anchors where a resource declares no kinds", async () => {
    await expect(
      insertReviewComment(
        comment(PLAIN, "doc-1", { anchor: { any: "shape" } }),
      ),
    ).resolves.toMatchObject({
      anchor: { any: "shape" },
      anchorKind: null,
      anchorVersion: null,
    });
    await expect(
      insertReviewComment(
        comment(PLAIN, "doc-1", { anchor: {}, anchorKind: "pin" }),
      ),
    ).rejects.toBeInstanceOf(ReviewAnchorError);
  });

  it("replays a retry the way its first submission was stored", async () => {
    const STAMPED = "storage-contract-stamped";
    const stampAt = (version: number) =>
      registerReviewableResource({
        type: STAMPED,
        resolveAccess,
        anchorKinds: { stamp: { version, parse: (anchor) => anchor } },
      });
    registerReviewableResource({ type: STAMPED, resolveAccess });
    const untyped = {
      ...comment(STAMPED, "doc-replay", { anchor: { at: 1 } }),
      id: "replay-untyped",
    };
    await insertReviewCommentIdempotently(untyped);
    stampAt(1);
    const typed = {
      ...comment(STAMPED, "doc-replay", {
        anchor: { at: 2 },
        anchorKind: "stamp",
      }),
      id: "replay-typed",
    };
    await insertReviewCommentIdempotently(typed);

    // The resource now declares kinds, and the kind has moved to version 2.
    stampAt(2);
    await expect(
      insertReviewCommentIdempotently(untyped),
    ).resolves.toMatchObject({
      replayed: true,
      comment: { anchorKind: null, anchorVersion: null },
    });
    await expect(insertReviewCommentIdempotently(typed)).resolves.toMatchObject(
      { replayed: true, comment: { anchorKind: "stamp", anchorVersion: 1 } },
    );
    await expect(
      insertReviewCommentIdempotently({ ...typed, body: "Another body" }),
    ).rejects.toThrow("conflicts with another submission");

    // Once the resource drops the kind, the retry is compared as sent.
    registerReviewableResource({
      type: STAMPED,
      resolveAccess,
      anchorKinds: { seal: { version: 1, parse: (anchor) => anchor } },
    });
    await expect(insertReviewCommentIdempotently(typed)).resolves.toMatchObject(
      { replayed: true, comment: { anchorKind: "stamp", anchorVersion: 1 } },
    );
    await expect(
      insertReviewCommentIdempotently({ ...typed, anchor: { at: 3 } }),
    ).rejects.toThrow("conflicts with another submission");
    await expect(
      insertReviewCommentIdempotently({ ...typed, id: "replay-new" }),
    ).rejects.toBeInstanceOf(ReviewAnchorError);
  });

  it("lets a reply carry an anchor written before its resource had kinds", async () => {
    // Stored the way a thread from before anchor kinds is.
    const root = await insertReviewComment(comment(PLAIN, "deck-legacy"));
    await getDbExec().execute({
      sql: `UPDATE agent_review_comments
               SET resource_type = ?, anchor_json = ?
             WHERE id = ?`,
      args: [PINNED, JSON.stringify({ legacy: true }), root.id],
    });
    const reply = await insertReviewReply(
      comment(PINNED, "deck-legacy", {
        threadId: root.threadId,
        parentCommentId: root.id,
        anchor: { legacy: true },
      }),
      null,
      { resourceType: PINNED, resourceId: "deck-legacy" },
    );
    expect(reply).toMatchObject({ anchor: { legacy: true }, anchorKind: null });
  });

  it("moves the revision on with each change and refuses a stale one", async () => {
    const created = await insertReviewComment(comment(PLAIN, "doc-rev"));
    expect(created.revision).toBe(1);

    const edited = await updateReviewComment(
      created.id,
      { body: "Edited" },
      undefined,
      { expectedRevision: 1 },
    );
    expect(edited?.revision).toBe(2);

    await expect(
      updateReviewComment(created.id, { body: "Lost" }, undefined, {
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "revision_conflict",
      statusCode: 409,
      currentRevision: 2,
    });

    await resolveReviewThread(created.threadId, OWNER);
    const [resolved] = await queryReviewComments({
      resourceType: PLAIN,
      resourceId: "doc-rev",
      scope: {},
      bypassScope: true,
      includeResolved: true,
    });
    expect(resolved).toMatchObject({ body: "Edited", revision: 3 });
  });

  it("leaves a thread already in that state alone", async () => {
    const root = await insertReviewComment(comment(PLAIN, "doc-again"));
    const read = async () =>
      (
        await queryReviewComments({
          resourceType: PLAIN,
          resourceId: "doc-again",
          scope: {},
          bypassScope: true,
          includeResolved: true,
        })
      )[0];
    await expect(resolveReviewThread(root.threadId, OWNER)).resolves.toBe(1);
    // Resolving it again still finds the thread but changes nothing.
    await expect(resolveReviewThread(root.threadId, VIEWER)).resolves.toBe(1);
    const resolved = await read();
    expect(resolved).toMatchObject({ revision: 2, resolvedBy: OWNER });

    // A new resolution note still rewrites the first comment, once, and
    // keeps who resolved it and when.
    await resolveReviewThread(root.threadId, VIEWER, undefined, "Done");
    expect(await read()).toMatchObject({
      revision: 3,
      resolutionNote: "Done",
      resolvedBy: OWNER,
      resolvedAt: resolved?.resolvedAt,
    });
    await resolveReviewThread(root.threadId, OWNER, undefined, "Done");
    expect(await read()).toMatchObject({ revision: 3 });

    const reopen = () =>
      resolveReviewThread(root.threadId, OWNER, undefined, undefined, "open");
    await expect(reopen()).resolves.toBe(1);
    await expect(reopen()).resolves.toBe(1);
    expect(await read()).toMatchObject({ status: "open", revision: 4 });
  });

  it("moves a revision only when routing or pickup changes", async () => {
    const root = await insertReviewComment(comment(PLAIN, "doc-route"));
    const resource = { resourceType: PLAIN, resourceId: "doc-route" };
    const read = async () =>
      (
        await queryReviewComments({
          resourceType: PLAIN,
          resourceId: "doc-route",
          scope: {},
          bypassScope: true,
        })
      )[0];
    const route = (target: "agent" | "human") =>
      routeReviewThread(root.threadId, target, resource);

    await expect(route("agent")).resolves.toBe(1);
    expect(await read()).toMatchObject({
      resolutionTarget: "agent",
      revision: 2,
    });
    // Routed where it already goes, it still counts as routed.
    await expect(route("agent")).resolves.toBe(1);
    expect(await read()).toMatchObject({ revision: 2 });

    const takenAt = "2026-01-01T00:00:00.000Z";
    await consumeReviewFeedback([root.id], takenAt, resource);
    // Taken again, it keeps when it was first taken.
    await consumeReviewFeedback(
      [root.id],
      "2026-02-01T00:00:00.000Z",
      resource,
    );
    expect(await read()).toMatchObject({ revision: 3, consumedAt: takenAt });
    // Sent back to the agent after it took the thread, it's queued again.
    await route("agent");
    expect(await read()).toMatchObject({ consumedAt: null, revision: 4 });

    await route("human");
    await route("human");
    expect(await read()).toMatchObject({
      resolutionTarget: "human",
      revision: 5,
    });
  });

  it("returns a moved anchor's new revision from the action", async () => {
    const created = await insertReviewComment(
      comment(PINNED, "deck-move", {
        anchor: { x: 1, y: 1 },
        anchorKind: "pin",
      }),
    );
    const moved = await updateReviewCommentAnchorAction.run(
      {
        resourceType: PINNED,
        resourceId: "deck-move",
        commentId: created.id,
        anchor: { x: 9 },
        anchorVersion: 1,
        expectedRevision: 1,
      },
      { userEmail: OWNER },
    );
    expect(moved).toMatchObject({
      anchor: { x: 9, y: 0 },
      anchorKind: "pin",
      anchorVersion: 1,
      revision: 2,
    });
  });

  it("runs the resource's hook inside each write", async () => {
    hookEvents.length = 0;
    const root = await insertReviewComment(
      comment(HOOKED, "doc-hook", { surfaceId: "page-1" }),
    );
    const reply = await insertReviewReply(
      comment(HOOKED, "doc-hook", {
        threadId: root.threadId,
        parentCommentId: root.id,
      }),
      null,
      { resourceType: HOOKED, resourceId: "doc-hook" },
    );
    await updateReviewComment(root.id, { body: "Edited" }, undefined, {
      actorEmail: OWNER,
    });
    await updateReviewComment(root.id, { anchor: { at: 3 } });
    // Repeating a resolve or reopen fires no second event.
    for (const status of ["resolved", "resolved", "open", "open"] as const) {
      await resolveReviewThread(
        root.threadId,
        OWNER,
        undefined,
        undefined,
        status,
      );
    }
    await deleteReviewComment(root.id, OWNER);

    expect(hookEvents.map((event) => event.type)).toEqual([
      "created",
      "created",
      "edited",
      "anchor-moved",
      "resolved",
      "reopened",
      "deleted",
    ]);
    expect(hookEvents[0]).toMatchObject({
      comment: { id: root.id, surfaceId: "page-1" },
    });
    expect(hookEvents[2]).toMatchObject({ actorEmail: OWNER });
    expect(hookEvents[3]).toMatchObject({ actorEmail: null });
    expect(hookEvents[6]).toMatchObject({
      threadId: root.threadId,
      commentIds: [root.id, reply.id],
      actorEmail: OWNER,
    });
    expect(await hookLog()).toEqual(hookEvents.map((event) => event.type));
  });

  it("tells the hook of an edit and a move made together", async () => {
    hookEvents.length = 0;
    const root = await insertReviewComment(comment(HOOKED, "doc-both"));
    await updateReviewComment(root.id, { body: "Edited", anchor: { at: 4 } });
    expect(hookEvents.map((event) => event.type)).toEqual([
      "created",
      "edited",
      "anchor-moved",
    ]);
  });

  it("rolls the write back when the hook refuses it", async () => {
    const before = await hookLog();
    await expect(
      insertReviewComment(
        comment(HOOKED, "doc-refused", { body: "refuse me" }),
      ),
    ).rejects.toThrow("The app refused this comment");
    expect(
      await queryReviewComments({
        resourceType: HOOKED,
        resourceId: "doc-refused",
        scope: {},
        bypassScope: true,
        includeDeleted: true,
      }),
    ).toEqual([]);
    // The hook's own write went with it.
    expect(await hookLog()).toEqual(before);

    const kept = await insertReviewComment(comment(HOOKED, "doc-refused"));
    await expect(
      updateReviewComment(kept.id, { body: "refuse me" }),
    ).rejects.toThrow("The app refused this comment");
    const [unchanged] = await queryReviewComments({
      resourceType: HOOKED,
      resourceId: "doc-refused",
      scope: {},
      bypassScope: true,
    });
    expect(unchanged).toMatchObject({ body: "A comment", revision: 1 });
  });

  it("clears a typed anchor without parsing it", async () => {
    const pinned = await insertReviewComment(
      comment(PINNED, "deck-clear", {
        anchor: { x: 1, y: 2 },
        anchorKind: "pin",
      }),
    );
    await expect(
      updateReviewComment(pinned.id, { anchor: null }),
    ).resolves.toMatchObject({
      anchor: null,
      anchorKind: null,
      anchorVersion: null,
      revision: 2,
    });
  });

  it("lists one surface's comments", async () => {
    for (const surfaceId of ["slide-1", "slide-2", null, "slide-1"]) {
      await insertReviewComment(comment(PLAIN, "deck-surfaces", { surfaceId }));
    }
    const list = (surfaceId?: string | null) =>
      queryReviewComments({
        resourceType: PLAIN,
        resourceId: "deck-surfaces",
        scope: {},
        bypassScope: true,
        surfaceId,
      }).then((rows) => rows.map((row) => String(row.surfaceId)).sort());
    expect(await list()).toEqual(["null", "slide-1", "slide-1", "slide-2"]);
    expect(await list("slide-1")).toEqual(["slide-1", "slide-1"]);
    expect(await list(null)).toEqual(["null"]);

    // The list's summary counts the same surface's threads.
    const summary = async (surfaceId?: string | null) =>
      (
        await listReviewComments.run(
          { resourceType: PLAIN, resourceId: "deck-surfaces", surfaceId },
          { userEmail: OWNER },
        )
      ).summary.openCount;
    expect(await summary()).toBe(4);
    expect(await summary("slide-1")).toBe(2);
    expect(await summary(null)).toBe(1);
  });

  it("pages past the largest limit without skipping or repeating", async () => {
    // Written in order, so listed in order: each comment is stamped after
    // the one before, even within a millisecond.
    const ids: string[] = [];
    for (let index = 0; index < 503; index += 1) {
      ids.push((await insertReviewComment(comment(PLAIN, "doc-many"))).id);
    }
    const query = {
      resourceType: PLAIN,
      resourceId: "doc-many",
      scope: {},
      bypassScope: true,
    };
    const first = await queryReviewCommentPage({ ...query, limit: 500 });
    expect(first.comments).toHaveLength(500);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await queryReviewCommentPage({
      ...query,
      limit: 500,
      cursor: first.nextCursor,
    });
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.comments, ...second.comments].map((row) => row.id),
    ).toEqual(ids);

    // A cursor resumes the list it came from at any page size, and no other.
    const resumed = await queryReviewCommentPage({
      ...query,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(resumed.comments.map((row) => row.id)).toEqual([ids[500]]);
    for (const other of [
      { surfaceId: null },
      { targetId: null },
      { includeResolved: true },
      { resourceId: "doc-other" },
      { bypassScope: false, scope: { userEmail: OWNER } },
    ]) {
      await expect(
        queryReviewCommentPage({
          ...query,
          ...other,
          cursor: first.nextCursor,
        }),
      ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
    }
    await expect(
      queryReviewCommentPage({ ...query, cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
    await expect(
      queryReviewCommentPage({ ...query, newestFirst: true }),
    ).rejects.toMatchObject({ errorCode: "invalid_cursor" });

    const listed = await listReviewComments.run(
      { resourceType: PLAIN, resourceId: "doc-many", limit: 2 },
      { userEmail: OWNER },
    );
    expect(listed.comments.map((row) => row.id)).toEqual(ids.slice(0, 2));
    const next = await listReviewComments.run(
      {
        resourceType: PLAIN,
        resourceId: "doc-many",
        limit: 2,
        cursor: listed.nextCursor!,
      },
      { userEmail: OWNER },
    );
    expect(next.comments.map((row) => row.id)).toEqual(ids.slice(2, 4));
    const newest = await listReviewComments.run(
      {
        resourceType: PLAIN,
        resourceId: "doc-many",
        newestFirst: true,
        limit: 2,
      },
      { userEmail: OWNER },
    );
    expect(newest.comments).toHaveLength(2);
    expect(newest.nextCursor).toBeUndefined();
    await expect(
      listReviewComments.run(
        {
          resourceType: PLAIN,
          resourceId: "doc-many",
          newestFirst: true,
          cursor: listed.nextCursor!,
        },
        { userEmail: OWNER },
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
  });

  it("links comments to outside IDs, once each", async () => {
    const first = await insertReviewComment(comment(PLAIN, "doc-links"));
    const second = await insertReviewComment(comment(PLAIN, "doc-links"));
    const ref = {
      provider: "notion",
      externalKind: "discussion",
      externalId: "d-1",
    };
    const link = await linkReviewComment({ ...ref, commentId: first.id });
    expect(link).toMatchObject({
      ...ref,
      commentId: first.id,
      resourceType: PLAIN,
      resourceId: "doc-links",
    });
    // Linking again changes nothing.
    await expect(
      linkReviewComment({ ...ref, commentId: first.id }),
    ).resolves.toEqual(link);
    await expect(
      linkReviewComment({ ...ref, commentId: second.id }),
    ).rejects.toBeInstanceOf(ReviewCommentLinkConflictError);

    await linkReviewComment({
      provider: "notion",
      externalKind: "comment",
      externalId: "c-1",
      commentId: first.id,
    });
    expect(
      (await listReviewCommentLinks([first.id, second.id], "notion")).map(
        (row) => row.externalId,
      ),
    ).toEqual(["c-1", "d-1"]);

    // A deleted comment keeps its links, so an import doesn't bring it back.
    await deleteReviewComment(first.id, OWNER);
    await expect(findReviewCommentLink(ref)).resolves.toMatchObject({
      commentId: first.id,
    });
  });

  it("follows each resource's comment policy", async () => {
    // By default a viewer may read but not comment.
    await expect(
      createReviewComment.run(
        { resourceType: PLAIN, resourceId: "doc-policy", body: "Hello" },
        { userEmail: VIEWER },
      ),
    ).rejects.toThrow("Not allowed to comment");
    const ownComment = await createReviewComment.run(
      { resourceType: PLAIN, resourceId: "doc-policy", body: "Hello" },
      { userEmail: OWNER },
    );
    expect(ownComment.resolutionTarget).toBe("agent");

    const viewerComment = await createReviewComment.run(
      {
        resourceType: OPEN_TO_VIEWERS,
        resourceId: "doc-policy",
        body: "Hello",
        surfaceId: "page-1",
      },
      { userEmail: VIEWER },
    );
    expect(viewerComment).toMatchObject({
      resolutionTarget: "human",
      surfaceId: "page-1",
    });

    const viewerList = await listReviewComments.run(
      { resourceType: OPEN_TO_VIEWERS, resourceId: "doc-policy" },
      { userEmail: VIEWER },
    );
    expect(viewerList.discussion.canReact).toBe(true);
    expect(viewerList.comments[0]?.canDelete).toBe(true);

    const plainViewerList = await listReviewComments.run(
      { resourceType: PLAIN, resourceId: "doc-policy" },
      { userEmail: VIEWER },
    );
    expect(plainViewerList.discussion.canReact).toBe(false);
  });
});

describe("suggestion threads", () => {
  it("store on a resource that declares its own anchor kinds", async () => {
    const { REVIEW_SUGGESTION_ANCHOR_KIND } = await import("./registry.js");
    await expect(
      insertReviewComment({
        ...comment(PINNED, "doc-suggested", {
          anchor: [null, { x: 0.2, y: 0.4 }],
          anchorKind: REVIEW_SUGGESTION_ANCHOR_KIND,
        }),
        kind: "correction",
      }),
    ).resolves.toMatchObject({
      anchor: [null, { x: 0.2, y: 0.4 }],
      anchorKind: "review-suggestion",
      anchorVersion: 1,
    });
  });

  it("can't be written or kept through a person's comment actions", async () => {
    const at = { resourceType: PINNED, resourceId: "doc-kit-kind" };
    const refused = 'Only the review kit writes "review-suggestion" anchors.';
    await expect(
      createReviewComment.run(
        {
          ...at,
          body: "Hello",
          anchor: { anything: true },
          anchorKind: "review-suggestion",
        },
        { userEmail: OWNER },
      ),
    ).rejects.toThrow(refused);

    const suggested = await insertReviewComment({
      ...comment(PINNED, "doc-kit-kind", {
        anchor: [null],
        anchorKind: "review-suggestion",
      }),
      kind: "correction",
    });
    const move = { ...at, commentId: suggested.id };
    await expect(
      updateReviewCommentAnchorAction.run(
        { ...move, anchor: { anything: true } },
        { userEmail: OWNER },
      ),
    ).rejects.toThrow(refused);
    await expect(
      updateReviewCommentAction.run(
        { ...move, anchor: { anything: true } },
        { userEmail: OWNER },
      ),
    ).rejects.toThrow(refused);
    // Moved onto one of the resource's own kinds, it's read by that kind.
    await expect(
      updateReviewCommentAnchorAction.run(
        { ...move, anchor: { x: 1, y: 2 }, anchorKind: "pin" },
        { userEmail: OWNER },
      ),
    ).resolves.toMatchObject({ anchorKind: "pin", revision: 2 });
  });
});

describe("the kit's entry point", () => {
  it("exports the storage contract", async () => {
    const kit = await import("./index.js");
    expect(kit).toMatchObject({
      assertReviewCommentAccess: expect.any(Function),
      canCommentOnReviewableResource: expect.any(Function),
      findReviewCommentLink: expect.any(Function),
      linkReviewComment: expect.any(Function),
      listReviewCommentLinks: expect.any(Function),
      normalizeReviewAnchor: expect.any(Function),
      queryReviewCommentPage: expect.any(Function),
      reviewCommentPolicy: expect.any(Function),
      ReviewAnchorError,
      ReviewCommentLinkConflictError,
      ReviewCommentRevisionConflictError: expect.any(Function),
      ReviewCursorError: expect.any(Function),
    });
  });
});
