import { beforeEach, describe, expect, it, vi } from "vitest";

const agentTouchDocumentMock = vi.hoisted(() => vi.fn());
const applyPlanMdxSourcePatchesMock = vi.hoisted(() => vi.fn());
const assertPlanEditorMock = vi.hoisted(() => vi.fn());
const createPlanVersionSnapshotMock = vi.hoisted(() => vi.fn());
const exportPlanContentToMdxFolderMock = vi.hoisted(() => vi.fn());
const loadPlanBundleMock = vi.hoisted(() => vi.fn());
const parsePlanMdxFolderMock = vi.hoisted(() => vi.fn());
const referencedBlockIdsForPlanCommentsMock = vi.hoisted(() => vi.fn());
const writeEventMock = vi.hoisted(() => vi.fn());
const writePlanLocalFilesMock = vi.hoisted(() => vi.fn());
const dbReturningMock = vi.hoisted(() => vi.fn());
const dbWhereMock = vi.hoisted(() => vi.fn());
const dbSetMock = vi.hoisted(() => vi.fn());
const dbUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/collab", () => ({
  agentTouchDocument: (...args: unknown[]) => agentTouchDocumentMock(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update: dbUpdateMock }),
  schema: {
    plans: {
      id: "plans.id",
      updatedAt: "plans.updatedAt",
    },
  },
}));

vi.mock("../server/lib/local-identity.js", () => ({
  isLocalPlanRuntime: () => false,
}));

vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: (...args: unknown[]) => writePlanLocalFilesMock(...args),
}));

vi.mock("../server/lib/plan-versions.js", () => ({
  createPlanVersionSnapshot: (...args: unknown[]) =>
    createPlanVersionSnapshotMock(...args),
}));

vi.mock("../server/plan-content.js", () => ({
  serializePlanContent: (content: unknown) => JSON.stringify(content),
}));

vi.mock("../server/plan-mdx.js", async () => {
  const { z } = await import("zod");
  return {
    applyPlanMdxSourcePatches: (...args: unknown[]) =>
      applyPlanMdxSourcePatchesMock(...args),
    exportPlanContentToMdxFolder: (...args: unknown[]) =>
      exportPlanContentToMdxFolderMock(...args),
    parsePlanMdxFolder: (...args: unknown[]) => parsePlanMdxFolderMock(...args),
    planMdxSourcePatchesSchema: z.array(z.any()),
    referencedBlockIdsForPlanComments: (...args: unknown[]) =>
      referencedBlockIdsForPlanCommentsMock(...args),
  };
});

vi.mock("../server/plans.js", () => ({
  assertPlanEditor: (...args: unknown[]) => assertPlanEditorMock(...args),
  buildPlanHtml: vi.fn(() => "<main>Plan</main>"),
  loadPlanBundle: (...args: unknown[]) => loadPlanBundleMock(...args),
  nowIso: vi.fn(() => "2026-07-16T18:00:00.000Z"),
  planDeepLink: vi.fn((planId: string) => `/plans/${planId}`),
  planPath: vi.fn((planId: string) => `/plans/${planId}`),
  writeEvent: (...args: unknown[]) => writeEventMock(...args),
}));

const { default: patchVisualPlanSource } =
  await import("./patch-visual-plan-source.js");

type SourcePatchAction = {
  run: (
    args: Record<string, unknown>,
    ctx?: Record<string, unknown>,
  ) => Promise<unknown>;
};

const runAction = (args: Record<string, unknown>) =>
  (patchVisualPlanSource as SourcePatchAction).run(args);

const populatedContent = () => ({
  version: 2,
  blocks: [{ id: "block_1", type: "rich-text", data: { markdown: "Body" } }],
  canvas: { frames: [{ id: "frame_1" }] },
  prototype: { screens: [{ id: "screen_1", html: "<main>Screen</main>" }] },
});

const bundleWith = (content: ReturnType<typeof populatedContent>) => ({
  plan: {
    id: "plan_test",
    title: "Plan",
    brief: "Brief",
    kind: "plan",
    updatedAt: "revision-1",
    content,
  },
  comments: [],
});

