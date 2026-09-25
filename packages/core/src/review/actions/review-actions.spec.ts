import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
const notifyReviewCommentWithReceipt = vi.hoisted(() =>
  vi.fn(async () => null),
);
const notifyReviewComment = vi.hoisted(() => vi.fn(async () => ({ sent: [] })));

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*(select|with)/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
}));

vi.mock("../notifications.js", () => ({
  notifyReviewComment,
  notifyReviewCommentWithReceipt,
}));

const createReviewCommentAction = (await import("./create-review-comment.js"))
  .default;
const getReviewFeedbackAction = (await import("./get-review-feedback.js"))
  .default;
const listReviewCommentsAction = (await import("./list-review-comments.js"))
  .default;
const reactToReviewCommentAction = (
  await import("./react-to-review-comment.js")
).default;
const setReviewThreadUnreadAction = (
  await import("./set-review-thread-unread.js")
).default;
const setReviewThreadsUnreadAction = (
  await import("./set-review-threads-unread.js")
).default;
const setReviewThreadMutedAction = (
  await import("./set-review-thread-muted.js")
).default;
const replyReviewCommentAction = (await import("./reply-review-comment.js"))
  .default;
const resolveReviewThreadAction = (await import("./resolve-review-thread.js"))
  .default;
const updateReviewCommentAction = (await import("./update-review-comment.js"))
  .default;
const sendReviewThreadToAgentAction = (
  await import("./send-review-thread-to-agent.js")
).default;
const { __resetReviewableResourcesForTests, registerReviewableResource } =
  await import("../registry.js");
const {
  __resetReviewInitForTests,
  claimReviewNotificationDelivery,
  consumeReviewFeedback,
  ensureReviewTables,
  insertReviewComment,
  insertReviewReply,
  finishReviewNotificationDelivery,
  queryReviewComments,
  upsertReviewStatus,
} = await import("../store.js");

const OWNER_EMAIL = "owner@example.com";
const EDITOR_EMAIL = "editor@example.com";
const COMMENTER_EMAIL = "commenter@example.com";

beforeEach(async () => {
  pglite = await createTestPglite();
  rawClient.execute.mockClear();
  __resetReviewInitForTests();
  __resetReviewableResourcesForTests();
  registerReviewableResource({
    type: "doc",
    resolveAccess: (resourceId, ctx) => {
      if (ctx?.userEmail === EDITOR_EMAIL) {
        return {
          role: "editor",
          ownerEmail: OWNER_EMAIL,
          orgId: resourceId === "org" ? "org-1" : null,
          visibility:
            resourceId === "public"
              ? "public"
              : resourceId === "org"
                ? "org"
                : "private",
        };
      }
      if (ctx?.userEmail === COMMENTER_EMAIL) {
        return {
          role: "commenter",
          ownerEmail: OWNER_EMAIL,
          orgId: "owner-org",
          visibility: "public",
        };
      }
      if (resourceId === "public") {
        return {
          role: "viewer",
          ownerEmail: OWNER_EMAIL,
          orgId: "owner-org",
          visibility: "public",
        };
      }
      if (resourceId === "org" && ctx?.orgId === "org-1") {
        return {
          role: "viewer",
          ownerEmail: OWNER_EMAIL,
          orgId: "org-1",
          visibility: "org",
        };
      }
      return null;
    },
  });
  await ensureReviewTables();
});

it("denies discussion tool writes without resource access or against deleted comments", async () => {
  const root = await insertReviewComment({
    resourceType: "doc",
    resourceId: "private",
    body: "Review",
    ownerEmail: OWNER_EMAIL,
  });
  const resource = { resourceType: "doc", resourceId: "private" };
  const calls = [
    (ctx: { userEmail: string }) =>
      reactToReviewCommentAction.run(
        { ...resource, commentId: root.id, reaction: "👍", active: true },
        ctx,
      ),
    (ctx: { userEmail: string }) =>
      setReviewThreadMutedAction.run(
        { ...resource, threadId: root.threadId, muted: true },
        ctx,
      ),
    (ctx: { userEmail: string }) =>
      setReviewThreadUnreadAction.run(
        { ...resource, threadId: root.threadId, unread: true },
        ctx,
      ),
  ];
  for (const call of calls)
    await expect(call({ userEmail: "outsider@example.com" })).rejects.toThrow();
  await rawClient.execute({
    sql: "UPDATE agent_review_comments SET status = ? WHERE id = ?",
    args: ["deleted", root.id],
  });
  for (const call of calls)
    await expect(call({ userEmail: EDITOR_EMAIL })).rejects.toThrow(
      /not found/,
    );
  const counts = await rawClient.execute({
    sql: "SELECT (SELECT COUNT(*) FROM agent_review_comment_reactions) AS reactions, (SELECT COUNT(*) FROM agent_review_thread_preferences) AS preferences",
    args: [],
  });
  expect(Number(counts.rows[0].reactions)).toBe(0);
  expect(Number(counts.rows[0].preferences)).toBe(0);
});

