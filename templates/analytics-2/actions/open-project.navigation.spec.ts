import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  navigateAfterWrite: navigateMock,
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi
    .fn()
    .mockResolvedValue({ ownerEmail: "owner@example.test", orgId: "org-1" }),
}));
vi.mock("../server/model/projects-store.js", () => ({
  listWorkspaceVisibleProjects: vi
    .fn()
    .mockResolvedValue([
      { id: "p1", title: "Agent-Native V3", archivedAt: null },
    ]),
}));

import openProject from "./open-project.js";

describe("open-project navigation", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    navigateMock.mockResolvedValue({ navigated: true });
  });

  it("opens the dashboard even when the agent omits intent", async () => {
    const result = await openProject.run(
      { name: "agent-native v3" } as never,
      {
        caller: "mcp",
      } as never,
    );
    expect(navigateMock).toHaveBeenCalledWith(
      { path: "/project/p1/latest" },
      expect.objectContaining({ intent: "open" }),
    );
    expect(result).toMatchObject({ navigation: { status: "requested" } });
  });
});
