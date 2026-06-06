import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  email: "author@example.com",
  name: "Author",
  orgId: "org_test",
}));

const dbInserts = vi.hoisted(
  () =>
    [] as Array<{
      table: unknown;
      values: unknown;
    }>,
);

const schemaMock = vi.hoisted(() => ({
  plans: { name: "plans" },
  planSections: { name: "plan_sections" },
  planComments: { name: "plan_comments" },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
  embedApp: (options: unknown) => options,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => request.orgId,
  getRequestUserEmail: () => request.email,
  getRequestUserName: () => request.name,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        dbInserts.push({ table, values });
      },
    }),
  }),
  schema: schemaMock,
}));

vi.mock("../server/plan-content.js", () => ({
  createPlanContentFromSections: vi.fn(() => ({ version: 2, blocks: [] })),
  normalizePlanContent: vi.fn((content: unknown) => content),
  serializePlanContent: vi.fn((content: unknown) => JSON.stringify(content)),
}));

vi.mock("../server/lib/local-identity.js", () => ({
  isLocalPlanRuntime: () => false,
  requirePlanOwnerEmailForWrite: (email: string | undefined) => {
    if (!email)
      throw new Error("Creating a visual plan requires an authenticated user.");
    return email;
  },
}));

vi.mock("../server/lib/guest-abuse.js", () => ({
  assertGuestCreateWithinLimits: vi.fn(),
}));

vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(),
}));

vi.mock("../server/plans.js", async () => {
  const { z } = await import("zod");

  return {
    buildPlanHtml: vi.fn(() => "<html></html>"),
    commentInputSchema: z.object({
      id: z.string().optional(),
      parentCommentId: z.string().optional(),
      sectionId: z.string().optional(),
      kind: z.string().optional().default("comment"),
      status: z.string().optional().default("open"),
      anchor: z.string().optional(),
      message: z.string(),
      createdBy: z.string().optional().default("human"),
      authorEmail: z.string().optional(),
      authorName: z.string().optional(),
    }),
    loadPlanBundle: vi.fn((planId: string) => ({
      plan: {
        id: planId,
        title: "Threaded seed plan",
        brief: "Check threaded comments",
        status: "review",
        source: "manual",
        repoPath: null,
        currentFocus: "visual review",
        hostedPlanId: null,
        hostedPlanUrl: null,
        html: null,
        markdown: null,
        content: null,
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:00.000Z",
        approvedAt: null,
      },
      sections: [],
      comments: [],
      events: [],
      summary: { sectionCounts: {}, commentCount: 0, openCommentCount: 0 },
    })),
    newId: vi.fn((prefix: string) => `${prefix}_generated`),
    nowIso: vi.fn(() => "2026-06-05T00:00:00.000Z"),
    planDeepLink: vi.fn((id: string) => `/plans/${id}`),
    planPath: vi.fn((id: string) => `/plans/${id}`),
    planSourceSchema: z.enum(["manual"]),
    planStatusSchema: z.enum(["review"]),
    resolveCommentAuthor: vi.fn(
      (input: {
        authorEmail?: string;
        authorName?: string;
        requestEmail?: string;
        requestName?: string;
      }) => ({
        authorEmail: input.requestEmail ?? input.authorEmail ?? null,
        authorName: input.requestName ?? input.authorName ?? null,
      }),
    ),
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

vi.mock("../shared/plan-content.js", async () => {
  const { z } = await import("zod");
  return {
    planContentSchema: z.object({}).passthrough(),
  };
});

const { default: createVisualPlan } = await import("./create-visual-plan.js");

describe("create-visual-plan comments", () => {
  beforeEach(() => {
    dbInserts.length = 0;
  });

  it("keeps seeded replies attached to their parent comment", async () => {
    await (
      createVisualPlan as { run: (args: unknown) => Promise<unknown> }
    ).run({
      title: "Threaded seed plan",
      brief: "Check threaded comments",
      source: "manual",
      status: "review",
      sections: [],
      comments: [
        {
          id: "root",
          sectionId: "section-a",
          kind: "annotation",
          status: "open",
          anchor: JSON.stringify({ blockId: "wireframe-a" }),
          message: "Can we discuss this?",
          createdBy: "human",
        },
        {
          id: "reply",
          parentCommentId: "root",
          status: "open",
          kind: "comment",
          message: "Yes, replying inline.",
          createdBy: "human",
        },
      ],
    });

    const commentRows = dbInserts
      .filter((insert) => insert.table === schemaMock.planComments)
      .map((insert) => insert.values);

    expect(commentRows).toHaveLength(2);
    expect(commentRows[0]).toMatchObject({
      id: "root",
      parentCommentId: null,
      sectionId: "section-a",
      kind: "annotation",
      anchor: JSON.stringify({ blockId: "wireframe-a" }),
    });
    expect(commentRows[1]).toMatchObject({
      id: "reply",
      parentCommentId: "root",
      sectionId: "section-a",
      kind: "annotation",
      anchor: JSON.stringify({ blockId: "wireframe-a" }),
    });
  });
});
