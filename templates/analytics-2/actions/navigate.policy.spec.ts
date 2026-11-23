// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  writes: [] as Array<{ key: string; value: unknown }>,
  currentNavigation: { view: "thread/t-existing", path: "/thread/t-existing" },
}));

vi.mock("@agent-native/core/application-state", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/application-state")
    >();
  const { assertNavigateWriteAllowed } =
    await import("../../../packages/core/dist/application-state/navigate-write-guard.js");
  return {
    ...actual,
    resolveCurrentRequestStateTab: vi
      .fn()
      .mockResolvedValue({ tabId: "tab-1", unavailable: false }),
    readAppStateForCurrentTab: vi
      .fn()
      .mockImplementation(async (key: string) =>
        key === "navigation" ? state.currentNavigation : null,
      ),
    writeAppStateForCurrentTab: vi
      .fn()
      .mockImplementation(async (key: string, value: unknown) => {
        // Exercise the real core store guard that production appStatePut runs.
        assertNavigateWriteAllowed(key, value);
        state.writes.push({ key, value });
      }),
  };
});

vi.mock("../server/lib/project-action-access.js", () => ({
  requireReadableProject: vi
    .fn()
    .mockResolvedValue({ scope: { orgId: "org-1" }, project: {} }),
}));
vi.mock("./get-thread-summary.js", () => ({
  default: { run: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../server/lib/analytics-capabilities.js", () => ({
  requireCapability: vi.fn().mockResolvedValue({ status: "allowed" }),
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi
    .fn()
    .mockResolvedValue({ ownerEmail: "qa-fleet@builder.io", orgId: "org-1" }),
}));
vi.mock("../server/model/collections-store.js", () => ({
  listCollections: vi.fn().mockResolvedValue([{ id: "c1", children: [] }]),
}));
vi.mock("../server/model/data-connections.js", () => ({
  listDataConnections: vi.fn().mockResolvedValue([{ id: "d1" }]),
}));

import listProjects from "./list-projects.js";
import navigate from "./navigate.js";

describe("K-ANA-1-1 navigate keep-view policy against real core guard", () => {
  beforeEach(() => {
    state.writes = [];
  });

  const mcpCtx = {
    caller: "mcp" as const,
    actionName: "navigate",
    appId: "analytics-2",
  };

  it("accepts the framework's keep-navigation result in its output contract", () => {
    expect(
      navigate.outputSchema?.["~standard"].validate({
        kept: true,
        navigated: false,
        reason: "navigation-mode-keep",
        currentView: state.currentNavigation,
        message: "Kept the current view.",
      }),
    ).toMatchObject({ value: { reason: "navigation-mode-keep" } });
  });

  it.each([
    [{ view: "home" }, "/home"],
    [{ view: "recent" }, "/home"],
    [{ view: "recent-projects" }, "/home"],
    [{ view: "all" }, "/home/all"],
    [{ view: "projects" }, "/home/all"],
    [{ view: "archive" }, "/home/archive"],
    [{ view: "trash" }, "/home/trash"],
    [{ view: "data" }, "/home/data"],
    [{ view: "threads" }, "/home/threads"],
    [{ view: "collections" }, "/home/collections"],
    [{ view: "library" }, "/home/library"],
    [{ view: "search" }, "/home/search"],
    [{ path: "/home/all" }, "/home/all"],
  ] as const)(
    "allows section view %j without intent: 'open' for an MCP agent",
    async (args, expectedPath) => {
      const result = await navigate.run(args, mcpCtx as never);
      expect(result).toMatchObject({ path: expectedPath });
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0]?.value).toMatchObject({ path: expectedPath });
    },
  );

  it.each([
    [{ projectId: "p1" }],
    [{ threadId: "t1" }],
    [{ collectionId: "c1" }],
    [{ dataConnectionId: "d1" }],
    [{ path: "/project/p1/latest" }],
  ] as const)(
    "returns a kept-view result instead of throwing when opening item detail %j without intent: 'open'",
    async (args) => {
      const result = await navigate.run(args, mcpCtx as never);
      expect(result).toMatchObject({
        kept: true,
        navigated: false,
        reason: "detail-requires-open-intent",
        currentView: state.currentNavigation,
      });
      expect(state.writes).toHaveLength(0);
    },
  );

  it("opens an item detail when intent: 'open' is passed", async () => {
    const result = await navigate.run(
      { projectId: "p1", intent: "open" },
      mcpCtx as never,
    );
    expect(result).toMatchObject({ path: "/project/p1/latest" });
    expect(state.writes).toHaveLength(1);
  });

  it("list-projects description guides MCP agents to open /home when asked to show recent projects", () => {
    const description =
      (listProjects as { tool?: { description?: string } }).tool?.description ??
      "";
    expect(description).toMatch(/navigate/i);
    expect(description).toMatch(/home/i);
  });
});
