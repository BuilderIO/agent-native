import { describe, expect, it, vi } from "vitest";

import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";

const state = vi.hoisted(() => ({
  pending: [] as string[],
  releases: [] as Array<() => void>,
  sourceReads: 0,
}));

function gated<T>(name: string, value: T): Promise<T> {
  state.pending.push(name);
  return new Promise<T>((resolve) => {
    state.releases.push(() => resolve(value));
  });
}

vi.mock("@agent-native/core/settings", () => ({
  getSettingEntry: async () => ({ found: false }),
  mutateOrgSetting: vi.fn(),
  deleteSetting: vi.fn(),
  deleteSettingIfValue: vi.fn(),
}));
vi.mock("../lib/analytics-capabilities.js", () => ({
  requireCurrentWorkspaceCapability: async () => ({
    ownerEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi.fn(),
  currentWorkspaceCapabilities: vi.fn(),
}));
vi.mock("./data-connection-mutations.js", () => ({
  metadataOptions: () => ({}),
  withConnectionGuard: vi.fn(),
}));
vi.mock("./data-schema-refresh-access.js", () => ({
  resolveSchemaRefreshAccess: vi.fn(),
}));
vi.mock("./data-connections.js", () => ({
  connectionIncludedForAgent: async () => true,
  connectionPresentation: () =>
    gated("presentation", { annotationRevision: "r" }),
  listConnectionDatasets: vi.fn(),
  readBrowsableDataConnection: async (id: string) => {
    state.sourceReads += 1;
    return {
      id,
      provider: "sample",
      status: "connected",
      config: {},
      credentialRefs: [],
      allowedApps: [],
      ownerEmail: "owner@example.test",
    };
  },
}));
vi.mock("./data-resource-metadata.js", () => ({
  readConnectionDeletionState: () => gated("deletion", null),
  readResourcePolicyRevision: () => gated("policyRevision", 0),
}));
vi.mock("./data-resource-policy.js", () => ({
  resourcePolicies: async () => new Map(),
}));
vi.mock("../lib/connection-routing.js", () => ({}));

const { readDataBrowserCatalog } = await import("./data-browser-catalog.js");

describe("sample catalog read", () => {
  it("issues its independent metadata reads together and resolves the source once", async () => {
    const read = readDataBrowserCatalog(
      { connectionId: SAMPLE_DATA_SOURCE_ID, first: 50 } as never,
      "frontend",
    );
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect([...state.pending].sort()).toEqual([
      "deletion",
      "policyRevision",
      "presentation",
    ]);
    const settle = async () => {
      for (let i = 0; i < 20; i += 1) {
        state.releases.splice(0).forEach((release) => release());
        await Promise.resolve();
      }
    };
    await settle();
    const page = await read;
    expect(page.connectionId).toBe(SAMPLE_DATA_SOURCE_ID);
    expect(state.sourceReads).toBe(1);
  });
});
