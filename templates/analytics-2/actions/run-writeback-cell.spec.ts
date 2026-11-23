import { describe, expect, it, vi } from "vitest";

const getProjectDocument = vi.hoisted(() =>
  vi.fn(async () => ({
    cells: [
      {
        id: "qa-cell",
        contents: { source: "select 1", dataConnectionId: "qa-source" },
      },
    ],
  })),
);

vi.mock("../server/lib/workspace-access.js", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("../server/lib/workspace-access.js")>()),
  requireCurrentWorkspace: async () => ({
    orgId: "qa-workspace",
    ownerEmail: "qa-owner@example.test",
  }),
}));
vi.mock("../server/model/projects-store.js", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("../server/model/projects-store.js")>()),
  getProjectDocument,
}));

import runWriteback from "./run-writeback-cell";

describe("warehouse Writeback capability", () => {
  it("refuses the direct action before reading the source even when the source has a connection", async () => {
    await expect(
      runWriteback.run(
        {
          projectId: "qa-project",
          cellId: "qa-cell",
          targetTable: "qa.output",
        },
        {
          caller: "frontend",
          appId: "analytics-2",
          orgId: "qa-workspace",
          userEmail: "qa-owner@example.test",
        },
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "missing_backing" });
    expect(getProjectDocument).not.toHaveBeenCalled();
    expect(runWriteback.agentTool).toBe(false);
    expect(runWriteback.mcpTool).toBe(false);
    expect(runWriteback.toolCallable).toBe(false);
  });
});
