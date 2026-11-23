import { describe, expect, it, vi } from "vitest";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";

/**
 * The workspace BigQuery source is a virtual connection: it is not a row in the
 * workspace connection list, so the granted-connection check has to resolve it
 * through the organisation's own credential readiness. Before this, a SQL cell
 * that named the source saved nothing — the check called the row lookup and the
 * save failed with "Data connection not found" for a source the picker offers.
 */
const mocks = vi.hoisted(() => ({
  readDataConnection: vi.fn(async (id: string) => {
    if (id === "granted-connection-id") {
      return { id, status: "connected", config: {} };
    }
    throw Object.assign(new Error("Data connection not found."), {
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
  }),
  context: { userEmail: "owner@example.test", orgId: "org-1" },
  readiness: "configured" as "configured" | "missing" | "partial",
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/db/schema", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("../model/data-connections.js", () => ({
  readDataConnection: mocks.readDataConnection,
  connectionContext: () => mocks.context,
}));
vi.mock("../model/database.js", () => ({
  ensureAnalyticsDatabase: vi.fn(async () => undefined),
}));
vi.mock("../model/project-grant-access.js", () => ({
  canEditProject: vi.fn(),
  canManageProject: vi.fn(),
  projectAccessLevel: vi.fn(),
}));
vi.mock("../model/project-access.js", () => ({
  getAuthorizedProjectRow: vi.fn(),
  getReadableProjectRow: vi.fn(),
}));
vi.mock("../model/projects-store.js", () => ({ getProjectDocument: vi.fn() }));
vi.mock("./workspace-access.js", () => ({
  requireCurrentWorkspace: vi.fn(),
  workspaceAccess: {},
}));
vi.mock("../lib/org-bigquery-credentials.js", () => ({
  getOrganizationBigQueryCredentialReadiness: async () => mocks.readiness,
  requireOrganizationBigQueryProjectId: async () => "query-project",
}));

const { assertGrantedDataConnection } =
  await import("./project-action-access.js");

describe("assertGrantedDataConnection and the workspace BigQuery source", () => {
  it("accepts the organisation source once its credential is configured", async () => {
    mocks.readiness = "configured";
    await expect(
      assertGrantedDataConnection(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).resolves.toBeUndefined();
    // The virtual source never goes through the row lookup.
    expect(mocks.readDataConnection).not.toHaveBeenCalled();
  });

  it("refuses the organisation source with its own typed error when the credential is missing", async () => {
    mocks.readiness = "missing";
    await expect(
      assertGrantedDataConnection(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).rejects.toMatchObject({
      errorCode: "data_connection_not_configured",
      statusCode: 409,
    });
  });

  it("keeps refusing an unknown connection id through the row lookup", async () => {
    mocks.readiness = "configured";
    await expect(
      assertGrantedDataConnection("missing-connection-id"),
    ).rejects.toMatchObject({
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
    expect(mocks.readDataConnection).toHaveBeenCalledWith(
      "missing-connection-id",
    );
  });
});
