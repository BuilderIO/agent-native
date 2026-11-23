import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  navigation: vi.fn(),
  tab: vi.fn(),
  rows: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: state.navigation,
  readAppStateForCurrentTab: state.tab,
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "test@example.com",
    orgId: "org-1",
  }),
}));
vi.mock("../server/model/projects-store.js", () => ({
  listProjectRows: state.rows,
}));
vi.mock("../server/lib/recent-query-project.js", async (original) => ({
  ...(await original<typeof import("../server/lib/recent-query-project.js")>()),
  findRecentQueryProject: async () => null,
}));
import viewScreen from "./view-screen.js";
beforeEach(() => {
  state.navigation.mockReset();
  state.tab.mockReset().mockResolvedValue(null);
  state.rows.mockReset();
});
it("reports a bounded list in the current workspace, including empty lists", async () => {
  state.navigation.mockResolvedValue({ view: "home/all", path: "/home/all" });
  state.rows.mockResolvedValue(
    Array.from({ length: 21 }, (_, i) => ({
      id: `p${i}`,
      title: `Project ${i}`,
    })),
  );
  const result = await viewScreen.run({}, {});
  expect(result).toMatchObject({
    availableProjects: { total: 21, truncated: true },
  });
  expect(
    typeof result === "string" ? [] : result.availableProjects?.projects,
  ).toHaveLength(20);
  expect(state.rows).toHaveBeenCalledWith({
    ownerEmail: "test@example.com",
    orgId: "org-1",
    trashed: false,
    archived: false,
    search: "",
  });
  state.rows.mockResolvedValue([]);
  expect(await viewScreen.run({}, {})).toMatchObject({
    availableProjects: { projects: [], total: 0, truncated: false },
  });
});
it("does not read project lists on an unrelated screen", async () => {
  state.navigation.mockResolvedValue({ view: "data", path: "/data" });
  await viewScreen.run({}, {});
  expect(state.rows).not.toHaveBeenCalled();
});
