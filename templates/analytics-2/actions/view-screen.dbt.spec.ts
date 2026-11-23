import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  navigation: {} as Record<string, unknown>,
  metadata: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => state.navigation,
  readAppStateForCurrentTab: async () => undefined,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: () => undefined,
}));
vi.mock("../server/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../server/lib/project-action-access.js", () => ({
  requireReadableProject: vi.fn(),
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({}),
}));
vi.mock("../server/lib/recent-query-project.js", async () => {
  const { z } = await import("zod");
  return {
    findRecentQueryProject: async () => undefined,
    recentQueryProjectSchema: z.object({}),
  };
});
vi.mock("../server/model/database.js", () => ({
  ensureAnalyticsDatabase: vi.fn(),
}));
vi.mock("../server/model/project-access.js", () => ({
  resolvePublishedProjectAccess: vi.fn(),
}));
vi.mock("../server/model/project-grant-access.js", () => ({
  canEditProject: vi.fn(),
  projectAccessLevel: vi.fn(),
}));
vi.mock("../server/model/project-releases.js", () => ({
  readProjectRelease: vi.fn(),
}));
vi.mock("../server/model/thread-projects.js", () => ({
  currentNotebookThreadScope: vi.fn(),
  requireNotebookThreadBinding: vi.fn(),
}));
vi.mock("./get-data-dbt-metadata.js", () => ({
  default: { run: state.metadata },
}));

import action from "./view-screen.js";

beforeEach(() => {
  state.navigation = {
    view: "home/data",
    resourceKind: "data-connection",
    resourceId: "connection-qa",
    dataResourceKind: "table",
    dataResourceId: "table:qa:public:orders",
  };
  state.metadata
    .mockReset()
    .mockResolvedValue({
      connectionId: "connection-qa",
      tableId: "table:qa:public:orders",
      metadata: { description: "Documented orders for analysis" },
    });
});
describe("selected table dbt screen context", () => {
  it("includes access-checked dbt documentation in automatic agent screen reads", async () => {
    const context = { caller: "tool", threadId: "thread-qa" } as never;
    const result = await action.run({}, context);
    expect(state.metadata).toHaveBeenCalledWith(
      { connectionId: "connection-qa", tableId: "table:qa:public:orders" },
      context,
    );
    expect(result).toMatchObject({
      dataTableDbt: {
        status: "ready",
        description: "Documented orders for analysis",
        truncated: false,
      },
    });
    expect(action.outputSchema.safeParse(result).success).toBe(true);
  });
  it("bounds documentation without claiming the truncated text is complete", async () => {
    state.metadata.mockResolvedValue({
      connectionId: "connection-qa",
      tableId: "table:qa:public:orders",
      metadata: { description: "x".repeat(5000) },
    });
    const result = await action.run({}, { caller: "tool" } as never);
    expect(result).toMatchObject({
      dataTableDbt: { description: "x".repeat(4000), truncated: true },
    });
  });
  it("keeps failed or denied reads explicit and excludes the provider error", async () => {
    state.metadata.mockRejectedValue(new Error("private upstream details"));
    const result = await action.run({}, { caller: "tool" } as never);
    expect(result).toMatchObject({
      dataTableDbt: {
        status: "unavailable",
        description: null,
        truncated: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private upstream details");
  });
  it("does not read table documentation for a schema or a different response", async () => {
    state.navigation.dataResourceKind = "schema";
    await action.run({}, { caller: "tool" } as never);
    expect(state.metadata).not.toHaveBeenCalled();
    state.navigation.dataResourceKind = "table";
    state.metadata.mockResolvedValue({
      connectionId: "other",
      tableId: "table:qa:public:orders",
      metadata: { description: "Other table" },
    });
    const result = await action.run({}, { caller: "tool" } as never);
    expect(JSON.stringify(result)).not.toContain("Other table");
  });
});
