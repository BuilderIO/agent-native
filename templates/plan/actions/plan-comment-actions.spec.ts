import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  email: undefined as string | undefined,
  name: undefined as string | undefined,
}));

const assertPlanEditorMock = vi.hoisted(() => vi.fn());
const loadPlanBundleMock = vi.hoisted(() => vi.fn());
const notifyPlanCommentRecipientsMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

const originalAuthMode = process.env.AUTH_MODE;
const originalPlanLocalMode = process.env.PLAN_LOCAL_MODE;

// oracle-change: Plan's comment actions write to the review kit now, so these check kit writes
const kitMock = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  write: vi.fn(async (..._args: unknown[]) => undefined),
  delete: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("@agent-native/core/review", () => ({
  ensureReviewTables: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/plan-comments.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/plan-comments.js")
  >("../server/lib/plan-comments.js");
  return {
    completePlanCommentRow: actual.completePlanCommentRow,
    listPlanCommentRows: vi.fn(async () => kitMock.rows),
    findPlanCommentRow: vi.fn(
      async (_planId: string, id: string) =>
        kitMock.rows.find((row) => row.id === id) ?? null,
    ),
    writePlanCommentRows: kitMock.write,
    deletePlanCommentThread: vi.fn(
      async (...args: [unknown, string, string, string | null, string]) => {
        await kitMock.delete(...args);
        return actual.commentAndDescendantIds(
          kitMock.rows.map((row) => ({
            id: String(row.id),
            parentCommentId:
              typeof row.parentCommentId === "string"
                ? row.parentCommentId
                : null,
          })),
          args[2],
        );
      },
    ),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  inArray: (...args: unknown[]) => ({ op: "inArray", args }),
  isNull: (...args: unknown[]) => ({ op: "isNull", args }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  defineAction: (options: unknown) => options,
  embedApp: vi.fn(() => ({ title: "stub" })),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => request.email,
  getRequestUserName: () => request.name,
}));

vi.mock("@agent-native/core/sharing", () => {
  class ForbiddenError extends Error {
    statusCode = 403;
    constructor(message: string) {
      super(message);
      this.name = "ForbiddenError";
    }
  }
  return {
    ForbiddenError,
    assertAccess: (...args: unknown[]) => assertAccessMock(...args),
    currentAccess: () => ({ userEmail: request.email }),
    resolveAccess: (...args: unknown[]) => resolveAccessMock(...args),
    roleSatisfies: (actual: string, minimum: string) => {
      const rank: Record<string, number> = {
        viewer: 1,
        commenter: 2,
        editor: 3,
        admin: 4,
        owner: 5,
      };
      return (rank[actual] ?? 0) >= (rank[minimum] ?? 0);
    },
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => getDbMock(),
  schema: {
    plans: { id: "plans.id", updatedAt: "plans.updatedAt" },
    planSections: { id: "planSections.id", planId: "planSections.planId" },
    planComments: {
      id: "planComments.id",
      planId: "planComments.planId",
      parentCommentId: "planComments.parentCommentId",
      sectionId: "planComments.sectionId",
      kind: "planComments.kind",
      anchor: "planComments.anchor",
      message: "planComments.message",
      createdBy: "planComments.createdBy",
      authorEmail: "planComments.authorEmail",
      resolutionTarget: "planComments.resolutionTarget",
      mentionsJson: "planComments.mentionsJson",
      status: "planComments.status",
      consumedAt: "planComments.consumedAt",
      deletedAt: "planComments.deletedAt",
      deletedBy: "planComments.deletedBy",
      updatedAt: "planComments.updatedAt",
    },
    planEvents: { id: "planEvents.id" },
  },
}));

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyPlanCommentRecipients: (...args: unknown[]) =>
    notifyPlanCommentRecipientsMock(...args),
}));

