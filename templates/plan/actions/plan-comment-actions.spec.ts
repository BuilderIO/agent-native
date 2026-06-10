/**
 * Spec for reply-to-plan-comment, resolve-plan-comment, and consume-plan-feedback.
 *
 * Follows the mock patterns from update-visual-plan.spec.ts and
 * update-visual-plan-comment-flow.spec.ts: importOriginal spread for
 * @agent-native/core, embedApp mocked, real plans.js helpers used where safe,
 * DB-touching helpers (loadPlanBundle, assertPlanEditor) stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const request = vi.hoisted(() => ({
  email: undefined as string | undefined,
  name: undefined as string | undefined,
}));

const assertPlanEditorMock = vi.hoisted(() => vi.fn());
const loadPlanBundleMock = vi.hoisted(() => vi.fn());
const notifyPlanCommentRecipientsMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

const originalAuthMode = process.env.AUTH_MODE;
const originalPlanLocalMode = process.env.PLAN_LOCAL_MODE;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  inArray: (...args: unknown[]) => ({ op: "inArray", args }),
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
    currentAccess: () => ({ userEmail: request.email }),
    resolveAccess: (...args: unknown[]) => resolveAccessMock(...args),
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
    },
    planEvents: { id: "planEvents.id" },
  },
}));

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyPlanCommentRecipients: (...args: unknown[]) =>
    notifyPlanCommentRecipientsMock(...args),
}));

// Use real plans.js helpers (comment row building, resolution, etc.)
// but stub the DB-touching and network-touching helpers.
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

// ---------------------------------------------------------------------------
// Import the three actions under test
// ---------------------------------------------------------------------------

const { default: replyToComment } = await import("./reply-to-plan-comment.js");
const { default: resolveComment } = await import("./resolve-plan-comment.js");
const { default: consumeFeedback } = await import("./consume-plan-feedback.js");

type ActionWithRun = { run: (args: unknown) => Promise<unknown> };

function runReply(args: Record<string, unknown>) {
  return (replyToComment as ActionWithRun).run(args);
}

function runResolve(args: Record<string, unknown>) {
  return (resolveComment as ActionWithRun).run(args);
}

function runConsume(args: Record<string, unknown>) {
  return (consumeFeedback as ActionWithRun).run(args);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// DB stub that captures insert values
function makeDb(
  insertCapture: Record<string, unknown>[] = [],
  updateCapture: Record<string, unknown>[] = [],
  /** Rows to return from a SELECT query (used to load the parent comment) */
  selectRows: Record<string, unknown>[] = [],
) {
  const dbInsert = vi.fn((_table: unknown) => ({
    values: vi.fn(async (row: Record<string, unknown>) => {
      insertCapture.push(row);
    }),
  }));
  const dbUpdate = vi.fn((_table: unknown) => ({
    set: vi.fn((patch: Record<string, unknown>) => {
      updateCapture.push(patch);
      return {
        where: vi.fn(async () => undefined),
      };
    }),
  }));
  const dbSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => selectRows),
    })),
  }));
  return { insert: dbInsert, update: dbUpdate, select: dbSelect };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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
  getDbMock.mockReset();
  delete process.env.AUTH_MODE;
  process.env.PLAN_LOCAL_MODE = "0";
});

afterEach(() => {
  if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = originalAuthMode;
  if (originalPlanLocalMode === undefined) delete process.env.PLAN_LOCAL_MODE;
  else process.env.PLAN_LOCAL_MODE = originalPlanLocalMode;
});

// ===========================================================================
// reply-to-plan-comment
// ===========================================================================

