import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { closeDbExec, getDbExec, withDbExec } = await import("../db/client.js");
const { ReviewCommentResourceConflictError } = await import("./errors.js");
const {
  compareMirroredReviewComments,
  deleteMirroredReviewComments,
  deleteOrphanedMirroredReplies,
  linkMirroredReviewReplies,
  listMirroredResourceIds,
  mirrorReviewComments,
  moveMirroredReviewAnchors,
} = await import("./mirror.js");
const {
  __resetReviewInitForTests,
  ensureReviewTables,
  getReviewCommentById,
  listReviewCommentReactors,
} = await import("./store.js");
type ReviewCommentCopy = import("./mirror.js").ReviewCommentCopy;
type DbExec = import("../db/client.js").DbExec;

const DECK = {
  resourceType: "mirror-deck",
  resourceId: "deck-1",
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  visibility: "org" as const,
};

let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
  __resetReviewInitForTests();
  await ensureReviewTables();
});

afterAll(async () => {
  __resetReviewInitForTests();
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

const stored = (id: string) =>
  getReviewCommentById(id, {}, { bypassScope: true });

async function reactionsOn(id: string) {
  const { rows } = await getDbExec().execute({
    sql: "SELECT actor_email, reaction FROM agent_review_comment_reactions WHERE comment_id = ? ORDER BY actor_email, reaction",
    args: [id],
  });
  return rows;
}

let nextId = 0;
function copy(extra: Partial<ReviewCommentCopy> = {}): ReviewCommentCopy {
  const id = extra.id ?? `mirror-${++nextId}`;
  return {
    id,
    threadId: id,
    parentCommentId: null,
    surfaceId: "slide-1",
    anchor: { x: 10, y: 20 },
    anchorKind: "slide-point",
    anchorVersion: 1,
    body: "Tighten this headline",
    authorEmail: "tiana@example.com",
    authorName: "Tiana",
    createdBy: "human",
    resolved: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    metadata: { quotedText: "Q3 plan" },
    reactions: [{ actorEmail: "sam@example.com", reaction: "👍" }],
    ...extra,
  };
}

describe("mirrorReviewComments", () => {
  it("writes the app's comments into the kit as they are", async () => {
    const root = copy();
    const reply = copy({
      threadId: root.id,
      parentCommentId: root.id,
      anchor: null,
      anchorKind: null,
      anchorVersion: null,
      body: "Done",
      createdBy: "agent",
      createdAt: "2026-11-01T10:05:00.000Z",
      updatedAt: "2026-11-01T10:05:00.000Z",
      metadata: null,
      reactions: [],
    });

    expect(await mirrorReviewComments(DECK, [root, reply])).toEqual({
      written: 2,
    });

    expect(await stored(root.id)).toMatchObject({
      resourceType: DECK.resourceType,
      resourceId: DECK.resourceId,
      threadId: root.id,
      surfaceId: "slide-1",
      anchor: { x: 10, y: 20 },
      anchorKind: "slide-point",
      anchorVersion: 1,
      body: "Tighten this headline",
      createdBy: "human",
      status: "open",
      ownerEmail: DECK.ownerEmail,
      orgId: DECK.orgId,
      visibility: "org",
      revision: 1,
      createdAt: root.createdAt,
      metadata: { quotedText: "Q3 plan" },
    });
    expect(await stored(reply.id)).toMatchObject({
      parentCommentId: root.id,
      createdBy: "agent",
      anchor: null,
    });
    expect(await compareMirroredReviewComments(DECK, [root, reply])).toEqual({
      checked: 2,
      differences: [],
    });
  });

  it("marks the comment's email as sent, so the kit never sends it", async () => {
    const comment = copy();
    await mirrorReviewComments(DECK, [comment]);
    const { rows } = await getDbExec().execute({
      sql: "SELECT notification_completed_at, resolution_target FROM agent_review_comments WHERE id = ?",
      args: [comment.id],
    });
    expect(rows[0]).toEqual({
      notification_completed_at: comment.createdAt,
      resolution_target: null,
    });
  });

  it("changes only what changed, and counts a revision for it", async () => {
    const deck = { ...DECK, resourceId: "deck-revision" };
    const comment = copy();
    await mirrorReviewComments(deck, [comment]);

    expect(await mirrorReviewComments(deck, [comment])).toEqual({
      written: 0,
    });
    expect((await stored(comment.id))?.revision).toBe(1);

    const edited = {
      ...comment,
      body: "Tighten this headline, please",
      resolved: true,
      updatedAt: "2026-11-02T09:00:00.000Z",
      reactions: [
        { actorEmail: "sam@example.com", reaction: "🎉" },
        { actorEmail: "agent:tiana@example.com", reaction: "👍" },
      ],
    };
    expect(await mirrorReviewComments(deck, [edited])).toEqual({ written: 1 });
    expect(await stored(comment.id)).toMatchObject({
      body: "Tighten this headline, please",
      status: "resolved",
      resolvedAt: "2026-11-02T09:00:00.000Z",
      revision: 2,
    });
    expect(await compareMirroredReviewComments(deck, [edited])).toEqual({
      checked: 1,
      differences: [],
    });
  });

  it("writes the kind, routing and pickup an app keeps, and leaves the kit's when it doesn't say", async () => {
    const deck = { ...DECK, resourceId: "deck-app-kept" };
    const question = copy({
      kind: "question",
      resolutionTarget: "human",
      consumedAt: null,
    });
    const plain = copy();
    await mirrorReviewComments(deck, [question, plain]);
    expect(await stored(question.id)).toMatchObject({
      kind: "question",
      resolutionTarget: "human",
      consumedAt: null,
    });
    expect(await stored(plain.id)).toMatchObject({
      kind: "comment",
      resolutionTarget: null,
      consumedAt: null,
    });

    const taken = {
      ...question,
      resolutionTarget: "agent" as const,
      consumedAt: "2026-11-02T09:00:00.000Z",
    };
    expect(await mirrorReviewComments(deck, [taken])).toEqual({ written: 1 });
    expect(await stored(question.id)).toMatchObject({
      kind: "question",
      resolutionTarget: "agent",
      consumedAt: "2026-11-02T09:00:00.000Z",
      revision: 2,
    });
    expect(await mirrorReviewComments(deck, [taken])).toEqual({ written: 0 });

    await getDbExec().execute({
      sql: "UPDATE agent_review_comments SET resolution_target = 'agent' WHERE id = ?",
      args: [plain.id],
    });
    expect(
      await mirrorReviewComments(deck, [{ ...plain, body: "Reworded" }]),
    ).toEqual({ written: 1 });
    expect(await stored(plain.id)).toMatchObject({
      body: "Reworded",
      resolutionTarget: "agent",
    });
  });

  it("brings back a comment the kit deleted when the app still has it", async () => {
    const comment = copy();
    await mirrorReviewComments(DECK, [comment]);
    await deleteMirroredReviewComments(DECK, [comment.id], "tiana@example.com");

    await mirrorReviewComments(DECK, [comment]);

    expect(await stored(comment.id)).toMatchObject({
      body: comment.body,
      deletedAt: null,
      status: "open",
    });
  });

  it("only adds what the kit lacks when asked, leaving the rest as the kit has it", async () => {
    const deck = { ...DECK, resourceId: "deck-only-missing" };
    const kept = copy();
    const deleted = copy();
    await mirrorReviewComments(deck, [kept, deleted]);
    await deleteMirroredReviewComments(deck, [deleted.id], "tiana@example.com");
    const added = copy();

    const result = await mirrorReviewComments(
      deck,
      [{ ...kept, body: "An older wording", reactions: [] }, deleted, added],
      { onlyMissing: true },
    );

    expect(result).toEqual({ written: 1 });
    expect(await stored(kept.id)).toMatchObject({
      body: kept.body,
      revision: 1,
    });
    expect(await reactionsOn(kept.id)).toEqual([
      { actor_email: "sam@example.com", reaction: "👍" },
    ]);
    expect(await stored(deleted.id)).toMatchObject({ status: "deleted" });
    expect(await stored(added.id)).toMatchObject({ body: added.body });
    expect(await reactionsOn(added.id)).toEqual([
      { actor_email: "sam@example.com", reaction: "👍" },
    ]);
  });

  it("refuses an ID the kit holds on another resource and writes nothing", async () => {
    const comment = copy();
    await mirrorReviewComments(DECK, [comment]);
    const other = { ...DECK, resourceId: "deck-2" };
    const fresh = copy();

    await expect(
      mirrorReviewComments(other, [
        fresh,
        {
          ...comment,
          body: "Taken",
          reactions: [{ actorEmail: "eve@example.com", reaction: "👀" }],
        },
      ]),
    ).rejects.toBeInstanceOf(ReviewCommentResourceConflictError);

    expect(await stored(fresh.id)).toBeNull();
    expect((await stored(comment.id))?.body).toBe(comment.body);
    expect(await reactionsOn(comment.id)).toEqual([
      { actor_email: "sam@example.com", reaction: "👍" },
    ]);
  });

  it("keeps when a comment was resolved while it stays resolved", async () => {
    const comment = copy({
      resolved: true,
      updatedAt: "2026-11-02T09:00:00.000Z",
    });
    await mirrorReviewComments(DECK, [comment]);

    // An edit after resolving moves the update time, not the resolution.
    const edited = {
      ...comment,
      body: "Edited after resolving",
      updatedAt: "2026-11-03T09:00:00.000Z",
    };
    await mirrorReviewComments(DECK, [edited]);
    expect(await stored(comment.id)).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-11-02T09:00:00.000Z",
      revision: 2,
    });
    expect(await mirrorReviewComments(DECK, [edited])).toEqual({ written: 0 });

    const reopened = {
      ...edited,
      resolved: false,
      updatedAt: "2026-11-04T09:00:00.000Z",
    };
    await mirrorReviewComments(DECK, [reopened]);
    expect((await stored(comment.id))?.resolvedAt).toBeNull();
    await mirrorReviewComments(DECK, [
      { ...reopened, resolved: true, updatedAt: "2026-11-05T09:00:00.000Z" },
    ]);
    expect((await stored(comment.id))?.resolvedAt).toBe(
      "2026-11-05T09:00:00.000Z",
    );
  });

  it("joins the app's transaction and rolls back with it", async () => {
    const comment = copy();
    await expect(
      getDbExec().transaction?.((tx) =>
        withDbExec(tx, async () => {
          await mirrorReviewComments(DECK, [comment]);
          expect(await stored(comment.id)).not.toBeNull();
          throw new Error("The app's own write failed");
        }),
      ),
    ).rejects.toThrow("The app's own write failed");

    expect(await stored(comment.id)).toBeNull();
  });

  it("joins a PGlite transaction whose handle the caller didn't scope", async () => {
    const comment = copy();
    await expect(
      getDbExec().transaction?.(async () => {
        await mirrorReviewComments(DECK, [comment]);
        throw new Error("The app's own write failed");
      }),
    ).rejects.toThrow("The app's own write failed");

    expect(await stored(comment.id)).toBeNull();
  });

  it("opens its own transaction under a handle scoped outside one", async () => {
    const comment = copy();
    const base = getDbExec();
    let transactions = 0;
    // raw-sql-ok: passes the mirror's own statements through unchanged.
    const plain: DbExec = {
      execute: (statement) => base.execute(statement),
      transaction: (run) => {
        transactions += 1;
        return base.transaction!(run);
      },
    };

    await withDbExec(plain, () => mirrorReviewComments(DECK, [comment]));

    expect(transactions).toBe(1);
    expect(await stored(comment.id)).not.toBeNull();
  });
});

