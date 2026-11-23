import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.hoisted(() => vi.fn());
const showMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi
    .fn()
    .mockResolvedValue({ ownerEmail: "owner@example.test", orgId: "org-1" }),
}));
vi.mock("../server/model/projects-store.js", () => ({
  listWorkspaceVisibleProjects: listMock,
}));
vi.mock("../server/agent-navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/agent-navigation.js")>()),
  showAgentProject: showMock,
}));
vi.mock("./search-workspace.js", () => ({ default: { run: searchMock } }));

import openProject from "./open-project.js";

const project = (
  id: string,
  title: string,
  archivedAt: string | null = null,
) => ({
  id,
  title,
  archivedAt,
});

describe("open-project", () => {
  beforeEach(() => {
    listMock.mockReset();
    showMock.mockReset();
    searchMock.mockReset();
    showMock.mockResolvedValue({ navigation: { status: "requested" } });
  });

  it("resolves the name and queues navigation in one call, without searching", async () => {
    listMock.mockResolvedValue([
      project("p1", "Revenue overview"),
      project("p2", "Churn"),
    ]);
    const result = await openProject.run(
      { name: "revenue overview", intent: "open" },
      { caller: "tool" } as never,
    );
    expect(result).toMatchObject({
      projectId: "p1",
      path: "/project/p1/latest",
      navigation: { status: "requested" },
    });
    expect(showMock).toHaveBeenCalledWith(expect.anything(), "p1", "open");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("prefers an exact title over a partial one and skips archived projects", async () => {
    listMock.mockResolvedValue([
      project("p1", "Revenue overview 2024"),
      project("p2", "Revenue"),
      project("p3", "Revenue", "2024-01-01"),
    ]);
    expect(
      await openProject.run({ name: "Revenue", intent: "open" }, undefined),
    ).toMatchObject({ projectId: "p2" });
  });

  it("fails loudly when nothing or several projects match", async () => {
    listMock.mockResolvedValue([
      project("p1", "Sales A"),
      project("p2", "Sales B"),
    ]);
    await expect(
      openProject.run({ name: "Sales", intent: "open" }, undefined),
    ).rejects.toMatchObject({ errorCode: "project_ambiguous" });
    await expect(
      openProject.run({ name: "Nope", intent: "open" }, undefined),
    ).rejects.toMatchObject({ errorCode: "project_not_found" });
    expect(showMock).not.toHaveBeenCalled();
  });
});