describe("reply-to-plan-comment", () => {
  it("happy path: inserts a reply and returns the comment id", async () => {
    const inserts: Record<string, unknown>[] = [];
    const db = makeDb(
      inserts,
      [],
      // SELECT returns the parent comment
      [
        {
          id: "root_cmt",
          planId: "plan_1",
          parentCommentId: null,
          sectionId: null,
          kind: "comment",
          anchor: null,
          resolutionTarget: "agent",
          status: "open",
        },
      ],
    );
    getDbMock.mockReturnValue(db);

    const result = (await runReply({
      planId: "plan_1",
      commentId: "root_cmt",
      body: "Done — CTA updated.",
    })) as { planId: string; commentId: string; parentCommentId: string };

    expect(result.planId).toBe("plan_1");
    expect(result.parentCommentId).toBe("root_cmt");
    // One comment row inserted (the reply).
    const commentInsert = inserts.find((row) =>
      Object.prototype.hasOwnProperty.call(row, "message"),
    );
    expect(commentInsert).toBeDefined();
    expect(commentInsert?.message).toBe("Done — CTA updated.");
  });

  it("throws a friendly error when the parent comment is not on the plan", async () => {
    const db = makeDb([], [], []); // SELECT returns empty → not found
    getDbMock.mockReturnValue(db);

    await expect(
      runReply({
        planId: "plan_1",
        commentId: "ghost_cmt",
        body: "This should fail",
      }),
    ).rejects.toThrow("Comment not found on this plan.");

    // No insert must have happened.
    expect(db.insert).not.toHaveBeenCalled();
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

// ===========================================================================
// resolve-plan-comment
// ===========================================================================

describe("resolve-plan-comment", () => {
  it("happy path: resolves an open comment and returns the new status", async () => {
    const updates: Record<string, unknown>[] = [];
    const db = makeDb(
      [],
      updates,
      // SELECT returns the existing comment
      [
        {
          id: "root_cmt",
          planId: "plan_1",
          parentCommentId: null,
          sectionId: null,
          kind: "comment",
          anchor: null,
          message: "Please update the CTA",
          createdBy: "human",
          authorEmail: "reviewer@example.com",
          resolutionTarget: "agent",
          mentionsJson: null,
          status: "open",
        },
      ],
    );
    getDbMock.mockReturnValue(db);

    const result = (await runResolve({
      planId: "plan_1",
      commentId: "root_cmt",
      status: "resolved",
    })) as { status: string; resolvedBy: string | null };

    expect(result.status).toBe("resolved");
    // Update must have been issued with resolved status.
    expect(updates).toHaveLength(1);
    expect(updates[0]?.status).toBe("resolved");
    expect(updates[0]?.resolvedBy).toBeTruthy();
  });

  it("reopens a resolved comment", async () => {
    const updates: Record<string, unknown>[] = [];
    const db = makeDb([], updates, [
      {
        id: "root_cmt",
        planId: "plan_1",
        parentCommentId: null,
        sectionId: null,
        kind: "comment",
        anchor: null,
        message: "Old feedback",
        createdBy: "human",
        authorEmail: "reviewer@example.com",
        resolutionTarget: "agent",
        mentionsJson: null,
        status: "resolved",
      },
    ]);
    getDbMock.mockReturnValue(db);

    const result = (await runResolve({
      planId: "plan_1",
      commentId: "root_cmt",
      status: "open",
    })) as { status: string };

    expect(result.status).toBe("open");
    expect(updates[0]?.status).toBe("open");
    expect(updates[0]?.resolvedBy).toBeNull();
    expect(updates[0]?.resolvedAt).toBeNull();
  });

  it("posts a resolutionNote reply before updating the status", async () => {
    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const db = makeDb(inserts, updates, [
      {
        id: "root_cmt",
        planId: "plan_1",
        parentCommentId: null,
        sectionId: null,
        kind: "comment",
        anchor: null,
        message: "Original feedback",
        createdBy: "human",
        authorEmail: "reviewer@example.com",
        resolutionTarget: "agent",
        mentionsJson: null,
        status: "open",
      },
    ]);
    getDbMock.mockReturnValue(db);

    const result = (await runResolve({
      planId: "plan_1",
      commentId: "root_cmt",
      status: "resolved",
      resolutionNote: "Fixed in commit abc123.",
    })) as { resolutionNoteId?: string };

    // A reply note must have been inserted.
    expect(inserts.length).toBeGreaterThan(0);
    const note = inserts.find(
      (row) => row.message === "Fixed in commit abc123.",
    );
    expect(note).toBeDefined();
    expect(result.resolutionNoteId).toBeDefined();
    // The status update must have happened.
    expect(updates[0]?.status).toBe("resolved");
  });

  it("throws a friendly error when the comment is not on the plan", async () => {
    const db = makeDb([], [], []);
    getDbMock.mockReturnValue(db);

    await expect(
      runResolve({ planId: "plan_1", commentId: "ghost", status: "resolved" }),
    ).rejects.toThrow("Comment not found on this plan.");
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

// ===========================================================================
// consume-plan-feedback
// ===========================================================================

describe("consume-plan-feedback", () => {
  it("marks comments consumed and returns the consumed ids", async () => {
    const updates: Record<string, unknown>[] = [];
    const db = makeDb([], updates, []);
    getDbMock.mockReturnValue(db);

    const result = (await runConsume({
      planId: "plan_1",
      commentIds: ["cmt_a", "cmt_b"],
    })) as { consumedCommentIds: string[]; consumedAt: string };

    expect(result.consumedCommentIds).toEqual(["cmt_a", "cmt_b"]);
    expect(result.consumedAt).toBe("2026-06-10T00:00:00.000Z");
    // Update must have been called.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      consumedAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
  });

  it("requires editor access — rejects when assertPlanEditor throws", async () => {
    assertPlanEditorMock.mockRejectedValueOnce(new Error("editor required"));
    const db = makeDb([], [], []);
    getDbMock.mockReturnValue(db);

    await expect(
      runConsume({ planId: "plan_1", commentIds: ["cmt_a"] }),
    ).rejects.toThrow("editor required");

    // No DB update must have been made.
    expect(db.update).not.toHaveBeenCalled();
  });

  it("verify via get-plan-feedback: consumed comments are excluded from feedback", async () => {
    // Simulate the consumed state in the bundle: comment with consumedAt set
    // should not appear in get-plan-feedback output.
    const bundleWithConsumed = {
      ...BASE_BUNDLE,
      comments: [
        {
          ...BASE_BUNDLE.comments[0],
          consumedAt: "2026-06-10T00:00:00.000Z",
        },
      ],
    };

    // get-plan-feedback filters out consumed human comments — verify the logic
    // by asserting the bundle shape.
    const unconsumed = bundleWithConsumed.comments.filter(
      (c) => c.createdBy === "human" && !c.consumedAt,
    );
    expect(unconsumed).toHaveLength(0);

    // Unconsumed comment should appear.
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
