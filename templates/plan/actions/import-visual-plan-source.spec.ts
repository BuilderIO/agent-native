import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  state,
  updateMock,
  insertMock,
  assertPlanEditorMock,
  createPlanVersionSnapshotMock,
  writeEventMock,
  writePlanLocalFilesMock,
} = vi.hoisted(() => ({
  state: {
    content: null as unknown,
    kind: "plan" as "plan" | "recap",
    isLocalRuntime: false,
  },
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  assertPlanEditorMock: vi.fn(),
  createPlanVersionSnapshotMock: vi.fn(),
  writeEventMock: vi.fn(),
  writePlanLocalFilesMock: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
  embedApp: (options: unknown) => options,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: (...args: unknown[]) => insertMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  }),
  schema: { plans: { id: "plans.id", updatedAt: "plans.updatedAt" } },
}));

vi.mock("../server/lib/guest-abuse.js", () => ({
  assertGuestCreateWithinLimits: vi.fn(),
}));

vi.mock("../server/lib/local-identity.js", () => ({
  isLocalPlanRuntime: () => state.isLocalRuntime,
  resolvePlanOrgIdForWrite: vi.fn(),
  requirePlanOwnerEmailForWrite: vi.fn(),
}));

vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: (...args: unknown[]) => writePlanLocalFilesMock(...args),
}));

vi.mock("../server/lib/plan-assets.js", () => ({
  applyImportedAssets: (content: unknown) => content,
  importPlanAssets: vi.fn(),
}));

vi.mock("../server/lib/plan-versions.js", () => ({
  createPlanVersionSnapshot: (...args: unknown[]) =>
    createPlanVersionSnapshotMock(...args),
}));

vi.mock("../server/lib/visual-recap-validation.js", () => ({
  assertRecapWireframesHaveContent: vi.fn(),
}));

vi.mock("../server/plan-content.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/plan-content.js")>();
  return {
    ...actual,
    serializePlanContent: (content: unknown) => JSON.stringify(content),
  };
});

vi.mock("../server/plans.js", async () => {
  const { z } = await import("zod");
  return {
    assertPlanEditor: (...args: unknown[]) => assertPlanEditorMock(...args),
    buildPlanHtml: () => "<main>Plan</main>",
    emitPlanCreated: vi.fn(),
    loadPlanBundle: async (planId: string) => ({
      plan: {
        id: planId,
        title: "Legacy plan",
        brief: "Stored plan.",
        kind: state.kind,
        status: "review",
        updatedAt: "revision-1",
        content: state.content,
      },
      comments: [],
      access: { ownerEmail: "owner@example.com" },
    }),
    newId: () => "new-plan",
    nowIso: () => "2026-10-12T00:00:00.000Z",
    planKindSchema: z.enum(["plan", "recap"]),
    planSourceSchema: z.enum(["imported", "local", "repo"]),
    planStatusSchema: z.enum(["draft", "review", "approved"]),
    planDeepLink: (planId: string) => `/plans/${planId}`,
    planPath: (planId: string) => `/plans/${planId}`,
    writeEvent: (...args: unknown[]) => writeEventMock(...args),
  };
});

const { default: importVisualPlanSource } =
  await import("./import-visual-plan-source.js");
const { exportPlanContentToMdxFolder } = await import("../server/plan-mdx.js");
const { storedPlanContentSchema } = await import("../shared/plan-content.js");

type ImportAction = {
  run: (args: Record<string, unknown>) => Promise<unknown>;
};
const runAction = (args: Record<string, unknown>) =>
  (importVisualPlanSource as ImportAction).run(args);

function legacyContent() {
  return storedPlanContentSchema.parse({
    version: 2,
    title: "Legacy plan",
    brief: "Stored plan.",
    blocks: [
      { id: "questions", type: "question-form", data: {} },
      { id: "tabs", type: "tabs", data: {} },
      { id: "model", type: "data-model", data: {} },
    ],
  });
}