it("uses current resource access for reaction and preference tools on decided threads", async () => {
  const root = await insertReviewComment({
    resourceType: "doc",
    resourceId: "private",
    body: "Review",
    ownerEmail: OWNER_EMAIL,
  });
  const context = { userEmail: EDITOR_EMAIL, caller: "frontend" };
  const resource = { resourceType: "doc", resourceId: "private" };
  await resolveReviewThreadAction.run(
    { ...resource, threadId: root.threadId },
    context,
  );
  await reactToReviewCommentAction.run(
    { ...resource, commentId: root.id, reaction: "👍", active: true },
    context,
  );
  await setReviewThreadUnreadAction.run(
    { ...resource, threadId: root.threadId, unread: true },
    context,
  );
  await setReviewThreadMutedAction.run(
    { ...resource, threadId: root.threadId, muted: true },
    context,
  );
  const result = await listReviewCommentsAction.run(
    { ...resource, includeResolved: true },
    context,
  );
  expect(result.discussion).toMatchObject({
    canReact: true,
    canSetThreadPreferences: true,
    reactions: { [root.id]: [{ reaction: "👍", count: 1, reactedByMe: true }] },
    threadPreferences: { [root.threadId]: { muted: true, unread: true } },
  });
  await expect(
    reactToReviewCommentAction.run(
      {
        ...resource,
        resourceId: "other",
        commentId: root.id,
        reaction: "👍",
        active: true,
      },
      context,
    ),
  ).rejects.toThrow("Review comment not found");
  await expect(
    setReviewThreadMutedAction.run(
      {
        ...resource,
        resourceId: "other",
        threadId: root.threadId,
        muted: true,
      },
      context,
    ),
  ).rejects.toThrow("Review thread not found");
  const publicRoot = await insertReviewComment({
    resourceType: "doc",
    resourceId: "public",
    body: "Public review",
    ownerEmail: OWNER_EMAIL,
    visibility: "public",
  });
  await expect(
    reactToReviewCommentAction.run(
      {
        ...resource,
        resourceId: "public",
        commentId: publicRoot.id,
        reaction: "👍",
        active: true,
      },
      { userEmail: "viewer@example.com" },
    ),
  ).rejects.toThrow();
  await setReviewThreadMutedAction.run(
    {
      ...resource,
      resourceId: "public",
      threadId: publicRoot.threadId,
      muted: true,
    },
    { userEmail: "viewer@example.com" },
  );
  await expect(
    setReviewThreadMutedAction.run({
      ...resource,
      resourceId: "public",
      threadId: publicRoot.threadId,
      muted: true,
    }),
  ).rejects.toThrow("A signed-in user is required");
  const publicResult = await listReviewCommentsAction.run({
    resourceType: "doc",
    resourceId: "public",
  });
  expect(publicResult.discussion.canReact).toBe(false);
  expect(publicResult.discussion.canSetThreadPreferences).toBe(false);
  expect(
    publicResult.discussion.threadPreferences[publicRoot.threadId],
  ).toEqual({ muted: false, unread: false });
});

afterEach(async () => {
  vi.useRealTimers();
  __resetReviewableResourcesForTests();
  await pglite.close();
  vi.clearAllMocks();
});