describe("linkMirroredReviewReplies", () => {
  it("gives a reply saved with no parent its parent in the same thread, once", async () => {
    const root = copy({ id: "link-root" });
    const reply = copy({ id: "link-reply", threadId: root.id });
    const linked = copy({
      id: "link-linked",
      threadId: root.id,
      parentCommentId: root.id,
    });
    const elsewhere = copy({ id: "link-elsewhere" });
    await mirrorReviewComments(DECK, [root, reply, linked, elsewhere]);
    const before = await stored(reply.id);

    expect(
      await linkMirroredReviewReplies(DECK, [
        { id: reply.id, parentCommentId: root.id },
        { id: linked.id, parentCommentId: reply.id },
        { id: root.id, parentCommentId: root.id },
        { id: elsewhere.id, parentCommentId: root.id },
        { id: "link-missing", parentCommentId: "nowhere" },
      ]),
    ).toEqual({ linked: 1 });
    expect(
      await linkMirroredReviewReplies({ ...DECK, resourceId: "deck-other" }, [
        { id: root.id, parentCommentId: reply.id },
      ]),
    ).toEqual({ linked: 0 });

    const after = await stored(reply.id);
    expect(after?.parentCommentId).toBe(root.id);
    expect(after?.revision).toBe((before?.revision ?? 0) + 1);
    expect((await stored(linked.id))?.parentCommentId).toBe(root.id);
    expect((await stored(root.id))?.parentCommentId).toBeNull();
    expect((await stored(elsewhere.id))?.parentCommentId).toBeNull();
    expect(
      await linkMirroredReviewReplies(DECK, [
        { id: reply.id, parentCommentId: root.id },
      ]),
    ).toEqual({ linked: 0 });
    expect(await linkMirroredReviewReplies(DECK, [])).toEqual({ linked: 0 });
  });
});

