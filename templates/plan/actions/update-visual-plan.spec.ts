import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  email: undefined as string | undefined,
}));
const resolveAccessMock = vi.hoisted(() => vi.fn());

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
  getDb: () => {
    throw new Error("DB should not be reached for synthetic commenter rejects");
  },
  schema: {},
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
    assertPlanEditor: vi.fn(),
    buildPlanHtml: vi.fn(),
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
    loadPlanBundle: vi.fn(),
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
    resolveAccessMock.mockReset();
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
});