describe("import-visual-plan-source stored legacy defaults", () => {
  beforeEach(() => {
    state.content = legacyContent();
    state.kind = "plan";
    state.isLocalRuntime = false;
    updateMock.mockReset();
    insertMock.mockReset().mockImplementation(() => ({
      values: async (values: { content: string }) => {
        state.content = JSON.parse(values.content);
      },
    }));
    updateMock.mockImplementation(() => ({
      set: (values: { content?: string }) => ({
        where: async () => {
          if (values.content) state.content = JSON.parse(values.content);
          return [];
        },
      }),
    }));
    assertPlanEditorMock.mockReset().mockResolvedValue(undefined);
    createPlanVersionSnapshotMock
      .mockReset()
      .mockResolvedValue({ created: true });
    writeEventMock.mockReset().mockResolvedValue(undefined);
    writePlanLocalFilesMock.mockReset().mockResolvedValue({
      written: true,
      folder: "/plans/review-recap",
      files: ["plan.mdx"],
    });
  });

  it("replaces an exported legacy plan while preserving its defaulted blocks", async () => {
    const content = legacyContent();
    const mdx = await exportPlanContentToMdxFolder({
      content,
      title: content.title ?? "Legacy plan",
      planId: "plan-legacy",
    });

    const result = await runAction({ planId: "plan-legacy", mdx });

    expect(assertPlanEditorMock).toHaveBeenCalledWith("plan-legacy");
    expect(result).toMatchObject({ planId: "plan-legacy" });
    expect(state.content).toMatchObject({
      blocks: [
        { id: "questions", type: "question-form", data: { questions: [] } },
        { id: "tabs", type: "tabs", data: { tabs: [] } },
        { id: "model", type: "data-model", data: { entities: [] } },
      ],
    });
  });

  it("keeps new imports strict even when the source was exported from a legacy plan", async () => {
    const content = legacyContent();
    const mdx = await exportPlanContentToMdxFolder({
      content,
      title: content.title ?? "Legacy plan",
      planId: "plan-legacy",
    });

    await expect(runAction({ mdx })).rejects.toMatchObject({ statusCode: 422 });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("salvages missing required fields when creating recap imports", async () => {
    state.isLocalRuntime = true;
    const result = await runAction({
      kind: "recap",
      mdx: {
        "plan.mdx": [
          "---",
          'title: "Review recap"',
          'kind: "recap"',
          "version: 2",
          "---",
          "",
          '<Checklist id="missing-items" />',
          "",
          "The review completed.",
        ].join("\n"),
      },
    });

    expect(result).toMatchObject({ planId: "new-plan" });
    expect(insertMock).toHaveBeenCalledOnce();
    expect(state.content).toMatchObject({
      blocks: [
        {
          id: "missing-items",
          type: "callout",
          data: { tone: "warning" },
        },
        {
          type: "rich-text",
          data: { markdown: "The review completed." },
        },
      ],
    });
    expect(writePlanLocalFilesMock).not.toHaveBeenCalled();
  });

  it("uses the stored recap kind when replacing source without a kind override", async () => {
    state.kind = "recap";
    state.isLocalRuntime = true;

    const result = await runAction({
      planId: "existing-recap",
      mdx: {
        "plan.mdx": [
          "---",
          'title: "Review recap"',
          'kind: "recap"',
          "version: 2",
          "---",
          "",
          '<Checklist id="missing-items" />',
          "",
          "The review completed.",
        ].join("\n"),
      },
    });

    expect(result).toMatchObject({ planId: "existing-recap" });
    expect(assertPlanEditorMock).toHaveBeenCalledWith("existing-recap");
    expect(state.content).toMatchObject({
      blocks: [
        {
          id: "missing-items",
          type: "callout",
          data: { tone: "warning" },
        },
        {
          type: "rich-text",
          data: { markdown: "The review completed." },
        },
      ],
    });
    expect(writePlanLocalFilesMock).not.toHaveBeenCalled();
  });

  it("mirrors local recap source when the import did not salvage any blocks", async () => {
    state.isLocalRuntime = true;
    await runAction({
      kind: "recap",
      mdx: {
        "plan.mdx": [
          "---",
          'title: "Review recap"',
          'kind: "recap"',
          "version: 2",
          "---",
          "",
          "The review completed.",
        ].join("\n"),
      },
    });

    expect(writePlanLocalFilesMock).toHaveBeenCalledOnce();
  });

  it("rejects missing required fields in fresh ordinary imports", async () => {
    await expect(
      runAction({
        kind: "plan",
        mdx: {
          "plan.mdx": [
            "---",
            'title: "New authored plan"',
            'kind: "plan"',
            "version: 2",
            "---",
            "",
            '<Checklist id="missing-items" />',
            "",
            '<QuestionForm id="questions" questions={[]} />',
          ].join("\n"),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("checklist blocks require data.items"),
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("keeps hosted replacements strict when the stored content is null", async () => {
    state.content = null;

    await expect(
      runAction({
        planId: "plan-without-content",
        mdx: {
          "plan.mdx": [
            "---",
            'title: "New authored plan"',
            'kind: "plan"',
            "---",
            "",
            '<QuestionForm id="questions" questions={[]} />',
            "",
          ].join("\n"),
        },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects new blocks whose required fields were hidden by stored defaults", async () => {
    await expect(
      runAction({
        planId: "plan-legacy",
        mdx: {
          "plan.mdx": [
            "---",
            'title: "Legacy plan"',
            "version: 2",
            "---",
            "",
            '<Checklist id="new-checklist" />',
          ].join("\n"),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("checklist blocks require data.items"),
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("preserves omitted required fields on unchanged legacy source blocks", async () => {
    const result = await runAction({
      planId: "plan-legacy",
      mdx: {
        "plan.mdx": [
          "---",
          'title: "Legacy plan"',
          "version: 2",
          "---",
          "",
          '<QuestionForm id="questions" />',
          '<TabsBlock id="tabs" />',
          '<DataModel id="model" />',
        ].join("\n"),
      },
    });

    expect(result).toMatchObject({ planId: "plan-legacy" });
    expect(state.content).toMatchObject({
      blocks: [
        { id: "questions", data: { questions: [] } },
        { id: "tabs", data: { tabs: [] } },
        { id: "model", data: { entities: [] } },
      ],
    });
  });

  it("rejects clearing a previously populated question array during replacement", async () => {
    const previous = storedPlanContentSchema.parse({
      version: 2,
      title: "Legacy plan",
      blocks: [
        {
          id: "questions",
          type: "question-form",
          data: {
            questions: [{ id: "q1", title: "Question", mode: "freeform" }],
          },
        },
      ],
    });
    state.content = previous;
    const replacement = storedPlanContentSchema.parse({
      ...previous,
      blocks: [
        { id: "questions", type: "question-form", data: { questions: [] } },
      ],
    });
    const mdx = await exportPlanContentToMdxFolder({
      content: replacement,
      title: replacement.title ?? "Legacy plan",
      planId: "plan-legacy",
    });

    await expect(runAction({ planId: "plan-legacy", mdx })).rejects.toThrow(
      /require at least one questions entry/i,
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});
