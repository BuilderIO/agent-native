import { beforeEach, describe, expect, it, vi } from "vitest";

type Connection = {
  id: string;
  provider: string;
  status: string;
  accountId: string | null;
  config: Record<string, unknown>;
  credentialRefs: { key: string }[];
};

/**
 * Caller-side regression for Drive access on the table-details path: the real
 * getDataTableDetails must hand the selected connection's saved Drive flag to
 * the warehouse runtime as an authentication option. The transport is replaced
 * here on purpose so this test pins the caller contract only; the provider's own
 * JWT regression already proves the flag becomes the read-only Drive scope.
 */
const state = vi.hoisted(() => ({
  explorer: true,
  manager: true,
  connections: new Map<string, Connection>(),
  connectionIncluded: true,
  runtimeCalls: [] as {
    connectionId: string;
    credentialKey: string;
    options: Record<string, unknown> | undefined;
  }[],
  providerCalls: [] as { runtime: unknown; table: unknown }[],
}));

vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "qa-owner@example.invalid",
    orgId: "qa-workspace",
  }),
  currentWorkspaceCapabilities: async () => ({
    isManagerOrAbove: state.manager,
    allows: () => state.explorer || state.manager,
  }),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  credentialKeyMatches: (
    _provider: string,
    _credentialKind: string,
    key: string,
  ) => key === "SA_KEY",
}));

vi.mock("./data-connections.js", () => ({
  readBrowsableDataConnection: async (id: string) => {
    const found = state.connections.get(id);
    if (!found) {
      const { fail } = await import("@agent-native/core/action");
      fail("Data connection not found.", {
        statusCode: 404,
        errorCode: "data_connection_not_found",
      });
    }
    return found;
  },
  connectionIncludedForAgent: async () => state.connectionIncluded,
}));

vi.mock("./data-resource-metadata.js", () => ({
  readResourcePolicyRevision: async () => 0,
  readDataResourceMetadata: async (
    _scope: { ownerEmail: string; orgId: string },
    connectionId: string,
  ) => ({ connectionId, resources: [] }),
}));

vi.mock("./data-connection-provider.js", () => ({
  runtimeForConnection: async (
    connectionId: string,
    credentialKey: string,
    options?: Record<string, unknown>,
  ) => {
    state.runtimeCalls.push({ connectionId, credentialKey, options });
    return {
      executeRequest: async () => {
        throw new Error(
          "The real provider seam must not be called in this test",
        );
      },
    };
  },
}));

vi.mock("./data-table-provider.js", () => ({
  requestTableDetails: async (runtime: unknown, table: unknown) => {
    state.providerCalls.push({ runtime, table });
    return {
      projectId: "qa-project",
      datasetId: "qa_dataset",
      tableId: "qa_table",
      name: "qa_table",
      type: "TABLE",
      description: null,
      numRows: null,
      numBytes: null,
      lastModifiedTime: null,
      columnCount: 0,
      columns: [],
    };
  },
}));

import { getDataTableDetails } from "./data-table-details.js";

const validTableId = "table:qa-project:qa_dataset:qa_table";

function connection(config: Record<string, unknown> = {}): Connection {
  return {
    id: "connection-qa",
    provider: "bigquery",
    status: "connected",
    accountId: "qa-project",
    config: {
      projectId: "qa-project",
      additionalProjectIds: "",
      serviceAccountCredentialKey: "SA_KEY",
      ...config,
    },
    credentialRefs: [{ key: "SA_KEY" }],
  };
}

beforeEach(() => {
  state.explorer = true;
  state.manager = true;
  state.connectionIncluded = true;
  state.connections = new Map([
    ["connection-qa", connection({ driveAccess: true })],
  ]);
  state.runtimeCalls = [];
  state.providerCalls = [];
});

describe("table details Drive access", () => {
  it("hands the selected connection's enabled Drive access to the runtime for a frontend caller", async () => {
    const details = await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "frontend",
    );
    expect(details.connectionId).toBe("connection-qa");
    expect(state.runtimeCalls).toEqual([
      {
        connectionId: "connection-qa",
        credentialKey: "SA_KEY",
        options: { driveAccess: true },
      },
    ]);
    expect(state.providerCalls).toHaveLength(1);
  });

  it("hands the selected connection's enabled Drive access to the runtime for an agent caller", async () => {
    await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "agent",
    );
    expect(state.runtimeCalls).toEqual([
      {
        connectionId: "connection-qa",
        credentialKey: "SA_KEY",
        options: { driveAccess: true },
      },
    ]);
    expect(state.providerCalls).toHaveLength(1);
  });

  it("keeps Drive access off when the selected connection leaves it disabled", async () => {
    state.connections = new Map([
      ["connection-qa", connection({ driveAccess: false })],
    ]);
    await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "frontend",
    );
    expect(state.runtimeCalls).toEqual([
      {
        connectionId: "connection-qa",
        credentialKey: "SA_KEY",
        options: { driveAccess: false },
      },
    ]);
    expect(state.providerCalls).toHaveLength(1);
  });

  it("keeps Drive access off when the selected connection has no saved flag", async () => {
    state.connections = new Map([["connection-qa", connection()]]);
    await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "agent",
    );
    expect(state.runtimeCalls).toEqual([
      {
        connectionId: "connection-qa",
        credentialKey: "SA_KEY",
        options: { driveAccess: false },
      },
    ]);
    expect(state.providerCalls).toHaveLength(1);
  });

  it("reaches neither the runtime nor the provider when the frontend caller is denied before the read", async () => {
    state.connections = new Map([
      ["connection-qa", { ...connection(), status: "error" }],
    ]);
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "frontend",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
    expect(state.runtimeCalls).toEqual([]);
    expect(state.providerCalls).toEqual([]);
  });

  it("reaches neither the runtime nor the provider when an agent caller is denied the connection", async () => {
    state.connectionIncluded = false;
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "agent",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_connection_ai_disabled",
      statusCode: 403,
    });
    expect(state.runtimeCalls).toEqual([]);
    expect(state.providerCalls).toEqual([]);
  });
});
