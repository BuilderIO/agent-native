import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { __resetStoreLedgerSnapshotForTests } from "../db/store-registry.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*(select|with)\b/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
}));

const {
  __resetReviewInitForTests,
  consumeReviewFeedback,
  deleteReviewComment,
  ensureReviewTables,
  getLiveReviewAuthorsByThread,
  getReviewCommentById,
  getReviewStatus,
  insertReviewComment,
  listReviewThreadParticipantEmails,
  queryReviewComments,
  resolveReviewThread,
  sendReviewThreadToAgent,
  upsertReviewStatus,
  setReviewCommentReaction,
  setReviewThreadPreference,
  setReviewThreadUnreadPreferences,
  getReviewDiscussionStateForComments,
  filterUnmutedReviewThreadRecipients,
} = await import("./store.js");

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetStoreLedgerSnapshotForTests();
  rawClient.execute.mockClear();
  __resetReviewInitForTests();
  await ensureReviewTables();
});

afterEach(async () => {
  await pglite.close();
  vi.clearAllMocks();
});

describe("review store", () => {
  it("reads reactions without exposing actors and isolates personal thread preferences", async () => {
    const comment = await insertReviewComment({
      resourceType: "doc",
      resourceId: "discussion",
      body: "Review",
      ownerEmail: "owner@example.com",
    });
    await setReviewCommentReaction({
      commentId: comment.id,
      actorEmail: "alice@example.com",
      reaction: "👍",
      active: true,
    });
    await setReviewCommentReaction({
      commentId: comment.id,
      actorEmail: "bob@example.com",
      reaction: "👍",
      active: true,
    });
    await setReviewCommentReaction({
      commentId: comment.id,
      actorEmail: "alice@example.com",
      reaction: "👍",
      active: true,
    });
    await Promise.all([
      setReviewThreadPreference({
        threadId: comment.threadId,
        userEmail: "alice@example.com",
        muted: true,
      }),
      setReviewThreadPreference({
        threadId: comment.threadId,
        userEmail: "alice@example.com",
        unread: true,
      }),
    ]);
    const alice = await getReviewDiscussionStateForComments(
      [comment],
      "alice@example.com",
    );
    expect(alice.reactions[comment.id]).toEqual([
      { reaction: "👍", count: 2, reactedByMe: true },
    ]);
    expect(alice.threadPreferences[comment.threadId]).toEqual({
      muted: true,
      unread: true,
    });
    const bob = await getReviewDiscussionStateForComments(
      [comment],
      "bob@example.com",
    );
    expect(bob.threadPreferences[comment.threadId]).toEqual({
      muted: false,
      unread: false,
    });
    const anonymous = await getReviewDiscussionStateForComments(
      [comment],
      null,
    );
    expect(anonymous.reactions[comment.id]).toEqual([
      { reaction: "👍", count: 2, reactedByMe: false },
    ]);
    expect(JSON.stringify(anonymous)).not.toContain("@example.com");
    expect(
      await filterUnmutedReviewThreadRecipients(comment.threadId, [
        "alice@example.com",
        "bob@example.com",
      ]),
    ).toEqual(["bob@example.com"]);
    await setReviewThreadPreference({
      threadId: comment.threadId,
      userEmail: "alice@example.com",
      muted: false,
    });
    expect(
      (
        await getReviewDiscussionStateForComments(
          [comment],
          "alice@example.com",
        )
      ).threadPreferences[comment.threadId],
    ).toEqual({ muted: false, unread: true });
    await setReviewCommentReaction({
      commentId: comment.id,
      actorEmail: "alice@example.com",
      reaction: "👍",
      active: false,
    });
    expect(
      (
        await getReviewDiscussionStateForComments(
          [comment],
          "alice@example.com",
        )
      ).reactions[comment.id],
    ).toEqual([{ reaction: "👍", count: 1, reactedByMe: false }]);
    expect(
      await getReviewDiscussionStateForComments([], "alice@example.com"),
    ).toEqual({ reactions: {}, threadPreferences: {} });
  });

  it("writes multiple unread preferences with one bulk insert", async () => {
    const first = await insertReviewComment({
      resourceType: "doc",
      resourceId: "bulk",
      body: "First",
      ownerEmail: "owner@example.com",
    });
    const second = await insertReviewComment({
      resourceType: "doc",
      resourceId: "bulk",
      body: "Second",
      ownerEmail: "owner@example.com",
    });
    await setReviewThreadPreference({
      threadId: first.threadId,
      userEmail: "alice@example.com",
      muted: true,
    });
    rawClient.execute.mockClear();

    const preferences = await setReviewThreadUnreadPreferences({
      threadIds: [first.threadId, second.threadId],
      userEmail: "alice@example.com",
      unread: false,
      resource: { resourceType: "doc", resourceId: "bulk" },
    });

    expect(
      rawClient.execute.mock.calls.filter(
        ([input]) =>
          typeof input !== "string" &&
          input.sql.includes("INSERT INTO agent_review_thread_preferences"),
      ),
    ).toHaveLength(1);
    expect(preferences).toEqual(
      expect.arrayContaining([
        { threadId: first.threadId, muted: true, unread: false },
        { threadId: second.threadId, muted: false, unread: false },
      ]),
    );
  });

  it("stores threaded comments with anchors, mentions, and metadata", async () => {
    const root = await insertReviewComment({
      resourceType: "plan",
      resourceId: "p1",
      targetId: "section-1",
      kind: "annotation",
      anchor: { blockId: "section-1", quote: "Hello" },
      body: "Please check this",
      authorEmail: "alice@example.com",
      ownerEmail: "alice@example.com",
      mentions: [{ label: "Bob", email: "bob@example.com" }],
      metadata: { severity: "medium" },
    });
    await insertReviewComment({
      resourceType: "plan",
      resourceId: "p1",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "Looks good",
      authorEmail: "bob@example.com",
      ownerEmail: "alice@example.com",
    });

    const comments = await queryReviewComments({
      resourceType: "plan",
      resourceId: "p1",
      scope: { userEmail: "alice@example.com" },
    });
    expect(comments).toHaveLength(2);
    expect(comments[0].anchor).toEqual({
      blockId: "section-1",
      quote: "Hello",
    });
    expect(comments[0].mentions).toEqual([
      { label: "Bob", email: "bob@example.com" },
    ]);
    expect(comments[0].metadata).toEqual({ severity: "medium" });
    expect(comments[1].parentCommentId).toBe(root.id);
  });

  describe("deleteReviewComment", () => {
    const thread = async (resourceId: string) => {
      const root = await insertReviewComment({
        resourceType: "plan",
        resourceId,
        body: "Root",
        authorEmail: "alice@example.com",
        ownerEmail: "alice@example.com",
      });
      const reply = await insertReviewComment({
        resourceType: "plan",
        resourceId,
        threadId: root.threadId,
        parentCommentId: root.id,
        body: "Reply",
        authorEmail: "bob@example.com",
        ownerEmail: "alice@example.com",
      });
      return { root, reply };
    };
    const liveBodies = async (resourceId: string) =>
      (
        await queryReviewComments({
          resourceType: "plan",
          resourceId,
          scope: { userEmail: "alice@example.com" },
        })
      ).map((comment) => comment.body);

    it("deletes the whole thread when its first comment is deleted", async () => {
      const { root } = await thread("p1");
      await thread("p2");

      expect(await deleteReviewComment(root.id, "alice@example.com")).toBe(2);

      expect(await liveBodies("p1")).toEqual([]);
      expect(await liveBodies("p2")).toEqual(["Root", "Reply"]);
    });

    it("hands the live reply authors to the thread check, and deletes nothing when it refuses", async () => {
      const { root, reply } = await thread("p1");
      await deleteReviewComment(reply.id, "bob@example.com");
      await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: root.threadId,
        parentCommentId: root.id,
        body: "Second reply",
        authorEmail: "carol@example.com",
        ownerEmail: "alice@example.com",
      });
      const seen: Array<ReadonlyArray<string | null>> = [];

      await expect(
        deleteReviewComment(root.id, "alice@example.com", {
          assertThreadDeletable: (authors) => {
            seen.push(authors);
            throw new Error("refused");
          },
        }),
      ).rejects.toThrow("refused");

      // Bob's reply was already deleted, so only Carol's is live.
      expect(seen).toEqual([["carol@example.com"]]);
      expect(await liveBodies("p1")).toEqual(["Root", "Second reply"]);
    });

    it("reads the replies after taking the thread's lock, so a reply that lands then is seen", async () => {
      const { root } = await thread("p1");
      const client = rawClient as typeof rawClient & {
        transaction?: (
          fn: (tx: Pick<typeof rawClient, "execute">) => Promise<number>,
        ) => Promise<number>;
      };
      client.transaction = (fn) =>
        fn({
          execute: async (input) => {
            const result = await rawClient.execute(input);
            if (typeof input !== "string" && /FOR UPDATE/.test(input.sql)) {
              await insertReviewComment({
                resourceType: "plan",
                resourceId: "p1",
                threadId: root.threadId,
                parentCommentId: root.id,
                body: "Late reply",
                authorEmail: "carol@example.com",
                ownerEmail: "alice@example.com",
              });
            }
            return result;
          },
        });
      let seen: ReadonlyArray<string | null> = [];
      try {
        await deleteReviewComment(root.id, "alice@example.com", {
          assertThreadDeletable: (authors) => {
            seen = authors;
          },
        });
      } finally {
        delete client.transaction;
      }

      expect([...seen].sort()).toEqual([
        "bob@example.com",
        "carol@example.com",
      ]);
      expect(await liveBodies("p1")).toEqual([]);
    });

    it("checks and deletes the same replies when a root's thread is not its own id, as a correction comment's isn't", async () => {
      const root = await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: "thread-given-at-insert",
        body: "Root",
        authorEmail: "alice@example.com",
        ownerEmail: "alice@example.com",
      });
      await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: root.threadId,
        parentCommentId: root.id,
        body: "Carol's reply",
        authorEmail: "carol@example.com",
        ownerEmail: "alice@example.com",
      });
      const seen: Array<ReadonlyArray<string | null>> = [];

      await expect(
        deleteReviewComment(root.id, "alice@example.com", {
          assertThreadDeletable: (authors) => {
            seen.push(authors);
            if (authors.some((author) => author !== "alice@example.com")) {
              throw new Error("refused");
            }
          },
        }),
      ).rejects.toThrow("refused");

      expect(seen).toEqual([["carol@example.com"]]);
      expect(await liveBodies("p1")).toEqual(["Root", "Carol's reply"]);
      expect(await deleteReviewComment(root.id, "alice@example.com")).toBe(2);
      expect(await liveBodies("p1")).toEqual([]);
    });

    it("takes the whole thread, another first-level comment included, and checks all its authors", async () => {
      const root = await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: "shared-thread",
        body: "Root",
        authorEmail: "alice@example.com",
        ownerEmail: "alice@example.com",
      });
      const second = await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: "shared-thread",
        body: "Second root",
        authorEmail: "carol@example.com",
        ownerEmail: "alice@example.com",
        metadata: { resolutionNote: "Carol's note", source: "pin" },
      });
      await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: "shared-thread",
        parentCommentId: second.id,
        body: "Dave's reply",
        authorEmail: "dave@example.com",
        ownerEmail: "alice@example.com",
      });
      const seen: Array<ReadonlyArray<string | null>> = [];

      expect(
        await deleteReviewComment(root.id, "alice@example.com", {
          assertThreadDeletable: (authors) => {
            seen.push(authors);
          },
        }),
      ).toBe(3);

      expect(seen.map((authors) => [...authors].sort())).toEqual([
        ["carol@example.com", "dave@example.com"],
      ]);
      expect(await liveBodies("p1")).toEqual([]);
      expect(
        await getReviewCommentById(second.id, {}, { bypassScope: true }),
      ).toMatchObject({ body: "", metadata: { source: "pin" } });
    });

    it("leaves another resource's replies alone when a given thread id repeats there", async () => {
      const root = await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: "repeated-thread",
        body: "Root",
        authorEmail: "alice@example.com",
        ownerEmail: "alice@example.com",
      });
      const elsewhere = await insertReviewComment({
        resourceType: "plan",
        resourceId: "p2",
        threadId: "repeated-thread",
        body: "Other root",
        authorEmail: "carol@example.com",
        ownerEmail: "alice@example.com",
      });
      await insertReviewComment({
        resourceType: "plan",
        resourceId: "p2",
        threadId: elsewhere.threadId,
        parentCommentId: elsewhere.id,
        body: "Carol's reply",
        authorEmail: "carol@example.com",
        ownerEmail: "alice@example.com",
      });
      const assertThreadDeletable = vi.fn();

      expect(
        await deleteReviewComment(root.id, "alice@example.com", {
          assertThreadDeletable,
        }),
      ).toBe(1);

      expect(assertThreadDeletable).toHaveBeenCalledWith([]);
      expect(await liveBodies("p2")).toEqual(["Other root", "Carol's reply"]);
    });

    it("lists who wrote in each thread, on one resource, once each, without the deleted", async () => {
      const first = await thread("p1");
      const other = await thread("p2");
      for (const body of ["Second reply", "Third reply"]) {
        await insertReviewComment({
          resourceType: "plan",
          resourceId: "p1",
          threadId: first.root.threadId,
          parentCommentId: first.root.id,
          body,
          authorEmail: "carol@example.com",
          ownerEmail: "alice@example.com",
        });
      }
      await insertReviewComment({
        resourceType: "plan",
        resourceId: "p1",
        threadId: first.root.threadId,
        body: "Second root",
        authorEmail: "dave@example.com",
        ownerEmail: "alice@example.com",
      });
      await deleteReviewComment(first.reply.id, "bob@example.com");
      const resource = { resourceType: "plan", resourceId: "p1" };

      const authors = await getLiveReviewAuthorsByThread(
        [first.root.threadId, other.root.threadId, first.root.threadId],
        resource,
      );
      expect(
        new Map(
          [...authors].map(([threadId, emails]) => [
            threadId,
            [...emails].sort(),
          ]),
        ),
      ).toEqual(
        new Map([
          [
            first.root.threadId,
            ["alice@example.com", "carol@example.com", "dave@example.com"],
          ],
        ]),
      );
      expect(await getLiveReviewAuthorsByThread([], resource)).toEqual(
        new Map(),
      );
    });

    it("does not ask the thread check about a reply", async () => {
      const { reply } = await thread("p1");
      const assertThreadDeletable = vi.fn();

      await deleteReviewComment(reply.id, "bob@example.com", {
        assertThreadDeletable,
      });

      expect(assertThreadDeletable).not.toHaveBeenCalled();
      expect(await liveBodies("p1")).toEqual(["Root"]);
    });

    it("deletes only a reply when a reply is deleted", async () => {
      const { reply } = await thread("p1");

      expect(await deleteReviewComment(reply.id, "bob@example.com")).toBe(1);

      expect(await liveBodies("p1")).toEqual(["Root"]);
    });

    it("keeps who deleted a reply that was already gone", async () => {
      const { root, reply } = await thread("p1");
      await deleteReviewComment(reply.id, "bob@example.com");

      await deleteReviewComment(root.id, "alice@example.com");

      const rows = await queryReviewComments({
        resourceType: "plan",
        resourceId: "p1",
        scope: { userEmail: "alice@example.com" },
        includeDeleted: true,
      });
      const byId = Object.fromEntries(
        rows.map((comment) => [comment.id, comment.deletedBy]),
      );
      expect(byId).toEqual({
        [root.id]: "alice@example.com",
        [reply.id]: "bob@example.com",
      });
    });
  });

  it("keeps legacy replies when filtering comments by the root target", async () => {
    const currentRoot = await insertReviewComment({
      resourceType: "plan",
      resourceId: "p1",
      targetId: "section-1",
      body: "Current section",
      ownerEmail: "alice@example.com",
    });
    await insertReviewComment({
      resourceType: "plan",
      resourceId: "p1",
      threadId: currentRoot.threadId,
      parentCommentId: currentRoot.id,
      body: "Legacy reply",
      ownerEmail: "alice@example.com",
    });
    await insertReviewComment({
      resourceType: "plan",
      resourceId: "p1",
      threadId: currentRoot.threadId,
      parentCommentId: currentRoot.id,
      targetId: "section-1",
      body: "Inherited target reply",
      ownerEmail: "alice@example.com",
    });
    await insertReviewComment({
      resourceType: "plan",
      resourceId: "p1",
      targetId: "section-2",
      body: "Other section",
      ownerEmail: "alice@example.com",
    });

    const comments = await queryReviewComments({
      resourceType: "plan",
      resourceId: "p1",
      scope: { userEmail: "alice@example.com" },
      targetId: "section-1",
    });

    expect(comments.map((comment) => comment.body)).toEqual([
      "Current section",
      "Legacy reply",
      "Inherited target reply",
    ]);
  });

  it("limits newest-first results by thread activity while retaining each root", async () => {
    const olderRoot = await insertReviewComment({
      resourceType: "design",
      resourceId: "d1",
      body: "Older thread",
      ownerEmail: "alice@example.com",
    });
    const newerRoot = await insertReviewComment({
      resourceType: "design",
      resourceId: "d1",
      body: "Newer thread",
      ownerEmail: "alice@example.com",
    });
    const newerReply = await insertReviewComment({
      resourceType: "design",
      resourceId: "d1",
      threadId: olderRoot.threadId,
      parentCommentId: olderRoot.id,
      body: "Latest activity is a reply on the older thread",
      ownerEmail: "alice@example.com",
    });
    await rawClient.execute({
      sql: "UPDATE agent_review_comments SET created_at = ? WHERE id = ?",
      args: ["2020-01-01T00:00:00.000Z", olderRoot.id],
    });
    await rawClient.execute({
      sql: "UPDATE agent_review_comments SET created_at = ? WHERE id = ?",
      args: ["2025-01-01T00:00:00.000Z", newerRoot.id],
    });
    await rawClient.execute({
      sql: "UPDATE agent_review_comments SET created_at = ? WHERE id = ?",
      args: ["2030-01-01T00:00:00.000Z", newerReply.id],
    });

    const comments = await queryReviewComments({
      resourceType: "design",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
      newestFirst: true,
      limit: 1,
    });

    expect(comments.map((comment) => comment.id)).toEqual([
      olderRoot.id,
      newerReply.id,
    ]);
  });

  it("resolves threads and hides resolved comments by default", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d1",
      body: "Open item",
      ownerEmail: "alice@example.com",
    });
    await expect(
      resolveReviewThread(root.threadId, "alice@example.com"),
    ).resolves.toBeGreaterThan(0);

    const open = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
    });
    expect(open).toHaveLength(0);

    const all = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
      includeResolved: true,
    });
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("resolved");
    expect(all[0].resolvedBy).toBe("alice@example.com");

    await expect(
      resolveReviewThread(
        root.threadId,
        "alice@example.com",
        { resourceType: "doc", resourceId: "d1" },
        undefined,
        "open",
      ),
    ).resolves.toBeGreaterThan(0);
    const reopened = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
    });
    expect(reopened[0]).toMatchObject({
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });
  });

  it("returns zero when resolving a missing thread", async () => {
    await expect(
      resolveReviewThread("missing-thread", "alice@example.com", {
        resourceType: "doc",
        resourceId: "d1",
      }),
    ).resolves.toBe(0);
  });

  it("marks feedback consumed separately from resolution", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d1",
      body: "Agent should handle this",
      ownerEmail: "alice@example.com",
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "d2",
      body: "Different resource",
      ownerEmail: "alice@example.com",
    });
    await expect(
      consumeReviewFeedback([root.id], "2026-07-07T00:00:00.000Z", {
        resourceType: "doc",
        resourceId: "d1",
      }),
    ).resolves.toBe(1);

    const comments = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
    });
    expect(comments[0].status).toBe("open");
    expect(comments[0].consumedAt).toBe("2026-07-07T00:00:00.000Z");
  });

  it("routes only the selected open thread to the agent", async () => {
    const selected = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d1",
      body: "Shorten this heading",
      resolutionTarget: "human",
      ownerEmail: "alice@example.com",
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "d1",
      body: "Keep this as a human decision",
      resolutionTarget: "human",
      ownerEmail: "alice@example.com",
    });

    await expect(
      sendReviewThreadToAgent(selected.threadId, {
        resourceType: "doc",
        resourceId: "d1",
      }),
    ).resolves.toBe(1);

    const comments = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
    });
    expect(comments).toHaveLength(2);
    expect(
      comments.find((comment) => comment.threadId === selected.threadId)
        ?.resolutionTarget,
    ).toBe("agent");
    expect(
      comments.find((comment) => comment.threadId !== selected.threadId)
        ?.resolutionTarget,
    ).toBe("human");
  });

  it("returns zero when consuming unmatched comment ids", async () => {
    await expect(
      consumeReviewFeedback(["missing"], "2026-07-07T00:00:00.000Z", {
        resourceType: "doc",
        resourceId: "d1",
      }),
    ).resolves.toBe(0);
  });

  it("filters resolve operations to the target resource", async () => {
    const first = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d1",
      threadId: "shared-thread",
      body: "First",
      ownerEmail: "alice@example.com",
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "d2",
      threadId: "shared-thread",
      body: "Second",
      ownerEmail: "alice@example.com",
    });

    await resolveReviewThread(first.threadId, "alice@example.com", {
      resourceType: "doc",
      resourceId: "d1",
    });

    const firstRows = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
      includeResolved: true,
    });
    const secondRows = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d2",
      scope: { userEmail: "alice@example.com" },
    });
    expect(firstRows[0].status).toBe("resolved");
    expect(secondRows[0].status).toBe("open");
  });

  it("scopes comments and review statuses", async () => {
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "d1",
      body: "Private",
      ownerEmail: "alice@example.com",
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "d1",
      body: "Org visible",
      ownerEmail: "bob@example.com",
      orgId: "org-1",
      visibility: "org",
    });
    await upsertReviewStatus({
      resourceType: "doc",
      resourceId: "d1",
      status: "in_review",
      updatedBy: "bob@example.com",
      ownerEmail: "bob@example.com",
      orgId: "org-1",
      visibility: "org",
      metadata: { gate: "legal" },
    });

    const outsider = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "mallory@example.com" },
    });
    expect(outsider).toHaveLength(0);

    const orgMember = await queryReviewComments({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com", orgId: "org-1" },
      includeResolved: true,
    });
    expect(orgMember.map((comment) => comment.body).sort()).toEqual([
      "Org visible",
      "Private",
    ]);

    const status = await getReviewStatus("doc", "d1", {
      userEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(status?.status).toBe("in_review");
    expect(status?.metadata).toEqual({ gate: "legal" });
  });

  it("finds a thread's participants on a resource with more comments than a page", async () => {
    for (let index = 0; index < 205; index += 1) {
      await insertReviewComment({
        resourceType: "doc",
        resourceId: "busy",
        body: `Older thread ${index}`,
        authorEmail: "early@example.com",
      });
    }
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "busy",
      body: "Newer thread",
      authorEmail: "root@example.com",
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "busy",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "First reply",
      authorEmail: "replier@example.com",
    });
    const deleted = await insertReviewComment({
      resourceType: "doc",
      resourceId: "busy",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "Withdrawn reply",
      authorEmail: "withdrawn@example.com",
    });
    await deleteReviewComment(deleted.id, "withdrawn@example.com");

    const participants = await listReviewThreadParticipantEmails({
      resourceType: "doc",
      resourceId: "busy",
      threadId: root.threadId,
    });
    expect(participants.sort()).toEqual([
      "replier@example.com",
      "root@example.com",
    ]);
  });

  it("clears the text, mentions, anchor, attachments and note of every comment a delete removes", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete",
      body: "Ask @Bob about this",
      authorEmail: "alice@example.com",
      mentions: [{ label: "Bob", email: "bob@example.com" }],
      anchor: { quote: "the quoted heading", offset: 12 },
      metadata: {
        source: "pin",
        attachments: [
          { url: "https://cdn.builder.io/api/v1/image/x", name: "shot" },
        ],
      },
    });
    const reply = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "On it, @Alice",
      authorEmail: "bob@example.com",
      mentions: [{ label: "Alice", email: "alice@example.com" }],
      metadata: {
        attachments: [
          { url: "https://cdn.builder.io/api/v1/image/z", name: "reply" },
        ],
      },
    });
    const plainReply = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "Plain reply",
      authorEmail: "carol@example.com",
    });
    const legacyNote = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "Old note",
      authorEmail: "carol@example.com",
      metadata: {
        type: "resolution",
        note: "Old note",
        resolvedNote: "Older note",
        resolution: { note: "Nested note", by: "carol@example.com" },
      },
    });
    await resolveReviewThread(
      root.threadId,
      "alice@example.com",
      { resourceType: "doc", resourceId: "d-delete" },
      "Fixed in the header",
    );

    expect(await deleteReviewComment(root.id, "alice@example.com")).toBe(4);
    expect(await deleteReviewComment("missing", "alice@example.com")).toBe(0);

    const stored = await getReviewCommentById(
      root.id,
      {},
      { bypassScope: true },
    );
    expect(stored).toMatchObject({
      status: "deleted",
      body: "",
      mentions: [],
      anchor: null,
      metadata: { source: "pin" },
      deletedBy: "alice@example.com",
    });
    const storedReply = await getReviewCommentById(
      reply.id,
      {},
      { bypassScope: true },
    );
    expect(storedReply).toMatchObject({
      status: "deleted",
      body: "",
      mentions: [],
      deletedBy: "alice@example.com",
    });
    expect(storedReply?.metadata ?? {}).not.toHaveProperty("attachments");
    expect(
      await getReviewCommentById(plainReply.id, {}, { bypassScope: true }),
    ).toMatchObject({ status: "deleted", body: "" });
    const storedNote = await getReviewCommentById(
      legacyNote.id,
      {},
      { bypassScope: true },
    );
    expect(storedNote?.metadata).toEqual({
      type: "resolution",
      resolution: { by: "carol@example.com" },
    });
  });

  it("clears a thread of more replies than one statement takes", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-busy",
      body: "Busy root",
      authorEmail: "alice@example.com",
    });
    const insertReplies = await pglite.prepare(
      `INSERT INTO agent_review_comments
         (id, resource_type, resource_id, thread_id, parent_comment_id, body,
          author_email, created_at, updated_at, metadata_json)
       SELECT 'busy-' || n, 'doc', 'd-busy', ?, ?, 'Reply ' || n,
              'bob@example.com', ?, ?,
              CASE WHEN n % 2 = 0
                THEN '{"attachments":[{"url":"https://cdn.builder.io/x"}]}'
              END
         FROM generate_series(1, 1001) AS n`,
    );
    const now = new Date().toISOString();
    await insertReplies.run(root.threadId, root.id, now, now);
    rawClient.execute.mockClear();

    expect(await deleteReviewComment(root.id, "alice@example.com")).toBe(1002);

    const replyUpdates = rawClient.execute.mock.calls.filter(
      ([input]) => typeof input !== "string" && /WHERE id IN/.test(input.sql),
    );
    expect(replyUpdates).toHaveLength(2);
    const left = await pglite.prepare(
      `SELECT COUNT(*) AS live
         FROM agent_review_comments
        WHERE resource_id = 'd-busy' AND parent_comment_id IS NOT NULL
          AND deleted_at IS NULL`,
    );
    const cleared = await pglite.prepare(
      `SELECT COUNT(metadata_json) AS with_metadata,
              COUNT(NULLIF(body, '')) AS with_text
         FROM agent_review_comments
        WHERE resource_id = 'd-busy' AND parent_comment_id IS NOT NULL`,
    );
    expect((await left.all())[0]).toMatchObject({ live: 0 });
    expect((await cleared.all())[0]).toMatchObject({
      with_metadata: 0,
      with_text: 0,
    });
  });

  it("lists the live replies of a root deleted before deletes took replies along, newest first too", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-legacy",
      body: "Old root",
      authorEmail: "alice@example.com",
    });
    const reply = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-legacy",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "Still here",
      authorEmail: "bob@example.com",
    });
    const markDeleted = await pglite.prepare(
      `UPDATE agent_review_comments
          SET status = 'deleted', deleted_at = ?
        WHERE id = ?`,
    );
    await markDeleted.run(new Date().toISOString(), root.id);

    for (const newestFirst of [false, true]) {
      const live = await queryReviewComments({
        resourceType: "doc",
        resourceId: "d-legacy",
        scope: {},
        bypassScope: true,
        newestFirst,
      });
      expect(live.map((comment) => comment.id)).toEqual([reply.id]);
      expect(live[0].threadId).toBe(root.threadId);
    }
  });

  it("leaves who deleted a comment alone when it's deleted on its own while its thread is being deleted", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete-race",
      threadId: "race-thread",
      body: "Root",
      authorEmail: "alice@example.com",
    });
    const second = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete-race",
      threadId: "race-thread",
      body: "Second root",
      authorEmail: "alice@example.com",
    });
    const reply = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete-race",
      threadId: "race-thread",
      parentCommentId: root.id,
      body: "Reply",
      authorEmail: "alice@example.com",
    });
    const run = rawClient.execute.getMockImplementation();
    if (!run) throw new Error("The test client has no implementation");
    let raced = false;
    rawClient.execute.mockImplementation(async (input) => {
      if (
        !raced &&
        typeof input !== "string" &&
        input.sql.includes("status = 'deleted'")
      ) {
        raced = true;
        // Both are deleted on their own after the thread was read.
        const write = await pglite.prepare(
          `UPDATE agent_review_comments
              SET status = 'deleted', deleted_by = ?, deleted_at = ?
            WHERE id IN (?, ?)`,
        );
        await write.run(
          "bob@example.com",
          "2026-01-01T00:00:00.000Z",
          second.id,
          reply.id,
        );
      }
      return run(input);
    });
    try {
      expect(await deleteReviewComment(root.id, "carol@example.com")).toBe(1);
    } finally {
      rawClient.execute.mockImplementation(run);
    }

    expect(raced).toBe(true);
    for (const id of [second.id, reply.id]) {
      expect(
        await getReviewCommentById(id, {}, { bypassScope: true }),
      ).toMatchObject({
        status: "deleted",
        deletedBy: "bob@example.com",
        deletedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    expect(
      await getReviewCommentById(root.id, {}, { bypassScope: true }),
    ).toMatchObject({ status: "deleted", deletedBy: "carol@example.com" });
  });

  it("keeps metadata another write adds while a comment is being deleted", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "d-delete-race",
      body: "Racing",
      authorEmail: "alice@example.com",
      metadata: {
        source: "pin",
        attachments: [
          { url: "https://cdn.builder.io/api/v1/image/y", name: "shot" },
        ],
      },
    });
    const run = rawClient.execute.getMockImplementation();
    if (!run) throw new Error("The test client has no implementation");
    let raced = false;
    rawClient.execute.mockImplementation(async (input) => {
      if (
        !raced &&
        typeof input !== "string" &&
        input.sql.includes("status = 'deleted'")
      ) {
        raced = true;
        // Another write lands between the deletion's read and its update.
        const read = await pglite.prepare(
          "SELECT metadata_json FROM agent_review_comments WHERE id = ?",
        );
        const current = await read.all(root.id);
        const metadata = JSON.parse(
          String((current[0] as { metadata_json: string }).metadata_json),
        ) as Record<string, unknown>;
        const write = await pglite.prepare(
          "UPDATE agent_review_comments SET metadata_json = ? WHERE id = ?",
        );
        await write.run(
          JSON.stringify({ ...metadata, label: "kept" }),
          root.id,
        );
      }
      return run(input);
    });
    try {
      expect(await deleteReviewComment(root.id, "alice@example.com")).toBe(1);
    } finally {
      rawClient.execute.mockImplementation(run);
    }

    expect(raced).toBe(true);
    const stored = await getReviewCommentById(
      root.id,
      {},
      { bypassScope: true },
    );
    expect(stored).toMatchObject({
      status: "deleted",
      body: "",
      metadata: { source: "pin", label: "kept" },
    });
    expect(stored?.metadata).not.toHaveProperty("attachments");
  });
});