describe("moveMirroredReviewAnchors", () => {
  it("moves each live comment on the resource to its new anchor", async () => {
    const moving = copy({ anchor: { x: 1, y: 1 } });
    const deleted = copy({ anchor: { x: 2, y: 2 } });
    const elsewhere = copy({ anchor: { x: 3, y: 3 } });
    await mirrorReviewComments(DECK, [moving, deleted]);
    await mirrorReviewComments({ ...DECK, resourceId: "deck-moved" }, [
      elsewhere,
    ]);
    await deleteMirroredReviewComments(DECK, [deleted.id]);
    const before = await stored(moving.id);
    const deletedBefore = await stored(deleted.id);

    expect(
      await moveMirroredReviewAnchors(DECK, [
        { id: moving.id, anchor: { x: 11, y: 21 } },
        { id: deleted.id, anchor: { x: 12, y: 22 } },
        { id: elsewhere.id, anchor: { x: 13, y: 23 } },
      ]),
    ).toEqual({ moved: 1 });

    expect(await stored(moving.id)).toMatchObject({
      anchor: { x: 11, y: 21 },
      anchorKind: "slide-point",
      anchorVersion: 1,
      revision: (before?.revision ?? 0) + 1,
    });
    expect(await stored(deleted.id)).toEqual(deletedBefore);
    expect((await stored(elsewhere.id))?.anchor).toEqual({ x: 3, y: 3 });
    expect(await moveMirroredReviewAnchors(DECK, [])).toEqual({ moved: 0 });
  });

  it("moves more comments than one statement takes", async () => {
    const deck = { ...DECK, resourceId: "deck-many-moved" };
    const many = Array.from({ length: 101 }, (_, x) =>
      copy({ anchor: { x, y: 0 } }),
    );
    await mirrorReviewComments(deck, many);

    expect(
      await moveMirroredReviewAnchors(
        deck,
        many.map((comment, x) => ({ id: comment.id, anchor: { x, y: 1 } })),
      ),
    ).toEqual({ moved: 101 });
    const anchors = await Promise.all(
      many.map(async (comment) => (await stored(comment.id))?.anchor),
    );
    expect(anchors).toEqual(many.map((_, x) => ({ x, y: 1 })));
  });
});

