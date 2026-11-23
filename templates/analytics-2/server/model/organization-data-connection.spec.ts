import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    userEmail: "owner@example.test",
    orgId: "org-1",
    orgScope: "workspace" as const,
  },
  readiness: "configured" as "configured" | "missing" | "partial",
  details: {
    connectionName: "Warehouse fixture",
    connectionDescription: "The team's warehouse",
  } as { connectionName: string; connectionDescription: string } | null,
  orgProject: "query-project",
  queryResult: null as unknown,
  requireOrgMetadataScope: false,
  defaultGate: null as Promise<unknown> | null,
  profileReads: 0,
  presentationReads: 0,
  nativeRows: [] as unknown[],
  metadataPage: {
    items: [
      { id: "dataset-1", name: "dataset_1", kind: "schema", hasChildren: true },
    ],
    nextPageToken: undefined as string | undefined,
  },
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestContext: () => mocks.context,
}));
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: async () =>
    mocks.defaultGate ? await mocks.defaultGate : null,
  getUserSetting: async () => null,
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  listWorkspaceConnectionsForApp: async () => mocks.nativeRows,
  readWorkspaceCredentialProfile: async () => {
    mocks.profileReads++;
    return { connection: mocks.nativeRows[0], active: true };
  },
}));
vi.mock("./data-resource-metadata.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data-resource-metadata.js")>()),
  readConnectionAnnotationOverride: async () => {
    mocks.presentationReads++;
    return null;
  },
}));
vi.mock("../lib/org-bigquery-credentials.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../lib/org-bigquery-credentials.js")
  >()),
  getOrganizationBigQueryCredentialReadiness: async () => mocks.readiness,
  requireOrganizationBigQueryProjectId: async () => mocks.orgProject,
}));
vi.mock("../lib/org-bigquery-connection-details.js", () => ({
  getOrganizationBigQueryDetails: async () => mocks.details,
}));
vi.mock("./data-connection-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data-connection-provider.js")>()),
  requestMetadata: async () => {
    if (mocks.requireOrgMetadataScope) {
      const { getCredentialContext } =
        await import("@agent-native/core/server");
      if (getCredentialContext()?.credentialScope !== "org")
        throw new Error("Wrong credential scope");
    }
    return mocks.metadataPage;
  },
}));
vi.mock("../lib/organization-warehouse-query.js", () => ({
  runOrganizationWarehouseQueryInternal: async () => ({
    output: mocks.queryResult,
    providerTypes: ["INTEGER", "STRING"],
  }),
}));

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import {
  executeConnectionQuery,
  listConnectionDatasets,
  listDataConnections,
} from "./data-connections.js";

beforeEach(() => {
  mocks.readiness = "configured";
  mocks.requireOrgMetadataScope = false;
  mocks.details = {
    connectionName: "Warehouse fixture",
    connectionDescription: "The team's warehouse",
  };
  mocks.queryResult = null;
  mocks.defaultGate = null;
  mocks.profileReads = 0;
  mocks.presentationReads = 0;
  mocks.nativeRows = [];
});

describe("organization BigQuery source in the rebuilt data paths", () => {
  it("report A2-CONNECTION-READ-LATENCY: checks and presents native sources while the default setting is pending", async () => {
    let release: (value: null) => void = () => {
      throw new Error("Default setting gate was not initialized");
    };
    mocks.defaultGate = new Promise((resolve) => {
      release = resolve;
    });
    mocks.nativeRows = [
      {
        id: "native-1",
        label: "Warehouse",
        provider: "bigquery",
        status: "connected",
        orgId: "org-1",
        config: { workspaceCredentialProfile: "workspace-v1" },
        credentialRefs: [],
        allowedUsers: [],
        allowedUserGroups: [],
        explicitGrant: null,
      },
    ];
    const result = listDataConnections({});
    try {
      await vi.waitFor(
        () => {
          expect(mocks.profileReads).toBe(1);
          expect(mocks.presentationReads).toBe(1);
        },
        { timeout: 500, interval: 10 },
      );
    } finally {
      release(null);
      await result;
    }
    expect((await result).find((row) => row.id === "native-1")).toMatchObject({
      name: "Warehouse",
      isDefault: false,
    });
  });
  it("lists the configured workspace source with its own identity", async () => {
    const connections = await listDataConnections({});
    const organization = connections.find(
      (connection) => connection.id === ORGANIZATION_BIGQUERY_SOURCE_ID,
    );
    expect(organization).toMatchObject({
      id: ORGANIZATION_BIGQUERY_SOURCE_ID,
      name: "Warehouse fixture",
      description: "The team's warehouse",
      type: "bigquery",
      shared: true,
      canQuery: "All workspace members",
      canView: "All workspace members",
    });
    expect(
      connections.filter(
        (connection) => connection.id === ORGANIZATION_BIGQUERY_SOURCE_ID,
      ),
    ).toHaveLength(1);
  });

  it("does not invent the source when the workspace credentials are missing", async () => {
    mocks.readiness = "missing";
    expect(
      (await listDataConnections({})).filter(
        (connection) => connection.id === ORGANIZATION_BIGQUERY_SOURCE_ID,
      ),
    ).toEqual([]);
  });

  it("browses the workspace source's datasets through the organization project", async () => {
    expect(
      await listConnectionDatasets({
        connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
        first: 50,
      }),
    ).toMatchObject({
      items: [
        {
          id: "dataset-1",
          name: "dataset_1",
          kind: "schema",
          hasChildren: true,
        },
      ],
      endCursor: null,
      hasNextPage: false,
    });
  });

  it("report A2-ORG-CATALOG-CREDENTIAL-SCOPE: uses organization credential scope for dataset and table pages", async () => {
    mocks.requireOrgMetadataScope = true;
    const { runWithRequestContext } = await import("@agent-native/core/server");
    await runWithRequestContext(
      { userEmail: mocks.context.userEmail, orgId: mocks.context.orgId },
      async () => {
        for (const parentId of [undefined, "schema:query-project:dataset_1"]) {
          const result = await listConnectionDatasets({
            connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
            first: 50,
            ...(parentId === undefined ? {} : { parentId }),
          });
          expect(result.items[0]?.name).toBe("dataset_1");
        }
      },
    );
  });

  it("maps an organization query page to the saved-query result contract", async () => {
    mocks.queryResult = {
      columns: [
        { name: "answer", type: "number" },
        { name: "label", type: "string" },
      ],
      rows: [{ answer: 42, label: "ok" }],
      rowCount: 1,
      complete: true,
      hasMore: false,
      nextPageToken: null,
      queryId: null,
      status: "complete",
      totalRows: "1",
      truncated: false,
      jobComplete: true,
      semanticDefinitionIds: [],
      warnings: [],
    };
    expect(
      await executeConnectionQuery(
        {
          connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
          query: "SELECT 42 AS answer, 'ok' AS label",
          first: 1000,
        },
        { userEmail: "owner@example.test", orgId: "org-1", caller: "frontend" },
      ),
    ).toMatchObject({
      jobComplete: true,
      status: "complete",
      columns: [
        { name: "answer", type: "number" },
        { name: "label", type: "string" },
      ],
      rows: [[42, "ok"]],
      totalRows: "1",
      hasNextPage: false,
    });
  });
});