vi.mock("../server/plans.js", async () => {
  const actual =
    await vi.importActual<typeof import("../server/plans.js")>(
      "../server/plans.js",
    );
  return {
    ...actual,
    assertPlanEditor: (...args: unknown[]) => assertPlanEditorMock(...args),
    buildPlanHtml: vi.fn(() => "<html></html>"),
    loadPlanBundle: (...args: unknown[]) => loadPlanBundleMock(...args),
    newId: vi.fn((prefix: string) => `${prefix}_test`),
    nowIso: vi.fn(() => "2026-06-10T00:00:00.000Z"),
  };
});

const { default: replyToComment } = await import("./reply-to-plan-comment.js");
const { default: resolveComment } = await import("./resolve-plan-comment.js");
const { default: deleteComment } = await import("./delete-plan-comment.js");
const { default: consumeFeedback } = await import("./consume-plan-feedback.js");

type ActionWithRun = { run: (args: unknown) => Promise<unknown> };

function runReply(args: Record<string, unknown>) {
  return (replyToComment as ActionWithRun).run(args);
}

function runResolve(args: Record<string, unknown>) {
  return (resolveComment as ActionWithRun).run(args);
}

function runDelete(args: Record<string, unknown>) {
  return (deleteComment as ActionWithRun).run(args);
}

function runConsume(args: Record<string, unknown>) {
  return (consumeFeedback as ActionWithRun).run(args);
}

const BASE_BUNDLE = {
  plan: {
    id: "plan_1",
    title: "My Plan",
    brief: "",
    kind: "plan",
    status: "review",
    content: null,
  },
  access: {
    role: "owner",
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
  },
  sections: [],
  comments: [
    {
      id: "root_cmt",
      planId: "plan_1",
      parentCommentId: null,
      sectionId: null,
      kind: "comment",
      status: "open",
      anchor: null,
      message: "Please update the CTA",
      createdBy: "human",
      authorEmail: "reviewer@example.com",
      authorName: "Reviewer",
      resolutionTarget: "agent",
      mentions: [],
      mentionsJson: null,
      resolvedBy: null,
      resolvedAt: null,
      consumedAt: null,
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    },
  ],
  events: [],
  summary: { sectionCounts: {}, commentCount: 1, openCommentCount: 1 },
};

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "root_cmt",
    planId: "plan_1",
    parentCommentId: null,
    sectionId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    message: "Please update the CTA",
    createdBy: "human",
    authorEmail: "reviewer@example.com",
    authorName: "Reviewer",
    resolutionTarget: "agent",
    mentionsJson: null,
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