describe("listReviewCommentReactors", () => {
  it("names who reacted with what on each comment, and gives the rest none", async () => {
    const reacted = copy({
      reactions: [
        { actorEmail: "sam@example.com", reaction: "👍" },
        { actorEmail: "ana@example.com", reaction: "👍" },
        { actorEmail: "sam@example.com", reaction: "🎉" },
      ],
    });
    const quiet = copy({ reactions: [] });
    await mirrorReviewComments(DECK, [reacted, quiet]);

    const reactors = await listReviewCommentReactors([
      reacted.id,
      quiet.id,
      "never-written",
    ]);

    expect(Object.keys(reactors).sort()).toEqual(
      [reacted.id, quiet.id, "never-written"].sort(),
    );
    expect(reactors[reacted.id]?.["👍"]?.sort()).toEqual([
      "ana@example.com",
      "sam@example.com",
    ]);
    expect(reactors[reacted.id]?.["🎉"]).toEqual(["sam@example.com"]);
    expect(reactors[quiet.id]).toEqual({});
    expect(reactors["never-written"]).toEqual({});
    expect(await listReviewCommentReactors([])).toEqual({});
  });
});

describe("listMirroredResourceIds", () => {
  it("pages through the resources with comments the kit hasn't deleted", async () => {
    const resource = (resourceId: string) => ({
      ...DECK,
      resourceType: "mirror-list",
      resourceId,
    });
    await mirrorReviewComments(resource("list-a"), [copy()]);
    await mirrorReviewComments(resource("list-b"), [copy(), copy()]);
    await mirrorReviewComments(resource("list-c"), [copy()]);
    await deleteMirroredReviewComments(resource("list-b"), "all");

    expect(await listMirroredResourceIds("mirror-list", { limit: 10 })).toEqual(
      ["list-a", "list-c"],
    );
    expect(
      await listMirroredResourceIds("mirror-list", {
        after: "list-a",
        limit: 1,
      }),
    ).toEqual(["list-c"]);
  });
});

