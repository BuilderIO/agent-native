import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration-style coverage of the COMMENT PATH through update-visual-plan:
 * identity stamping (anti-spoof), the public-comment authorization gate, and
 * that the notification call receives the right inserted ids + prior comments.
 *
 * Mirrors actions/update-visual-plan.spec.ts mock wiring so it exercises the
 * real action body. Uses the real ../server/plans.js comment-row builder +
 * resolveCommentAuthor (only loadPlanBundle / DB-touching helpers are stubbed).
 */

const request = vi.hoisted(() => ({
  email: undefined as string | undefined,
  name: undefined as string | undefined,
}));
const assertPlanEditorMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const loadPlanBundleMock = vi.hoisted(() => vi.fn());
const notifyPlanCommentRecipientsMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());
const originalAuthMode = process.env.AUTH_MODE;
const originalPlanLocalMode = process.env.PLAN_LOCAL_MODE;

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  inArray: (...args: unknown[]) => ({ op: "inArray", args }),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
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
    resolveAccess: (...args: unknown[]) => resolveAccessMock(...args),
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => getDbMock(),
  schema: {
    plans: { id: "plans.id", updatedAt: "plans.updatedAt" },
    planSections: { id: "planSections.id", planId: "planSections.planId" },
    planComments: { id: "planComments.id", planId: "planComments.planId" },
    planEvents: {},
  },
}));

vi.mock("../server/plan-content.js", () => ({
  normalizePlanContent: vi.fn(),
  serializePlanContent: vi.fn(),
}));

vi.mock("../server/plan-mdx.js", () => ({
  exportPlanContentToMdxFolder: vi.fn(),
}));

vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(),
}));

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyPlanCommentRecipients: (...args: unknown[]) =>
    notifyPlanCommentRecipientsMock(...args),
}));

// Use the real plans.js EXCEPT the DB-touching loadPlanBundle / assertPlanEditor.
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
    nowIso: vi.fn(() => "2026-06-05T00:00:00.000Z"),
  };
});

const { default: updateVisualPlan } = await import("./update-visual-plan.js");

type CapturedRow = {
  id: string;
  authorEmail: string | null;
  authorName: string | null;
  parentCommentId: string | null;
  message: string;
  createdBy: string;
};

function buildTransactionDb(capturedRows: CapturedRow[]) {
  const txInsert = vi.fn((table: unknown) => ({
    values: vi.fn(async (row: CapturedRow) => {
      // Only capture comment-shaped rows (have authorEmail field).
      if (row && Object.prototype.hasOwnProperty.call(row, "authorEmail")) {
        capturedRows.push(row);
      }
    }),
  }));
  const txUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "plan_1" }]),
      })),
    })),
  }));
  const txSelect = vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(async () => []) })),
  }));
  return {
    transaction: vi.fn(async (cb) =>
      cb({ insert: txInsert, update: txUpdate, select: txSelect }),
    ),
    insert: txInsert,
    update: txUpdate,
    // top-level select used to detect existing comments-by-id before tx
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => []) })),
    })),
  };
}

beforeEach(() => {
  request.email = undefined;
  request.name = undefined;
  assertPlanEditorMock.mockReset();
  assertPlanEditorMock.mockResolvedValue(undefined);
  getDbMock.mockReset();
  loadPlanBundleMock.mockReset();
  notifyPlanCommentRecipientsMock.mockReset();
  notifyPlanCommentRecipientsMock.mockResolvedValue(undefined);
  resolveAccessMock.mockReset();
  resolveAccessMock.mockResolvedValue({ resource: { id: "plan_1" } });
  delete process.env.AUTH_MODE;
  delete process.env.PLAN_LOCAL_MODE;
});

afterEach(() => {
  if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = originalAuthMode;
  if (originalPlanLocalMode === undefined) delete process.env.PLAN_LOCAL_MODE;
  else process.env.PLAN_LOCAL_MODE = originalPlanLocalMode;
});

function run(args: Record<string, unknown>) {
  return (updateVisualPlan as { run: (a: unknown) => Promise<unknown> }).run(
    args,
  );
}

const baseBundle = {
  plan: { id: "plan_1", title: "Plan", brief: "", content: null },
  sections: [],
  comments: [],
  events: [],
};

