import { beforeEach, describe, expect, it, vi } from "vitest";

// Row 792: the data browser opens the workspace's organization BigQuery entry
// and every metadata read answered "Data connection not found", because the
// organization source has no workspace-connection row. These cases pin the
// decision: the virtual source is authorised by the workspace credential, a
// real connection id still goes through the row lookup, and an unconfigured
// workspace credential is refused instead of silently reading annotations.
const mocks = vi.hoisted(() => ({
  requireCurrentWorkspace: vi.fn(async () => ({
    ownerEmail: "owner@example.com",
    orgId: "org-1",
  })),
  currentWorkspaceCapabilities: vi.fn(async () => ({
    isManagerOrAbove: true,
  })),
  readDataConnection: vi.fn(async (id: string) => ({
    id,
    provider: "bigquery",
    status: "connected",
    config: {},
    credentialRefs: [],
    allowedApps: [],
    ownerEmail: "owner@example.com",
  })),
  connectionIncludedForAgent: vi.fn(async () => true),
  organizationSourceAccess: vi.fn(async () => ({
    configured: true,
    includedForAgent: true,
  })),
  readDataResourceMetadata: vi.fn(async () => ({
    resources: [],
    revision: 1,
  })),
  readResourcePolicyRevision: vi.fn(async () => 1),
  resourcePolicies: vi.fn(async () => new Map()),
  writeDataResourceMetadata: vi.fn(async () => ({ id: "r1" })),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: mocks.requireCurrentWorkspace,
  currentWorkspaceCapabilities: mocks.currentWorkspaceCapabilities,
}));

vi.mock("../server/model/data-connections.js", () => ({
  readDataConnection: mocks.readDataConnection,
  readBrowsableDataConnection: mocks.readDataConnection,
  connectionIncludedForAgent: mocks.connectionIncludedForAgent,
  organizationSourceAccess: mocks.organizationSourceAccess,
}));

vi.mock("../server/model/data-resource-metadata.js", () => ({
  readDataResourceMetadata: mocks.readDataResourceMetadata,
  readResourcePolicyRevision: mocks.readResourcePolicyRevision,
  writeDataResourceMetadata: mocks.writeDataResourceMetadata,
}));

vi.mock("../server/model/data-resource-policy.js", () => ({
  resourcePolicies: mocks.resourcePolicies,
}));

vi.mock("../server/model/data-connection-mutations.js", () => ({
  metadataOptions: () => ({}),
  withConnectionGuard: async (
    _scope: unknown,
    _id: string,
    run: (tx: unknown) => Promise<unknown>,
  ) => run({}),
}));

const { ORGANIZATION_BIGQUERY_SOURCE_ID } =
  await import("../shared/bigquery-source-contract.js");
const listAction = (await import("./list-data-resource-metadata.js"))
  .default as unknown as {
  run: (
    input: { connectionId: string; resources: unknown[] },
    context?: { caller?: string },
  ) => Promise<unknown>;
};
const updateAction = (await import("./update-data-resource-metadata.js"))
  .default as unknown as {
  run: (
    input: {
      connectionId: string;
      resource: { id: string; kind: string };
      patch: Record<string, unknown>;
    },
    context?: { caller?: string },
  ) => Promise<unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.organizationSourceAccess.mockResolvedValue({
    configured: true,
    includedForAgent: true,
  });
});

describe("metadata actions on the organization BigQuery source", () => {
  it("lists annotations for the virtual organization source instead of 404ing", async () => {
    await expect(
      listAction.run(
        { connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID, resources: [] },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ resources: [], revision: 1 });
    // The row lookup is what answered "Data connection not found"; it must not
    // run for the virtual source.
    expect(mocks.readDataConnection).not.toHaveBeenCalled();
    expect(mocks.organizationSourceAccess).toHaveBeenCalled();
  });

  it("still looks up a real connection row, so an unknown id is still a 404", async () => {
    await listAction.run(
      { connectionId: "conn-real", resources: [] },
      { caller: "frontend" },
    );
    expect(mocks.readDataConnection).toHaveBeenCalledWith("conn-real");
    expect(mocks.organizationSourceAccess).not.toHaveBeenCalled();
  });

  it("refuses the organization source when the workspace credential is not configured", async () => {
    mocks.organizationSourceAccess.mockResolvedValue({
      configured: false,
      includedForAgent: false,
    });
    await expect(
      listAction.run(
        { connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID, resources: [] },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("updates an annotation on the organization source", async () => {
    await expect(
      updateAction.run(
        {
          connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
          resource: { id: "qa_sample.shakespeare_words", kind: "table" },
          patch: { description: "sample words" },
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ id: "r1" });
    expect(mocks.readDataConnection).not.toHaveBeenCalled();
  });
});
