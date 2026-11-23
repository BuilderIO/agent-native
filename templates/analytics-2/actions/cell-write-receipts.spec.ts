import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isToolWrite: true,
  propose: vi.fn(),
  deleteCell: vi.fn(),
  readLegacy: vi.fn(),
  applyLegacy: vi.fn(),
  requireApplied: vi.fn(),
  requireWritable: vi.fn(),
  refreshed: vi.fn(),
  showAgentProject: vi.fn(),
}));

vi.mock("../server/lib/notebook-tool-context.js", () => ({
  isNotebookToolWrite: () => mocks.isToolWrite,
}));
vi.mock("../server/lib/notebook-tool-proposal.js", async () => {
  const { z } = await import("zod");
  return {
    invalidNotebookProposal: () => {
      throw new Error("invalidNotebookProposal");
    },
    notebookProposalChatUI: {},
    notebookToolProposalFields: {
      threadId: z.string().optional(),
      proposalIds: z.array(z.string()).optional(),
    },
    proposeNotebookToolChange: mocks.propose,
  };
});
vi.mock("../server/lib/project-action-access.js", async () => {
  const { z } = await import("zod");
  return {
    notebookChangeResource: {},
    projectDocumentResultSchema: z.object({ project: z.unknown() }),
    requireWritableProject: mocks.requireWritable,
    refreshedProjectDocument: mocks.refreshed,
  };
});
vi.mock("../server/agent-navigation.js", async () => {
  const { z } = await import("zod");
  return {
    agentNavigationSchema: z.unknown(),
    showAgentProject: mocks.showAgentProject,
  };
});
vi.mock("../server/model/cells-store.js", () => ({
  deleteCell: mocks.deleteCell,
}));
vi.mock("../server/model/notebook-operations/legacy.js", () => ({
  readLegacyNotebook: mocks.readLegacy,
  applyLegacyNotebookOperation: mocks.applyLegacy,
  requireAppliedNotebookOperation: mocks.requireApplied,
  legacyGap: () => ({ before: null, after: null }),
  requireLegacyCell: (doc: { cells: Array<{ id: string }> }, cellId: string) =>
    doc.cells.find((c) => c.id === cellId) ?? { id: cellId, revision: 1 },
}));

const projectFixture = {
  id: "prj_1",
  workingVersionId: "ver_1",
  cells: [
    {
      id: "cel_1",
      revision: 1,
      contents: { kind: "markdown", markdown: "hello" },
    },
  ],
};

describe("SAYA-1117-WRITE-CLAIMS cell mutation receipt status", () => {
  beforeEach(() => {
    mocks.isToolWrite = true;
    mocks.propose.mockReset().mockResolvedValue({
      threadId: "thr_1",
      proposalIds: ["prop_1"],
      newCellId: "cel_pending_2",
      project: projectFixture,
    });
    mocks.deleteCell.mockReset().mockResolvedValue(undefined);
    mocks.requireWritable.mockReset().mockResolvedValue({
      scope: { ownerEmail: "owner@example.test", orgId: "org_1" },
      project: projectFixture,
    });
    mocks.refreshed.mockReset().mockResolvedValue(projectFixture);
    mocks.showAgentProject.mockReset().mockResolvedValue({});
    mocks.readLegacy.mockReset().mockResolvedValue({
      notebook: {
        id: "prj_1",
        resources: { orderRevision: 1 },
      },
      cells: [
        {
          id: "cel_1",
          revision: 1,
          contents: { kind: "markdown", markdown: "one" },
        },
        {
          id: "cel_2",
          revision: 1,
          contents: { kind: "markdown", markdown: "two" },
        },
      ],
    });
    mocks.applyLegacy.mockReset().mockResolvedValue({ applied: true });
    mocks.requireApplied.mockReset();
  });

  it("returns deleteStatus pending_review for agent proposals and saved for direct deletes", async () => {
    const { default: deleteProjectCell } =
      await import("./delete-project-cell.js");

    mocks.isToolWrite = true;
    const proposed = await deleteProjectCell.run(
      { projectId: "prj_1", cellId: "cel_1" },
      { caller: "tool" },
    );
    expect(proposed).toMatchObject({
      deleteStatus: "pending_review",
      threadId: "thr_1",
      proposalIds: ["prop_1"],
    });

    mocks.isToolWrite = false;
    const saved = await deleteProjectCell.run(
      { projectId: "prj_1", cellId: "cel_1" },
      { caller: "frontend" },
    );
    expect(saved).toMatchObject({ deleteStatus: "saved" });
  });

  it("returns cellStatus pending_review for agent duplicate proposals and saved for direct duplicates", async () => {
    const { default: duplicateProjectCell } =
      await import("./duplicate-project-cell.js");

    mocks.isToolWrite = true;
    const proposed = await duplicateProjectCell.run(
      { projectId: "prj_1", cellId: "cel_1" },
      { caller: "tool" },
    );
    expect(proposed).toMatchObject({
      cellStatus: "pending_review",
      createdCellId: "cel_pending_2",
      threadId: "thr_1",
      proposalIds: ["prop_1"],
    });

    mocks.isToolWrite = false;
    const saved = await duplicateProjectCell.run(
      { projectId: "prj_1", cellId: "cel_1" },
      { caller: "frontend" },
    );
    expect(saved).toMatchObject({
      cellStatus: "saved",
      createdCellId: expect.any(String),
    });
  });

  it("returns moveStatus pending_review for agent move proposals and saved for direct moves", async () => {
    const { default: moveProjectCell } = await import("./move-project-cell.js");

    mocks.isToolWrite = true;
    const proposed = await moveProjectCell.run(
      { projectId: "prj_1", cellId: "cel_1", direction: "down" },
      { caller: "tool" },
    );
    expect(proposed).toMatchObject({
      moveStatus: "pending_review",
      threadId: "thr_1",
      proposalIds: ["prop_1"],
    });

    mocks.isToolWrite = false;
    const saved = await moveProjectCell.run(
      { projectId: "prj_1", cellId: "cel_1", direction: "down" },
      { caller: "frontend" },
    );
    expect(saved).toMatchObject({ moveStatus: "saved" });
  });
});