describe("update-visual-plan comment path (integration)", () => {
  it("stamps the authenticated reviewer email onto a human comment and ignores a spoofed authorEmail", async () => {
    request.email = "reviewer@example.com";
    request.name = "Reviewer";
    const captured: CapturedRow[] = [];
    getDbMock.mockReturnValue(buildTransactionDb(captured));
    loadPlanBundleMock.mockResolvedValue(baseBundle);

    await run({
      planId: "plan_1",
      contentPatches: [],
      sections: [],
      consumedCommentIds: [],
      comments: [
        {
          message: "Please change the CTA copy.",
          kind: "comment",
          status: "open",
          createdBy: "human",
          authorEmail: "ceo@bigcorp.example", // spoof attempt
          authorName: "The CEO",
        },
      ],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].authorEmail).toBe("reviewer@example.com");
    expect(captured[0].authorName).toBe("Reviewer");
    // Comment-only request must NOT require editor access, only resolveAccess.
    expect(assertPlanEditorMock).not.toHaveBeenCalled();
    expect(resolveAccessMock).toHaveBeenCalledWith("plan", "plan_1");
  });

  it("notifies recipients with the inserted ids and prior comments after a comment insert", async () => {
    request.email = "reviewer@example.com";
    const captured: CapturedRow[] = [];
    getDbMock.mockReturnValue(buildTransactionDb(captured));
    // commentsBeforeInserts is loaded via loadPlanBundle when there are pending
    // inserts; then the final bundle is loaded again.
    loadPlanBundleMock.mockResolvedValue({
      ...baseBundle,
      comments: [
        {
          id: "existing_root",
          planId: "plan_1",
          parentCommentId: null,
          sectionId: null,
          kind: "comment",
          status: "open",
          anchor: null,
          message: "root",
          createdBy: "human",
          authorEmail: "owner@example.com",
          authorName: "Owner",
          consumedAt: null,
          createdAt: "2026-06-05T00:00:00.000Z",
          updatedAt: "2026-06-05T00:00:00.000Z",
        },
      ],
    });

    await run({
      planId: "plan_1",
      contentPatches: [],
      sections: [],
      consumedCommentIds: [],
      comments: [
        {
          parentCommentId: "existing_root",
          message: "Replying inline.",
          kind: "comment",
          status: "open",
          createdBy: "human",
        },
      ],
    });

    expect(notifyPlanCommentRecipientsMock).toHaveBeenCalledTimes(1);
    const arg = notifyPlanCommentRecipientsMock.mock.calls[0][0] as {
      insertedCommentIds: string[];
      priorComments: Array<{ id: string }>;
    };
    // Exactly one new comment was inserted (id is generated), and it matches
    // the row captured by the transaction.
    expect(arg.insertedCommentIds).toHaveLength(1);
    expect(arg.insertedCommentIds[0]).toBe(captured[0].id);
    expect(arg.priorComments.map((c) => c.id)).toEqual(["existing_root"]);
    // The reply inherits the existing root as its parent.
    expect(captured[0].parentCommentId).toBe("existing_root");
  });

  it("rejects a comment-only reply to a non-existent parent before any DB write", async () => {
    request.email = "reviewer@example.com";
    const captured: CapturedRow[] = [];
    getDbMock.mockReturnValue(buildTransactionDb(captured));
    loadPlanBundleMock.mockResolvedValue(baseBundle);

    await expect(
      run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            parentCommentId: "ghost_parent",
            message: "reply to nothing",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
      }),
    ).rejects.toThrow(
      "Parent comment ghost_parent was not found on plan plan_1.",
    );
    expect(captured).toHaveLength(0);
    expect(notifyPlanCommentRecipientsMock).not.toHaveBeenCalled();
  });

  it("does not let an anonymous public-link viewer comment", async () => {
    request.email =
      "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local";

    await expect(
      run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            message: "Sneaky public comment",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("requires editor access (not just view) when a comment is created as the agent", async () => {
    request.email = "reviewer@example.com";
    assertPlanEditorMock.mockRejectedValueOnce(new Error("editor gate"));
    getDbMock.mockReturnValue(buildTransactionDb([]));
    loadPlanBundleMock.mockResolvedValue(baseBundle);

    await expect(
      run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            message: "Agent-authored note",
            kind: "comment",
            status: "open",
            createdBy: "agent",
          },
        ],
      }),
    ).rejects.toThrow("editor gate");
    // createdBy:"agent" means it's NOT onlyAddsNewComments -> editor gate.
    expect(assertPlanEditorMock).toHaveBeenCalledWith("plan_1");
  });
});
