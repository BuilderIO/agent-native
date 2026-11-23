import { beforeEach, describe, expect, it, vi } from "vitest";

type Annotation = {
  kind: "schema" | "table";
  id: string;
  aiUsage: "included" | "excluded" | null;
};

type Connection = {
  id: string;
  provider: string;
  status: string;
  accountId: string | null;
  config: Record<string, unknown>;
  credentialRefs: { key: string }[];
};

const state = vi.hoisted(() => ({
  actor: { userEmail: "qa-owner@example.invalid", orgId: "qa-workspace" } as {
    userEmail: string;
    orgId: string;
  } | null,
  explorer: true,
  manager: true,
  connections: new Map<string, Connection>(),
  metadata: new Map<string, Annotation[]>(),
  metadataThrows: false,
  connectionIncluded: true,
  providerResult: null as unknown,
  providerError: null as unknown,
  afterProviderRead: null as null | (() => void),
  readConnectionCalls: [] as string[],
  metadataCalls: [] as {
    scope: { ownerEmail: string; orgId: string };
    connectionId: string;
    resources: readonly { kind: string; id: string }[];
  }[],
  runtimeCalls: [] as { connectionId: string; credentialKey: string }[],
  providerCalls: [] as unknown[],
}));

vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => {
    if (!state.actor) {
      const { fail } = await import("@agent-native/core/action");
      fail("Sign in to continue.", {
        statusCode: 401,
        errorCode: "sign_in_required",
      });
    }
    const actor = state.actor!;
    return { ownerEmail: actor.userEmail, orgId: actor.orgId };
  },
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
    state.readConnectionCalls.push(id);
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
    scope: { ownerEmail: string; orgId: string },
    connectionId: string,
    resources: readonly { kind: string; id: string }[],
  ) => {
    state.metadataCalls.push({ scope, connectionId, resources });
    if (state.metadataThrows) throw new Error("policy store unavailable");
    return {
      connectionId,
      resources: state.metadata.get(`${scope.orgId}:${connectionId}`) ?? [],
    };
  },
}));

vi.mock("./data-connection-provider.js", () => ({
  runtimeForConnection: async (connectionId: string, credentialKey: string) => {
    state.runtimeCalls.push({ connectionId, credentialKey });
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
    if (state.providerError) throw state.providerError;
    state.afterProviderRead?.();
    return state.providerResult;
  },
}));

import {
  authorizeFavoriteTables,
  getDataTableDetails,
} from "./data-table-details.js";

const tableId = (project: string, dataset: string, table: string) =>
  `table:${encodeURIComponent(project)}:${encodeURIComponent(dataset)}:${encodeURIComponent(table)}`;

const schemaId = (project: string, dataset: string) =>
  `schema:${encodeURIComponent(project)}:${encodeURIComponent(dataset)}`;

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "connection-qa",
    provider: "bigquery",
    status: "connected",
    accountId: "qa-project",
    config: {
      projectId: "qa-project",
      additionalProjectIds: "",
      serviceAccountCredentialKey: "SA_KEY",
    },
    credentialRefs: [{ key: "UNRELATED_KEY" }, { key: "SA_KEY" }],
    ...overrides,
  };
}

function column(
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    type: "STRING",
    mode: "NULLABLE",
    description: null,
    fields: [],
    ...extra,
  };
}

function tableResult(columns = [column("id", { mode: "REQUIRED" })]) {
  return {
    projectId: "qa-project",
    datasetId: "qa_dataset",
    tableId: "qa_table",
    name: "qa_table",
    type: "TABLE",
    description: "Provider table description.",
    numRows: "42",
    numBytes: "1024",
    lastModifiedTime: "1720000000000",
    columnCount: columns.length,
    columns,
  };
}

const validTableId = tableId("qa-project", "qa_dataset", "qa_table");
const validSchemaId = schemaId("qa-project", "qa_dataset");

