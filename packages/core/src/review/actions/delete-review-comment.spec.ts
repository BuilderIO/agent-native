import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

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

const deleteReviewCommentAction = (await import("./delete-review-comment.js"))
  .default;
const listReviewCommentsAction = (await import("./list-review-comments.js"))
  .default;
const { ForbiddenError } = await import("../../sharing/access.js");
const { __resetReviewableResourcesForTests, registerReviewableResource } =
  await import("../registry.js");
const {
  __resetReviewInitForTests,
  ensureReviewTables,
  insertReviewComment,
  insertReviewReply,
  queryReviewComments,
} = await import("../store.js");
const { __resetStoreLedgerSnapshotForTests } =
  await import("../../db/store-registry.js");

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const VIEWER = "viewer@example.com";
const RESOURCE = { resourceType: "doc", resourceId: "doc-1" };

const ROLES: Record<string, "editor" | "commenter" | "viewer"> = {
  [EDITOR]: "editor",
  [ALICE]: "commenter",
  [BOB]: "commenter",
  [VIEWER]: "viewer",
};

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetStoreLedgerSnapshotForTests();
  __resetReviewInitForTests();
  __resetReviewableResourcesForTests();
  registerReviewableResource({
    type: "doc",
    resolveAccess: (_resourceId, ctx) => {
      const role = ctx?.userEmail ? ROLES[ctx.userEmail] : undefined;
      return role
        ? { role, ownerEmail: OWNER, orgId: null, visibility: "private" }
        : null;
    },
  });
  await ensureReviewTables();
});

afterEach(async () => {
  await pglite.close();
});

async function thread(replyAuthors: string[]) {
  const root = await insertReviewComment({
    ...RESOURCE,
    body: "Root",
    authorEmail: ALICE,
    ownerEmail: OWNER,
  });
  for (const [index, authorEmail] of replyAuthors.entries()) {
    await insertReviewReply(
      {
        ...RESOURCE,
        threadId: root.threadId,
        parentCommentId: root.id,
        body: `Reply ${index + 1}`,
        authorEmail,
        ownerEmail: OWNER,
      },
      null,
      RESOURCE,
    );
  }
  return root;
}

const remainingBodies = async () =>
  (
    await queryReviewComments({
      ...RESOURCE,
      scope: { userEmail: OWNER },
      includeResolved: true,
    })
  ).map((comment) => comment.body);

const run = (userEmail: string, commentId: string) =>
  deleteReviewCommentAction.run({ ...RESOURCE, commentId }, { userEmail });

describe("delete-review-comment", () => {
  it("lets an author delete their own reply and leaves the rest", async () => {
    const root = await thread([BOB, ALICE]);
    const replies = await queryReviewComments({
      ...RESOURCE,
      scope: { userEmail: OWNER },
    });
    const bobsReply = replies.find((comment) => comment.body === "Reply 1")!;

    const result = await run(BOB, bobsReply.id);

    expect(result).toMatchObject({ deleted: true, updatedCount: 1 });
    expect(await remainingBodies()).toEqual(["Root", "Reply 2"]);
    expect(root.id).toBeTruthy();
  });

  it("refuses to delete a reply someone else wrote, unless the actor edits", async () => {
    await thread([BOB]);
    const reply = (
      await queryReviewComments({ ...RESOURCE, scope: { userEmail: OWNER } })
    ).find((comment) => comment.body === "Reply 1")!;

    await expect(run(ALICE, reply.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await remainingBodies()).toEqual(["Root", "Reply 1"]);

    await run(EDITOR, reply.id);
    expect(await remainingBodies()).toEqual(["Root"]);
  });

  it("deletes the whole thread when its author deletes a first comment that holds only their own words", async () => {
    const root = await thread([ALICE, ALICE]);

    const result = await run(ALICE, root.id);

    expect(result).toMatchObject({ deleted: true, updatedCount: 3 });
    expect(await remainingBodies()).toEqual([]);
  });

  it("refuses the author a thread that holds someone else's reply, and deletes nothing", async () => {
    const root = await thread([ALICE, BOB]);

    await expect(run(ALICE, root.id)).rejects.toThrow(
      "Not allowed to delete a thread that has replies from other people",
    );
    await expect(run(ALICE, root.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await remainingBodies()).toEqual(["Root", "Reply 1", "Reply 2"]);
  });

  it("lets an editor delete a thread with other people's replies", async () => {
    const root = await thread([BOB]);

    const result = await run(EDITOR, root.id);

    expect(result).toMatchObject({ deleted: true, updatedCount: 2 });
    expect(await remainingBodies()).toEqual([]);
  });

  it("refuses a commenter a thread someone else started", async () => {
    const root = await thread([]);

    await expect(run(BOB, root.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await remainingBodies()).toEqual(["Root"]);
  });

  it("refuses a viewer, who may not comment", async () => {
    const root = await thread([]);

    await expect(run(VIEWER, root.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses someone with no access at all", async () => {
    const root = await thread([]);

    await expect(run("stranger@example.com", root.id)).rejects.toThrow();
    expect(await remainingBodies()).toEqual(["Root"]);
  });

  it("does not reach a comment on another resource", async () => {
    const root = await thread([]);

    await expect(
      deleteReviewCommentAction.run(
        { resourceType: "doc", resourceId: "doc-2", commentId: root.id },
        { userEmail: EDITOR },
      ),
    ).rejects.toThrow("Review comment not found");
  });

  it("deletes an already deleted comment again without error, and reports an unknown one", async () => {
    const root = await thread([]);
    await run(ALICE, root.id);

    await expect(run(ALICE, root.id)).resolves.toMatchObject({ deleted: true });
    await expect(run(ALICE, "missing-comment")).rejects.toThrow(
      "Review comment not found",
    );
  });
});

describe("list-review-comments canDeleteThread", () => {
  const list = async (userEmail: string) =>
    (await listReviewCommentsAction.run(RESOURCE, { userEmail })) as {
      comments: Array<{
        body: string;
        canDelete?: boolean;
        canDeleteThread?: boolean;
      }>;
    };
  const byBody = (result: Awaited<ReturnType<typeof list>>, body: string) =>
    result.comments.find((comment) => comment.body === body)!;

  it("tells the author they can delete a thread of only their own words", async () => {
    await thread([ALICE]);
    const root = byBody(await list(ALICE), "Root");
    expect(root.canDeleteThread).toBe(true);
    expect(root.canDelete).toBe(true);
  });

  it("withholds the thread delete once someone else replies, while the first comment stays deletable", async () => {
    await thread([ALICE, BOB]);
    const root = byBody(await list(ALICE), "Root");
    expect(root.canDeleteThread).toBe(false);
    // `canDelete` still says what it always did: this comment is theirs.
    expect(root.canDelete).toBe(true);
  });

  it("gives an editor the thread delete whoever replied", async () => {
    await thread([BOB]);
    expect(byBody(await list(EDITOR), "Root").canDeleteThread).toBe(true);
  });

  it("gives a commenter no thread delete on someone else's thread", async () => {
    await thread([]);
    expect(byBody(await list(BOB), "Root").canDeleteThread).toBe(false);
  });

  it("says nothing about a thread on a reply", async () => {
    await thread([ALICE]);
    expect(
      byBody(await list(ALICE), "Reply 1").canDeleteThread,
    ).toBeUndefined();
  });
});
