import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  email: undefined as string | undefined,
}));
const assertPlanEditorMock = vi.hoisted(() => vi.fn());
const buildUpdatedPlanCommentRowsMock = vi.hoisted(() => vi.fn(() => []));
const exportPlanContentToMdxFolderMock = vi.hoisted(() =>
  vi.fn(async () => ({ "plan.mdx": "# Plan" })),
);
const getDbMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("DB should not be reached for synthetic commenter rejects");
  }),
);
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
}));

vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  defineAction: (options: unknown) => options,
  embedApp: vi.fn(() => ({ title: "stub" })),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => request.email,
  getRequestUserName: () => undefined,
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
    plans: {
      id: "plans.id",
      updatedAt: "plans.updatedAt",
    },
    planSections: {
      id: "planSections.id",
      planId: "planSections.planId",
    },
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

vi.mock("../server/plans.js", async () => {
  const { z } = await import("zod");

  return {
    assertPlanEditor: (...args: unknown[]) => assertPlanEditorMock(...args),
    buildPlanHtml: vi.fn(),
    buildUpdatedPlanCommentRows: (...args: unknown[]) =>
      buildUpdatedPlanCommentRowsMock(...args),
    commentInputSchema: z.object({
      id: z.string().optional(),
      parentCommentId: z.string().optional(),
      sectionId: z.string().optional(),
      kind: z.string().optional().default("comment"),
      status: z.string().optional().default("open"),
      anchor: z.string().optional(),
      message: z.string().min(1),
      createdBy: z.string().optional().default("human"),
      authorEmail: z.string().optional(),
      authorName: z.string().optional(),
    }),
    loadPlanBundle: (...args: unknown[]) => loadPlanBundleMock(...args),
    newId: vi.fn((prefix: string) => `${prefix}_test`),
    nowIso: vi.fn(() => "2026-06-05T00:00:00.000Z"),
    planPath: vi.fn((id: string) => `/plans/${id}`),
    planStatusSchema: z.enum(["review", "approved", "archived"]),
    sectionInputSchema: z.object({
      id: z.string().optional(),
      type: z.string().optional().default("custom"),
      title: z.string(),
      body: z.string().optional().default(""),
      html: z.string().optional(),
      order: z.number().optional(),
      createdBy: z.string().optional().default("agent"),
    }),
    emitPlanCommented: vi.fn(),
    emitPlanStatusChanged: vi.fn(),
    writeEvent: vi.fn(),
  };
});

const { default: updateVisualPlan } = await import("./update-visual-plan.js");

const commentOnlyArgs = {
  planId: "plan_public",
  contentPatches: [],
  sections: [],
  comments: [
    {
      message: "Please clarify this part.",
      kind: "comment",
      status: "open",
      createdBy: "human",
    },
  ],
  consumedCommentIds: [],
};

