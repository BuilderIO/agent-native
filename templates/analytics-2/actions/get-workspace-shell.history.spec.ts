import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock("@agent-native/core/server", async (original) => ({
  ...(await original<typeof import("@agent-native/core/server")>()),
  listThreads: mocks.listThreads,
}));
vi.mock("../server/model/workspace-navigation.js", async (original) => ({
  ...(await original<
    typeof import("../server/model/workspace-navigation.js")
  >()),
  readWorkspaceNavigation: async () => ({ library: false, workspaces: [] }),
}));
vi.mock("../server/lib/workspace-access.js", async (original) => ({
  ...(await original<typeof import("../server/lib/workspace-access.js")>()),
  requireCurrentWorkspace: async () => ({
    orgId: "workspace-one",
    ownerEmail: "fixture-owner",
    membership: { name: "Workspace" },
    request: { authUserId: "actor-one", userName: "Fixture" },
    access: { orgRole: "owner" },
  }),
  currentApplicationId: () => "analytics-2",
  currentWorkspaceCapabilities: async () => ({
    allows: () => true,
    isManagerOrAbove: true,
  }),
}));
vi.mock("../server/model/collections-store.js", () => ({
  listCollections: async () => [],
}));
vi.mock("../server/model/shell-projects.js", () => ({
  readShellProjects: async () => ({ recent: [], favorites: [] }),
}));
vi.mock("../server/model/data-connections.js", async (original) => ({
  ...(await original<typeof import("../server/model/data-connections.js")>()),
  hasConfiguredDataConnection: async () => false,
}));
vi.mock("../server/model/context-setup.js", async (original) => ({
  ...(await original<typeof import("../server/model/context-setup.js")>()),
  readWorkspaceContextSetup: async () => ({
    progressPercent: 0,
    completedSteps: [],
  }),
}));
import action from "./get-workspace-shell";

describe("Home recent conversation revisions", () => {
  it("requests lineage grouping at the scoped server boundary before the recent limit", async () => {
    mocks.listThreads.mockResolvedValue([
      {
        id: "latest-edit",
        orgId: "workspace-one",
        title: "Edited question",
        updatedAt: 1,
      },
    ]);
    const result = await action.run({}, {} as never);
    expect(mocks.listThreads).toHaveBeenCalledWith(
      "fixture-owner",
      expect.objectContaining({
        collapseEdits: true,
        orgId: "workspace-one",
        sourceAppId: "analytics-2",
        ownership: "mine",
        includeExternal: false,
      }),
    );
    expect(result.homeRecents.threads.map((row) => row.id)).toEqual([
      "latest-edit",
    ]);
    expect(result.recents.map((row) => row.id)).toEqual(["latest-edit"]);
  });
});