beforeEach(() => {
  state.afterProviderRead = null;
  state.actor = {
    userEmail: "qa-owner@example.invalid",
    orgId: "qa-workspace",
  };
  state.explorer = true;
  state.manager = true;
  state.connections = new Map([["connection-qa", connection()]]);
  state.metadata = new Map();
  state.metadataThrows = false;
  state.connectionIncluded = true;
  state.providerResult = tableResult();
  state.providerError = null;
  state.readConnectionCalls = [];
  state.metadataCalls = [];
  state.runtimeCalls = [];
  state.providerCalls = [];
});

describe("bounded table metadata authorization", () => {
  it("denies a caller without explorer access before reading the connection or provider", async () => {
    state.explorer = false;
    state.manager = false;
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "frontend",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_table_access_denied",
      statusCode: 403,
    });
    expect(state.readConnectionCalls).toEqual([]);
    expect(state.metadataCalls).toEqual([]);
    expect(state.providerCalls).toEqual([]);
  });

  it("refuses a connection the current workspace cannot read before provider access", async () => {
    state.connections.clear();
    await expect(
      getDataTableDetails(
        { connectionId: "connection-other-workspace", tableId: validTableId },
        "frontend",
      ),
    ).rejects.toMatchObject({ errorCode: "data_connection_not_found" });
    expect(state.readConnectionCalls).toEqual(["connection-other-workspace"]);
    expect(state.metadataCalls).toEqual([]);
    expect(state.providerCalls).toEqual([]);
  });

  it("treats an unknown caller as an agent and gates the connection before metadata or provider", async () => {
    state.connectionIncluded = false;
    await expect(
      getDataTableDetails({
        connectionId: "connection-qa",
        tableId: validTableId,
      }),
    ).rejects.toMatchObject({
      errorCode: "data_connection_ai_disabled",
      statusCode: 403,
    });
    expect(state.metadataCalls).toEqual([]);
    expect(state.providerCalls).toEqual([]);
  });

  it("refuses a table whose project is not the connection's primary or additional project", async () => {
    await expect(
      getDataTableDetails(
        {
          connectionId: "connection-qa",
          tableId: tableId("foreign-project", "qa_dataset", "qa_table"),
        },
        "frontend",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_table_project_denied",
      statusCode: 403,
    });
    expect(state.metadataCalls).toEqual([]);
    expect(state.providerCalls).toEqual([]);
  });

  it("accepts a table in an additional project before provider access", async () => {
    state.connections.set(
      "connection-qa",
      connection({
        config: {
          projectId: "qa-project",
          additionalProjectIds: "qa-project, shared-project",
          serviceAccountCredentialKey: "SA_KEY",
        },
      }),
    );
    state.providerResult = {
      ...tableResult(),
      projectId: "shared-project",
    };
    const result = await getDataTableDetails(
      {
        connectionId: "connection-qa",
        tableId: tableId("shared-project", "qa_dataset", "qa_table"),
      },
      "frontend",
    );
    expect(result.table.projectId).toBe("shared-project");
    expect(state.providerCalls).toHaveLength(1);
  });

  it("rejects malformed percent escapes, empty segments, wrong kinds and path injection", async () => {
    const invalid = [
      "table:%ZZ:qa_dataset:qa_table",
      "table::qa_dataset:qa_table",
      "schema:qa-project:qa_dataset:qa_table",
      "table:qa-project%2Fevil:qa_dataset:qa_table",
      "table:qa-project:qa_dataset:",
      "table:qa-project:qa_dataset:qa_table:extra",
      "table:qa-project:qa_dataset:..",
      "table:qa-project:qa_dataset:t%2F..",
      "table:qa-project:qa_dataset:t%3aextra",
    ];
    for (const candidate of invalid) {
      await expect(
        getDataTableDetails(
          { connectionId: "connection-qa", tableId: candidate },
          "frontend",
        ),
      ).rejects.toMatchObject({ errorCode: "data_table_id_invalid" });
    }
    expect(state.readConnectionCalls).toEqual([]);
    expect(state.providerCalls).toEqual([]);
  });

  it("scopes the AI policy to the current organisation for the same email", async () => {
    state.actor = { userEmail: "qa-owner@example.invalid", orgId: "org-a" };
    state.metadata.set("org-a:connection-qa", [
      { kind: "table", id: validTableId, aiUsage: "excluded" },
    ]);
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "agent",
      ),
    ).rejects.toMatchObject({ errorCode: "data_table_ai_disabled" });
    expect(state.metadataCalls[0]?.scope).toEqual({
      ownerEmail: "qa-owner@example.invalid",
      orgId: "org-a",
    });
    expect(state.providerCalls).toEqual([]);

    state.actor = { userEmail: "qa-owner@example.invalid", orgId: "org-b" };
    state.metadata.set("org-b:connection-qa", [
      { kind: "table", id: validTableId, aiUsage: "included" },
    ]);
    const visible = await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "agent",
    );
    expect(visible.table.name).toBe("qa_table");
    expect(state.metadataCalls[1]?.scope.orgId).toBe("org-b");
    expect(state.providerCalls).toHaveLength(1);
  });

  it("lets an excluded schema parent win over an included table override for agents, while frontend remains able to read it", async () => {
    state.metadata.set("qa-workspace:connection-qa", [
      { kind: "schema", id: validSchemaId, aiUsage: "excluded" },
      { kind: "table", id: validTableId, aiUsage: "included" },
    ]);
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "agent",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_table_ai_disabled",
      statusCode: 403,
    });
    expect(state.providerCalls).toEqual([]);

    const view = await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "frontend",
    );
    expect(view.table.name).toBe("qa_table");
    // The frontend path keeps the explorer grant and does not read AI policy.
    expect(state.metadataCalls).toHaveLength(1);
    expect(state.providerCalls).toHaveLength(1);
  });

  it("lets a direct table exclusion stop an agent while frontend still reads the granted table", async () => {
    state.metadata.set("qa-workspace:connection-qa", [
      { kind: "table", id: validTableId, aiUsage: "excluded" },
    ]);
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "agent",
      ),
    ).rejects.toMatchObject({ errorCode: "data_table_ai_disabled" });
    const view = await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "frontend",
    );
    expect(view.table.name).toBe("qa_table");
    expect(state.providerCalls).toHaveLength(1);
  });

  it("treats an unavailable policy helper as an explicit pending failure, not an include or exclude", async () => {
    state.metadataThrows = true;
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "agent",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_table_ai_policy_pending",
      statusCode: 503,
    });
    expect(state.providerCalls).toEqual([]);

    const view = await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "frontend",
    );
    expect(view.table.name).toBe("qa_table");
    expect(state.providerCalls).toHaveLength(1);
  });

  it("uses the selected service-account reference, not the first unrelated key", async () => {
    await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "frontend",
    );
    expect(state.runtimeCalls).toEqual([
      { connectionId: "connection-qa", credentialKey: "SA_KEY" },
    ]);
  });

  it("returns all 1001 columns with nested modes and descriptions preserved", async () => {
    const columns = Array.from({ length: 1001 }, (_, index) =>
      column(`column_${index + 1}`),
    );
    columns[1000] = column("column_1001", {
      type: "RECORD",
      mode: "REPEATED",
      description: "Nested last column",
      fields: [
        column("child", {
          type: "STRING",
          mode: "NULLABLE",
          description: "Child description",
        }),
      ],
    });
    state.providerResult = tableResult(columns);
    const result = await getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "frontend",
    );
    expect(result.table.columnCount).toBe(1001);
    expect(result.table.columns).toHaveLength(1001);
    expect(result.table.columns[1000]).toEqual({
      name: "column_1001",
      type: "RECORD",
      mode: "REPEATED",
      description: "Nested last column",
      fields: [
        {
          name: "child",
          type: "STRING",
          mode: "NULLABLE",
          description: "Child description",
          fields: [],
        },
      ],
    });
    expect(Object.keys(result).sort()).toEqual(["connectionId", "table"]);
  });

  it("propagates a typed provider failure instead of returning empty columns", async () => {
    state.providerError = Object.assign(new Error("denied"), {
      errorCode: "data_table_permission_denied",
      statusCode: 403,
    });
    await expect(
      getDataTableDetails(
        { connectionId: "connection-qa", tableId: validTableId },
        "frontend",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_table_permission_denied",
      statusCode: 403,
    });
  });
});