describe("update-visual-plan comments", () => {
  beforeEach(() => {
    request.email = undefined;
    assertPlanEditorMock.mockReset();
    assertPlanEditorMock.mockResolvedValue(undefined);
    buildUpdatedPlanCommentRowsMock.mockReset();
    buildUpdatedPlanCommentRowsMock.mockReturnValue([]);
    exportPlanContentToMdxFolderMock.mockReset();
    exportPlanContentToMdxFolderMock.mockResolvedValue({
      "plan.mdx": "# Plan",
    });
    getDbMock.mockReset();
    getDbMock.mockImplementation(() => {
      throw new Error(
        "DB should not be reached for synthetic commenter rejects",
      );
    });
    loadPlanBundleMock.mockReset();
    loadPlanBundleMock.mockResolvedValue({ comments: [] });
    notifyPlanCommentRecipientsMock.mockReset();
    notifyPlanCommentRecipientsMock.mockResolvedValue(undefined);
    resolveAccessMock.mockReset();
    createPlanVersionSnapshotMock.mockReset();
    createPlanVersionSnapshotMock.mockResolvedValue({ created: true });
    delete process.env.AUTH_MODE;
    delete process.env.PLAN_LOCAL_MODE;
  });

  afterEach(() => {
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
    if (originalPlanLocalMode === undefined) delete process.env.PLAN_LOCAL_MODE;
    else process.env.PLAN_LOCAL_MODE = originalPlanLocalMode;
  });

  it("returns a user-facing 403 when a public-link viewer tries to comment", async () => {
    request.email =
      "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local";

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run(
        commentOnlyArgs,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Commenting on a plan requires an agent-native account. Sign in to leave a comment.",
    });
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("returns a user-facing 403 when a hosted guest author tries to comment", async () => {
    request.email =
      "guest-123e4567-e89b-12d3-a456-426614174000@agent-native.guest";

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run(
        commentOnlyArgs,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Commenting requires an account. Sign in to comment.",
    });
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("returns a user-facing 403 when hosted comments have no request identity", async () => {
    process.env.AUTH_MODE = "hosted";

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run(
        commentOnlyArgs,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Commenting on a plan requires an agent-native account. Sign in to leave a comment.",
    });
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("allows comment-only requests with a client note without using it as the activity message", async () => {
    request.email = "reviewer@example.com";
    resolveAccessMock.mockResolvedValueOnce({ resource: {} });
    const txUpdateMock = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "plan_public" }]),
        })),
      })),
    }));
    const txInsertValuesMock = vi.fn(async () => undefined);
    const txInsertMock = vi.fn(() => ({
      values: txInsertValuesMock,
    }));
    const transactionMock = vi.fn(async (callback) =>
      callback({
        update: txUpdateMock,
        insert: txInsertMock,
        select: vi.fn(),
      }),
    );
    getDbMock.mockReturnValue({
      transaction: transactionMock,
      update: txUpdateMock,
      insert: txInsertMock,
      select: vi.fn(),
    });
    loadPlanBundleMock.mockResolvedValue({
      plan: {
        id: "plan_public",
        title: "Plan",
        brief: "",
        content: null,
      },
      sections: [],
      comments: [],
      events: [],
    });

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run({
        ...commentOnlyArgs,
        note: "Human added inline visual plan feedback.",
      }),
    ).resolves.toMatchObject({ planId: "plan_public" });
    expect(assertPlanEditorMock).not.toHaveBeenCalled();
    expect(resolveAccessMock).toHaveBeenCalledWith(
      "plan",
      "plan_public",
      expect.objectContaining({ userEmail: "local@agent-native.local" }),
    );
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plan.updated",
        message: "Updated 0 section(s), 1 comment(s).",
        createdBy: "human",
      }),
    );
  });

  it("allows authenticated reviewers to add comment-backed canvas markup without editor access", async () => {
    request.email = "reviewer@example.com";
    resolveAccessMock.mockResolvedValueOnce({ resource: {} });
    buildUpdatedPlanCommentRowsMock.mockReturnValueOnce([
      {
        id: "comment_test",
        planId: "plan_public",
        parentCommentId: null,
        sectionId: null,
        kind: "annotation",
        status: "open",
        anchor: JSON.stringify({ planAnnotationId: "mark_1" }),
        message: "Drawn note",
        createdBy: "human",
        authorEmail: "reviewer@example.com",
        authorName: null,
        resolutionTarget: "agent",
        mentionsJson: null,
        resolvedBy: null,
        resolvedAt: null,
        consumedAt: null,
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:00.000Z",
      },
    ]);
    const txUpdateSetMock = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "plan_public" }]),
      })),
    }));
    const txUpdateMock = vi.fn(() => ({
      set: txUpdateSetMock,
    }));
    const txInsertValuesMock = vi.fn(async () => undefined);
    const txInsertMock = vi.fn(() => ({
      values: txInsertValuesMock,
    }));
    getDbMock.mockReturnValue({
      update: txUpdateMock,
      insert: txInsertMock,
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      })),
    });
    loadPlanBundleMock.mockResolvedValue({
      plan: {
        id: "plan_public",
        title: "Plan",
        brief: "",
        updatedAt: "2026-06-05T00:00:00.000Z",
        content: {
          version: 2,
          title: "Plan",
          brief: "",
          blocks: [],
          canvas: {
            title: "Review canvas",
            frames: [],
            annotations: [],
          },
        },
      },
      access: {
        role: "owner",
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "private",
      },
      sections: [],
      comments: [],
      events: [],
    });

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run({
        planId: "plan_public",
        contentPatches: [
          {
            op: "append-canvas-annotation",
            annotation: {
              id: "mark_1",
              type: "text",
              text: "Drawn note",
              x: 120,
              y: 90,
            },
          },
        ],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            message: "Drawn note",
            kind: "annotation",
            status: "open",
            createdBy: "human",
            anchor: JSON.stringify({ planAnnotationId: "mark_1" }),
          },
        ],
      }),
    ).resolves.toMatchObject({ planId: "plan_public" });

    expect(assertPlanEditorMock).not.toHaveBeenCalled();
    expect(resolveAccessMock).toHaveBeenCalledWith(
      "plan",
      "plan_public",
      expect.objectContaining({ userEmail: "local@agent-native.local" }),
    );
    expect(txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: "2026-06-05T00:00:00.000Z",
      }),
    );
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "comment_test",
        kind: "annotation",
      }),
    );
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_test",
        type: "plan.updated",
        createdBy: "human",
      }),
    );
  });

  it("keeps arbitrary reviewer content patches behind the editor gate", async () => {
    request.email = "reviewer@example.com";
    assertPlanEditorMock.mockRejectedValueOnce(new Error("editor required"));

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run({
        planId: "plan_public",
        contentPatches: [
          {
            op: "update-rich-text",
            blockId: "intro",
            markdown: "Reviewer edit",
          },
        ],
        sections: [],
        consumedCommentIds: [],
        comments: [
          {
            message: "Reviewer edit",
            kind: "annotation",
            status: "open",
            createdBy: "human",
            anchor: JSON.stringify({ planAnnotationId: "mark_1" }),
          },
        ],
      }),
    ).rejects.toThrow("editor required");

    expect(assertPlanEditorMock).toHaveBeenCalledWith("plan_public");
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("validates new threaded comments before persisting plan changes", async () => {
    request.email = "editor@example.com";
    const dbUpdateMock = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "plan_public" }]),
        })),
      })),
    }));
    const dbInsertMock = vi.fn(() => ({
      values: vi.fn(async () => undefined),
    }));
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
      update: dbUpdateMock,
      insert: dbInsertMock,
    });
    loadPlanBundleMock.mockResolvedValue({ comments: [] });
    buildUpdatedPlanCommentRowsMock.mockImplementationOnce(() => {
      throw new Error("Parent comment missing_parent was not found.");
    });

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run({
        ...commentOnlyArgs,
        title: "Edited title",
        comments: [
          {
            id: "reply_1",
            parentCommentId: "missing_parent",
            message: "Replying to a missing parent.",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
      }),
    ).rejects.toThrow("Parent comment missing_parent was not found.");

    expect(buildUpdatedPlanCommentRowsMock).toHaveBeenCalled();
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("persists plan updates and activity events through the guarded write path", async () => {
    request.email = "editor@example.com";
    const dbUpdateMock = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "plan_public" }]),
        })),
      })),
    }));
    const dbInsertValuesMock = vi.fn(async () => undefined);
    const dbInsertMock = vi.fn(() => ({
      values: dbInsertValuesMock,
    }));
    getDbMock.mockReturnValue({
      update: dbUpdateMock,
      insert: dbInsertMock,
      select: vi.fn(),
    });
    loadPlanBundleMock.mockResolvedValue({
      plan: {
        id: "plan_public",
        title: "Edited title",
        brief: "",
        content: null,
      },
      sections: [],
      comments: [],
      events: [],
    });

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run({
        planId: "plan_public",
        title: "Edited title",
        contentPatches: [],
        sections: [],
        comments: [],
        consumedCommentIds: [],
      }),
    ).resolves.toMatchObject({ planId: "plan_public" });

    expect(createPlanVersionSnapshotMock).toHaveBeenCalledWith("plan_public", {
      force: true,
      label: "Before plan update",
      createdBy: "agent",
    });
    expect(dbUpdateMock).toHaveBeenCalled();
    expect(dbInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_test",
        planId: "plan_public",
        type: "plan.updated",
        message: "Updated 0 section(s), 0 comment(s).",
        createdBy: "agent",
      }),
    );
  });

  it("records compact before/after details for targeted content patches", async () => {
    request.email = "editor@example.com";
    const txUpdateMock = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "plan_public" }]),
        })),
      })),
    }));
    const txInsertValuesMock = vi.fn(async () => undefined);
    const txInsertMock = vi.fn(() => ({
      values: txInsertValuesMock,
    }));
    const transactionMock = vi.fn(async (callback) =>
      callback({
        update: txUpdateMock,
        insert: txInsertMock,
        select: vi.fn(),
      }),
    );
    getDbMock.mockReturnValue({
      transaction: transactionMock,
      update: txUpdateMock,
      insert: txInsertMock,
      select: vi.fn(),
    });
    loadPlanBundleMock.mockResolvedValue({
      plan: {
        id: "plan_public",
        title: "Edited title",
        brief: "",
        updatedAt: "2026-06-05T00:00:00.000Z",
        content: {
          version: 2,
          title: "Commenting UX",
          brief: "Make review precise.",
          blocks: [
            {
              id: "intro",
              type: "rich-text",
              title: "Intro",
              data: { markdown: "Old intro copy." },
            },
            {
              id: "wire",
              type: "wireframe",
              title: "Composer",
              data: {
                surface: "desktop",
                html: "<button>Old CTA</button>",
              },
            },
          ],
        },
      },
      sections: [],
      comments: [],
      events: [],
    });

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run({
        planId: "plan_public",
        contentPatches: [
          {
            op: "update-rich-text",
            blockId: "intro",
            markdown: "New intro copy.",
          },
          {
            op: "patch-wireframe-html",
            blockId: "wire",
            edits: [{ find: "Old CTA", replace: "New CTA" }],
          },
        ],
        markdown: "",
        sections: [],
        comments: [],
        consumedCommentIds: [],
      }),
    ).resolves.toMatchObject({ planId: "plan_public" });

    const eventRow = txInsertValuesMock.mock.calls
      .map((call) => call[0] as { type?: string; payload?: string })
      .find((row) => row.type === "plan.updated");
    const payload = JSON.parse(eventRow?.payload ?? "{}") as {
      contentPatchDetails?: Array<{
        op: string;
        targetId: string;
        before?: { excerpt?: string } | null;
        after?: { excerpt?: string } | null;
        patch?: unknown;
      }>;
    };

    expect(payload.contentPatchDetails).toEqual([
      expect.objectContaining({
        op: "update-rich-text",
        targetId: "intro",
        before: expect.objectContaining({ excerpt: "Old intro copy." }),
        after: expect.objectContaining({ excerpt: "New intro copy." }),
      }),
      expect.objectContaining({
        op: "patch-wireframe-html",
        targetId: "wire",
        before: expect.objectContaining({
          excerpt: "<button>Old CTA</button>",
        }),
        after: expect.objectContaining({ excerpt: "<button>New CTA</button>" }),
        patch: expect.objectContaining({ editCount: 1 }),
      }),
    ]);
  });
});
