import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { closeDbExec, getDbExec, withDbExec } = await import("../db/client.js");
const { ReviewCommentResourceConflictError } = await import("./errors.js");
const {
  compareMirroredReviewComments,
  deleteMirroredReviewComments,
  mirrorReviewComments,
} = await import("./mirror.js");
const { __resetReviewInitForTests, ensureReviewTables, getReviewCommentById } =
  await import("./store.js");
type ReviewCommentCopy = import("./mirror.js").ReviewCommentCopy;

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
