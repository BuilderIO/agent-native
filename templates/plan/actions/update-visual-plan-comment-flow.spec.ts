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
const exportPlanContentToMdxFolderMock = vi.hoisted(() =>
  vi.fn(async () => ({ "plan.mdx": "# Plan" })),
);
const getDbMock = vi.hoisted(() => vi.fn());
const loadPlanBundleMock = vi.hoisted(() => vi.fn());
const notifyPlanCommentRecipientsMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());
const createPlanVersionSnapshotMock = vi.hoisted(() => vi.fn());
const originalAuthMode = process.env.AUTH_MODE;
const originalPlanLocalMode = process.env.PLAN_LOCAL_MODE;

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
      sectionId: "planComments.sectionId",
      kind: "planComments.kind",
      anchor: "planComments.anchor",
      message: "planComments.message",
      createdBy: "planComments.createdBy",
      authorEmail: "planComments.authorEmail",
      resolutionTarget: "planComments.resolutionTarget",
      mentionsJson: "planComments.mentionsJson",
      deletedAt: "planComments.deletedAt",
    },
    planEvents: {},
  },
}));

vi.mock("../server/plan-content.js", () => ({
  normalizePlanContent: vi.fn(),
  serializePlanContent: vi.fn(),
}));

vi.mock("../server/plan-mdx.js", () => ({
  exportPlanContentToMdxFolder: (...args: unknown[]) =>
    exportPlanContentToMdxFolderMock(...args),
  referencedBlockIdsForPlanComments: () => new Set<string>(),
}));

vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(),
}));

vi.mock("../server/lib/plan-versions.js", () => ({
  createPlanVersionSnapshot: (...args: unknown[]) =>
    createPlanVersionSnapshotMock(...args),
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

type CapturedCommentUpdate = {
  sectionId: string | null;
  kind: string;
  status: string;
  anchor: string | null;
  message: string;
  resolutionTarget: string | null;
  mentionsJson: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  updatedAt: string;
};

type ExistingCommentRow = {
  id: string;
  sectionId: string | null;
  kind: string;
  anchor: string | null;
  message: string;
  createdBy: string;
  authorEmail: string | null;
  resolutionTarget: string | null;
  mentionsJson: string | null;
};

function buildTransactionDb(
  capturedRows: CapturedRow[],
  capturedUpdates: CapturedCommentUpdate[] = [],
  existingComments: ExistingCommentRow[] = [],
) {
  const txInsert = vi.fn((table: unknown) => ({
    values: vi.fn(async (row: CapturedRow) => {
      // Only capture comment-shaped rows (have authorEmail field).
      if (row && Object.prototype.hasOwnProperty.call(row, "authorEmail")) {
        capturedRows.push(row);
      }
    }),
  }));
  const txUpdate = vi.fn(() => ({
    set: vi.fn((row: CapturedCommentUpdate) => {
      if (
        row &&
        Object.prototype.hasOwnProperty.call(row, "message") &&
        Object.prototype.hasOwnProperty.call(row, "status")
      ) {
        capturedUpdates.push(row);
      }
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "plan_1" }]),
        })),
      };
    }),
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
      from: vi.fn(() => ({ where: vi.fn(async () => existingComments) })),
    })),
  };
}