describe("review actions", () => {
  it("claims a notification recipient once across concurrent retries", async () => {
    const [first, second] = await Promise.all([
      claimReviewNotificationDelivery("comment-1", OWNER_EMAIL),
      claimReviewNotificationDelivery("comment-1", OWNER_EMAIL),
    ]);
    expect([first.status, second.status].sort()).toEqual(["busy", "claimed"]);
    const claimed = first.status === "claimed" ? first : second;
    if (claimed.status !== "claimed") throw new Error("Missing claim");
    await finishReviewNotificationDelivery(
      "comment-1",
      OWNER_EMAIL,
      claimed.token,
    );
    expect(
      (await claimReviewNotificationDelivery("comment-1", OWNER_EMAIL)).status,
    ).toBe("sent");
  });

  it("replays after display name and resource access snapshots change", async () => {
    const rootArgs = {
      resourceType: "doc",
      resourceId: "private",
      body: "Stable request",
      clientOperationId: "00000000-0000-4000-8000-000000000011",
    };
    const root = await createReviewCommentAction.run(rootArgs, {
      userEmail: EDITOR_EMAIL,
      userName: "Old Name",
    });
    __resetReviewableResourcesForTests();
    registerReviewableResource({
      type: "doc",
      resolveAccess: () => ({
        role: "editor",
        ownerEmail: "new-owner@example.com",
        orgId: "new-org",
        visibility: "org",
      }),
    });
    const replay = await createReviewCommentAction.run(rootArgs, {
      userEmail: EDITOR_EMAIL,
      userName: "New Name",
    });
    expect(replay).toMatchObject({
      id: root.id,
      replayed: true,
      authorName: "Old Name",
      ownerEmail: OWNER_EMAIL,
    });
  });

  it("replays client-identified comments and replies without duplicate notifications", async () => {
    notifyReviewCommentWithReceipt.mockClear();
    const createOperationId = "00000000-0000-4000-8000-000000000001";
    const root = await createReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        body: "Retry this comment",
        clientOperationId: createOperationId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    const replayedRoot = await createReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        body: "Retry this comment",
        clientOperationId: createOperationId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(replayedRoot).toMatchObject({
      id: root.id,
      replayed: true,
      notified: null,
    });

    const replyOperationId = "00000000-0000-4000-8000-000000000002";
    const reply = await replyReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        commentId: root.id,
        body: "Retry this reply",
        resolutionTarget: "human",
        clientOperationId: replyOperationId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    await resolveReviewThreadAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        threadId: root.threadId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    const replayedReply = await replyReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        commentId: root.id,
        body: "Retry this reply",
        resolutionTarget: "human",
        clientOperationId: replyOperationId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(replayedReply).toMatchObject({
      id: reply.id,
      replayed: true,
      notified: null,
    });
    await expect(
      replyReviewCommentAction.run(
        {
          resourceType: "doc",
          resourceId: "private",
          commentId: root.id,
          body: "Retry this reply",
          resolutionTarget: "agent",
          clientOperationId: replyOperationId,
        },
        { userEmail: EDITOR_EMAIL, caller: "frontend" },
      ),
    ).rejects.toThrow("submission ID conflicts");
    await pglite.query(
      "UPDATE agent_review_comments SET reply_route_target = 'legacy' WHERE id = $1",
      [reply.id],
    );
    await expect(
      replyReviewCommentAction.run(
        {
          resourceType: "doc",
          resourceId: "private",
          commentId: root.id,
          body: "Retry this reply",
          resolutionTarget: "human",
          clientOperationId: replyOperationId,
        },
        { userEmail: EDITOR_EMAIL, caller: "frontend" },
      ),
    ).rejects.toThrow("submission ID conflicts");
    expect(notifyReviewCommentWithReceipt).toHaveBeenCalledTimes(4);

    const comments = await queryReviewComments({
      resourceType: "doc",
      resourceId: "private",
      scope: { userEmail: OWNER_EMAIL },
      includeResolved: true,
    });
    expect(comments.map((comment) => comment.id)).toEqual([root.id, reply.id]);
  });

  it("rejects a reused client operation ID with a different comment payload or parent", async () => {
    const operationId = "00000000-0000-4000-8000-000000000003";
    await createReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        body: "Original payload",
        clientOperationId: operationId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    await expect(
      createReviewCommentAction.run(
        {
          resourceType: "doc",
          resourceId: "private",
          body: "Different payload",
          clientOperationId: operationId,
        },
        { userEmail: EDITOR_EMAIL, caller: "frontend" },
      ),
    ).rejects.toThrow("submission ID conflicts");

    const firstRoot = await createReviewCommentAction.run(
      { resourceType: "doc", resourceId: "private", body: "First root" },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    const secondRoot = await createReviewCommentAction.run(
      { resourceType: "doc", resourceId: "private", body: "Second root" },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    const replyOperationId = "00000000-0000-4000-8000-000000000004";
    await replyReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        commentId: firstRoot.id,
        body: "Reply payload",
        clientOperationId: replyOperationId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    await expect(
      replyReviewCommentAction.run(
        {
          resourceType: "doc",
          resourceId: "private",
          commentId: secondRoot.id,
          body: "Reply payload",
          clientOperationId: replyOperationId,
        },
        { userEmail: EDITOR_EMAIL, caller: "frontend" },
      ),
    ).rejects.toThrow("submission ID conflicts");
  });

  it("lets authors edit bodies and editors move anchors within the resource", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "public",
      body: "Original",
      authorEmail: COMMENTER_EMAIL,
      visibility: "public",
    });
    const updated = await updateReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "public",
        commentId: root.id,
        body: "Updated @Owner",
        mentions: [{ label: "Owner", email: "owner@example.com" }],
      },
      { userEmail: COMMENTER_EMAIL },
    );
    expect(updated.body).toBe("Updated @Owner");
    expect(updated.mentions).toEqual([
      { label: "Owner", email: "owner@example.com", id: null },
    ]);

    const moved = await updateReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "public",
        commentId: root.id,
        anchor: { point: { xPct: 40, yPct: 60 } },
      },
      { userEmail: EDITOR_EMAIL },
    );
    expect(moved.anchor).toEqual({ point: { xPct: 40, yPct: 60 } });
    await expect(
      updateReviewCommentAction.run(
        {
          resourceType: "doc",
          resourceId: "public",
          commentId: root.id,
          body: "Editor overwrite",
        },
        { userEmail: EDITOR_EMAIL },
      ),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      updateReviewCommentAction.run(
        {
          resourceType: "doc",
          resourceId: "public",
          commentId: root.id,
          body: "Nope",
        },
        { userEmail: "outsider@example.com" },
      ),
    ).rejects.toThrow();
  });

  it("marks multiple review threads read in one authorized action", async () => {
    const first = await insertReviewComment({
      resourceType: "doc",
      resourceId: "public",
      body: "First",
      authorEmail: COMMENTER_EMAIL,
      visibility: "public",
    });
    const second = await insertReviewComment({
      resourceType: "doc",
      resourceId: "public",
      body: "Second",
      authorEmail: COMMENTER_EMAIL,
      visibility: "public",
    });
    const result = await setReviewThreadsUnreadAction.run(
      {
        resourceType: "doc",
        resourceId: "public",
        threadIds: [first.threadId, second.threadId],
        unread: false,
      },
      { userEmail: EDITOR_EMAIL },
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: first.threadId, unread: false }),
        expect.objectContaining({ threadId: second.threadId, unread: false }),
      ]),
    );
  });

  it("returns a typed not-found error when a bulk thread is outside the resource", async () => {
    await expect(
      setReviewThreadsUnreadAction.run(
        {
          resourceType: "doc",
          resourceId: "public",
          threadIds: ["missing-thread"],
          unread: false,
        },
        { userEmail: EDITOR_EMAIL },
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "not_found" });
  });

  it("allows anonymous public reads and redacts ownership and identity metadata", async () => {
    expect(listReviewCommentsAction.requiresAuth).toBe(false);
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "public",
      body: "Public feedback",
      authorEmail: OWNER_EMAIL,
      authorName: "Alice Reviewer",
      mentions: [
        {
          label: "Bob Reviewer",
          email: "bob@example.com",
          id: "user-bob",
        },
      ],
      ownerEmail: OWNER_EMAIL,
      orgId: "owner-org",
      visibility: "public",
      metadata: {
        ownerEmail: OWNER_EMAIL,
        orgId: "owner-org",
        nested: {
          email: "bob@example.com",
          assignee: "bob@example.com",
          preserve: "visible",
        },
      },
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "public",
      body: "Legacy email display name",
      authorEmail: OWNER_EMAIL,
      authorName: OWNER_EMAIL,
      ownerEmail: OWNER_EMAIL,
      orgId: "owner-org",
      visibility: "public",
    });
    await upsertReviewStatus({
      resourceType: "doc",
      resourceId: "public",
      status: "in_review",
      updatedBy: OWNER_EMAIL,
      ownerEmail: OWNER_EMAIL,
      orgId: "owner-org",
      visibility: "public",
      metadata: { updatedBy: OWNER_EMAIL, preserve: "status metadata" },
    });

    const result = await listReviewCommentsAction.run({
      resourceType: "doc",
      resourceId: "public",
    });

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toMatchObject({
      authorEmail: null,
      authorName: "Alice Reviewer",
      ownerEmail: null,
      orgId: null,
      resolvedBy: null,
      deletedBy: null,
      mentions: [{ label: "Bob Reviewer" }],
      metadata: { nested: { assignee: null, preserve: "visible" } },
    });
    expect(result.comments[0].mentions[0]).not.toHaveProperty("email");
    expect(result.comments[0].mentions[0]).not.toHaveProperty("id");
    expect(result.comments[1].authorName).toBeNull();
    expect(result.reviewStatus).toMatchObject({
      updatedBy: null,
      ownerEmail: null,
      orgId: null,
      metadata: { preserve: "status metadata" },
    });

    const signedPublicResult = await listReviewCommentsAction.run(
      { resourceType: "doc", resourceId: "public" },
      { userEmail: "public-viewer@example.com", caller: "frontend" },
    );
    expect(signedPublicResult.comments[0]).toMatchObject({
      authorEmail: null,
      ownerEmail: null,
      orgId: null,
      canDelete: false,
    });

    await expect(
      createReviewCommentAction.run(
        {
          resourceType: "doc",
          resourceId: "public",
          body: "Viewer feedback must be rejected",
        },
        {
          userEmail: "public-viewer@example.com",
          caller: "frontend",
        },
      ),
    ).rejects.toThrow();

    const ownPublicComment = await createReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "public",
        body: "My public feedback",
      },
      {
        userEmail: COMMENTER_EMAIL,
        userName: "Public Reviewer",
        caller: "frontend",
      },
    );
    const ownPublicResult = await listReviewCommentsAction.run(
      { resourceType: "doc", resourceId: "public" },
      { userEmail: COMMENTER_EMAIL, caller: "frontend" },
    );
    expect(
      ownPublicResult.comments.find(
        (comment) => comment.id === ownPublicComment.id,
      ),
    ).toMatchObject({
      authorEmail: COMMENTER_EMAIL,
      authorName: "Public Reviewer",
      canDelete: true,
    });
  });

  it("denies anonymous private reads while allowing signed-in editors and org members", async () => {
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      body: "Private feedback",
      authorEmail: OWNER_EMAIL,
      authorName: "Owner",
      ownerEmail: OWNER_EMAIL,
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "org",
      body: "Org feedback",
      authorEmail: OWNER_EMAIL,
      authorName: "Owner",
      ownerEmail: OWNER_EMAIL,
      orgId: "org-1",
      visibility: "org",
    });

    await expect(
      listReviewCommentsAction.run({
        resourceType: "doc",
        resourceId: "private",
      }),
    ).rejects.toThrow(/Not allowed/);

    const editorResult = await listReviewCommentsAction.run(
      { resourceType: "doc", resourceId: "private" },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(editorResult.comments[0]).toMatchObject({
      authorEmail: OWNER_EMAIL,
      ownerEmail: OWNER_EMAIL,
    });

    const memberResult = await listReviewCommentsAction.run(
      { resourceType: "doc", resourceId: "org" },
      {
        userEmail: "member@example.com",
        orgId: "org-1",
        caller: "frontend",
      },
    );
    expect(memberResult.comments[0].body).toBe("Org feedback");
  });

  it("returns untruncated root-thread counts alongside a bounded comment page", async () => {
    for (let index = 0; index < 500; index += 1) {
      await insertReviewComment({
        resourceType: "doc",
        resourceId: "private",
        body: `Human feedback ${index}`,
        resolutionTarget: "human",
        ownerEmail: OWNER_EMAIL,
      });
    }
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      body: "Queued feedback beyond the first page",
      resolutionTarget: "agent",
      ownerEmail: OWNER_EMAIL,
    });

    const result = await listReviewCommentsAction.run(
      { resourceType: "doc", resourceId: "private", limit: 1 },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );

    expect(result.comments).toHaveLength(1);
    expect(result.summary).toEqual({
      openCount: 501,
      agentQueueCount: 1,
    });
  });

  it("routes an agent thread to a human and back to the agent at the root only", async () => {
    const root = await createReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        body: "Please update this",
        resolutionTarget: "agent",
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(root.authorName).toBeNull();
    await consumeReviewFeedback([root.id], "2026-07-10T00:00:00.000Z", {
      resourceType: "doc",
      resourceId: "private",
    });

    const humanReply = await replyReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        commentId: root.id,
        body: "A human should decide this",
        resolutionTarget: "human",
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(humanReply.authorName).toBeNull();
    expect(humanReply.resolutionTarget).toBeNull();

    const humanQueue = await getReviewFeedbackAction.run(
      { resourceType: "doc", resourceId: "private" },
      { userEmail: EDITOR_EMAIL, caller: "tool" },
    );
    expect(humanQueue.comments).toEqual([]);

    const routed = await sendReviewThreadToAgentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        threadId: root.threadId,
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(routed).toMatchObject({
      resourceType: "doc",
      resourceId: "private",
      threadId: root.threadId,
      resolutionTarget: "agent",
      consumedAt: null,
      updatedCount: 1,
      ownerEmail: OWNER_EMAIL,
      visibility: "private",
    });

    const comments = await queryReviewComments({
      resourceType: "doc",
      resourceId: "private",
      scope: { userEmail: OWNER_EMAIL },
    });
    const persistedRoot = comments.find((comment) => comment.id === root.id);
    expect(persistedRoot).toMatchObject({
      resolutionTarget: "agent",
      consumedAt: null,
    });
    expect(
      comments.find((comment) => comment.id === humanReply.id)
        ?.resolutionTarget,
    ).toBeNull();

    const neutralReply = await replyReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        commentId: humanReply.id,
        body: "Thanks for the update",
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(neutralReply.resolutionTarget).toBeNull();

    const agentQueue = await getReviewFeedbackAction.run(
      { resourceType: "doc", resourceId: "private" },
      { userEmail: EDITOR_EMAIL, caller: "tool" },
    );
    expect(agentQueue.comments.map((comment) => comment.id)).toEqual([root.id]);

    const auditTarget = sendReviewThreadToAgentAction.audit?.target?.(
      {
        resourceType: "doc",
        resourceId: "private",
        threadId: root.threadId,
      },
      routed,
      {
        status: "success",
        caller: "frontend",
        userEmail: EDITOR_EMAIL,
        orgId: null,
      },
    );
    expect(auditTarget).toEqual({
      type: "doc",
      id: "private",
      ownerEmail: OWNER_EMAIL,
      orgId: null,
      visibility: "private",
    });
  });

  it("removes a reply when non-transactional root routing fails", async () => {
    await expect(
      insertReviewReply(
        {
          resourceType: "doc",
          resourceId: "private",
          threadId: "missing-thread",
          parentCommentId: "missing-comment",
          body: "This reply must not become an orphan",
          ownerEmail: OWNER_EMAIL,
        },
        "human",
        { resourceType: "doc", resourceId: "private" },
      ),
    ).rejects.toThrow("Open review thread not found");

    const comments = await queryReviewComments({
      resourceType: "doc",
      resourceId: "private",
      scope: { userEmail: OWNER_EMAIL },
    });
    expect(comments).toEqual([]);
  });

  it("filters the distinct root queue before limit and returns oldest first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    for (let index = 0; index < 6; index += 1) {
      await insertReviewComment({
        resourceType: "doc",
        resourceId: "private",
        body: `Human-only ${index}`,
        resolutionTarget: "human",
        ownerEmail: OWNER_EMAIL,
      });
      vi.advanceTimersByTime(1_000);
    }
    const consumed = await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      body: "Already consumed",
      resolutionTarget: "agent",
      ownerEmail: OWNER_EMAIL,
    });
    await consumeReviewFeedback([consumed.id], "2026-07-01T00:00:06.500Z", {
      resourceType: "doc",
      resourceId: "private",
    });
    vi.advanceTimersByTime(1_000);
    const oldest = await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      body: "Oldest queued root",
      resolutionTarget: "agent",
      ownerEmail: OWNER_EMAIL,
    });
    vi.advanceTimersByTime(1_000);
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      threadId: oldest.threadId,
      body: "Duplicate malformed root",
      resolutionTarget: "agent",
      ownerEmail: OWNER_EMAIL,
    });
    await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      threadId: oldest.threadId,
      parentCommentId: oldest.id,
      body: "Legacy agent-targeted reply",
      resolutionTarget: "agent",
      ownerEmail: OWNER_EMAIL,
    });
    vi.advanceTimersByTime(1_000);
    const newer = await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      body: "Newer queued root",
      resolutionTarget: null,
      ownerEmail: OWNER_EMAIL,
    });

    const result = await getReviewFeedbackAction.run(
      { resourceType: "doc", resourceId: "private", limit: 2 },
      { userEmail: EDITOR_EMAIL, caller: "tool" },
    );

    expect(result.comments.map((comment) => comment.id)).toEqual([
      oldest.id,
      newer.id,
    ]);
    expect(
      new Set(result.comments.map((comment) => comment.threadId)).size,
    ).toBe(2);
    expect(result.comments.every((comment) => !comment.parentCommentId)).toBe(
      true,
    );
  });

  it("persists a bounded resolution note on root metadata and returns it", async () => {
    const root = await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      body: "Clarify this section",
      resolutionTarget: "agent",
      ownerEmail: OWNER_EMAIL,
      metadata: { severity: "medium" },
    });
    const reply = await insertReviewComment({
      resourceType: "doc",
      resourceId: "private",
      threadId: root.threadId,
      parentCommentId: root.id,
      body: "Additional context",
      ownerEmail: OWNER_EMAIL,
      metadata: { source: "reviewer" },
    });

    const result = await resolveReviewThreadAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        threadId: root.threadId,
        resolutionNote: "Updated the section and verified the example.",
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );

    expect(result).toMatchObject({
      status: "resolved",
      resolved: true,
      updatedCount: 2,
      resolutionNote: "Updated the section and verified the example.",
      comment: {
        id: root.id,
        resolutionNote: "Updated the section and verified the example.",
        metadata: {
          severity: "medium",
          resolutionNote: "Updated the section and verified the example.",
        },
      },
    });

    const persisted = await queryReviewComments({
      resourceType: "doc",
      resourceId: "private",
      scope: { userEmail: OWNER_EMAIL },
      includeResolved: true,
    });
    expect(persisted.find((comment) => comment.id === root.id)).toMatchObject({
      resolutionNote: "Updated the section and verified the example.",
      metadata: {
        severity: "medium",
        resolutionNote: "Updated the section and verified the example.",
      },
    });
    expect(persisted.find((comment) => comment.id === reply.id)).toMatchObject({
      resolutionNote: null,
      metadata: { source: "reviewer" },
    });

    await expect(
      resolveReviewThreadAction.run(
        {
          resourceType: "doc",
          resourceId: "private",
          threadId: root.threadId,
          resolutionNote: "x".repeat(2_001),
        },
        { userEmail: EDITOR_EMAIL, caller: "frontend" },
      ),
    ).rejects.toThrow();

    const reopened = await resolveReviewThreadAction.run(
      {
        resourceType: "doc",
        resourceId: "private",
        threadId: root.threadId,
        status: "open",
      },
      { userEmail: EDITOR_EMAIL, caller: "frontend" },
    );
    expect(reopened).toMatchObject({
      threadId: root.threadId,
      status: "open",
      resolved: false,
      resolutionNote: null,
      comment: { id: root.id, status: "open", resolutionNote: null },
    });
    expect(
      (
        await queryReviewComments({
          resourceType: "doc",
          resourceId: "private",
          scope: { userEmail: OWNER_EMAIL },
          includeResolved: true,
        })
      ).find((comment) => comment.id === root.id),
    ).toMatchObject({
      status: "open",
      resolutionNote: null,
      metadata: { severity: "medium" },
    });

    await expect(
      resolveReviewThreadAction.run(
        {
          resourceType: "doc",
          resourceId: "private",
          threadId: root.threadId,
          status: "open",
          resolutionNote: "Cannot attach a note while reopening.",
        },
        { userEmail: EDITOR_EMAIL, caller: "frontend" },
      ),
    ).rejects.toThrow(/only supported when resolving/);
  });
});
