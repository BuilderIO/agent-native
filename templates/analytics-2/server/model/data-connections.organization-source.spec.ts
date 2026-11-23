import { beforeEach, describe, expect, it, vi } from "vitest";

// Row 792: the data browser opens the workspace organization BigQuery entry and
// every read path answered "Data connection not found", because that source is
// virtual: its credential lives in the org vault and there is no
// workspace-connection row. The browsable reader must hand those paths a real
// connection record, while write paths keep the strict row lookup.
const mocks = vi.hoisted(() => ({
  requestContext: { userEmail: "owner@example.com", orgId: "org-1" } as Record<
    string,
    unknown
  >,
  readiness: "configured" as string,
  projectId: "agent-native-qa-bq",
  details: { connectionName: "QA BigQuery sample", connectionDescription: "" },
  rows: [
    {
      id: "conn-real",
      provider: "bigquery",
      label: "Real connection",
      accountId: "real-project",
      accountLabel: "real-project",
      status: "connected",
      scopes: [],
      config: {},
      allowedApps: [],
      allowedUsers: [],
      credentialRefs: [],
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastCheckedAt: null,
      lastError: null,
      appAccess: {
        appId: "analytics-2",
        available: true,
        mode: "all-apps",
        reason: "",
        grantId: null,
      },
      explicitGrant: null,
    },
  ],
}));

vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fail: (message: string, options?: Record<string, unknown>) => {
      throw Object.assign(new Error(message), options);
    },
  };
});

vi.mock("@agent-native/core/server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agent-native/core/server",
  );
  return { ...actual, getRequestContext: () => mocks.requestContext };
});

vi.mock("@agent-native/core/workspace-connections", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agent-native/core/workspace-connections",
  );
  return { ...actual, listWorkspaceConnectionsForApp: async () => mocks.rows };
});

vi.mock("../lib/workspace-access.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../lib/workspace-access.js",
  );
  return {
    ...actual,
    requireCurrentWorkspace: async () => ({
      ownerEmail: (mocks.requestContext as { userEmail?: string }).userEmail,
      orgId: (mocks.requestContext as { orgId?: string | null }).orgId,
    }),
  };
});

vi.mock("../lib/org-bigquery-credentials.js", () => ({
  getOrganizationBigQueryCredentialReadiness: async () => mocks.readiness,
  requireOrganizationBigQueryProjectId: async () => mocks.projectId,
}));

vi.mock("../lib/org-bigquery-connection-details.js", () => ({
  getOrganizationBigQueryDetails: async () => mocks.details,
}));

const { ORGANIZATION_BIGQUERY_SOURCE_ID } =
  await import("../../shared/bigquery-source-contract.js");
const { canReadConnectionResults, readBrowsableDataConnection } =
  await import("./data-connections.js");

beforeEach(() => {
  mocks.readiness = "configured";
});

describe("readBrowsableDataConnection", () => {
  it("describes the virtual organization source from the workspace credential", async () => {
    const connection = await readBrowsableDataConnection(
      ORGANIZATION_BIGQUERY_SOURCE_ID,
    );
    expect(connection.id).toBe(ORGANIZATION_BIGQUERY_SOURCE_ID);
    expect(connection.provider).toBe("bigquery");
    expect(connection.status).toBe("connected");
    expect(connection.config.projectId).toBe("agent-native-qa-bq");
    expect(connection.accountId).toBe("agent-native-qa-bq");
    expect(connection.label).toBe("QA BigQuery sample");
  });

  it("refuses the organization source when the workspace credential is missing", async () => {
    mocks.readiness = "missing";
    await expect(
      readBrowsableDataConnection(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("keeps the strict row lookup, and its 404, for a real connection id", async () => {
    const connection = await readBrowsableDataConnection("conn-real");
    expect(connection.id).toBe("conn-real");
    await expect(
      readBrowsableDataConnection("conn-absent"),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("report A2-ASK84-PUBLISHED-SOURCE-UNAVAILABLE: reports 404 when a workspace-profile connection is not accessible rather than 403 unavailable", async () => {
    mocks.rows.push({
      id: "conn-workspace-profile",
      provider: "bigquery",
      label: "Workspace BQ",
      accountId: "qa-project",
      accountLabel: "qa-project",
      status: "connected",
      scopes: [],
      config: { workspaceCredentialProfile: "workspace-v1" },
      allowedApps: [],
      allowedUsers: [],
      credentialRefs: [],
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastCheckedAt: null,
      lastError: null,
      appAccess: {
        appId: "analytics-2",
        available: true,
        mode: "all-apps",
        reason: "",
        grantId: null,
      },
      explicitGrant: null,
    });
    await expect(
      readBrowsableDataConnection("conn-workspace-profile"),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "data_connection_not_found",
    });
  });
});

// Row 819's second half: the cell saved and ran, but the project read replaced
// its output with "You do not have access to view results from this data
// connection" because the result-access check looked the virtual source up as a
// stored row. The workspace source is shared with the whole workspace, so a
// member may read its results while its credential is configured.
describe("canReadConnectionResults", () => {
  it("lets a workspace member read results from the virtual organization source", async () => {
    expect(
      await canReadConnectionResults(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).toBe(true);
  });

  it("refuses the organization source while its credential is not configured", async () => {
    mocks.readiness = "missing";
    expect(
      await canReadConnectionResults(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).toBe(false);
  });

  // facdc885c8 changed this on purpose: the credential lives in the member's
  // workspace, not in their personal scope, so a personal-scope session still
  // reads back a result the same session was allowed to produce. The old
  // "refuses outside a workspace" expectation is retired here, in the open.
  it("still reads results from the workspace the query ran in, in a personal scope", async () => {
    mocks.requestContext = {
      userEmail: "owner@example.com",
      orgId: "org-1",
      orgScope: "personal",
    };
    expect(
      await canReadConnectionResults(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).toBe(true);
  });
});