describe("deleteMirroredReviewComments", () => {
  it("clears what a deleted comment said", async () => {
    const comment = copy();
    await mirrorReviewComments(DECK, [comment]);

    expect(
      await deleteMirroredReviewComments(DECK, [comment.id], "sam@example.com"),
    ).toEqual({ deleted: 1 });
    expect(await stored(comment.id)).toMatchObject({
      status: "deleted",
      body: "",
      anchor: null,
      metadata: null,
      deletedBy: "sam@example.com",
      revision: 2,
    });
    expect(
      await deleteMirroredReviewComments(DECK, [comment.id], "sam@example.com"),
    ).toEqual({ deleted: 0 });
  });

  it("deletes every comment on a resource that went", async () => {
    const gone = { ...DECK, resourceId: "deck-gone" };
    const kept = { ...DECK, resourceId: "deck-kept" };
    const first = copy();
    const second = copy();
    const elsewhere = copy();
    await mirrorReviewComments(gone, [first, second]);
    await mirrorReviewComments(kept, [elsewhere]);

    expect(await deleteMirroredReviewComments(gone, "all")).toEqual({
      deleted: 2,
    });
    expect((await stored(second.id))?.status).toBe("deleted");
    expect((await stored(elsewhere.id))?.status).toBe("open");
  });
});

describe("deleteOrphanedMirroredReplies", () => {
  it("deletes the replies in threads whose first comment went", async () => {
    const gone = copy({ id: "orphan-gone" });
    const underGone = copy({
      id: "orphan-under-gone",
      threadId: gone.id,
      parentCommentId: gone.id,
    });
    const deepUnderGone = copy({
      id: "orphan-deep-under-gone",
      threadId: gone.id,
      parentCommentId: underGone.id,
    });
    const live = copy({ id: "orphan-live" });
    const reply = copy({
      id: "orphan-reply",
      threadId: live.id,
      parentCommentId: live.id,
    });
    const underReply = copy({
      id: "orphan-under-reply",
      threadId: live.id,
      parentCommentId: reply.id,
    });
    const kept = copy({
      id: "orphan-kept",
      threadId: live.id,
      parentCommentId: live.id,
    });
    await mirrorReviewComments(DECK, [
      gone,
      underGone,
      deepUnderGone,
      live,
      reply,
      underReply,
      kept,
    ]);
    await deleteMirroredReviewComments(DECK, [gone.id, reply.id]);
    const candidates = [
      underGone.id,
      deepUnderGone.id,
      underReply.id,
      kept.id,
      live.id,
    ];

    expect(
      await deleteOrphanedMirroredReplies(
        { ...DECK, resourceId: "deck-other" },
        candidates,
      ),
    ).toEqual({ deleted: [] });
    const { deleted } = await deleteOrphanedMirroredReplies(DECK, [
      ...candidates,
      "orphan-missing",
    ]);
    expect([...deleted].sort()).toEqual(
      [underGone.id, deepUnderGone.id].sort(),
    );
    expect((await stored(underGone.id))?.status).toBe("deleted");
    expect((await stored(deepUnderGone.id))?.status).toBe("deleted");
    expect((await stored(underReply.id))?.status).toBe("open");
    expect((await stored(kept.id))?.status).toBe("open");
    expect((await stored(live.id))?.status).toBe("open");
    expect(await deleteOrphanedMirroredReplies(DECK, candidates)).toEqual({
      deleted: [],
    });
    expect(await deleteOrphanedMirroredReplies(DECK, [])).toEqual({
      deleted: [],
    });
  });
});