it("withholds an agent table response if root consent is revoked during the provider read", async () => {
  state.afterProviderRead = () => {
    state.connectionIncluded = false;
  };
  await expect(
    getDataTableDetails(
      { connectionId: "connection-qa", tableId: validTableId },
      "agent",
    ),
  ).rejects.toMatchObject({
    statusCode: 403,
    errorCode: "data_connection_ai_disabled",
  });
  expect(state.providerCalls).toHaveLength(1);
});

it("reads builtin table fields without credentials while retaining scope and AI ancestry", async () => {
  const id = "builtin-sample-data";
  state.connections.set(
    id,
    connection({
      id,
      provider: "sample",
      accountId: "sample",
      config: { projectId: "sample", includeForAI: true },
      credentialRefs: [],
    }),
  );
  const input = { connectionId: id, tableId: "table:sample:PUBLIC:orders" };
  const result = await getDataTableDetails(input);
  expect(result).toMatchObject({
    connectionId: id,
    table: {
      projectId: "sample",
      datasetId: "PUBLIC",
      tableId: "orders",
      numRows: "240",
      columnCount: 8,
      columns: expect.arrayContaining([
        {
          name: "order_id",
          type: "string",
          mode: null,
          description: "Unique identifier for each placed order.",
          fields: [],
        },
      ]),
    },
  });
  expect(state.runtimeCalls).toEqual([]);
  expect(state.providerCalls).toEqual([]);
  await expect(
    getDataTableDetails({ ...input, tableId: "table:foreign:PUBLIC:orders" }),
  ).rejects.toMatchObject({ errorCode: "data_table_project_denied" });
  state.metadata.set("qa-workspace:" + id, [
    { kind: "schema", id: "schema:PUBLIC", aiUsage: "excluded" },
  ]);
  await expect(getDataTableDetails(input)).rejects.toMatchObject({
    errorCode: "data_table_ai_disabled",
  });
  state.actor = null;
  await expect(getDataTableDetails(input)).rejects.toMatchObject({
    errorCode: "sign_in_required",
  });
});

