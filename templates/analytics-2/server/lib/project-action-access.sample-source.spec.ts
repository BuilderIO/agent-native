import { describe, expect, it, vi } from "vitest";

import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";

/**
 * Choosing "[Demo] Public Data" in a query cell saves the cell with the sample
 * source id. That id is not a workspace connection row, so the granted-connection
 * check must accept it without the row lookup, or the save 404s and the chip keeps
 * showing the old connection (row 588).
 */
const mocks = vi.hoisted(() => ({
  readDataConnection: vi.fn(async () => {
    throw Object.assign(new Error("Data connection not found."), {
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
  }),
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
  connectionContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
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
  getOrganizationBigQueryCredentialReadiness: async () => "missing",
  requireOrganizationBigQueryProjectId: async () => "query-project",
}));

const { assertGrantedDataConnection, grantedConnectionOrNull } =
  await import("./project-action-access.js");

describe("the bundled sample source as a cell's data connection", () => {
  it("is accepted by the granted-connection check without a row lookup", async () => {
    await expect(
      assertGrantedDataConnection(SAMPLE_DATA_SOURCE_ID),
    ).resolves.toBeUndefined();
    expect(mocks.readDataConnection).not.toHaveBeenCalled();
  });

  it("is kept when a new cell inherits it", async () => {
    await expect(grantedConnectionOrNull(SAMPLE_DATA_SOURCE_ID)).resolves.toBe(
      SAMPLE_DATA_SOURCE_ID,
    );
  });

  it("still refuses an id that is neither a row nor a known source", async () => {
    await expect(
      assertGrantedDataConnection("conn_missing"),
    ).rejects.toMatchObject({
      errorCode: "data_connection_not_found",
    });
  });
});