describe("compareMirroredReviewComments", () => {
  it("names what's missing, extra or different", async () => {
    const deck = { ...DECK, resourceId: "deck-compare" };
    const same = copy();
    const changed = copy();
    const notCopied = copy();
    const kitOnly = copy();
    const deletedInKit = copy();
    await mirrorReviewComments(deck, [same, changed, kitOnly, deletedInKit]);
    await deleteMirroredReviewComments(deck, [deletedInKit.id]);

    const result = await compareMirroredReviewComments(deck, [
      same,
      {
        ...changed,
        body: "Something else",
        anchor: { x: 11, y: 20 },
        reactions: [],
      },
      notCopied,
      deletedInKit,
    ]);

    expect(result.checked).toBe(4);
    expect(result.differences).toEqual(
      expect.arrayContaining([
        {
          id: changed.id,
          problem: "different",
          fields: ["anchor", "body", "reactions"],
        },
        { id: notCopied.id, problem: "missing" },
        { id: deletedInKit.id, problem: "missing" },
        { id: kitOnly.id, problem: "extra" },
      ]),
    );
    expect(result.differences).toHaveLength(4);
  });

  it("notices a resource whose sharing changed since the copy", async () => {
    const deck = { ...DECK, resourceId: "deck-sharing" };
    const comment = copy();
    await mirrorReviewComments(deck, [comment]);
    const reshared = { ...deck, visibility: "private" as const };

    expect(
      (await compareMirroredReviewComments(reshared, [comment])).differences,
    ).toEqual([
      { id: comment.id, problem: "different", fields: ["visibility"] },
    ]);

    await mirrorReviewComments(reshared, [comment]);
    expect(
      (await compareMirroredReviewComments(reshared, [comment])).differences,
    ).toEqual([]);
  });

  it("checks who resolved a comment and when only where the app says", async () => {
    const deck = { ...DECK, resourceId: "deck-resolution" };
    const comment = copy({
      resolved: true,
      resolvedBy: "sam@example.com",
      resolvedAt: "2026-11-02T09:00:00.000Z",
    });
    await mirrorReviewComments(deck, [comment]);

    expect(
      await compareMirroredReviewComments(deck, [
        { ...comment, resolvedAt: "2026-11-03T09:00:00.000Z" },
      ]),
    ).toMatchObject({
      differences: [
        { id: comment.id, problem: "different", fields: ["resolvedAt"] },
      ],
    });
    const unstated = {
      ...comment,
      resolvedBy: undefined,
      resolvedAt: undefined,
    };
    expect(await compareMirroredReviewComments(deck, [unstated])).toEqual({
      checked: 1,
      differences: [],
    });
  });

  it("checks the kind, routing and pickup only where the app says", async () => {
    const deck = { ...DECK, resourceId: "deck-app-kept-compare" };
    const comment = copy({
      kind: "correction",
      resolutionTarget: "agent",
      consumedAt: "2026-11-02T09:00:00.000Z",
    });
    await mirrorReviewComments(deck, [comment]);

    expect(
      await compareMirroredReviewComments(deck, [
        {
          ...comment,
          kind: "question",
          resolutionTarget: "human",
          consumedAt: null,
        },
      ]),
    ).toMatchObject({
      differences: [
        {
          id: comment.id,
          problem: "different",
          fields: ["kind", "resolutionTarget", "consumedAt"],
        },
      ],
    });
    const unstated = {
      ...comment,
      kind: undefined,
      resolutionTarget: undefined,
      consumedAt: undefined,
    };
    expect(await compareMirroredReviewComments(deck, [unstated])).toEqual({
      checked: 1,
      differences: [],
    });
  });

  it("matches anchors and metadata whatever their key order", async () => {
    const deck = { ...DECK, resourceId: "deck-order" };
    const comment = copy({
      anchor: { y: 20, x: 10 },
      metadata: { b: 1, a: 2 },
    });
    await mirrorReviewComments(deck, [comment]);

    expect(
      await compareMirroredReviewComments(deck, [
        { ...comment, anchor: { x: 10, y: 20 }, metadata: { a: 2, b: 1 } },
      ]),
    ).toEqual({ checked: 1, differences: [] });
  });
});
