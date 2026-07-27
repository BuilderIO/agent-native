import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*(select|with)/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isPostgres: () => false,
}));

const createReviewCommentAction = (await import("./create-review-comment.js"))
  .default;
const getReviewFeedbackAction = (await import("./get-review-feedback.js"))
  .default;
const listReviewCommentsAction = (await import("./list-review-comments.js"))
  .default;
const replyReviewCommentAction = (await import("./reply-review-comment.js"))
  .default;
const resolveReviewThreadAction = (await import("./resolve-review-thread.js"))
  .default;
const sendReviewThreadToAgentAction = (
  await import("./send-review-thread-to-agent.js")
).default;
const { __resetReviewableResourcesForTests, registerReviewableResource } =
  await import("../registry.js");
const {
  __resetReviewInitForTests,
  consumeReviewFeedback,
  ensureReviewTables,
  insertReviewComment,
  insertReviewReply,
  queryReviewComments,
  upsertReviewStatus,
} = await import("../store.js");

const OWNER_EMAIL = "owner@example.com";
const EDITOR_EMAIL = "editor@example.com";

beforeEach(async () => {
  sqlite = new Database(":memory:");
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

afterEach(() => {
  vi.useRealTimers();
  __resetReviewableResourcesForTests();
  sqlite.close();
  vi.clearAllMocks();
});

describe("review actions", () => {
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

    const ownPublicComment = await createReviewCommentAction.run(
      {
        resourceType: "doc",
        resourceId: "public",
        body: "My public feedback",
      },
      {
        userEmail: "public-viewer@example.com",
        userName: "Public Reviewer",
        caller: "frontend",
      },
    );
    const ownPublicResult = await listReviewCommentsAction.run(
      { resourceType: "doc", resourceId: "public" },
      { userEmail: "public-viewer@example.com", caller: "frontend" },
    );
    expect(
      ownPublicResult.comments.find(
        (comment) => comment.id === ownPublicComment.id,
      ),
    ).toMatchObject({
      authorEmail: null,
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
  });
});