describe("patch-visual-plan-source guardrails", () => {
  beforeEach(() => {
    agentTouchDocumentMock.mockReset();
    applyPlanMdxSourcePatchesMock.mockReset();
    assertPlanEditorMock.mockReset();
    assertPlanEditorMock.mockResolvedValue(undefined);
    createPlanVersionSnapshotMock.mockReset();
    createPlanVersionSnapshotMock.mockResolvedValue({ created: true });
    exportPlanContentToMdxFolderMock.mockReset();
    exportPlanContentToMdxFolderMock.mockResolvedValue({
      "plan.mdx": "# Existing plan",
    });
    loadPlanBundleMock.mockReset();
    loadPlanBundleMock.mockResolvedValue(bundleWith(populatedContent()));
    parsePlanMdxFolderMock.mockReset();
    parsePlanMdxFolderMock.mockResolvedValue(populatedContent());
    referencedBlockIdsForPlanCommentsMock.mockReset();
    referencedBlockIdsForPlanCommentsMock.mockReturnValue(new Set<string>());
    writeEventMock.mockReset();
    writeEventMock.mockResolvedValue(undefined);
    writePlanLocalFilesMock.mockReset();
    dbReturningMock.mockReset();
    dbReturningMock.mockResolvedValue([{ id: "plan_test" }]);
    dbWhereMock.mockReset();
    dbWhereMock.mockReturnValue({ returning: dbReturningMock });
    dbSetMock.mockReset();
    dbSetMock.mockReturnValue({ where: dbWhereMock });
    dbUpdateMock.mockReset();
    dbUpdateMock.mockReturnValue({ set: dbSetMock });
    applyPlanMdxSourcePatchesMock.mockResolvedValue({
      "plan.mdx": "# Updated plan",
    });
  });

  it("requires a caller revision before replace-file source work begins", async () => {
    await expect(
      runAction({
        planId: "plan_test",
        patches: [
          {
            op: "replace-file",
            file: "plan.mdx",
            content: "PRIVATE SOURCE BODY",
          },
        ],
      }),
    ).rejects.toThrow("replace-file requires expectedUpdatedAt");

    expect(exportPlanContentToMdxFolderMock).not.toHaveBeenCalled();
    expect(applyPlanMdxSourcePatchesMock).not.toHaveBeenCalled();
    expect(createPlanVersionSnapshotMock).not.toHaveBeenCalled();
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a stale caller revision before exporting or patching source", async () => {
    await expect(
      runAction({
        planId: "plan_test",
        expectedUpdatedAt: "revision-stale",
        patches: [
          {
            op: "replace-file",
            file: "plan.mdx",
            content: "PRIVATE SOURCE BODY",
          },
        ],
      }),
    ).rejects.toThrow("Plan changed since the source was read");

    expect(exportPlanContentToMdxFolderMock).not.toHaveBeenCalled();
    expect(applyPlanMdxSourcePatchesMock).not.toHaveBeenCalled();
    expect(createPlanVersionSnapshotMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      surface: "blocks",
      nextContent: {
        ...populatedContent(),
        blocks: [],
      },
      expected: "blocks (1 to 0)",
    },
    {
      surface: "canvas frames",
      nextContent: {
        ...populatedContent(),
        canvas: { frames: [] },
      },
      expected: "canvas frames (1 to 0)",
    },
    {
      surface: "prototype screens",
      nextContent: {
        ...populatedContent(),
        prototype: { screens: [] },
      },
      expected: "prototype screens (1 to 0)",
    },
  ])(
    "blocks a nonempty-to-empty $surface collapse",
    async ({ nextContent, expected }) => {
      parsePlanMdxFolderMock.mockResolvedValueOnce(nextContent);

      await expect(
        runAction({
          planId: "plan_test",
          expectedUpdatedAt: "revision-1",
          patches: [
            {
              op: "replace-file",
              file: "plan.mdx",
              content: "PRIVATE SOURCE BODY",
            },
          ],
        }),
      ).rejects.toThrow(expected);

      expect(createPlanVersionSnapshotMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
      expect(writeEventMock).not.toHaveBeenCalled();
    },
  );

  it("allows an explicitly destructive replacement and logs only bounded metadata", async () => {
    const emptyContent = {
      version: 2,
      blocks: [],
      canvas: { frames: [] },
      prototype: { screens: [] },
    };
    parsePlanMdxFolderMock.mockResolvedValueOnce(emptyContent);

    await expect(
      runAction({
        planId: "plan_test",
        expectedUpdatedAt: "revision-1",
        allowDestructive: true,
        patches: [
          {
            op: "replace-file",
            file: "plan.mdx",
            content: "PRIVATE SOURCE BODY",
          },
        ],
      }),
    ).resolves.toMatchObject({ planId: "plan_test" });

    expect(writeEventMock).toHaveBeenCalledWith({
      planId: "plan_test",
      type: "plan.source.patched",
      message: "Applied 1 visual plan source patch(es).",
      payload: {
        patchOps: ["replace-file"],
        targets: [{ op: "replace-file", file: "plan.mdx" }],
        counts: {
          before: { blocks: 1, canvasFrames: 1, prototypeScreens: 1 },
          after: { blocks: 0, canvasFrames: 0, prototypeScreens: 0 },
        },
        contentHashes: {
          before: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          after: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      },
      createdBy: "agent",
    });
    expect(JSON.stringify(writeEventMock.mock.calls[0]?.[0])).not.toContain(
      "PRIVATE SOURCE BODY",
    );
  });

  it("keeps granular patches revision-optional and sanitizes audit targets", async () => {
    await expect(
      runAction({
        planId: "plan_test",
        patches: [
          {
            op: "replace-markdown-block",
            blockId: "intro section#1",
            markdown: "PRIVATE MARKDOWN BODY",
          },
        ],
      }),
    ).resolves.toMatchObject({ planId: "plan_test" });

    expect(applyPlanMdxSourcePatchesMock).toHaveBeenCalled();
    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          targets: [
            {
              op: "replace-markdown-block",
              target: "intro_section_1",
            },
          ],
        }),
      }),
    );
    expect(JSON.stringify(writeEventMock.mock.calls[0]?.[0])).not.toContain(
      "PRIVATE MARKDOWN BODY",
    );
  });
});