it("rechecks favorite connection grants once per connection without provider reads and enforces agent table policy", async () => {
  const refs = [
    { connectionId: "connection-qa", tableId: validTableId },
    {
      connectionId: "connection-qa",
      tableId: tableId("qa-project", "qa_dataset", "second"),
    },
  ];
  expect(await authorizeFavoriteTables(refs, "frontend")).toEqual([
    "qa_table",
    "second",
  ]);
  expect(state.readConnectionCalls).toEqual(["connection-qa"]);
  expect(state.providerCalls).toEqual([]);
  state.metadata.set("qa-workspace:connection-qa", [
    { kind: "table", id: validTableId, aiUsage: "excluded" },
  ]);
  await expect(authorizeFavoriteTables(refs, "agent")).rejects.toMatchObject({
    errorCode: "data_table_ai_disabled",
  });
  state.connections.clear();
  await expect(authorizeFavoriteTables(refs, "frontend")).rejects.toMatchObject(
    { errorCode: "data_connection_not_found" },
  );
});

it("rejects favorites for an unauthorized project and a missing sample table", async () => {
  await expect(
    authorizeFavoriteTables(
      [
        {
          connectionId: "connection-qa",
          tableId: tableId("outside", "d", "t"),
        },
      ],
      "frontend",
    ),
  ).rejects.toMatchObject({ errorCode: "data_table_project_denied" });
  state.connections.set(
    "builtin-sample-data",
    connection({
      id: "builtin-sample-data",
      provider: "sample",
      accountId: "sample",
      config: { projectId: "sample", includeForAI: true },
    }),
  );
  const missing = {
    connectionId: "builtin-sample-data",
    tableId: tableId("sample", "PUBLIC", "missing_table"),
  };
  await expect(
    authorizeFavoriteTables([missing], "frontend"),
  ).rejects.toMatchObject({ errorCode: "data_table_not_found" });
  expect(
    await authorizeFavoriteTables([missing], "frontend", {
      allowMissingSample: true,
    }),
  ).toEqual(["missing_table"]);
});