beforeEach(() => {
  request.email = undefined;
  request.name = undefined;
  assertPlanEditorMock.mockReset();
  assertPlanEditorMock.mockResolvedValue(undefined);
  exportPlanContentToMdxFolderMock.mockReset();
  exportPlanContentToMdxFolderMock.mockResolvedValue({ "plan.mdx": "# Plan" });
  getDbMock.mockReset();
  loadPlanBundleMock.mockReset();
  notifyPlanCommentRecipientsMock.mockReset();
  notifyPlanCommentRecipientsMock.mockResolvedValue(undefined);
  resolveAccessMock.mockReset();
  resolveAccessMock.mockResolvedValue({ resource: { id: "plan_1" } });
  createPlanVersionSnapshotMock.mockReset();
  createPlanVersionSnapshotMock.mockResolvedValue({ created: true });
  delete process.env.AUTH_MODE;
  process.env.PLAN_LOCAL_MODE = "0";
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
  access: {
    role: "owner",
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
  },
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
    expect(resolveAccessMock).toHaveBeenCalledWith(
      "plan",
      "plan_1",
      expect.objectContaining({ userEmail: "reviewer@example.com" }),
    );
  });

  it("lets a reviewer resolve an existing comment without changing its content fields", async () => {
    request.email = "reviewer@example.com";
    request.name = "Reviewer";
    const capturedRows: CapturedRow[] = [];
    const capturedUpdates: CapturedCommentUpdate[] = [];
    getDbMock.mockReturnValue(
      buildTransactionDb(capturedRows, capturedUpdates, [
        {
          id: "existing_root",
          sectionId: "sec_1",
          kind: "comment",
          anchor: JSON.stringify({ x: 20, y: 30, sectionTitle: "Mockup" }),
          message: "Original feedback",
          createdBy: "human",
          authorEmail: "owner@example.com",
          resolutionTarget: "agent",
          mentionsJson: JSON.stringify([]),
        },
      ]),
    );
    loadPlanBundleMock.mockResolvedValue(baseBundle);

    await run({
      planId: "plan_1",
      contentPatches: [],
      sections: [],
      consumedCommentIds: [],
      comments: [
        {
          id: "existing_root",
          message: "Original feedback",
          kind: "comment",
          status: "resolved",
          sectionId: "sec_1",
          anchor: JSON.stringify({ x: 20, y: 30, sectionTitle: "Mockup" }),
          createdBy: "human",
          authorEmail: "attacker@example.com",
          authorName: "Attacker",
          resolutionTarget: "agent",
          resolvedBy: "attacker@example.com",
          resolvedAt: "2030-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(assertPlanEditorMock).not.toHaveBeenCalled();
    expect(resolveAccessMock).toHaveBeenCalledWith(
      "plan",
      "plan_1",
      expect.objectContaining({ userEmail: "reviewer@example.com" }),
    );
    expect(capturedRows).toHaveLength(0);
    expect(capturedUpdates).toEqual([
      {
        sectionId: "sec_1",
        kind: "comment",
        status: "resolved",
        anchor: JSON.stringify({ x: 20, y: 30, sectionTitle: "Mockup" }),
        message: "Original feedback",
        resolutionTarget: "agent",
        mentionsJson: JSON.stringify([]),
        resolvedBy: "reviewer@example.com",
        resolvedAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:00.000Z",
      },
    ]);
  });

  it("rejects a status-only update when the target comment is missing", async () => {
    request.email = "reviewer@example.com";
    const capturedRows: CapturedRow[] = [];
    getDbMock.mockReturnValue(buildTransactionDb(capturedRows));
    loadPlanBundleMock.mockResolvedValue(baseBundle);

    await expect(
      run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            id: "ghost_comment",
            message: "Resolve a ghost",
            kind: "comment",
            status: "resolved",
            createdBy: "human",
          },
        ],
      }),
    ).rejects.toThrow("Comment status update target was not found.");
    expect(capturedRows).toHaveLength(0);
    expect(notifyPlanCommentRecipientsMock).not.toHaveBeenCalled();
  });

  it("keeps existing comment content edits behind the editor gate", async () => {
    request.email = "reviewer@example.com";
    assertPlanEditorMock.mockRejectedValueOnce(new Error("editor gate"));
    const capturedRows: CapturedRow[] = [];
    const capturedUpdates: CapturedCommentUpdate[] = [];
    getDbMock.mockReturnValue(
      buildTransactionDb(capturedRows, capturedUpdates, [
        {
          id: "existing_root",
          sectionId: null,
          kind: "comment",
          anchor: null,
          message: "Original feedback",
          createdBy: "human",
          authorEmail: "owner@example.com",
          resolutionTarget: "agent",
          mentionsJson: JSON.stringify([]),
        },
      ]),
    );
    loadPlanBundleMock.mockResolvedValue(baseBundle);

    await expect(
      run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            id: "existing_root",
            message: "Edited feedback",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
      }),
    ).rejects.toThrow("editor gate");
    expect(assertPlanEditorMock).toHaveBeenCalledWith("plan_1");
    expect(capturedRows).toHaveLength(0);
    expect(capturedUpdates).toHaveLength(0);
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

  it("inserts a new comment that carries a client-minted id (regression: was throwing)", async () => {
    request.email = "reviewer@example.com";
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
          id: "client_minted_abc123",
          message: "Inline text feedback",
          kind: "comment",
          status: "open",
          createdBy: "human",
        },
      ],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].message).toBe("Inline text feedback");
    expect(captured[0].authorEmail).toBe("reviewer@example.com");
    expect(assertPlanEditorMock).not.toHaveBeenCalled();
    expect(notifyPlanCommentRecipientsMock).toHaveBeenCalledTimes(1);
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

  // ── New tests covering remaining fixes ──────────────────────────────────────

  describe("mixed resolve+consume preserves anchor/resolutionTarget/mentionsJson", () => {
    it("keeps stored anchor, resolutionTarget, and mentionsJson when caller omits them in a combined resolve+consume request", async () => {
      request.email = "reviewer@example.com";
      const capturedRows: CapturedRow[] = [];
      const capturedUpdates: CapturedCommentUpdate[] = [];
      const storedAnchor = JSON.stringify({
        x: 10,
        y: 20,
        sectionTitle: "Spec",
      });
      const storedMentions = JSON.stringify(["agent@example.com"]);
      getDbMock.mockReturnValue(
        buildTransactionDb(capturedRows, capturedUpdates, [
          {
            id: "cmt_abc",
            sectionId: null,
            kind: "comment",
            anchor: storedAnchor,
            message: "Needs more detail",
            createdBy: "human",
            authorEmail: "author@example.com",
            resolutionTarget: "agent",
            mentionsJson: storedMentions,
          },
        ]),
      );
      loadPlanBundleMock.mockResolvedValue(baseBundle);

      // Caller passes only { id, status, message } — no anchor/resolutionTarget/mentions
      await run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: ["cmt_xyz"],
        comments: [
          {
            id: "cmt_abc",
            message: "Needs more detail",
            kind: "comment",
            status: "resolved",
            createdBy: "human",
          },
        ],
      });

      expect(capturedUpdates).toHaveLength(1);
      const updated = capturedUpdates[0];
      expect(updated.anchor).toBe(storedAnchor);
      expect(updated.resolutionTarget).toBe("agent");
      expect(updated.mentionsJson).toBe(storedMentions);
      expect(updated.status).toBe("resolved");
    });
  });

  describe("status demotion nulls approvedAt", () => {
    it("sets approvedAt:null when status is changed from approved to review", async () => {
      request.email = "editor@example.com";
      // Full plan-authoring call (status change), so we need the editor gate
      // and the plans UPDATE to fire; capture what `set()` receives.
      const planSetCalls: Record<string, unknown>[] = [];
      const txUpdate = vi.fn(() => ({
        set: vi.fn((row: Record<string, unknown>) => {
          planSetCalls.push(row);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "plan_1" }]),
            })),
          };
        }),
      }));
      const txInsert = vi.fn(() => ({
        values: vi.fn(async () => undefined),
      }));
      const txSelect = vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      }));
      const transactionMock = vi.fn(async (cb) =>
        cb({ insert: txInsert, update: txUpdate, select: txSelect }),
      );
      getDbMock.mockReturnValue({
        transaction: transactionMock,
        insert: txInsert,
        update: txUpdate,
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: vi.fn(async () => []) })),
        })),
      });
      loadPlanBundleMock.mockResolvedValue({
        ...baseBundle,
        plan: {
          ...baseBundle.plan,
          updatedAt: "2026-01-01T00:00:00.000Z",
          approvedAt: "2026-01-02T00:00:00.000Z",
          status: "approved",
        },
      });

      await run({
        planId: "plan_1",
        status: "review",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [],
      });

      // planPatch must include approvedAt:null when status != "approved"
      const planUpdate = planSetCalls.find(
        (row) =>
          !Object.prototype.hasOwnProperty.call(row, "message") &&
          Object.prototype.hasOwnProperty.call(row, "status"),
      );
      expect(planUpdate).toBeDefined();
      expect(planUpdate!.status).toBe("review");
      expect(planUpdate!.approvedAt).toBeNull();
    });
  });

  describe("cross-plan comment id safety", () => {
    it("does not update another plan's comment when the id exists only on a different plan", async () => {
      request.email = "reviewer@example.com";
      const capturedRows: CapturedRow[] = [];
      const capturedUpdates: CapturedCommentUpdate[] = [];
      // The SELECT returns nothing (the id+planId pair does not match), so the
      // comment is treated as a new insert — not an update to the other plan.
      getDbMock.mockReturnValue(
        buildTransactionDb(capturedRows, capturedUpdates, [
          // Empty: comment "other_plan_cmt" exists on plan_OTHER, not plan_1.
          // The mock SELECT always uses the existingComments array for all queries,
          // so returning an empty array simulates the planId mismatch.
        ]),
      );
      loadPlanBundleMock.mockResolvedValue(baseBundle);

      // Ask to resolve a comment that belongs to a different plan.
      // Because the SELECT (scoped to plan_1) finds nothing, the comment goes
      // into pendingCommentInserts (status:"resolved" → treated as a resolve
      // of a missing comment) → should throw the missing-target error.
      await expect(
        run({
          planId: "plan_1",
          contentPatches: [],
          sections: [],
          consumedCommentIds: [],
          comments: [
            {
              id: "other_plan_cmt",
              message: "Fix the design",
              kind: "comment",
              status: "resolved",
              createdBy: "human",
            },
          ],
        }),
      ).rejects.toThrow("Comment status update target was not found.");

      // The comment from the other plan must never appear in captured updates.
      expect(capturedUpdates).toHaveLength(0);
    });
  });

  describe("sectionId validation for new comments", () => {
    it("rejects a new comment that references a sectionId not on the target plan", async () => {
      request.email = "reviewer@example.com";
      const captured: CapturedRow[] = [];
      getDbMock.mockReturnValue(buildTransactionDb(captured));
      // Bundle with one known section.
      loadPlanBundleMock.mockResolvedValue({
        ...baseBundle,
        sections: [{ id: "sec_real", title: "Overview", type: "custom" }],
      });

      await expect(
        run({
          planId: "plan_1",
          contentPatches: [],
          sections: [],
          consumedCommentIds: [],
          comments: [
            {
              sectionId: "sec_bogus",
              message: "Comment on a nonexistent section",
              kind: "comment",
              status: "open",
              createdBy: "human",
            },
          ],
        }),
      ).rejects.toThrow("Section sec_bogus was not found on plan plan_1.");

      expect(captured).toHaveLength(0);
      expect(notifyPlanCommentRecipientsMock).not.toHaveBeenCalled();
    });

    it("allows a new comment referencing a valid sectionId on the plan", async () => {
      request.email = "reviewer@example.com";
      const captured: CapturedRow[] = [];
      getDbMock.mockReturnValue(buildTransactionDb(captured));
      loadPlanBundleMock.mockResolvedValue({
        ...baseBundle,
        sections: [{ id: "sec_real", title: "Overview", type: "custom" }],
      });

      await run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            sectionId: "sec_real",
            message: "Comment on the real section",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].message).toBe("Comment on the real section");
    });
  });

  describe("comment-only update does not bump plans.updatedAt", () => {
    it("skips the plans UPDATE when the request has only new comments", async () => {
      request.email = "reviewer@example.com";
      const capturedRows: CapturedRow[] = [];
      const planUpdateCalls: unknown[] = [];

      // Custom txUpdate that tracks calls AND distinguishes plan vs comment updates.
      const txUpdate = vi.fn((table: unknown) => {
        return {
          set: vi.fn((row: Record<string, unknown>) => {
            // Identify a plan-row update by checking it targets schema.plans.
            if (
              table === "plans.id" ||
              JSON.stringify(table).includes("plans")
            ) {
              planUpdateCalls.push(row);
            }
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: "plan_1" }]),
              })),
            };
          }),
        };
      });
      const txInsert = vi.fn(() => ({
        values: vi.fn(async (row: CapturedRow) => {
          if (row && Object.prototype.hasOwnProperty.call(row, "authorEmail")) {
            capturedRows.push(row);
          }
        }),
      }));
      const txSelect = vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      }));
      const transactionMock = vi.fn(async (cb) =>
        cb({ insert: txInsert, update: txUpdate, select: txSelect }),
      );
      getDbMock.mockReturnValue({
        transaction: transactionMock,
        insert: txInsert,
        update: txUpdate,
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: vi.fn(async () => []) })),
        })),
      });

      const planUpdatedAt = "2026-05-01T00:00:00.000Z";
      loadPlanBundleMock.mockResolvedValue({
        ...baseBundle,
        plan: { ...baseBundle.plan, updatedAt: planUpdatedAt },
      });

      await run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            message: "Just a reviewer comment",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
      });

      // The plans row must NOT have been updated.
      expect(planUpdateCalls).toHaveLength(0);
      // But the comment must have been inserted.
      expect(capturedRows).toHaveLength(1);
    });

    it("allows a subsequent contentPatches call using the pre-comment updatedAt to succeed (no false conflict)", async () => {
      // This simulates an agent that:
      //  1. reads plan (updatedAt = T0)
      //  2. a reviewer comments (comment-only → updatedAt stays T0)
      //  3. agent applies contentPatches with versionAtLoad=T0 → should succeed
      request.email = "editor@example.com";
      const planUpdatedAt = "2026-05-01T00:00:00.000Z";

      // Step 1: reviewer comment-only call (no authoring changes).
      const commentDb = buildTransactionDb([], [], []);
      getDbMock.mockReturnValue(commentDb);
      loadPlanBundleMock.mockResolvedValue({
        ...baseBundle,
        plan: { ...baseBundle.plan, updatedAt: planUpdatedAt },
      });
      await run({
        planId: "plan_1",
        contentPatches: [],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            message: "Reviewer note",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
      });

      // After the comment-only call, the plan updatedAt is still planUpdatedAt
      // because the plans UPDATE was skipped. Now the agent's contentPatches
      // call should succeed.
      const planPatches_updateReturnedPlan = vi.fn(async () => [
        { id: "plan_1" },
      ]);
      const txUpdate2 = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: planPatches_updateReturnedPlan,
          })),
        })),
      }));
      const txInsert2 = vi.fn(() => ({
        values: vi.fn(async () => undefined),
      }));
      const txSelect2 = vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      }));
      const transactionMock2 = vi.fn(async (cb) =>
        cb({ insert: txInsert2, update: txUpdate2, select: txSelect2 }),
      );
      getDbMock.mockReturnValue({
        transaction: transactionMock2,
        insert: txInsert2,
        update: txUpdate2,
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: vi.fn(async () => []) })),
        })),
      });
      const planContent = { version: 2, title: "Plan", brief: "", blocks: [] };
      loadPlanBundleMock.mockResolvedValue({
        ...baseBundle,
        plan: {
          ...baseBundle.plan,
          updatedAt: planUpdatedAt,
          // content is needed for contentPatches
          content: planContent,
        },
      });

      // Agent's contentPatches with versionAtLoad = planUpdatedAt should succeed
      // (returning a non-empty rows array = no conflict).
      await expect(
        run({
          planId: "plan_1",
          contentPatches: [
            {
              op: "append-block",
              block: {
                id: "block_new",
                type: "rich-text",
                data: { markdown: "New block" },
              },
            },
          ],
          sections: [],
          consumedCommentIds: [],
          comments: [],
        }),
      ).resolves.toBeDefined();

      // The plans UPDATE was called and returned a row → no conflict error.
      expect(planPatches_updateReturnedPlan).toHaveBeenCalled();
    });
  });
});
