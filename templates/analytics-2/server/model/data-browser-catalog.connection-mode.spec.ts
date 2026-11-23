import { describe, expect, it, vi } from "vitest";

// Row 824: a catalog refresh from the UI (connection authorization mode) failed
// on the served deployment with a generic "state could not be saved", while the
// same path passed locally. The guard transaction re-resolved the workspace and
// its capabilities after it was already open, which asks the same pool for a
// second read while the guard holds its connection. The workspace context is
// resolved once, before any guard, and handed to the permission check.
const mocks = vi.hoisted(() => {
  const state = {
    currentCalls: 0,
    insideGuard: false,
    resolvedCalls: [] as unknown[],
    settings: new Map<string, unknown>(),
  };
  return state;
});

vi.mock("@agent-native/core/settings", () => ({
  getSettingEntry: async (key: string) => ({
    found: mocks.settings.has(key),
    value: mocks.settings.get(key),
  }),
  mutateOrgSetting: async (
    orgId: string,
    key: string,
    update: (value: unknown) => unknown,
  ) => {
    const location = `o:${orgId}:${key}`;
    const next = await update(mocks.settings.get(location) ?? null);
    mocks.settings.set(location, next);
    return next;
  },
  deleteSetting: vi.fn(),
  deleteSettingIfValue: vi.fn(),
}));

vi.mock("../../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => {
    mocks.currentCalls += 1;
    if (mocks.insideGuard)
      throw new Error("second read while the guard is open");
    return { ownerEmail: "owner@example.test", orgId: "org-1" };
  },
  currentWorkspaceCapabilities: async () => ({
    isManagerOrAbove: false,
    allows: () => true,
    capabilities: [],
  }),
}));

vi.mock("./data-connection-mutations.js", () => ({
  acquireConnectionGuard: vi.fn(),
  metadataOptions: () => ({}),
  withConnectionGuard: async (
    _scope: unknown,
    _id: string,
    run: (tx: unknown) => Promise<unknown>,
  ) => {
    mocks.insideGuard = true;
    try {
      return await run({});
    } finally {
      mocks.insideGuard = false;
    }
  },
}));

vi.mock("./data-schema-refresh-access.js", () => ({
  resolveSchemaRefreshAccess: async (_id: string, resolved?: unknown) => {
    mocks.resolvedCalls.push(resolved);
    return { allowed: true, via: "connection" };
  },
}));

vi.mock("./data-connections.js", () => ({
  connectionIncludedForAgent: async () => true,
  connectionPresentation: async () => ({}),
  listConnectionDatasets: async () => ({ items: [], endCursor: null }),
  readBrowsableDataConnection: async () => ({
    id: "wconn1:qa",
    provider: "bigquery",
    status: "connected",
    config: {},
    credentialRefs: [],
    allowedApps: [],
    ownerEmail: "owner@example.test",
  }),
}));

vi.mock("./data-resource-metadata.js", () => ({
  readConnectionDeletionState: async () => null,
  readDataResourceMetadata: async () => ({ resources: [] }),
}));

vi.mock("./data-resource-policy.js", () => ({
  resourcePolicies: async () => new Map(),
}));

const { refreshDataBrowserCatalog } = await import("./data-browser-catalog.js");

describe("catalog refresh in connection authorization mode", () => {
  it("hands the already-resolved workspace to the permission check instead of re-reading it inside the guard", async () => {
    mocks.settings.clear();
    mocks.currentCalls = 0;
    mocks.resolvedCalls = [];
    let listed = 0;
    const result = await refreshDataBrowserCatalog("wconn1:qa", {
      caller: "frontend",
      authorization: "connection",
      listPage: async () => {
        listed += 1;
        return { items: [], endCursor: null, hasNextPage: false };
      },
    });
    expect(result.connectionId).toBe("wconn1:qa");
    expect(listed).toBeGreaterThan(0);
    // One resolution at entry, none while a guard was open.
    expect(mocks.currentCalls).toBe(1);
    // Every permission check carried the resolved workspace and capabilities.
    expect(mocks.resolvedCalls.length).toBeGreaterThan(0);
    for (const resolved of mocks.resolvedCalls)
      expect(resolved).toMatchObject({
        current: { orgId: "org-1" },
        capabilities: { isManagerOrAbove: false },
      });
  });

  it("report A2-LIVE-CATALOG-REFRESH-502 preserves typed data_connection_* status codes instead of coercing to 502", async () => {
    mocks.settings.clear();
    const { fail } = await import("@agent-native/core/action");
    await expect(
      refreshDataBrowserCatalog("wconn1:qa", {
        caller: "frontend",
        authorization: "connection",
        listPage: async () =>
          fail("Permission denied listing datasets.", {
            statusCode: 403,
            errorCode: "data_connection_rejected",
          }),
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "data_connection_rejected",
    });
  });
});
