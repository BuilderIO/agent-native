import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  email: undefined as string | undefined,
}));
const assertPlanEditorMock = vi.hoisted(() => vi.fn());
const buildUpdatedPlanCommentRowsMock = vi.hoisted(() => vi.fn(() => []));
const getDbMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("DB should not be reached for synthetic commenter rejects");
  }),
);
const loadPlanBundleMock = vi.hoisted(() => vi.fn());
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
    },
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
    getDbMock.mockReset();
    getDbMock.mockImplementation(() => {
      throw new Error(
        "DB should not be reached for synthetic commenter rejects",
      );
    });
    loadPlanBundleMock.mockReset();
    loadPlanBundleMock.mockResolvedValue({ comments: [] });
    resolveAccessMock.mockReset();
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

  it("requires editor access when a comment-only request includes an activity note", async () => {
    request.email = "reviewer@example.com";
    assertPlanEditorMock.mockRejectedValueOnce(
      new Error("editor gate reached"),
    );

    await expect(
      (updateVisualPlan as { run: (args: unknown) => Promise<unknown> }).run({
        ...commentOnlyArgs,
        note: "Updated plan settings",
      }),
    ).rejects.toThrow("editor gate reached");
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
});
