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
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isPostgres: () => false,
}));

const {
  __resetReviewInitForTests,
  consumeReviewFeedback,
  ensureReviewTables,
  getReviewStatus,
  insertReviewComment,
  queryReviewComments,
  resolveReviewThread,
  upsertReviewStatus,
} = await import("./store.js");

beforeEach(async () => {
  sqlite = new Database(":memory:");
  rawClient.execute.mockClear();
  __resetReviewInitForTests();
  await ensureReviewTables();
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("review store", () => {
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
