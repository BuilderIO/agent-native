import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigation: {} as Record<string, unknown>,
  listAgentRunFailures: vi.fn(),
  listThreadDebugSources: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => mocks.navigation),
}));

vi.mock("../server/lib/app-creation-store.js", () => ({
  listWorkspaceApps: vi.fn(),
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  listOverview: vi.fn(async () => ({
    counts: {},
    settings: {},
  })),
}));

vi.mock("../server/lib/thread-debug-store.js", () => ({
  getAgentThreadDebug: vi.fn(),
  listAgentRunFailures: mocks.listAgentRunFailures,
  listThreadDebugSources: mocks.listThreadDebugSources,
  searchAgentThreads: vi.fn(),
}));

vi.mock("../server/lib/usage-metrics-store.js", () => ({
  listDispatchUsageMetrics: vi.fn(),
}));

vi.mock("../server/lib/vault-store.js", () => ({
  getVaultAccessSettings: vi.fn(),
  canManageVault: vi.fn(async () => false),
  listGrants: vi.fn(),
  listRequests: vi.fn(),
  listSecrets: vi.fn(),
  listVaultOverview: vi.fn(async () => ({})),
}));

vi.mock("../server/lib/workspace-resources-store.js", () => ({
  listWorkspaceResourceOptions: vi.fn(),
  listWorkspaceResourcesForApp: vi.fn(),
}));

import viewScreen from "./view-screen.js";

describe("view-screen Thread Debug summary", () => {
  beforeEach(() => {
    mocks.navigation = { view: "thread-debug" };
    mocks.listAgentRunFailures.mockReset();
    mocks.listAgentRunFailures.mockResolvedValue({ failures: [] });
    mocks.listThreadDebugSources.mockReset();
    mocks.listThreadDebugSources.mockResolvedValue({ sources: [] });
  });

  it("matches the UI's default 24-hour failed-run range", async () => {
    await viewScreen.run({});

    expect(mocks.listAgentRunFailures).toHaveBeenCalledWith({
      sourceId: "all",
      ownerEmail: undefined,
      status: "all",
      lookbackHours: 24,
      limit: 10,
    });
  });

  it("normalizes invalid status and range query state", async () => {
    mocks.navigation = {
      view: "thread-debug",
      failureStatus: "timed-out",
      range: "forever",
    };

    await viewScreen.run({});

    expect(mocks.listAgentRunFailures).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "all",
        lookbackHours: 24,
      }),
    );
  });
});
