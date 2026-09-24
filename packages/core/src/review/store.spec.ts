import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

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
  ensureReviewTables,
  getReviewStatus,
  insertReviewComment,
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
});