function makeDb() {
  const db = {
    insert: vi.fn((_table: unknown) => ({
      values: vi.fn(async (_row: Record<string, unknown>) => undefined),
    })),
    transaction: vi.fn(
      async (write: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
        write(db),
    ),
  };
  return db;
}

function written(): Array<Record<string, unknown>> {
  expect(kitMock.write).toHaveBeenCalledTimes(1);
  const [, , rows, patches] = kitMock.write.mock.calls[0] ?? [];
  const stored = new Map(kitMock.rows.map((row) => [row.id, row]));
  const inserted: Array<Record<string, unknown>> = Array.isArray(rows)
    ? rows.filter((row: Record<string, unknown>) => !stored.has(row.id))
    : [];
  const patched: Array<Record<string, unknown>> = Array.isArray(patches)
    ? patches.flatMap((patch: Record<string, unknown>) => {
        const row = stored.get(patch.id);
        return row ? [{ ...row, ...patch }] : [];
      })
    : [];
  return [...inserted, ...patched];
}

beforeEach(() => {
  request.email = "agent@example.com";
  request.name = "Agent";
  assertPlanEditorMock.mockReset();
  assertPlanEditorMock.mockResolvedValue(undefined);
  loadPlanBundleMock.mockReset();
  loadPlanBundleMock.mockResolvedValue(BASE_BUNDLE);
  notifyPlanCommentRecipientsMock.mockReset();
  notifyPlanCommentRecipientsMock.mockResolvedValue(undefined);
  resolveAccessMock.mockReset();
  resolveAccessMock.mockResolvedValue({
    resource: { id: "plan_1", ownerEmail: "owner@example.com" },
    role: "owner",
  });
  assertAccessMock.mockReset();
  assertAccessMock.mockResolvedValue({
    resource: { id: "plan_1", ownerEmail: "owner@example.com" },
    role: "editor",
  });
  getDbMock.mockReset();
  kitMock.rows = [];
  kitMock.write.mockClear();
  kitMock.delete.mockClear();
  delete process.env.AUTH_MODE;
  process.env.PLAN_LOCAL_MODE = "0";
});

afterEach(() => {
  if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = originalAuthMode;
  if (originalPlanLocalMode === undefined) delete process.env.PLAN_LOCAL_MODE;
  else process.env.PLAN_LOCAL_MODE = originalPlanLocalMode;
});

describe("reply-to-plan-comment", () => {
  it("happy path: writes a reply to the kit and returns the comment id", async () => {
    kitMock.rows = [commentRow()];
    const db = makeDb();
    getDbMock.mockReturnValue(db);

    const result = (await runReply({
      planId: "plan_1",
      commentId: "root_cmt",
      body: "Done — CTA updated.",
    })) as { planId: string; commentId: string; parentCommentId: string };

    expect(result.planId).toBe("plan_1");
    expect(result.parentCommentId).toBe("root_cmt");
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(kitMock.write).toHaveBeenCalledWith(db, "plan_1", [
      expect.objectContaining({
        id: result.commentId,
        parentCommentId: "root_cmt",
        message: "Done — CTA updated.",
        createdBy: "agent",
        status: "open",
      }),
    ]);
  });

  it("throws a friendly error when the parent comment is not on the plan", async () => {
    getDbMock.mockReturnValue(makeDb());

    await expect(
      runReply({
        planId: "plan_1",
        commentId: "ghost_cmt",
        body: "This should fail",
      }),
    ).rejects.toThrow("Comment not found on this plan.");

    expect(kitMock.write).not.toHaveBeenCalled();
  });

  it("rejects an anonymous public-link viewer", async () => {
    request.email =
      "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local";

    await expect(
      runReply({ planId: "plan_1", commentId: "root_cmt", body: "Hi" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("rejects a hosted guest-author identity", async () => {
    request.email =
      "guest-123e4567-e89b-12d3-a456-426614174000@agent-native.guest";

    await expect(
      runReply({ planId: "plan_1", commentId: "root_cmt", body: "Hi" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("rejects when there is no request identity in hosted mode", async () => {
    request.email = undefined;
    process.env.AUTH_MODE = "hosted";

    await expect(
      runReply({ planId: "plan_1", commentId: "root_cmt", body: "Hi" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(resolveAccessMock).not.toHaveBeenCalled();
  });
});

describe("resolve-plan-comment", () => {
  it("happy path: resolves an open comment and returns the new status", async () => {
    kitMock.rows = [commentRow()];
    getDbMock.mockReturnValue(makeDb());

    const result = (await runResolve({
      planId: "plan_1",
      commentId: "root_cmt",
      status: "resolved",
    })) as { status: string; resolvedBy: string | null };

    expect(result.status).toBe("resolved");
    expect(written()).toEqual([
      expect.objectContaining({
        id: "root_cmt",
        status: "resolved",
        resolvedBy: "agent@example.com",
        resolvedAt: "2026-06-10T00:00:00.000Z",
        message: "Please update the CTA",
      }),
    ]);
  });

  it("reopens a resolved comment", async () => {
    kitMock.rows = [
      commentRow({
        message: "Old feedback",
        status: "resolved",
        resolvedBy: "reviewer@example.com",
        resolvedAt: "2026-06-09T00:00:00.000Z",
      }),
    ];
    getDbMock.mockReturnValue(makeDb());

    const result = (await runResolve({
      planId: "plan_1",
      commentId: "root_cmt",
      status: "open",
    })) as { status: string };

    expect(result.status).toBe("open");
    expect(written()).toEqual([
      expect.objectContaining({
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
      }),
    ]);
  });

  it("resolves every comment in the thread, not just the root", async () => {
    kitMock.rows = [
      commentRow({ message: "Original feedback" }),
      commentRow({
        id: "reply_cmt",
        parentCommentId: "root_cmt",
        message: "Follow-up detail",
      }),
      commentRow({ id: "other_cmt", message: "Another thread" }),
    ];
    getDbMock.mockReturnValue(makeDb());

    await runResolve({
      planId: "plan_1",
      commentId: "root_cmt",
      status: "resolved",
    });

    const rows = written();
    expect(rows.map((row) => row.id).sort()).toEqual(["reply_cmt", "root_cmt"]);
    expect(rows.every((row) => row.status === "resolved")).toBe(true);
    expect(rows.every((row) => row.resolvedBy)).toBe(true);
  });

  it("posts a resolutionNote reply with the status change", async () => {
    kitMock.rows = [commentRow({ message: "Original feedback" })];
    getDbMock.mockReturnValue(makeDb());

    const result = (await runResolve({
      planId: "plan_1",
      commentId: "root_cmt",
      status: "resolved",
      resolutionNote: "Fixed in commit abc123.",
    })) as { resolutionNoteId?: string };

    const rows = written();
    const note = rows.find((row) => row.message === "Fixed in commit abc123.");
    expect(note).toMatchObject({
      id: result.resolutionNoteId,
      parentCommentId: "root_cmt",
      createdBy: "agent",
      status: "resolved",
    });
    expect(rows.every((row) => row.status === "resolved")).toBe(true);
  });

  it("throws a friendly error when the comment is not on the plan", async () => {
    getDbMock.mockReturnValue(makeDb());

    await expect(
      runResolve({ planId: "plan_1", commentId: "ghost", status: "resolved" }),
    ).rejects.toThrow("Comment not found on this plan.");
    expect(kitMock.write).not.toHaveBeenCalled();
  });

  it("rejects an anonymous public-link viewer", async () => {
    request.email = "public-abc123@agent-native.local";

    await expect(
      runResolve({
        planId: "plan_1",
        commentId: "root_cmt",
        status: "resolved",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(resolveAccessMock).not.toHaveBeenCalled();
  });
});

describe("delete-plan-comment", () => {
  it("deletes a root comment and its descendants", async () => {
    kitMock.rows = [
      commentRow({ authorEmail: "agent@example.com" }),
      commentRow({
        id: "reply_cmt",
        parentCommentId: "root_cmt",
        authorEmail: "reviewer@example.com",
      }),
      commentRow({
        id: "nested_cmt",
        parentCommentId: "reply_cmt",
        authorEmail: "owner@example.com",
      }),
      commentRow({ id: "other_cmt", authorEmail: "agent@example.com" }),
    ];
    const db = makeDb();
    getDbMock.mockReturnValue(db);

    const result = (await runDelete({
      planId: "plan_1",
      commentId: "root_cmt",
    })) as { deletedCommentIds: string[]; deletedCount: number };

    expect(result.deletedCommentIds).toEqual([
      "root_cmt",
      "reply_cmt",
      "nested_cmt",
    ]);
    expect(result.deletedCount).toBe(3);
    expect(assertAccessMock).not.toHaveBeenCalled();
    expect(kitMock.delete).toHaveBeenCalledWith(
      db,
      "plan_1",
      "root_cmt",
      "agent@example.com",
      "2026-06-10T00:00:00.000Z",
    );
  });

  it("allows a plan editor to delete someone else's reply", async () => {
    kitMock.rows = [
      commentRow(),
      commentRow({ id: "reply_cmt", parentCommentId: "root_cmt" }),
    ];
    const db = makeDb();
    getDbMock.mockReturnValue(db);

    const result = (await runDelete({
      planId: "plan_1",
      commentId: "reply_cmt",
    })) as { deletedCommentIds: string[] };

    expect(result.deletedCommentIds).toEqual(["reply_cmt"]);
    expect(assertAccessMock).toHaveBeenCalledWith("plan", "plan_1", "editor", {
      userEmail: "agent@example.com",
    });
    expect(kitMock.delete).toHaveBeenCalledWith(
      db,
      "plan_1",
      "reply_cmt",
      "agent@example.com",
      "2026-06-10T00:00:00.000Z",
    );
  });

  it("throws a friendly error when the comment is not on the plan", async () => {
    kitMock.rows = [
      commentRow({ id: "other_cmt", authorEmail: "agent@example.com" }),
    ];
    getDbMock.mockReturnValue(makeDb());

    await expect(
      runDelete({ planId: "plan_1", commentId: "ghost_cmt" }),
    ).rejects.toThrow("Comment not found on this plan.");

    expect(kitMock.delete).not.toHaveBeenCalled();
  });

  it("rejects an anonymous public-link viewer", async () => {
    request.email = "public-abc123@agent-native.local";

    await expect(
      runDelete({ planId: "plan_1", commentId: "root_cmt" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("rejects a hosted guest-author identity", async () => {
    request.email =
      "guest-123e4567-e89b-12d3-a456-426614174000@agent-native.guest";

    await expect(
      runDelete({ planId: "plan_1", commentId: "root_cmt" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(resolveAccessMock).not.toHaveBeenCalled();
  });
});

describe("consume-plan-feedback", () => {
  it("marks the plan's live comments consumed and returns the requested ids", async () => {
    kitMock.rows = [
      commentRow({ id: "cmt_a" }),
      commentRow({ id: "cmt_c", message: "Not asked about" }),
    ];
    getDbMock.mockReturnValue(makeDb());

    const result = (await runConsume({
      planId: "plan_1",
      commentIds: ["cmt_a", "cmt_b"],
    })) as { consumedCommentIds: string[]; consumedAt: string };

    expect(result.consumedCommentIds).toEqual(["cmt_a", "cmt_b"]);
    expect(result.consumedAt).toBe("2026-06-10T00:00:00.000Z");
    expect(written()).toEqual([
      expect.objectContaining({
        id: "cmt_a",
        message: "Please update the CTA",
        consumedAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:00.000Z",
      }),
    ]);
  });

  it("requires editor access — rejects when assertPlanEditor throws", async () => {
    assertPlanEditorMock.mockRejectedValueOnce(new Error("editor required"));
    getDbMock.mockReturnValue(makeDb());

    await expect(
      runConsume({ planId: "plan_1", commentIds: ["cmt_a"] }),
    ).rejects.toThrow("editor required");

    expect(kitMock.write).not.toHaveBeenCalled();
  });

  it("verify via get-plan-feedback: consumed comments are excluded from feedback", async () => {
    const bundleWithConsumed = {
      ...BASE_BUNDLE,
      comments: [
        {
          ...BASE_BUNDLE.comments[0],
          consumedAt: "2026-06-10T00:00:00.000Z",
        },
      ],
    };

    const unconsumed = bundleWithConsumed.comments.filter(
      (c) => c.createdBy === "human" && !c.consumedAt,
    );
    expect(unconsumed).toHaveLength(0);

    const unconsumedBundle = {
      ...BASE_BUNDLE,
      comments: [{ ...BASE_BUNDLE.comments[0], consumedAt: null }],
    };
    const visible = unconsumedBundle.comments.filter(
      (c) => c.createdBy === "human" && !c.consumedAt,
    );
    expect(visible).toHaveLength(1);
  });
});
